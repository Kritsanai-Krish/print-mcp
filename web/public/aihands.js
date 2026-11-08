// A second person at the desk. When an MCP client calls a tool, the server tells this page (server-sent events);
// a labelled cursor travels over the real controls, opens the real popups and sets the real fields, then the tool runs.
// The last press is only drawn: the tool itself is executed by the MCP server, so nothing is ever done twice.
import { h, icon, toast, trackJob, closePops as realClosePops, G } from './app.js';
const mode = () => { try { return localStorage.getItem('ps-ai-mode') || 'full'; } catch { return 'full'; } };
const closePops = () => { if (mode() === 'full') realClosePops(); };

const ARROW = '<svg viewBox="0 0 22 22"><path d="M3 2.2 3.6 18.6 8 14.4 10.9 20.4 13.8 19 10.9 13.2 17 12.6Z" fill="currentColor" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $q = k => document.querySelector(`[data-ai="${k}"]`);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let cursor, tag, tagText, status, lock, ring, pos = { x: Math.round(innerWidth * .72), y: Math.round(innerHeight * .8) }, current = null, skipping = false, idleTimer, queue = Promise.resolve();

function ensure() {
  if (cursor?.isConnected) return;
  tagText = h('span'); const sub = h('small');
  tag = h('span.tag', {}, tagText, sub); tag.sub = sub;
  cursor = h('div.aicur'); cursor.innerHTML = ARROW; cursor.append(tag); cursor.style.color = 'var(--ai)';
  cursor.style.transform = `translate(${pos.x}px,${pos.y}px)`;
  document.body.append(cursor);
}
const label = (name, sub = '') => { ensure(); tagText.textContent = name; tag.sub.textContent = sub; };

/** Wait until a control exists, because popups need a frame to appear. */
async function find(key, ms = 2000) {
  const end = now() + ms;
  while (now() < end) { const e = $q(key); if (e && e.getBoundingClientRect().width) return e; await sleep(40); }
  return null;
}

function moveTo(x, y, quick) {
  ensure();
  const from = { ...pos }, dx = x - from.x, dy = y - from.y, dist = Math.hypot(dx, dy);
  if (quick || skipping || dist < 2 || document.hidden) { pos = { x, y }; cursor.style.transform = `translate(${x}px,${y}px)`; return Promise.resolve(); }
  // A hand does not travel in a straight line: bow the path sideways a little, and slow down near the target.
  const bow = Math.min(60, dist * .12) * (dx > 0 ? -1 : 1), mx = from.x + dx * .5 - (dy / (dist || 1)) * bow, my = from.y + dy * .5 + (dx / (dist || 1)) * bow;
  const frames = Array.from({ length: 14 }, (_, i) => { const t = (i + 1) / 14, u = 1 - t; return { transform: `translate(${u * u * from.x + 2 * u * t * mx + t * t * x}px,${u * u * from.y + 2 * u * t * my + t * t * y}px)` }; });
  const dur = Math.max(380, Math.min(1100, dist * 1.15));
  const a = cursor.animate([{ transform: `translate(${from.x}px,${from.y}px)` }, ...frames], { duration: dur, easing: 'cubic-bezier(.3,.7,.25,1)', fill: 'forwards' });
  pos = { x, y };
  return a.finished.then(() => { cursor.style.transform = `translate(${x}px,${y}px)`; a.cancel(); }).catch(() => { });
}

function mark(el) {
  ring?.remove(); if (!el) return;
  const r = el.getBoundingClientRect();
  ring = h('div.airing', { style: `left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px` }); document.body.append(ring);
}

/** Travel to a control and rest on it. */
async function hover(key, wait = 2000) {
  const el = await find(key, wait); if (!el) return null;
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  await moveTo(r.left + Math.min(r.width * .55, r.width - 6), r.top + r.height * .55);
  mark(el); if (!skipping) await sleep(140);
  return el;
}
function ripple() {
  const p = h('div.airipple', { style: `left:${pos.x + 3}px;top:${pos.y + 3}px` }); document.body.append(p); setTimeout(() => p.remove(), 600);
  cursor.classList.add('press'); setTimeout(() => cursor.classList.remove('press'), 130);
}
/** Press the real control. `draw` presses it on screen only. */
async function click(key, { draw = false } = {}) {
  const el = await hover(key); if (!el) return false;
  ripple(); if (!skipping) await sleep(120);
  if (!draw) el.click();
  if (!skipping) await sleep(220);
  return true;
}

function showStatus(text) {
  status?.remove();
  status = h('div.aistatus', { role: 'status' }, h('span.d'), h('span', {}, text), h('kbd', {}, 'Esc'), h('span.muted', {}, 'ข้ามภาพเคลื่อนไหว'));
  document.body.append(status);
}
function takeOver() {
  lock = h('div.ailock'); document.body.append(lock);
}
function release() { lock?.remove(); lock = null; status?.remove(); status = null; ring?.remove(); ring = null; }
function fadeLater() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { cursor?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).finished.then(() => { cursor?.remove(); cursor = null; }); }, 5000); }
function wake() { clearTimeout(idleTimer); cursor?.getAnimations().forEach(x => x.cancel()); }

const TOOL_TH = { print: 'พิมพ์', preview: 'ดูตัวอย่าง', scan: 'สแกน', list_printers: 'ดูรายการเครื่องพิมพ์', printer_status: 'ดูสถานะเครื่องพิมพ์', job_status: 'ดูงานพิมพ์', cancel_job: 'ยกเลิกงานพิมพ์',
  print_test_page: 'พิมพ์หน้าทดสอบ', identify_printer: 'ระบุเครื่องพิมพ์', configure_printer: 'ตั้งค่าเครื่องพิมพ์', fix_printer: 'ตรวจและแก้ไขเครื่องพิมพ์', manage_presets: 'จัดการพรีเซ็ต', image_edit: 'แก้ไขรูปภาพ', manage_templates: 'จัดการเทมเพลต', layout_page: 'จัดหน้ากระดาษ', tool_list: 'ดูรายการสคริปต์', tool_use: 'เรียกใช้สคริปต์', tool_write: 'เขียนสคริปต์', tool_edit: 'แก้สคริปต์', tool_remove: 'ลบสคริปต์', print_raw: 'ส่งข้อมูลดิบ', install_printer: 'ติดตั้งไดรเวอร์' };

// ---- one choreography per tool; each returns once the cursor rests on the control the tool is about to use ----
const openPrinter = async () => { await click('printer-chip'); await find('printer-bell'); };
const SHOW = {
  async print(a) {
    const S = window.__studio; if (!S) return;
    if (a.shown || a.content || /^https?:/i.test(a.source ?? '')) {
      await click('dock-import'); await hover('import-drop', 1500);
      const src = a.shown ? { source: a.shown, job_name: a.job_name ?? 'เอกสาร' } : a.content ? { content: a.content, format: a.format ?? 'auto' } : { source: a.source };
      closePops(); await S.importDoc(src, a.job_name || a.source?.split(/[\\/]/).pop() || 'เอกสาร', { dpi: 110, limit: 3, quiet: true });
    }
    await moveTo(innerWidth / 2, innerHeight / 2);
    await click('print', { draw: true });
    const sheet = S.printSheet({ sim: true, ai: a });
    // Fields the tool call set are visible on the real controls.
    for (const [k, v] of Object.entries({ color: a.color, quality: a.quality, duplex: a.duplex })) if (v && await find(`${k}:${v}`, 600)) await click(`${k}:${v}`);
    if (a.copies > 1) for (let i = 1; i < Math.min(a.copies, 6); i++) await click('copies:+');
    await find('print-go', 1500); await sleep(skipping ? 0 : 600);
    await hover('print-go', 6000);
    current.sheet = sheet;
  },
  async scan(a) {
    await click('dock-scan'); await find('scan-go');
    const map = { source: a.source, color: a.color, dpi: a.dpi };
    for (const [k, v] of Object.entries(map)) if (v) await click(`scan-${k}-${v}`);
    await hover('scan-go');
  },
  async list_printers() { await openPrinter(); },
  async printer_status() { await openPrinter(); },
  async identify_printer() { await openPrinter(); await hover('printer-bell'); },
  async fix_printer() { await openPrinter(); await hover('printer-wrench'); },
  async print_test_page() { await openPrinter(); await hover('printer-file'); },
  async job_status() { await click('jobs'); await sleep(skipping ? 0 : 700); },
  async cancel_job(a) { await click("jobs"); if (a.job) await hover('job-' + a.job, 1500); else if (a.printer_job_id) { closePops(); await openPrinter(); await hover('printer-job-' + a.printer_job_id, 1500); } },
  async image_edit(a) {
    const S = window.__studio;
    if (a.shown) { await click('dock-import'); await hover('import-drop', 1500); closePops(); await S.addImageUrl('/api/file?path=' + encodeURIComponent(a.shown), 'ภาพต้นฉบับ'); }
    S.selectLast(); await find('img-tools', 1500) && await click('img-tools');
    const op = a.ops?.[0]?.op; if (op && await find('imgtool-' + op, 800)) await hover('imgtool-' + op);
  },
  async tool_list() { await click('dock-scripts'); },
  async tool_use() { await click('dock-scripts'); },
  async tool_write() { await click('dock-scripts'); },
  async tool_edit() { await click('dock-scripts'); },
  async tool_remove() { await click('dock-scripts'); },
  async manage_templates() { await click('dock-tpl'); await sleep(skipping ? 0 : 900); },
  async configure_printer() { await click('settings', { draw: false }); await sleep(skipping ? 0 : 500); },
  async manage_presets() { await click('settings', { draw: false }); await sleep(skipping ? 0 : 500); },
  async preview(a) { await SHOW.list_printers(); },
};

// ---- what happens when the tool has finished ----
const DONE = {
  async print(a, res) {
    if (current.sheet) { const go = $q('print-go'); if (go) { ripple(); go.replaceChildren(h('span.spin'), 'กำลังส่ง…'); } await sleep(skipping ? 0 : 450); current.sheet?.close(); }
    let d; try { d = JSON.parse(res.text); } catch { /* plain error text */ }
    if (res.ok && d?.state === 'dry_run') toast('ตรวจแล้ว ยังไม่ได้พิมพ์จริง');
    else if (res.ok && d?.job) { toast(`ส่งไปที่ ${d.printer ?? 'เครื่องพิมพ์'} แล้ว`, 'ok'); trackJob(d.job, d.document ?? 'งานพิมพ์'); }
    else if (!res.ok) toast(String(res.text).slice(0, 200), 'bad');
  },
  async scan(a, res) {
    closePops(); const S = window.__studio;
    if (!res.ok) return toast(String(res.text).slice(0, 200), 'bad');
    S.setBusy('กำลังสแกน…'); await sleep(skipping ? 0 : 300);
    try {
      const d = JSON.parse(res.text), files = d.files ?? [];
      // A PDF scan is shown the way the print engine sees it; images go straight onto the paper.
      if (files.some(f => /\.pdf$/i.test(f))) await S.importDoc({ source: files[0] }, 'สแกน', { dpi: 150, quiet: true });
      else { await S.insertScanned(files); S.selectLast(); }
      toast(`สแกนเสร็จ ${files.length} ไฟล์`, 'ok');
    } catch { toast('ได้ไฟล์สแกนแล้ว แต่วางบนกระดาษไม่สำเร็จ', 'bad'); }
    S.setBusy(null);
  },
  async image_edit(a, res) {
    closePops(); const S = window.__studio;
    if (!res.ok) return toast(String(res.text).slice(0, 200), 'bad');
    const files = res.shownFiles ?? [];
    for (let i = 0; i < files.length; i++) await S.addImageUrl('/api/file?path=' + encodeURIComponent(files[i]), 'ผลลัพธ์ ' + (i + 1), i === 0 && !!a.shown);
    toast(files.length > 1 ? `Claude แยกได้ ${files.length} ภาพ` : 'Claude แก้ไขรูปเสร็จแล้ว', 'ok');
  },
  async layout_page(a, res) { if (!res.ok || !a.items?.length) return; try { const n = await window.__studio.layoutItems(a); if (n) toast('Claude จัดหน้าใหม่ให้แล้ว (หน้าที่ ' + (window.__design.D.cur + 1) + ')', 'ok'); } catch (e) { console.warn('layout mirror', e); } },
  async tool_use(a, res) { await addScriptImages(res); },
  async tool_write(a, res) { await addScriptImages(res); },
  async manage_templates(a, res) { closePops(); if (res.ok && a.action && a.action !== 'list' && a.action !== 'get') toast('อัปเดตเทมเพลตแล้ว', 'ok'); },
  async cancel_job(a, res) { toast(res.ok ? 'ยกเลิกงานแล้ว' : String(res.text).slice(0, 160), res.ok ? 'ok' : 'bad'); },
};

async function addScriptImages(res) {
  closePops(); if (!res.ok) return toast(String(res.text).slice(0, 200), 'bad');
  const imgs = (res.shownFiles ?? []).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f));
  for (let i = 0; i < imgs.length; i++) await window.__studio.addImageUrl('/api/file?path=' + encodeURIComponent(imgs[i]), 'ผลจากสคริปต์ ' + (i + 1));
  toast(imgs.length ? `Claude เรียกสคริปต์แล้ว ได้ ${imgs.length} ภาพ` : 'Claude เรียกสคริปต์แล้ว', 'ok');
}
async function run(ev) {
  const m = mode();
  current = { id: ev.id, tool: ev.tool, args: ev.args ?? {}, mode: m }; skipping = true;
  if (m === 'off') { fetch('/api/ai/ready', { method: 'POST', body: JSON.stringify({ id: ev.id }) }).catch(() => { }); return; }
  if (m === 'semi') { showStatus(`Claude กำลัง${TOOL_TH[ev.tool] ?? ev.tool}`); fetch('/api/ai/ready', { method: 'POST', body: JSON.stringify({ id: ev.id }) }).catch(() => { }); return; }
  wake(); ensure(); takeOver();
  label('Claude', TOOL_TH[ev.tool] ?? ev.tool); showStatus(`Claude กำลัง${TOOL_TH[ev.tool] ?? ev.tool}`);
  closePops(); document.querySelector('.backdrop')?.remove();
  try { await (SHOW[ev.tool]?.(current.args) ?? 0); } catch (e) { console.warn('ai hands', e); }
  fetch('/api/ai/ready', { method: 'POST', body: JSON.stringify({ id: ev.id }) }).catch(() => { });
}
async function finish(ev) {
  if (current?.id !== ev.id) return;
  const m = current.mode ?? mode();
  const quiet = m !== 'full';
  if (m === 'off' && !['image_edit', 'scan', 'layout_page', 'tool_use', 'tool_write'].includes(current.tool)) { current = null; return; }
  try { await DONE[current.tool]?.(current.args, ev); } catch (e) { console.warn('ai hands', e); }
  if (quiet) { release(); if (m === 'semi') { label('Claude', ev.ok ? 'เสร็จแล้ว' : 'ไม่สำเร็จ'); } current = null; return; }
  await sleep(skipping ? 0 : 700);
  if (current.tool !== 'print' && current.tool !== 'scan') closePops();
  release(); label('Claude', ev.ok ? 'เสร็จแล้ว' : 'ไม่สำเร็จ'); fadeLater(); current = null;
}

export function startAiHands() {
  addEventListener('keydown', e => { if (e.key === 'Escape' && current) { skipping = true; e.stopPropagation(); } }, true);
  const open = () => {
    const es = new EventSource('/api/ai/stream');
    es.addEventListener('begin', e => { const ev = JSON.parse(e.data); queue = queue.then(() => run(ev)); });
    es.addEventListener('end', e => { const ev = JSON.parse(e.data); queue = queue.then(() => finish(ev)); });
    es.onerror = () => { es.close(); setTimeout(open, 2500); };
  };
  open();
}
