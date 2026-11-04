// Accepts anything printable and yields one thing: a page-addressable document.
// Files are classified by content first; extensions lie and an AI will pass odd names.
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser } from 'playwright-core';
import type { Document as MuDocument } from 'mupdf';
import { loadMupdf, loadSharp } from './render.js';
import { SCRIPTS_DIR, isPrivateIpv4, runPowerShell } from './discovery.js';
import { makeTempDir, removeDir } from './state.js';
import type { Margins, PrintOptions } from './options.js';

export type Kind = 'pdf' | 'image' | 'mupdf' | 'office' | 'html' | 'markdown' | 'csv' | 'text' | 'url';

export interface OpenDoc {
  doc: MuDocument;
  count: number;
  name: string;
  kind: Kind;
  generated: boolean;
  /** Original bytes, kept only when the printer might take the PDF directly. */
  pdfBytes?: Buffer;
  fingerprint: string;
  close(): void;
}

export interface SourceInput {
  source?: string;
  content?: string;
  format?: 'auto' | 'text' | 'markdown' | 'html' | 'csv';
  job_name?: string;
}

export interface PageSetup {
  widthMm: number;
  heightMm: number;
  landscape: boolean;
  insetMm: Margins;
}

const MAX_FILE = 1024 * 1024 * 1024;
const MAX_DOWNLOAD = 512 * 1024 * 1024;
const OFFICE_EXT = new Set(['.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf', '.odt', '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.odp']);
const MUPDF_EXT: Record<string, string> = { '.xps': 'application/oxps', '.oxps': 'application/oxps', '.epub': 'application/epub+zip', '.cbz': 'application/x-cbz', '.fb2': 'text/xml', '.mobi': 'application/x-mobipocket-ebook' };
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif', '.ico']);
const HTML_EXT = new Set(['.html', '.htm', '.xhtml', '.svg', '.mht', '.mhtml']);
const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd']);

export function classifyBytes(head: Buffer, ext: string): Kind | null {
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const b = head;
  const isImage = (b[0] === 0xff && b[1] === 0xd8) || b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || b.subarray(0, 4).toString('latin1') === 'GIF8' || (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP')
    || b.subarray(0, 2).toString('latin1') === 'BM' || b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0])) || b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0, 0x2a]))
    || (b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(hei|hev|mif|avif|avis)/.test(b.subarray(8, 12).toString('latin1')));
  if (isImage) return 'image';
  if (b.subarray(0, 5).toString('latin1') === '{\\rtf') return 'office';
  const isZip = b[0] === 0x50 && b[1] === 0x4b, isOle = b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  if (isZip || isOle) {
    if (OFFICE_EXT.has(ext)) return 'office';
    if (MUPDF_EXT[ext]) return 'mupdf';
    return null;
  }
  if (MUPDF_EXT[ext]) return 'mupdf';
  if (OFFICE_EXT.has(ext)) return 'office';
  if (HTML_EXT.has(ext)) return 'html';
  if (MD_EXT.has(ext)) return 'markdown';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (b.includes(0) && !isUtf16(b)) return null;
  return 'text';
}

function isUtf16(b: Buffer): boolean {
  return (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
}

/** UTF-8 with or without BOM, UTF-16, then Thai legacy TIS-620/Windows-874, common in old Thai files. */
export function decodeText(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b);
  } catch {
    return new TextDecoder('windows-874').decode(b);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function resolveLocalPath(source: string): string {
  let p = source.trim().replace(/^["']|["']$/g, '');
  if (p.startsWith('file://')) p = decodeURIComponent(new URL(p).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
  p = p.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name: string) => process.env[name] ?? m);
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

// ---------- HTML templates ----------

const BODY_FONT = `"Leelawadee UI","Tahoma","Segoe UI","Noto Sans Thai",sans-serif`;
const MONO_FONT = `"Cascadia Mono","Consolas","Tahoma",monospace`;

function baseCss(o: PrintOptions): string {
  return `*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:${o.font ? `"${o.font.replace(/"/g, '')}",` : ''}${BODY_FONT};font-size:${o.font_size_pt ?? 11}pt;line-height:${o.line_height ?? 1.5};color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
pre,code{font-family:${o.font ? `"${o.font.replace(/"/g, '')}",` : ''}${MONO_FONT}}
h1,h2,h3,h4{line-height:1.25;margin:1em 0 .4em;break-after:avoid}h1{font-size:1.9em}h2{font-size:1.5em}h3{font-size:1.2em}
p{margin:.5em 0}img{max-width:100%}pre{background:#f4f4f4;padding:.7em;white-space:pre-wrap;word-break:break-word;border-radius:3px}
code{background:#f1f1f1;padding:.05em .25em;border-radius:3px}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:.6em 0;font-size:.95em}th,td{border:1px solid #888;padding:.25em .5em;text-align:left;vertical-align:top}th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}
blockquote{border-left:3px solid #999;margin:.6em 0;padding:.1em .9em;color:#333}hr{border:0;border-top:1px solid #999}
.t{white-space:pre-wrap;word-break:break-word;tab-size:4;font-family:${o.font ? `"${o.font.replace(/"/g, '')}",` : ''}${BODY_FONT}}
.t.mono{font-family:${o.font ? `"${o.font.replace(/"/g, '')}",` : ''}${MONO_FONT}}
.l{display:grid;grid-template-columns:3.2em 1fr}.n{color:#777;text-align:right;padding-right:.8em;user-select:none}
${o.css ?? ''}`;
}

const page = (title: string, body: string, o: PrintOptions) => `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${baseCss(o)}</style></head><body>${body}</body></html>`;

/** Code and logs keep their alignment in a monospace font; prose reads better in the body font. */
function looksLikeCode(text: string, ext: string): boolean {
  if (/^\.(c|h|cpp|hpp|cs|java|js|mjs|ts|tsx|jsx|py|rb|go|rs|php|sh|ps1|bat|cmd|sql|json|xml|ya?ml|toml|ini|cfg|conf|log|lua|luau)$/.test(ext)) return true;
  const lines = text.split('\n').slice(0, 80);
  return lines.filter(l => /^\s{2,}\S/.test(l) || /[{};=]\s*$/.test(l)).length > lines.length * 0.3;
}

function textToHtml(text: string, name: string, ext: string, o: PrintOptions): string {
  const cls = looksLikeCode(text, ext) ? 't mono' : 't';
  if (o.line_numbers) {
    const rows = text.replace(/\r\n/g, '\n').split('\n').map((l, i) => `<div class="l"><span class="n">${i + 1}</span><span class="${cls}">${escapeHtml(l) || ' '}</span></div>`).join('');
    return page(name, rows, o);
  }
  return page(name, `<div class="${cls}">${escapeHtml(text)}</div>`, o);
}

export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

function csvToHtml(text: string, name: string, ext: string, o: PrintOptions): string {
  const firstLine = text.split('\n', 1)[0];
  const delimiter = ext === '.tsv' || firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows = parseCsv(text.replace(/^\ufeff/, ''), delimiter);
  const head = rows[0]?.map(c => `<th>${escapeHtml(c)}</th>`).join('') ?? '';
  const body = rows.slice(1).map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return page(name, `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`, o);
}

async function markdownToHtml(text: string, name: string, o: PrintOptions): Promise<string> {
  const { marked } = await import('marked');
  return page(name, await marked.parse(text, { gfm: true, breaks: false }), o);
}

function sniffContentFormat(text: string): 'html' | 'markdown' | 'text' {
  const t = text.trimStart().slice(0, 500).toLowerCase();
  if (t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<svg') || /^<(div|table|body|h1|style)\b/.test(t)) return 'html';
  if (/^(#{1,6} |\* |- |\d+\. |> |```|\|.*\|)/m.test(text) && /(^#{1,6} |\*\*|^```|^\|.*\|$|^- )/m.test(text)) return 'markdown';
  return 'text';
}

// ---------- headless browser ----------

let browserPromise: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | undefined;
const BROWSER_IDLE_MS = 5 * 60 * 1000;

function browserCandidates(): string[] {
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
    const rels = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Chromium\\Application\\chrome.exe'];
    return rels.flatMap(rel => roots.map(root => path.join(root, rel)));
  }
  if (process.platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].map(app => `/Applications/${app}.app/Contents/MacOS/${app}`);
  }
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'brave-browser', 'chromium', 'chromium-browser'].flatMap(name => dirs.map(dir => path.join(dir, name)));
}

function findBrowser(): string {
  const found = browserCandidates().find(p => fs.existsSync(p));
  if (found) return found;
  throw new Error('Rendering text, markdown or web pages needs Chrome, Edge, Brave or Chromium, and none was found.');
}

function getBrowser(): Promise<Browser> {
  clearTimeout(idleTimer);
  browserPromise ??= import('playwright-core').then(async ({ chromium }) => {
    const b = await chromium.launch({ executablePath: findBrowser(), headless: true, args: ['--disable-gpu', '--no-first-run', '--disable-extensions'] });
    b.on('disconnected', () => { browserPromise = null; });
    return b;
  }).catch(e => { browserPromise = null; throw e; });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  clearTimeout(idleTimer);
  const p = browserPromise;
  browserPromise = null;
  if (p) {
    try {
      await (await p).close();
    } catch (e) {
      console.error('print-mcp: browser close:', (e as Error).message);
    }
  }
}

// ---------- network and file boundary for anything the browser loads ----------

export function isInternalAddress(ip: string): boolean {
  const a = ip.toLowerCase();
  if (a.startsWith('::ffff:')) return isInternalAddress(a.slice(7));
  if (net.isIPv6(a)) return a === '::' || a === '::1' || a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd');
  const p = a.split('.').map(Number);
  return p[0] === 0 || p[0] === 127 || p[0] >= 224 || (p[0] === 198 && (p[1] === 18 || p[1] === 19)) || isPrivateIpv4(a);
}

/** Fails closed: a name that does not resolve counts as internal. */
async function isInternalHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return isInternalAddress(host);
  try {
    const all = await dns.lookup(host, { all: true });
    return all.some(a => isInternalAddress(a.address));
  } catch {
    return true;
  }
}

const PRIVATE_HINT = 'Pass allow_private_network: true if this internal address is really intended.';

async function assertPublicUrl(url: URL, o: PrintOptions): Promise<void> {
  if (!o.allow_private_network && await isInternalHost(url.hostname)) {
    throw new Error(`${url.hostname} is on a private network, or could not be resolved. Nothing was fetched. ${PRIVATE_HINT}`);
  }
}

/** A UNC path makes Windows hand this user's credentials to whichever host it names. */
export function assertLocalPathAllowed(file: string, o: { allow_private_network?: boolean }): void {
  if (file.startsWith('\\\\') && !o.allow_private_network) {
    throw new Error(`${file} is on a network share. ${PRIVATE_HINT}`);
  }
}

/** Follows redirects by hand so that every hop passes the same address check. */
async function guardedFetch(start: URL, method: 'HEAD' | 'GET', o: PrintOptions): Promise<{ response: Response | null; finalUrl: URL }> {
  let url = start;
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(url, o);
    let res: Response;
    try {
      res = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    } catch {
      return { response: null, finalUrl: url }; // certificates or a client block: the browser may still manage
    }
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return { response: res, finalUrl: url };
    void res.body?.cancel();
    url = new URL(location, url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Redirected to ${url.protocol}, which cannot be printed.`);
  }
  throw new Error(`${start.host} redirected too many times.`);
}

interface HtmlRender {
  html?: string;
  url?: string;
  javascript: boolean;
  allowNetwork: boolean;
  /** Folder a local document may read from. Everything outside it is blocked. */
  fileRoot?: string;
  /** Markdown may embed pictures from its folder, nothing else: no iframes onto other files. */
  fileImagesOnly?: boolean;
  setup: PageSetup;
  o: PrintOptions;
}

function fileRequestAllowed(r: HtmlRender, requestUrl: string, resourceType: string): boolean {
  if (requestUrl === r.url) return true;
  if (!r.fileRoot) return false;
  if (r.fileImagesOnly && resourceType !== 'image') return false;
  let target: string;
  try {
    target = path.resolve(fileURLToPath(requestUrl)).toLowerCase();
  } catch {
    return false;
  }
  const root = path.resolve(r.fileRoot).toLowerCase();
  return target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

async function htmlToPdf(r: HtmlRender): Promise<Buffer> {
  const browser = await getBrowser();
  // A fresh context per job: no cookies or storage leak from one document to the next.
  const ctx = await browser.newContext({ javaScriptEnabled: r.javascript, serviceWorkers: 'block', acceptDownloads: false, offline: !r.allowNetwork });
  try {
    const hostVerdicts = new Map<string, Promise<boolean>>();
    await ctx.route('**/*', async route => {
      const request = route.request();
      const requestUrl = request.url();
      const scheme = requestUrl.slice(0, requestUrl.indexOf(':')).toLowerCase();
      if (scheme === 'file') return fileRequestAllowed(r, requestUrl, request.resourceType()) ? route.continue() : route.abort();
      if (scheme === 'http' || scheme === 'https' || scheme === 'ws' || scheme === 'wss') {
        if (!r.allowNetwork) return route.abort();
        if (!r.o.allow_private_network) {
          const host = new URL(requestUrl).hostname;
          if (!hostVerdicts.has(host)) hostVerdicts.set(host, isInternalHost(host));
          if (await hostVerdicts.get(host)) return route.abort();
        }
      }
      return route.continue();
    });
    const tab = await ctx.newPage();
    tab.setDefaultTimeout(45000);
    if (r.url) {
      const response = await tab.goto(r.url, { waitUntil: 'load', timeout: 45000 });
      // A 404 or login wall is not the document; printing it would waste paper silently.
      if (response && !response.ok()) throw new Error(`${new URL(r.url).host} answered HTTP ${response.status()}; nothing was printed.`);
      // Pages with endless polling never go idle; a late screenshot beats no print at all.
      await tab.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
    } else {
      await tab.setContent(r.html!, { waitUntil: 'load', timeout: 30000 });
    }
    if (r.javascript) await tab.evaluate(() => (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready).catch(() => undefined);
    if (r.o.wait_ms) await tab.waitForTimeout(r.o.wait_ms);
    const { widthMm, heightMm, landscape, insetMm } = r.setup;
    const pdf = await tab.pdf({
      width: `${landscape ? heightMm : widthMm}mm`, height: `${landscape ? widthMm : heightMm}mm`,
      margin: { top: `${insetMm.top}mm`, right: `${insetMm.right}mm`, bottom: `${insetMm.bottom}mm`, left: `${insetMm.left}mm` },
      printBackground: r.o.print_background ?? true, preferCSSPageSize: false,
    });
    return Buffer.from(pdf);
  } finally {
    await ctx.close().catch(e => console.error('print-mcp: context close:', e.message));
    idleTimer = setTimeout(() => { void closeBrowser(); }, BROWSER_IDLE_MS);
    idleTimer.unref();
  }
}

// ---------- Office ----------

async function officeToPdf(file: string, workDir: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Office documents need Microsoft Office on Windows.');
  const out = path.join(workDir, 'office.pdf');
  await runPowerShell(path.join(SCRIPTS_DIR, 'office-to-pdf.ps1'), JSON.stringify({ input: file, output: out }), 180000, stdout => {
    // COM servers are not our children, so killing the script would orphan a hung Office.
    for (const m of stdout.matchAll(/^office-pid (\d+)/gm)) {
      try {
        process.kill(Number(m[1]));
      } catch (e) {
        console.error(`print-mcp: could not stop Office process ${m[1]}:`, (e as Error).message);
      }
    }
  });
  if (!fs.existsSync(out)) throw new Error('Office produced no PDF.');
  return out;
}

// ---------- images ----------

async function imageToDocument(bytes: Buffer, ext: string): Promise<{ data: Buffer; magic: string }> {
  // Multi-page TIFF stays intact; mupdf reads every frame.
  const isTiff = (bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d);
  if (isTiff || ext === '.tif' || ext === '.tiff') return { data: bytes, magic: 'image/tiff' };
  const sharp = await loadSharp();
  // Applies EXIF rotation, converts CMYK and P3 to sRGB and flattens transparency onto paper white.
  const data = await sharp(bytes, { limitInputPixels: 400_000_000 }).rotate().flatten({ background: '#ffffff' }).toColourspace('srgb').png({ compressionLevel: 1 }).toBuffer();
  return { data, magic: 'image/png' };
}

// ---------- entry ----------

export async function openSource(input: SourceInput, o: PrintOptions, setup: PageSetup, keepPdfBytes: boolean): Promise<OpenDoc> {
  const mupdf = await loadMupdf();
  const work = { dir: '' };
  const tempDir = () => (work.dir ||= makeTempDir());
  const wrap = (doc: MuDocument, name: string, kind: Kind, generated: boolean, fingerprint: string, pdfBytes?: Buffer): OpenDoc => {
    if (doc.needsPassword() && (!o.password || !doc.authenticatePassword(o.password))) {
      doc.destroy();
      if (work.dir) removeDir(work.dir);
      throw new Error(o.password ? 'That password does not open this PDF.' : 'This document is password protected. Pass password.');
    }
    // EPUB and friends paginate to the paper; layout is a no-op on fixed formats.
    if (kind === 'mupdf') doc.layout(setup.widthMm * 72 / 25.4, setup.heightMm * 72 / 25.4, o.font_size_pt ?? 11);
    const count = doc.countPages();
    if (count < 1) { doc.destroy(); throw new Error('The document has no pages.'); }
    return {
      doc, count, name, kind, generated, pdfBytes, fingerprint,
      close: () => { doc.destroy(); if (work.dir) removeDir(work.dir); },
    };
  };
  const fromPdf = (bytes: Uint8Array, name: string, kind: Kind, generated: boolean, fingerprint: string, keep?: Buffer) =>
    wrap(mupdf.Document.openDocument(bytes, 'application/pdf'), name, kind, generated, fingerprint, keep);
  const htmlDoc = async (html: string, name: string, kind: Kind, fingerprint: string, baseFile?: string, jsDefault = false, netDefault = false) => {
    let render: HtmlRender;
    if (baseFile) {
      // Written beside the temp dir, referencing the source folder so relative images resolve.
      const htmlWithBase = html.replace(/<head>/i, `<head><base href="${pathToFileURL(path.dirname(baseFile) + path.sep).href}">`);
      const tmp = path.join(tempDir(), 'doc.html');
      fs.writeFileSync(tmp, htmlWithBase);
      render = { url: pathToFileURL(tmp).href, javascript: o.javascript ?? jsDefault, allowNetwork: o.allow_network ?? netDefault, fileRoot: path.dirname(baseFile), fileImagesOnly: true, setup, o };
    } else {
      render = { html, javascript: o.javascript ?? jsDefault, allowNetwork: o.allow_network ?? netDefault, setup, o };
    }
    const pdf = await htmlToPdf(render);
    return fromPdf(pdf, name, kind, true, fingerprint);
  };

  try {
    // Inline content
    if (input.content !== undefined) {
      if (input.source) throw new Error('Pass either source or content, not both.');
      if (!input.content.trim()) throw new Error('content is empty; nothing to print.');
      const name = input.job_name ?? 'Text';
      const fmt = !input.format || input.format === 'auto' ? sniffContentFormat(input.content) : input.format;
      const fp = `content:${input.content}`;
      if (fmt === 'html') return await htmlDoc(input.content, name, 'html', fp);
      if (fmt === 'markdown') return await htmlDoc(await markdownToHtml(input.content, name, o), name, 'markdown', fp);
      if (fmt === 'csv') return await htmlDoc(csvToHtml(input.content, name, '.csv', o), name, 'csv', fp);
      return await htmlDoc(textToHtml(input.content, name, '', o), name, 'text', fp);
    }
    if (!input.source?.trim()) throw new Error('Nothing to print: pass source (file path or URL) or content (literal text).');
    const source = input.source.trim();

    // data: URI
    if (source.startsWith('data:')) {
      const m = /^data:([^;,]*)(;base64)?,/.exec(source.slice(0, 200));
      if (!m) throw new Error('Malformed data: URI.');
      const raw = source.slice(source.indexOf(',') + 1);
      const bytes = m[2] ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw));
      return await fromBytes(bytes, input.job_name ?? 'Document', extFromMime(m[1]), `data:${bytes.length}:${raw.slice(0, 2048)}`);
    }

    // URL
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      // HEAD only decides "file or web page", so a one-time link is not spent before the real
      // request. Some sites refuse non-browser clients: a failed probe still gets a browser attempt.
      const probe = await guardedFetch(url, 'HEAD', o);
      const final = probe.finalUrl;
      const headType = probe.response?.ok ? (probe.response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() : '';
      const ext = path.extname(final.pathname).toLowerCase();
      const name = input.job_name ?? (safeDecode(final.pathname.split('/').pop() ?? '') || final.host);
      const webPage = headType ? /html/.test(headType) || headType.startsWith('text/') : !(ext === '.pdf' || IMAGE_EXT.has(ext) || OFFICE_EXT.has(ext) || MUPDF_EXT[ext]);
      if (!webPage) {
        const got = await guardedFetch(final, 'GET', o);
        if (!got.response?.ok) throw new Error(`${final.host} answered HTTP ${got.response?.status ?? 'no response'}; nothing was printed.`);
        const type = (got.response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (Number(got.response.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) throw new Error('Download is over the 512 MB limit.');
        const bytes = Buffer.from(await got.response.arrayBuffer());
        if (bytes.length > MAX_DOWNLOAD) throw new Error('Download is over the 512 MB limit.');
        return await fromBytes(bytes, name, extFromMime(type) || ext, `url:${source}`);
      }
      const pdf = await htmlToPdf({ url: final.href, javascript: o.javascript ?? true, allowNetwork: o.allow_network ?? true, setup, o });
      return fromPdf(pdf, name, 'url', true, `url:${source}`);
    }
    if (/^[a-z][a-z0-9+.-]+:\/\//i.test(source) && !source.toLowerCase().startsWith('file://')) {
      throw new Error(`Only file paths and http(s) URLs can be printed, not ${source.split(':')[0]}://`);
    }

    // Local file. A missing path is an error, never text to print: printing the literal
    // string "C:\report.pdf" would waste paper and hide the real problem.
    const file = resolveLocalPath(source);
    assertLocalPathAllowed(file, o);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      throw new Error(`File not found: ${file}. To print literal text use content instead of source.`);
    }
    if (stat.isDirectory()) throw new Error(`${file} is a folder. Pass a file.`);
    if (stat.size === 0) throw new Error(`${file} is empty.`);
    if (stat.size > MAX_FILE) throw new Error(`${file} is over the 1 GB limit.`);
    const ext = path.extname(file).toLowerCase();
    const name = input.job_name ?? path.basename(file);
    const fp = `file:${file}:${stat.size}:${stat.mtimeMs}`;
    const bytes = fs.readFileSync(file);
    return await fromBytes(bytes, name, ext, fp, file);

    async function fromBytes(bytes: Buffer, name: string, ext: string, fp: string, file?: string): Promise<OpenDoc> {
      const kind = classifyBytes(bytes.subarray(0, 4096), ext);
      switch (kind) {
        case 'pdf':
          return fromPdf(bytes, name, 'pdf', false, fp, keepPdfBytes ? bytes : undefined);
        case 'image': {
          const img = await imageToDocument(bytes, ext);
          return wrap(mupdf.Document.openDocument(img.data, img.magic), name, 'image', false, fp);
        }
        case 'mupdf':
          return wrap(mupdf.Document.openDocument(bytes, MUPDF_EXT[ext] ?? 'application/pdf'), name, 'mupdf', false, fp);
        case 'office': {
          let local = file;
          if (!local) { local = path.join(tempDir(), `download${ext}`); fs.writeFileSync(local, bytes); }
          const pdf = await officeToPdf(local, tempDir());
          return fromPdf(fs.readFileSync(pdf), name, 'office', false, fp);
        }
        case 'html':
          if (file && ext !== '.svg') {
            const pdf = await htmlToPdf({ url: pathToFileURL(file).href, javascript: o.javascript ?? true, allowNetwork: o.allow_network ?? true, fileRoot: path.dirname(file), setup, o });
            return fromPdf(pdf, name, 'html', true, fp);
          }
          return await htmlDoc(decodeText(bytes), name, 'html', fp);
        case 'markdown':
          return await htmlDoc(await markdownToHtml(decodeText(bytes), name, o), name, 'markdown', fp, file);
        case 'csv':
          return await htmlDoc(csvToHtml(decodeText(bytes), name, ext, o), name, 'csv', fp);
        case 'text':
          if (input.format === 'markdown') return await htmlDoc(await markdownToHtml(decodeText(bytes), name, o), name, 'markdown', fp, file);
          return await htmlDoc(textToHtml(decodeText(bytes), name, ext, o), name, 'text', fp);
        default:
          throw new Error(`Cannot tell how to print "${name}" (binary, unknown type). Supported: PDF, images, Office, HTML, Markdown, CSV, text, XPS, EPUB.`);
      }
    }
  } catch (e) {
    if (work.dir) removeDir(work.dir);
    throw e;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // a stray % in a URL must not fail the print over a cosmetic job name
  }
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  const map: Record<string, string> = {
    'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/tiff': '.tiff', 'image/bmp': '.bmp', 'image/svg+xml': '.svg',
    'text/plain': '.txt', 'text/markdown': '.md', 'text/html': '.html', 'text/csv': '.csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/msword': '.doc', 'application/vnd.ms-excel': '.xls', 'application/vnd.ms-powerpoint': '.ppt',
  };
  return map[m] ?? '';
}
