// An in-process IPP printer. Lets the suite verify real protocol traffic and the exact
// pixels sent, with no paper and no hardware.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeResponse, type IppAttrs } from '../ipp.js';

export interface MockOptions {
  formats?: string[];
  preferred?: string;
  sides?: string[];
  sheetBack?: string;
  urf?: string[];
  ops?: number[];
  accepting?: boolean;
  reasons?: string[];
  markers?: { names: string[]; levels: number[]; low: number[] };
  name?: string;
  uuid?: string;
  busyTimes?: number;
  failSendWith?: number;
  creationAttrs?: string[];
  stateMessage?: string;
}

export interface ReceivedJob {
  id: number;
  attributes: IppAttrs;
  operation: IppAttrs;
  format: string;
  document: Buffer;
  name: string;
}

const TAG = { op: 1, job: 2, end: 3, printer: 4 } as const;

function attr(tag: number, name: string, value: Buffer): Buffer {
  const n = Buffer.from(name);
  const h = Buffer.alloc(5 + n.length);
  h[0] = tag;
  h.writeUInt16BE(n.length, 1);
  n.copy(h, 3);
  h.writeUInt16BE(value.length, 3 + n.length);
  return Buffer.concat([h, value]);
}
const text = (tag: number, name: string, ...values: string[]) => Buffer.concat(values.map((v, i) => attr(tag, i ? '' : name, Buffer.from(v))));
const kw = (name: string, ...v: string[]) => text(0x44, name, ...v);
const integer = (name: string, ...values: number[]) => Buffer.concat(values.map((v, i) => { const b = Buffer.alloc(4); b.writeInt32BE(v); return attr(0x21, i ? '' : name, b); }));
const enums = (name: string, ...values: number[]) => Buffer.concat(values.map((v, i) => { const b = Buffer.alloc(4); b.writeInt32BE(v); return attr(0x23, i ? '' : name, b); }));
const bool = (name: string, v: boolean) => attr(0x22, name, Buffer.from([v ? 1 : 0]));
const res = (name: string, ...values: number[]) => Buffer.concat(values.map((v, i) => { const b = Buffer.alloc(9); b.writeInt32BE(v, 0); b.writeInt32BE(v, 4); b[8] = 3; return attr(0x32, i ? '' : name, b); }));

function mediaCol(first: boolean, w: number, h: number, margin: number): Buffer {
  const member = (name: string, value: Buffer) => Buffer.concat([attr(0x4a, '', Buffer.from(name)), value]);
  const ival = (v: number) => { const b = Buffer.alloc(4); b.writeInt32BE(v); return attr(0x21, '', b); };
  const size = Buffer.concat([attr(0x34, '', Buffer.alloc(0)), member('x-dimension', ival(w)), member('y-dimension', ival(h)), attr(0x37, '', Buffer.alloc(0))]);
  return Buffer.concat([attr(0x34, first ? 'media-col-database' : '', Buffer.alloc(0)), member('media-size', size),
    member('media-top-margin', ival(margin)), member('media-bottom-margin', ival(margin)), member('media-left-margin', ival(margin)), member('media-right-margin', ival(margin)), attr(0x37, '', Buffer.alloc(0))]);
}

export class MockPrinter {
  jobs: ReceivedJob[] = [];
  requests: number[] = [];
  private server!: http.Server;
  private nextId = 100;
  private open = new Map<number, ReceivedJob>();
  private busyLeft: number;
  port = 0;
  canceled: number[] = [];
  onDocument?: () => void;

  constructor(readonly o: MockOptions = {}) { this.busyLeft = o.busyTimes ?? 0; }

  async start(): Promise<this> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', d => chunks.push(d));
      req.on('error', () => undefined);
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const reply = this.handle(body);
        res.writeHead(200, { 'Content-Type': 'application/ipp' });
        res.end(reply);
      });
    });
    await new Promise<void>(r => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise(r => this.server.close(() => r()));
  }

  private respond(status: number, requestId: number, ...groups: Buffer[]): Buffer {
    const h = Buffer.alloc(8);
    h[0] = 2;
    h.writeUInt16BE(status, 2);
    h.writeUInt32BE(requestId, 4);
    return Buffer.concat([h, Buffer.from([TAG.op]), text(0x47, 'attributes-charset', 'utf-8'), text(0x48, 'attributes-natural-language', 'en'), ...groups, Buffer.from([TAG.end])]);
  }

  /** Requests carry document bytes after the end-of-attributes tag, so find that boundary first. */
  private splitRequest(b: Buffer): { op: number; id: number; head: ReturnType<typeof decodeResponse>; doc: Buffer } {
    const op = b.readUInt16BE(2), id = b.readUInt32BE(4);
    let o = 8;
    for (;;) {
      const t = b[o++];
      if (t === TAG.end) break;
      if (t < 0x10) continue;
      const nl = b.readUInt16BE(o); o += 2 + nl;
      const vl = b.readUInt16BE(o); o += 2 + vl;
    }
    // decodeResponse reads the same wire format as a request for our purposes.
    return { op, id, head: decodeResponse(b.subarray(0, o)), doc: b.subarray(o) };
  }

  private jobGroup(id: number, state = 9): Buffer {
    return Buffer.concat([Buffer.from([TAG.job]), integer('job-id', id), enums('job-state', state), kw('job-state-reasons', 'none')]);
  }

  private printerGroup(): Buffer {
    const o = this.o;
    const formats = o.formats ?? ['application/octet-stream', 'image/urf', 'image/jpeg', 'image/pwg-raster'];
    const m = o.markers ?? { names: ['K'], levels: [80], low: [10] };
    return Buffer.concat([
      Buffer.from([TAG.printer]),
      text(0x45, 'printer-uri-supported', `ipp://127.0.0.1:${this.port}/ipp/print`),
      text(0x42, 'printer-name', o.name ?? 'Mock'), text(0x41, 'printer-make-and-model', o.name ?? 'Mock Printer'),
      text(0x45, 'printer-uuid', `urn:uuid:${o.uuid ?? '11111111-2222-3333-4444-555555555555'}`),
      enums('printer-state', 3), kw('printer-state-reasons', ...(o.reasons ?? ['none'])), bool('printer-is-accepting-jobs', o.accepting ?? true),
      integer('queued-job-count', 0), ...(o.stateMessage ? [text(0x41, 'printer-state-message', o.stateMessage)] : []),
      text(0x49, 'document-format-supported', ...formats), ...(o.preferred ? [text(0x49, 'document-format-preferred', o.preferred)] : []),
      kw('media-supported', 'iso_a4_210x297mm', 'iso_a5_148x210mm', 'na_letter_8.5x11in', 'custom_min_50x50mm', 'custom_max_300x500mm'),
      kw('media-default', 'iso_a4_210x297mm'), kw('media-ready', 'iso_a4_210x297mm'),
      kw('media-type-supported', 'stationery', 'photographic-glossy'), kw('media-source-supported', 'auto', 'main'),
      mediaCol(true, 21000, 29700, 300), mediaCol(false, 21000, 29700, 0), mediaCol(false, 14800, 21000, 300),
      kw('sides-supported', ...(o.sides ?? ['one-sided'])), bool('color-supported', true), kw('print-color-mode-supported', 'auto', 'color', 'monochrome'),
      enums('print-quality-supported', 3, 4, 5), res('printer-resolution-supported', 600), res('pwg-raster-document-resolution-supported', 300, 600),
      ...(o.sheetBack ? [kw('pwg-raster-document-sheet-back', o.sheetBack)] : []),
      enums('operations-supported', ...(o.ops ?? [2, 4, 5, 6, 8, 9, 10, 11])),
      kw('job-creation-attributes-supported', ...(o.creationAttrs ?? ['copies', 'media-col', 'media', 'print-quality', 'sides', 'print-color-mode', 'ipp-attribute-fidelity', 'job-name'])),
      kw('urf-supported', ...(o.urf ?? ['SRGB24', 'W8', 'CP1', 'RS300-600'])),
      text(0x42, 'marker-names', ...m.names), integer('marker-levels', ...m.levels), integer('marker-low-levels', ...m.low),
    ]);
  }

  private handle(b: Buffer): Buffer {
    const { op, id, head, doc } = this.splitRequest(b);
    this.requests.push(op);
    const format = (head.operation['document-format']?.[0] as string) ?? '';
    const name = (head.operation['job-name']?.[0] as string) ?? '';
    switch (op) {
      case 0x0b: return this.respond(0, id, this.printerGroup());
      case 0x05: { // Create-Job
        if (this.busyLeft > 0) { this.busyLeft--; return this.respond(0x0507, id); }
        const jobId = this.nextId++;
        this.open.set(jobId, { id: jobId, attributes: head.jobs[0] ?? {}, operation: head.operation, format: '', document: Buffer.alloc(0), name });
        return this.respond(0, id, this.jobGroup(jobId, 3));
      }
      case 0x06: { // Send-Document
        if (this.o.failSendWith) return this.respond(this.o.failSendWith, id);
        const jobId = head.operation['job-id']?.[0] as number;
        const job = this.open.get(jobId);
        if (!job) return this.respond(0x0406, id);
        job.format = format;
        job.document = Buffer.from(doc);
        this.jobs.push(job);
        this.onDocument?.();
        return this.respond(0, id, this.jobGroup(jobId, 5));
      }
      case 0x02: { // Print-Job
        const jobId = this.nextId++;
        this.jobs.push({ id: jobId, attributes: head.jobs[0] ?? {}, operation: head.operation, format, document: Buffer.from(doc), name });
        this.onDocument?.();
        return this.respond(0, id, this.jobGroup(jobId, 5));
      }
      case 0x09: return this.respond(0, id, this.jobGroup(head.operation['job-id']?.[0] as number, 9));
      case 0x0a: return this.respond(0, id);
      case 0x08: this.canceled.push(head.operation['job-id']?.[0] as number); return this.respond(0, id);
      default: return this.respond(0x0501, id);
    }
  }
}
