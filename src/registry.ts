// The always-ready printer list. Stale-while-revalidate: the disk cache answers instantly,
// discovery refreshes it in the background. Identity is the UUID, never the IP, so a
// DHCP lease change heals itself instead of breaking printing.
import { deviceText, getPrinterAttributes, probeIppPath, type IppAttrs, type IppCollection, type IppTarget, type IppValue } from './ipp.js';
import { browseMdns, isPrivateIpv4, listWindowsQueues, snmpIdentify, sweepSubnets, tcpOpen, type MdnsService, type WindowsQueue } from './discovery.js';
import { loadConfig, readJson, saveConfig, writeJson, type Config } from './state.js';
import dns from 'node:dns/promises';
import net from 'node:net';

export interface MediaSize { keyword: string; widthMm: number; heightMm: number }
export interface MediaCol { widthMm: number; heightMm: number; topMm: number; bottomMm: number; leftMm: number; rightMm: number; type?: string; source?: string }

export interface IppCaps {
  formats: string[];
  preferredFormat?: string;
  media: MediaSize[];
  customRange?: { minW: number; maxW: number; minH: number; maxH: number };
  mediaDefault?: string;
  mediaReady: string[];
  mediaTypes: string[];
  mediaSources: string[];
  /** Margin sets per size, in mm. A set of all zeros means borderless is available. */
  mediaCols: MediaCol[];
  sides: string[];
  color: boolean;
  colorModes: string[];
  qualities: number[];
  resolutions: number[];
  rasterResolutions: number[];
  sheetBack?: string;
  operations: number[];
  creationAttrs: string[];
  urf: string[];
  /** Missing in caches written by older versions. */
  rasterTypes?: string[];
  scaling: string[];
}

export interface PrinterRecord {
  id: string;
  name: string;
  model?: string;
  uuid?: string;
  ipp?: { host: string; port: number; path: string; tls: boolean; tlsPin?: string; caps: IppCaps };
  raw?: { host: string; port: number; verified: boolean };
  queue?: { name: string; driver: string; port: string; caps?: WindowsQueue['caps']; isDefault: boolean; offline: boolean };
  virtual: boolean;
  manual?: boolean;
  lastSeen: number;
  lastUsed?: number;
}

const CACHE_FILE = 'printers.json';
const STALE_DROP_MS = 45 * 24 * 3600 * 1000;

// ---------- capabilities from IPP attributes ----------

function strings(a: IppAttrs, n: string): string[] {
  return (a[n] ?? []).filter((v): v is string => typeof v === 'string').slice(0, 300).map(v => deviceText(v));
}
function numbers(a: IppAttrs, n: string): number[] { return (a[n] ?? []).filter((v): v is number => typeof v === 'number'); }

export function parseMediaKeyword(keyword: string): MediaSize | null {
  const m = /_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|in)$/.exec(keyword);
  if (!m) return null;
  const k = m[3] === 'in' ? 25.4 : 1;
  return { keyword, widthMm: Math.round(+m[1] * k * 100) / 100, heightMm: Math.round(+m[2] * k * 100) / 100 };
}

function memberNumber(c: IppCollection, name: string): number | undefined {
  const v = c[name];
  return typeof v === 'number' ? v : undefined;
}

export function parseMediaCol(v: IppValue): MediaCol | null {
  if (typeof v !== 'object' || v === null || !('media-size' in v)) return null;
  const c = v as IppCollection;
  const size = c['media-size'] as IppCollection;
  const w = memberNumber(size, 'x-dimension'), h = memberNumber(size, 'y-dimension');
  if (w === undefined || h === undefined) return null;
  const mm = (name: string) => (memberNumber(c, name) ?? 0) / 100;
  return {
    widthMm: w / 100, heightMm: h / 100, topMm: mm('media-top-margin'), bottomMm: mm('media-bottom-margin'),
    leftMm: mm('media-left-margin'), rightMm: mm('media-right-margin'),
    type: typeof c['media-type'] === 'string' ? c['media-type'] as string : undefined,
    source: typeof c['media-source'] === 'string' ? c['media-source'] as string : undefined,
  };
}

export function capsFromAttributes(a: IppAttrs): IppCaps {
  const keywords = strings(a, 'media-supported');
  const min = keywords.map(k => k.startsWith('custom_min_') ? parseMediaKeyword(k) : null).find(Boolean);
  const max = keywords.map(k => k.startsWith('custom_max_') ? parseMediaKeyword(k) : null).find(Boolean);
  const media = keywords.filter(k => !k.startsWith('custom_')).map(parseMediaKeyword).filter((m): m is MediaSize => !!m);
  const seenCol = new Set<string>();
  const mediaCols: MediaCol[] = [];
  for (const v of [...(a['media-col-database'] ?? []), ...(a['media-col-ready'] ?? [])]) {
    const c = parseMediaCol(v);
    if (!c) continue;
    const key = `${c.widthMm}x${c.heightMm}/${c.topMm}/${c.bottomMm}/${c.leftMm}/${c.rightMm}`;
    if (seenCol.has(key)) continue;
    seenCol.add(key);
    mediaCols.push({ widthMm: c.widthMm, heightMm: c.heightMm, topMm: c.topMm, bottomMm: c.bottomMm, leftMm: c.leftMm, rightMm: c.rightMm });
  }
  const res = (name: string) => (a[name] ?? []).flatMap(v => typeof v === 'object' && v !== null && 'x' in v ? [(v as { x: number }).x] : []);
  return {
    formats: strings(a, 'document-format-supported'),
    preferredFormat: strings(a, 'document-format-preferred')[0],
    media,
    customRange: min && max ? { minW: min.widthMm, minH: min.heightMm, maxW: max.widthMm, maxH: max.heightMm } : undefined,
    mediaDefault: strings(a, 'media-default')[0],
    mediaReady: strings(a, 'media-ready'),
    mediaTypes: strings(a, 'media-type-supported'),
    mediaSources: strings(a, 'media-source-supported'),
    mediaCols,
    sides: strings(a, 'sides-supported'),
    color: a['color-supported']?.[0] === true || strings(a, 'print-color-mode-supported').includes('color'),
    colorModes: strings(a, 'print-color-mode-supported'),
    qualities: numbers(a, 'print-quality-supported'),
    resolutions: res('printer-resolution-supported'),
    rasterResolutions: res('pwg-raster-document-resolution-supported'),
    sheetBack: strings(a, 'pwg-raster-document-sheet-back')[0],
    operations: numbers(a, 'operations-supported'),
    creationAttrs: strings(a, 'job-creation-attributes-supported'),
    urf: strings(a, 'urf-supported'),
    rasterTypes: strings(a, 'pwg-raster-document-type-supported'),
    scaling: strings(a, 'print-scaling-supported'),
  };
}

// ---------- registry ----------

/** Text from a LAN device goes straight into an AI's context, so keep it short and printable. */
function clean(s: string | undefined): string | undefined {
  return deviceText(s) || undefined;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/\bprinter\b/g, '').replace(/[^a-z0-9\u0E01-\u0E59]+/g, '-').replace(/^-+|-+$/g, '') || 'printer';
}

export function normalizeUuid(u: string | undefined): string | undefined {
  const m = u?.toLowerCase().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  return m?.[0];
}

export function ippTarget(p: PrinterRecord): IppTarget | null {
  if (!p.ipp) return null;
  const { host, port, path, tls, tlsPin } = p.ipp;
  return {
    host, port, path, tls, tlsPin,
    onTlsFingerprint: fp => { registry.pinCertificate(p.id, fp); },
  };
}

export class Registry {
  printers: PrinterRecord[] = [];
  config: Config = loadConfig();
  lastDiscovery = 0;
  private inflight: Promise<void> | null = null;

  constructor() {
    const cached = readJson<{ printers?: PrinterRecord[]; at?: number }>(CACHE_FILE, {});
    this.printers = Array.isArray(cached.printers) ? cached.printers : [];
    this.lastDiscovery = cached.at ?? 0;
  }

  reloadConfig(): Config { this.config = loadConfig(); return this.config; }
  saveConfig(): void { saveConfig(this.config); }

  private persist(): void {
    try {
      writeJson(CACHE_FILE, { at: this.lastDiscovery, printers: this.printers });
    } catch (e) {
      // The in-memory list still works for this session.
      console.error('print-mcp: could not save printer cache:', e);
    }
  }

  pinCertificate(id: string, fingerprint: string): void {
    const p = this.printers.find(x => x.id === id);
    if (p?.ipp && !p.ipp.tlsPin) { p.ipp.tlsPin = fingerprint; this.persist(); }
  }

  /** Concurrent callers share one scan. */
  refresh(): Promise<void> {
    this.inflight ??= this.discover().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  whenReady(): Promise<void> {
    if (this.printers.length === 0) return this.refresh();
    return Promise.resolve();
  }

  private knownQueues(): WindowsQueue[] {
    return this.printers.flatMap(p => p.queue ? [{
      name: p.queue.name, driver: p.queue.driver, port: p.queue.port, uuid: p.uuid, host: p.ipp?.host,
      isDefault: p.queue.isDefault, offline: p.queue.offline, shared: false, virtual: p.virtual, caps: p.queue.caps,
    }] : []);
  }

  private async discover(): Promise<void> {
    this.reloadConfig();
    const started = Date.now();
    const [mdns, sweep, queues] = await Promise.all([
      browseMdns().catch(e => { console.error('print-mcp: mDNS failed:', e); return [] as MdnsService[]; }),
      this.config.subnetSweep ? sweepSubnets().catch(e => { console.error('print-mcp: sweep failed:', e); return []; }) : Promise.resolve([]),
      // A hiccup in the spooler must not make every USB printer vanish: fall back to what we knew.
      listWindowsQueues().catch(e => { console.error('print-mcp: Windows queues failed:', e); return this.knownQueues(); }),
    ]);

    const found: PrinterRecord[] = [];
    const now = Date.now();
    const byHost = new Map<string, PrinterRecord>();
    const adopt = (host: string, target: IppTarget, a: IppAttrs, fallbackName: string, txtUuid?: string): void => {
      const uuid = normalizeUuid(strings(a, 'printer-uuid')[0]) ?? normalizeUuid(txtUuid);
      const model = clean(strings(a, 'printer-make-and-model')[0]);
      const rec: PrinterRecord = {
        id: '', name: clean(strings(a, 'printer-dns-sd-name')[0]) ?? clean(fallbackName) ?? model ?? host, model, uuid,
        ipp: { host, port: target.port, path: target.path, tls: target.tls, caps: capsFromAttributes(a) },
        virtual: false, lastSeen: now,
      };
      found.push(rec);
      byHost.set(host, rec);
    };

    // mDNS, with TLS tried first so an encrypted route always wins over a plain one. One host
    // may serve several queues (a CUPS box), so identity here is host plus path, never host alone.
    const seenQueues = new Set<string>();
    for (const type of ['ipps', 'ipp'] as const) {
      await Promise.all(mdns.filter(s => s.type === type).map(async s => {
        const host = s.addresses[0];
        if (!host || !isPrivateIpv4(host)) return;
        const rp = s.txt.rp ? `/${s.txt.rp.replace(/^\/+/, '')}` : undefined;
        const key = `${host}${rp ?? ''}`;
        if (seenQueues.has(key)) return;
        seenQueues.add(key);
        try {
          const got = await probeIppPath(host, s.port, type === 'ipps', rp);
          if (got) adopt(host, got.target, got.response.printer, s.instance, s.txt.uuid);
        } catch (e) {
          console.error(`print-mcp: IPP probe of ${host} failed:`, e);
        }
      }));
    }

    // Sweep: only hosts mDNS missed.
    await Promise.all(sweep.filter(h => !byHost.has(h.host)).map(async h => {
      try {
        const got = h.ports.includes(631) ? await probeIppPath(h.host, 631, false) : h.ports.includes(443) ? await probeIppPath(h.host, 443, true) : null;
        if (got) { adopt(h.host, got.target, got.response.printer, h.host); return; }
      } catch (e) {
        console.error(`print-mcp: IPP probe of ${h.host} failed:`, e);
      }
      if (h.ports.includes(9100)) {
        const snmp = await snmpIdentify(h.host);
        // An unverified 9100 port stays listed but is never auto-selected.
        const rec: PrinterRecord = {
          id: '', name: clean(snmp?.description) ?? `Raw device ${h.host}`, model: clean(snmp?.description),
          raw: { host: h.host, port: 9100, verified: !!snmp?.isPrinter }, virtual: false, lastSeen: now,
        };
        found.push(rec);
        byHost.set(h.host, rec);
      }
    }));

    // Manually added hosts survive even when multicast and sweeping are blocked.
    await Promise.all(this.config.manualHosts.filter(h => !byHost.has(h)).map(async h => {
      const got = await probeIppPath(h, 631, false).catch(() => null);
      if (got) adopt(h, got.target, got.response.printer, h);
      else if (await tcpOpen(h, 9100)) {
        const rec: PrinterRecord = { id: '', name: `Raw device ${h}`, raw: { host: h, port: 9100, verified: true }, virtual: false, manual: true, lastSeen: now };
        found.push(rec);
        byHost.set(h, rec);
      }
    }));

    // Attach raw port info advertised over mDNS.
    for (const s of mdns) if (s.type === 'raw') {
      const rec = byHost.get(s.addresses[0]);
      if (rec && !rec.raw) rec.raw = { host: s.addresses[0], port: s.port, verified: true };
    }

    // Windows queues: merge onto the network printer by exact UUID or host, never by name alone,
    // because two identical models (one USB, one Wi-Fi) must stay separate printers.
    for (const q of queues) {
      const queue = { name: q.name, driver: q.driver, port: q.port, caps: q.caps, isDefault: q.isDefault, offline: q.offline };
      const uuid = normalizeUuid(q.uuid);
      const match = (uuid && found.find(f => f.uuid === uuid)) || (q.host && byHost.get(q.host)) || undefined;
      if (match && !match.queue) { match.queue = queue; continue; }
      found.push({ id: '', name: clean(q.name)!, model: clean(q.driver), uuid, queue, virtual: q.virtual, lastSeen: now });
    }

    // Keep printers that are asleep right now, so printing can still try them and report clearly.
    const merged = [...found];
    for (const old of this.printers) {
      const same = merged.find(f => {
        if (f.uuid && old.uuid) return f.uuid === old.uuid;
        if (old.queue && f.queue?.name === old.queue.name) return true;
        return !!old.ipp && f.ipp?.host === old.ipp.host && f.ipp.port === old.ipp.port && f.ipp.path === old.ipp.path;
      });
      if (same) {
        same.id = old.id;
        same.lastUsed = old.lastUsed;
        if (same.ipp && old.ipp?.tlsPin) {
          // A moved printer keeps its pin, and a pinned printer never silently falls back to
          // plain IPP: a LAN attacker blocking the TLS port must not get documents in clear text.
          same.ipp.tlsPin = old.ipp.tlsPin;
          if (!same.ipp.tls) { same.ipp.tls = true; same.ipp.port = old.ipp.port; same.ipp.path = old.ipp.path; }
        }
      } else if (now - old.lastSeen < STALE_DROP_MS && !old.queue) {
        merged.push(old);
      }
    }
    const used = new Set(merged.map(p => p.id).filter(Boolean));
    for (const p of merged) {
      if (p.id) continue;
      const base = slug(p.model && !p.queue?.driver ? p.model : p.name);
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      p.id = id;
    }
    this.printers = merged;
    this.lastDiscovery = now;
    this.persist();
    console.error(`print-mcp: discovery ${Date.now() - started} ms, ${merged.length} printers`);
  }

  visible(): PrinterRecord[] {
    return this.printers.filter(p => !this.config.hidden.includes(p.id));
  }

  touch(p: PrinterRecord): void {
    p.lastUsed = Date.now();
    this.persist();
  }

  /** Quick liveness check that also refreshes capabilities (paper loaded can change). */
  async isOnline(p: PrinterRecord, timeoutMs = 1200): Promise<boolean> {
    if (p.ipp) {
      try {
        const res = await getPrinterAttributes(ippTarget(p)!, timeoutMs, ['printer-state']);
        return !!res.printer['printer-state'];
      } catch {
        return false;
      }
    }
    if (p.raw) return tcpOpen(p.raw.host, p.raw.port, timeoutMs);
    if (p.queue) return !p.queue.offline;
    return false;
  }

  findByQuery(query: string): PrinterRecord[] {
    const q = query.trim().toLowerCase();
    const list = this.visible();
    const aliasTarget = this.config.aliases[q];
    if (aliasTarget) {
      const hit = list.find(p => p.id === aliasTarget);
      if (hit) return [hit];
    }
    const exact = list.filter(p => [p.id, p.name, p.model, p.queue?.name, p.ipp?.host, p.raw?.host].some(v => v?.toLowerCase() === q));
    if (exact.length) return exact;
    const tokens = q.split(/[\s_-]+/).filter(Boolean);
    return list.filter(p => {
      const hay = [p.id, p.name, p.model, p.queue?.name, p.ipp?.host, p.raw?.host, ...Object.entries(this.config.aliases).filter(([, v]) => v === p.id).map(([k]) => k)].join(' ').toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  /**
   * Picks the printer so the AI never has to ask when the answer is knowable:
   * explicit query > hard requirements > the only printer > the only one online >
   * saved default > Windows default > most recently used > only then ask.
   */
  async resolve(query: string | undefined, needs: { color?: boolean; duplex?: boolean } = {}): Promise<{ printer: PrinterRecord; reason: string }> {
    await this.whenReady();
    if (query) {
      let hits = this.findByQuery(query);
      if (!hits.length) { await this.refresh(); hits = this.findByQuery(query); }
      if (hits.length === 1) return { printer: hits[0], reason: 'requested' };
      if (hits.length > 1) throw new AmbiguousPrinter(`"${query}" matches several printers.`, hits);
      throw new Error(`No printer matches "${query}". Known: ${this.visible().map(p => p.name).join(', ') || 'none'}`);
    }
    const physical = () => this.visible().filter(p => !p.virtual && (p.ipp || p.queue || p.raw?.verified));
    let pool = physical();
    if (!pool.length) {
      await this.refresh();
      pool = physical();
    }
    if (!pool.length) {
      const virt = this.visible().filter(p => p.virtual).map(p => p.name);
      throw new Error(`No physical printer found on this PC or its LAN. Call fix_printer to find out why.${virt.length ? ` Virtual queues available by name: ${virt.join(', ')}` : ''}`);
    }
    const capable = pool.filter(p => (!needs.color || supportsColor(p)) && (!needs.duplex || supportsDuplex(p)));
    const narrowedByNeed = capable.length > 0 && capable.length < pool.length;
    if (capable.length) pool = capable;
    if (pool.length === 1) return { printer: pool[0], reason: narrowedByNeed ? 'only printer with the requested color/duplex capability' : 'only printer' };

    const online = (await Promise.all(pool.map(async p => [p, await this.isOnline(p)] as const))).filter(([, up]) => up).map(([p]) => p);
    if (online.length === 1) return { printer: online[0], reason: 'only printer online' };
    const live = online.length ? online : pool;

    const saved = this.config.defaultPrinter;
    const savedHit = saved && live.find(p => p.id === saved);
    if (savedHit) return { printer: savedHit, reason: 'your saved default' };
    const winDefault = live.find(p => p.queue?.isDefault);
    if (winDefault) return { printer: winDefault, reason: 'Windows default printer' };
    const recent = live.filter(p => p.lastUsed).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))[0];
    if (recent) return { printer: recent, reason: 'most recently used' };
    throw new AmbiguousPrinter('Several printers are available and none is marked default.', live);
  }

  /** Called when the cached address stopped answering: the UUID finds it again. */
  async relocate(p: PrinterRecord): Promise<PrinterRecord | null> {
    const before = p.id;
    await this.refresh();
    const now = this.printers.find(x => x.id === before);
    if (now && (await this.isOnline(now, 1500))) return now;
    return null;
  }

  async addManualHost(host: string): Promise<void> {
    let ip = host;
    if (!net.isIP(host)) {
      const r = await dns.lookup(host, { family: 4 });
      ip = r.address;
    }
    // Plain IPP carries documents unencrypted, so this tool refuses to reach beyond the LAN.
    if (!isPrivateIpv4(ip)) throw new Error(`${host} (${ip}) is not a private LAN address; refusing to send documents over the internet.`);
    if (!this.config.manualHosts.includes(ip)) this.config.manualHosts.push(ip);
    this.saveConfig();
    await this.refresh();
  }
}

export class AmbiguousPrinter extends Error {
  constructor(message: string, readonly candidates: PrinterRecord[]) { super(message); }
}

export function supportsColor(p: PrinterRecord): boolean {
  return p.ipp?.caps.color ?? p.queue?.caps?.color ?? false;
}

export function supportsDuplex(p: PrinterRecord): boolean {
  return p.ipp ? p.ipp.caps.sides.some(s => s.startsWith('two-sided')) : p.queue?.caps?.duplex ?? false;
}

export const registry = new Registry();
