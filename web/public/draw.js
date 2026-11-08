// Free drawing: pen, marker, highlighter, dashed pen and a stroke eraser. Strokes are ordinary objects, so they move, resize and print like everything else.
export function installDraw(S) {
  const { fabric, cv, h, icon, toast, colorPop, slider } = S;
  const st = { on: false, kind: 'pen', color: '#111827', width: 6 };
  const KINDS = [['pen', 'ปากกา'], ['marker', 'มาร์กเกอร์'], ['highlight', 'ไฮไลต์'], ['dash', 'เส้นประ'], ['eraser', 'ยางลบ']];
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  let erasing = false;

  function brush() {
    const b = new fabric.PencilBrush(cv); b.strokeLineCap = 'round'; b.strokeLineJoin = 'round'; b.decimate = 2;
    if (st.kind === 'highlight') { b.color = hexA(st.color, .38); b.width = Math.max(st.width * 3, 18); }
    else if (st.kind === 'marker') { b.color = hexA(st.color, .88); b.width = st.width * 2; }
    else { b.color = st.color; b.width = st.width; if (st.kind === 'dash') b.strokeDashArray = [st.width * 2, st.width * 2]; }
    return b;
  }
  function apply() {
    cv.isDrawingMode = st.on && st.kind !== 'eraser';
    cv.selection = !st.on; cv.defaultCursor = st.on ? 'crosshair' : 'default';
    cv.forEachObject(o => { o.selectable = !st.on && !o.locked; o.evented = st.on ? st.kind === 'eraser' && o.name === 'วาด' : !o.locked || true; });
    if (cv.isDrawingMode) cv.freeDrawingBrush = brush();
    cv.discardActiveObject(); cv.requestRenderAll(); S.ctx(); S.dockState?.(st.on);
  }
  function start(kind) { if (kind) st.kind = kind; st.on = true; apply(); }
  function stop() { if (!st.on) return; st.on = false; apply(); S.commit(true); }

  cv.on('path:created', e => { e.path.set({ name: 'วาด' }); if (st.kind === 'highlight') e.path.set({ globalCompositeOperation: 'multiply' }); S.commit(true); });
  const wipe = ev => {
    if (!st.on || st.kind !== 'eraser' || !erasing) return;
    const f = cv.findTarget(ev.e); const t = f?.target ?? (f instanceof fabric.FabricObject ? f : null);
    if (t && t.name === 'วาด') { cv.remove(t); cv.requestRenderAll(); }
  };
  cv.on('mouse:down', () => { if (st.on && st.kind === 'eraser') erasing = true; }); cv.on('mouse:move', wipe);
  cv.on('mouse:up', () => { if (erasing) { erasing = false; S.commit(true); } });

  /** The toolbar shown while drawing (replaces the selection toolbar). */
  function bar() {
    const b = S.ctxBar; b.hidden = false; b.replaceChildren(...[
      h('div.seg', { style: 'min-width:390px' }, KINDS.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(st.kind === k), onclick: () => { st.kind = k; apply(); } }, t))),
      st.kind !== 'eraser' && S.swatch('สี', st.color, c => { st.color = c || '#111827'; apply(); }),
      st.kind !== 'eraser' && h('div', { style: 'width:150px' }, slider('ขนาด', st.width, 1, 40, 1, v => { st.width = v; if (cv.isDrawingMode) cv.freeDrawingBrush = brush(); })),
      h('button.btn.sm.primary', { type: 'button', onclick: stop }, icon('check'), 'เสร็จ')].filter(Boolean));
  }
  return { start, stop, isOn: () => st.on, bar, toggle: () => st.on ? stop() : start() };
}
