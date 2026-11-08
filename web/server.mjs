// Web UI for print-mcp. It is an MCP client: every button calls the same tool the AI would.
// Run: npm run web   ->  http://localhost:4177
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4177);
const HOST = process.env.HOST ?? '127.0.0.1';
const UPLOADS = path.join(os.tmpdir(), 'print-web-uploads');
const SCANS = path.join(os.homedir(), 'Documents', 'Scans');
const MAX_UPLOAD = 200 * 1024 * 1024;
const TOOLS = new Set(['print', 'preview', 'list_printers', 'printer_status', 'job_status', 'scan', 'cancel_job',
  'print_test_page', 'identify_printer', 'configure_printer', 'fix_printer', 'manage_presets', 'image_edit', 'manage_templates', 'layout_page', 'tool_list', 'tool_use', 'tool_write', 'tool_edit', 'tool_remove']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

fs.mkdirSync(UPLOADS, { recursive: true });
// Uploads are only needed while a job renders; drop anything older than a day.
for (const f of fs.readdirSync(UPLOADS)) { const p = path.join(UPLOADS, f); if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.rmSync(p, { force: true }); }

const client = new Client({ name: 'print-web', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, '..', 'dist', 'index.js')],
  stderr: 'inherit',
  env: { ...process.env, PRINT_WEB_CHILD: '1' },   // this child must not announce its own calls to the page
}));

const clients = new Set(), pending = new Map();
const emit = (ev, data) => { for (const c of clients) c.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
// The page may only read files from the uploads folder, so a file the AI prints is copied there for display.
function copyForDisplay(src) {
  if (typeof src !== 'string' || /^(https?|data):/i.test(src)) return null;
  try {
    let p = src.trim().replace(/^["']|["']$/g, ''); if (p.startsWith('file://')) p = decodeURIComponent(new URL(p).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
    if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1)); p = path.resolve(p);
    const st = fs.statSync(p); if (!st.isFile() || st.size > 100 * 1024 * 1024) return null;
    const out = path.join(UPLOADS, `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${path.extname(p).replace(/[^.\w]/g, '').slice(0, 10)}`); fs.copyFileSync(p, out); return out;
  } catch { return null; }
}
const send = (res, code, body, type = 'application/json', cache = 'no-store') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

const readBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('File too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// A file may only be served from the two folders this app writes to.
const inside = (file, dir) => { const r = path.relative(dir, file); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

// Browsers on other sites can reach localhost; only accept requests that name this host.
const trusted = req => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  const origin = req.headers.origin;
  const hostOk = HOST !== '127.0.0.1' || ['localhost', '127.0.0.1', '[::1]'].includes(host);
  return hostOk && (!origin || new URL(origin).host === req.headers.host);
};

async function handle(req, res) {
  if (!trusted(req)) return send(res, 403, { error: 'Forbidden' });
  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST' && url.pathname.startsWith('/api/tool/')) {
    const name = url.pathname.slice('/api/tool/'.length);
    if (!TOOLS.has(name)) return send(res, 404, { error: 'Unknown tool' });
    const args = JSON.parse((await readBody(req, 1e6)).toString() || '{}');
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 5 * 60_000 });
    const text = r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    const images = r.content.filter(c => c.type === 'image').map(c => `data:${c.mimeType};base64,${c.data}`);
    let data; try { data = JSON.parse(text); } catch { /* plain text answer */ }
    if (Array.isArray(data?.files)) data.shown = data.files.map(f => copyForDisplay(f.path ?? f)).filter(Boolean);
    return send(res, 200, { ok: !r.isError, text, data, images });
  }

  // ---- AI presence: MCP calls are shown on the page as a cursor (see src/theater.ts) ----
  if (req.method === 'GET' && url.pathname === '/api/ai/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': open\n\n'); clients.add(res);
    const beat = setInterval(() => res.write(': beat\n\n'), 15000);
    req.on('close', () => { clearInterval(beat); clients.delete(res); });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/ai/begin') {
    if (!clients.size) return send(res, 200, { live: false });
    const { tool, args = {} } = JSON.parse((await readBody(req, 2e6)).toString() || '{}');
    const shown = copyForDisplay(args.source); if (shown) args.shown = shown;
    if (Array.isArray(args.items)) for (const it of args.items) { const sh = copyForDisplay(it?.source); if (sh) it.shown = sh; }
    const id = Math.random().toString(36).slice(2, 10);
    emit('begin', { id, tool, args });
    await new Promise(r => { pending.set(id, r); setTimeout(() => { pending.delete(id); r(); }, 14000); });
    return send(res, 200, { live: true, id });
  }
  if (req.method === 'POST' && url.pathname === '/api/ai/ready') { const { id } = JSON.parse((await readBody(req, 1e5)).toString() || '{}'); pending.get(id)?.(); pending.delete(id); return send(res, 200, { ok: true }); }
  if (req.method === 'POST' && url.pathname === '/api/ai/end') {
    const ev = JSON.parse((await readBody(req, 2e6)).toString() || '{}');
    // Result files (an edited image, say) are copied to the uploads folder so the page may show them.
    try { const d = JSON.parse(ev.text); if (Array.isArray(d?.files)) ev.shownFiles = d.files.map(f => copyForDisplay(f.path ?? f)).filter(Boolean); } catch { /* not JSON */ }
    emit('end', ev); return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const ext = path.extname(url.searchParams.get('name') ?? '').replace(/[^.\w]/g, '').slice(0, 10);
    const file = path.join(UPLOADS, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    fs.writeFileSync(file, await readBody(req, MAX_UPLOAD));
    return send(res, 200, { path: file, dir: UPLOADS });
  }

  if (req.method === 'GET' && url.pathname === '/api/file') {
    const file = path.resolve(url.searchParams.get('path') ?? '');
    if (!inside(file, SCANS) && !inside(file, UPLOADS)) return send(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file)) return send(res, 404, { error: 'Not found' });
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const dl = url.searchParams.has('dl') ? { 'content-disposition': `attachment; filename="${path.basename(file)}"` } : {};
    res.writeHead(200, { 'content-type': type, ...dl });
    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(here, 'public', rel);
    if (!inside(file, path.join(here, 'public')) || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
    const long = /^(fonts|vendor)\//.test(rel) ? 'public, max-age=604800' : 'no-store';
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream', long);
  }
  send(res, 405, { error: 'Method not allowed' });
}

const server = http.createServer((req, res) => handle(req, res).catch(e => send(res, 500, { ok: false, text: String(e.message ?? e), images: [] })));
const URL_ = `http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`;

// App window: a browser in --app mode has no tabs or address bar, so the studio feels like a program that stays open.
function openApp() {
  const win = process.platform === 'win32';
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const found = win ? pf.flatMap(b => [`${b}\Microsoft\Edge\Application\msedge.exe`, `${b}\Google\Chrome\Application\chrome.exe`]).find(p => fs.existsSync(p)) : null;
  const cmd = found ?? (win ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open');
  const args = found ? [`--app=${URL_}`] : win ? ['/c', 'start', '', URL_] : [URL_];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => { }).unref();
}
const wantsWindow = process.argv.includes('--open');
server.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Already running: just bring up a window on it.
  console.log(`Print Studio is already running at ${URL_}`); if (wantsWindow) openApp(); setTimeout(() => process.exit(0), 300);
});
server.listen(PORT, HOST, () => { console.log(`Print studio: ${URL_}`); if (wantsWindow) openApp(); });

process.on('exit', () => client.close());
