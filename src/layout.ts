// layout_page: the AI describes a page (images, text, shapes, repeats) in millimetres; this file turns it
// into one self-contained HTML document that the normal print/preview pipeline renders.
import fs from 'node:fs';
import { z } from 'zod';
import { parsePaper } from './options.js';
import { BODY_FONT, assertLocalPathAllowed, escapeHtml, resolveLocalPath } from './sources.js';

const ALIGN = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const mm = z.number().min(-5000).max(5000);
const pos = {
  x_mm: mm.optional().describe('Left edge in mm from the page (or margin) corner'),
  y_mm: mm.optional().describe('Top edge in mm'),
  center_x: z.boolean().optional().describe('Centre horizontally on the page, ignoring x_mm'),
  center_y: z.boolean().optional().describe('Centre vertically on the page, ignoring y_mm'),
  rotate_deg: z.number().min(-360).max(360).optional().describe('Rotate around the centre of the item'),
  opacity: z.number().min(0).max(1).optional(),
};

export const imageItem = z.strictObject({
  type: z.literal('image'),
  source: z.string().describe('Local image path or data: URI (run image_edit first to clean it)'),
  width_mm: z.number().min(0.1).max(5000).optional().describe('One of width/height keeps the aspect. None: natural size at the image DPI (96 if unknown)'),
  height_mm: z.number().min(0.1).max(5000).optional(),
  fit: z.enum(['contain', 'cover', 'fill']).optional().describe('When both width and height are given. Default contain'),
  align: z.enum(ALIGN).optional().describe('Place relative to the page when x_mm/y_mm are not given. Default center'),
  border_mm: z.number().min(0).max(50).optional(),
  border_color: z.string().optional().describe('Default black'),
  radius_mm: z.number().min(0).max(2000).optional(),
  ...pos,
});
export const textItem = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(20000),
  width_mm: z.number().min(0.1).max(5000).optional().describe('Wrap width. Omit for a single block as wide as the text'),
  height_mm: z.number().min(0.1).max(5000).optional().describe('Only used to centre vertically or to repeat with copies'),
  font_size_pt: z.number().min(1).max(500).optional().describe('Default 14'),
  font: z.string().max(80).optional().describe('Font family; Thai-safe fonts are the fallback'),
  color: z.string().optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional().describe('Text alignment inside the block. Default left'),
  line_height: z.number().min(0.5).max(5).optional().describe('Default 1.3'),
  ...pos,
});
export const shapeItem = z.strictObject({
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'line']).describe('line runs from the top-left to the bottom-right of the box (use height 0 for a horizontal line)'),
  x_mm: mm, y_mm: mm, width_mm: z.number().min(0).max(5000), height_mm: z.number().min(0).max(5000),
  fill: z.string().optional(), stroke: z.string().optional(), stroke_mm: z.number().min(0).max(100).optional(),
  radius_mm: z.number().min(0).max(2000).optional(),
  rotate_deg: pos.rotate_deg, opacity: pos.opacity,
});
export const copiesItem = z.strictObject({
  type: z.literal('copies'),
  of: z.number().int().min(0).describe('Index (from 0) of an earlier image, text or shape item. That item is drawn only through its copies'),
  rows: z.number().int().min(1).max(50), cols: z.number().int().min(1).max(50),
  gap_mm: z.number().min(0).max(500).optional().describe('Default 0'),
});
export const layoutItem = z.discriminatedUnion('type', [imageItem, textItem, shapeItem, copiesItem]);
export type LayoutItem = z.infer<typeof layoutItem>;

export interface ImageInfo { uri: string; wpx: number; hpx: number; dpi: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface Page { widthMm: number; heightMm: number; background?: string; marginMm?: number }

const n3 = (v: number) => `${+v.toFixed(3)}mm`;
const cssColor = (c: string | undefined, fallback: string): string => {
  if (c === undefined) return fallback;
  if (!/^[#a-zA-Z0-9(),.%\s-]{1,50}$/.test(c)) throw new Error(`"${c}" is not a CSS colour. Use a name (red), #rrggbb or rgb(...).`);
  return c;
};
const cssFont = (f: string) => f.replace(/["'\\<>;{}()]/g, '');

function place(align: string | undefined, W: number, H: number, w: number, h: number): { x: number; y: number } {
  const a = align ?? 'center';
  const x = /left/.test(a) ? 0 : /right/.test(a) ? W - w : (W - w) / 2;
  const y = /top/.test(a) ? 0 : /bottom/.test(a) ? H - h : (H - h) / 2;
  return { x, y };
}

/** Resolved millimetre box of an item; h is undefined for text without a height. */
export function itemBox(it: LayoutItem, page: { w: number; h: number }, img?: ImageInfo): { x?: number; y?: number; w?: number; h?: number; cx: boolean; cy: boolean } {
  if (it.type === 'shape') return { x: it.x_mm, y: it.y_mm, w: it.width_mm, h: it.height_mm, cx: false, cy: false };
  if (it.type === 'copies') throw new Error('internal: copies has no box');
  let w = it.width_mm, h = it.height_mm;
  if (it.type === 'image') {
    const ratio = img!.wpx / img!.hpx;
    if (w && !h) h = w / ratio;
    else if (h && !w) w = h * ratio;
    else if (!w && !h) { w = img!.wpx / img!.dpi * 25.4; h = img!.hpx / img!.dpi * 25.4; }
  }
  let x = it.x_mm, y = it.y_mm;
  const align = it.type === 'image' ? it.align : undefined;
  if (it.type === 'image') {
    const p = place(align, page.w, page.h, w!, h!);
    if (it.center_x) x = (page.w - w!) / 2; else if (x === undefined) x = p.x;
    if (it.center_y) y = (page.h - h!) / 2; else if (y === undefined) y = p.y;
    return { x, y, w, h, cx: false, cy: false };
  }
  // text: width/height may be unknown, so centring falls back to a CSS translate
  const cx = !!it.center_x && w === undefined, cy = !!it.center_y && h === undefined;
  if (it.center_x && w !== undefined) x = (page.w - w) / 2; else if (cx) x = page.w / 2; else x ??= 0;
  if (it.center_y && h !== undefined) y = (page.h - h) / 2; else if (cy) y = page.h / 2; else y ??= 0;
  return { x, y, w, h, cx, cy };
}

function style(parts: Record<string, string | undefined>): string {
  return Object.entries(parts).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}:${v}`).join(';');
}

function transform(rot: number | undefined, cx: boolean, cy: boolean): string | undefined {
  const t = [(cx || cy) && `translate(${cx ? '-50%' : '0'},${cy ? '-50%' : '0'})`, rot && `rotate(${rot}deg)`].filter(Boolean).join(' ');
  return t || undefined;
}

function renderOne(it: Exclude<LayoutItem, { type: 'copies' }>, b: { x: number; y: number; w?: number; h?: number; cx: boolean; cy: boolean }, img?: ImageInfo): string {
  const common = { position: 'absolute', left: n3(b.x), top: n3(b.y), width: b.w !== undefined ? n3(b.w) : undefined, height: b.h !== undefined ? n3(b.h) : undefined, transform: transform(it.rotate_deg, b.cx, b.cy), opacity: it.opacity !== undefined ? String(it.opacity) : undefined };
  if (it.type === 'image') {
    const fit = it.fit ?? 'contain';
    const st = style({ ...common, border: it.border_mm ? `${n3(it.border_mm)} solid ${cssColor(it.border_color, '#000')}` : undefined, 'border-radius': it.radius_mm ? n3(it.radius_mm) : undefined, overflow: it.radius_mm ? 'hidden' : undefined });
    return `<div class="i" style="${st}"><img src="${escapeHtml(img!.uri)}" alt="" style="width:100%;height:100%;display:block;object-fit:${fit}"></div>`;
  }
  if (it.type === 'text') {
    const st = style({
      ...common, 'white-space': it.width_mm ? 'pre-wrap' : 'pre', 'overflow-wrap': 'break-word', 'font-size': `${it.font_size_pt ?? 14}pt`, 'line-height': String(it.line_height ?? 1.3),
      'font-family': `${it.font ? `"${cssFont(it.font)}",` : ''}${BODY_FONT}`, color: cssColor(it.color, '#000'), 'font-weight': it.bold ? '700' : undefined, 'font-style': it.italic ? 'italic' : undefined,
      'text-decoration': it.underline ? 'underline' : undefined, 'text-align': it.align ?? 'left',
    });
    return `<div class="t" style="${st}">${escapeHtml(it.text)}</div>`;
  }
  const sw = it.stroke_mm ?? (it.stroke ? 0.3 : 0);
  if (it.shape === 'line') {
    const w = b.w ?? 0, h = b.h ?? 0;
    const st = style({ ...common, width: n3(Math.max(w, 0.001)), height: n3(Math.max(h, 0.001)), overflow: 'visible' });
    return `<svg class="s" style="${st}" viewBox="0 0 ${+w.toFixed(3)} ${+h.toFixed(3)}" preserveAspectRatio="none"><line x1="0" y1="0" x2="${+w.toFixed(3)}" y2="${+h.toFixed(3)}" stroke="${cssColor(it.stroke, '#000')}" stroke-width="${sw || 0.3}"/></svg>`;
  }
  const st = style({ ...common, background: it.fill ? cssColor(it.fill, 'none') : undefined, border: sw ? `${n3(sw)} solid ${cssColor(it.stroke, '#000')}` : undefined, 'border-radius': it.shape === 'ellipse' ? '50%' : it.radius_mm ? n3(it.radius_mm) : undefined });
  return `<div class="s" style="${st}"></div>`;
}

export interface Built { html: string; boxes: (Box | null)[]; warnings: string[]; widthMm: number; heightMm: number }

/** Pure: items + already-loaded images in, one HTML document out. Coordinates are mm from the content-area corner. */
export function buildLayoutHtml(page: Page, items: LayoutItem[], images: Record<number, ImageInfo> = {}): Built {
  const m = page.marginMm ?? 0;
  const cw = page.widthMm - 2 * m, ch = page.heightMm - 2 * m;
  if (cw <= 0 || ch <= 0) throw new Error(`margin_mm ${m} leaves no room on a ${page.widthMm}x${page.heightMm} mm page.`);
  const boxes: (Box | null)[] = [];
  const out: string[] = [];
  const warnings: string[] = [];
  const hidden = new Set(items.flatMap(i => (i.type === 'copies' ? [i.of] : [])));
  items.forEach((it, idx) => {
    if (it.type === 'copies') {
      const src = items[it.of];
      if (!src || it.of >= idx) throw new Error(`items[${idx}] copies: "of" must be the index of an EARLIER item (0..${idx - 1}).`);
      if (src.type === 'copies') throw new Error(`items[${idx}] copies: items[${it.of}] is itself a copies item; repeat the original instead.`);
      const base = itemBox(src, { w: cw, h: ch }, images[it.of]);
      if (base.w === undefined || base.h === undefined) throw new Error(`items[${idx}] copies: items[${it.of}] has no size. Give it width_mm and height_mm.`);
      const gap = it.gap_mm ?? 0;
      const tw = it.cols * base.w + (it.cols - 1) * gap, th = it.rows * base.h + (it.rows - 1) * gap;
      const x0 = (cw - tw) / 2, y0 = (ch - th) / 2;
      if (tw > cw + 0.01 || th > ch + 0.01) warnings.push(`items[${idx}]: the ${it.cols}x${it.rows} grid is ${+tw.toFixed(1)}x${+th.toFixed(1)} mm, larger than the ${+cw.toFixed(1)}x${+ch.toFixed(1)} mm page area; edges are clipped. Use fewer copies, a smaller item or a larger paper.`);
      for (let r = 0; r < it.rows; r++) for (let c = 0; c < it.cols; c++) {
        out.push(renderOne(src, { x: x0 + c * (base.w + gap), y: y0 + r * (base.h + gap), w: base.w, h: base.h, cx: false, cy: false }, images[it.of]));
      }
      boxes.push({ x: x0, y: y0, w: tw, h: th });
      return;
    }
    const b = itemBox(it, { w: cw, h: ch }, images[idx]);
    const box = b.w !== undefined && b.h !== undefined ? { x: b.x!, y: b.y!, w: b.w, h: b.h } : null;
    boxes.push(box);
    if (box && (box.x < -0.01 || box.y < -0.01 || box.x + box.w > cw + 0.01 || box.y + box.h > ch + 0.01)) warnings.push(`items[${idx}] (${it.type}) extends outside the ${+cw.toFixed(1)}x${+ch.toFixed(1)} mm page area and will be clipped.`);
    if (!hidden.has(idx)) out.push(renderOne(it, { x: b.x!, y: b.y!, w: b.w, h: b.h, cx: b.cx, cy: b.cy }, images[idx]));
  });
  const bg = cssColor(page.background, '#fff');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Layout</title><style>`
    + `@page{size:${n3(page.widthMm)} ${n3(page.heightMm)};margin:0}`
    + `*{box-sizing:border-box}html{background:${bg}}html,body{margin:0;padding:0}`
    + `body{position:relative;width:100%;height:100%;overflow:hidden;font-family:${BODY_FONT};-webkit-print-color-adjust:exact;print-color-adjust:exact}`
    + `#page{position:absolute;left:0;top:0;width:${n3(cw)};height:${n3(ch)};overflow:hidden}`
    + `</style></head><body><div id="page">${out.join('')}</div></body></html>`;
  return { html, boxes, warnings, widthMm: page.widthMm, heightMm: page.heightMm };
}

/** Reads every image item; formats a browser cannot show, or rotated by EXIF, are re-encoded. */
export async function loadImages(items: LayoutItem[]): Promise<Record<number, ImageInfo>> {
  const sharp = (await import('sharp')).default;
  const out: Record<number, ImageInfo> = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type !== 'image') continue;
    let bytes: Buffer;
    const src = it.source.trim();
    if (src.startsWith('data:')) {
      const m = /^data:([^;,]*)(;base64)?,/.exec(src.slice(0, 200));
      if (!m) throw new Error(`items[${i}]: malformed data: URI.`);
      const raw = src.slice(src.indexOf(',') + 1);
      bytes = m[2] ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw));
    } else {
      if (/^https?:\/\//i.test(src)) throw new Error(`items[${i}]: download the image to a file first; layout_page reads local files and data: URIs.`);
      const file = resolveLocalPath(src);
      assertLocalPathAllowed(file, {});
      try { bytes = fs.readFileSync(file); } catch { throw new Error(`items[${i}]: image not found: ${file}`); }
    }
    let meta;
    try { meta = await sharp(bytes).metadata(); } catch (e) { throw new Error(`items[${i}]: cannot read the image (${(e as Error).message}).`); }
    let w = meta.width ?? 0, h = meta.height ?? 0;
    if (!w || !h) throw new Error(`items[${i}]: image has no size.`);
    const turned = (meta.orientation ?? 1) > 1;
    if (turned && meta.orientation! >= 5) [w, h] = [h, w];
    const native = ['png', 'jpeg', 'webp', 'gif', 'svg'].includes(meta.format ?? '') && !turned;
    let mime = `image/${meta.format === 'svg' ? 'svg+xml' : meta.format}`;
    if (!native) {
      bytes = meta.hasAlpha ? await sharp(bytes).rotate().png().toBuffer() : await sharp(bytes).rotate().jpeg({ quality: 95 }).toBuffer();
      mime = meta.hasAlpha ? 'image/png' : 'image/jpeg';
    }
    out[i] = { uri: `data:${mime};base64,${bytes.toString('base64')}`, wpx: w, hpx: h, dpi: meta.density && meta.density > 1 ? meta.density : 96 };
  }
  return out;
}

export function paperSize(paper: string | undefined, orientation: string | undefined): { widthMm: number; heightMm: number; paperName: string } {
  const name = paper ?? 'A4';
  const { widthMm, heightMm } = parsePaper(name);
  const landscape = orientation === 'landscape';
  return landscape ? { widthMm: heightMm, heightMm: widthMm, paperName: name } : { widthMm, heightMm, paperName: name };
}
