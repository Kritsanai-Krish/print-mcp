import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCRIPTS_DIR, runPowerShell } from './discovery.js';
import { deviceText } from './ipp.js';
import { registry, type PrinterRecord } from './registry.js';
import { loadMupdf, loadSharp } from './render.js';
import { resolveLocalPath } from './sources.js';

export interface ScanArgs {
  scanner?: string;
  source?: 'auto' | 'glass' | 'feeder';
  color?: 'color' | 'gray' | 'black_white';
  dpi?: number;
  format?: 'pdf' | 'jpeg';
  output_file?: string;
}

export interface ScanResult { scanner: string; via: 'escl' | 'wia'; source: 'glass' | 'feeder'; dpi: number; color: string; files: string[]; notes: string[] }

export interface ScannerState { state: string; adf?: string; problem?: string }

interface Input { maxW: number; maxH: number; dpis: number[]; formats: string[]; colors: string[] }

export const DEFAULT_SCAN_DIR = path.join(os.homedir(), 'Documents', 'Scans');
const COLOR_MODE = { color: 'RGB24', gray: 'Grayscale8', black_white: 'BlackAndWhite1' } as const;

// eSCL replies with namespaced XML; tag names alone are enough to read it.
function tags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</`, 'g'))].map(m => m[1].trim());
}
function section(xml: string, name: string): string | undefined {
  return new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)?.[1];
}

export function parseInput(xml: string | undefined): Input | undefined {
  if (!xml) return undefined;
  return {
    maxW: +(tags(xml, 'MaxWidth')[0] ?? 2550), maxH: +(tags(xml, 'MaxHeight')[0] ?? 3508),
    dpis: [...new Set(tags(xml, 'XResolution').map(Number))].filter(n => n > 0).sort((a, b) => a - b),
    formats: [...new Set([...tags(xml, 'DocumentFormatExt'), ...tags(xml, 'DocumentFormat')])],
    colors: [...new Set(tags(xml, 'ColorMode'))],
  };
}

/** "ScannerAdfHatchOpen" -> "hatch open" */
function adfText(s: string): string { return s.replace(/^ScannerAdf/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); }

export function parseScannerStatus(xml: string): ScannerState {
  const state = tags(xml, 'State')[0] ?? 'Unknown', adf = tags(xml, 'AdfState')[0];
  const problem = state === 'Down' || state === 'Stopped' ? `The scanner reports it is ${state.toLowerCase()}. Check its screen.`
    : adf && !/Loaded|Empty|Processing/.test(adf) ? `Document feeder: ${adfText(adf)}. Clear it and close the feeder cover.` : undefined;
  return { state: state.toLowerCase(), ...(adf ? { adf: adfText(adf) } : {}), ...(problem ? { problem } : {}) };
}

async function httpGet(url: string, timeoutMs: number): Promise<Response> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} answered HTTP ${r.status}`);
  return r;
}

const esclMissing = new Map<string, number>();

/** eSCL root on the device, or undefined. shortcut: plain http on port 80 only, add https/_uscan mDNS when a device needs it. */
async function esclBase(p: PrinterRecord): Promise<string | undefined> {
  const host = p.ipp?.host ?? p.raw?.host;
  if (!host || p.virtual) return undefined;
  if ((esclMissing.get(host) ?? 0) > Date.now()) return undefined;
  const base = `http://${host.includes(':') ? `[${host}]` : host}/eSCL`;
  try {
    await httpGet(`${base}/ScannerStatus`, 1500).then(r => r.text());
    return base;
  } catch {
    esclMissing.set(host, Date.now() + 10 * 60 * 1000);
    return undefined;
  }
}

/** Scanner part of a multifunction printer, for printer_status. */
export async function scannerState(p: PrinterRecord): Promise<ScannerState | undefined> {
  const base = await esclBase(p);
  return base ? parseScannerStatus(await (await httpGet(`${base}/ScannerStatus`, 1500)).text()) : undefined;
}

function nearest(list: number[], want: number): number {
  // list is ascending, so a tie goes to the sharper resolution
  return list.length ? list.reduce((a, b) => Math.abs(b - want) <= Math.abs(a - want) ? b : a) : want;
}

function outputStem(file: string | undefined): string {
  if (file) {
    const f = resolveLocalPath(file);
    return f.replace(/\.(pdf|jpe?g)$/i, '');
  }
  const t = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  return path.join(DEFAULT_SCAN_DIR, `scan-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}_${pad(t.getHours())}-${pad(t.getMinutes())}-${pad(t.getSeconds())}`);
}

function claimFile(stem: string, n: number, ext: string): string {
  const file = `${stem}${n > 1 ? `-${n}` : ''}.${ext}`;
  if (fs.existsSync(file)) throw new Error(`${file} already exists. Pass another output_file.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

export async function jpegToPdf(jpeg: Buffer, dpi: number): Promise<Buffer> {
  const mu = await loadMupdf();
  const img = new mu.Image(jpeg);
  const w = img.getWidth() * 72 / (img.getXResolution() || dpi), h = img.getHeight() * 72 / (img.getYResolution() || dpi);
  const pdf = new mu.PDFDocument();
  const resources = pdf.addObject({ XObject: { I: pdf.addImage(img) } });
  pdf.insertPage(-1, pdf.addPage([0, 0, w, h], 0, resources, `q ${w} 0 0 ${h} 0 0 cm /I Do Q`));
  return Buffer.from(pdf.saveToBuffer('compress').asUint8Array());
}

export async function esclScan(base: string, name: string, a: ScanArgs): Promise<ScanResult> {
  const capsXml = await (await httpGet(`${base}/ScannerCapabilities`, 5000)).text();
  const platen = parseInput(section(capsXml, 'Platen')), adf = parseInput(section(capsXml, 'Adf'));
  const status = parseScannerStatus(await (await httpGet(`${base}/ScannerStatus`, 3000)).text());
  if (status.state !== 'idle') throw new Error(`${name} scanner is ${status.state}. ${status.problem ?? 'Wait for it to finish, then try again.'}`);

  const want = a.source ?? 'auto';
  if (want === 'feeder' && !adf) throw new Error(`${name} has no document feeder. Put the page face down on the glass and use source glass.`);
  if (want === 'glass' && !platen) throw new Error(`${name} has no glass, only a document feeder.`);
  const source = want === 'feeder' || !platen || (want === 'auto' && adf && status.adf === 'loaded') ? 'feeder' : 'glass';
  if (source === 'feeder' && status.adf && status.adf !== 'loaded') throw new Error(`Document feeder: ${status.adf}. Put the pages in the feeder, face up.`);
  const input = (source === 'feeder' ? adf : platen)!;

  const notes: string[] = [];
  const dpi = nearest(input.dpis, a.dpi ?? 300);
  if (a.dpi && dpi !== a.dpi) notes.push(`Scanned at ${dpi} dpi, the nearest this scanner offers.`);
  let colorMode: string = COLOR_MODE[a.color ?? 'color'];
  if (input.colors.length && !input.colors.includes(colorMode)) {
    notes.push(`${a.color} is not offered; scanned in ${input.colors.includes('RGB24') ? 'color' : input.colors[0]}.`);
    colorMode = input.colors.includes('RGB24') ? 'RGB24' : input.colors[0];
  }
  const wantPdf = (a.format ?? 'pdf') === 'pdf';
  const mimeType = wantPdf && input.formats.includes('application/pdf') ? 'application/pdf' : 'image/jpeg';
  const version = tags(capsXml, 'Version')[0] ?? '2.0';

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
<pwg:Version>${version.replace(/[^\d.]/g, '')}</pwg:Version>
<pwg:ScanRegions><pwg:ScanRegion><pwg:Height>${input.maxH}</pwg:Height><pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits><pwg:Width>${input.maxW}</pwg:Width><pwg:XOffset>0</pwg:XOffset><pwg:YOffset>0</pwg:YOffset></pwg:ScanRegion></pwg:ScanRegions>
<pwg:InputSource>${source === 'feeder' ? 'Feeder' : 'Platen'}</pwg:InputSource>
<scan:ColorMode>${colorMode}</scan:ColorMode>
<scan:XResolution>${dpi}</scan:XResolution><scan:YResolution>${dpi}</scan:YResolution>
<pwg:DocumentFormat>${mimeType}</pwg:DocumentFormat><scan:DocumentFormatExt>${mimeType}</scan:DocumentFormatExt>
</scan:ScanSettings>`.replace(/\n/g, ''); // Brother silently drops the region when the XML has line breaks
  let post!: Response;
  // Right after a scan some devices say idle but refuse new jobs for a few seconds.
  for (let tries = 0; tries < 12; tries++) {
    if (tries) await new Promise(res => setTimeout(res, 1500));
    post = await fetch(`${base}/ScanJobs`, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body, signal: AbortSignal.timeout(15000) });
    if (![409, 500, 503].includes(post.status)) break;
  }
  if (post.status === 409 || post.status === 503) throw new Error(`${name} scanner is busy. Try again in a moment.`);
  if (post.status !== 201 || !post.headers.get('location')) throw new Error(`${name} refused the scan (HTTP ${post.status}).`);
  const job = new URL(post.headers.get('location')!, `${base}/`);
  // The job URL comes from the device; never let it point anywhere else.
  if (job.origin !== new URL(base).origin) throw new Error(`${name} answered with a job on another host (${job.host}).`);

  const stem = outputStem(a.output_file);
  const files: string[] = [];
  const deadline = Date.now() + 5 * 60 * 1000;
  try {
    const next = `${job.href.replace(/\/$/, '')}/NextDocument`;
    for (;;) {
      const r = await fetch(next, { signal: AbortSignal.timeout(180000) });
      if (r.status === 404 || r.status === 410) break; // no more pages
      if (r.status === 503) {
        if (Date.now() > deadline) throw new Error('The scanner never delivered the page.');
        await new Promise(res => setTimeout(res, 1000));
        continue;
      }
      if (!r.ok) throw new Error(`The scanner failed while sending the page (HTTP ${r.status}).`);
      let data: Buffer = Buffer.from(await r.arrayBuffer());
      let ext = mimeType === 'application/pdf' ? 'pdf' : 'jpg';
      if (wantPdf && ext === 'jpg') { data = await jpegToPdf(data, dpi); ext = 'pdf'; }
      const file = claimFile(stem, files.length + 1, ext);
      fs.writeFileSync(file, data);
      files.push(file);
      if (source === 'glass') {
        // The glass holds one page. The device stays busy until told there is no next one (404); anything else gets the job deleted.
        const end = await fetch(next, { signal: AbortSignal.timeout(30000) }).catch(() => undefined);
        await end?.arrayBuffer().catch(() => {});
        if (end?.status !== 404 && end?.status !== 410) await fetch(job.href, { method: 'DELETE', signal: AbortSignal.timeout(3000) }).catch(() => {});
        break;
      }
    }
  } catch (e) {
    await fetch(job.href, { method: 'DELETE', signal: AbortSignal.timeout(3000) }).catch(() => {});
    throw e;
  }
  if (!files.length) throw new Error(source === 'feeder' ? 'The feeder had no pages. Put the pages in the feeder, face up.' : 'The scanner returned no page.');
  return { scanner: name, via: 'escl', source, dpi, color: colorMode, files, notes };
}

const WIA_INTENT = { color: 1, gray: 2, black_white: 4 } as const;

async function wiaScan(name: string | undefined, a: ScanArgs): Promise<ScanResult> {
  const dpi = a.dpi ?? 300;
  const stem = outputStem(a.output_file);
  const jpg = claimFile(stem, 1, 'jpg');
  const out = JSON.parse(await runPowerShell(path.join(SCRIPTS_DIR, 'wia-scan.ps1'), JSON.stringify({ name, dpi, intent: WIA_INTENT[a.color ?? 'color'], feeder: a.source === 'feeder', out: jpg }), 240000)) as { name?: string; error?: string };
  if (out.error) throw new Error(deviceText(out.error, 300));
  let file = jpg;
  if ((a.format ?? 'pdf') === 'pdf') {
    file = claimFile(stem, 1, 'pdf');
    fs.writeFileSync(file, await jpegToPdf(fs.readFileSync(jpg), dpi));
    fs.rmSync(jpg);
  }
  return { scanner: deviceText(out.name) || name || 'scanner', via: 'wia', source: a.source === 'feeder' ? 'feeder' : 'glass', dpi, color: a.color ?? 'color', files: [file], notes: a.source === 'feeder' ? ['Windows scanning gives the first feeder page only.'] : [] };
}

/** Network scanners speak eSCL (AirScan/Mopria); USB ones go through Windows WIA. */
export async function scan(a: ScanArgs): Promise<ScanResult> {
  await registry.whenReady();
  if (a.scanner) {
    const { printer } = await registry.resolve(a.scanner).catch(() => ({ printer: undefined }));
    const base = printer && await esclBase(printer);
    if (base) return esclScan(base, printer.name, a);
    return wiaScan(printer?.model ?? printer?.name ?? a.scanner, a);
  }
  const candidates = registry.visible().filter(p => !p.virtual && (p.ipp || p.raw));
  const found = (await Promise.all(candidates.map(async p => ({ p, base: await esclBase(p) })))).filter(c => c.base);
  const pick = found.find(c => registry.config.defaultPrinter === c.p.id || c.p.queue?.isDefault) ?? found[0];
  if (pick) return esclScan(pick.base!, pick.p.name, a);
  return wiaScan(undefined, a);
}

/** A small first-page image so the AI can read what was scanned. */
export async function scanPreview(file: string): Promise<Buffer> {
  if (file.endsWith('.pdf')) {
    const mu = await loadMupdf();
    const page = mu.Document.openDocument(fs.readFileSync(file), 'application/pdf').loadPage(0);
    const [x0, y0, x1, y1] = page.getBounds();
    const s = 1400 / Math.max(x1 - x0, y1 - y0);
    return Buffer.from(page.toPixmap([s, 0, 0, s, 0, 0], mu.ColorSpace.DeviceRGB, false, true).asJPEG(75));
  }
  const sharp = await loadSharp();
  return sharp(file).resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
}
