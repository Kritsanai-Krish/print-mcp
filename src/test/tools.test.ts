// image_edit, manage_templates and layout_page, tested without any printer or paper.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'print-mcp-tools-'));
process.env.PRINT_MCP_HOME = home;
const { editImage, estimateSkew, minAreaAngle } = await import('../imagetools.js');

const solid = (w: number, h: number, c: string) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
async function canvas(w: number, h: number, parts: { input: Buffer; left: number; top: number }[], file: string): Promise<string> {
  const f = path.join(home, file);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } }).composite(parts).png().toFile(f);
  return f;
}
const info = async (f: string) => { const m = await sharp(f).metadata(); return { w: m.width!, h: m.height!, alpha: !!m.hasAlpha }; };

after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 }));

test('trim crops the border and ignores a dust speck', async () => {
  const f = await canvas(600, 400, [{ input: await solid(200, 100, '#444444'), left: 150, top: 120 }, { input: await solid(2, 2, '#000000'), left: 8, top: 8 }], 'trim.png');
  const r = await editImage({ source: f, ops: [{ op: 'trim' }] });
  const i = await info(r.files[0].path);
  assert.ok(i.w >= 200 && i.w <= 225 && i.h >= 100 && i.h <= 125, `${i.w}x${i.h}`);
  assert.ok(r.notes.some(n => n.startsWith('trim')));
  assert.match(r.hint, /layout_page/);
});

test('split finds two objects, top-left first, one file each', async () => {
  const f = await canvas(800, 500, [{ input: await solid(200, 150, '#2040c0'), left: 50, top: 50 }, { input: await solid(220, 160, '#c02020'), left: 450, top: 280 }], 'split.png');
  const r = await editImage({ source: f, ops: [{ op: 'split', deskew: false }] });
  assert.equal(r.files.length, 2);
  const a = await info(r.files[0].path), b = await info(r.files[1].path);
  assert.ok(Math.abs(a.w - 220) < 30 && Math.abs(a.h - 170) < 30, `${a.w}x${a.h}`);
  assert.ok(Math.abs(b.w - 240) < 30, `${b.w}x${b.h}`);
  const { data, info: inf } = await sharp(r.files[0].path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mid = ((inf.height >> 1) * inf.width + (inf.width >> 1)) * 3;
  assert.ok(data[mid] < 100 && data[mid + 2] > 150, 'first file is the blue object');
});

test('split straightens a tilted card', async () => {
  const card = await sharp(await solid(300, 180, '#336699')).rotate(12, { background: '#ffffff' }).png().toBuffer();
  const f = await canvas(700, 500, [{ input: card, left: 150, top: 100 }], 'tilt.png');
  const r = await editImage({ source: f, ops: [{ op: 'split' }] });
  const i = await info(r.files[0].path);
  assert.ok(Math.abs(i.w - 300) < 30 && Math.abs(i.h - 180) < 30, `${i.w}x${i.h}`);
});

test('minAreaAngle recovers the tilt of a rectangle', () => {
  const a = 10 * Math.PI / 180, pts: number[][] = [];
  const at = (u: number, v: number) => pts.push([u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)]);
  for (let u = 0; u <= 100; u += 2) { at(u, 0); at(u, 40); }
  for (let v = 0; v <= 40; v += 2) { at(0, v); at(100, v); }
  assert.ok(Math.abs(minAreaAngle(pts) + 10) < 0.6, String(minAreaAngle(pts)));
});

test('deskew straightens ruled lines', async () => {
  const lines: { input: Buffer; left: number; top: number }[] = [];
  for (let y = 40; y < 560; y += 24) lines.push({ input: await solid(560, 5, '#000000'), left: 120, top: y });
  const base = await canvas(800, 600, lines, 'lines.png');
  const tilted = path.join(home, 'lines-tilt.png');
  await sharp(base).rotate(6, { background: '#ffffff' }).toFile(tilted);
  const g = await sharp(tilted).grayscale().raw().toBuffer({ resolveWithObject: true });
  const est = estimateSkew(g.data, g.info.width, g.info.height, 15);
  assert.ok(Math.abs(est.angle + 6) < 1, `estimated ${est.angle}`);
  const r = await editImage({ source: tilted, ops: [{ op: 'deskew' }] });
  assert.ok(r.notes.some(n => /rotated -?\d/.test(n)), r.notes.join('|'));
});

test('remove_background(color) makes a transparent PNG; round makes corners transparent', async () => {
  const f = await canvas(300, 200, [{ input: await solid(100, 80, '#cc2222'), left: 100, top: 60 }], 'bg.png');
  const r = await editImage({ source: f, ops: [{ op: 'remove_background', method: 'color' }] });
  assert.equal(r.files[0].format, 'png');
  assert.ok(r.files[0].has_alpha);
  const { data, info: inf } = await sharp(r.files[0].path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'corner transparent');
  assert.equal(data[((100 * inf.width) + 150) * 4 + 3], 255, 'centre opaque');
  assert.ok(r.notes.some(n => /method=color/.test(n)));
  const rd = await editImage({ source: f, ops: [{ op: 'round', circle: true }] });
  assert.ok(rd.files[0].has_alpha);
});

test('crop, resize, pad, border, rotate, flip, adjust, enhance and friends change what they should', async () => {
  const f = await canvas(400, 300, [{ input: await solid(100, 100, '#808080'), left: 50, top: 50 }], 'misc.png');
  const dims = async (ops: object[]) => { const r = await editImage({ source: f, ops: ops as never }); return { ...(await info(r.files[0].path)), r }; };
  const c = await dims([{ op: 'crop', x: 10, y: 10, width: 100, height: 50 }]); assert.equal(c.w, 100); assert.equal(c.h, 50);
  const rs = await dims([{ op: 'resize', width: 200 }]); assert.equal(rs.w, 200); assert.equal(rs.h, 150);
  const up = await dims([{ op: 'upscale', scale: 2 }]); assert.equal(up.w, 800);
  const pd = await dims([{ op: 'pad', top: 10, left: 20, color: 'white' }]); assert.equal(pd.w, 420); assert.equal(pd.h, 310);
  const bd = await dims([{ op: 'border', width_px: 5 }]); assert.equal(bd.w, 410);
  const ro = await dims([{ op: 'rotate', degrees: 90 }]); assert.equal(ro.w, 300); assert.equal(ro.h, 400);
  const tp = await dims([{ op: 'pad', left: 10 }]); assert.ok(tp.alpha && tp.r.files[0].has_alpha);
  for (const op of [{ op: 'flip', horizontal: true }, { op: 'adjust', brightness: 20, contrast: 10, saturation: 20, hue: 30, gamma: 1.2 }, { op: 'denoise', strength: 3 }, { op: 'sharpen' }, { op: 'grayscale' }, { op: 'invert' }, { op: 'threshold' }, { op: 'enhance_document', mode: 'gray' }, { op: 'enhance_document', mode: 'color' }, { op: 'enhance_document', mode: 'bw' }]) {
    const d = await dims([op]); assert.equal(d.w, 400, op.op); assert.equal(d.h, 300, op.op);
  }
  const bw = await sharp((await editImage({ source: f, ops: [{ op: 'enhance_document', mode: 'bw' }] })).files[0].path).greyscale().raw().toBuffer();
  assert.ok(bw.every(v => v === 0 || v === 255));
});

test('bad input gives fixes, not stack traces', async () => {
  const f = await canvas(50, 50, [], 'tiny.png');
  await assert.rejects(editImage({ source: f, ops: [{ op: 'wobble' }] }), /Valid ops: trim/);
  await assert.rejects(editImage({ source: f, ops: [{ op: 'split' }, { op: 'trim' }] }), /last op/);
  await assert.rejects(editImage({ source: f, ops: [{ op: 'trim', bogus: 1 }] }), /Valid params/);
  await assert.rejects(editImage({ source: path.join(home, 'nope.png'), ops: [{ op: 'trim' }] }), /not found/);
  const big = await canvas(400, 300, [], 'big.png');
  await assert.rejects(editImage({ source: big, ops: [{ op: 'upscale', scale: 4 }, { op: 'upscale', scale: 4 }, { op: 'upscale', scale: 4 }] }), /megapixels/);
  const out = path.join(home, 'keep.png');
  await editImage({ source: f, ops: [{ op: 'trim' }], output_file: out });
  await assert.rejects(editImage({ source: f, ops: [{ op: 'trim' }], output_file: out }), /already exists/);
  await editImage({ source: f, ops: [{ op: 'trim' }], output_file: out, overwrite: true });
  await assert.rejects(editImage({ source: f, ops: [{ op: 'trim' }], output_file: path.join(home, 'x.txt') }), /must end in/);
});

test('manage_templates: save, list, get, rename, duplicate, delete', async () => {
  const { manageTemplates } = await import('../templates.js');
  const a = manageTemplates({ action: 'save', name: '  บัตรประชาชน  ', data: '{"x":1}', width_mm: 210, height_mm: 297, thumbnail: 'data:image/jpeg;base64,AAAA' }) as { template: { id: string; name: string } };
  assert.equal(a.template.name, 'บัตรประชาชน');
  const b = manageTemplates({ action: 'save', name: 'บัตรประชาชน', data: '{}', width_mm: 100, height_mm: 150, pages: 2 }) as { template: { id: string; name: string } };
  assert.equal(b.template.name, 'บัตรประชาชน 2');
  const l = manageTemplates({ action: 'list' }) as { templates: Record<string, unknown>[]; count: number };
  assert.equal(l.count, 2);
  assert.ok(l.templates.every(t => !('data' in t)));
  assert.equal(l.templates[0].id, b.template.id, 'newest first');
  assert.equal((manageTemplates({ action: 'get', id: a.template.id }) as { template: { data: string } }).template.data, '{"x":1}');
  const re = manageTemplates({ action: 'save', id: a.template.id, name: 'บัตรประชาชน', data: '{"x":2}', width_mm: 210, height_mm: 297 }) as { created: boolean; template: { name: string; thumbnail?: string } };
  assert.equal(re.created, false);
  assert.equal(re.template.name, 'บัตรประชาชน', 'own name is not taken');
  assert.ok(re.template.thumbnail, 'thumbnail kept when not sent again');
  assert.equal((manageTemplates({ action: 'rename', id: b.template.id, name: 'Card' }) as { template: { name: string } }).template.name, 'Card');
  const d = manageTemplates({ action: 'duplicate', id: b.template.id }) as { template: { id: string; name: string } };
  assert.equal(d.template.name, 'Card 2');
  assert.equal((manageTemplates({ action: 'delete', id: d.template.id }) as { count: number }).count, 2);
  assert.throws(() => manageTemplates({ action: 'get', id: d.template.id }), /No template/);
  assert.throws(() => manageTemplates({ action: 'rename', id: a.template.id, name: 'x'.repeat(81) }), /80/);
  assert.throws(() => manageTemplates({ action: 'save', name: 'n', data: '{}', width_mm: 0, height_mm: 5 }), /width_mm/);
  assert.ok(fs.existsSync(path.join(home, 'templates.json')));
});

test('layout builder: exact mm geometry, centring, copies grid, escaping, Thai font stack', async () => {
  const { buildLayoutHtml } = await import('../layout.js');
  const img = { uri: 'data:image/png;base64,AAAA', wpx: 400, hpx: 200, dpi: 200 };
  const page = { widthMm: 210, heightMm: 297 };
  // natural size at 200 dpi: 400px = 50.8 mm; default align centre
  let b = buildLayoutHtml(page, [{ type: 'image', source: 's' }], { 0: img });
  assert.deepEqual(b.boxes[0], { x: (210 - 50.8) / 2, y: (297 - 25.4) / 2, w: 50.8, h: 25.4 });
  assert.match(b.html, /@page\{size:210mm 297mm;margin:0\}/);
  assert.match(b.html, /left:79\.6mm;top:135\.8mm;width:50\.8mm;height:25\.4mm/);
  // width only keeps aspect; align bottom-right
  b = buildLayoutHtml(page, [{ type: 'image', source: 's', width_mm: 100, align: 'bottom-right' }], { 0: img });
  assert.deepEqual(b.boxes[0], { x: 110, y: 247, w: 100, h: 50 });
  // explicit x/y, rotation, opacity, radius, cover
  b = buildLayoutHtml(page, [{ type: 'image', source: 's', x_mm: 5, y_mm: 6, width_mm: 40, height_mm: 40, fit: 'cover', rotate_deg: 90, opacity: 0.5, radius_mm: 3 }], { 0: img });
  assert.match(b.html, /left:5mm;top:6mm;width:40mm;height:40mm;transform:rotate\(90deg\);opacity:0\.5/);
  assert.match(b.html, /object-fit:cover/);
  // copies: 2 cols x 4 rows of 85.6 x 54 cards centred; the original is only drawn through the copies
  b = buildLayoutHtml(page, [{ type: 'image', source: 's', width_mm: 85.6, height_mm: 54 }, { type: 'copies', of: 0, rows: 4, cols: 2, gap_mm: 2 }], { 0: img });
  assert.equal((b.html.match(/class="i"/g) ?? []).length, 8);
  assert.deepEqual(b.boxes[1], { x: (210 - 173.2) / 2, y: (297 - 222) / 2, w: 173.2, h: 222 });
  assert.equal(b.warnings.length, 0);
  assert.throws(() => buildLayoutHtml(page, [{ type: 'copies', of: 0, rows: 1, cols: 1 }]), /EARLIER/);
  // text: escaped, Thai-safe stack, centred horizontally with a translate when width is unknown
  b = buildLayoutHtml(page, [{ type: 'text', text: '<script>alert(1)</script> "q" สวัสดี', center_x: true, y_mm: 20, font: 'Evil";}</style>', font_size_pt: 20, bold: true }]);
  assert.ok(!b.html.includes('<script>'));
  assert.match(b.html, /&lt;script&gt;/);
  assert.match(b.html, /Leelawadee UI/);
  assert.match(b.html, /left:105mm;top:20mm/);
  assert.match(b.html, /translate\(-50%,0\)/);
  assert.ok(!b.html.includes('Evil";}'));
  // shapes and warnings
  b = buildLayoutHtml(page, [{ type: 'shape', shape: 'rect', x_mm: 200, y_mm: 0, width_mm: 30, height_mm: 10, fill: '#f00' }]);
  assert.match(b.html, /background:#f00/);
  assert.equal(b.warnings.length, 1);
  assert.throws(() => buildLayoutHtml(page, [{ type: 'text', text: 'x', color: 'red;}</style>' }]), /CSS colour/);
  // margin shrinks the content box
  b = buildLayoutHtml({ ...page, marginMm: 10 }, [{ type: 'shape', shape: 'rect', x_mm: 0, y_mm: 0, width_mm: 190, height_mm: 277 }]);
  assert.match(b.html, /#page\{[^}]*width:190mm;height:277mm/);
});
