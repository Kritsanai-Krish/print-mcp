// Scripts: small JavaScript tools the person or the AI writes once and runs again (MCP tools tool_list / tool_use /
// tool_write / tool_edit / tool_remove). They are saved on this computer, so the AI and this page share one list.
export function installScripts(S) {
  const { h, icon, pop, sheet, closePops, toast, api, confirmBox, active, cv, fabric } = S;
  const STARTER = `// อ่านรูปจาก args.source แล้วตัดขอบขาวออก
const input = await readFile(args.source);
const out = await sharp(input).trim().png().toBuffer();
await writeFile('result.png', out);
return { ok: true };`;
  const HELP = 'ในสคริปต์ใช้ได้: args (ค่าที่ส่งเข้ามา) · readFile(path) · writeFile(ชื่อ, ข้อมูล) · sharp(buffer) จัดการรูป · call("ชื่อเครื่องมือ", {…}) · log(…) · return ค่าที่ต้องการส่งกลับ';
  const err = r => String(r.text ?? r.error ?? 'ไม่ทราบสาเหตุ').replace(/^Error:\s*/, '').slice(0, 300);
  const load = async () => { const r = await api('tool_list', {}); if (!r.ok) throw new Error(err(r)); return Array.isArray(r.data) ? r.data : []; };

  const imgOf = o => o instanceof fabric.FabricImage;
  async function uploadSelected() {
    const img = active(); if (!imgOf(img)) return null;
    const mult = Math.min(1 / Math.max(.01, img.scaleX || 1), 6000 / Math.max(1, img.getScaledWidth(), img.getScaledHeight()));
    const dataUrl = img.toDataURL({ format: 'png', multiplier: mult, enableRetinaScaling: false });
    const up = await fetch('/api/upload?name=script-in.png', { method: 'POST', body: await (await fetch(dataUrl)).blob() }).then(r => r.json());
    return up.path;
  }

  async function runSheet(info, refresh) {
    const selected = imgOf(active());
    const args = h('textarea.input.mono', { rows: 4, spellcheck: false, 'aria-label': 'ค่าที่ส่งให้สคริปต์ (JSON)' }, '{}');
    const useSel = h('input', { type: 'checkbox', checked: selected });
    const out = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    const go = h('button.btn.primary', { type: 'button', 'data-ai': 'script-run' }, icon('refresh'), 'เรียกใช้');
    const sh = sheet('เรียกใช้: ' + info.name, h('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      info.description && h('p.muted', { style: 'margin:0' }, info.description),
      info.params && h('p.muted', { style: 'margin:0;font-size:13px' }, 'ต้องการ: ', h('code', {}, info.params)),
      h('label.lbl', {}, 'ค่าที่ส่งให้ (JSON)', args),
      h('label.row', { style: 'gap:8px;align-items:center' }, useSel, h('span', {}, 'ใช้รูปที่เลือกอยู่เป็น ', h('code', {}, 'source'), selected ? '' : ' (ยังไม่ได้เลือกรูป)')),
      h('div.row', {}, go), out), { wide: 560 });
    useSel.disabled = !selected;
    go.onclick = async () => {
      let a; try { a = JSON.parse(args.value || '{}'); } catch { return toast('ค่าที่ส่งให้ต้องเป็น JSON เช่น {"width": 800}', 'bad'); }
      go.disabled = true; out.replaceChildren(h('span.muted', {}, 'กำลังทำงาน…'));
      try {
        if (useSel.checked && selected) a.source = await uploadSelected();
        const r = await api('tool_use', { name: info.name, args: a });
        if (!r.ok) { out.replaceChildren(h('div.note.bad', {}, icon('alert'), err(r))); return; }
        showResult(out, r.data); refresh?.();
      } catch (e) { out.replaceChildren(h('div.note.bad', {}, icon('alert'), String(e.message ?? e))); } finally { go.disabled = false; }
    };
    return sh;
  }

  async function addToPage(url, name) { await window.__studio.addImageUrl(url, name); }
  function showResult(el, d) {
    const shown = d.shown ?? [], imgs = shown.filter(p => /\.(png|jpe?g|webp|gif)$/i.test(p)), val = d.value;
    el.replaceChildren(
      h('div.note.ok', {}, icon('check'), `เสร็จใน ${(d.ms / 1000).toFixed(1)} วินาที`),
      val !== null && val !== undefined && h('pre.codeout', {}, typeof val === 'string' ? val : JSON.stringify(val, null, 2)),
      (d.logs ?? []).length > 0 && h('pre.codeout', {}, d.logs.join('\n')),
      imgs.length > 0 && h('div.tplgrid', {}, imgs.map((p, i) => { const url = '/api/file?path=' + encodeURIComponent(p);
        return h('div.tpl.tplcard', {}, h('img.tp', { src: url, alt: '', style: 'object-fit:contain' }), h('button.btn.sm', { type: 'button', onclick: () => { closePops(); document.querySelector('.backdrop')?.remove(); addToPage(url, 'ผลจากสคริปต์ ' + (i + 1)); } }, 'ใส่ลงหน้า')); })));
  }

  function editSheet(cur, refresh) {
    const isNew = !cur;
    const name = h('input.input', { value: cur?.name ?? '', placeholder: 'เช่น trim_white', disabled: !isNew, 'aria-label': 'ชื่อสคริปต์' });
    const desc = h('input.input', { value: cur?.description ?? '', placeholder: 'บอกสั้นๆ ว่าทำอะไร (คนอ่านได้)', 'aria-label': 'คำอธิบาย' });
    const params = h('input.input', { value: cur?.params ?? '', placeholder: 'ค่าที่ต้องส่ง เช่น {"source": "รูป"}', 'aria-label': 'ค่าที่ต้องส่ง' });
    const code = h('textarea.input.mono', { rows: 14, spellcheck: false, 'aria-label': 'โค้ดสคริปต์', style: 'min-height:240px;tab-size:2' }, cur?.code ?? STARTER);
    code.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart; code.setRangeText('  ', s, code.selectionEnd, 'end'); } });
    const save = h('button.btn.primary', { type: 'button', 'data-ai': 'script-save' }, icon('check'), 'บันทึก');
    const sh = sheet(isNew ? 'สร้างสคริปต์ใหม่' : 'แก้ไข: ' + cur.name, h('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      h('label.lbl', {}, 'ชื่อ (ภาษาอังกฤษ ตัวเลข _ -)', name), h('label.lbl', {}, 'คำอธิบาย', desc), h('label.lbl', {}, 'ค่าที่ต้องส่ง', params),
      h('label.lbl', {}, 'โค้ด', code), h('p.muted', { style: 'margin:0;font-size:12.5px' }, HELP), h('div.row', { style: 'justify-content:flex-end' }, save)), { wide: 640 });
    save.onclick = async () => {
      const r = isNew ? await api('tool_write', { name: name.value.trim(), code: code.value, description: desc.value, params: params.value })
        : await api('tool_edit', { name: cur.name, code: code.value, description: desc.value, params: params.value });
      if (!r.ok) return toast(err(r), 'bad');
      toast('บันทึกสคริปต์แล้ว', 'ok'); sh.close(); refresh?.();
    };
  }

  async function scriptsPop(anchor) {
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:min(88vw,420px)' });
    const draw = async () => {
      let list; try { list = await load(); } catch (e) { return body.replaceChildren(h('p.muted', {}, 'โหลดสคริปต์ไม่ได้: ' + e.message)); }
      body.replaceChildren(
        h('div.row', { style: 'justify-content:space-between;align-items:center' }, h('span.muted', { style: 'font-size:13px' }, 'เครื่องมือที่ AI หรือคุณเขียนไว้ ใช้ซ้ำได้'),
          h('button.btn.sm.primary', { type: 'button', 'data-ai': 'script-new', onclick: () => { closePops(); editSheet(null, () => scriptsPop(anchor)); } }, icon('plus'), 'เขียนใหม่')),
        list.length ? h('div.joblist', {}, list.map(s => h('div.job', {},
          h('div.n', {}, h('b', {}, s.name), h('small', {}, s.description || 'ไม่มีคำอธิบาย')),
          h('div.row', { style: 'gap:2px' },
            h('button.btn.sm.primary', { type: 'button', title: 'เรียกใช้', onclick: () => { closePops(); runSheet(s, null); } }, 'ใช้'),
            h('button.ib.sm', { type: 'button', title: 'แก้ไข', 'aria-label': 'แก้ไข ' + s.name, onclick: async () => { const r = await api('tool_list', { name: s.name }); if (!r.ok) return toast(err(r), 'bad'); closePops(); editSheet(r.data, () => scriptsPop(anchor)); } }, icon('code')),
            h('button.ib.sm', { type: 'button', title: 'ลบ', 'aria-label': 'ลบ ' + s.name, onclick: async () => { if (await confirmBox('ลบสคริปต์?', `“${s.name}” จะหายถาวร ถ้าจะใช้อีกต้องเขียนใหม่`, 'ลบ')) { const r = await api('tool_remove', { name: s.name }); toast(r.ok ? 'ลบแล้ว' : err(r), r.ok ? 'ok' : 'bad'); draw(); } } }, icon('trash'))))))
          : h('p.muted', { style: 'margin:6px 2px' }, 'ยังไม่มีสคริปต์ กด “เขียนใหม่” หรือให้ AI เขียนให้ผ่าน tool_write'));
    };
    pop(anchor, 'สคริปต์', body, { wide: 480 }); await draw();
  }
  return { scriptsPop };
}
