// Design editor (Canva style) on Fabric.js. Paper first; every other tool opens a popup.
import { installElements } from './elements.js';
import { installDraw } from './draw.js';
import { installImageTools } from './imagetools.js';
import { installTemplates } from './templates.js';
import { installScripts } from './scripts.js';
import { installExports } from './exports.js';
import { h, icon, ICON, api, toast, modal, askText, confirmBox, sendPrint, G, clean, curPrinter, panel, pop, sheet, closePops, colorPop, popPrinter, popJobs, popSettings, applyTheme, getTheme, debounce } from './app.js';

Object.assign(ICON, {
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>', redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>',
  shapes: '<rect x="3" y="12" width="9" height="9" rx="1"/><circle cx="16.5" cy="7.5" r="4.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
  tpl: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.9 17.9A10 10 0 0 1 12 19c-6 0-10-7-10-7a18 18 0 0 1 5-5.7M9.9 4.2A9 9 0 0 1 12 4c6 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/>',
  aL: '<path d="M4 6h16M4 12h10M4 18h14"/>', aC: '<path d="M4 6h16M7 12h10M5 18h14"/>', aR: '<path d="M4 6h16M10 12h10M6 18h14"/>', aJ: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  flip: '<path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z"/>', group: '<rect x="3" y="3" width="13" height="13" rx="2"/><rect x="8" y="8" width="13" height="13" rx="2"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>', fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  ruler: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>', drop: '<path d="M12 2.7S5 10 5 14.5a7 7 0 0 0 14 0C19 10 12 2.7 12 2.7z"/>',
  more: '<path d="M12 12h.01M19 12h.01M5 12h.01"/>', folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  page: '<rect x="5" y="3" width="14" height="18" rx="2"/>', aligncv: '<path d="M12 3v18M6 8h12M8 14h8"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  magic: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z"/>',
  pen: '<path d="M3 21l3.5-1 12-12a2.1 2.1 0 0 0-3-3l-12 12zM14 7l3 3"/>', shapes2: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><circle cx="17" cy="7" r="4"/><path d="M12 21l4.5-8 4.5 8z"/>',
  cH: '<path d="M12 3v18M7 6h10v4H7zM5 14h14v4H5z"/>', cV: '<path d="M3 12h18M6 7v10h4V7zM14 5v14h4V5z"/>', keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>', repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>', wand: '<path d="M4 4h16v16H4z" stroke-dasharray="3 3"/><path d="M9 9h6v6H9z"/>',
});

const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
/** Stamps the real resolution into the PNG (pHYs chunk), so the print engine lays it out at its true physical size. */
async function pngWithDpi(dataURL, dpi) {
  const buf = new Uint8Array(await (await fetch(dataURL)).arrayBuffer()), ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1; dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(buf.length + 21); out.set(buf.subarray(0, 33)); out.set(chunk, 33); out.set(buf.subarray(33), 54);
  return new Blob([out], { type: 'image/png' });
}
const PX = 96 / 25.4;                    // design units are CSS px at 96 dpi
const SIZES = [['A4', 210, 297, 'A4'], ['A5', 148, 210, 'A5'], ['A6', 105, 148, 'A6'], ['Letter', 215.9, 279.4, 'letter'], ['Legal', 215.9, 355.6, 'legal'], ['4×6"', 101.6, 152.4, '4x6'], ['5×7"', 127, 177.8, '5x7'], ['ภาพ L', 89, 127, 'photo-l']];
const BUNDLED = ['Kanit', 'Prompt', 'Sarabun', 'Mitr', 'Pridi', 'Itim', 'Chonburi', 'Niramit', 'K2D', 'Mali', 'Noto Serif Thai', 'Bai Jamjuree', 'Athiti', 'Pattaya', 'Charm', 'Maitree', 'Krub', 'Srisakdi', 'Trirong', 'Taviraj', 'Pacifico', 'Oswald', 'Playfair Display', 'Bebas Neue', 'Lobster'];
const FONT_CANDIDATES = ['Leelawadee UI', 'Tahoma', 'Segoe UI', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Courier New', 'Consolas', 'Cordia New', 'Angsana New', 'Browallia New', 'DilleniaUPC', 'TH Sarabun New', 'Noto Sans Thai', 'Sarabun', 'Kanit', 'Prompt', 'Mitr'];
const KEEP = ['name', 'lockMovementX', 'lockMovementY', 'lockRotation', 'lockScalingX', 'lockScalingY', 'selectable', 'evented', 'locked'];
const STORE = 'ps-design-v1';
const DEF_FONT = 'Leelawadee UI';

let fabricP;
const loadFabric = () => fabricP ??= new Promise((res, rej) => {
  if (window.fabric) return res();
  const s = document.createElement('script'); s.src = 'vendor/fabric.min.js'; s.onload = res; s.onerror = () => rej(new Error('โหลด Fabric.js ไม่ได้')); document.head.append(s);
});
const hasFont = (() => {
  const c = document.createElement('canvas').getContext('2d'); const t = 'ทดสอบสวัสดี Hamburgefonts 0123';
  const w = f => { c.font = `40px ${f}`; return c.measureText(t).width; };
  const base = ['monospace', 'serif', 'sans-serif'].map(b => [b, w(b)]);
  return n => base.some(([b, bw]) => w(`"${n}",${b}`) !== bw);
})();

// Projects live in IndexedDB (images make them too big for localStorage).
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('print-studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbGet = async k => { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return undefined; } };
const idbSet = async (k, v) => { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = rej; }); } catch { /* private mode: nothing to do */ } };
let D;
async function loadStore() {
  const s = await idbGet(STORE);
  if (s?.pages?.length) return { unit: 'cm', rulers: true, ...s, guides: s.guides ?? { v: [], h: [] }, thumbs: [] };
  return { name: 'งานใหม่', w: 210, h: 297, pages: [null], cur: 0, thumbs: [], grid: false, safe: false, unit: 'cm', rulers: true, guides: { v: [], h: [] } };
}

export async function viewDesign(el) {
  try { await loadFabric(); } catch (e) { el.append(h('div.note.bad', {}, icon('alert'), e.message)); return; }
  const fabric = window.fabric;
  D = await loadStore();
  const OD = fabric.FabricObject.ownDefaults;
  Object.assign(OD, { originX: 'left', originY: 'top', transparentCorners: false, cornerColor: '#ffffff', cornerStrokeColor: '#2f55c9', borderColor: '#2f55c9', cornerSize: 11, cornerStyle: 'circle', borderScaleFactor: 1.8, padding: 2 });

  const pw = () => Math.round(D.w * PX), ph = () => Math.round(D.h * PX);
  let zoom = 1, fitMode = true, busy = true, alive = true;
  const sysFonts = FONT_CANDIDATES.filter(hasFont), fonts = [...BUNDLED, ...sysFonts];
  const ensureFont = async f => { await Promise.all([document.fonts.load(`400 24px "${f}"`), document.fonts.load(`700 24px "${f}"`)]).catch(() => { }); };

  // ---------- DOM ----------
  const canvasEl = h('canvas');
  const ov = h('div.ov'); const gv = h('i.gl.v'), gh = h('i.gl.h'); ov.append(gv, gh);
  const host = h('div.pagehost', {}, canvasEl, ov);
  const stage = h('div.dstage', {}, host);
  const ctxBar = h('div.dctx'); ctxBar.hidden = true;
  const rulerH = h('canvas.ruler.h'), rulerV = h('canvas.ruler.v'), rmH = h('i.rmark.h'), rmV = h('i.rmark.v');
  const corner = h('button.rcorner', { type: 'button', title: 'เปลี่ยนหน่วยวัด (มม. / ซม. / นิ้ว)', onclick: () => setUnit({ mm: 'cm', cm: 'in', in: 'mm' }[D.unit]) });
  const stageWrap = h('div.stagewrap', {}, rulerH, rulerV, rmH, rmV, corner, ctxBar, stage);
  const strip = h('div.dpages');
  const zoomOut = h('output.zv', {}, '100%');
  const undoB = h('button.ib', { type: 'button', title: 'ย้อนกลับ (Ctrl+Z)', 'aria-label': 'ย้อนกลับ', onclick: () => undo() }, icon('undo'));
  const redoB = h('button.ib', { type: 'button', title: 'ทำซ้ำ (Ctrl+Y)', 'aria-label': 'ทำซ้ำ', onclick: () => redo() }, icon('redo'));
  const nameIn = h('input.dname', { value: D.name, 'aria-label': 'ชื่องาน', oninput: () => { D.name = nameIn.value; save(); } });

  const cv = new fabric.Canvas(canvasEl, { width: pw(), height: ph(), backgroundColor: '#ffffff', preserveObjectStacking: true, selection: true, fireRightClick: false, stopContextMenu: true });
  cv.enableRetinaScaling = true;

  // ---------- history + persistence ----------
  let hist = [], hi = -1, ht, st;
  const snapshot = () => JSON.stringify(cv.toObject(KEEP));
  function refreshHist() { undoB.disabled = hi <= 0; redoB.disabled = hi >= hist.length - 1; }
  function commit(now) {
    if (busy) return; clearTimeout(ht);
    const run = () => { const s = snapshot(); if (s === hist[hi]) return; hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > 80) hist.shift(); hi = hist.length - 1; D.pages[D.cur] = s; refreshHist(); persist(); thumb(D.cur); };
    now ? run() : (ht = setTimeout(run, 250));
  }
  const persist = () => { clearTimeout(st); st = setTimeout(save, 800); };
  const save = () => idbSet(STORE, { name: D.name, w: D.w, h: D.h, pages: D.pages, cur: D.cur, grid: D.grid, safe: D.safe, unit: D.unit, rulers: D.rulers, guides: D.guides });
  async function restore(s) { busy = true; await preloadFonts(s); await cv.loadFromJSON(s ? JSON.parse(s) : {}); if (!s) cv.backgroundColor = '#ffffff'; busy = false; cv.requestRenderAll(); ctx(); layersRefresh?.(); }
  async function undo() { if (hi <= 0) return; hi--; await restore(hist[hi]); D.pages[D.cur] = hist[hi]; refreshHist(); persist(); thumb(D.cur); }
  async function redo() { if (hi >= hist.length - 1) return; hi++; await restore(hist[hi]); D.pages[D.cur] = hist[hi]; refreshHist(); persist(); thumb(D.cur); }

  // ---------- sizing / zoom ----------
  function applyZoom() {
    cv.setZoom(zoom); cv.setDimensions({ width: pw() * zoom, height: ph() * zoom });
    host.style.width = pw() * zoom + 'px'; host.style.height = ph() * zoom + 'px';
    const mm = PX * zoom; ov.style.setProperty('--g', 10 * mm + 'px'); drawRulers(); drawGuides(); ov.style.setProperty('--s', 5 * mm + 'px');
    ov.classList.toggle('grid', D.grid); ov.classList.toggle('safe', D.safe);
    zoomOut.textContent = Math.round(zoom * 100) + '%'; cv.requestRenderAll();
  }
  function fit() { fitMode = true; zoom = Math.max(0.1, Math.min((stage.clientWidth - (innerWidth < 860 ? 30 : 76)) / pw(), (stage.clientHeight - (innerWidth < 860 ? 30 : 114)) / ph(), 2)); applyZoom(); }
  const setZoom = z => { fitMode = false; zoom = Math.max(0.1, Math.min(4, z)); applyZoom(); };
  const ro = new ResizeObserver(() => fitMode && alive && fit()); ro.observe(stage);

  // ---------- rulers and guides ----------
  function layoutRulers() { stageWrap.classList.toggle('noruler', !D.rulers); drawRulers(); }
  function setUnit(u) { D.unit = u; save(); drawRulers(); ctx(); }
  let rulerRaf = 0; const rafRulers = () => { if (!rulerRaf) rulerRaf = requestAnimationFrame(() => { rulerRaf = 0; drawRulers(); }); };
  const SUB = { 1: 10, 2: 4, 5: 5, 10: 10, 20: 4, 50: 5, 100: 10, 0.05: 5, 0.1: 10, 0.25: 5, 0.5: 5 };
  function drawRulers() {
    if (!D.rulers || !stageWrap.isConnected) return;
    corner.textContent = uname();
    const r = host.getBoundingClientRect(), sw = stageWrap.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const cs = getComputedStyle(rulerH), ink = cs.color, band = getComputedStyle(corner).backgroundColor;
    const pxPerUnit = PX * zoom * UN[D.unit].k, sel = active(), sr = sel ? sel.getBoundingRect() : null;
    const labelStep = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].find(x => x * pxPerUnit >= 64) ?? 100;
    const minor = labelStep / (D.unit === 'in' && labelStep === 1 ? 8 : SUB[labelStep] ?? 10);
    const one = (cvs, horizontal) => {
      const len = Math.max(0, (horizontal ? sw.width : sw.height) - 22); cvs.style[horizontal ? 'width' : 'height'] = len + 'px';
      cvs.width = (horizontal ? len : 22) * dpr; cvs.height = (horizontal ? 22 : len) * dpr;
      const g = cvs.getContext('2d'); g.scale(dpr, dpr);
      const o = horizontal ? r.left - (sw.left + 22) : r.top - (sw.top + 22), pageLen = (horizontal ? pw() : ph()) * zoom;
      g.fillStyle = band; g.globalAlpha = .55; horizontal ? g.fillRect(o, 0, pageLen, 22) : g.fillRect(0, o, 22, pageLen); g.globalAlpha = 1;
      if (sr) { g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent'); g.globalAlpha = .28; const a = o + (horizontal ? sr.left : sr.top) * zoom, l = (horizontal ? sr.width : sr.height) * zoom; horizontal ? g.fillRect(a, 0, l, 22) : g.fillRect(0, a, 22, l); g.globalAlpha = 1; }
      g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 1; g.font = '10px "Plex Mono",monospace'; g.textBaseline = 'top';
      const u0 = (0 - o) / pxPerUnit, u1 = (len - o) / pxPerUnit;
      for (let k = Math.floor(u0 / minor); k <= Math.ceil(u1 / minor); k++) {
        const u = +(k * minor).toFixed(6), p = Math.round(o + u * pxPerUnit) + .5, major = Math.abs(u / labelStep - Math.round(u / labelStep)) < 1e-6, mid = !major && Math.abs(u / labelStep * 2 - Math.round(u / labelStep * 2)) < 1e-6;
        const t = major ? 22 : mid ? 11 : 6; g.beginPath();
        if (horizontal) { g.moveTo(p, 22); g.lineTo(p, 22 - t); } else { g.moveTo(22, p); g.lineTo(22 - t, p); }
        g.stroke();
        if (major) { const txt = String(+u.toFixed(2)); if (horizontal) g.fillText(txt, p + 3, 2); else { g.save(); g.translate(3, p + 3); g.rotate(-Math.PI / 2); g.translate(-g.measureText(txt).width - 2, 0); g.fillText(txt, 0, 0); g.restore(); } }
      }
    };
    one(rulerH, true); one(rulerV, false);
  }
  function drawGuides() {
    ov.querySelectorAll('.guide').forEach(x => x.remove());
    const mk = (kind, i) => { const mm = D.guides[kind][i]; const el = h('i.guide.' + kind, { style: kind === 'v' ? `left:${mm * PX * zoom}px` : `top:${mm * PX * zoom}px`, title: 'ลากเพื่อย้าย ลากออกนอกกระดาษเพื่อลบ', onpointerdown: e => dragGuide(kind, i, e) }); ov.append(el); };
    D.guides.v.forEach((_, i) => mk('v', i)); D.guides.h.forEach((_, i) => mk('h', i));
  }
  function dragGuide(kind, idx, e) {
    e.preventDefault(); const arr = D.guides[kind]; if (idx < 0) { arr.push(0); idx = arr.length - 1; }
    const tip = h('div.guidetip'); document.body.append(tip);
    const mmAt = ev => { const r = host.getBoundingClientRect(); return ((kind === 'v' ? ev.clientX - r.left : ev.clientY - r.top) / zoom) / PX; };
    const move = ev => { const mm = Math.round(mmAt(ev) * 2) / 2; arr[idx] = mm; drawGuides(); tip.textContent = `${+(mm / UN[D.unit].k).toFixed(UN[D.unit].d)} ${uname()}`; tip.style.left = ev.clientX + 14 + 'px'; tip.style.top = ev.clientY + 14 + 'px'; };
    const up = ev => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); tip.remove(); const mm = mmAt(ev); if (mm < 0 || mm > (kind === 'v' ? D.w : D.h)) arr.splice(idx, 1); drawGuides(); save(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); move(e);
  }
  rulerH.addEventListener('pointerdown', e => dragGuide('h', -1, e)); rulerV.addEventListener('pointerdown', e => dragGuide('v', -1, e));
  stage.addEventListener('scroll', rafRulers);
  addEventListener('pointermove', e => {
    if (!D.rulers) return; const sw = stageWrap.getBoundingClientRect();
    rmH.style.transform = `translateX(${e.clientX - sw.left}px)`; rmV.style.transform = `translateY(${e.clientY - sw.top}px)`;
  });

  // ---------- helpers ----------
  const active = () => cv.getActiveObject();
  const isSel = o => o instanceof fabric.ActiveSelection;
  const targets = () => { const o = active(); return !o ? [] : isSel(o) ? o.getObjects() : [o]; };
  const isText = o => o instanceof fabric.IText || o instanceof fabric.Textbox;
  const leaves = o => o instanceof fabric.Group && !(o instanceof fabric.ActiveSelection) ? o.getObjects().flatMap(leaves) : isSel(o) ? o.getObjects().flatMap(leaves) : [o];
  const touch = () => { targets().forEach(o => o.setCoords()); cv.requestRenderAll(); commit(); ctx(); layersRefresh?.(); };
  const toFill = (c, o) => { if (!c || typeof c !== 'object' || !c.gradient) return c; const { from, to, angle } = c.gradient, w = o.width || 100, hh = o.height || 100, a = (angle - 90) * Math.PI / 180, r = Math.hypot(w, hh) / 2, cx = w / 2, cy = hh / 2;
    return new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: cx - Math.cos(a) * r, y1: cy - Math.sin(a) * r, x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r }, colorStops: [{ offset: 0, color: from }, { offset: 1, color: to }] }); };
  const setAll = (props, onlyText) => { targets().flatMap(leaves).forEach(o => { if (!onlyText || isText(o)) o.set('fill' in props ? { ...props, fill: toFill(props.fill, o) } : props); }); if (isSel(active())) active().setCoords(); touch(); };
  function place(o) { o.set({ left: (pw() - o.getScaledWidth()) / 2, top: (ph() - o.getScaledHeight()) / 2 }); o.setCoords(); cv.add(o); cv.setActiveObject(o); cv.requestRenderAll(); commit(true); }
  const pageEmpty = () => !cv.getObjects().length;
  // Mirror an AI layout_page call onto a fresh page so the person sees (and can edit) what Claude laid out.
  async function layoutItems(a) {
    const items = a.items ?? []; if (!items.length) return 0;
    const m = String(a.paper ?? '').match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|cm|in)?$/i), k = { mm: 1, cm: 10, in: 25.4 }[(m?.[3] ?? 'mm').toLowerCase()];
    const known = SIZES.find(s => s[3].toLowerCase() === String(a.paper ?? 'A4').toLowerCase()); let w = known?.[1] ?? (m ? +m[1] * k : 210), hh = known?.[2] ?? (m ? +m[2] * k : 297);
    if (a.orientation === 'landscape' && w < hh || a.orientation === 'portrait' && w > hh) [w, hh] = [hh, w];
    await addPage(); applySize(w, hh); busy = true; cv.backgroundColor = a.background ?? '#ffffff';
    const made = [];
    for (const it of items) {
      let o = null; const wpx = it.width_mm != null ? it.width_mm * PX : undefined, hpx = it.height_mm != null ? it.height_mm * PX : undefined;
      if (it.type === 'shape') { const f = it.fill ?? 'transparent', st = it.stroke ?? null, sw = (it.stroke_mm ?? (st ? .3 : 0)) * PX, c = { fill: f, stroke: st, strokeWidth: sw, left: it.x_mm * PX, top: it.y_mm * PX };
        o = it.shape === 'ellipse' ? new fabric.Ellipse({ ...c, rx: wpx / 2, ry: hpx / 2 }) : it.shape === 'line' ? new fabric.Line([0, 0, wpx, hpx], { ...c, fill: null, stroke: st ?? '#111827', strokeWidth: sw || PX * .3 }) : new fabric.Rect({ ...c, width: wpx, height: hpx, rx: (it.radius_mm ?? 0) * PX, ry: (it.radius_mm ?? 0) * PX }); }
      else if (it.type === 'text') { o = new fabric.Textbox(it.text, { width: wpx ?? 300, fontSize: (it.font_size_pt ?? 14) * 96 / 72, fontFamily: it.font ?? 'IBM Plex Sans Thai', fill: it.color ?? '#111827', fontWeight: it.bold ? 'bold' : 'normal', fontStyle: it.italic ? 'italic' : 'normal', underline: !!it.underline, textAlign: it.align ?? 'left', lineHeight: it.line_height ?? 1.3, left: (it.x_mm ?? 0) * PX, top: (it.y_mm ?? 0) * PX }); }
      else if (it.type === 'image' && it.shown) { try { o = await fabric.FabricImage.fromURL('/api/file?path=' + encodeURIComponent(it.shown)); const sx = wpx ? wpx / o.width : null, sy = hpx ? hpx / o.height : null; o.set({ scaleX: sx ?? sy ?? PX * 25.4 / 96, scaleY: sy ?? sx ?? PX * 25.4 / 96 }); if (sx && sy && it.fit !== 'fill') { const s = it.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy); o.set({ scaleX: s, scaleY: s }); } o.set({ left: (it.x_mm ?? 0) * PX, top: (it.y_mm ?? 0) * PX }); } catch { o = null; } }
      else if (it.type === 'copies') { const src = made[it.of]; if (src) { src.visible = false; for (let r = 0; r < it.rows; r++) for (let c = 0; c < it.cols; c++) { const cl = await src.clone(); cl.set({ visible: true, left: src.left + c * (src.getScaledWidth() + (it.gap_mm ?? 0) * PX), top: src.top + r * (src.getScaledHeight() + (it.gap_mm ?? 0) * PX) }); cv.add(cl); } } made.push(null); continue; }
      made.push(o); if (!o) continue;
      if (it.rotate_deg) o.set({ angle: it.rotate_deg }); if (it.opacity != null) o.set({ opacity: it.opacity });
      if (it.center_x) o.set('left', (pw() - o.getScaledWidth()) / 2); if (it.center_y) o.set('top', (ph() - o.getScaledHeight()) / 2);
      if (it.type === 'image' && it.x_mm == null && it.center_x == null) o.set('left', (pw() - o.getScaledWidth()) / 2); if (it.type === 'image' && it.y_mm == null && it.center_y == null) o.set('top', (ph() - o.getScaledHeight()) / 2);
      o.setCoords(); cv.add(o);
    }
    busy = false; cv.discardActiveObject(); cv.requestRenderAll(); commit(true); drawStrip(); thumb(D.cur); return made.length;
  }
  const mmv = px => Math.round((px / PX) * 10) / 10;
  // The unit the person picked (cm by default) is used for every number they see or type.
  const UN = { mm: { k: 1, d: 1, n: 'มม.' }, cm: { k: 10, d: 2, n: 'ซม.' }, in: { k: 25.4, d: 2, n: 'นิ้ว' } };
  const toU = px => +(px / PX / UN[D.unit].k).toFixed(UN[D.unit].d);
  const fromU = v => v * UN[D.unit].k * PX;
  const uname = () => UN[D.unit].n;

  // ---------- add elements ----------
  const textBox = (t, size, weight = 'normal', extra = {}) => new fabric.Textbox(t, { width: Math.min(pw() - 80, 520), fontSize: size, fontWeight: weight, fontFamily: DEF_FONT, fill: '#111827', textAlign: 'left', lineHeight: 1.25, ...extra });
  function addText(t, size, weight) { const o = textBox(t, size, weight); place(o); o.enterEditing?.(); o.selectAll?.(); cv.requestRenderAll(); }
  const star = (n, r1, r2) => Array.from({ length: n * 2 }, (_, i) => { const a = (Math.PI / n) * i - Math.PI / 2, r = i % 2 ? r2 : r1; return { x: r + r * Math.cos(a), y: r + r * Math.sin(a) }; });
  const poly = (n, r) => Array.from({ length: n }, (_, i) => { const a = (Math.PI * 2 / n) * i - Math.PI / 2; return { x: r + r * Math.cos(a), y: r + r * Math.sin(a) }; });
  const fillCol = '#2f55c9';
  const SHAPES = [
    ['สี่เหลี่ยม', '<rect x="4" y="6" width="16" height="12"/>', () => new fabric.Rect({ width: 220, height: 150, fill: fillCol })],
    ['สี่เหลี่ยมมน', '<rect x="4" y="6" width="16" height="12" rx="4"/>', () => new fabric.Rect({ width: 220, height: 150, rx: 24, ry: 24, fill: fillCol })],
    ['วงกลม', '<circle cx="12" cy="12" r="8"/>', () => new fabric.Circle({ radius: 90, fill: fillCol })],
    ['วงรี', '<ellipse cx="12" cy="12" rx="9" ry="6"/>', () => new fabric.Ellipse({ rx: 120, ry: 80, fill: fillCol })],
    ['สามเหลี่ยม', '<path d="M12 4 21 20H3z"/>', () => new fabric.Triangle({ width: 180, height: 160, fill: fillCol })],
    ['ดาว', '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1-4.5-4.3 6.1-.8z"/>', () => new fabric.Polygon(star(5, 90, 38), { fill: '#f59e0b' })],
    ['เพชร', '<path d="M12 3 21 12 12 21 3 12z"/>', () => new fabric.Polygon([{ x: 90, y: 0 }, { x: 180, y: 90 }, { x: 90, y: 180 }, { x: 0, y: 90 }], { fill: '#ec4899' })],
    ['หกเหลี่ยม', '<path d="M12 3 20 7.5v9L12 21 4 16.5v-9z"/>', () => new fabric.Polygon(poly(6, 90), { fill: '#14b8a6' })],
    ['หัวใจ', '<path d="M12 20S4 14.5 4 9a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 5.500-8 11-8 11z"/>', () => { const o = new fabric.Path('M 0 -30 C -60 -90 -150 -20 0 80 C 150 -20 60 -90 0 -30 z', { fill: '#ef4444' }); return o; }],
    ['เส้นตรง', '<path d="M4 18 20 6" fill="none" stroke="currentColor" stroke-width="2.5"/>', () => new fabric.Line([0, 0, 260, 0], { stroke: '#111827', strokeWidth: 4, strokeLineCap: 'round' })],
    ['เส้นประ', '<path d="M3 12h18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="3 3"/>', () => new fabric.Line([0, 0, 260, 0], { stroke: '#111827', strokeWidth: 3, strokeDashArray: [10, 8], strokeLineCap: 'round' })],
    ['ลูกศร', '<path d="M4 12h15m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>', () => new fabric.Path('M 0 0 L 240 0 M 210 -22 L 240 0 L 210 22', { stroke: '#111827', strokeWidth: 5, fill: '', strokeLineCap: 'round', strokeLineJoin: 'round' })],
  ];
  async function addImageURL(url, name = 'ภาพ', replace = false) {
    const img = await fabric.FabricImage.fromURL(url); img.set({ name });
    const old = replace && active() instanceof fabric.FabricImage ? active() : null;
    const m = old ? Math.min(old.getScaledWidth() / img.width, old.getScaledHeight() / img.height) : Math.min(1, (pw() * 0.7) / img.width, (ph() * 0.7) / img.height); img.scale(m);
    if (old) { const cx = old.left + old.getScaledWidth() / 2, cy = old.top + old.getScaledHeight() / 2; cv.discardActiveObject(); cv.remove(old); img.set({ left: cx - img.getScaledWidth() / 2, top: cy - img.getScaledHeight() / 2 }); img.setCoords(); cv.add(img); cv.setActiveObject(img); cv.requestRenderAll(); commit(true); return; }
    place(img);
  }
  async function addFiles(list) {
    for (const f of list) {
      if (!/^image\//.test(f.type)) { toast(`${f.name}: รองรับเฉพาะไฟล์รูปภาพ`, 'bad'); continue; }
      const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      await addImageURL(url, f.name);
    }
  }

  // ---------- context toolbar ----------
  const ib = (ic, label, fn, pressed) => h('button.ib', { type: 'button', title: label, 'aria-label': label, 'aria-pressed': pressed === undefined ? undefined : String(pressed), onclick: e => fn(e.currentTarget) }, typeof ic === 'string' && ICON[ic] ? icon(ic) : ic);
  const sep = () => h('i.dsep');
  const swatch = (label, value, fn, none, grad) => { const shown = typeof value === 'string' ? value : value?.colorStops?.[0]?.color ?? ''; return h('button.sw-btn', { type: 'button', title: label, 'aria-label': label, style: `--c:${shown || 'transparent'}`, class: shown ? '' : 'none', onclick: e => colorPop(e.currentTarget, shown, c => { fn(c); }, none, { gradient: grad, doc: docColors() }) }); };
  const numField = (val, fn, o = {}) => h('input.nf', { type: 'number', value: val, step: o.step ?? 1, min: o.min, max: o.max, 'aria-label': o.label, onchange: e => fn(+e.target.value), onkeydown: e => e.key === 'Enter' && e.target.blur() });
  const fontBtn = o => h('button.fontb', { type: 'button', style: `font-family:"${o.fontFamily}"`, title: 'ฟอนต์', onclick: e => {
    const row = f => h('button', { type: 'button', style: `font-family:"${f}"`, 'aria-pressed': String(f === o.fontFamily), onclick: async () => { await ensureFont(f); closePops(); setAll({ fontFamily: f }, true); targets().flatMap(leaves).forEach(x => { if (isText(x)) { x.initDimensions?.(); x.dirty = true; } }); cv.requestRenderAll(); } }, f, h('small', {}, 'สวัสดี Abc'));
    pop(e.currentTarget, 'ฟอนต์', h('div.fontlist', {}, h('div.lbl', { style: 'margin:4px 8px' }, 'ฟอนต์ไทยที่มากับแอป (พิมพ์ได้เหมือนกันทุกเครื่อง)'), BUNDLED.map(row), sysFonts.length > 0 && h('div.lbl', { style: 'margin:10px 8px 4px' }, 'ฟอนต์ในเครื่องนี้'), sysFonts.map(row)), { wide: 300 });
  } }, h('span', {}, o.fontFamily), icon('chev'));
  function ctx() {
    if (!ctxBar.isConnected) return;
    if (draw?.isOn()) return draw.bar();
    const o = active(); ctxBar.replaceChildren();
    if (!o) { ctxBar.hidden = true; return; }
    ctxBar.hidden = false;
    if (false) { ctxBar.append(h('div.pageinfo', {}, h('span', {}, 'หน้า ', h('b', {}, `${D.cur + 1}/${D.pages.length}`)), h('span', {}, 'ขนาด ', h('b', {}, `${mmv(pw())} × ${mmv(ph())} มม.`)), h('span', {}, paperFor()))); return; }
    const t = targets(), first = t[0], textual = t.length === 1 && isText(first) || (t.length > 1 && t.every(isText));
    const lf = t.flatMap(leaves); const sample = lf.find(isText) ?? lf[0];
    if (lf.some(isText)) {
      const s = lf.find(isText);
      ctxBar.append(fontBtn(s), h('div.step.sm', {}, ib('minus', 'ลดขนาด', () => setAll({ fontSize: Math.max(6, Math.round(s.fontSize) - 2) }, true)), numField(Math.round(s.fontSize), v => setAll({ fontSize: Math.max(4, Math.min(600, v)) }, true), { label: 'ขนาดตัวอักษร', min: 4, max: 600 }), ib('plus', 'เพิ่มขนาด', () => setAll({ fontSize: Math.round(s.fontSize) + 2 }, true))),
        swatch('สีตัวอักษร', s.fill, c => setAll({ fill: c || '#000000' }, true), false, true),
        ib(h('b', {}, 'B'), 'ตัวหนา (Ctrl+B)', () => setAll({ fontWeight: s.fontWeight === 'bold' || s.fontWeight >= 600 ? 'normal' : 'bold' }, true), s.fontWeight === 'bold' || s.fontWeight >= 600),
        ib(h('i', { style: 'font-family:serif' }, 'I'), 'ตัวเอียง (Ctrl+I)', () => setAll({ fontStyle: s.fontStyle === 'italic' ? 'normal' : 'italic' }, true), s.fontStyle === 'italic'),
        ib(h('u', {}, 'U'), 'ขีดเส้นใต้ (Ctrl+U)', () => setAll({ underline: !s.underline }, true), s.underline),
        ib(({ left: 'aL', center: 'aC', right: 'aR', justify: 'aJ' })[s.textAlign] ?? 'aL', 'จัดแนวข้อความ', () => setAll({ textAlign: ({ left: 'center', center: 'right', right: 'justify', justify: 'left' })[s.textAlign] ?? 'left' }, true)),
        ib('sliders', 'ระยะบรรทัด / ตัวอักษร', a => pop(a, 'ระยะ', h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, slider('ระยะบรรทัด', s.lineHeight, 0.6, 3, 0.05, v => setAll({ lineHeight: v }, true)), slider('ระยะห่างตัวอักษร', s.charSpacing, -200, 800, 10, v => setAll({ charSpacing: v }, true))), { wide: 300 })), sep());
    } else if (!(sample instanceof fabric.Line) && !(sample instanceof fabric.FabricImage)) {
      ctxBar.append(swatch('สีเติม', sample.fill, c => setAll({ fill: c }), true, true));
    }
    if (sample && !(sample instanceof fabric.FabricImage) && !lf.every(isText)) {
      ctxBar.append(swatch('สีเส้นขอบ', sample.stroke ?? '', c => setAll({ stroke: c || null, strokeWidth: c ? (sample.strokeWidth || 3) : 0 }), true), numField(Math.round(sample.strokeWidth || 0), v => setAll({ strokeWidth: Math.max(0, v) }), { label: 'ความหนาเส้น', min: 0, max: 100 }));
    }
    if (t.length === 1 && first instanceof fabric.FabricImage) ctxBar.append(
      h('button.btn.sm', { type: 'button', 'data-ai': 'img-removebg', onclick: () => TL.serverEdit([{ op: 'remove_background', method: 'auto' }], 'ลบพื้นหลัง') }, icon('magic'), 'ลบพื้นหลัง'),
      h('button.btn.sm', { type: 'button', 'data-ai': 'img-tools', onclick: e => TL.toolsPop(e.currentTarget) }, icon('wand'), 'เครื่องมือรูป'),
      ib('crop', 'ครอบตัด', () => cropMode(first)), ib('sliders', 'ปรับภาพและฟิลเตอร์', a => TL.adjustPop(a)), ib('shapes', 'ตัดรูปเป็นรูปทรง', a => TL.maskPop(a)), sep());
    ctxBar.append(sep(), ib('cH', 'จัดกึ่งกลางหน้า แนวนอน', () => alignTo('c')), ib('cV', 'จัดกึ่งกลางหน้า แนวตั้ง', () => alignTo('m')),
      ib('ruler', 'ตำแหน่งและขนาด', a => posPop(a)), ib('layers', 'จัดเรียงและจัดตำแหน่ง', a => arrangePop(a)), ib('drop', 'โปร่งใส / เงา / มุมมน', a => effectsPop(a)), sep(),
      ib('copy', 'ทำซ้ำ (Ctrl+D)', () => duplicate()), ib(isLocked(t) ? 'lock' : 'unlock', isLocked(t) ? 'ปลดล็อก' : 'ล็อก', () => toggleLock(t), isLocked(t)), ib('trash', 'ลบ (Delete)', () => del()));
  }
  const slider = (label, val, min, max, step, fn) => { const o = h('output', {}, String(Math.round(val * 100) / 100)); const i = h('input', { type: 'range', min, max, step, value: val, 'aria-label': label, oninput: () => { o.textContent = String(+i.value); i.style.setProperty('--p', ((i.value - min) / (max - min)) * 100 + '%'); fn(+i.value); } }); i.style.setProperty('--p', ((val - min) / (max - min)) * 100 + '%'); return h('div', {}, h('div.lbl', {}, h('span', {}, label), o), i); };
  const isLocked = t => t.every(o => o.locked);
  function toggleLock(t) { lockObjs(t, !isLocked(t)); touch(); }
  function del() { const t = targets(); if (!t.length) return; cv.discardActiveObject(); t.forEach(o => cv.remove(o)); cv.requestRenderAll(); commit(true); ctx(); layersRefresh?.(); }
  async function duplicate() { const o = active(); if (!o) return; const c = await o.clone(); cv.discardActiveObject(); const add = x => { x.set({ left: x.left + 24, top: x.top + 24, evented: true }); cv.add(x); }; if (isSel(c)) { c.canvas = cv; c.forEachObject(add); c.setCoords(); } else add(c); cv.setActiveObject(c); cv.requestRenderAll(); commit(true); }
  let clipObj = null;
  const copyObj = async () => { const o = active(); if (o) clipObj = await o.clone(); };
  async function pasteObj() { if (!clipObj) return; const c = await clipObj.clone(); cv.discardActiveObject(); const add = x => { x.set({ left: x.left + 24, top: x.top + 24 }); cv.add(x); }; if (isSel(c)) { c.canvas = cv; c.forEachObject(add); c.setCoords(); } else add(c); clipObj.set({ left: clipObj.left + 24, top: clipObj.top + 24 }); cv.setActiveObject(c); cv.requestRenderAll(); commit(true); }

  function posPop(a) {
    const o = active(); if (!o) return; const r = o.getBoundingRect(); let lock = true; const isTxt = isText(o);
    const f = (label, v, fn) => h('label.pf', {}, h('span', {}, label), numField(toU(v), fn, { step: D.unit === 'mm' ? 0.5 : 0.1, label }));
    const rot = h('label.pf', {}, h('span', {}, 'หมุน°'), numField(Math.round(o.angle || 0), v => { o.rotate(v); touch(); }, { label: 'องศา' }));
    pop(a, `ตำแหน่งและขนาด (${uname()})`, h('div', {}, h('div.two', {}, f('X', r.left, v => { o.set({ left: o.left + (fromU(v) - r.left) }); touch(); }), f('Y', r.top, v => { o.set({ top: o.top + (fromU(v) - r.top) }); touch(); }),
      f('กว้าง', o.getScaledWidth(), v => resizeTo(o, fromU(v), null, lock)), f('สูง', o.getScaledHeight(), v => resizeTo(o, null, fromU(v), lock))), h('div.two', { style: 'margin-top:12px' }, rot,
      isTxt ? h('span') : h('label.sw', { style: 'min-height:auto' }, h('span', {}, 'ล็อกสัดส่วน'), h('input', { type: 'checkbox', checked: true, onchange: e => { lock = e.target.checked; } }), h('span.tr')))), { wide: 320 });
  }
  function resizeTo(o, w, hgt, lock) {
    if (isText(o)) { if (w) o.set({ width: w / o.scaleX }); }
    else if (w && hgt == null) { const k = w / o.getScaledWidth(); o.set({ scaleX: o.scaleX * k, ...(lock && { scaleY: o.scaleY * k }) }); }
    else if (hgt && w == null) { const k = hgt / o.getScaledHeight(); o.set({ scaleY: o.scaleY * k, ...(lock && { scaleX: o.scaleX * k }) }); }
    touch();
  }
  function alignTo(how) {
    const t = targets(); if (!t.length) return; const o = active();
    const r = o.getBoundingRect(); const W = pw(), H = ph();
    const dx = { l: -r.left, c: (W - r.width) / 2 - r.left, r: W - r.width - r.left }[how], dy = { t: -r.top, m: (H - r.height) / 2 - r.top, b: H - r.height - r.top }[how];
    if (dx !== undefined) o.set({ left: o.left + dx }); if (dy !== undefined) o.set({ top: o.top + dy }); touch();
  }
  let layersRefresh;
  function flat(fn) { const o = active(); const objs = o.getObjects().slice(); cv.discardActiveObject(); fn(objs); objs.forEach(x => x.setCoords()); cv.setActiveObject(new fabric.ActiveSelection(objs, { canvas: cv })); cv.requestRenderAll(); commit(true); }
  function alignGroup(how) {
    flat(objs => { const rs = objs.map(x => x.getBoundingRect()), L = Math.min(...rs.map(r => r.left)), R = Math.max(...rs.map(r => r.left + r.width)), Tp = Math.min(...rs.map(r => r.top)), B = Math.max(...rs.map(r => r.top + r.height));
      objs.forEach((x, i) => { const r = rs[i]; const dx = how === 'l' ? L - r.left : how === 'c' ? (L + R) / 2 - (r.left + r.width / 2) : how === 'r' ? R - r.left - r.width : 0, dy = how === 't' ? Tp - r.top : how === 'm' ? (Tp + B) / 2 - (r.top + r.height / 2) : how === 'b' ? B - r.top - r.height : 0; x.set({ left: x.left + dx, top: x.top + dy }); }); });
  }
  function distribute(axis) {
    flat(objs => { const rs = objs.map(x => ({ x, r: x.getBoundingRect() })).sort((p, q) => axis === 'h' ? p.r.left - q.r.left : p.r.top - q.r.top), size = e => axis === 'h' ? e.r.width : e.r.height, start = e => axis === 'h' ? e.r.left : e.r.top;
      const span = start(rs.at(-1)) + size(rs.at(-1)) - start(rs[0]), gap = (span - rs.reduce((t, e) => t + size(e), 0)) / (rs.length - 1); let pos = start(rs[0]) + size(rs[0]);
      for (let i = 1; i < rs.length - 1; i++) { const e = rs[i], tgt = pos + gap, d = tgt - start(e); e.x.set(axis === 'h' ? { left: e.x.left + d } : { top: e.x.top + d }); pos = tgt + size(e); } });
  }
  function sameSize() { flat(objs => { const f = objs[0], w = f.getScaledWidth(), hh = f.getScaledHeight(); objs.slice(1).forEach(x => { x.scaleX = x.scaleX * w / x.getScaledWidth(); x.scaleY = x.scaleY * hh / x.getScaledHeight(); }); }); }
  async function tile(rows, cols, gap) {
    const o = active(); if (!o || isSel(o)) return toast('เลือกองค์ประกอบเดียวก่อน (จัดกลุ่มก่อนถ้ามีหลายชิ้น)', 'bad');
    const r = o.getBoundingRect(), x0 = (pw() - (cols * r.width + (cols - 1) * gap)) / 2, y0 = (ph() - (rows * r.height + (rows - 1) * gap)) / 2; cv.discardActiveObject(); busy = true;
    const spots = []; for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) spots.push([x0 + j * (r.width + gap) - r.left, y0 + i * (r.height + gap) - r.top]);
    for (const [dx, dy] of spots.slice(1)) { const c = await o.clone(); c.set({ left: c.left + dx, top: c.top + dy }); c.setCoords(); cv.add(c); }
    o.set({ left: o.left + spots[0][0], top: o.top + spots[0][1] }); o.setCoords(); busy = false; cv.setActiveObject(o); cv.requestRenderAll(); commit(true); toast(`ทำซ้ำเป็น ${rows * cols} ชิ้นแล้ว`, 'ok');
  }
  function tilePop(a) {
    let rows = 2, cols = 4, gap = 4; const f = (l, v, fn, st = 1) => h('label.pf', {}, h('span', {}, l), numField(v, fn, { step: st, min: 1, label: l }));
    pop(a, 'ทำซ้ำเต็มหน้า', h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, h('p.muted', { style: 'margin:0;font-size:12.5px' }, 'คัดลอกชิ้นที่เลือกเป็นตาราง วางกึ่งกลางหน้า เช่น สำเนาบัตร 2×4 หรือป้ายชื่อหลายใบ'),
      h('div.two', {}, f('แถว', rows, v => { rows = Math.max(1, Math.round(v)); }), f('คอลัมน์', cols, v => { cols = Math.max(1, Math.round(v)); })), f('ระยะห่าง (มม.)', gap, v => { gap = Math.max(0, v); }, .5),
      h('button.btn.primary', { type: 'button', onclick: () => { closePops(); tile(rows, cols, gap * PX); } }, icon('repeat'), 'ทำซ้ำ')), { wide: 320 });
  }
  function arrangePop(a) {
    const o = active(); if (!o) return; const multi = isSel(o);
    const chipRow = (list, fn) => h('div.chips', {}, list.map(([k, t]) => h('button.chip', { type: 'button', onclick: () => fn(k) }, t)));
    const order = fn => () => { targets().forEach(x => fn(x)); cv.requestRenderAll(); commit(true); layersRefresh?.(); };
    const b = (ic, t, fn) => h('button.btn.sm', { type: 'button', onclick: fn }, icon(ic), t);
    pop(a, 'จัดเรียง', h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      h('div', {}, h('div.lbl', {}, 'วางบนกระดาษ'), chipRow([['l', 'ชิดซ้าย'], ['c', 'กลางแนวนอน'], ['r', 'ชิดขวา'], ['t', 'ชิดบน'], ['m', 'กลางแนวตั้ง'], ['b', 'ชิดล่าง']], alignTo),
        h('button.btn.sm.primary', { type: 'button', style: 'margin-top:8px;width:100%', onclick: () => { alignTo('c'); alignTo('m'); } }, icon('aligncv'), 'วางตรงกลางกระดาษ')),
      multi && h('div', {}, h('div.lbl', {}, 'จัดชิ้นที่เลือกให้ตรงกัน'), chipRow([['l', 'ชิดซ้าย'], ['c', 'กลาง'], ['r', 'ชิดขวา'], ['t', 'ชิดบน'], ['m', 'กลางแนวตั้ง'], ['b', 'ชิดล่าง']], alignGroup),
        h('div.chips', { style: 'margin-top:8px' }, b('aJ', 'กระจายแนวนอน', () => distribute('h')), b('aJ', 'กระจายแนวตั้ง', () => distribute('v')), b('copy', 'ขนาดเท่ากัน', sameSize))),
      h('div', {}, h('div.lbl', {}, 'ลำดับชั้น'), h('div.chips', {}, b('up', 'หน้าสุด', order(x => cv.bringObjectToFront(x))), b('up', 'ขึ้น', order(x => cv.bringObjectForward(x))), b('down', 'ลง', order(x => cv.sendObjectBackwards(x))), b('down', 'หลังสุด', order(x => cv.sendObjectToBack(x))))),
      h('div.chips', {}, b('flip', 'กลับซ้าย-ขวา', () => { targets().forEach(x => x.set('flipX', !x.flipX)); touch(); }), b('flip', 'กลับบน-ล่าง', () => { targets().forEach(x => x.set('flipY', !x.flipY)); touch(); }),
        multi ? b('group', 'จัดกลุ่ม', groupSel) : (o instanceof fabric.Group ? b('group', 'แยกกลุ่ม', ungroup) : null), !multi && b('repeat', 'ทำซ้ำเต็มหน้า…', () => tilePop(a)))), { wide: 340 });
  }
  function groupSel() {
    const o = active(); if (!isSel(o)) return; const all = cv.getObjects();
    const objs = o.getObjects().slice().sort((x, y) => all.indexOf(x) - all.indexOf(y));
    cv.discardActiveObject(); objs.forEach(x => cv.remove(x));
    const g = new fabric.Group(objs); cv.add(g); cv.setActiveObject(g); cv.requestRenderAll(); commit(true); ctx();
  }
  function ungroup() {
    const g = active(); if (!(g instanceof fabric.Group) || isSel(g)) return;
    cv.discardActiveObject(); const items = g.removeAll(); cv.remove(g); items.forEach(x => { x.setCoords(); cv.add(x); });
    cv.setActiveObject(new fabric.ActiveSelection(items, { canvas: cv })); cv.requestRenderAll(); commit(true); ctx();
  }
  function effectsPop(a) {
    const o = active(); if (!o) return; const t = targets(), lf = t.flatMap(leaves), s1 = lf[0], text = lf.some(isText), sh0 = o.shadow;
    const shadow = (p = {}) => { const cur = t[0].shadow ?? {}; const col = p.color ?? cur.color ?? 'rgba(0,0,0,.4)'; t.forEach(x => x.set('shadow', new fabric.Shadow({ color: col, blur: p.blur ?? cur.blur ?? 18, offsetX: p.x ?? cur.offsetX ?? 6, offsetY: p.y ?? cur.offsetY ?? 8 }))); cv.requestRenderAll(); commit(); };
    const modes = [['source-over', 'ปกติ'], ['multiply', 'เข้มขึ้น'], ['screen', 'สว่างขึ้น'], ['overlay', 'ซ้อนทับ']];
    pop(a, 'เอฟเฟกต์', h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      slider('ความโปร่งใส %', Math.round((o.opacity ?? 1) * 100), 0, 100, 1, v => { t.forEach(x => x.set('opacity', v / 100)); cv.requestRenderAll(); commit(); }),
      s1 instanceof fabric.Rect && slider('มุมมน', s1.rx || 0, 0, 160, 1, v => { lf.forEach(x => x instanceof fabric.Rect && x.set({ rx: v, ry: v })); cv.requestRenderAll(); commit(); }),
      h('div', {}, h('div.lbl', {}, 'การผสมสี'), h('div.chips', {}, modes.map(([k, n]) => h('button.chip', { type: 'button', 'aria-pressed': String((o.globalCompositeOperation || 'source-over') === k), onclick: e => { t.forEach(x => x.set('globalCompositeOperation', k)); e.currentTarget.parentElement.querySelectorAll('button').forEach(bn => bn.setAttribute('aria-pressed', String(bn === e.currentTarget))); cv.requestRenderAll(); commit(true); } }, n)))),
      h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('label.sw', {}, h('span', {}, 'เงา'), h('input', { type: 'checkbox', checked: !!sh0, onchange: e => { if (e.target.checked) shadow(); else { t.forEach(x => x.set('shadow', null)); cv.requestRenderAll(); commit(true); } closePops(); effectsPop(a); } }), h('span.tr')),
        sh0 && [slider('ความฟุ้ง', sh0.blur ?? 18, 0, 80, 1, v => shadow({ blur: v })), slider('ระยะแนวนอน', sh0.offsetX ?? 6, -60, 60, 1, v => shadow({ x: v })), slider('ระยะแนวตั้ง', sh0.offsetY ?? 8, -60, 60, 1, v => shadow({ y: v })),
          h('div.row', {}, h('span', { style: 'font-weight:500;font-size:13px' }, 'สีเงา'), swatch('สีเงา', sh0.color ?? '#000000', c => shadow({ color: c || 'rgba(0,0,0,.4)' }))), h('div.chips', {}, [['เงานุ่ม', { blur: 24, x: 4, y: 10, color: 'rgba(0,0,0,.28)' }], ['เงาแข็ง', { blur: 0, x: 6, y: 6, color: 'rgba(0,0,0,.6)' }], ['เรืองแสง', { blur: 30, x: 0, y: 0, color: '#2f55c9' }]].map(([n, p]) => h('button.chip', { type: 'button', onclick: () => { shadow(p); closePops(); effectsPop(a); } }, n)))]),
      text && h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('div.lbl', {}, 'ข้อความ'),
        h('div.row', {}, h('span', { style: 'font-weight:500;font-size:13px' }, 'สีขอบตัวอักษร'), swatch('สีขอบตัวอักษร', s1.stroke ?? '', c => setAll({ stroke: c || null, strokeWidth: c ? (s1.strokeWidth || 2) : 0, paintFirst: 'stroke' }, true), true)),
        slider('ความหนาขอบ', s1.strokeWidth || 0, 0, 12, .5, v => setAll({ strokeWidth: v, paintFirst: 'stroke' }, true)),
        h('div.row', {}, h('span', { style: 'font-weight:500;font-size:13px' }, 'ไฮไลต์หลังตัวอักษร'), swatch('สีไฮไลต์', s1.textBackgroundColor ?? '', c => setAll({ textBackgroundColor: c || '' }, true), true)))), { wide: 340 });
  }
  // ---------- left rail popups ----------
  function textPop(a) {
    const row = (t, size, w) => h('button.addtext', { type: 'button', style: `font:${w} ${Math.min(size, 30)}px "${DEF_FONT}"`, onclick: () => { addText(t, size, w); closePops(); } }, t);
    const pairs = [['Kanit', 700, 'Sarabun', 400, 'ชื่อเรื่องตัวหนา'], ['Mitr', 500, 'Prompt', 300, 'หัวข้อโค้งมน'], ['Chonburi', 400, 'Sarabun', 400, 'หัวข้อคลาสสิก'], ['Pridi', 600, 'Niramit', 400, 'หัวข้อมีหัว'], ['Pacifico', 400, 'Prompt', 400, 'Summer Sale'], ['Bebas Neue', 400, 'Oswald', 400, 'BIG TITLE']];
    const pair = ([f1, w1, f2, w2, t]) => h('button.addtext', { type: 'button', style: 'display:flex;flex-direction:column;gap:2px', onclick: async () => { await Promise.all([ensureFont(f1), ensureFont(f2)]); const a1 = textBox(t, 56, w1, { fontFamily: f1 }), a2 = textBox('คำอธิบายสั้นๆ ใต้หัวข้อ', 24, w2, { fontFamily: f2, fill: '#4b5563' }); a1.set({ left: (pw() - a1.width) / 2, top: ph() * .28 }); a2.set({ left: (pw() - a2.width) / 2, top: ph() * .28 + 90 }); cv.add(a1, a2); cv.setActiveObject(a1); cv.requestRenderAll(); commit(true); closePops(); } },
      h('span', { style: `font:${w1} 22px "${f1}"` }, t), h('span', { style: `font:${w2} 14px "${f2}";color:var(--muted)` }, 'คำอธิบายสั้นๆ · ' + f1 + ' + ' + f2));
    pop(a, 'ข้อความ', h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, row('เพิ่มหัวเรื่อง', 64, 'bold'), row('เพิ่มหัวข้อรอง', 36, '600'), row('เพิ่มข้อความเนื้อหา', 20, 'normal'),
      h('button.addtext', { type: 'button', onclick: () => { addText('• รายการที่ 1\n• รายการที่ 2\n• รายการที่ 3', 22, 'normal'); closePops(); } }, '• เพิ่มรายการ'),
      h('div.lbl', { style: 'margin-top:6px' }, 'คู่ฟอนต์สำเร็จรูป'), pairs.map(pair), h('p.muted', { style: 'margin:2px 0 0;font-size:12.5px' }, 'ดับเบิลคลิกข้อความบนกระดาษเพื่อแก้ไข')), { side: 'right', wide: 320 });
  }

  // ---------- layers ----------
  const kindName = o => [[fabric.FabricImage, 'รูปภาพ'], [fabric.Rect, 'สี่เหลี่ยม'], [fabric.Circle, 'วงกลม'], [fabric.Ellipse, 'วงรี'], [fabric.Triangle, 'สามเหลี่ยม'], [fabric.Polygon, 'รูปหลายเหลี่ยม'], [fabric.Line, 'เส้น'], [fabric.Path, 'เส้นโค้ง'], [fabric.Group, 'กลุ่ม']].find(([c]) => o instanceof c)?.[1] ?? 'องค์ประกอบ';
  function layersPop(a) {
    const list = h('div.layerlist');
    layersRefresh = () => {
      if (!list.isConnected) return layersRefresh = null;
      const objs = cv.getObjects().slice().reverse();
      list.replaceChildren(...(objs.length ? objs.map(o => {
        const label = isText(o) ? ((o.text || '').split(String.fromCharCode(10))[0].slice(0, 24) || 'ข้อความ') : (o.name || kindName(o));
        const row = h('div.layer', { 'aria-current': String(active() === o || (isSel(active()) && active().getObjects().includes(o))), onclick: () => { cv.setActiveObject(o); cv.requestRenderAll(); ctx(); layersRefresh?.(); } },
          h('span.ic', {}, icon(isText(o) ? 'type' : o instanceof fabric.FabricImage ? 'image' : 'shapes')), h('span.n', {}, label),
          h('button.ib.sm', { type: 'button', 'aria-label': 'ซ่อน/แสดง', onclick: e => { e.stopPropagation(); o.set({ visible: !o.visible }); if (!o.visible) cv.discardActiveObject(); cv.requestRenderAll(); commit(true); layersRefresh?.(); } }, icon(o.visible === false ? 'eyeoff' : 'eye')),
          h('button.ib.sm', { type: 'button', 'aria-label': 'ล็อก', onclick: e => { e.stopPropagation(); cv.setActiveObject(o); toggleLock([o]); } }, icon(o.locked ? 'lock' : 'unlock')),
          h('button.ib.sm', { type: 'button', 'aria-label': 'ขึ้น', onclick: e => { e.stopPropagation(); cv.bringObjectForward(o); cv.requestRenderAll(); commit(true); layersRefresh?.(); } }, icon('up')),
          h('button.ib.sm', { type: 'button', 'aria-label': 'ลง', onclick: e => { e.stopPropagation(); cv.sendObjectBackwards(o); cv.requestRenderAll(); commit(true); layersRefresh?.(); } }, icon('down')));
        return row;
      }) : [h('p.muted', { style: 'margin:6px' }, 'ยังไม่มีองค์ประกอบ เพิ่มจากแถบซ้าย')]));
    };
    pop(a, 'เลเยอร์', list, { side: 'right', wide: 330 }); layersRefresh();
  }

  // ---------- page + templates ----------
  function applySize(w, hgt) { D.w = w; D.h = hgt; applyZoom(); fit(); save(); ctx(); }
  function pagePop(a) {
    const bgs = h('button.sw-btn', { type: 'button', style: `--c:${cv.backgroundColor || '#fff'}`, 'aria-label': 'สีพื้นหลัง', onclick: e => colorPop(e.currentTarget, cv.backgroundColor, c => { cv.backgroundColor = c || '#ffffff'; bgs.style.setProperty('--c', cv.backgroundColor); cv.requestRenderAll(); commit(); }) });
    const cw = numField(+(D.w / UN[D.unit].k).toFixed(2), v => v > 0.5 && applySize(v * UN[D.unit].k, D.h), { label: 'กว้าง', step: 0.1 }), chh = numField(+(D.h / UN[D.unit].k).toFixed(2), v => v > 0.5 && applySize(D.w, v * UN[D.unit].k), { label: 'สูง', step: 0.1 });
    const tog = (k, t) => h('label.sw', {}, h('span', {}, t), h('input', { type: 'checkbox', checked: D[k], onchange: e => { D[k] = e.target.checked; layoutRulers(); applyZoom(); save(); } }), h('span.tr'));
    pop(a, 'หน้ากระดาษ', h('div', { style: 'display:flex;flex-direction:column;gap:16px' },
      h('div', {}, h('div.lbl', {}, 'ขนาด'), h('div.chips', {}, SIZES.map(([n, w, hh]) => h('button.chip', { type: 'button', 'aria-pressed': String(Math.abs(D.w - w) < .5 && Math.abs(D.h - hh) < .5), onclick: () => { applySize(w, hh); closePops(); } }, n)))),
      h('div.seg', {}, [['แนวตั้ง', D.h >= D.w], ['แนวนอน', D.w > D.h]].map(([t, on], i) => h('button', { type: 'button', 'aria-pressed': String(on), onclick: () => { if ((i === 0) === (D.h >= D.w)) return; applySize(D.h, D.w); closePops(); } }, t))),
      h('div.two', {}, h('label.pf', {}, h('span', {}, `กว้าง ${uname()}`), cw), h('label.pf', {}, h('span', {}, `สูง ${uname()}`), chh)),
      h('div', {}, h('div.lbl', {}, 'หน่วยวัด'), h('div.seg', {}, [['mm', 'มม.'], ['cm', 'ซม.'], ['in', 'นิ้ว']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(D.unit === k), onclick: () => { setUnit(k); closePops(); } }, t)))),
      h('div.row', {}, h('span', { style: 'font-weight:650' }, 'สีพื้นหลัง'), bgs), tog('rulers', 'แสดงไม้บรรทัด'), tog('grid', 'แสดงตาราง (ทุก 1 ซม.)'), tog('safe', 'แสดงขอบที่เครื่องพิมพ์อาจตัด (5 มม.)'),
      D.guides.v.length + D.guides.h.length ? h('button.btn.sm', { type: 'button', onclick: () => { D.guides = { v: [], h: [] }; drawGuides(); save(); closePops(); } }, 'ลบเส้นไกด์ทั้งหมด') : null), { side: 'right', wide: 340 });
  }
  const T = (t, l, top, w, size, o = {}) => new fabric.Textbox(t, { left: l, top, width: w, fontSize: size, fontFamily: DEF_FONT, fill: '#111827', lineHeight: 1.25, textAlign: 'left', ...o });
  const TEMPLATES = [
    ['ว่างเปล่า', 210, 297, '#ffffff', () => [], ['#fff', '#eee']],
    ['สำเนาบัตร 2 ด้าน', 210, 297, '#ffffff', () => { const mm = v => v * PX, w = mm(85.6), hh = mm(54), x = (794 - w) / 2; return [T('สำเนาบัตรประชาชน', 0, mm(18), 794, 34, { textAlign: 'center', fontWeight: 'bold' }), new fabric.Rect({ left: x, top: mm(52), width: w, height: hh, fill: '', stroke: '#9aa3b2', strokeWidth: 1.5, strokeDashArray: [8, 6], name: 'กรอบด้านหน้า' }), T('ด้านหน้า (วางภาพบัตรที่ตัดขอบแล้ว)', x, mm(52) + hh + 8, w, 14, { fill: '#6b7280', textAlign: 'center' }), new fabric.Rect({ left: x, top: mm(128), width: w, height: hh, fill: '', stroke: '#9aa3b2', strokeWidth: 1.5, strokeDashArray: [8, 6], name: 'กรอบด้านหลัง' }), T('ด้านหลัง', x, mm(128) + hh + 8, w, 14, { fill: '#6b7280', textAlign: 'center' }), T('สำเนาถูกต้อง  ลงชื่อ ....................................', 0, mm(235), 794, 18, { textAlign: 'center' })]; }, ['#ffffff', '#dbe4ff']],
    ['โปสเตอร์', 210, 297, '#fff7ed', () => [new fabric.Rect({ left: 0, top: 0, width: 794, height: 430, fill: '#2f55c9' }), new fabric.Circle({ left: 560, top: 190, radius: 170, fill: '#e0703b', opacity: .9 }), T('ชื่องานของคุณ', 60, 130, 600, 84, { fill: '#fff', fontWeight: 'bold' }), T('คำโปรยสั้น ๆ เกี่ยวกับงานนี้', 60, 330, 600, 28, { fill: '#dbe4ff' }), T('รายละเอียดงาน\nวันที่ · เวลา · สถานที่\nเพิ่มข้อความอธิบายได้ที่นี่', 60, 500, 674, 30, { lineHeight: 1.6 }), new fabric.Rect({ left: 60, top: 940, width: 674, height: 3, fill: '#2f55c9' }), T('ติดต่อ: 08x-xxx-xxxx · เว็บไซต์ของคุณ', 60, 970, 674, 22, { fill: '#6b7280' })], ['#2f55c9', '#fff7ed']],
    ['เกียรติบัตร', 297, 210, '#fffdf5', () => [new fabric.Rect({ left: 30, top: 30, width: 1063, height: 734, fill: '', stroke: '#b8892b', strokeWidth: 8 }), new fabric.Rect({ left: 52, top: 52, width: 1019, height: 690, fill: '', stroke: '#b8892b', strokeWidth: 2 }), T('เกียรติบัตร', 0, 130, 1123, 88, { textAlign: 'center', fontWeight: 'bold', fill: '#8a6414' }), T('ขอมอบเกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า', 0, 270, 1123, 30, { textAlign: 'center' }), T('(ชื่อ - นามสกุล)', 0, 340, 1123, 64, { textAlign: 'center', fontWeight: '600' }), T('ได้ปฏิบัติหน้าที่ด้วยความตั้งใจและเป็นแบบอย่างที่ดี', 0, 450, 1123, 28, { textAlign: 'center' }), new fabric.Line([250, 640, 520, 640], { stroke: '#111827', strokeWidth: 2 }), new fabric.Line([600, 640, 870, 640], { stroke: '#111827', strokeWidth: 2 }), T('ผู้มอบ', 250, 654, 270, 22, { textAlign: 'center' }), T('วันที่', 600, 654, 270, 22, { textAlign: 'center' })], ['#fffdf5', '#b8892b']],
    ['ป้ายชื่อ', 148, 105, '#ffffff', () => [new fabric.Rect({ left: 0, top: 0, width: 559, height: 130, fill: '#ef4444' }), T('สวัสดี', 0, 26, 559, 64, { textAlign: 'center', fontWeight: 'bold', fill: '#fff' }), T('ฉันชื่อ', 0, 150, 559, 28, { textAlign: 'center', fill: '#6b7280' }), T('ชื่อของคุณ', 0, 200, 559, 72, { textAlign: 'center', fontWeight: 'bold' }), new fabric.Line([120, 320, 440, 320], { stroke: '#d1d5db', strokeWidth: 3, strokeDashArray: [8, 8] })], ['#ef4444', '#fff']],
    ['การ์ดเชิญ', 148, 210, '#fdf2f8', () => [new fabric.Circle({ left: -90, top: -90, radius: 190, fill: '#fbcfe8' }), new fabric.Circle({ left: 360, top: 600, radius: 150, fill: '#f9a8d4', opacity: .7 }), T('ขอเชิญร่วมงาน', 0, 190, 559, 28, { textAlign: 'center', fill: '#9d174d' }), T('งานเลี้ยงของเรา', 40, 250, 479, 64, { textAlign: 'center', fontWeight: 'bold', fill: '#831843' }), T('วันเสาร์ที่ 1 มกราคม\nเวลา 18.00 น.\nสถานที่จัดงาน', 40, 420, 479, 26, { textAlign: 'center', lineHeight: 1.7, fill: '#374151' })], ['#fbcfe8', '#fdf2f8']],
    ['ตารางรายการ', 210, 297, '#ffffff', () => [T('รายการ', 60, 60, 674, 54, { fontWeight: 'bold' }), new fabric.Rect({ left: 60, top: 150, width: 674, height: 52, fill: '#eef2ff' }), T('ลำดับ', 76, 162, 80, 24, { fontWeight: '600' }), T('รายละเอียด', 170, 162, 360, 24, { fontWeight: '600' }), T('จำนวน', 560, 162, 160, 24, { fontWeight: '600', textAlign: 'right' }), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => new fabric.Line([60, 262 + i * 60, 734, 262 + i * 60], { stroke: '#e5e7eb', strokeWidth: 2 }))], ['#eef2ff', '#fff']],
  ];
  function templatesPop(a) {
    pop(a, 'แม่แบบ', h('div.tplgrid', {}, TEMPLATES.map(([n, w, hh, bg, mk, cols]) => h('button.tpl', { type: 'button', onclick: async () => {
      if (!pageEmpty() && !(await confirmBox('ใช้แม่แบบนี้?', 'งานในหน้านี้จะถูกแทนที่ (กดย้อนกลับได้)', 'ใช้แม่แบบ'))) return;
      busy = true; cv.discardActiveObject(); cv.clear(); cv.backgroundColor = bg; D.w = w; D.h = hh; applyZoom(); mk().forEach(o => cv.add(o)); busy = false; fit(); commit(true); ctx(); closePops();
    } }, h('span.tp', { style: `--r:${(w / hh).toFixed(3)};background:linear-gradient(135deg,${cols[0]},${cols[1]})` }), h('b', {}, n), h('small', {}, `${w}×${hh} มม.`)))), { side: 'right', wide: 380 });
  }

  // ---------- pages strip ----------
  async function thumb(i) {
    if (i !== D.cur) return;
    try { D.thumbs[i] = cv.toDataURL({ format: 'jpeg', quality: .6, multiplier: 110 / (pw() * zoom), enableRetinaScaling: false }); } catch { }
    drawStrip();
  }
  function drawStrip() {
    if (!strip.isConnected) return;
    strip.replaceChildren(...D.pages.map((_, i) => h('button.pg', { type: 'button', draggable: true, 'aria-current': String(i === D.cur), 'aria-label': 'หน้า ' + (i + 1), title: 'ลากเพื่อสลับลำดับหน้า', onclick: () => gotoPage(i),
      ondragstart: e => { e.dataTransfer.setData('text/x-page', String(i)); e.dataTransfer.effectAllowed = 'move'; }, ondragover: e => { if ([...e.dataTransfer.types].includes('text/x-page')) e.preventDefault(); }, ondrop: e => { const from = +e.dataTransfer.getData('text/x-page'); if (Number.isInteger(from) && from !== i) { e.preventDefault(); e.stopPropagation(); movePage(from, i); } } },
      D.thumbs[i] ? h('img', { src: D.thumbs[i], alt: '', style: `aspect-ratio:${D.w}/${D.h}` }) : h('span.tp', { style: `aspect-ratio:${D.w}/${D.h}` }), h('small', {}, i + 1))),
      h('button.pg.add', { type: 'button', 'aria-label': 'เพิ่มหน้า', title: 'เพิ่มหน้า', onclick: () => addPage() }, icon('plus')),
      h('button.ib', { type: 'button', title: 'ทำซ้ำหน้านี้', 'aria-label': 'ทำซ้ำหน้านี้', onclick: () => addPage(true) }, icon('copy')),
      h('button.ib', { type: 'button', title: 'ลบหน้านี้', 'aria-label': 'ลบหน้านี้', disabled: D.pages.length < 2, onclick: delPage }, icon('trash')));
    strip.querySelector('[aria-current=true]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  strip.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  function movePage(from, to) {
    commit(true); const cur = D.pages[D.cur], moveP = (arr) => { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); };
    moveP(D.pages); moveP(D.thumbs); D.cur = D.pages.indexOf(cur) >= 0 ? D.pages.indexOf(cur) : to; drawStrip(); save();
  }
  async function gotoPage(i) {
    if (i === D.cur) return; commit(true); cv.discardActiveObject(); D.cur = i;
    await restore(D.pages[i]); hist = [snapshot()]; hi = 0; refreshHist(); drawStrip(); thumb(i); save();
  }
  async function addPage(dup) { commit(true); const s = dup ? D.pages[D.cur] : null; D.pages.splice(D.cur + 1, 0, s); D.thumbs.splice(D.cur + 1, 0, dup ? D.thumbs[D.cur] : null); D.cur++; cv.discardActiveObject(); await restore(s); hist = [snapshot()]; hi = 0; D.pages[D.cur] = hist[0]; refreshHist(); thumb(D.cur); save(); }
  async function delPage() { if (D.pages.length < 2 || !(await confirmBox('ลบหน้านี้?', `หน้าที่ ${D.cur + 1} จะถูกลบ`, 'ลบ'))) return; D.pages.splice(D.cur, 1); D.thumbs.splice(D.cur, 1); D.cur = Math.min(D.cur, D.pages.length - 1); await restore(D.pages[D.cur]); hist = [snapshot()]; hi = 0; refreshHist(); drawStrip(); save(); }

  // ---------- export + print ----------
  async function renderPages(mult, fmt = 'png') {
    commit(true); const out = [];
    for (let i = 0; i < D.pages.length; i++) {
      if (i === D.cur) { cv.discardActiveObject(); out.push(await withFull(() => cv.toDataURL({ format: fmt, quality: .92, multiplier: mult, enableRetinaScaling: false }))); continue; }
      const sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: pw(), height: ph(), renderOnAddRemove: false });
      await preloadFonts(D.pages[i]); await sc.loadFromJSON(D.pages[i] ? JSON.parse(D.pages[i]) : { background: '#ffffff' }); sc.renderAll();
      out.push(sc.toDataURL({ format: fmt, quality: .92, multiplier: mult, enableRetinaScaling: false })); await sc.dispose?.();
    }
    return out;
  }
  async function withFull(fn) { cv.setZoom(1); cv.setDimensions({ width: pw(), height: ph() }); cv.renderAll(); try { return fn(); } finally { applyZoom(); } }
  const paperFor = () => (SIZES.find(([, w, hh]) => (Math.abs(w - D.w) < .6 && Math.abs(hh - D.h) < .6) || (Math.abs(w - D.h) < .6 && Math.abs(hh - D.w) < .6)) ?? [])[3] ?? `${Math.max(D.w, D.h)}x${Math.min(D.w, D.h)}mm`;
  async function upload(dataURL, i) { const b = await (await fetch(dataURL)).blob(); const r = await fetch('/api/upload?name=' + encodeURIComponent(`${D.name}-${i + 1}.png`), { method: 'POST', body: b }).then(x => x.json()); return r.path; }

  // ---------- busy veil ----------
  const busyEl = h('div.busy', { role: 'status' }); busyEl.hidden = true;
  const setBusy = t => { busyEl.hidden = !t; busyEl.replaceChildren(...(t ? [h('span.spin'), t] : [])); };
  const uploadFile = async f => (await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }).then(x => x.json())).path;
  const readURL = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });

  // ---------- image tools: lock, trim, crop, filters ----------
  function lockObjs(t, l) { t.forEach(o => { o.locked = l; o.set({ lockMovementX: l, lockMovementY: l, lockRotation: l, lockScalingX: l, lockScalingY: l, hasControls: !l }); }); }
  function autoTrim(img) {
    const el = img.getElement(); const k = Math.min(1, 700 / Math.max(el.naturalWidth || el.width, el.naturalHeight || el.height));
    const w = Math.round((el.naturalWidth || el.width) * k), hh = Math.round((el.naturalHeight || el.height) * k);
    const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(el, 0, 0, w, hh);
    const d = x.getImageData(0, 0, w, hh).data; let x0 = w, y0 = hh, x1 = 0, y1 = 0;
    for (let y = 0; y < hh; y++) for (let xx = 0; xx < w; xx++) { const i = (y * w + xx) * 4; if (d[i + 3] > 20 && (d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225)) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 <= x0 || y1 <= y0) return false;
    const pad = 6, sx = el.naturalWidth ? el.naturalWidth / w : 1 / k, sy = el.naturalHeight ? el.naturalHeight / hh : 1 / k;
    const cx = Math.max(0, (x0 - pad) * sx), cy = Math.max(0, (y0 - pad) * sy);
    const nw = Math.min(img.width - cx, (x1 - x0 + 2 * pad) * sx), nh = Math.min(img.height - cy, (y1 - y0 + 2 * pad) * sy);
    const dx = (cx - (img.cropX || 0)) * img.scaleX, dy = (cy - (img.cropY || 0)) * img.scaleY;
    img.set({ cropX: cx, cropY: cy, width: nw, height: nh, left: img.left + dx, top: img.top + dy }); img.setCoords(); return true;
  }
  function cropMode(img) {
    if (img.angle) return toast('หมุนรูปให้เป็น 0° ก่อนครอบตัด', 'bad');
    busy = true; const box = new fabric.Rect({ left: img.left, top: img.top, width: img.getScaledWidth(), height: img.getScaledHeight(), fill: 'rgba(91,75,255,.14)', stroke: '#2f55c9', strokeWidth: 2, strokeDashArray: [8, 6], strokeUniform: true });
    cv.add(box); cv.setActiveObject(box); cv.requestRenderAll();
    const end = apply => {
      if (apply) {
        const r = box.getBoundingRect(), b = img.getBoundingRect(); const nl = Math.max(r.left, b.left), nt = Math.max(r.top, b.top), nr = Math.min(r.left + r.width, b.left + b.width), nb = Math.min(r.top + r.height, b.top + b.height);
        if (nr - nl > 8 && nb - nt > 8) img.set({ cropX: (img.cropX || 0) + (nl - b.left) / img.scaleX, cropY: (img.cropY || 0) + (nt - b.top) / img.scaleY, width: (nr - nl) / img.scaleX, height: (nb - nt) / img.scaleY, left: nl, top: nt });
      }
      cv.remove(box); busy = false; img.setCoords(); cv.setActiveObject(img); cv.requestRenderAll(); commit(true); ctx();
    };
    ctxBar.replaceChildren(h('span.hint', {}, 'ลากกรอบให้ครอบเฉพาะส่วนที่ต้องการ'), h('button.btn.sm.primary', { type: 'button', onclick: () => end(true) }, icon('check'), 'ตกลง'), h('button.btn.sm', { type: 'button', onclick: () => end(false) }, 'ยกเลิก'));
  }
  function filtersPop(a) {
    const img = active(); if (!(img instanceof fabric.FabricImage)) return;
    const F = fabric.filters; const find = C => img.filters.find(f => f instanceof C);
    const set = (C, v, key) => { img.filters = img.filters.filter(f => !(f instanceof C)); if (v) img.filters.push(new C({ [key]: v })); img.applyFilters(); cv.requestRenderAll(); commit(); };
    const gray = !!find(F.Grayscale);
    pop(a, 'ปรับภาพ', h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      h('button.btn.primary', { type: 'button', onclick: () => { img.filters = [new F.Grayscale(), new F.Contrast({ contrast: .35 }), new F.Brightness({ brightness: .12 })]; img.applyFilters(); cv.requestRenderAll(); commit(true); closePops(); } }, icon('wand'), 'เอกสารขาวคม (ขาวดำ + ชัด)'),
      h('label.sw', {}, h('span', {}, 'ขาวดำ'), h('input', { type: 'checkbox', checked: gray, onchange: e => { img.filters = img.filters.filter(f => !(f instanceof F.Grayscale)); if (e.target.checked) img.filters.push(new F.Grayscale()); img.applyFilters(); cv.requestRenderAll(); commit(true); } }), h('span.tr')),
      slider('ความสว่าง', find(F.Brightness)?.brightness ?? 0, -.6, .6, .02, v => set(F.Brightness, v, 'brightness')),
      slider('คอนทราสต์', find(F.Contrast)?.contrast ?? 0, -.6, .9, .02, v => set(F.Contrast, v, 'contrast')),
      h('button.btn.sm', { type: 'button', onclick: () => { img.filters = []; img.applyFilters(); cv.requestRenderAll(); commit(true); closePops(); } }, 'ล้างการปรับแต่ง')), { wide: 320 });
  }

  // ---------- import: files, typed text, web pages ----------
  const IMP = { tab: 'file', dpi: 200, text: '', fmt: 'markdown', url: '' };
  const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|markdown|csv|html?|xps|epub)$/i;
  async function placeFull(url, name) {
    const img = await fabric.FabricImage.fromURL(url); img.set({ name });
    img.scale(Math.min(pw() / img.width, ph() / img.height)); img.set({ left: (pw() - img.getScaledWidth()) / 2, top: (ph() - img.getScaledHeight()) / 2 });
    lockObjs([img], true); cv.add(img); cv.requestRenderAll(); commit(true);
  }
  async function importDoc(src, name, opt = {}) {
    try {
      const base = { printer: G.printer, paper: paperFor(), scale: 'fit', align: 'center', margin_mm: 0, preview_dpi: opt.dpi ?? IMP.dpi, max_pages: 8 };
      let from = 1, total = 1; const urls = [];
      while (from <= total) {
        setBusy(`กำลังแปลงเอกสาร ${total > 1 ? Math.min(from, total) + '/' + total : '…'}`);
        const r = await api('preview', { ...src, ...base, ...(from > 1 && { pages: `${from}-${Math.min(from + 7, total)}` }) });
        if (!r.ok) throw new Error(r.text);
        if (from === 1) { total = r.data?.pages_selected ?? r.images.length; if (opt.limit) total = Math.min(total, opt.limit); else if (total > 40 && !(await confirmBox('เอกสารยาวมาก', `มี ${total} หน้า การนำเข้าทั้งหมดใช้เวลานาน`, 'นำเข้าต่อ'))) total = 8; }
        if (!r.images.length) break; urls.push(...r.images); from += r.images.length;
      }
      if (!urls.length) throw new Error('ไม่มีหน้าให้นำเข้า');
      const probe = new Image(); probe.src = urls[0]; await probe.decode();
      if (D.pages.length === 1 && pageEmpty() && (probe.width > probe.height) !== (D.w > D.h)) applySize(D.h, D.w);
      const firstIdx = pageEmpty() ? D.cur : D.cur + 1;
      for (let i = 0; i < urls.length; i++) { if (i > 0 || !pageEmpty()) await addPage(); await placeFull(urls[i], `${name} หน้า ${i + 1}`); }
      await gotoPage(firstIdx); if (!opt.quiet) toast(`นำเข้า ${urls.length} หน้าแล้ว — เพิ่มข้อความหรือรูปทับได้เลย`, 'ok');
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + String(e.message ?? e).slice(0, 200), 'bad'); } finally { setBusy(null); }
  }
  async function importFiles(list) {
    for (const f of list) {
      if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)) {
        try { const out = await fabric.loadSVGFromString(await f.text()); const g = fabric.util.groupSVGElements(out.objects.filter(Boolean), out.options); g.set({ name: f.name }); const k = Math.min(1, pw() * .8 / g.width, ph() * .8 / g.height); g.scale(k); place(g); } catch (e) { toast(`${f.name}: อ่าน SVG ไม่ได้`, 'bad'); }
      } else if (/^image\//.test(f.type)) await addFiles([f]);
      else if (DOC_EXT.test(f.name)) { setBusy('กำลังอัปโหลด…'); const path = await uploadFile(f); await importDoc({ source: path, job_name: f.name }, f.name); }
      else toast(`${f.name}: ไม่รองรับไฟล์ชนิดนี้`, 'bad');
    }
  }
  function importPop(a) {
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' });
    const go = async fn => { closePops(); await fn(); };
    const draw = () => {
      const tabs = h('div.seg', {}, [['file', 'ไฟล์'], ['text', 'ข้อความ'], ['web', 'เว็บ']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(IMP.tab === k), onclick: () => { IMP.tab = k; draw(); } }, t)));
      let main;
      if (IMP.tab === 'file') {
        const inp = h('input', { type: 'file', multiple: true, class: 'sr', onchange: () => go(() => importFiles([...inp.files])) });
        main = h('label.drop', { 'data-ai': 'import-drop', style: 'padding:24px' }, inp, h('span.big', {}, icon('upload')), h('b', {}, 'เลือกหรือลากไฟล์มาวาง'), h('span', {}, 'PDF · Word · Excel · PowerPoint · รูปภาพ · Markdown · CSV · HTML'));
      } else if (IMP.tab === 'text') {
        const ta = h('textarea.textarea', { rows: 6, placeholder: 'วางข้อความยาว ๆ ที่นี่ ระบบจะจัดเป็นหน้าให้', value: IMP.text, oninput: () => { IMP.text = ta.value; } });
        main = h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, ta, h('div.seg', {}, [['text', 'ข้อความ'], ['markdown', 'Markdown'], ['html', 'HTML'], ['csv', 'CSV']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(IMP.fmt === k), onclick: e => { IMP.fmt = k; e.target.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.target))); } }, t))),
          h('button.btn.primary', { type: 'button', onclick: () => IMP.text.trim() ? go(() => importDoc({ content: IMP.text, format: IMP.fmt }, 'ข้อความ')) : toast('ยังไม่ได้ใส่ข้อความ', 'bad') }, 'แปลงเป็นหน้า'), h('p.muted', { style: 'margin:0;font-size:12.5px' }, 'อยากพิมพ์ข้อความสั้น ๆ ให้ใช้เครื่องมือ “ข้อความ” บนกระดาษ'));
      } else {
        const u = h('input.input', { type: 'url', placeholder: 'https://…', value: IMP.url, oninput: () => { IMP.url = u.value; } });
        main = h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, u, h('button.btn.primary', { type: 'button', onclick: () => /^https?:\/\//i.test(IMP.url.trim()) ? go(() => importDoc({ source: IMP.url.trim() }, 'เว็บเพจ')) : toast('ใส่ลิงก์ที่ขึ้นต้นด้วย https://', 'bad') }, 'นำเข้าหน้าเว็บ'));
      }
      const q = h('div', {}, h('div.lbl', {}, 'ความคมชัดตอนนำเข้า'), h('div.seg', {}, [[150, 'เร็ว'], [200, 'สมดุล'], [300, 'คมสุด']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(IMP.dpi === v), onclick: e => { IMP.dpi = v; e.target.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.target))); } }, `${t}`))));
      body.replaceChildren(tabs, main, q);
    };
    draw(); pop(a, 'นำเข้า', body, { side: 'right', wide: 380 });
  }

  // ---------- scan straight onto the paper ----------
  const SC = { source: 'auto', color: 'color', dpi: 300, place: 'actual', trim: false };
  async function placeScan(url) {
    const img = await fabric.FabricImage.fromURL(url); img.set({ name: 'สแกน' });
    if (SC.trim) autoTrim(img);
    const w = img.width, hh = img.height; const actual = 96 / SC.dpi;
    const k = SC.place === 'fill' ? Math.max(pw() / w, ph() / hh) : SC.place === 'fit' ? Math.min(pw() / w, ph() / hh) : Math.min(actual, pw() / w, ph() / hh);
    img.scale(k); img.set({ left: (pw() - img.getScaledWidth()) / 2, top: (ph() - img.getScaledHeight()) / 2 }); cv.add(img); return img;
  }
  async function insertScanned(files) {
    let last; for (let i = 0; i < files.length; i++) { const url = await readURL(await (await fetch('/api/file?path=' + encodeURIComponent(files[i]))).blob()); if (i > 0) await addPage(); last = await placeScan(url); commit(true); }
    return last;
  }
  async function doScan(copyMode) {
    setBusy('กำลังสแกน… อย่าขยับเอกสาร');
    try {
      const r = await api('scan', { scanner: G.printer, source: SC.source, color: SC.color, dpi: SC.dpi, format: 'jpeg', show_image: false });
      if (!r.ok) throw new Error(String(r.text).replace(/^Error:\s*/, ''));
      const files = r.data?.files ?? []; (r.data?.notes ?? []).forEach(n => toast(n));
      const last = await insertScanned(files);
      if (last) { cv.setActiveObject(last); cv.requestRenderAll(); }
      toast(`สแกนเสร็จ ${files.length} หน้า`, 'ok'); if (copyMode) { cv.discardActiveObject(); printSheet(); }
    } catch (e) { toast('สแกนไม่สำเร็จ: ' + String(e.message ?? e).slice(0, 220), 'bad'); } finally { setBusy(null); }
  }
  function scanPop(a) {
    const mini = (k, opts) => h('div.seg', {}, opts.map(([v, t]) => h('button', { type: 'button', 'data-ai': `scan-${k}-${v}`, 'aria-pressed': String(SC[k] === v), onclick: e => { SC[k] = v; e.target.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.target))); } }, t)));
    const note = h('div');
    api('printer_status', { printer: G.printer }).then(r => { const sc = r.data?.scanner; if (r.ok && !sc) note.append(h('div.note.info', {}, icon('alert'), 'ไม่พบสแกนเนอร์ในเครื่องนี้')); else if (sc?.problem) note.append(h('div.note', {}, icon('alert'), sc.problem)); });
    pop(a, 'สแกน', h('div', { style: 'display:flex;flex-direction:column;gap:16px' }, note,
      h('div', {}, h('div.lbl', {}, 'วางเอกสารที่'), mini('source', [['auto', 'อัตโนมัติ'], ['glass', 'กระจก'], ['feeder', 'ถาดป้อน']])),
      h('div', {}, h('div.lbl', {}, 'สี'), mini('color', [['color', 'สี'], ['gray', 'เทา'], ['black_white', 'ขาวดำ']])),
      h('div', {}, h('div.lbl', {}, 'ความละเอียด'), mini('dpi', [[150, '150'], [200, '200'], [300, '300'], [600, '600']])),
      h('div', {}, h('div.lbl', {}, 'วางบนกระดาษ'), mini('place', [['actual', 'ขนาดจริง · กลาง'], ['fit', 'พอดีหน้า'], ['fill', 'เต็มหน้า']])),
      h('label.sw', {}, h('span', {}, 'ตัดขอบขาวอัตโนมัติ', h('small', {}, 'เหมาะกับบัตร ใบเสร็จ หรือของชิ้นเล็ก')), h('input', { type: 'checkbox', checked: SC.trim, onchange: e => { SC.trim = e.target.checked; } }), h('span.tr')),
      h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-ai': 'scan-go', style: 'flex:1', onclick: () => { closePops(); doScan(false); } }, icon('scan'), 'สแกนลงกระดาษ'), h('button.btn', { type: 'button', 'data-ai': 'scan-copy', onclick: () => { closePops(); doScan(true); } }, icon('copy'), 'ถ่ายสำเนา'))), { side: 'right', wide: 360 });
  }

  // ---------- print sheet ----------
  const paperLabel = k => (SIZES.find(z => z[3] === k)?.[0]) ?? String(k).replace(/^iso_(a\d|b\d)_.*$/i, (m, x) => x.toUpperCase()).replace(/^na_letter.*$/, 'Letter').replace(/^na_legal.*$/, 'Legal');
  const colorLabel = k => ({ auto: 'สีอัตโนมัติ', color: 'สี', monochrome: 'ขาวดำ', black_white: 'ดำล้วน' })[k] ?? k;
  const friendlyWarn = w => /hardware margin/i.test(w) ? 'เครื่องพิมพ์ชิดขอบไม่ได้ ขอบประมาณ 3 มม. จะไม่ติดหมึก' : /borderless/i.test(w) ? 'เครื่องนี้พิมพ์ชิดขอบไม่ได้ ระบบจึงเว้นขอบตามที่เครื่องกำหนด' : w;
  const PO = { copies: 1 }; const PM = { mode: 'drawn', margin: 5, cal: 100 };
  // A landscape job comes off the printer as a portrait sheet with the content turned; show it the way it will be read.
  const upright = url => D.w <= D.h ? url : new Promise(res => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.height; c.height = i.width; const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(i, 0, 0); res(c.toDataURL('image/png')); }; i.onerror = () => res(url); i.src = url; });
  function printSheet(o = {}) {
    if (!G.printer) return toast('ยังไม่พบเครื่องพิมพ์ — เปิดเครื่องแล้วกดไอคอนเครื่องพิมพ์ด้านบน', 'bad');
    commit(true); cv.discardActiveObject();
    if (!o.sim && D.pages.every((j, i) => i === D.cur ? pageEmpty() : !j || !JSON.parse(j).objects?.length)) return toast('ยังไม่มีเนื้อหาให้พิมพ์ — นำเข้าไฟล์ สแกน หรือเพิ่มข้อความก่อน', 'bad');
    const pages = h('div.pvpages', {}, h('div.skel', { style: 'width:220px' })); const sum = h('div.sum.muted');
    const go = h('button.btn.primary.lg', { type: 'button', 'data-ai': 'print-go', disabled: true, style: 'width:100%' }, icon('print'), `พิมพ์ ${D.pages.length > 1 ? D.pages.length + ' หน้า' : ''}`);
    let paths = [], seq = 0; let live = true;
    const opts = () => ({ paper: paperFor(), orientation: D.w > D.h ? 'landscape' : 'portrait', align: 'center', ...(PM.mode === 'drawn' ? (PM.cal !== 100 ? { scale_percent: PM.cal } : { scale: 'actual' }) : { scale: 'fit', margin_mm: PM.margin }), ...(PM.mode === 'drawn' && { borderless: true }), ...clean(PO) });
    const preview = debounce(async () => {
      const my = ++seq; if (!paths.length) return;
      const rs = await Promise.all(paths.slice(0, 8).map(p => api('preview', { source: p, printer: G.printer, ...opts(), max_pages: 1, preview_dpi: 80 })));
      if (my !== seq || !live) return;
      const imgs = await Promise.all(rs.map(r => r.ok && r.images[0] ? upright(r.images[0]) : null));
      if (my !== seq || !live) return;
      pages.replaceChildren(...rs.map((r, i) => r.ok && r.images[0] ? h('div.paper', {}, h('img', { src: imgs[i], alt: `หน้า ${i + 1}` }), paths.length > 1 && h('span.no', {}, `${i + 1}/${paths.length}`)) : h('div.note.bad', {}, icon('alert'), String(r.text).slice(0, 160))));
      const d = rs[0]?.data; sum.replaceChildren(d ? `${paperLabel(d.paper)} · ${d.sheets} แผ่น/ชุด · ${colorLabel(d.color)}` : '');
      warn.replaceChildren(...(d?.warnings ?? []).map(w => h('div.note', {}, icon('alert'), friendlyWarn(w))));
    }, 450);
    if (o.ai) Object.assign(PO, clean({ copies: o.ai.copies, color: o.ai.color, quality: o.ai.quality, duplex: o.ai.duplex, ink_saver: o.ai.ink_saver }));
    const warn = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    const printers = h('div.chips');
    const drawPrinters = () => printers.replaceChildren(...G.printers.filter(p => !p.virtual).map(p => h('button.chip', { type: 'button', 'aria-pressed': String(p.id === G.printer), onclick: () => { G.printer = p.id; dispatchEvent(new Event('printers')); drawPrinters(); preview(); } }, h('span.dot', { class: p.online ? 'on' : 'off', style: 'display:inline-block;margin-right:8px' }), p.name)));
    drawPrinters();
    const place = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
    const drawPlace = () => {
      const modes = [['drawn', 'ตามที่วาง (ขนาดเป๊ะ)'], ['inset', 'เว้นขอบ']];
      const sg = h('div.seg', {}, modes.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(PM.mode === k), onclick: () => { PM.mode = k; drawPlace(); preview(); } }, t)));
      const note = h('p.muted', { style: 'margin:0;font-size:12.5px' }, PM.mode === 'drawn' ? 'พิมพ์ตามตำแหน่งและขนาดที่วางไว้ทุกอย่าง งานที่ชิดขอบจะชิดขอบ ถ้าเครื่องพิมพ์ชิดขอบไม่ได้ ขอบ 3 มม. อาจถูกตัด' : 'ย่องานให้อยู่ในพื้นที่ที่เว้นขอบแล้ว ขนาดจะเล็กลงเล็กน้อย');
      const rows = [sg, note];
      if (PM.mode === 'inset') rows.push(h('label.pf', {}, h('span', {}, 'ขอบทุกด้าน (มม.)'), numField(PM.margin, v => { PM.margin = Math.max(0, Math.min(50, v || 0)); preview(); }, { label: 'ขอบ', step: 1, min: 0, max: 50 })));
      else rows.push(h('details.more', {}, h('summary', {}, 'ปรับสอบเทียบขนาดให้เป๊ะ'), h('div.cb2', {}, h('p.muted', { style: 'margin:0;font-size:12.5px' }, 'เครื่องพิมพ์แต่ละเครื่องคลาดเล็กน้อย พิมพ์ไม้บรรทัดแล้ววัดด้วยไม้บรรทัดจริง ถ้า 10 ซม. ออกมา 9.9 ซม. ให้ใส่ 101'),
        h('label.pf', {}, h('span', {}, 'ขนาดที่พิมพ์ (%)'), numField(PM.cal, v => { PM.cal = Math.max(50, Math.min(150, v || 100)); preview(); }, { label: 'เปอร์เซ็นต์', step: 0.1, min: 50, max: 150 })))));
      place.replaceChildren(...rows);
    };
    drawPlace();
    const side = h('div.pvside', {}, h('div', {}, h('div.lbl', {}, 'เครื่องพิมพ์'), printers), panel(PO, preview, ['pbasics']), h('div', {}, h('div.lbl', {}, 'การวางบนกระดาษ'), place), h('div.pvfoot', {}, warn, sum, go));
    const s = sheet('พิมพ์', h('div.pvgrid', {}, h('div.pvstage', {}, pages), side), { wide: 1040, onClose: () => { live = false; } });
    go.onclick = async () => {
      if (o.sim) return;
      go.disabled = true; go.replaceChildren(h('span.spin'), 'กำลังส่ง…'); let okAll = true;
      for (let i = 0; i < paths.length; i++) if (!(await sendPrint({ source: paths[i], job_name: `${D.name} หน้า ${i + 1}`, ...opts() }, `${D.name} หน้า ${i + 1}`))) { okAll = false; break; }
      if (okAll) s.close(); else { go.disabled = false; go.replaceChildren(icon('print'), 'ลองพิมพ์อีกครั้ง'); }
    };
    (async () => { try { const urls = await renderPages(300 / 96); paths = await Promise.all(urls.map(async (u, i) => { const b = await pngWithDpi(u, 300); return (await fetch('/api/upload?name=' + encodeURIComponent(`${D.name}-${i + 1}.png`), { method: 'POST', body: b }).then(x => x.json())).path; })); if (!live) return; go.disabled = false; preview(); } catch (e) { pages.replaceChildren(h('div.note.bad', {}, icon('alert'), 'สร้างไฟล์พิมพ์ไม่สำเร็จ: ' + e.message)); } })();
    return { close: s.close, go };
  }
  async function downloadPNG() { const u = (await renderPages(300 / 96))[D.cur]; const a = h('a', { href: u, download: `${D.name}-${D.cur + 1}.png` }); document.body.append(a); a.click(); a.remove(); }
  function filePop(a) {
    const open = h('input', { type: 'file', accept: '.json,application/json', class: 'sr', onchange: async () => { const f = open.files[0]; if (!f) return; try { const s = JSON.parse(await f.text()); if (!s.pages?.length) throw 0; Object.assign(D, { name: s.name, w: s.w, h: s.h, pages: s.pages, cur: 0, thumbs: [] }); await save(); location.reload(); } catch { toast('ไฟล์โปรเจกต์ไม่ถูกต้อง', 'bad'); } } });
    const item = (ic, t, fn) => h('button.btn', { type: 'button', style: 'justify-content:flex-start', onclick: fn }, icon(ic), t);
    pop(a, 'งานนี้', h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, item('plus', 'งานใหม่', async () => { if (await confirmBox('เริ่มงานใหม่?', 'งานปัจจุบันจะหายไป ถ้ายังไม่ได้บันทึกโปรเจกต์', 'เริ่มใหม่')) { Object.assign(D, { name: 'งานใหม่', w: 210, h: 297, pages: [null], cur: 0, thumbs: [] }); await save(); location.reload(); } }),
      item('download', 'ดาวน์โหลดหน้านี้เป็น PNG', downloadPNG),
      item('folder', 'บันทึกโปรเจกต์ (.json)', () => { commit(true); const b = new Blob([JSON.stringify({ name: D.name, w: D.w, h: D.h, pages: D.pages })], { type: 'application/json' }); const l = h('a', { href: URL.createObjectURL(b), download: D.name + '.json' }); document.body.append(l); l.click(); l.remove(); }),
      h('label.btn', { style: 'justify-content:flex-start' }, open, icon('upload'), 'เปิดโปรเจกต์ (.json)'), h('p.muted', { style: 'margin:4px 0 0;font-size:12.5px' }, 'งานถูกบันทึกอัตโนมัติในเบราว์เซอร์นี้')), { side: 'below-end', wide: 300 });
  }

  // ---------- start screen on an empty page ----------
  const updateStart = () => { };

  // ---------- command palette ----------
  const cmdList = () => [
    ['นำเข้าไฟล์ / PDF / เว็บ', 'U', 'upload import', () => importB.click()], ['สแกนเอกสาร', '', 'scan', () => scanB.click()], ['ถ่ายสำเนา (สแกนแล้วพิมพ์)', '', 'copy scan', () => doScan(true)],
    ['เทมเพลตของฉัน', '', 'template แม่แบบ', () => tplB.click()], ['องค์ประกอบ รูปร่าง ไอคอน QR', 'E', 'shapes elements icon qr', () => elB.click()], ['วาดด้วยปากกา', 'P', 'draw pen', () => draw.start('pen')], ['ไฮไลต์', '', 'highlighter', () => draw.start('highlight')],
    ['เพิ่มหัวเรื่อง', 'T', 'text heading', () => addText('หัวเรื่อง', 64, 'bold')], ['เพิ่มข้อความ', '', 'text', () => addText('ข้อความ', 20)],
    ...SHAPES.map(([n, , mk]) => ['เพิ่ม' + n, '', 'shape', () => { const o = mk(); if (n === 'หัวใจ') o.scaleToWidth(190); place(o); }]),
    ['เพิ่มหน้าใหม่', '', 'page', () => addPage()], ['พิมพ์', 'Ctrl+P', 'print', () => printSheet()], ['บันทึกเป็น PDF', 'Ctrl+E', 'pdf export save', () => TL.run('pdf')], ['บันทึกเป็น PNG', '', 'png export', () => TL.run('png')],
    ['ย้อนกลับ', 'Ctrl+Z', 'undo', () => undo()], ['ทำซ้ำ', 'Ctrl+Y', 'redo', () => redo()], ['พอดีหน้าจอ', 'Ctrl+0', 'zoom fit', () => fit()],
    ['แสดง/ซ่อนไม้บรรทัด', 'Shift+R', 'ruler', () => { D.rulers = !D.rulers; layoutRulers(); save(); }], ['แสดง/ซ่อนตาราง', 'Shift+G', 'grid', () => { D.grid = !D.grid; applyZoom(); save(); }],
    ['สถานะเครื่องพิมพ์ / หมึก', '', 'printer ink', () => printerChip.click()], ['งานพิมพ์', '', 'jobs', () => jobsB.click()], ['ทางลัดแป้นพิมพ์ทั้งหมด', '?', 'shortcuts keyboard', () => shortcutsSheet()],
    ['ตั้งค่า', '', 'settings', () => popSettings()], ['สลับธีม สว่าง/มืด', '', 'theme dark', () => themeB.click()]];
  function palette() {
    const all = cmdList(); let sel = 0, shown = all;
    const list = h('div.pal-list', { role: 'listbox' });
    const draw = () => { list.replaceChildren(...shown.map(([t, k], i) => h('button.pal-i', { type: 'button', role: 'option', 'aria-selected': String(i === sel), onmousemove: () => { sel = i; mark(); }, onclick: () => run(i) }, h('span', {}, t), k ? h('kbd', {}, k) : null))); };
    const mark = () => list.querySelectorAll('.pal-i').forEach((b, i) => { b.setAttribute('aria-selected', String(i === sel)); if (i === sel) b.scrollIntoView({ block: 'nearest' }); });
    const run = i => { const c = shown[i]; if (!c) return; s.close(); setTimeout(() => c[3](), 0); };
    const q = h('input.input.pal-in', { placeholder: 'ค้นหาคำสั่ง… เช่น สแกน, พิมพ์, ดาว', 'aria-label': 'ค้นหาคำสั่ง', oninput: () => { const t = q.value.trim().toLowerCase(); shown = all.filter(([n, k, kw]) => (n + ' ' + k + ' ' + kw).toLowerCase().includes(t)); sel = 0; draw(); }, onkeydown: e => { if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); mark(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); } else if (e.key === 'Enter') run(sel); } });
    const s = sheet('คำสั่งด่วน', h('div', {}, q, list), { wide: 560 }); draw(); q.focus();
  }

  // ---------- the tool modules share these internals ----------
  const preloadFonts = async json => { const names = [...new Set([...String(json ?? '').matchAll(/"fontFamily":"([^"]+)"/g)].map(m => m[1]))]; await Promise.all(names.flatMap(n => [document.fonts.load(`400 20px "${n}"`), document.fonts.load(`700 20px "${n}"`)])).catch(() => { }); };
  async function applyTemplate(body, name) {
    if (!pageEmpty() && !(await confirmBox('ใช้เทมเพลตนี้?', `หน้าปัจจุบันจะถูกแทนที่ด้วย “${name}” (กดย้อนกลับได้)`, 'ใช้เทมเพลต'))) return;
    if (D.pages.length === 1 && (body.w !== D.w || body.h !== D.h)) applySize(body.w, body.h);
    const pages = body.pages ?? []; if (!pages.length) return toast('เทมเพลตว่างเปล่า', 'bad');
    D.pages.splice(D.cur + 1, 0, ...pages.slice(1)); D.thumbs.splice(D.cur + 1, 0, ...pages.slice(1).map(() => null));
    await preloadFonts(pages[0]); await restore(pages[0]); commit(true); drawStrip(); thumb(D.cur); toast(`ใช้เทมเพลต “${name}” แล้ว`, 'ok');
  }
  function applyBuiltin(n, w, hh, bg, mk) { busy = true; cv.discardActiveObject(); cv.clear(); cv.backgroundColor = bg; D.w = w; D.h = hh; applyZoom(); mk().forEach(o => cv.add(o)); busy = false; fit(); commit(true); ctx(); }
  function snapshotBuiltin(n, w, hh, bg, mk) {
    const sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: Math.round(w * PX), height: Math.round(hh * PX), renderOnAddRemove: false }); sc.backgroundColor = bg; mk().forEach(o => sc.add(o)); sc.renderAll();
    return { name: n, data: JSON.stringify({ w, h: hh, pages: [JSON.stringify(sc.toObject(KEEP))] }), width_mm: w, height_mm: hh, pages: 1, thumbnail: sc.toDataURL({ format: 'jpeg', quality: .6, multiplier: 180 / sc.getWidth() }) };
  }
  const docColors = () => [...new Set(cv.getObjects().flatMap(o => leaves(o)).flatMap(o => [o.fill, o.stroke]).filter(c => typeof c === 'string' && /^#|^rgb/.test(c)))].slice(0, 14);
  const S = { fabric, cv, D, h, icon, ICON, api, toast, modal, askText, confirmBox, pop, sheet, closePops, colorPop, debounce, G, clean, active, targets, leaves, isSel, isText, touch, commit, place, pageEmpty, pw, ph, PX, toU, fromU, uname,
    slider, ib, sep, numField, swatch, setBusy, addPage, gotoPage, applySize, renderPages, paperFor, SIZES, ctx, ctxBar, KEEP, zoom: () => zoom, BUILTIN: TEMPLATES, applyTemplate, applyBuiltin, snapshotBuiltin, docColors };
  const TL = { ...installElements(S) }; S.SHAPES = TL.SHAPES;
  TL.draw = installDraw(S); Object.assign(TL, installImageTools(S), installTemplates(S), installScripts(S), installExports(S)); const draw = TL.draw;

  // ---------- assemble ----------
  const dockBtn = (ic, t, fn, key) => h('button.rb', { type: 'button', 'data-ai': 'dock-' + key, 'aria-haspopup': 'dialog', onclick: e => fn(e.currentTarget) }, icon(ic), h('span', {}, t));
  const importB = dockBtn('upload', 'นำเข้า', importPop, 'import'), scanB = dockBtn('scan', 'สแกน', scanPop, 'scan'), tplB = dockBtn('tpl', 'เทมเพลต', a => TL.templatesPop(a), 'tpl'), elB = dockBtn('shapes2', 'เพิ่ม', a => TL.elementsPop(a), 'elements'),
    scriptB = dockBtn('code', 'สคริปต์', a => TL.scriptsPop(a), 'scripts'), textB = dockBtn('type', 'ข้อความ', textPop, 'text'), drawB = dockBtn('pen', 'วาด', () => TL.draw.toggle(), 'draw'), layerB = dockBtn('layers', 'เลเยอร์', layersPop, 'layers'), pageB = dockBtn('page', 'หน้า', pagePop, 'page');
  S.dockState = on => drawB.setAttribute('aria-pressed', String(on));
  const dock = h('nav.dock', { 'aria-label': 'เครื่องมือ' }, importB, scanB, h('i.dsep.h'), tplB, elB, textB, drawB, scriptB, h('i.dsep.h'), layerB, pageB);

  const printerChip = h('button.pchip', { type: 'button', 'data-ai': 'printer-chip', 'aria-haspopup': 'dialog', onclick: e => popPrinter(e.currentTarget) });
  const chipInfo = { problems: 0, ink: null };
  const updateChip = () => { const p = curPrinter(); printerChip.replaceChildren(...[h('span.dot', { class: p ? (p.online ? 'on' : 'off') : '' }), h('span.pn', {}, p?.name ?? 'ไม่พบเครื่องพิมพ์'), chipInfo.problems ? h('span.pill.bad', {}, '!') : chipInfo.ink !== null && chipInfo.ink <= 15 ? h('span.pill.warn', {}, 'หมึก ' + chipInfo.ink + '%') : null].filter(Boolean)); };
  const jobsB = h('button.ib.badged', { type: 'button', 'data-ai': 'jobs', title: 'งานพิมพ์', 'aria-label': 'งานพิมพ์', onclick: e => popJobs(e.currentTarget) }, icon('jobs'));
  const updateJobs = () => { jobsB.querySelector('.bd')?.remove(); if (G.active.size) jobsB.append(h('span.bd', {}, String(G.active.size))); };
  let chipTimer;
  const pollChip = async () => { if (!alive) return; if (G.printer && !document.hidden) { const r = await api('printer_status', { printer: G.printer }); const st = r.data?.status; chipInfo.problems = (st?.problems ?? []).length + (st?.online === false ? 1 : 0); chipInfo.ink = st?.ink?.length ? Math.min(...st.ink.filter(i => i.level >= 0).map(i => i.level)) : null; if (!Number.isFinite(chipInfo.ink)) chipInfo.ink = null; updateChip(); } chipTimer = setTimeout(pollChip, 25000); };
  const onPrinters = () => { updateChip(); clearTimeout(chipTimer); pollChip(); }; addEventListener('printers', onPrinters); addEventListener('jobs', updateJobs);
  const themeB = h('button.ib.hide-sm', { type: 'button', title: 'สลับธีม', 'aria-label': 'สลับธีม', onclick: () => { const cur = getTheme(); const dark = cur === 'dark' || (cur === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); applyTheme(dark ? 'light' : 'dark'); } }, icon('moon'));
  const top = h('header.topbar', {}, h('div.brand', {}, h('div.logo.sm', {}, icon('print')), h('span.hide-sm', {}, 'Print Studio')), h('i.dsep'), nameIn, undoB, redoB, h('i.grow'),
    h('button.cmdk.hide-sm', { type: 'button', 'data-ai': 'cmdk', onclick: palette }, icon('search'), h('span', {}, 'ค้นหาคำสั่ง'), h('kbd', {}, 'Ctrl K')),
    printerChip, jobsB, h('button.ib.hide-sm', { type: 'button', title: 'ไฟล์และโปรเจกต์', 'aria-label': 'ไฟล์และโปรเจกต์', onclick: e => filePop(e.currentTarget) }, icon('folder')), themeB,
    h('button.ib', { type: 'button', 'data-ai': 'settings', title: 'ตั้งค่า', 'aria-label': 'ตั้งค่า', onclick: () => popSettings() }, icon('sliders')),
    h('button.ib.hide-sm', { type: 'button', title: 'บันทึกเป็นไฟล์ (PNG PDF JPG SVG) Ctrl+E', 'aria-label': 'บันทึกเป็นไฟล์', onclick: e => TL.exportPop(e.currentTarget) }, icon('download')),
    h('button.btn.primary.printbtn', { type: 'button', 'data-ai': 'print', onclick: () => printSheet() }, icon('print'), 'พิมพ์'));
  const foot = h('div.foot', {}, h('div.pill-bar.pages', {}, strip), h('div.pill-bar.zoom', {}, ib('minus', 'ย่อ', () => setZoom(zoom / 1.2)), zoomOut, ib('plus', 'ขยาย', () => setZoom(zoom * 1.2)), ib('fit', 'พอดีหน้าจอ', () => fit())));
  const veil = h('div.dropveil', {}, h('div', {}, icon('upload'), h('b', {}, 'วางไฟล์เพื่อนำเข้า'), h('span', {}, 'PDF · Word · Excel · รูปภาพ …'))); veil.hidden = true;
  el.classList.add('dz');
  el.append(top, dock, stageWrap, foot, busyEl, veil);

  // ---------- events ----------
  const changed = () => { if (!busy) { commit(); ctx(); layersRefresh?.(); updateStart(); } };
  cv.on('object:added', changed); cv.on('object:removed', changed); cv.on('object:modified', () => { changed(); }); cv.on('text:changed', () => commit()); cv.on('text:editing:exited', () => { commit(true); ctx(); });
  ['selection:created', 'selection:updated', 'selection:cleared'].forEach(ev => cv.on(ev, () => { ctx(); layersRefresh?.(); rafRulers(); }));
  cv.on('object:scaling', () => { const o = active(); if (o && isText(o) && !isSel(o)) ctx(); });
  // Snap to page edges, page centre and other objects; guides are DOM lines so they never reach the print.
  // Hold Ctrl (⌘ on Mac) to turn every snap off, like Canva.
  const noSnap = e => !!(e?.e && (e.e.ctrlKey || e.e.metaKey));
  const snapTargets = o => {
    const xs = [0, pw() / 2, pw(), ...D.guides.v.map(m => m * PX)], ys = [0, ph() / 2, ph(), ...D.guides.h.map(m => m * PX)];
    cv.getObjects().forEach(x => { if (x === o || (isSel(o) && o.getObjects().includes(x)) || x.visible === false) return; const b = x.getBoundingRect(); xs.push(b.left, b.left + b.width / 2, b.left + b.width); ys.push(b.top, b.top + b.height / 2, b.top + b.height); });
    return { xs, ys };
  };
  // Rotation clicks to 0/45/90… when close; Shift gives 15° steps; Ctrl is free rotation.
  cv.on('object:rotating', e => {
    const o = e.target; if (noSnap(e)) return;
    let a = ((o.angle % 360) + 360) % 360;
    if (e.e?.shiftKey) { o.set('angle', Math.round(a / 15) * 15); return; }
    const n = Math.round(a / 45) * 45;
    if (Math.abs(a - n) < 4) o.set('angle', n % 360);
  });
  // Dragging a side handle snaps that edge to page edges, centre, guides and other objects.
  cv.on('object:scaling', e => {
    const o = e.target, c = e.transform?.corner; if (noSnap(e) || !['ml', 'mr', 'mt', 'mb'].includes(c) || (o.angle % 90) !== 0 || o.angle % 180 !== 0) return;
    o.setCoords(); const r = o.getBoundingRect(), { xs, ys } = snapTargets(o), T = 7 / zoom;
    const near = (list, v) => list.reduce((b, t) => Math.abs(t - v) < Math.abs(b - v) ? t : b, Infinity);
    if (c === 'mr') { const t = near(xs, r.left + r.width); if (Math.abs(t - r.left - r.width) < T) o.set('scaleX', o.scaleX * (t - r.left) / r.width); }
    if (c === 'ml') { const t = near(xs, r.left); if (Math.abs(t - r.left) < T) { const nw = r.width + r.left - t; o.set({ scaleX: o.scaleX * nw / r.width, left: t }); } }
    if (c === 'mb') { const t = near(ys, r.top + r.height); if (Math.abs(t - r.top - r.height) < T) o.set('scaleY', o.scaleY * (t - r.top) / r.height); }
    if (c === 'mt') { const t = near(ys, r.top); if (Math.abs(t - r.top) < T) { const nh = r.height + r.top - t; o.set({ scaleY: o.scaleY * nh / r.height, top: t }); } }
  });
  cv.on('object:moving', e => {
    const o = e.target; if (noSnap(e)) { gv.style.display = gh.style.display = 'none'; return; }
    o.setCoords(); const r = o.getBoundingRect(); const T = 7 / zoom; let gx = null, gy = null;
    const xs = [0, pw() / 2, pw(), ...D.guides.v.map(m => m * PX)], ys = [0, ph() / 2, ph(), ...D.guides.h.map(m => m * PX)];
    cv.getObjects().forEach(x => { if (x === o || (isSel(o) && o.getObjects().includes(x)) || x.visible === false) return; const b = x.getBoundingRect(); xs.push(b.left, b.left + b.width / 2, b.left + b.width); ys.push(b.top, b.top + b.height / 2, b.top + b.height); });
    let bx = T, by = T, dx = 0, dy = 0;
    for (const v of xs) for (const m of [r.left, r.left + r.width / 2, r.left + r.width]) { const d = v - m; if (Math.abs(d) < bx) { bx = Math.abs(d); dx = d; gx = v; } }
    for (const v of ys) for (const m of [r.top, r.top + r.height / 2, r.top + r.height]) { const d = v - m; if (Math.abs(d) < by) { by = Math.abs(d); dy = d; gy = v; } }
        if (gx !== null) o.set('left', o.left + dx); if (gy !== null) o.set('top', o.top + dy); if (gx !== null || gy !== null) o.setCoords();
    gv.style.display = gx !== null ? 'block' : 'none'; gh.style.display = gy !== null ? 'block' : 'none';
    if (gx !== null) gv.style.left = gx * zoom + 'px'; if (gy !== null) gh.style.top = gy * zoom + 'px';
  });
  cv.on('mouse:up', () => { gv.style.display = gh.style.display = 'none'; rafRulers(); });
  cv.on('object:moving', rafRulers); cv.on('object:scaling', rafRulers);
  stage.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
  let dragDepth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const onDragEnter = e => { if (hasFiles(e)) { dragDepth++; veil.hidden = false; } };
  const onDragLeave = e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; veil.hidden = true; } };
  const onDragOver = e => { if (hasFiles(e)) e.preventDefault(); };
  const onDrop = e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; veil.hidden = true; importFiles([...e.dataTransfer.files]); };
  document.addEventListener('dragenter', onDragEnter); document.addEventListener('dragleave', onDragLeave); document.addEventListener('dragover', onDragOver); document.addEventListener('drop', onDrop);
  const SHORTCUTS = [['เครื่องมือ', [['T', 'เพิ่มข้อความ'], ['R', 'สี่เหลี่ยม'], ['C', 'วงกลม'], ['L', 'เส้นตรง'], ['P', 'วาดด้วยปากกา'], ['E', 'องค์ประกอบ'], ['U', 'นำเข้าไฟล์'], ['V / Esc', 'เลือก / ยกเลิกเครื่องมือ']]],
    ['แก้ไข', [['Ctrl+Z / Ctrl+Y', 'ย้อนกลับ / ทำซ้ำ'], ['Ctrl+C / X / V', 'คัดลอก / ตัด / วาง'], ['Ctrl+D', 'ทำซ้ำ'], ['Delete', 'ลบ'], ['Ctrl+A', 'เลือกทั้งหมด'], ['Ctrl+G / Ctrl+Shift+G', 'จัดกลุ่ม / แยกกลุ่ม'], ['Ctrl+L', 'ล็อก / ปลดล็อก'], ['ลูกศร (+Shift)', 'ขยับ 1 (10) พิกเซล']]],
    ['ลำดับชั้น', [['Ctrl+]  /  Ctrl+[', 'ขึ้น / ลง หนึ่งชั้น'], ['Ctrl+Shift+]  /  [', 'หน้าสุด / หลังสุด']]],
    ['ข้อความ', [['Ctrl+B / I / U', 'ตัวหนา / เอียง / ขีดเส้นใต้'], ['Ctrl+Shift+L / E / R / J', 'ชิดซ้าย / กลาง / ขวา / เต็มแนว']]],
    ['ช่วยจัดวาง', [['กด Ctrl ค้างตอนลาก', 'ปิดการดูดติดเส้นนำทาง/ขอบ/กึ่งกลาง'], ['หมุน', 'ดูดที่ 0° 45° 90° …'], ['Shift + หมุน', 'หมุนทีละ 15°']]],
    ['มุมมอง', [['Ctrl+0', 'พอดีหน้าจอ'], ['Ctrl+1', '100%'], ['Ctrl + / Ctrl −', 'ซูมเข้า / ออก'], ['Ctrl+ล้อเมาส์', 'ซูม'], ['Space + ลาก', 'เลื่อนดูกระดาษ'], ['Shift+R', 'ไม้บรรทัด'], ['Shift+G', 'ตาราง']]],
    ['ทั่วไป', [['Ctrl+P', 'พิมพ์'], ['Ctrl+E', 'บันทึกเป็นไฟล์'], ['Ctrl+K', 'ค้นหาคำสั่ง'], ['?', 'หน้านี้']]]];
  function shortcutsSheet() {
    sheet('ทางลัดแป้นพิมพ์', h('div.keygrid', {}, SHORTCUTS.map(([g, rows]) => h('div', {}, h('div.lbl', {}, g), rows.map(([k, t]) => h('div.keyrow', {}, h('span', {}, t), h('span.keys', {}, k.split(' / ').flatMap((p, i) => [i ? ' / ' : '', ...p.split('+').flatMap((x, j) => [j ? '+' : '', h('kbd', {}, x.trim())])]))))))), { wide: 720 });
  }
  const typing = () => { const t = document.activeElement; return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || active()?.isEditing; };
  const onKey = e => {
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (document.querySelector('.backdrop')) return;
    if (mod && k === 'k') { e.preventDefault(); palette(); return; }
    if (mod && k === 'p') { e.preventDefault(); printSheet(); return; }
    if (mod && k === 'e') { e.preventDefault(); TL.exportPop(top.querySelector('[aria-label="บันทึกเป็นไฟล์"]') ?? top); return; }
    if (mod && k === 's') { e.preventDefault(); commit(true); save(); toast('บันทึกอัตโนมัติอยู่แล้ว · โหลดไฟล์โปรเจกต์ได้จากเมนู “ไฟล์”'); return; }
    if (typing()) return;
    if (mod && (k === '0')) { e.preventDefault(); fit(); return; }
    if (mod && k === '1') { e.preventDefault(); setZoom(1); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); setZoom(zoom * 1.2); return; }
    if (mod && k === '-') { e.preventDefault(); setZoom(zoom / 1.2); return; }
    if (mod && (k === ']' || k === '[')) { e.preventDefault(); targets().forEach(x => e.shiftKey ? (k === ']' ? cv.bringObjectToFront(x) : cv.sendObjectToBack(x)) : (k === ']' ? cv.bringObjectForward(x) : cv.sendObjectBackwards(x))); cv.requestRenderAll(); commit(true); layersRefresh?.(); return; }
    if (mod && k === 'l' && !e.shiftKey) { e.preventDefault(); if (active()) toggleLock(targets()); return; }
    if (mod && ['b', 'i', 'u'].includes(k) && targets().some(isText)) { e.preventDefault(); const s1 = targets().flatMap(leaves).find(isText); setAll(k === 'b' ? { fontWeight: s1.fontWeight === 'bold' ? 'normal' : 'bold' } : k === 'i' ? { fontStyle: s1.fontStyle === 'italic' ? 'normal' : 'italic' } : { underline: !s1.underline }, true); return; }
    if (mod && e.shiftKey && ['l', 'e', 'r', 'j'].includes(k) && targets().some(isText)) { e.preventDefault(); setAll({ textAlign: { l: 'left', e: 'center', r: 'right', j: 'justify' }[k] }, true); return; }
    if (!mod && !e.altKey && !e.shiftKey && !draw.isOn()) {
      const mk = { t: () => addText('พิมพ์ข้อความ', 40, 'normal'), r: () => place(new fabric.Rect({ width: 220, height: 150, fill: fillCol })), c: () => place(new fabric.Circle({ radius: 90, fill: fillCol })), l: () => place(new fabric.Line([0, 0, 280, 0], { stroke: '#111827', strokeWidth: 4, strokeLineCap: 'round' })), p: () => draw.start('pen'), e: () => elB.click(), u: () => importB.click(), v: () => { cv.discardActiveObject(); cv.requestRenderAll(); } }[k];
      if (mk) { e.preventDefault(); mk(); return; }
    }
    if (e.key === '?' || e.key === 'F1') { e.preventDefault(); shortcutsSheet(); return; }
    if (e.shiftKey && !mod && k === 'r') { D.rulers = !D.rulers; layoutRulers(); save(); return; }
    if (e.shiftKey && !mod && k === 'g') { D.grid = !D.grid; applyZoom(); save(); return; }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 'c') copyObj();
    else if (mod && k === 'x') { copyObj(); del(); }
    else if (mod && k === 'v') { if (clipObj) { e.preventDefault(); pasteObj(); } }
    else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
    else if (mod && k === 'a') { e.preventDefault(); cv.discardActiveObject(); cv.setActiveObject(new fabric.ActiveSelection(cv.getObjects().filter(o => !o.locked && o.visible !== false), { canvas: cv })); cv.requestRenderAll(); }
    else if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroup() : groupSel(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
    else if (e.key === 'Escape') { if (draw.isOn()) draw.stop(); cv.discardActiveObject(); cv.requestRenderAll(); closePops(); }
    else if (e.key.startsWith('Arrow') && active()) { e.preventDefault(); const s = e.shiftKey ? 10 : 1, o = active(); o.set({ left: o.left + (e.key === 'ArrowRight' ? s : e.key === 'ArrowLeft' ? -s : 0), top: o.top + (e.key === 'ArrowDown' ? s : e.key === 'ArrowUp' ? -s : 0) }); touch(); }
  };
  let spaceDown = false, panFrom = null;
  const onSpace = e => { if (e.code === 'Space' && !typing() && !document.querySelector('.backdrop')) { e.preventDefault(); spaceDown = e.type === 'keydown'; cv.defaultCursor = spaceDown ? 'grab' : 'default'; cv.skipTargetFind = spaceDown; stage.style.cursor = spaceDown ? 'grab' : ''; } };
  document.addEventListener('keydown', onSpace); document.addEventListener('keyup', onSpace);
  cv.on('mouse:down', ev => { if (spaceDown) panFrom = { x: ev.e.clientX, y: ev.e.clientY, sl: stage.scrollLeft, st: stage.scrollTop }; });
  cv.on('mouse:move', ev => { if (panFrom) { stage.scrollLeft = panFrom.sl - (ev.e.clientX - panFrom.x); stage.scrollTop = panFrom.st - (ev.e.clientY - panFrom.y); } });
  cv.on('mouse:up', () => { panFrom = null; });
  // right-click menu
  const menu = () => document.querySelector('.ctxmenu')?.remove();
  stage.addEventListener('contextmenu', e => {
    e.preventDefault(); menu(); if (draw.isOn()) return;
    const f = cv.findTarget(e); const t = f?.target ?? (f instanceof fabric.FabricObject ? f : null); if (t && active() !== t && !targets().includes(t)) { cv.setActiveObject(t); cv.requestRenderAll(); }
    const has = !!active(), isImg = active() instanceof fabric.FabricImage, mi = (ic, t, fn, k = '') => h('button', { type: 'button', onclick: () => { menu(); fn(); } }, icon(ic), h('span', {}, t), k && h('kbd', {}, k));
    const m = h('div.ctxmenu', { role: 'menu' }, ...[
      has && mi('copy', 'ทำซ้ำ', () => duplicate(), 'Ctrl+D'), has && mi('copy', 'คัดลอก', () => copyObj(), 'Ctrl+C'), clipObj && mi('download', 'วาง', () => pasteObj(), 'Ctrl+V'), has && mi('trash', 'ลบ', () => del(), 'Del'),
      has && h('i.dsep.h'), has && mi('up', 'ขึ้นหน้าสุด', () => { targets().forEach(x => cv.bringObjectToFront(x)); cv.requestRenderAll(); commit(true); }, 'Ctrl+Shift+]'), has && mi('down', 'ไปหลังสุด', () => { targets().forEach(x => cv.sendObjectToBack(x)); cv.requestRenderAll(); commit(true); }, 'Ctrl+Shift+['),
      has && mi('aligncv', 'วางตรงกลางหน้า', () => { alignTo('c'); alignTo('m'); }), has && mi(isLocked(targets()) ? 'unlock' : 'lock', isLocked(targets()) ? 'ปลดล็อก' : 'ล็อก', () => toggleLock(targets()), 'Ctrl+L'),
      isSel(active()) && mi('group', 'จัดกลุ่ม', groupSel, 'Ctrl+G'), active() instanceof fabric.Group && !isSel(active()) && mi('group', 'แยกกลุ่ม', ungroup, 'Ctrl+Shift+G'),
      isImg && h('i.dsep.h'), isImg && mi('magic', 'ลบพื้นหลัง', () => TL.serverEdit([{ op: 'remove_background', method: 'auto' }], 'ลบพื้นหลัง')), isImg && mi('wand', 'ตัดขอบขาวอัตโนมัติ', () => TL.serverEdit([{ op: 'trim' }], 'ตัดขอบ')), isImg && mi('crop', 'ครอบตัด', () => cropMode(active())),
      !has && mi('plus', 'เพิ่มหน้าใหม่', () => addPage()), !has && mi('type', 'เพิ่มข้อความ', () => addText('พิมพ์ข้อความ', 40, 'normal'), 'T')].filter(Boolean));
    document.body.append(m); m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 8) + 'px';
    const off = ev => { if (!m.contains(ev.target)) { m.remove(); removeEventListener('pointerdown', off, true); } }; addEventListener('pointerdown', off, true);
  }, true);
  const onPaste = e => { const fs = [...(e.clipboardData?.files ?? [])]; if (fs.length && !typing()) { e.preventDefault(); importFiles(fs); } };
  document.addEventListener('keydown', onKey); document.addEventListener('paste', onPaste);
  const KEEP_PROPS = null;

  // ---------- boot ----------
  layoutRulers(); applyZoom();
  await restore(D.pages[D.cur]);
  hist = [snapshot()]; hi = 0; busy = false; refreshHist(); fit(); ctx(); drawStrip(); thumb(D.cur); updateStart(); updateChip(); updateJobs(); pollChip();
  window.__design = { cv, D };   // for tests
  window.__studio = { layoutItems, importDoc, insertScanned, addImageUrl: addImageURL, applySize, addText, printSheet, setBusy, pageEmpty, SC, closePops, selectLast: () => { const o = cv.getObjects().at(-1); if (o) { cv.setActiveObject(o); cv.requestRenderAll(); } } };

  return () => {
    alive = false; commit(true); save(); closePops(); ro.disconnect(); clearTimeout(ht); clearTimeout(st); clearTimeout(chipTimer);
    for (const [t, f] of [['keydown', onKey], ['keydown', onSpace], ['keyup', onSpace], ['paste', onPaste], ['dragenter', onDragEnter], ['dragleave', onDragLeave], ['dragover', onDragOver], ['drop', onDrop]]) document.removeEventListener(t, f);
    removeEventListener('printers', onPrinters); removeEventListener('jobs', updateJobs); el.classList.remove('dz'); cv.dispose?.();
  };
}
