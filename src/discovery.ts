// Finds printers three ways and reports raw sightings; registry.ts merges them.
//  1. mDNS browse: instant and carries the IPP path and UUID.
//  2. TCP sweep of the local /24: catches printers with Bonjour switched off.
//  3. Windows spooler: USB, shared, driver-only and virtual queues.
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

// ---------- local interfaces ----------

const VIRTUAL_IFACE = /vethernet|vmware|virtualbox|vbox|hyper-v|wsl|tailscale|zerotier|wireguard|loopback|docker|utun|tun\d|tap\d|npcap|bluetooth/i;

export function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

/** LAN adapters only. VPN and hypervisor adapters hold no printers and would waste the sweep budget. */
export function lanInterfaces(): { name: string; address: string; cidr: number }[] {
  const out: { name: string; address: string; cidr: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      if (!isPrivateIpv4(a.address)) continue;
      out.push({ name, address: a.address, cidr: Number(a.cidr?.split('/')[1] ?? 24) });
    }
  }
  return out;
}

// ---------- mDNS ----------

export interface MdnsService {
  instance: string;
  type: 'ipp' | 'ipps' | 'raw' | 'lpd';
  host: string;
  port: number;
  addresses: string[];
  txt: Record<string, string>;
}

const SERVICE_TYPES: Record<string, MdnsService['type']> = {
  '_ipp._tcp.local': 'ipp', '_ipps._tcp.local': 'ipps', '_pdl-datastream._tcp.local': 'raw', '_printer._tcp.local': 'lpd',
};

function encodeName(name: string): Buffer {
  const parts: Buffer[] = [];
  for (const label of name.split('.')) parts.push(Buffer.from([label.length]), Buffer.from(label));
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function buildQuery(names: string[], qtype = 12): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(names.length, 4);
  return Buffer.concat([header, ...names.map(n => Buffer.concat([encodeName(n), Buffer.from([0, qtype, 0, 1])]))]);
}

function readDnsName(b: Buffer, start: number): [string, number] {
  const labels: string[] = [];
  let o = start, end = -1, jumps = 0;
  for (;;) {
    if (o >= b.length) throw new Error('bad DNS name');
    const len = b[o];
    if (len === 0) { if (end < 0) end = o + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (o + 1 >= b.length || ++jumps > 16) throw new Error('bad DNS pointer');
      if (end < 0) end = o + 2;
      o = ((len & 0x3f) << 8) | b[o + 1];
      continue;
    }
    if (o + 1 + len > b.length) throw new Error('bad DNS label');
    labels.push(b.toString('utf8', o + 1, o + 1 + len));
    o += len + 1;
  }
  return [labels.join('.'), end];
}

export interface DnsRecord { name: string; type: number; value: string | { port: number; target: string } | Record<string, string> }

export function parseDns(b: Buffer): DnsRecord[] {
  const records: DnsRecord[] = [];
  if (b.length < 12) return records;
  const qd = b.readUInt16BE(4), total = b.readUInt16BE(6) + b.readUInt16BE(8) + b.readUInt16BE(10);
  let o = 12;
  for (let i = 0; i < qd; i++) o = readDnsName(b, o)[1] + 4;
  for (let i = 0; i < total; i++) {
    const [name, next] = readDnsName(b, o);
    o = next;
    if (o + 10 > b.length) break;
    const type = b.readUInt16BE(o), len = b.readUInt16BE(o + 8), d = o + 10;
    o = d + len;
    if (o > b.length) break;
    if (type === 12) records.push({ name, type, value: readDnsName(b, d)[0] });
    else if (type === 1 && len === 4) records.push({ name, type, value: `${b[d]}.${b[d + 1]}.${b[d + 2]}.${b[d + 3]}` });
    else if (type === 33 && len >= 7) records.push({ name, type, value: { port: b.readUInt16BE(d + 4), target: readDnsName(b, d + 6)[0] } });
    else if (type === 16) {
      const txt: Record<string, string> = Object.create(null);
      for (let p = d; p < d + len;) {
        const l = b[p];
        if (p + 1 + l > d + len) break;
        const s = b.toString('utf8', p + 1, p + 1 + l);
        const eq = s.indexOf('=');
        if (eq > 0) txt[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1);
        p += l + 1;
      }
      records.push({ name, type, value: txt });
    }
  }
  return records;
}

export async function browseMdns(timeoutMs = 1500): Promise<MdnsService[]> {
  const records = new Map<string, DnsRecord>();
  const query = buildQuery(Object.keys(SERVICE_TYPES));
  const collect = (ifaceAddress: string) => new Promise<void>(resolve => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { sock.close(); } catch { /* already closed */ } resolve(); };
    sock.on('error', e => { console.error(`print-mcp: mDNS on ${ifaceAddress}:`, e.message); done(); });
    sock.on('message', msg => {
      try {
        for (const r of parseDns(msg)) records.set(`${r.name}|${r.type}|${JSON.stringify(r.value)}`, r);
      } catch (e) {
        // A malformed packet from one LAN device must not stop the browse.
        console.error('print-mcp: bad mDNS packet:', (e as Error).message);
      }
    });
    sock.bind(0, ifaceAddress, () => {
      try {
        sock.setMulticastInterface(ifaceAddress);
        sock.setMulticastTTL(255);
      } catch (e) {
        console.error(`print-mcp: mDNS setup on ${ifaceAddress}:`, (e as Error).message);
        return done();
      }
      const send = () => sock.send(query, 5353, '224.0.0.251', err => { if (err) console.error('print-mcp: mDNS send:', err.message); });
      send();
      setTimeout(send, 400); // UDP may drop the first query; printers on Wi-Fi often sleep through it
      setTimeout(done, timeoutMs);
    });
  });
  await Promise.all(lanInterfaces().map(i => collect(i.address)));

  const all = [...records.values()];
  const hostAddrs = new Map<string, string[]>();
  for (const r of all) if (r.type === 1) {
    const key = r.name.toLowerCase();
    hostAddrs.set(key, [...new Set([...(hostAddrs.get(key) ?? []), r.value as string])]);
  }
  const services: MdnsService[] = [];
  for (const r of all) {
    if (r.type !== 33) continue;
    const match = Object.entries(SERVICE_TYPES).find(([suffix]) => r.name.toLowerCase().endsWith(`.${suffix}`));
    if (!match) continue;
    const srv = r.value as { port: number; target: string };
    const txtRec = all.find(x => x.type === 16 && x.name === r.name);
    services.push({
      instance: r.name.slice(0, -(match[0].length + 1)), type: match[1], host: srv.target, port: srv.port,
      addresses: hostAddrs.get(srv.target.toLowerCase()) ?? [], txt: (txtRec?.value as Record<string, string>) ?? {},
    });
  }
  return services;
}

// ---------- TCP sweep ----------

export function tcpOpen(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.connect({ host, port, timeout: timeoutMs });
    const finish = (v: boolean) => { s.destroy(); resolve(v); };
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
  });
}

export interface SweepHit { host: string; ports: number[] }

/** Sweeps at most a /24 around each LAN address; a wider scan is slow and noisy on company networks. */
export async function sweepSubnets(ports = [631, 9100, 443], timeoutMs = 400, concurrency = 96): Promise<SweepHit[]> {
  const own = new Set(Object.values(os.networkInterfaces()).flat().map(a => a?.address));
  const hosts = new Set<string>();
  for (const i of lanInterfaces()) {
    const base = i.address.split('.').slice(0, 3).join('.');
    for (let n = 1; n < 255; n++) if (!own.has(`${base}.${n}`)) hosts.add(`${base}.${n}`);
  }
  const queue = [...hosts];
  const hits: SweepHit[] = [];
  const worker = async () => {
    for (let host = queue.pop(); host; host = queue.pop()) {
      const open: number[] = [];
      for (const p of ports) if (await tcpOpen(host, p, timeoutMs)) open.push(p);
      // 443 alone is any web server. It only counts alongside a print port.
      if (open.some(p => p !== 443)) hits.push({ host, ports: open });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return hits;
}

// ---------- SNMP, to name 9100-only devices without printing anything ----------

/**
 * Asks sysDescr and hrPrinterStatus with SNMPv2c "public". Probing port 9100 itself is off
 * limits: many devices would print whatever bytes arrive there, wasting paper during a scan.
 */
export function snmpIdentify(host: string, timeoutMs = 700): Promise<{ description?: string; isPrinter: boolean } | null> {
  const oid = (bytes: number[]) => Buffer.from([0x06, bytes.length, ...bytes]);
  const varbind = (o: Buffer) => { const inner = Buffer.concat([o, Buffer.from([0x05, 0])]); return Buffer.concat([Buffer.from([0x30, inner.length]), inner]); };
  const tlv = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag, content.length]), content]);
  const sysDescr = oid([0x2b, 6, 1, 2, 1, 1, 1, 0]);
  const hrPrinterStatus = oid([0x2b, 6, 1, 2, 1, 25, 3, 5, 1, 1, 1]);
  const binds = tlv(0x30, Buffer.concat([varbind(sysDescr), varbind(hrPrinterStatus)]));
  const pdu = tlv(0xa0, Buffer.concat([Buffer.from([2, 1, 7, 2, 1, 0, 2, 1, 0]), binds]));
  const msg = tlv(0x30, Buffer.concat([Buffer.from([2, 1, 1]), tlv(4, Buffer.from('public')), pdu]));

  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const finish = (v: { description?: string; isPrinter: boolean } | null) => { clearTimeout(timer); try { sock.close(); } catch { /* already closed */ } resolve(v); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on('error', () => finish(null));
    sock.on('message', b => {
      // Find values by OID bytes rather than fully parsing BER; anything odd means "unknown".
      const valueAfter = (o: Buffer): Buffer | null => {
        const at = b.indexOf(o);
        if (at < 0 || at + o.length + 2 > b.length) return null;
        const p = at + o.length, tag = b[p];
        let len = b[p + 1], start = p + 2;
        if (len & 0x80) {
          const n = len & 0x7f;
          if (n > 2 || start + n > b.length) return null;
          len = n === 1 ? b[start] : b.readUInt16BE(start);
          start += n;
        }
        if (tag >= 0x80 || tag === 5 || start + len > b.length) return null;
        return b.subarray(start, start + len);
      };
      const descr = valueAfter(sysDescr)?.toString('utf8').replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, 120);
      finish({ description: descr, isPrinter: valueAfter(hrPrinterStatus) !== null });
    });
    sock.send(msg, 161, host, err => { if (err) finish(null); });
  });
}

// ---------- Windows spooler ----------

export interface WindowsQueue {
  name: string;
  driver: string;
  port: string;
  host?: string;
  /** From the WSD monitor registry; equals the IPP printer-uuid, which gives an exact merge. */
  uuid?: string;
  isDefault: boolean;
  offline: boolean;
  shared: boolean;
  status?: string;
  virtual: boolean;
  caps?: {
    color: boolean;
    duplex: boolean;
    maxCopies: number;
    papers: { name: string; kind: number; widthMm: number; heightMm: number }[];
    sources: string[];
    resolutions: { kind: string; x: number; y: number }[];
  };
}

export function listWindowsQueues(timeoutMs = 20000): Promise<WindowsQueue[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return runPowerShell(path.join(SCRIPTS_DIR, 'windows-discover.ps1'), undefined, timeoutMs).then(out => {
    const parsed = JSON.parse(out.trim() || '[]') as WindowsQueue | WindowsQueue[];
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

/**
 * A client started from PowerShell 7 passes down a module path that makes Windows PowerShell load
 * modules it cannot use, so commands fail with "the module could not be loaded". Without it, the
 * path is rebuilt from the system defaults.
 */
export function powerShellEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'psmodulepath'));
}

export function runPowerShell(script: string, stdin: string | undefined, timeoutMs: number, onTimeout?: (stdoutSoFar: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    // No shell and data only via stdin: printer and file names may contain anything.
    const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: powerShellEnv(),
    });
    let out = '', err = '';
    const timer = setTimeout(() => { onTimeout?.(out); p.kill(); reject(new Error(`${path.basename(script)} timed out after ${timeoutMs} ms`)); }, timeoutMs);
    p.stdout.setEncoding('utf8').on('data', d => { out += d; });
    p.stderr.setEncoding('utf8').on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').slice(0, 3).join(' ') || `${path.basename(script)} exited with ${code}`));
    });
    p.stdin.on('error', () => { /* child exited early; the close handler reports it */ });
    p.stdin.end(stdin ?? '');
  });
}
