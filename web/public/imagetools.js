// Image tools. Colour looks run in the browser (instant, undoable); heavy clean-up runs in the MCP server's image_edit tool,
// the same tool an AI calls, so a person and an AI get identical results.
export function installImageTools(S) {
  const { fabric, cv, h, icon, toast, pop, closePops, slider, active } = S;
  const F = fabric.filters;
  const isImg = o => o instanceof fabric.FabricImage;
  const find = (img, C) => img.filters.find(f => f instanceof C);
  const refilter = (img, fn) => { img.filters = img.filters.filter(Boolean); fn(img.filters); img.applyFilters(); cv.requestRenderAll(); S.commit(); };
  const setF = (img, C, key, v, neutral = 0) => refilter(img, list => { const i = list.findIndex(f => f instanceof C); if (i >= 0) list.splice(i, 1); if (Math.abs(v - neutral) > 1e-6) list.push(new C({ [key]: v })); });
  const PRESETS = [
    ['ต้นฉบับ', () => []], ['ขาวดำ', () => [new F.Grayscale()]], ['ซีเปีย', () => [new F.Sepia()]], ['สดใส', () => [new F.Saturation({ saturation: .45 }), new F.Contrast({ contrast: .12 })]],
    ['ซีดจาง', () => [new F.Saturation({ saturation: -.35 }), new F.Brightness({ brightness: .1 })]], ['วินเทจ', () => [new F.Vintage()]], ['เอกสารคม', () => [new F.Grayscale(), new F.Contrast({ contrast: .4 }), new F.Brightness({ brightness: .12 })]],
    ['คมชัด', () => [new F.Convolute({ matrix: [0, -1, 0, -1, 5, -1, 0, -1, 0] })]], ['กลับสี', () => [new F.Invert()]],
  ];

  function adjustPop(a) {
    const img = active(); if (!isImg(img)) return;
    const g = (C, k) => find(img, C)?.[k] ?? 0;
    pop(a, 'ปรับภาพ', h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      h('div.chips', {}, PRESETS.map(([t, mk]) => h('button.chip', { type: 'button', onclick: () => { img.filters = mk(); img.applyFilters(); cv.requestRenderAll(); S.commit(true); closePops(); } }, t))),
      slider('ความสว่าง', g(F.Brightness, 'brightness'), -.6, .6, .02, v => setF(img, F.Brightness, 'brightness', v)),
      slider('คอนทราสต์', g(F.Contrast, 'contrast'), -.6, .9, .02, v => setF(img, F.Contrast, 'contrast', v)),
      slider('ความสด', g(F.Saturation, 'saturation'), -1, 1, .02, v => setF(img, F.Saturation, 'saturation', v)),
      slider('สีสันเด่น', g(F.Vibrance, 'vibrance'), -1, 1, .02, v => setF(img, F.Vibrance, 'vibrance', v)),
      slider('โทนสี', g(F.HueRotation, 'rotation'), -1, 1, .02, v => setF(img, F.HueRotation, 'rotation', v)),
      slider('เบลอ', g(F.Blur, 'blur'), 0, 1, .02, v => setF(img, F.Blur, 'blur', v)),
      slider('เกรน', g(F.Noise, 'noise'), 0, 300, 5, v => setF(img, F.Noise, 'noise', v)),
      h('button.btn.sm', { type: 'button', onclick: () => { img.filters = []; img.applyFilters(); cv.requestRenderAll(); S.commit(true); closePops(); } }, 'ล้างการปรับแต่ง')), { wide: 330 });
  }

  // ---- server tools: image_edit ----
  async function serverEdit(ops, label, o = {}) {
    const img = active(); if (!isImg(img)) return toast('เลือกรูปก่อน', 'bad');
    S.setBusy(label + '…');
    try {
      const mult = Math.min(1 / Math.max(.01, img.scaleX || 1), 6000 / Math.max(1, img.getScaledWidth(), img.getScaledHeight()));
      const dataUrl = img.toDataURL({ format: 'png', multiplier: mult, enableRetinaScaling: false });
      const up = await fetch('/api/upload?name=edit.png', { method: 'POST', body: await (await fetch(dataUrl)).blob() }).then(r => r.json());
      const r = await S.api('image_edit', { source: up.path, ops, output_dir: up.dir, format: 'png' });
      if (!r.ok) throw new Error(String(r.text).replace(/^Error:\s*/, '').slice(0, 300));
      const files = r.data?.files ?? []; if (!files.length) throw new Error('ไม่ได้ไฟล์ผลลัพธ์');
      const cx = img.left + img.getScaledWidth() / 2, cy = img.top + img.getScaledHeight() / 2;
      let x = img.left; const made = [];
      for (const f of files) {
        const blob = await (await fetch('/api/file?path=' + encodeURIComponent(f.path))).blob();
        const url = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        const n = await fabric.FabricImage.fromURL(url); n.set({ name: img.name || 'รูป', opacity: img.opacity });
        n.scale((1 / mult) * (o.shrink ?? 1)); n.set(files.length === 1 ? { left: cx - n.getScaledWidth() / 2, top: cy - n.getScaledHeight() / 2 } : { left: x, top: img.top });
        x += n.getScaledWidth() + 16; made.push(n);
      }
      cv.discardActiveObject(); cv.remove(img); made.forEach(n => { n.setCoords(); cv.add(n); }); cv.setActiveObject(made[0]); cv.requestRenderAll(); S.commit(true);
      toast(files.length > 1 ? `แยกได้ ${files.length} ภาพ` : label + ' เสร็จแล้ว', 'ok');
      (r.data?.notes ?? []).slice(0, 2).forEach(n => toast(n));
    } catch (e) { toast(label + ' ไม่สำเร็จ: ' + String(e.message ?? e).slice(0, 220), 'bad'); } finally { S.setBusy(null); }
  }

  const TOOLS = [
    ['ตัดและจัดให้ตรง', [
      ['ตัดขอบขาวอัตโนมัติ', 'เหลือเฉพาะบัตรหรือเอกสารที่สแกน', [{ op: 'trim' }]],
      ['แยกภาพที่สแกนรวมกัน', 'บัตร 2 ใบหรือรูปหลายใบ แยกเป็นภาพละใบ', [{ op: 'split' }]],
      ['ปรับภาพเอียงให้ตรง', 'แก้กระดาษที่วางเอียง', [{ op: 'deskew' }]],
      ['หมุน 90°', '', [{ op: 'rotate', degrees: 90 }]], ['พลิกซ้าย-ขวา', '', [{ op: 'flip', horizontal: true }]]]],
    ['พื้นหลัง', [
      ['ลบพื้นหลัง', 'ทำให้พื้นหลังโปร่งใส', [{ op: 'remove_background', method: 'auto' }]],
      ['ลบพื้นหลังสีเรียบ', 'เหมาะกับพื้นขาวหรือพื้นสีเดียว', [{ op: 'remove_background', method: 'color' }]]]],
    ['ความคมชัด', [
      ['ลบจุดรบกวน (noise)', 'ลดเม็ดและเศษฝุ่นในภาพ', [{ op: 'denoise', strength: 2 }]],
      ['เพิ่มความคมชัด', '', [{ op: 'sharpen', amount: 1.2 }]],
      ['ขยายภาพ 2 เท่า', 'เพิ่มจำนวนพิกเซล ให้พิมพ์ชัดขึ้น', [{ op: 'upscale', scale: 2 }], { shrink: 1 / 2 }],
      ['ขยายภาพ 4 เท่า', '', [{ op: 'upscale', scale: 4 }], { shrink: 1 / 4 }],
      ['เอกสารสีคมชัด', 'เก็บสี ทำให้ตัวหนังสือคม', [{ op: 'enhance_document', mode: 'color' }]],
      ['เอกสารขาวดำ', 'พื้นขาวสะอาด ตัวหนังสือดำ', [{ op: 'enhance_document', mode: 'bw' }]]]],
    ['รูปทรง', [
      ['ตัดเป็นวงกลม', '', [{ op: 'round', circle: true }]], ['มุมมน', '', [{ op: 'round', radius_px: 60 }]]]],
  ];
  function toolsPop(a) {
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, TOOLS.map(([g, rows]) => h('div', {}, h('div.lbl', {}, g), h('div.toollist', {}, rows.map(([t, sub, ops, o]) => h('button.toolrow', { type: 'button', 'data-ai': 'imgtool-' + ops[0].op, onclick: () => { closePops(); serverEdit(ops, t, o); } }, h('b', {}, t), sub && h('small', {}, sub)))))));
    pop(a, 'เครื่องมือรูป', list, { wide: 340 });
  }

  // ---- crop to a shape ----
  function maskPop(a) {
    const img = active(); if (!isImg(img)) return;
    const pick = ['วงกลม', 'สี่เหลี่ยมมุมมน', 'หัวใจ', 'ดาว 5 แฉก', 'หกเหลี่ยม', 'สี่เหลี่ยมขนมเปียกปูน', 'ดาวระเบิด', 'หยดน้ำ', 'เมฆ', 'บอลลูนข้อความ', 'ตราประทับ', 'ห้าเหลี่ยม'];
    const shapes = S.SHAPES.filter(s => pick.includes(s[0]));
    pop(a, 'ตัดรูปเป็นรูปทรง', h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, h('div.shapegrid', {}, shapes.map(s => h('button.shp', { type: 'button', title: s[0], onclick: () => { const size = Math.min(img.width, img.height); img.clipPath = new fabric.Path(s[2], { originX: 'center', originY: 'center', left: 0, top: 0, scaleX: size / 100, scaleY: size / 100, fillRule: s[3] ?? 'nonzero' }); img.dirty = true; cv.requestRenderAll(); S.commit(true); closePops(); }, innerHTML: `<svg viewBox="0 0 100 100" fill="currentColor"><path d="${s[2]}" fill-rule="${s[3] ?? 'nonzero'}"/></svg><span>${s[0]}</span>` }))),
      h('button.btn.sm', { type: 'button', onclick: () => { img.clipPath = undefined; img.dirty = true; cv.requestRenderAll(); S.commit(true); closePops(); } }, 'เอารูปทรงออก')), { side: undefined, wide: 340 });
  }
  return { adjustPop, toolsPop, maskPop, serverEdit, isImg };
}
