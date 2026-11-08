// Templates the person owns: saved from the page, renamed, replaced, duplicated and deleted. They live in the MCP server
// (manage_templates), so the AI sees the same list. Built-in starters are copied into "mine" before they can be edited.
export function installTemplates(S) {
  const { h, icon, pop, closePops, toast, api, confirmBox, askText, D, cv, PX } = S;
  let cache = null;
  const rows = r => { const d = r.data; return Array.isArray(d) ? d : d?.templates ?? d?.items ?? []; };
  const load = async () => { const r = await api('manage_templates', { action: 'list' }); if (!r.ok) throw new Error(String(r.text).slice(0, 200)); return cache = rows(r); };

  /** What a template stores: every page as canvas JSON, plus the size. */
  const snapshot = (all, name) => {
    S.commit(true); const pages = all ? D.pages.map((p, i) => i === D.cur ? JSON.stringify(cv.toObject(S.KEEP)) : p ?? '{}') : [JSON.stringify(cv.toObject(S.KEEP))];
    cv.discardActiveObject();
    const thumb = cv.toDataURL({ format: 'jpeg', quality: .6, multiplier: 180 / (S.pw() * S.zoom()), enableRetinaScaling: false });
    return { name, data: JSON.stringify({ w: D.w, h: D.h, pages }), width_mm: Math.round(D.w * 10) / 10, height_mm: Math.round(D.h * 10) / 10, pages: pages.length, thumbnail: thumb };
  };
  async function saveNew(all) {
    const name = await askText(all ? 'บันทึกทั้งงานเป็นเทมเพลต' : 'บันทึกหน้านี้เป็นเทมเพลต', 'ตั้งชื่อ เช่น ใบเสนอราคา'); if (!name) return;
    const r = await api('manage_templates', { action: 'save', ...snapshot(all, name) });
    if (!r.ok) return toast(String(r.text).slice(0, 200), 'bad'); toast('บันทึกเทมเพลตแล้ว', 'ok'); return true;
  }
  async function use(t) {
    const r = await api('manage_templates', { action: 'get', id: t.id }); if (!r.ok) return toast(String(r.text).slice(0, 200), 'bad');
    const full = r.data?.template ?? r.data; let body; try { body = JSON.parse(full.data); } catch { return toast('เทมเพลตนี้อ่านไม่ได้', 'bad'); }
    closePops(); await S.applyTemplate(body, t.name);
  }

  async function templatesPop(a) {
    const mine = h('div.tplgrid'), builtin = h('div.tplgrid');
    const drawBuiltin = () => builtin.replaceChildren(...S.BUILTIN.map(([n, w, hh, bg, mk, cols]) => h('div.tpl.tplcard', {},
      h('button.tpbtn', { type: 'button', title: 'ใช้แม่แบบนี้', onclick: async () => { if (!S.pageEmpty() && !(await confirmBox('ใช้แม่แบบนี้?', 'งานในหน้านี้จะถูกแทนที่ (กดย้อนกลับได้)', 'ใช้แม่แบบ'))) return; S.applyBuiltin(n, w, hh, bg, mk); closePops(); } },
        h('span.tp', { style: `--r:${(w / hh).toFixed(3)};background:linear-gradient(135deg,${cols[0]},${cols[1]})` }), h('b', {}, n), h('small', {}, `${+(w / 10).toFixed(1)}×${+(hh / 10).toFixed(1)} ซม.`)),
      h('button.btn.sm.ghost', { type: 'button', onclick: async () => { const r = await api('manage_templates', { action: 'save', ...(() => { const prev = S.snapshotBuiltin(n, w, hh, bg, mk); return prev; })() }); toast(r.ok ? 'คัดลอกไปไว้ที่ “ของฉัน” แล้ว' : String(r.text).slice(0, 160), r.ok ? 'ok' : 'bad'); refresh(); } }, 'คัดลอกเป็นของฉัน'))));
    const card = t => h('div.tpl.tplcard', {},
      h('button.tpbtn', { type: 'button', title: 'ใช้เทมเพลตนี้', onclick: () => use(t) }, t.thumbnail ? h('img.tp', { src: t.thumbnail, alt: '', style: 'object-fit:contain' }) : h('span.tp', { style: `--r:${((t.width_mm ?? 210) / (t.height_mm ?? 297)).toFixed(3)}` }), h('b', {}, t.name), h('small', {}, `${+((t.width_mm ?? 0) / 10).toFixed(1)}×${+((t.height_mm ?? 0) / 10).toFixed(1)} ซม.${t.pages > 1 ? ' · ' + t.pages + ' หน้า' : ''}`)),
      h('div.row', { style: 'gap:2px;justify-content:center' },
        h('button.ib.sm', { type: 'button', title: 'เปลี่ยนชื่อ', 'aria-label': 'เปลี่ยนชื่อ', onclick: async () => { const n = await askText('เปลี่ยนชื่อ', t.name); if (n) { await api('manage_templates', { action: 'rename', id: t.id, name: n }); refresh(); } } }, icon('type')),
        h('button.ib.sm', { type: 'button', title: 'อัปเดตด้วยหน้าปัจจุบัน', 'aria-label': 'อัปเดตด้วยหน้าปัจจุบัน', onclick: async () => { if (await confirmBox('อัปเดตเทมเพลต?', `แทนที่ “${t.name}” ด้วยหน้าที่เปิดอยู่`, 'อัปเดต')) { const r = await api('manage_templates', { action: 'save', id: t.id, ...snapshot(false, t.name) }); toast(r.ok ? 'อัปเดตแล้ว' : String(r.text).slice(0, 160), r.ok ? 'ok' : 'bad'); refresh(); } } }, icon('refresh')),
        h('button.ib.sm', { type: 'button', title: 'ทำซ้ำ', 'aria-label': 'ทำซ้ำ', onclick: async () => { await api('manage_templates', { action: 'duplicate', id: t.id }); refresh(); } }, icon('copy')),
        h('button.ib.sm', { type: 'button', title: 'ลบ', 'aria-label': 'ลบ', onclick: async () => { if (await confirmBox('ลบเทมเพลต?', `“${t.name}” จะหายถาวร`, 'ลบ')) { await api('manage_templates', { action: 'delete', id: t.id }); refresh(); } } }, icon('trash'))));
    const refresh = async () => {
      try { const list = await load(); mine.replaceChildren(...(list.length ? list.map(card) : [h('p.muted', { style: 'grid-column:1/-1;margin:6px 2px;font-size:13px' }, 'ยังไม่มีเทมเพลตของคุณ กด “บันทึกหน้านี้” เพื่อเก็บงานที่ออกแบบไว้ใช้ซ้ำ')])); }
      catch (e) { mine.replaceChildren(h('p.muted', { style: 'grid-column:1/-1' }, 'โหลดเทมเพลตไม่ได้: ' + e.message)); }
    };
    drawBuiltin(); refresh();
    pop(a, 'เทมเพลต', h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      h('div', {}, h('div.lbl', {}, 'ของฉัน'), mine, h('div.row', { style: 'margin-top:10px' }, h('button.btn.sm.primary', { type: 'button', onclick: async () => { if (await saveNew(false)) refresh(); } }, icon('plus'), 'บันทึกหน้านี้'),
        S.D.pages.length > 1 && h('button.btn.sm', { type: 'button', onclick: async () => { if (await saveNew(true)) refresh(); } }, `บันทึกทั้งงาน (${S.D.pages.length} หน้า)`))),
      h('div', {}, h('div.lbl', {}, 'แม่แบบเริ่มต้น'), builtin)), { side: 'right', wide: 420 });
  }
  return { templatesPop };
}
