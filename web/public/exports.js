// Save the design as a file: PNG, JPG, multi-page PDF (true page size) or editable SVG, at the resolution the person picks.
let lib;
const loadPdfLib = () => lib ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/pdf-lib.min.js'; s.onload = () => res(window.PDFLib); s.onerror = () => rej(new Error('โหลด pdf-lib ไม่ได้')); document.head.append(s); });
const save = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; document.body.append(a); a.click(); a.remove(); };

export function installExports(S) {
  const { h, icon, pop, closePops, toast, D, cv } = S;
  const E = { dpi: 300 };
  const safe = () => (D.name || 'งาน').replace(/[\\/:*?"<>|]+/g, '_');

  async function run(kind, all) {
    S.setBusy('กำลังสร้างไฟล์…');
    try {
      const mult = E.dpi / 96;
      if (kind === 'svg') { S.commit(true); cv.discardActiveObject(); const svg = cv.toSVG({ width: S.pw() + 'px', height: S.ph() + 'px', viewBox: { x: 0, y: 0, width: S.pw(), height: S.ph() } }); save(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), `${safe()}-${D.cur + 1}.svg`); return; }
      if (kind === 'pdf') {
        const { PDFDocument } = await loadPdfLib(); const doc = await PDFDocument.create(), wpt = D.w / 25.4 * 72, hpt = D.h / 25.4 * 72;
        const urls = await S.renderPages(mult);
        for (const u of urls) { const img = await doc.embedPng(await (await fetch(u)).arrayBuffer()); const p = doc.addPage([wpt, hpt]); p.drawImage(img, { x: 0, y: 0, width: wpt, height: hpt }); }
        doc.setTitle(D.name); save(URL.createObjectURL(new Blob([await doc.save()], { type: 'application/pdf' })), safe() + '.pdf'); return;
      }
      const urls = await S.renderPages(mult, kind === 'jpg' ? 'jpeg' : 'png');
      (all ? urls : [urls[D.cur]]).forEach((u, i) => save(u, `${safe()}-${all ? i + 1 : D.cur + 1}.${kind}`));
    } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'bad'); } finally { S.setBusy(null); }
  }
  async function copyImage() {
    try { const u = (await S.renderPages(2))[D.cur]; await navigator.clipboard.write([new ClipboardItem({ 'image/png': await (await fetch(u)).blob() })]); toast('คัดลอกภาพแล้ว วางในโปรแกรมอื่นได้เลย', 'ok'); } catch { toast('คัดลอกภาพไม่ได้ในเบราว์เซอร์นี้', 'bad'); }
  }
  function exportPop(a) {
    const row = (t, sub, fn) => h('button.toolrow', { type: 'button', onclick: () => { closePops(); fn(); } }, h('b', {}, t), sub && h('small', {}, sub));
    const multi = D.pages.length > 1;
    pop(a, 'บันทึกเป็นไฟล์', h('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      h('div', {}, h('div.lbl', {}, 'ความละเอียด'), h('div.seg', {}, [[150, '150 dpi'], [300, '300 dpi'], [600, '600 dpi']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(E.dpi === v), onclick: e => { E.dpi = v; e.target.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.target))); } }, t)))),
      h('div.toollist', {}, row('PDF' + (multi ? ` (${D.pages.length} หน้า)` : ''), 'ขนาดหน้าตรงตามที่ตั้ง เหมาะส่งต่อหรือพิมพ์', () => run('pdf')),
        row('ภาพ PNG', multi ? 'หน้าที่เปิดอยู่' : 'พื้นหลังตามที่ตั้ง คมชัด', () => run('png')), multi && row('ภาพ PNG ทุกหน้า', '', () => run('png', true)),
        row('ภาพ JPG', 'ไฟล์เล็ก', () => run('jpg')), row('SVG', 'เส้นและรูปร่างยังแก้ไขต่อได้ในโปรแกรมเวกเตอร์', () => run('svg')), row('คัดลอกเป็นภาพ', 'วางลง Word, LINE ฯลฯ', copyImage))), { side: 'below-end', wide: 340 });
  }
  return { exportPop, run };
}
