// Print Studio UI. Every action calls an MCP tool through /api/tool/<name>.
const $ = (s, r = document) => r.querySelector(s);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const ICON = {
  print: '<path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7" rx="1.5"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  jobs: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  device: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 15h8M8 11h8"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  tpl: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
};
const icon = (n, cls = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i ' + cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICON[n]; return s; };

function h(tag, props, ...kids) {
  const [t, ...cls] = tag.split('.');
  const e = document.createElement(t);
  if (cls.length) e.className = cls.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className += ' ' + v;
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(9)) if (k !== undefined && k !== null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

// ---------- api + feedback ----------
async function api(tool, args = {}) {
  try {
    const r = await fetch('/api/tool/' + tool, { method: 'POST', body: JSON.stringify(args) });
    const j = await r.json();
    if (j && j.ok === undefined && j.error) return { ok: false, text: r.status === 404 ? 'เซิร์ฟเวอร์เก่าไม่รู้จักเครื่องมือนี้ — ปิดแล้วเปิด Print Studio ใหม่ (start.bat)' : String(j.error), images: [] };
    return j;
  } catch (e) { return { ok: false, text: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจว่า npm run web ยังทำงานอยู่', images: [] }; }
}
function toast(msg, kind = '') {
  const t = h('div.toast', { class: kind, role: kind === 'bad' ? 'alert' : 'status' }, icon(kind === 'bad' ? 'alert' : 'check'), h('span', {}, msg));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3600);
}
const errText = r => String(r.text ?? '').replace(/^Error:\s*/, '').slice(0, 400) || 'เกิดข้อผิดพลาด';
function modal(title, body, actions) {
  const close = () => m.remove();
  const m = h('div.modal', { onclick: e => e.target === m && close(), role: 'dialog', 'aria-modal': 'true' },
    h('div.card', {}, h('h3', {}, title), body, h('div.row', { style: 'justify-content:flex-end' }, actions(close))));
  document.body.append(m);
  m.querySelector('button,input')?.focus();
  return close;
}
const confirmBox = (title, text, okLabel) => new Promise(res => modal(title, h('p.muted', { style: 'margin:0' }, text), close => [
  h('button.btn', { onclick: () => { close(); res(false); } }, 'ยกเลิก'),
  h('button.btn.primary', { onclick: () => { close(); res(true); } }, okLabel)]));
const askText = (title, ph) => new Promise(res => { const i = h('input.input', { placeholder: ph }); modal(title, i, close => [
  h('button.btn', { onclick: () => { close(); res(null); } }, 'ยกเลิก'),
  h('button.btn.primary', { onclick: () => { close(); res(i.value.trim() || null); } }, 'ตกลง')]); });


// ---------- state ----------
const G = { printer: undefined, printers: [], presets: { builtin: {}, yours: {} }, active: new Set() };
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null));
const STATE_TH = { queued: 'รอคิว', rendering: 'กำลังเตรียมไฟล์', sending: 'กำลังส่ง', printing: 'กำลังพิมพ์', completed: 'พิมพ์เสร็จแล้ว', failed: 'ไม่สำเร็จ', canceled: 'ยกเลิกแล้ว' };
const ACTIVE = new Set(['queued', 'rendering', 'sending', 'printing']);
const curPrinter = () => G.printers.find(p => p.id === G.printer);
const pingJobs = () => dispatchEvent(new Event('jobs'));

// ---------- popovers and sheets ----------
const PALETTE = ['#111827', '#ffffff', '#6b7280', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];
const pops = [];
function closePops(keep = 0) {
  while (pops.length > keep) { const p = pops.pop(); p.el.remove(); p.anchor?.removeAttribute('aria-expanded'); p.onClose?.(); }
}
/** Floating panel next to an anchor. side: right | below | above. Nested ones leave their parent open. */
function pop(anchor, title, content, o = {}) {
  if (!o.nested) closePops();
  const el = h('div.fly', { role: 'dialog', 'aria-label': title, style: o.wide ? `width:min(94vw,${o.wide}px)` : '' },
    h('div.fly-h', {}, h('b', {}, title), h('button.x', { type: 'button', 'aria-label': 'ปิด', onclick: () => closePops(pops.findIndex(p => p.el === el)) }, icon('x'))),
    h('div.fly-b', {}, content));
  document.body.append(el); pops.push({ el, anchor, onClose: o.onClose }); anchor?.setAttribute('aria-expanded', 'true');
  const place = () => {
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
    let x = o.side === 'right' ? r.right + 14 : r.left, y = o.side === 'right' ? r.top : o.side === 'above' ? r.top - hh - 12 : r.bottom + 12;
    if (o.side === 'below-end') x = r.right - w;
    el.style.left = Math.max(10, Math.min(x, innerWidth - w - 10)) + 'px'; el.style.top = Math.max(10, Math.min(y, innerHeight - hh - 10)) + 'px';
  };
  place(); el.querySelector('input:not([type=file]),button.chip')?.focus?.({ preventScroll: true });
  return el;
}
document.addEventListener('pointerdown', e => { for (let i = pops.length - 1; i >= 0; i--) { if (pops[i].el.contains(e.target) || pops[i].anchor?.contains(e.target)) break; closePops(i); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pops.length && !document.querySelector('.backdrop')) closePops(pops.length - 1); });

/** Large centred dialog for bigger jobs such as printing. */
function sheet(title, content, o = {}) {
  closePops();
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); o.onClose?.(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const back = h('div.backdrop', { onpointerdown: e => e.target === back && close() },
    h('section.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: o.wide ? `width:min(96vw,${o.wide}px)` : '' },
      h('header.sheet-h', {}, h('b', {}, title), h('button.x', { type: 'button', 'aria-label': 'ปิด', onclick: close }, icon('x'))), h('div.sheet-b', {}, content)));
  document.body.append(back); document.addEventListener('keydown', esc);
  return { close, el: back };
}

function colorPop(anchor, value, onPick, allowNone = false, o = {}) {
  const mine = () => { try { return JSON.parse(localStorage.getItem('ps-colors')) ?? []; } catch { return []; } };
  const keep = l => { try { localStorage.setItem('ps-colors', JSON.stringify(l.slice(0, 18))); } catch { } };
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  let tab = 'solid'; const grad = { from: '#2f55c9', to: '#e0703b', angle: 90 };
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#2f55c9';
  const sw = (c, extra = {}) => h('button.swb', { type: 'button', style: `--c:${c}`, 'aria-label': c, title: c, onclick: () => onPick(c), ...extra });
  const draw = () => {
    const native = h('input', { type: 'color', value: hex, 'aria-label': 'เลือกสีเอง', oninput: () => onPick(native.value) });
    const tabs = h('div.seg', {}, [['solid', 'สีเดียว'], ['grad', 'ไล่สี']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(tab === k), onclick: () => { tab = k; draw(); } }, t)));
    const solid = [h('div.sw-grid', {}, PALETTE.map(c => sw(c))),
      o.doc?.length ? h('div', {}, h('div.lbl', {}, 'สีที่ใช้ในงานนี้'), h('div.sw-grid', {}, o.doc.map(c => sw(c)))) : null,
      h('div', {}, h('div.lbl', {}, 'สีของฉัน', h('button.btn.sm.ghost', { type: 'button', onclick: () => { const l = mine(); if (/^#/.test(hex) && !l.includes(hex)) { keep([hex, ...l]); draw(); } } }, '+ เก็บสีนี้')),
        mine().length ? h('div.sw-grid', {}, mine().map(c => sw(c, { title: c + ' (คลิกขวาเพื่อลบ)', oncontextmenu: e => { e.preventDefault(); keep(mine().filter(x => x !== c)); draw(); } }))) : h('span.muted', { style: 'font-size:12.5px' }, 'ยังไม่มี กด “เก็บสีนี้” เพื่อเก็บสีแบรนด์ไว้ใช้ซ้ำ')),
      h('div.row', {}, h('label.btn.sm', {}, 'สีที่กำหนดเอง', native), window.EyeDropper && h('button.btn.sm', { type: 'button', onclick: async () => { try { onPick((await new window.EyeDropper().open()).sRGBHex); } catch { /* cancelled */ } } }, 'ดูดสีจากจอ'), allowNone && h('button.btn.sm', { type: 'button', onclick: () => onPick('') }, 'ไม่มีสี'))];
    const push = () => onPick({ gradient: { ...grad } });
    const stop = (k, t) => { const i = h('input', { type: 'color', value: grad[k], 'aria-label': t, oninput: () => { grad[k] = i.value; push(); } }); return h('label.btn.sm', {}, t, i); };
    const ang = h('input', { type: 'range', min: 0, max: 360, step: 5, value: grad.angle, 'aria-label': 'ทิศทาง', oninput: () => { grad.angle = +ang.value; push(); } });
    const gradient = [h('div.row', {}, stop('from', 'สีเริ่ม'), stop('to', 'สีจบ')), h('div', {}, h('div.lbl', {}, 'ทิศทาง'), ang),
      h('div.chips', {}, [['#2f55c9', '#7aa2ff'], ['#e0703b', '#ffd27a'], ['#0f9d63', '#c8f0d8'], ['#111827', '#6b7280'], ['#d946ef', '#6366f1'], ['#f43f5e', '#fde68a']].map(([f, t]) => h('button.swb', { type: 'button', style: `--c:linear-gradient(90deg,${f},${t});width:44px;aspect-ratio:2/1`, 'aria-label': 'ไล่สี', onclick: () => { grad.from = f; grad.to = t; push(); draw(); } })))];
    body.replaceChildren(...[o.gradient ? tabs : null, ...(tab === 'solid' ? solid : gradient)].filter(Boolean));
  };
  draw();
  return pop(anchor, 'สี', body, { nested: true, wide: 310 });
}

const ART_PRINT = '<svg class="art" viewBox="0 0 160 120" fill="none"><rect x="38" y="8" width="84" height="104" rx="6" fill="var(--surface)" stroke="var(--line)" stroke-width="2"/><rect x="50" y="24" width="40" height="7" rx="3.5" fill="var(--accent)"/><rect x="50" y="42" width="60" height="5" rx="2.5" fill="var(--surface3)"/><rect x="50" y="54" width="52" height="5" rx="2.5" fill="var(--surface3)"/><rect x="50" y="66" width="58" height="5" rx="2.5" fill="var(--surface3)"/><rect x="50" y="86" width="30" height="14" rx="5" fill="var(--accent-soft)"/><circle cx="128" cy="96" r="16" fill="var(--accent)"/><path d="M121 96h14M128 89v14" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
const ART_SCAN = '<svg class="art" viewBox="0 0 160 120" fill="none"><rect x="14" y="52" width="132" height="52" rx="10" fill="var(--surface)" stroke="var(--line)" stroke-width="2"/><rect x="26" y="62" width="108" height="8" rx="4" fill="var(--surface3)"/><rect x="48" y="14" width="64" height="46" rx="4" fill="var(--surface)" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4"/><path d="M56 28h48M56 36h36M56 44h42" stroke="var(--surface3)" stroke-width="4" stroke-linecap="round"/><circle cx="124" cy="88" r="4" fill="var(--ok)"/></svg>';
const art = s => { const d = document.createElement('div'); d.innerHTML = s; return d.firstChild; };
// ---------- setting controls ----------
function panel(S, onChange, sections) {
  const sync = [];
  const set = (k, v) => { if (v === undefined || v === '' || v === false) delete S[k]; else S[k] = v; sync.forEach(f => f()); onChange(); };
  const reg = (el, f) => { sync.push(f); f(); return el; };
  const lbl = (t, extra) => h('div.lbl', {}, h('span', {}, t), extra);
  const seg = (k, opts, def, dis = () => false) => {
    const btns = opts.map(([v, t]) => h('button', { type: 'button', 'data-ai': `${k}:${v}`, onclick: () => set(k, v === def ? undefined : v) }, t));
    return reg(h('div.seg', { role: 'group' }, btns), () => btns.forEach((b, i) => { b.setAttribute('aria-pressed', String((S[k] ?? def) === opts[i][0])); b.disabled = dis(opts[i][0]); }));
  };
  const chips = (k, opts, def) => {
    const btns = opts.map(([v, t]) => h('button.chip', { type: 'button', onclick: () => set(k, v === def ? undefined : v) }, t));
    return reg(h('div.chips', {}, btns), () => btns.forEach((b, i) => b.setAttribute('aria-pressed', String((S[k] ?? def) === opts[i][0]))));
  };
  const range = (k, t, min, max, step, unit, def = 0) => {
    const o = h('output'); const i = h('input', { type: 'range', min, max, step, 'aria-label': t });
    i.addEventListener('input', () => set(k, +i.value === def ? undefined : +i.value));
    return h('div', {}, lbl(t, o), reg(i, () => { const v = S[k] ?? def; i.value = v; i.style.setProperty('--p', ((v - min) / (max - min)) * 100 + '%'); o.textContent = v + unit; }));
  };
  const toggle = (k, t, hint) => { const i = h('input', { type: 'checkbox', onchange: () => set(k, i.checked || undefined) }); return reg(h('label.sw', {}, h('span', {}, t, hint && h('small', {}, hint)), i, h('span.tr')), () => { i.checked = !!S[k]; }); };
  const text = (k, ph, t) => { const i = h('input.input', { placeholder: ph, 'aria-label': t, oninput: () => set(k, i.value) }); return h('div', {}, lbl(t), reg(i, () => { if (document.activeElement !== i) i.value = S[k] ?? ''; })); };
  const stepper = k => { const o = h('output'); return reg(h('div.step', {}, h('button', { type: 'button', 'data-ai': k + ':-', 'aria-label': 'ลด', onclick: () => set(k, Math.max(1, (S[k] ?? 1) - 1) || undefined) }, '−'), o, h('button', { type: 'button', 'data-ai': k + ':+', 'aria-label': 'เพิ่ม', onclick: () => set(k, Math.min(99, (S[k] ?? 1) + 1)) }, '+')), () => { o.textContent = S[k] ?? 1; }); };
  const align = k => {
    const pos = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
    const names = ['บนซ้าย', 'บนกลาง', 'บนขวา', 'กลางซ้าย', 'กึ่งกลาง', 'กลางขวา', 'ล่างซ้าย', 'ล่างกลาง', 'ล่างขวา'];
    const btns = pos.map((v, i) => h('button', { type: 'button', 'aria-label': names[i], title: names[i], onclick: () => set(k, v) }));
    return reg(h('div.agrid', { role: 'group', 'aria-label': 'ตำแหน่งบนกระดาษ' }, btns), () => btns.forEach((b, i) => b.setAttribute('aria-pressed', String((S[k] ?? 'center') === pos[i]))));
  };
  const pr = curPrinter();
  const paper = () => h('div', {}, lbl('ขนาดกระดาษ'), chips('paper', [[undefined, 'ตามเครื่อง'], ['A4', 'A4'], ['A5', 'A5'], ['A6', 'A6'], ['letter', 'Letter'], ['legal', 'Legal'], ['4x6', '4×6"'], ['5x7', '5×7"'], ['photo-l', 'ภาพ L']], undefined));
  const parts = {
    presets: () => G.presets && h('div', {}, lbl('พรีเซ็ต'), h('div.chips', {}, Object.entries({ ...G.presets.builtin, ...G.presets.yours }).map(([n, o]) =>
      h('button.chip', { type: 'button', onclick: () => { const c = S.copies; for (const k of Object.keys(S)) delete S[k]; Object.assign(S, o, c ? { copies: c } : {}); sync.forEach(f => f()); onChange(); } }, n)))),
    paper,
    pbasics: () => [
      h('div', {}, lbl('สี'), seg('color', [['auto', 'อัตโนมัติ'], ['color', 'สี'], ['monochrome', 'ขาวดำ'], ['black_white', 'ดำล้วน']], 'auto')),
      h('div', {}, lbl('คุณภาพ'), seg('quality', [['draft', 'ประหยัดหมึก'], ['normal', 'ปกติ'], ['high', 'สูง']], 'normal')),
      h('div', {}, lbl('พิมพ์สองหน้า' + (pr && !pr.duplex ? ' (เครื่องนี้ไม่รองรับ)' : '')), seg('duplex', [['none', 'หน้าเดียว'], ['long', 'ติดขอบยาว'], ['short', 'ติดขอบสั้น']], 'none', v => v !== 'none' && pr && !pr.duplex)),
      range('ink_saver', 'ประหยัดหมึก', 0, 90, 5, '%'),
    ],
    basics: () => [
      h('div', {}, lbl('ทิศทาง'), seg('orientation', [['auto', 'อัตโนมัติ'], ['portrait', 'แนวตั้ง'], ['landscape', 'แนวนอน']], 'auto')),
      h('div', {}, lbl('สี'), seg('color', [['auto', 'อัตโนมัติ'], ['color', 'สี'], ['monochrome', 'ขาวดำ'], ['black_white', 'ดำล้วน']], 'auto')),
      h('div', {}, lbl('คุณภาพ'), seg('quality', [['draft', 'ประหยัดหมึก'], ['normal', 'ปกติ'], ['high', 'สูง']], 'normal')),
      h('div', {}, lbl('พิมพ์สองหน้า' + (pr && !pr.duplex ? ' (เครื่องนี้ไม่รองรับ)' : '')), seg('duplex', [['none', 'หน้าเดียว'], ['long', 'ติดขอบยาว'], ['short', 'ติดขอบสั้น']], 'none', v => v !== 'none' && pr && !pr.duplex)),
      h('div.two', {}, h('div', {}, lbl('จำนวนชุด'), stepper('copies')), text('pages', 'ทั้งหมด หรือ 1-3,5', 'เฉพาะหน้า')),
    ],
    fit: () => [
      h('div', {}, lbl('การปรับขนาด'), seg('scale', [['fit', 'พอดีหน้า'], ['fill', 'เต็มหน้า'], ['shrink', 'ย่อถ้าใหญ่'], ['actual', '100%']], 'fit')),
      h('div', {}, lbl('ตำแหน่งบนกระดาษ'), h('div.alignrow', {}, align('align'), h('div', { style: 'flex:1' }, range('margin_mm', 'ขอบกระดาษ', 0, 50, 1, ' มม.')))),
    ],
    text: () => [range('font_size_pt', 'ขนาดตัวอักษร', 8, 28, 1, ' pt', 11), range('line_height', 'ระยะบรรทัด', 1, 2.5, 0.1, '×', 1.5), toggle('line_numbers', 'แสดงเลขบรรทัด')],
    more: () => h('details.more', {}, h('summary', {}, 'ตั้งค่าขั้นสูง'), h('div.cb2', {},
      h('div', {}, lbl('หลายหน้าต่อแผ่น'), chips('n_up', [[1, '1'], [2, '2'], [4, '4'], [6, '6'], [9, '9']], 1)),
      range('border_mm', 'กรอบรอบหน้า', 0, 10, 0.5, ' มม.'),
      text('watermark', 'เช่น ตัวอย่าง / ห้ามคัดลอก', 'ลายน้ำ'), range('watermark_opacity', 'ความเข้มลายน้ำ', 1, 100, 1, '%', 15),
      text('header', 'ซ้าย|กลาง|ขวา เช่น {name}||{date}', 'หัวกระดาษ'), text('footer', '|{page}/{pages}|', 'ท้ายกระดาษ'),
      range('brightness', 'ความสว่าง', -100, 100, 1, ''), range('contrast', 'คอนทราสต์', -100, 100, 1, ''), range('saturation', 'ความสด', -100, 100, 1, ''),
      range('darkness', 'ความเข้มหมึก', -100, 100, 1, ''), range('ink_saver', 'ประหยัดหมึก', 0, 90, 5, '%'),
      toggle('borderless', 'พิมพ์ชิดขอบ', 'ไม่เว้นขอบ ถ้าเครื่องรองรับ'), toggle('reverse', 'พิมพ์จากหน้าสุดท้าย'), toggle('mirror', 'กลับด้านซ้าย-ขวา', 'สำหรับรีดติดเสื้อ'), toggle('invert', 'สลับสีขาว-ดำ'))),
  };
  return h('div.cb', {}, sections.flatMap(s => parts[s]?.() ?? []));
}

// ---------- job tracking ----------
function trackJob(id, name) {
  G.active.add(id); pingJobs();
  const bar = h('i'); const state = h('span.pill'); const title = h('b', {}, name);
  const card = h('div.jt', {}, h('div.r', {}, icon('print'), title, state), h('div.prog', {}, bar));
  $('#jobtray').append(card);
  const tick = async () => {
    const r = await api('job_status', { job: id });
    const j = Array.isArray(r.data) ? r.data[0] : null;
    if (!j) { G.active.delete(id); pingJobs(); return setTimeout(() => card.remove(), 2000); }
    state.textContent = STATE_TH[j.state] ?? j.state;
    state.className = 'pill ' + (j.state === 'completed' ? 'ok' : j.state === 'failed' ? 'bad' : j.state === 'canceled' ? '' : 'acc');
    bar.parentElement.style.setProperty('--w', (j.state === 'completed' ? 100 : j.sheets_total ? (j.sheets_sent / j.sheets_total) * 100 : 8) + '%');
    if (j.printer_problems?.length) { const p = j.printer_problems[0]; card.querySelector('.note')?.remove(); card.append(h('div.note.bad', { style: 'margin-top:10px' }, icon('alert'), h('span', {}, p.you_do ?? p.reason))); }
    if (ACTIVE.has(j.state)) setTimeout(tick, 1500);
    else { G.active.delete(id); pingJobs(); if (j.state === 'failed') toast(`พิมพ์ "${name}" ไม่สำเร็จ${j.error ? ': ' + j.error : ''}`, 'bad'); setTimeout(() => card.remove(), j.state === 'failed' ? 12000 : 4500); }
  };
  tick();
}

async function sendPrint(args, label) {
  let r = await api('print', { ...args, printer: G.printer });
  if (!r.ok && /confirm_large/.test(r.text) && await confirmBox('งานพิมพ์ใหญ่', errText(r), 'พิมพ์เลย')) r = await api('print', { ...args, printer: G.printer, confirm_large: true });
  if (!r.ok) { toast(errText(r), 'bad'); return false; }
  const d = r.data ?? {};
  (d.warnings ?? []).forEach(w => toast(w));
  if (d.duplicate_of_recent_job) toast('งานนี้เหมือนงานที่เพิ่งส่งไป จึงไม่ส่งซ้ำ');
  else { toast(`ส่งไปที่ ${d.printer ?? 'เครื่องพิมพ์'} แล้ว`, 'ok'); if (d.job) trackJob(d.job, label); }
  return true;
}

// ---------- printer view ----------
const INK = [[/cyan|ฟ้า/i, '#00b4e6'], [/magenta|แดง/i, '#e6007e'], [/yellow|เหลือง/i, '#ffd000'], [/black|ดำ/i, '#2b2d3a']];
async function viewPrinter(el) {
  if (!G.printer) { el.append(noPrinter()); return; }
  const body = h('div', {}, h('div.skel', { style: 'width:100%;aspect-ratio:3/1' })); el.append(body);
  let alive = true; let timer;
  async function load() {
    clearTimeout(timer);
    const r = await api('printer_status', { printer: G.printer });
    if (!alive || !body.isConnected) return;
    if (!r.ok) { body.replaceChildren(h('div.note.bad', {}, icon('alert'), errText(r))); return; }
    body.replaceChildren(drawPrinter(r.data, load));
    timer = setTimeout(load, 6000);
  }
  load();
  return () => { alive = false; clearTimeout(timer); };
}
const noPrinter = () => h('div.card', {}, h('div.cb', {}, h('div.empty', {}, art(ART_PRINT), h('b', {}, 'ไม่พบเครื่องพิมพ์'), 'เปิดเครื่องพิมพ์และต่อ Wi-Fi เดียวกับคอมพิวเตอร์ แล้วกดค้นหา'),
  h('button.btn.primary', { onclick: async e => { e.target.disabled = true; await loadPrinters(true); closePops(); } }, icon('refresh'), 'ค้นหาเครื่องพิมพ์')));
const PRESET_TH = { document: 'เอกสารทั่วไป', draft: 'ร่าง ประหยัดหมึก', eco: 'ประหยัดสุด (2 หน้าต่อแผ่น)', sharp_text: 'ตัวอักษรคมชัด', photo: 'ภาพถ่าย', photo_borderless: 'ภาพถ่ายชิดขอบ', booklet_2up: 'สมุดพับ 2 หน้า', handout_4up: 'เอกสารแจก 4 หน้าต่อแผ่น', poster_vivid: 'โปสเตอร์สีสด', scan_cleanup: 'ล้างสแกน ขาวสะอาด' };
const OPT_TH = { quality: ['คุณภาพ', { draft: 'ร่าง', normal: 'ปกติ', high: 'สูง' }], color: ['สี', { auto: 'อัตโนมัติ', color: 'สี', monochrome: 'ขาวดำ', black_white: 'ดำล้วน' }], duplex: ['สองหน้า', { none: 'ไม่', long: 'ติดขอบยาว', short: 'ติดขอบสั้น' }], scale: ['ปรับขนาด', { fit: 'พอดีหน้า', fill: 'เต็มหน้า', shrink: 'ย่อถ้าใหญ่', actual: '100%', stretch: 'ยืด' }],
  ink_saver: ['ประหยัดหมึก', null, '%'], n_up: ['หน้าต่อแผ่น', null], darkness: ['ความเข้ม', null], contrast: ['คอนทราสต์', null], brightness: ['ความสว่าง', null], saturation: ['ความสด', null], borderless: ['ชิดขอบ', { true: 'ใช่' }], copies: ['จำนวนชุด', null], paper: ['กระดาษ', null], orientation: ['ทิศทาง', { portrait: 'แนวตั้ง', landscape: 'แนวนอน', auto: 'อัตโนมัติ' }], sharpen: ['ความคม', null], threshold: ['ค่าตัดขาวดำ', null] };
const describeOptions = o => Object.entries(o).map(([k, v]) => { const m = OPT_TH[k]; return m ? `${m[0]} ${m[1]?.[String(v)] ?? v}${m[2] ?? ''}` : `${k} ${v}`; }).join(' · ');
const connLabel = c => { const ip = /network (\d+\.\d+\.\d+\.\d+)/.exec(c ?? '')?.[1]; const parts = []; if (ip) parts.push(`Wi-Fi / เครือข่าย (${ip})`); if (/windows queue/.test(c ?? '')) parts.push(ip ? 'และไดรเวอร์ Windows' : 'ไดรเวอร์ Windows'); return parts.join(' ') || c; };
const trayName = t => ({ main: 'ถาดหลัก', manual: 'ป้อนด้วยมือ', auto: 'อัตโนมัติ', 'main-roll': 'ม้วนหลัก', photo: 'ถาดภาพถ่าย', top: 'ถาดบน', bottom: 'ถาดล่าง', rear: 'ถาดหลัง' })[t] ?? t;
const paperName = k => k.replace(/^iso_(a\d|b\d)_.*$/i, (m, x) => x.toUpperCase()).replace(/^na_letter.*$/, 'Letter').replace(/^na_legal.*$/, 'Legal').replace(/^na_executive.*$/, 'Executive').replace(/^na_(\d+)x(\d+)_.*$/, '$1×$2"').replace(/^na_index-4x6.*$/, '4×6"').replace(/^jpn_hagaki.*$/, 'Hagaki').replace(/^om_small-photo.*$/, 'Photo L');
function drawPrinter(d, reload) {
  const st = d.status ?? {};
  const act = (label, ic, fn, cls = '') => h('button.btn.sm', { class: cls, type: 'button', 'data-ai': 'printer-' + ic, onclick: async e => { const b = e.currentTarget; b.disabled = true; await fn(); b.disabled = false; } }, icon(ic), label);
  const stateTh = { idle: 'ว่าง พร้อมพิมพ์', printing: 'กำลังพิมพ์', stopped: 'หยุดทำงาน' }[st.state] ?? st.state;
  const REASON_TH = { 'media-empty': 'กระดาษหมด', 'media-needed': 'ต้องใส่กระดาษ', 'media-jam': 'กระดาษติด', 'cover-open': 'ฝาเครื่องเปิดอยู่', 'door-open': 'ฝาเครื่องเปิดอยู่', 'marker-supply-empty': 'หมึกหมด', 'marker-supply-low': 'หมึกใกล้หมด', 'marker-waste-full': 'ถังหมึกเสียเต็ม', 'marker-waste-almost-full': 'ถังหมึกเสียใกล้เต็ม', offline: 'เครื่องออฟไลน์', paused: 'เครื่องหยุดชั่วคราว', 'toner-empty': 'หมึกหมด', 'toner-low': 'หมึกใกล้หมด', 'input-tray-missing': 'ไม่มีถาดกระดาษ', 'output-area-full': 'ถาดรับกระดาษเต็ม', 'spool-area-full': 'คิวงานเต็ม' };
  const probs = (st.problems ?? []).map(p => h('div.note', { class: p.severe ? 'bad' : '' }, icon('alert'), h('div', {}, h('b', {}, REASON_TH[String(p.reason).replace(/-(error|warning|report)$/, '')] ?? p.what ?? p.title ?? p.reason), p.you_do)));
  if (st.online === false) probs.unshift(h('div.note.bad', {}, icon('alert'), h('div', {}, h('b', {}, 'เครื่องออฟไลน์'), st.error ?? 'ตรวจว่าเปิดเครื่องและต่อ Wi-Fi เดียวกัน แล้วกด “ตรวจและแก้ไข”')));
  const caps = d.capabilities ?? {};
  const inks = (st.ink ?? []).map(i => { const c = INK.find(([re]) => re.test(i.name))?.[1] ?? 'var(--accent)'; const lv = i.level >= 0 ? i.level : null;
    return h('div.ink', {}, h('b', {}, lv === null ? '?' : lv + '%'), h('div.tube', { style: `--h:${lv ?? 0}%;--c:${c}` }, h('i')), i.name); });
  const jobs = (d.jobs_on_printer ?? []).map(j => { const id = j['job-id']?.[0] ?? j.id ?? j['job-id']; return h('div.job', {}, h('span.ic', {}, icon('file')), h('div.n', {}, h('b', {}, String(j['job-name']?.[0] ?? j.name ?? `งาน ${id}`)), h('small', {}, String(j['job-state']?.[0] ?? j.state ?? ''))),
    h('button.btn.sm.danger', { type: 'button', 'data-ai': 'printer-job-' + id, onclick: async () => { const r = await api('cancel_job', { printer: G.printer, printer_job_id: +id }); toast(r.ok ? 'ยกเลิกงานแล้ว' : errText(r), r.ok ? 'ok' : 'bad'); reload(); } }, 'ยกเลิก')); });
  return h('div', { style: 'display:flex;flex-direction:column;gap:18px' },
    h('div.card.hero', {}, h('div.pic', {}, icon('print')), h('div', { style: 'flex:1;min-width:220px' }, h('h2', {}, d.name), d.model && d.model !== d.name && h('div.muted', {}, d.model),
      h('div.meta', {}, h('span.pill', { class: st.online ? 'ok' : 'bad' }, st.online ? '● ออนไลน์' : '● ออฟไลน์'), st.online && h('span.pill', {}, stateTh), h('span.pill', {}, connLabel(d.connection)), h('span.pill', {}, d.color ? 'พิมพ์สีได้' : 'ขาวดำ'), d.duplex && h('span.pill', {}, 'สองหน้า'))),
      h('div.row', {}, act('ระบุเครื่อง', 'bell', async () => { const r = await api('identify_printer', { printer: G.printer }); toast(r.ok ? 'เครื่องกำลังส่งสัญญาณ' : errText(r), r.ok ? 'ok' : 'bad'); }),
        act('ตรวจและแก้ไข', 'wrench', async () => { const r = await api('fix_printer', { printer: G.printer }); modal('ผลการตรวจ', h('pre', { style: 'white-space:pre-wrap;max-height:50vh;overflow:auto;margin:0;font:13px/1.5 ui-monospace,monospace' }, r.text), c => [h('button.btn.primary', { onclick: c }, 'ปิด')]); }),
        act('หน้าทดสอบ', 'file', async () => { if (await confirmBox('พิมพ์หน้าทดสอบ', 'จะใช้กระดาษ 1 แผ่น', 'พิมพ์')) { const r = await api('print_test_page', { printer: G.printer }); toast(r.ok ? 'ส่งหน้าทดสอบแล้ว' : errText(r), r.ok ? 'ok' : 'bad'); if (r.data?.job) trackJob(r.data.job, 'หน้าทดสอบ'); } }),
        act('ค้นหาใหม่', 'refresh', async () => { await loadPrinters(true); reload(); }))),
    ...probs,
    h('div.grid2', {},
      h('div.card', {}, h('div.ch', {}, 'ระดับหมึก'), h('div.cb', {}, inks.length ? h('div.inks', {}, inks) : h('span.muted', {}, 'เครื่องนี้ไม่รายงานระดับหมึก'))),
      h('div.card', {}, h('div.ch', {}, 'กระดาษและความสามารถ'), h('div.cb', {}, h('dl.kv', {},
        h('dt', {}, 'กระดาษในถาด'), h('dd', {}, (st.paperLoaded ?? []).join(', ') || '—'),
        h('dt', {}, 'ขนาดที่รองรับ'), h('dd', {}, [...new Set((caps.paper ?? []).map(paperName))].slice(0, 8).join(' · ') || '—'),
        h('dt', {}, 'ความละเอียด'), h('dd', {}, (caps.dpi ?? []).join(' / ') || '—'),
        h('dt', {}, 'ถาดกระดาษ'), h('dd', {}, (caps.trays ?? []).map(trayName).join(' · ') || '—'),
        h('dt', {}, 'พิมพ์ชิดขอบ'), h('dd', {}, caps.borderless ? 'ได้' : 'ไม่ได้')))),
      d.scanner && h('div.card', {}, h('div.ch', {}, 'สแกนเนอร์'), h('div.cb', {}, h('dl.kv', {}, h('dt', {}, 'สถานะ'), h('dd', {}, d.scanner.state), h('dt', {}, 'ถาดป้อนเอกสาร'), h('dd', {}, d.scanner.adf ?? '—'))))),
    h('div.card', {}, h('div.ch', {}, 'คิวในเครื่อง', h('span.sub', {}, jobs.length + ' งาน')), h('div.cb', {}, jobs.length ? h('div.joblist', {}, jobs) : h('span.muted', {}, 'ไม่มีงานค้างในเครื่อง'))));
}

// ---------- jobs view ----------
async function viewJobs(el) {
  const list = h('div.joblist'); el.append(list);
  let alive = true; let timer;
  async function load() {
    const r = await api('job_status', { limit: 40 });
    if (!alive || !list.isConnected) return;
    const rows = Array.isArray(r.data) ? r.data : [];
    list.replaceChildren(...(rows.length ? rows.map(j => h('div.job', {}, h('span.ic', {}, icon(j.state === 'completed' ? 'check' : j.state === 'failed' ? 'alert' : 'print')),
      h('div.n', {}, h('b', {}, j.document), h('small', {}, `${j.printer} · ${j.created} · ${j.sheets_sent ?? 0}/${j.sheets_total ?? '?'} แผ่น`),
        j.error && h('small', { style: 'display:block;color:var(--bad)' }, j.error),
        ACTIVE.has(j.state) && h('div.prog', { style: `--w:${j.sheets_total ? (j.sheets_sent / j.sheets_total) * 100 : 8}%` }, h('i'))),
      h('span.pill', { class: j.state === 'completed' ? 'ok' : j.state === 'failed' ? 'bad' : ACTIVE.has(j.state) ? 'acc' : '' }, STATE_TH[j.state] ?? j.state),
      ACTIVE.has(j.state) && h('button.btn.sm.danger', { type: 'button', 'data-ai': 'job-' + j.job, onclick: async () => { const x = await api('cancel_job', { job: j.job }); toast(x.ok ? 'ยกเลิกแล้ว' : errText(x), x.ok ? 'ok' : 'bad'); load(); } }, 'ยกเลิก')))
      : [h('div.card', {}, h('div.cb', {}, h('div.empty', {}, art(ART_PRINT), h('b', {}, 'ยังไม่มีงานพิมพ์'), 'งานที่สั่งจากหน้านี้จะแสดงที่นี่')))]));
    timer = setTimeout(load, rows.some(j => ACTIVE.has(j.state)) ? 2000 : 8000);
  }
  load();
  return () => { alive = false; clearTimeout(timer); };
}

// ---------- settings view ----------
async function viewSettings(el) {
  await loadPresets();
  const presetCard = h('div.card'); const printerCard = h('div.card');
  const AIM = [['full', 'เต็ม', 'Claude ทำแทนคุณ: เคอร์เซอร์ขยับ เปิดหน้าต่าง และล็อกหน้าจอระหว่างทำ'], ['semi', 'ร่วมทำ', 'Claude ทำเบื้องหลัง คุณใช้งานต่อได้ ไม่เปิดหน้าต่างทับ มีแถบสถานะเล็กๆ'], ['off', 'ปิด', 'ไม่แสดงอะไร ผลลัพธ์ยังลงในหน้ากระดาษเมื่อเสร็จ']];
  const aiCard = (() => { const cur = () => { try { return localStorage.getItem('ps-ai-mode') || 'full'; } catch { return 'full'; } };
    const body = h('div.cb', {}); const draw = () => body.replaceChildren(h('div.seg', { role: 'radiogroup', 'aria-label': 'โหมดการแสดงผลของ Claude' }, AIM.map(([k, t]) => h('button.chip', { type: 'button', role: 'radio', 'aria-checked': String(cur() === k), 'aria-pressed': String(cur() === k), onclick: () => { try { localStorage.setItem('ps-ai-mode', k); } catch { } draw(); } }, t))), h('div.muted', {}, AIM.find(m => m[0] === cur())[2])); draw();
    return h('div.card', {}, h('div.ch', {}, 'ตอน Claude ทำงานในหน้านี้'), body); })();
  const drawPresets = () => presetCard.replaceChildren(h('div.ch', {}, 'พรีเซ็ตการพิมพ์'), h('div.cb', {},
    h('div.joblist', {}, Object.entries(G.presets.builtin).map(([n, o]) => h('div.job', {}, h('div.n', {}, h('b', {}, PRESET_TH[n] ?? n), h('small', {}, describeOptions(o))), h('span.pill', {}, 'ในตัว'))),
      Object.entries(G.presets.yours).map(([n, o]) => h('div.job', {}, h('div.n', {}, h('b', {}, n), h('small', {}, describeOptions(o))),
        h('button.btn.sm.danger', { type: 'button', 'aria-label': 'ลบ ' + n, onclick: async () => { await api('manage_presets', { action: 'delete', name: n }); await loadPresets(); drawPresets(); } }, icon('trash'))))),
    h('div.note.info', {}, icon('alert'), 'บันทึกการตั้งค่าที่ใช้อยู่ในหน้า “พิมพ์” เป็นพรีเซ็ตใหม่ได้ด้านล่าง'),
    (() => { const i = h('input.input', { placeholder: 'ชื่อพรีเซ็ต เช่น ใบเสร็จ' }); return h('div.row', {}, h('div', { style: 'flex:1;min-width:160px' }, i), h('button.btn.primary', { type: 'button', onclick: async () => {
      const o = clean({ ...P, copies: undefined }); if (!i.value.trim() || !Object.keys(o).length) return toast('ตั้งชื่อ และปรับค่าในหน้าพิมพ์อย่างน้อย 1 อย่างก่อน', 'bad');
      const r = await api('manage_presets', { action: 'save', name: i.value.trim(), options: o }); toast(r.ok ? 'บันทึกแล้ว' : errText(r), r.ok ? 'ok' : 'bad'); await loadPresets(); drawPresets(); } }, 'บันทึกจากหน้าพิมพ์')); })()));
  const drawPrinters = () => printerCard.replaceChildren(h('div.ch', {}, 'เครื่องพิมพ์'), h('div.cb', {}, h('div.joblist', {}, G.printers.map(p => h('div.job', {}, h('span.dot', { class: p.online ? 'on' : 'off' }), h('div.n', {}, h('b', {}, p.name), h('small', {}, p.connection)),
    p.default ? h('span.pill.acc', {}, 'ค่าเริ่มต้น') : h('button.btn.sm', { type: 'button', onclick: async () => { await api('configure_printer', { printer: p.id, set_default: true }); await loadPrinters(); drawPrinters(); toast('ตั้งเป็นค่าเริ่มต้นแล้ว', 'ok'); } }, 'ตั้งเป็นค่าเริ่มต้น'),
    h('button.btn.sm', { type: 'button', onclick: async () => { const a = await askText('ตั้งชื่อย่อ', 'เช่น office'); if (a) { const r = await api('configure_printer', { printer: p.id, alias: a }); toast(r.ok ? 'บันทึกชื่อย่อแล้ว' : errText(r), r.ok ? 'ok' : 'bad'); } } }, 'ชื่อย่อ')))),
    (() => { const i = h('input.input', { placeholder: 'เพิ่มด้วย IP เช่น 192.168.1.50' }); return h('div.row', {}, h('div', { style: 'flex:1;min-width:160px' }, i), h('button.btn', { type: 'button', onclick: async () => { if (!i.value.trim()) return; const r = await api('configure_printer', { add_host: i.value.trim() }); toast(r.ok ? 'เพิ่มแล้ว' : errText(r), r.ok ? 'ok' : 'bad'); await loadPrinters(true); drawPrinters(); } }, icon('refresh'), 'เพิ่มและค้นหา')); })()));
  drawPresets(); drawPrinters();
  const th = h('div.seg', {}, THEMES.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(getTheme() === v), onclick: e => { applyTheme(v); e.target.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.target))); } }, t)));
  el.append(h('div.col', { style: 'max-width:760px' }, aiCard, presetCard, printerCard, h('div.card', {}, h('div.ch', {}, icon('sun'), 'หน้าตา'), h('div.cb', {}, th))));
}


// ---------- printers, presets, theme ----------
const THEMES = [['auto', 'ตามระบบ'], ['light', 'สว่าง'], ['dark', 'มืด']];
function applyTheme(t) { try { t === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t); } catch { } if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; }
const getTheme = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
async function loadPrinters(refresh) {
  const r = await api('list_printers', { refresh: !!refresh });
  G.printers = r.data?.printers ?? [];
  if (!G.printers.some(p => p.id === G.printer)) G.printer = (G.printers.find(p => p.default && p.online) ?? G.printers.find(p => p.online) ?? G.printers[0])?.id;
  dispatchEvent(new Event('printers'));
}
async function loadPresets() { const r = await api('manage_presets', { action: 'list' }); if (r.data) G.presets = r.data; }

// ---------- popups for printer, jobs and settings ----------
async function popPrinter(a) { const box = h('div'); let cl; pop(a, 'เครื่องพิมพ์', box, { wide: 640, onClose: () => cl?.() }); cl = await viewPrinter(box); }
async function popJobs(a) { const box = h('div'); let cl; pop(a, 'งานพิมพ์', box, { wide: 520, onClose: () => cl?.() }); cl = await viewJobs(box); }
async function popSettings() { const box = h('div'); sheet('ตั้งค่า', box, { wide: 760 }); await viewSettings(box); }

addEventListener('DOMContentLoaded', () => { });
export { h, icon, ICON, api, toast, modal, confirmBox, askText, sendPrint, trackJob, G, clean, curPrinter, panel, pop, sheet, closePops, colorPop,
  popPrinter, popJobs, popSettings, loadPrinters, loadPresets, applyTheme, getTheme, THEMES, STATE_TH, ACTIVE, art, ART_PRINT, ART_SCAN, debounce };

// ---------- boot ----------
applyTheme(getTheme());
(async () => {
  const design = import('./design.js');
  loadPrinters(); loadPresets();
  await (await design).viewDesign($('#main'));
  import('./aihands.js').then(m => m.startAiHands());
})();
