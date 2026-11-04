// Minimal, bounds-checked IPP/2.0 client (RFC 8010/8011). Printers on a LAN are
// untrusted peers, so the decoder treats every length field as hostile.
import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';

export const OP = {
  PrintJob: 0x0002,
  ValidateJob: 0x0004,
  CreateJob: 0x0005,
  SendDocument: 0x0006,
  CancelJob: 0x0008,
  GetJobAttributes: 0x0009,
  GetJobs: 0x000a,
  GetPrinterAttributes: 0x000b,
  IdentifyPrinter: 0x003c,
} as const;

const TAG = {
  operation: 0x01, job: 0x02, end: 0x03, printer: 0x04, unsupported: 0x05,
  integer: 0x21, boolean: 0x22, enum: 0x23, octet: 0x30, dateTime: 0x31,
  resolution: 0x32, range: 0x33, begCollection: 0x34, textLang: 0x35, nameLang: 0x36,
  endCollection: 0x37, text: 0x41, name: 0x42, keyword: 0x44, uri: 0x45, uriScheme: 0x46,
  charset: 0x47, language: 0x48, mimeType: 0x49, memberName: 0x4a,
} as const;

export type IppValue = string | number | boolean | null | IppRange | IppResolution | IppCollection;
export interface IppRange { lower: number; upper: number }
export interface IppResolution { x: number; y: number; unit: 'dpi' | 'dpcm' }
export interface IppCollection { [member: string]: IppValue | IppValue[] }
export type IppAttrs = Record<string, IppValue[]>;

export interface IppResponse {
  version: string;
  status: number;
  requestId: number;
  operation: IppAttrs;
  printer: IppAttrs;
  jobs: IppAttrs[];
  unsupported: IppAttrs;
}

// ---------- attribute builders ----------

export interface OutAttr { name: string; tag: number; values: (string | number | boolean | OutAttr[] | IppResolution)[] }

export const kw = (name: string, ...values: string[]): OutAttr => ({ name, tag: TAG.keyword, values });
export const nameAttr = (name: string, value: string): OutAttr => ({ name, tag: TAG.name, values: [value] });
export const uriAttr = (name: string, value: string): OutAttr => ({ name, tag: TAG.uri, values: [value] });
export const mime = (name: string, value: string): OutAttr => ({ name, tag: TAG.mimeType, values: [value] });
export const int = (name: string, value: number): OutAttr => ({ name, tag: TAG.integer, values: [value] });
export const enumAttr = (name: string, value: number): OutAttr => ({ name, tag: TAG.enum, values: [value] });
export const bool = (name: string, value: boolean): OutAttr => ({ name, tag: TAG.boolean, values: [value] });
export const resolution = (name: string, x: number, y = x): OutAttr => ({ name, tag: TAG.resolution, values: [{ x, y, unit: 'dpi' }] });
export const col = (name: string, members: OutAttr[]): OutAttr => ({ name, tag: TAG.begCollection, values: [members] });

function str(buf: string): Buffer { return Buffer.from(buf, 'utf8'); }

function encodeValue(tag: number, name: string, value: OutAttr['values'][number], out: Buffer[]): void {
  const nameBuf = str(name);
  const head = (valueLen: number) => {
    const h = Buffer.alloc(3 + nameBuf.length + 2);
    h[0] = tag;
    h.writeUInt16BE(nameBuf.length, 1);
    nameBuf.copy(h, 3);
    h.writeUInt16BE(valueLen, 3 + nameBuf.length);
    out.push(h);
  };
  if (tag === TAG.begCollection) {
    head(0);
    for (const member of value as OutAttr[]) {
      const memberName = str(member.name);
      const m = Buffer.alloc(5 + memberName.length);
      m[0] = TAG.memberName;
      m.writeUInt16BE(memberName.length, 3);
      memberName.copy(m, 5);
      out.push(m);
      member.values.forEach(v => encodeValue(member.tag, '', v, out));
    }
    out.push(Buffer.from([TAG.endCollection, 0, 0, 0, 0]));
    return;
  }
  if (tag === TAG.integer || tag === TAG.enum) {
    head(4);
    const v = Buffer.alloc(4);
    v.writeInt32BE(value as number);
    out.push(v);
    return;
  }
  if (tag === TAG.boolean) { head(1); out.push(Buffer.from([value ? 1 : 0])); return; }
  if (tag === TAG.resolution) {
    const r = value as IppResolution;
    head(9);
    const v = Buffer.alloc(9);
    v.writeInt32BE(r.x, 0);
    v.writeInt32BE(r.y, 4);
    v[8] = r.unit === 'dpi' ? 3 : 4;
    out.push(v);
    return;
  }
  const v = str(String(value));
  if (v.length > 0xffff) throw new Error(`IPP value too long for ${name}`);
  head(v.length);
  out.push(v);
}

export function encodeRequest(op: number, requestId: number, printerUri: string, operationAttrs: OutAttr[], jobAttrs: OutAttr[] = []): Buffer {
  const out: Buffer[] = [Buffer.from([2, 0, op >> 8, op & 0xff, (requestId >>> 24) & 0xff, (requestId >>> 16) & 0xff, (requestId >>> 8) & 0xff, requestId & 0xff]), Buffer.from([TAG.operation])];
  const put = (a: OutAttr) => a.values.forEach((v, i) => encodeValue(a.tag, i === 0 ? a.name : '', v, out));
  put({ name: 'attributes-charset', tag: TAG.charset, values: ['utf-8'] });
  put({ name: 'attributes-natural-language', tag: TAG.language, values: ['en'] });
  put(uriAttr('printer-uri', printerUri));
  operationAttrs.forEach(put);
  if (jobAttrs.length) {
    out.push(Buffer.from([TAG.job]));
    jobAttrs.forEach(put);
  }
  out.push(Buffer.from([TAG.end]));
  return Buffer.concat(out);
}

// ---------- decoder ----------

const MAX_ATTRS = 20000;
const MAX_DEPTH = 8;

class Reader {
  o = 8;
  count = 0;
  constructor(readonly b: Buffer) {}
  need(n: number): void { if (n < 0 || this.o + n > this.b.length) throw new Error('truncated IPP message'); }
  u8(): number { this.need(1); return this.b[this.o++]; }
  u16(): number { this.need(2); const v = this.b.readUInt16BE(this.o); this.o += 2; return v; }
  bytes(n: number): Buffer { this.need(n); const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
}

function decodeValue(tag: number, raw: Buffer): IppValue {
  switch (tag) {
    case TAG.integer:
    case TAG.enum:
      return raw.length === 4 ? raw.readInt32BE(0) : null;
    case TAG.boolean:
      return raw.length === 1 ? raw[0] !== 0 : null;
    case TAG.resolution:
      return raw.length === 9 ? { x: raw.readInt32BE(0), y: raw.readInt32BE(4), unit: raw[8] === 4 ? 'dpcm' : 'dpi' } : null;
    case TAG.range:
      return raw.length === 8 ? { lower: raw.readInt32BE(0), upper: raw.readInt32BE(4) } : null;
    case TAG.octet:
      // Brother and friends stuff "key=value;" text here (printer-input-tray etc.)
      return raw.toString('latin1');
    case TAG.dateTime:
      return raw.toString('hex');
    case TAG.textLang:
    case TAG.nameLang: {
      if (raw.length < 4) return null;
      const langLen = raw.readUInt16BE(0);
      if (2 + langLen + 2 > raw.length) return null;
      const textLen = raw.readUInt16BE(2 + langLen);
      if (2 + langLen + 2 + textLen > raw.length) return null;
      return raw.toString('utf8', 2 + langLen + 2, 2 + langLen + 2 + textLen);
    }
    default:
      if (tag < 0x20) return null; // out-of-band: no-value, unknown, unsupported
      if (tag >= 0x40) return raw.toString('utf8');
      return raw.toString('hex');
  }
}

function decodeCollection(r: Reader, depth: number): IppCollection {
  if (depth > MAX_DEPTH) throw new Error('IPP collection nested too deeply');
  const res: IppCollection = Object.create(null);
  let member = '';
  for (;;) {
    if (++r.count > MAX_ATTRS) throw new Error('IPP response has too many attributes');
    const tag = r.u8();
    const nameLen = r.u16();
    r.bytes(nameLen);
    const valueLen = r.u16();
    const raw = r.bytes(valueLen);
    if (tag === TAG.endCollection) return res;
    if (tag === TAG.memberName) { member = raw.toString('utf8'); continue; }
    const value = tag === TAG.begCollection ? decodeCollection(r, depth + 1) : decodeValue(tag, raw);
    if (!member) continue;
    const existing = res[member];
    if (existing === undefined) res[member] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else res[member] = [existing, value];
  }
}

export function decodeResponse(b: Buffer): IppResponse {
  if (b.length < 9) throw new Error('truncated IPP message');
  const res: IppResponse = {
    version: `${b[0]}.${b[1]}`, status: b.readUInt16BE(2), requestId: b.readUInt32BE(4),
    operation: Object.create(null), printer: Object.create(null), jobs: [], unsupported: Object.create(null),
  };
  const r = new Reader(b);
  let group: IppAttrs = res.operation;
  let last = '';
  for (;;) {
    const tag = r.u8();
    if (tag === TAG.end) return res;
    if (tag < 0x10) {
      last = '';
      if (tag === TAG.operation) group = res.operation;
      else if (tag === TAG.printer) group = res.printer;
      else if (tag === TAG.unsupported) group = res.unsupported;
      else if (tag === TAG.job) { group = Object.create(null); res.jobs.push(group); }
      else group = Object.create(null);
      continue;
    }
    if (++r.count > MAX_ATTRS) throw new Error('IPP response has too many attributes');
    const nameLen = r.u16();
    const name = r.bytes(nameLen).toString('utf8');
    const valueLen = r.u16();
    const raw = r.bytes(valueLen);
    const value = tag === TAG.begCollection ? decodeCollection(r, 1) : decodeValue(tag, raw);
    if (name) { last = name; (group[name] ??= []).push(value); }
    else if (last) group[last].push(value);
  }
}

// ---------- status ----------

export function statusOk(status: number): boolean { return status < 0x0100; }

const STATUS_NAMES: Record<number, string> = {
  0x0400: 'bad request', 0x0401: 'forbidden', 0x0402: 'not authenticated', 0x0403: 'not authorized',
  0x0404: 'not possible', 0x0405: 'timeout', 0x0406: 'not found', 0x0407: 'gone', 0x0408: 'request too large',
  0x040a: 'document format not supported', 0x040b: 'attributes or values not supported', 0x040c: 'uri scheme not supported',
  0x040e: 'conflicting attributes', 0x0500: 'printer internal error', 0x0501: 'operation not supported',
  0x0502: 'service unavailable', 0x0503: 'version not supported', 0x0504: 'device error', 0x0505: 'temporary error',
  0x0506: 'not accepting jobs', 0x0507: 'printer busy', 0x0508: 'job canceled',
};

/**
 * Text from a LAN device ends up in an AI's context, where a hostile printer could try to
 * talk to it. Keep every such string short and printable.
 */
export function deviceText(s: unknown, max = 120): string {
  return typeof s === 'string' ? s.replace(/\p{Cc}/gu, ' ').trim().slice(0, max) : '';
}

export class IppError extends Error {
  constructor(readonly status: number, detail?: string) {
    const safe = deviceText(detail);
    super(`printer refused: ${STATUS_NAMES[status] ?? '0x' + status.toString(16)}${safe ? ` (${safe})` : ''}`);
  }
  get transient(): boolean { return this.status === 0x0507 || this.status === 0x0505 || this.status === 0x0502; }
}

export function firstString(attrs: IppAttrs, name: string): string | undefined {
  const v = attrs[name]?.[0];
  return typeof v === 'string' ? v : undefined;
}

// ---------- transport ----------

export interface IppTarget {
  host: string;
  port: number;
  path: string;
  tls: boolean;
  /** Trust-on-first-use SHA-256 pin of the printer's (normally self-signed) certificate. */
  tlsPin?: string;
  onTlsFingerprint?: (fingerprint: string) => void;
}

// No keep-alive: printers drop idle sockets without warning, and a job sent down a dead
// socket cannot be retried safely. A LAN handshake costs a couple of milliseconds.
const httpAgent = new http.Agent({ keepAlive: false });
// Printers ship self-signed certificates no CA can vouch for. Identity comes from the
// trust-on-first-use pin checked below, before any data is written.
const httpsAgent = new https.Agent({ keepAlive: false, rejectUnauthorized: false });
const MAX_RESPONSE = 8 * 1024 * 1024;
/** Long enough for a paper-out wait or a slow photo page; short enough that a dead printer frees the queue. */
const STALL_TIMEOUT_MS = 30 * 60 * 1000;
let nextRequestId = (Date.now() & 0xfffff) + 1;

export function targetUri(t: IppTarget): string {
  const host = t.host.includes(':') ? `[${t.host}]` : t.host;
  return `${t.tls ? 'ipps' : 'ipp'}://${host}:${t.port}${t.path}`;
}

export interface SendOptions {
  /** Time allowed to connect and, for bodyless requests, to get the whole answer. */
  timeoutMs?: number;
  body?: AsyncIterable<Buffer>;
  signal?: AbortSignal;
}

export async function ippCall(t: IppTarget, op: number, operationAttrs: OutAttr[] = [], jobAttrs: OutAttr[] = [], opts: SendOptions = {}): Promise<IppResponse> {
  const header = encodeRequest(op, nextRequestId++, targetUri(t), operationAttrs, jobAttrs);
  const timeoutMs = opts.timeoutMs ?? 4000;
  const body = opts.body;

  return new Promise<IppResponse>((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, value?: IppResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      opts.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err); else resolve(value!);
    };
    const onAbort = () => { req.destroy(new Error('canceled')); };
    const mod = t.tls ? https : http;
    const reqOpts: http.RequestOptions = {
      host: t.host, port: t.port, path: t.path, method: 'POST',
      agent: t.tls ? httpsAgent : httpAgent,
      headers: { 'Content-Type': 'application/ipp', ...(body ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': header.length }) },
    };
    const req = mod.request(reqOpts, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (d: Buffer) => {
        size += d.length;
        if (size > MAX_RESPONSE) { req.destroy(new Error('IPP response too large')); return; }
        chunks.push(d);
      });
      res.on('error', e => finish(e));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const code = res.statusCode ?? 0;
          const hint = code === 401 ? 'printer requires a login; set up its web admin or use the Windows queue' : code === 426 ? 'printer requires TLS' : '';
          return finish(Object.assign(new Error(`HTTP ${code} from printer${hint ? `: ${hint}` : ''}`), { httpStatus: code }));
        }
        try {
          const decoded = decodeResponse(Buffer.concat(chunks));
          if (!statusOk(decoded.status)) return finish(new IppError(decoded.status, firstString(decoded.operation, 'status-message')));
          finish(null, decoded);
        } catch (e) {
          finish(e as Error);
        }
      });
    });
    // A long print legitimately stalls the socket (TCP backpressure while the head moves),
    // so the hard deadline only guards the connect phase when a body is being streamed.
    const deadline = setTimeout(() => req.destroy(Object.assign(new Error('printer did not respond in time'), { code: 'ETIMEDOUT' })), timeoutMs);
    req.on('error', e => finish(e));
    req.setTimeout(STALL_TIMEOUT_MS, () => req.destroy(new Error('printer stopped responding for 30 minutes')));
    // Nothing may be written before the pin check passes: Node buffers http writes, so the
    // document only leaves this machine once transmit() runs.
    const transmit = () => {
      if (!body) { req.end(header); return; }
      clearTimeout(deadline); // connected and trusted; from here only the stall timeout applies
      req.write(header);
      (async () => {
        for await (const chunk of body) {
          if (settled || req.destroyed) return;
          if (!req.write(chunk)) await new Promise<void>((ok, no) => {
            const onDrain = () => { req.off('close', onClose); ok(); };
            const onClose = () => { req.off('drain', onDrain); no(new Error('printer closed the connection while receiving data')); };
            req.once('drain', onDrain);
            req.once('close', onClose);
          });
        }
        req.end();
      })().catch(e => req.destroy(e as Error));
    };
    req.on('socket', sock => {
      if (!t.tls) { transmit(); return; }
      sock.once('secureConnect', () => {
        const fp = (sock as TLSSocket).getPeerCertificate?.()?.fingerprint256;
        if (!fp) { req.destroy(new Error('printer presented no TLS certificate')); return; }
        if (t.tlsPin && t.tlsPin !== fp) {
          req.destroy(new Error('printer TLS certificate changed since first use; refusing to send. If the printer was reset, run configure_printer with trust_new_certificate'));
          return;
        }
        if (!t.tlsPin) t.onTlsFingerprint?.(fp);
        transmit();
      });
    });
    if (opts.signal) {
      if (opts.signal.aborted) req.destroy(new Error('canceled'));
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

const CAPABILITY_ATTRS = ['all', 'media-col-database', 'media-col-ready'];

export function getPrinterAttributes(t: IppTarget, timeoutMs = 2500, requested: string[] = CAPABILITY_ATTRS): Promise<IppResponse> {
  return ippCall(t, OP.GetPrinterAttributes, [kw('requested-attributes', ...requested)], [], { timeoutMs });
}

const IPP_PATHS = ['/ipp/print', '/ipp/printer', '/ipp', '/printer', '/'];

/** Sweep discovery knows only host and port; IPP paths vary by vendor. */
export async function probeIppPath(host: string, port: number, tls: boolean, preferred?: string): Promise<{ target: IppTarget; response: IppResponse } | null> {
  const paths = preferred ? [preferred, ...IPP_PATHS.filter(p => p !== preferred)] : IPP_PATHS;
  for (const path of paths) {
    const target: IppTarget = { host, port, path, tls };
    try {
      const response = await getPrinterAttributes(target, 2000);
      if (response.printer['printer-uri-supported'] || response.printer['printer-name']) return { target, response };
    } catch (e) {
      const code = (e as { code?: string }).code;
      // A dead socket will not answer on any other path either.
      if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') return null;
    }
  }
  return null;
}
