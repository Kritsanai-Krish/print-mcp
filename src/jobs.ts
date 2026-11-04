// The job engine: picks a route, streams pages while they render, and tracks every job.
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { OP, IppError, bool, col, deviceText, enumAttr, firstString, getPrinterAttributes, int, ippCall, kw, mime, nameAttr, type IppAttrs, type IppTarget, type OutAttr } from './ipp.js';
import { SCRIPTS_DIR, powerShellEnv, runPowerShell } from './discovery.js';
import { backTransform, flipSheet, grayToRgb, pclPage, pclPaperCode, pwgPage, PWG_SYNC, urfFileHeader, urfPage, type PageMeta, type Sheet, type SheetBack } from './raster.js';
import { computeLayout, firstPageIsLandscape, loadMupdf, renderSheets, sheetCount, sheetToJpeg, sheetToPng, type RenderInput } from './render.js';
import { ippTarget, registry, type PrinterRecord } from './registry.js';
import { makePlan, mergeOptions, needsPixelWork, selectPages, type JobPlan, type Margins, type PrintOptions } from './options.js';
import { assertLocalPathAllowed, openSource, type OpenDoc, type SourceInput } from './sources.js';
import { makeTempDir, readJson, removeDir, writeJson } from './state.js';

export type JobState = 'queued' | 'rendering' | 'sending' | 'printing' | 'completed' | 'failed' | 'canceled';
type Route = 'ipp' | 'spooler' | 'raw';

export interface JobRecord {
  id: string;
  printerId: string;
  printerName: string;
  name: string;
  route: Route;
  format: string;
  state: JobState;
  sheets: number;
  sentSheets: number;
  copies: number;
  createdAt: number;
  finishedAt?: number;
  ippJobId?: number;
  ippTarget?: { host: string; port: number; path: string; tls: boolean; tlsPin?: string };
  spoolDocument?: string;
  spoolQueue?: string;
  error?: string;
  outputFile?: string;
}

export interface SubmitArgs extends SourceInput {
  printer?: string;
  preset?: string;
  backend?: 'auto' | Route;
  options: PrintOptions;
  wait_for_completion?: boolean;
  dry_run?: boolean;
  allow_duplicate?: boolean;
  confirm_large?: boolean;
  output_file?: string;
}

export interface SubmitResult {
  job?: string;
  state: JobState | 'dry_run';
  printer: string;
  why_this_printer: string;
  route: Route;
  format: string;
  document: string;
  pages_selected: number;
  sheets: number;
  copies: number;
  paper: string;
  dpi: number;
  color: string;
  duplicate_of_recent_job?: boolean;
  warnings?: string[];
  output_file?: string;
  error?: string;
}

const HISTORY_FILE = 'jobs.json';
const HISTORY_LIMIT = 200;
const DEDUPE_WINDOW_MS = 20_000;
const FIRST_SHEET_WAIT_MS = 60_000;
const REPLAY_CACHE_LIMIT = 400 * 1024 * 1024;
const RASTER_FORMATS = ['image/urf', 'image/pwg-raster'];

const jobs = new Map<string, JobRecord>();
const aborts = new Map<string, AbortController>();
const recentSubmits = new Map<string, { at: number; jobId: string; result: SubmitResult }>();
const printerQueues = new Map<string, Promise<unknown>>();
let activeJobs = 0;

/** Another Claude session may run its own copy of this server, so history is shared through disk. */
function mergeHistoryFromDisk(): void {
  const stored = readJson<JobRecord[]>(HISTORY_FILE, []);
  if (!Array.isArray(stored)) return;
  for (const j of stored) if (j?.id && !aborts.has(j.id) && !jobs.has(j.id)) jobs.set(j.id, j);
}
mergeHistoryFromDisk();

function saveHistory(): void {
  try {
    mergeHistoryFromDisk();
    const newestLast = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-HISTORY_LIMIT);
    writeJson(HISTORY_FILE, newestLast);
  } catch (e) {
    console.error('print-mcp: could not save job history:', e);
  }
}

/** Unique across sessions without any coordination. */
function newJobId(): string {
  return `j${randomBytes(3).toString('hex')}`;
}

export function hasActiveJobs(): boolean { return activeJobs > 0; }

function finishJob(j: JobRecord, state: JobState, error?: string): void {
  j.state = state;
  if (error) j.error = error;
  j.finishedAt = Date.now();
  saveHistory();
}

// ---------- route and format ----------

function chooseRoute(p: PrinterRecord, wanted: SubmitArgs['backend'], outputFile: string | undefined): Route {
  if (wanted && wanted !== 'auto') {
    if (wanted === 'ipp' && !p.ipp) throw new Error(`${p.name} has no IPP connection. Available: ${routes(p).join(', ')}`);
    if (wanted === 'spooler' && !p.queue) throw new Error(`${p.name} has no Windows queue. Available: ${routes(p).join(', ')}`);
    if (wanted === 'raw' && !p.raw) throw new Error(`${p.name} has no raw port. Available: ${routes(p).join(', ')}`);
    return wanted;
  }
  if (outputFile) {
    if (!p.queue || !p.virtual) throw new Error('output_file only works with a virtual queue such as Microsoft Print to PDF.');
    const target = path.resolve(outputFile);
    assertLocalPathAllowed(target, {});
    // Extension and no-overwrite together stop this writing over a config file or anything else.
    if (!/\.(pdf|xps|oxps)$/i.test(target)) throw new Error('output_file must end in .pdf, .xps or .oxps.');
    if (fs.existsSync(target)) throw new Error(`${target} already exists and would be overwritten. Choose another path.`);
    return 'spooler';
  }
  if (p.ipp) return 'ipp';
  if (p.queue) return 'spooler';
  if (p.raw) return 'raw';
  throw new Error(`${p.name} has no usable connection.`);
}

function routes(p: PrinterRecord): Route[] {
  return [p.ipp && 'ipp', p.queue && 'spooler', p.raw && 'raw'].filter(Boolean) as Route[];
}

export function chooseFormat(formats: string[], preferred: string | undefined, canPassThrough: boolean): string | null {
  if (canPassThrough && formats.includes('application/pdf')) return 'application/pdf';
  if (preferred && RASTER_FORMATS.includes(preferred) && formats.includes(preferred)) return preferred;
  for (const f of RASTER_FORMATS) if (formats.includes(f)) return f;
  if (formats.includes('application/pdf')) return 'pdf-image';
  if (formats.includes('application/vnd.hp-PCL')) return 'application/vnd.hp-PCL';
  if (formats.includes('image/jpeg')) return 'image/jpeg';
  return null;
}

function sheetBackFor(p: PrinterRecord, format: string): SheetBack {
  if (format === 'image/urf') {
    // URF advertises the back side as DM1 normal, DM2 flipped, DM3 rotated, DM4 manual tumble.
    const dm = p.ipp?.caps.urf.find(u => /^DM\d$/.test(u));
    return (['normal', 'flipped', 'rotated', 'manual-tumble'] as SheetBack[])[Number(dm?.[2] ?? 1) - 1] ?? 'normal';
  }
  return (p.ipp?.caps.sheetBack as SheetBack | undefined) ?? 'normal';
}

// ---------- page stream ----------

interface StreamContext {
  input: RenderInput;
  plan: JobPlan;
  options: PrintOptions;
  copies: number;
  collate: boolean;
  duplex: 'none' | 'long' | 'short';
  sheets: number;
  /** A blank back keeps the next duplex copy starting on a fresh sheet. */
  padBlankBack: boolean;
}

function totalImpressions(c: StreamContext): number {
  return (c.sheets + (c.padBlankBack ? 1 : 0)) * c.copies;
}

/**
 * One copy's sheets, with copies expanded here because URF advertises CP1 and many raster
 * printers ignore job-level copies. Encoded pages replay from memory, so extra copies
 * need no re-render unless the job is too big to cache.
 */
async function* sheetStream(c: StreamContext, onEachSheet: (sheet: Sheet, index: number) => Buffer[] | Promise<Buffer[]>): AsyncGenerator<Buffer[]> {
  const blankSheet = (): Sheet => {
    const px = (mm: number) => Math.round(mm * c.plan.dpi / 25.4);
    const width = px(c.plan.media.widthMm), height = px(c.plan.media.heightMm);
    return { width, height, comp: 1, data: Buffer.alloc(width * height, 255) };
  };
  let index = 0;
  if (!c.collate && c.copies > 1) {
    for await (const sheet of renderSheets(c.input, c.plan, c.options)) {
      const encoded = await onEachSheet(sheet, index++);
      for (let i = 0; i < c.copies; i++) yield encoded;
    }
    return;
  }
  const cache: Buffer[][] = [];
  let cached = 0;
  let cacheable = c.copies > 1;
  const emitPass = async function* (): AsyncGenerator<Buffer[]> {
    for await (const sheet of renderSheets(c.input, c.plan, c.options)) {
      const encoded = await onEachSheet(sheet, index++);
      if (cacheable) {
        cached += encoded.reduce((n, b) => n + b.length, 0);
        if (cached > REPLAY_CACHE_LIMIT) { cacheable = false; cache.length = 0; }
        else cache.push(encoded);
      }
      yield encoded;
    }
    if (c.padBlankBack) {
      const encoded = await onEachSheet(blankSheet(), index++);
      if (cacheable) cache.push(encoded);
      yield encoded;
    }
  };
  yield* emitPass();
  for (let copy = 1; copy < c.copies; copy++) {
    if (cacheable) for (const encoded of cache) yield encoded;
    else yield* emitPass();
  }
}

function rasterEncoder(c: StreamContext, format: string, p: PrinterRecord): (sheet: Sheet, index: number) => Buffer[] {
  const meta: PageMeta = {
    dpi: c.plan.dpi, quality: c.plan.qualityEnum, duplex: c.duplex, totalPages: totalImpressions(c),
    mediaName: c.plan.media.keyword, mediaType: c.options.paper_type ?? 'stationery',
  };
  const transform = c.duplex !== 'none' ? backTransform(sheetBackFor(p, format), c.duplex) : [false, false] as [boolean, boolean];
  const caps = p.ipp?.caps;
  const grayAccepted = format === 'image/urf' ? !caps?.urf.length || caps.urf.includes('W8')
    : format === 'image/pwg-raster' ? !caps?.rasterTypes?.length || caps.rasterTypes.includes('sgray_8') : true;
  return (input, index) => {
    const sheet = input.comp === 1 && !grayAccepted ? grayToRgb(input) : input;
    // Every second impression is the back of a sheet.
    if (index % 2 === 1 && (transform[0] || transform[1])) flipSheet(sheet, transform[0], transform[1]);
    if (format === 'image/urf') return urfPage(sheet, meta);
    if (format === 'image/pwg-raster') return pwgPage(sheet, meta);
    return pclPage(sheet, meta, pclPaperCode(c.plan.media.keyword), index === 0);
  };
}

// ---------- IPP route ----------

function mediaTypeKeyword(p: PrinterRecord, wanted: string | undefined): string | undefined {
  if (!wanted) return undefined;
  const types = p.ipp?.caps.mediaTypes ?? [];
  const w = wanted.toLowerCase();
  if (types.includes(w)) return w;
  const aliases: [RegExp, RegExp][] = [
    [/^(plain|normal|stationery)$/, /^stationery$/], [/inkjet/, /stationery-inkjet/],
    [/^(photo|glossy|photographic)/, /photographic-glossy|photographic/], [/matte/, /photographic-matte/],
    [/envelope/, /envelope/], [/label/, /labels/], [/card/, /cardstock/], [/transparen/, /transparency/],
  ];
  for (const [ask, have] of aliases) if (ask.test(w)) { const hit = types.find(t => have.test(t)); if (hit) return hit; }
  return undefined;
}

export function ippJobAttributes(p: PrinterRecord, plan: JobPlan, o: PrintOptions, warnings: string[]): OutAttr[] {
  const caps = p.ipp!.caps;
  const attrs: OutAttr[] = [];
  const allowed = (name: string) => !caps.creationAttrs.length || caps.creationAttrs.includes(name);

  if (allowed('sides') && caps.sides.length) {
    const sides = plan.duplex === 'long' ? 'two-sided-long-edge' : plan.duplex === 'short' ? 'two-sided-short-edge' : 'one-sided';
    attrs.push(kw('sides', caps.sides.includes(sides) ? sides : 'one-sided'));
  }
  if (allowed('print-color-mode') && caps.colorModes.length) {
    const mode = plan.colorMode === 'color' || plan.colorMode === 'auto' ? 'color' : plan.colorMode === 'black_white' && caps.colorModes.includes('bi-level') ? 'bi-level' : 'monochrome';
    // Sheet data is already gray where gray is wanted; color mode just must not contradict it.
    attrs.push(kw('print-color-mode', caps.colorModes.includes(mode) ? mode : caps.colorModes[0]));
  }
  if (allowed('print-quality') && caps.qualities.includes(plan.qualityEnum)) attrs.push(enumAttr('print-quality', plan.qualityEnum));

  const mediaType = mediaTypeKeyword(p, o.paper_type);
  if (o.paper_type && !mediaType) warnings.push(`${p.name} has no "${o.paper_type}" paper setting. It offers: ${caps.mediaTypes.join(', ')}.`);
  let source: string | undefined;
  if (o.paper_source) {
    source = caps.mediaSources.find(s => s === o.paper_source!.toLowerCase());
    if (!source) warnings.push(`${p.name} has no tray "${o.paper_source}". It has: ${caps.mediaSources.join(', ')}.`);
  }

  if (allowed('media-col')) {
    const hundredths = (mm: number) => Math.round(mm * 100);
    const members: OutAttr[] = [col('media-size', [int('x-dimension', hundredths(plan.media.widthMm)), int('y-dimension', hundredths(plan.media.heightMm))])];
    const h = plan.hardware;
    members.push(int('media-top-margin', hundredths(h.top)), int('media-bottom-margin', hundredths(h.bottom)), int('media-left-margin', hundredths(h.left)), int('media-right-margin', hundredths(h.right)));
    if (mediaType) members.push(kw('media-type', mediaType));
    if (source) members.push(kw('media-source', source));
    attrs.push(col('media-col', members));
  } else if (!plan.media.custom && allowed('media')) {
    attrs.push(kw('media', plan.media.keyword));
  }
  return attrs;
}

async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof IppError && e.transient && attempt < 4) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw e;
    }
  }
}

/** IPP limits names to octets, and one Thai character takes three, so slicing by characters overflows. */
function fitOctets(s: string, max: number): string {
  let out = '';
  let size = 0;
  for (const ch of s) {
    size += Buffer.byteLength(ch);
    if (size > max) break;
    out += ch;
  }
  return out;
}

function requestingUser(): string {
  try {
    return os.userInfo().username.slice(0, 64) || 'print-mcp';
  } catch {
    return 'print-mcp';
  }
}

interface RouteInput {
  job: JobRecord;
  printer: PrinterRecord;
  ctx: StreamContext;
  doc: OpenDoc;
  format: string;
  warnings: string[];
  signal: AbortSignal;
  onFirstSheet: () => void;
}

async function imagePdfBytes(ctx: StreamContext, onSheet: () => void): Promise<Buffer> {
  const mupdf = await loadMupdf();
  const pdf = new mupdf.PDFDocument();
  try {
    const widthPt = ctx.plan.media.widthMm * 72 / 25.4, heightPt = ctx.plan.media.heightMm * 72 / 25.4;
    for await (const sheet of renderSheets(ctx.input, ctx.plan, ctx.options)) {
      const source = new mupdf.Image(await sheetToPng(sheet));
      const image = pdf.addImage(source);
      source.destroy();
      const resources = pdf.addObject({ XObject: { I: image } });
      const content = `q ${widthPt} 0 0 ${heightPt} 0 0 cm /I Do Q`;
      pdf.insertPage(-1, pdf.addPage([0, 0, widthPt, heightPt], 0, resources, content));
      onSheet();
    }
    return Buffer.from(pdf.saveToBuffer('compress').asUint8Array());
  } finally {
    pdf.destroy();
  }
}

async function sendViaIpp(r: RouteInput): Promise<void> {
  const { job, printer, ctx, format, signal } = r;
  const target: IppTarget = ippTarget(printer)!;
  const caps = printer.ipp!.caps;
  const jobAttrs = ippJobAttributes(printer, ctx.plan, ctx.options, r.warnings);
  const name = nameAttr('job-name', fitOctets(job.name, 255));
  const user = nameAttr('requesting-user-name', requestingUser());
  const fidelity = bool('ipp-attribute-fidelity', false);
  job.ippTarget = { host: target.host, port: target.port, path: target.path, tls: target.tls, tlsPin: target.tlsPin };

  const canCreate = caps.operations.includes(OP.CreateJob) && caps.operations.includes(OP.SendDocument);

  const sendBody = async (docFormat: string, body: AsyncIterable<Buffer>, attrs: OutAttr[]): Promise<void> => {
    if (canCreate) {
      const created = await withBusyRetry(() => ippCall(target, OP.CreateJob, [name, user, fidelity], attrs, { timeoutMs: 15000, signal }));
      const id = created.jobs[0]?.['job-id']?.[0];
      if (typeof id !== 'number') throw new Error('Printer accepted the job but returned no job id.');
      job.ippJobId = id;
      saveHistory();
      try {
        // No retry from here on: the printer may have started, and a resend would print twice.
        await ippCall(target, OP.SendDocument, [int('job-id', id), user, mime('document-format', docFormat), bool('last-document', true)], [], { timeoutMs: 15000, body, signal });
      } catch (e) {
        await ippCall(target, OP.CancelJob, [int('job-id', id), user], [], { timeoutMs: 3000 }).catch(err => console.error('print-mcp: cleanup cancel failed:', err.message));
        throw e;
      }
    } else {
      const res = await ippCall(target, OP.PrintJob, [name, user, fidelity, mime('document-format', docFormat)], attrs, { timeoutMs: 15000, body, signal });
      const id = res.jobs[0]?.['job-id']?.[0];
      if (typeof id === 'number') job.ippJobId = id;
    }
  };

  // A whole PDF goes as one document: the printer repeats it if it can, otherwise we resend it.
  const sendPdf = async (bytes: Buffer): Promise<void> => {
    const viaAttribute = ctx.copies > 1 && caps.creationAttrs.includes('copies');
    const attrs = viaAttribute ? [...jobAttrs, int('copies', ctx.copies)] : jobAttrs;
    job.state = 'sending';
    r.onFirstSheet();
    for (let pass = 0; pass < (viaAttribute ? 1 : ctx.copies); pass++) {
      if (signal.aborted) throw new Error('canceled');
      await sendBody('application/pdf', (async function* () { yield bytes; })(), attrs);
    }
    job.sentSheets = job.sheets * ctx.copies;
  };
  if (format === 'application/pdf' && r.doc.pdfBytes) return sendPdf(r.doc.pdfBytes);
  if (format === 'pdf-image') return sendPdf(await imagePdfBytes(ctx, () => { job.sentSheets++; }));
  if (format === 'image/jpeg') {
    // JPEG is single-page, so each sheet is its own job and printer job ids are per page.
    job.state = 'sending';
    let first = true;
    for (let copy = 0; copy < ctx.copies; copy++) {
      for await (const sheet of renderSheets(ctx.input, ctx.plan, ctx.options)) {
        if (signal.aborted) throw new Error('canceled');
        const bytes = await sheetToJpeg(sheet);
        const res = await withBusyRetry(() => ippCall(target, OP.PrintJob, [name, user, fidelity, mime('document-format', 'image/jpeg')], jobAttrs, { timeoutMs: 120000, body: (async function* () { yield bytes; })(), signal }));
        const id = res.jobs[0]?.['job-id']?.[0];
        if (typeof id === 'number') job.ippJobId = id; // status follows the last page sent
        job.sentSheets++;
        if (first) { first = false; r.onFirstSheet(); }
      }
    }
    return;
  }

  const encode = rasterEncoder(ctx, format, printer);
  const body = async function* (): AsyncGenerator<Buffer> {
    if (format === 'image/urf') yield urfFileHeader(totalImpressions(ctx));
    if (format === 'image/pwg-raster') yield PWG_SYNC;
    job.state = 'sending';
    for await (const buffers of sheetStream(ctx, encode)) {
      if (signal.aborted) throw new Error('canceled');
      for (const b of buffers) if (b.length) yield b;
      job.sentSheets++;
      if (job.sentSheets === 1) r.onFirstSheet();
    }
  };
  await sendBody(format, body(), jobAttrs);
}

// ---------- raw route: port 9100 ----------

async function sendViaRaw(r: RouteInput): Promise<void> {
  const { job, printer, ctx, signal } = r;
  const { host, port } = printer.raw!;
  const encode = rasterEncoder(ctx, 'application/vnd.hp-PCL', printer);
  await streamToSocket(host, port, (async function* () {
    job.state = 'sending';
    for await (const buffers of sheetStream(ctx, encode)) {
      if (signal.aborted) throw new Error('canceled');
      for (const b of buffers) yield b;
      job.sentSheets++;
      if (job.sentSheets === 1) r.onFirstSheet();
    }
    yield Buffer.from('\x1bE', 'latin1');
  })(), signal);
}

export function streamToSocket(host: string, port: number, body: AsyncIterable<Buffer>, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    sock.setTimeout(30 * 60 * 1000, () => sock.destroy(new Error(`${host}:${port} stopped accepting data for 30 minutes`)));
    const onAbort = () => sock.destroy(new Error('canceled'));
    signal?.addEventListener('abort', onAbort, { once: true });
    const settle = (err?: Error) => {
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err); else resolve();
    };
    sock.once('error', settle);
    sock.once('connect', () => {
      (async () => {
        for await (const chunk of body) {
          if (!sock.write(chunk)) await new Promise<void>((ok, no) => {
            const onDrain = () => { sock.off('close', onClose); ok(); };
            const onClose = () => { sock.off('drain', onDrain); no(new Error('printer closed the connection')); };
            sock.once('drain', onDrain);
            sock.once('close', onClose);
          });
        }
        sock.end(() => settle());
      })().catch(e => { sock.destroy(); settle(e as Error); });
    });
  });
}

// ---------- spooler route ----------

async function sendViaSpooler(r: RouteInput): Promise<void> {
  const { job, printer, ctx, signal } = r;
  if (process.platform !== 'win32') throw new Error('The spooler route only exists on Windows.');
  const queue = printer.queue!;
  const dir = makeTempDir();
  const settings = {
    printer: queue.name, jobName: job.spoolDocument, color: ctx.plan.colorMode === 'color' || ctx.plan.colorMode === 'auto',
    duplex: ctx.duplex, widthMm: ctx.plan.media.widthMm, heightMm: ctx.plan.media.heightMm, dpi: ctx.plan.dpi,
    quality: ctx.plan.quality, source: ctx.options.paper_source, outputFile: job.outputFile,
  };
  const proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS_DIR, 'spool.ps1')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: powerShellEnv() });
  let stderr = '';
  proc.stderr.setEncoding('utf8').on('data', d => { stderr += d; });
  proc.stdout.setEncoding('utf8').on('data', () => undefined);
  const exited = new Promise<void>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').slice(0, 3).join(' ') || `spooler helper exited with ${code}`))));
  });
  const stdinBroken = new Promise<never>((_, reject) => proc.stdin.once('error', reject));
  stdinBroken.catch(() => undefined);
  const onAbort = () => proc.kill();
  signal.addEventListener('abort', onAbort, { once: true });

  const writeLine = (line: string) => new Promise<void>((resolve, reject) => {
    proc.stdin.write(`${line}\n`, 'utf8', err => (err ? reject(err) : resolve()));
  });
  try {
    await writeLine(JSON.stringify(settings));
    job.state = 'sending';
    let n = 0;
    for await (const buffers of sheetStream(ctx, async sheet => [await sheetToPng(sheet)])) {
      if (signal.aborted) throw new Error('canceled');
      const file = path.join(dir, `p${++n}.png`);
      fs.writeFileSync(file, buffers[0]);
      await writeLine(file);
      job.sentSheets++;
      if (job.sentSheets === 1) r.onFirstSheet();
    }
    proc.stdin.end();
    await exited;
    if (job.outputFile) {
      // The helper returns once Windows has the job; the file only proves it actually happened.
      const deadline = Date.now() + 60000;
      while (!(fs.existsSync(job.outputFile) && fs.statSync(job.outputFile).size > 0)) {
        if (Date.now() > deadline) throw new Error(`Windows accepted the job but ${job.outputFile} never appeared.`);
        await new Promise(res => setTimeout(res, 150));
      }
    }
  } catch (e) {
    proc.kill();
    // The helper's own error explains more than the broken pipe that surfaced it.
    await exited.catch(helperError => { throw signal.aborted ? e : helperError; });
    throw e;
  } finally {
    signal.removeEventListener('abort', onAbort);
    removeDir(dir);
  }
}

// ---------- preflight ----------

export interface PrinterStatus {
  online: boolean;
  state?: string;
  reasons: string[];
  acceptingJobs?: boolean;
  queuedJobs?: number;
  ink: { name: string; level: number; low: boolean }[];
  paperLoaded: string[];
  message?: string;
  attributes?: IppAttrs;
}

const PRINTER_STATE: Record<number, string> = { 3: 'idle', 4: 'printing', 5: 'stopped' };
const STATUS_ATTRS = ['printer-state', 'printer-state-reasons', 'printer-state-message', 'printer-is-accepting-jobs', 'queued-job-count', 'marker-names', 'marker-levels', 'marker-low-levels', 'media-ready'];

export async function readPrinterStatus(p: PrinterRecord, timeoutMs = 2000): Promise<PrinterStatus> {
  if (!p.ipp) {
    return { online: p.queue ? !p.queue.offline : p.raw ? await registry.isOnline(p, timeoutMs) : false, reasons: [], ink: [], paperLoaded: [] };
  }
  const res = await getPrinterAttributes(ippTarget(p)!, timeoutMs, STATUS_ATTRS);
  const a = res.printer;
  const levels = (a['marker-levels'] ?? []) as number[], names = (a['marker-names'] ?? []) as string[], low = (a['marker-low-levels'] ?? []) as number[];
  const reasons = ((a['printer-state-reasons'] ?? []) as string[]).filter(r => r !== 'none').slice(0, 20).map(r => deviceText(r));
  return {
    online: true,
    state: PRINTER_STATE[a['printer-state']?.[0] as number] ?? 'unknown',
    reasons,
    acceptingJobs: a['printer-is-accepting-jobs']?.[0] as boolean | undefined,
    queuedJobs: a['queued-job-count']?.[0] as number | undefined,
    ink: names.slice(0, 16).map((name, i) => ({ name: inkName(deviceText(name, 40)), level: levels[i] ?? -1, low: levels[i] >= 0 && levels[i] <= (low[i] ?? 0) })),
    paperLoaded: ((a['media-ready'] ?? []) as string[]).slice(0, 20).map(m => deviceText(m)),
    message: deviceText(firstString(a, 'printer-state-message'), 200) || undefined,
  };
}

function inkName(n: string): string {
  return ({ M: 'magenta', C: 'cyan', Y: 'yellow', K: 'black', BK: 'black' } as Record<string, string>)[n] ?? n;
}

/** Fixes a stale address before any page work starts, and reports what will stop the job. */
async function preflight(p: PrinterRecord, route: Route, warnings: string[]): Promise<{ printer: PrinterRecord; route: Route }> {
  if (route !== 'ipp') return { printer: p, route };
  let status: PrinterStatus;
  try {
    status = await readPrinterStatus(p, 1800);
  } catch (first) {
    const moved = await registry.relocate(p);
    if (moved?.ipp) {
      try {
        status = await readPrinterStatus(moved, 1800);
        p = moved;
      } catch {
        status = { online: false, reasons: [], ink: [], paperLoaded: [] };
      }
    } else {
      status = { online: false, reasons: [], ink: [], paperLoaded: [] };
    }
    if (!status.online) {
      if (p.queue) {
        warnings.push(`${p.name} did not answer on the network; handed to the Windows queue, which holds it until the printer returns.`);
        return { printer: p, route: 'spooler' };
      }
      throw new Error(`${p.name} is not answering at ${p.ipp?.host} (${(first as Error).message}). Check it is on and connected, or call fix_printer.`);
    }
  }
  if (status.acceptingJobs === false) throw new Error(`${p.name} is not accepting jobs right now: ${status.reasons.join(', ') || status.message || 'no reason given'}. Call fix_printer for what to do.`);
  for (const reason of status.reasons) {
    if (reason.endsWith('report')) continue;
    warnings.push(`Printer reports: ${reason}.`);
  }
  const low = status.ink.filter(i => i.low).map(i => `${i.name} ${i.level}%`);
  if (low.length) warnings.push(`Ink low: ${low.join(', ')}.`);
  return { printer: p, route };
}

// ---------- submit ----------

function documentMarginsFor(plan: JobPlan): Partial<Margins> {
  // Generated documents (text, markdown, web pages) need comfortable margins, unlike a PDF
  // which already has its own, but explicit user values always win.
  const d = 15;
  const m = plan.requestedMargins;
  return { top: m.top ?? d, right: m.right ?? d, bottom: m.bottom ?? d, left: m.left ?? d };
}

export interface Prepared {
  printer: PrinterRecord;
  reason: string;
  options: PrintOptions;
  plan: JobPlan;
  doc: OpenDoc;
  pages: number[];
  sheets: number;
  layoutLandscape: boolean;
}

export async function prepare(args: SubmitArgs): Promise<Prepared> {
  const config = registry.reloadConfig();
  const early = mergeOptions(config, undefined, args.preset, args.options);
  const { printer, reason } = await registry.resolve(args.printer, { color: early.color === 'color' || undefined, duplex: (early.duplex && early.duplex !== 'none') || undefined });
  const options = mergeOptions(config, printer.id, args.preset, args.options);
  const plan = makePlan(printer, options);

  const docPlan: JobPlan = { ...plan, requestedMargins: documentMarginsFor(plan), warnings: [] };
  const docLayout = computeLayout(docPlan, options, options.orientation === 'landscape');
  const doc = await openSource(args, options, {
    widthMm: plan.media.widthMm, heightMm: plan.media.heightMm, landscape: options.orientation === 'landscape', insetMm: docLayout.insetMm,
  }, printer.ipp?.caps.formats.includes('application/pdf') === true);
  try {
    if (doc.generated) plan.requestedMargins = docPlan.requestedMargins;
    const pages = selectPages(options.pages, options.page_set, options.reverse, doc.count);
    if (!pages.length) throw new Error(`The page selection is empty for this ${doc.count}-page document.`);
    const first = doc.doc.loadPage(pages[0]);
    const layoutLandscape = firstPageIsLandscape(first, options.rotate ?? 0);
    first.destroy();
    computeLayout(plan, options, layoutLandscape); // surfaces impossible margins and hardware clamps now
    return { printer, reason, options, plan, doc, pages, sheets: sheetCount(pages.length, options), layoutLandscape };
  } catch (e) {
    doc.close();
    throw e;
  }
}

function summarize(p: Prepared, route: Route, format: string, copies: number, warnings: string[], extra: Partial<SubmitResult>): SubmitResult {
  return {
    state: 'dry_run', printer: p.printer.name, why_this_printer: p.reason, route, format, document: p.doc.name,
    pages_selected: p.pages.length, sheets: p.sheets, copies, paper: p.plan.media.keyword, dpi: p.plan.dpi, color: p.plan.colorMode,
    ...(warnings.length ? { warnings } : {}), ...extra,
  };
}

function formatFor(p: PrinterRecord, route: Route, passThrough: boolean): string {
  if (route === 'raw') return 'application/vnd.hp-PCL';
  if (route === 'spooler') return 'driver';
  const f = chooseFormat(p.ipp!.caps.formats, p.ipp!.caps.preferredFormat, passThrough);
  if (!f) throw new Error(`${p.name} only accepts ${p.ipp!.caps.formats.join(', ')}, none of which this tool can produce.`);
  return f;
}

export async function submit(args: SubmitArgs): Promise<SubmitResult> {
  const prepared = await prepare(args);
  const { doc, plan, options } = prepared;
  let printer = prepared.printer;
  const warnings = plan.warnings;
  let closed = false;
  const closeDoc = () => { if (!closed) { closed = true; doc.close(); } };

  try {
    let route = chooseRoute(printer, args.backend, args.output_file);
    if (!args.dry_run) ({ printer, route } = await preflight(printer, route, warnings));
    // Raw PDF is out when the printer could not honour the request on its own: an encrypted file
    // it cannot open, or monochrome on a printer with no such mode, which would come out in color.
    const printerObeysColor = plan.colorMode !== 'monochrome' || !printer.ipp?.caps.colorModes.length || printer.ipp.caps.colorModes.includes('monochrome');
    const passThrough = route === 'ipp' && doc.kind === 'pdf' && !!doc.pdfBytes && !needsPixelWork(options) && !options.password && printerObeysColor;
    const format = formatFor(printer, route, passThrough);

    const copies = options.copies ?? 1;
    let collate = options.collate ?? true;
    if (!collate && plan.duplex !== 'none') {
      warnings.push('Uncollated copies cannot be two-sided; printing collated.');
      collate = true;
    }
    const padBlankBack = plan.duplex !== 'none' && prepared.sheets % 2 === 1 && copies > 1;
    const physical = plan.duplex === 'none' ? prepared.sheets * copies : Math.ceil(prepared.sheets / 2) * copies;
    const resultBase = (extra: Partial<SubmitResult>) => summarize({ ...prepared, printer }, route, format, copies, warnings, extra);

    if (args.dry_run) { closeDoc(); return resultBase({ state: 'dry_run' }); }

    const limit = registry.config.largeJobSheets;
    if (physical > limit && !args.confirm_large) {
      closeDoc();
      throw new Error(`This job would use ${physical} sheets of paper, over the ${limit}-sheet safety limit. Nothing was printed. Check it is intended, then send again with confirm_large: true.`);
    }

    const key = createHash('sha256').update(JSON.stringify([doc.fingerprint, printer.id, options, args.preset, args.output_file])).digest('hex');
    for (const [k, v] of recentSubmits) if (Date.now() - v.at > DEDUPE_WINDOW_MS) recentSubmits.delete(k);
    const recent = recentSubmits.get(key);
    if (recent && !args.allow_duplicate) {
      closeDoc();
      return { ...recent.result, duplicate_of_recent_job: true, state: jobs.get(recent.jobId)?.state ?? recent.result.state, warnings: [`The same document went to this printer ${Math.round((Date.now() - recent.at) / 1000)} s ago, so it was not printed again. Send with allow_duplicate: true if a second print is really wanted, or use copies.`] };
    }

    const id = newJobId();
    const job: JobRecord = {
      id, printerId: printer.id, printerName: printer.name, name: doc.name, route, format, state: 'queued',
      sheets: prepared.sheets, sentSheets: 0, copies, createdAt: Date.now(),
      spoolDocument: route === 'spooler' ? `${doc.name} [${id}-${process.pid}]` : undefined,
      spoolQueue: route === 'spooler' ? printer.queue?.name : undefined,
      outputFile: args.output_file ? path.resolve(args.output_file) : undefined,
    };
    jobs.set(id, job);
    saveHistory();
    registry.touch(printer);

    const controller = new AbortController();
    aborts.set(id, controller);
    const ctx: StreamContext = {
      input: { doc: doc.doc, name: doc.name, pages: prepared.pages, generated: doc.generated },
      plan, options, copies, collate, duplex: plan.duplex, sheets: prepared.sheets, padBlankBack,
    };

    // Reserve before any await: a client that timed out and retried must find this job even
    // while the first page is still rendering, or the retry prints a second copy.
    const reservation = { at: Date.now(), jobId: id, result: resultBase({ job: id, state: 'queued' }) };
    recentSubmits.set(key, reservation);

    let firstSheetDone!: () => void;
    const firstSheet = new Promise<void>(resolve => { firstSheetDone = resolve; });

    // One job at a time per printer, because many reject a second connection with "busy".
    const previous = printerQueues.get(printer.id) ?? Promise.resolve();
    const wasIdle = !printerQueues.has(printer.id);
    activeJobs++;
    const finalPrinter = printer;
    const run = previous.catch(() => undefined).then(async () => {
      const routeInput: RouteInput = { job, printer: finalPrinter, ctx, doc, format, warnings, signal: controller.signal, onFirstSheet: firstSheetDone };
      try {
        if (controller.signal.aborted) throw new Error('canceled');
        job.state = 'rendering';
        if (route === 'ipp') await sendViaIpp(routeInput);
        else if (route === 'spooler') await sendViaSpooler(routeInput);
        else await sendViaRaw(routeInput);
        // "Sent" is not "printed". A live queue or printer job id gets polled for the real outcome;
        // with neither (raw port, output file) fully delivered is all anyone can know.
        const pollable = (route === 'ipp' && job.ippJobId !== undefined) || (route === 'spooler' && !job.outputFile);
        if (pollable) { job.state = 'printing'; saveHistory(); }
        else finishJob(job, 'completed');
      } catch (e) {
        // A job that dies later (say page 40) must not block an immediate reprint as a "duplicate".
        recentSubmits.delete(key);
        if (controller.signal.aborted) finishJob(job, 'canceled');
        else finishJob(job, 'failed', (e as Error).message);
        console.error(`print-mcp: job ${id} failed:`, (e as Error).message);
      } finally {
        firstSheetDone();
        aborts.delete(id);
        closeDoc();
        activeJobs--;
      }
    });
    const tail = run.finally(() => { if (printerQueues.get(finalPrinter.id) === tail) printerQueues.delete(finalPrinter.id); });
    printerQueues.set(printer.id, tail);

    // Return once real pages are moving, so failures that show up early still reach the caller.
    if (args.wait_for_completion) {
      await run;
      await waitForFinish(job, controller.signal);
    } else if (wasIdle) {
      // A wedged printer must not hold the AI's call open; the job keeps going and job_status follows it.
      await Promise.race([firstSheet, new Promise(res => setTimeout(res, FIRST_SHEET_WAIT_MS).unref())]);
    }
    const result = resultBase({ job: id, state: job.state, ...(job.outputFile ? { output_file: job.outputFile } : {}), ...(job.error ? { error: job.error } : {}) });
    reservation.result = result;
    if (job.state === 'failed' || job.state === 'canceled') recentSubmits.delete(key);
    return result;
  } catch (e) {
    closeDoc();
    throw e;
  }
}

async function waitForFinish(job: JobRecord, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline && !signal.aborted && !['completed', 'failed', 'canceled'].includes(job.state)) {
    await refreshJob(job);
    if (['completed', 'failed', 'canceled'].includes(job.state)) return;
    await new Promise(r => setTimeout(r, 1500));
  }
}

// ---------- status and cancel ----------

const IPP_JOB_STATE: Record<number, JobState> = { 3: 'queued', 4: 'queued', 5: 'printing', 6: 'printing', 7: 'canceled', 8: 'failed', 9: 'completed' };

async function refreshSpoolJob(job: JobRecord): Promise<{ reasons?: string[] }> {
  try {
    const out = await runPowerShell(path.join(SCRIPTS_DIR, 'spool-control.ps1'), JSON.stringify({ action: 'list', printer: job.spoolQueue, document: job.spoolDocument }), 15000);
    const list = JSON.parse(out || '[]') as { status: string }[];
    const statuses = list.map(j => j.status);
    // Windows lists a job while it prints and drops it when done, unless "keep printed documents" is on.
    if (!list.length || statuses.every(s => /Printed/i.test(s))) { finishJob(job, 'completed'); return {}; }
    return { reasons: statuses.filter(s => /Error|Offline|PaperOut|Blocked|UserIntervention/i.test(s)).map(s => deviceText(s)) };
  } catch (e) {
    return { reasons: [`Windows queue unavailable: ${(e as Error).message}`] };
  }
}

async function refreshJob(job: JobRecord): Promise<{ reasons?: string[]; impressions?: number; held?: boolean }> {
  if (job.route === 'spooler' && job.spoolQueue && job.state === 'printing') return refreshSpoolJob(job);
  if (job.ippJobId === undefined || !job.ippTarget || job.state === 'rendering' || job.state === 'sending') return {};
  try {
    const res = await ippCall(job.ippTarget, OP.GetJobAttributes, [int('job-id', job.ippJobId), kw('requested-attributes', 'job-state', 'job-state-reasons', 'job-impressions-completed', 'job-media-sheets-completed')], [], { timeoutMs: 2500 });
    const attrs = res.jobs[0] ?? {};
    const state = IPP_JOB_STATE[attrs['job-state']?.[0] as number];
    const reasons = ((attrs['job-state-reasons'] ?? []) as string[]).filter(r => r !== 'none').slice(0, 20).map(r => deviceText(r));
    if (state && state !== job.state) {
      if (state === 'completed' || state === 'failed' || state === 'canceled') finishJob(job, state, state === 'failed' ? reasons.join(', ') || undefined : undefined);
      else job.state = state;
    }
    return { reasons, impressions: attrs['job-impressions-completed']?.[0] as number | undefined, held: attrs['job-state']?.[0] === 6 };
  } catch (e) {
    // Printers forget finished jobs quickly: "not found" after a full send means it printed.
    if (e instanceof IppError && e.status === 0x0406 && job.sentSheets > 0) finishJob(job, 'completed');
    return {};
  }
}

export async function jobStatus(id: string | undefined, limit = 10): Promise<unknown> {
  mergeHistoryFromDisk();
  const pick = id ? [jobs.get(id)].filter(Boolean) as JobRecord[] : [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-limit).reverse();
  if (id && !pick.length) throw new Error(`No job "${id}". Recent: ${[...jobs.keys()].slice(-5).join(', ') || 'none'}.`);
  return Promise.all(pick.map(async j => {
    const live = ['printing', 'queued'].includes(j.state) ? await refreshJob(j) : {};
    return {
      job: j.id, state: j.state, printer: j.printerName, document: j.name, route: j.route, format: j.format,
      sheets_sent: j.sentSheets, sheets_total: j.sheets * j.copies, printer_job_id: j.ippJobId,
      created: new Date(j.createdAt).toLocaleString(), ...(j.error ? { error: j.error } : {}), ...(live.reasons?.length ? { printer_says: live.reasons } : {}),
      ...('impressions' in live && live.impressions !== undefined ? { impressions_done: live.impressions } : {}), ...(j.outputFile ? { output_file: j.outputFile } : {}),
    };
  }));
}

export async function cancelJob(id: string): Promise<{ job: string; state: JobState; detail: string }> {
  const j = jobs.get(id);
  if (!j) throw new Error(`No job "${id}".`);
  if (['completed', 'failed', 'canceled'].includes(j.state)) return { job: id, state: j.state, detail: `Already ${j.state}.` };
  aborts.get(id)?.abort();
  let detail = 'Stopped sending pages.';
  if (j.ippJobId !== undefined && j.ippTarget) {
    try {
      await ippCall(j.ippTarget, OP.CancelJob, [int('job-id', j.ippJobId), nameAttr('requesting-user-name', requestingUser())], [], { timeoutMs: 3000 });
      detail = 'Canceled on the printer. Pages already in its memory may still come out.';
    } catch (e) {
      detail = `Stopped sending, but the printer refused cancel: ${(e as Error).message}`;
    }
  }
  if (j.route === 'spooler' && j.spoolQueue) {
    await runPowerShell(path.join(SCRIPTS_DIR, 'spool-control.ps1'), JSON.stringify({ action: 'cancel', printer: j.spoolQueue, document: j.spoolDocument }), 15000)
      .then(() => { detail = 'Removed from the Windows queue.'; })
      .catch(e => { detail = `Windows queue removal failed: ${(e as Error).message}`; });
  }
  finishJob(j, 'canceled');
  return { job: id, state: 'canceled', detail };
}

export async function cancelPrinterJob(p: PrinterRecord, printerJobId: number): Promise<void> {
  if (!p.ipp) throw new Error(`${p.name} has no IPP connection.`);
  await ippCall(ippTarget(p)!, OP.CancelJob, [int('job-id', printerJobId), nameAttr('requesting-user-name', requestingUser())], [], { timeoutMs: 3000 });
}

export async function printerJobs(p: PrinterRecord, which: 'not-completed' | 'completed' = 'not-completed'): Promise<unknown[]> {
  if (!p.ipp) return [];
  const res = await ippCall(ippTarget(p)!, OP.GetJobs, [kw('which-jobs', which), kw('requested-attributes', 'job-id', 'job-name', 'job-state', 'job-originating-user-name')], [], { timeoutMs: 2500 });
  return res.jobs.slice(0, 50).map(a => ({ id: a['job-id']?.[0], name: deviceText(a['job-name']?.[0]), state: IPP_JOB_STATE[a['job-state']?.[0] as number], user: deviceText(a['job-originating-user-name']?.[0], 40) }));
}

// ---------- preview ----------

export async function preview(args: SubmitArgs, opts: { dpi: number; maxPages: number; outDir?: string }): Promise<{ summary: SubmitResult; files: string[]; images: Buffer[] }> {
  const prepared = await prepare(args);
  const { doc, plan, options } = prepared;
  try {
    const previewPlan: JobPlan = { ...plan, dpi: opts.dpi };
    const dir = opts.outDir ?? makeTempDir();
    fs.mkdirSync(dir, { recursive: true });
    const files: string[] = [];
    const images: Buffer[] = [];
    let n = 0;
    for await (const sheet of renderSheets({ doc: doc.doc, name: doc.name, pages: prepared.pages, generated: doc.generated }, previewPlan, options)) {
      n++;
      if (n > opts.maxPages) break;
      const png = await sheetToPng(sheet, 6);
      const file = path.join(dir, `preview-${n}.png`);
      fs.writeFileSync(file, png);
      files.push(file);
      images.push(png);
    }
    const route = chooseRoute(prepared.printer, args.backend, args.output_file);
    const format = formatFor(prepared.printer, route, false);
    return { summary: summarize(prepared, route, format, options.copies ?? 1, plan.warnings, {}), files, images };
  } finally {
    doc.close();
  }
}
