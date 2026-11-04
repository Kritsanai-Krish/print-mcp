// Turns document pages into printable sheets. Working on our own pixels is what makes
// frame thickness, ink density and tone work identically on every printer; IPP has no
// attribute for any of them.
import type { Document as MuDocument, Page as MuPage } from 'mupdf';
import type { JobPlan, Margins, PrintOptions } from './options.js';
import type { Sheet } from './raster.js';

type Mu = typeof import('mupdf');
let muPromise: Promise<Mu> | null = null;
export function loadMupdf(): Promise<Mu> { return (muPromise ??= import('mupdf')); }

type Sharp = typeof import('sharp').default;
let sharpPromise: Promise<Sharp> | null = null;
export function loadSharp(): Promise<Sharp> {
  return (sharpPromise ??= import('sharp').then(m => m.default));
}

export interface RenderInput {
  doc: MuDocument;
  name: string;
  /** Selected zero-based page indexes in print order. */
  pages: number[];
  /** Pages already carry their margins (browser or Office output), so draw them full-sheet. */
  generated: boolean;
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128], red: [220, 0, 0], green: [0, 150, 0],
  blue: [0, 60, 220], yellow: [240, 210, 0], orange: [240, 130, 0], purple: [130, 40, 180], pink: [240, 100, 170], cyan: [0, 170, 220], magenta: [210, 0, 130], navy: [0, 30, 110],
};

export function parseColor(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  const named = NAMED_COLORS[v];
  if (named) return named;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!m) throw new Error(`Unknown color "${value}". Use #rrggbb or a name like red, blue, gray.`);
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (c: [number, number, number]) => `#${c.map(n => n.toString(16).padStart(2, '0')).join('')}`;

// ---------- geometry ----------

const GRID: Record<number, [number, number]> = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3], 16: [4, 4] };

export interface Layout {
  landscape: boolean;
  canvasW: number;
  canvasH: number;
  cols: number;
  rows: number;
  /** Content box inside the canvas, px. */
  box: { x: number; y: number; w: number; h: number };
  frame: { thickness: number; x: number; y: number; w: number; h: number } | null;
  headerBand: number;
  footerBand: number;
  /** Margins of the content box in reading orientation, mm (what the browser renderer needs). */
  insetMm: Margins;
}

export function computeLayout(plan: JobPlan, o: PrintOptions, firstPageLandscape: boolean): Layout {
  const nUp = o.n_up ?? 1;
  const dpi = plan.dpi;
  const px = (mm: number) => Math.round(mm * dpi / 25.4);
  const flipsGrid = nUp === 2 || nUp === 6 || nUp === 8;
  const landscape = o.orientation === 'landscape' ? true : o.orientation === 'portrait' ? false : (flipsGrid ? !firstPageLandscape : firstPageLandscape);

  const sheetW = px(plan.media.widthMm), sheetH = px(plan.media.heightMm);
  const canvasW = landscape ? sheetH : sheetW, canvasH = landscape ? sheetW : sheetH;
  const [longCount, shortCount] = GRID[nUp] ?? [1, 1];
  const cols = canvasW >= canvasH ? longCount : shortCount, rows = canvasW >= canvasH ? shortCount : longCount;

  // Canvas rotates 90 degrees counter-clockwise onto the sheet, so its top sits on the sheet's left.
  const h = plan.hardware;
  const hw: Margins = landscape ? { top: h.left, right: h.top, bottom: h.right, left: h.bottom } : h;
  const req = plan.requestedMargins;
  const side = (k: keyof Margins) => {
    const asked = req[k];
    if (asked !== undefined && asked < hw[k] && !plan.warnings.some(w => w.includes('hardware margin'))) {
      plan.warnings.push(`Margin ${asked} mm is inside the printer's ${hw[k]} mm hardware margin; using ${hw[k]} mm. borderless=true removes it where supported.`);
    }
    return Math.max(asked ?? 0, hw[k]);
  };
  const margins: Margins = { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };

  const overlayPt = o.overlay_size_pt ?? 9;
  const bandMm = overlayPt * 0.3528 * 2.6;
  const headerMm = o.header ? bandMm : 0, footerMm = o.footer ? bandMm : 0;
  const thicknessMm = o.border_mm ?? 0;
  const gapMm = thicknessMm > 0 ? (o.border_gap_mm ?? 2) : 0;

  const frame = thicknessMm > 0 ? {
    thickness: Math.max(1, px(thicknessMm)),
    x: px(margins.left), y: px(margins.top),
    w: canvasW - px(margins.left) - px(margins.right), h: canvasH - px(margins.top) - px(margins.bottom),
  } : null;
  const inset = thicknessMm + gapMm;
  const insetMm: Margins = {
    top: margins.top + inset + headerMm, right: margins.right + inset,
    bottom: margins.bottom + inset + footerMm, left: margins.left + inset,
  };
  const box = {
    x: px(insetMm.left), y: px(insetMm.top),
    w: canvasW - px(insetMm.left) - px(insetMm.right), h: canvasH - px(insetMm.top) - px(insetMm.bottom),
  };
  if (box.w < 16 || box.h < 16) throw new Error('Margins and frame leave no room on the page. Make them smaller.');
  return { landscape, canvasW, canvasH, cols, rows, box, frame, headerBand: px(headerMm), footerBand: px(footerMm), insetMm };
}

type Matrix6 = [number, number, number, number, number, number];
const mul = (a: Matrix6, b: Matrix6): Matrix6 => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

const ROTATIONS: Record<number, Matrix6> = { 0: [1, 0, 0, 1, 0, 0], 90: [0, 1, -1, 0, 0, 0], 180: [-1, 0, 0, -1, 0, 0], 270: [0, -1, 1, 0, 0, 0] };

/** Places a page inside a cell; every scale mode and alignment reduces to this one matrix. */
export function placePage(bounds: number[], cell: { x: number; y: number; w: number; h: number }, o: PrintOptions, dpi: number, rotation: number, forcedScale?: 'fit'): { matrix: Matrix6; clip: { x: number; y: number; w: number; h: number } } {
  const [x0, y0, x1, y1] = bounds;
  const pw = x1 - x0, ph = y1 - y0;
  const quarter = rotation === 90 || rotation === 270;
  const rw = quarter ? ph : pw, rh = quarter ? pw : ph;
  const base = dpi / 72;
  const fit = Math.min(cell.w / rw, cell.h / rh);
  let sx: number, sy: number;
  if (o.scale_percent && !forcedScale) sx = sy = base * o.scale_percent / 100;
  else {
    switch (forcedScale ?? o.scale ?? 'fit') {
      case 'shrink': sx = sy = Math.min(fit, base); break;
      case 'actual': sx = sy = base; break;
      case 'fill': sx = sy = Math.max(cell.w / rw, cell.h / rh); break;
      case 'stretch': sx = cell.w / (quarter ? ph : pw); sy = cell.h / (quarter ? pw : ph); if (quarter) [sx, sy] = [sy, sx]; break;
      default: sx = sy = fit;
    }
  }
  let m: Matrix6 = mul([1, 0, 0, 1, -x0, -y0], [sx, 0, 0, sy, 0, 0]);
  m = mul(m, ROTATIONS[rotation] ?? ROTATIONS[0]);
  const xs = [0, pw].flatMap(x => [0, ph].map(y => x * m[0] + y * m[2] + m[4]));
  const ys = [0, pw].flatMap(x => [0, ph].map(y => x * m[1] + y * m[3] + m[5]));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const align = o.align ?? 'center';
  const dx = align.includes('left') ? 0 : align.includes('right') ? cell.w - w : (cell.w - w) / 2;
  const dy = align.includes('top') ? 0 : align.includes('bottom') ? cell.h - h : (cell.h - h) / 2;
  m = mul(m, [1, 0, 0, 1, cell.x + dx - minX, cell.y + dy - minY]);
  const left = Math.max(cell.x, Math.floor(cell.x + dx)), top = Math.max(cell.y, Math.floor(cell.y + dy));
  const right = Math.min(cell.x + cell.w, Math.ceil(cell.x + dx + w)), bottom = Math.min(cell.y + cell.h, Math.ceil(cell.y + dy + h));
  return { matrix: m, clip: { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) } };
}

// ---------- tone ----------

export function buildToneLut(o: PrintOptions): Uint8Array | null {
  const active = o.darkness || o.brightness || o.contrast || (o.gamma && o.gamma !== 1) || o.ink_saver || o.invert;
  if (!active) return null;
  const lut = new Uint8Array(256);
  const contrast = (o.contrast ?? 0) / 100;
  const cFactor = contrast >= 0 ? 1 + contrast * 2 : 1 + contrast;
  const bright = (o.brightness ?? 0) * 1.275;
  const darknessGamma = Math.pow(2, (o.darkness ?? 0) / 50);
  const gamma = 1 / (o.gamma ?? 1);
  const saver = (o.ink_saver ?? 0) / 100;
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v = Math.pow(v, darknessGamma);
    v = Math.pow(v, gamma);
    v = (v - 0.5) * cFactor + 0.5 + bright / 255;
    v = Math.min(1, Math.max(0, v));
    if (saver) v = 1 - (1 - v) * (1 - saver);
    if (o.invert) v = 1 - v;
    lut[i] = Math.round(v * 255);
  }
  return lut;
}

function applyLut(data: Buffer, lut: Uint8Array): void {
  for (let i = 0; i < data.length; i++) data[i] = lut[data[i]];
}

function applySaturation(data: Buffer, amount: number): void {
  const k = 1 + amount / 100 * (amount > 0 ? 1.5 : 1);
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = (r * 77 + g * 150 + b * 29) >> 8;
    const nr = l + (r - l) * k, ng = l + (g - l) * k, nb = l + (b - l) * k;
    data[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
    data[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
    data[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
  }
}

/** Tolerates JPEG chroma noise so a scanned black and white page still counts as gray. */
export function isGrayscale(data: Buffer, tolerance = 4): boolean {
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r - g > tolerance || g - r > tolerance || g - b > tolerance || b - g > tolerance) return false;
  }
  return true;
}

function toGray(rgb: Buffer, gray: Buffer): void {
  for (let i = 0, j = 0; j < gray.length; i += 3, j++) gray[j] = (rgb[i] * 77 + rgb[i + 1] * 150 + rgb[i + 2] * 29) >> 8;
}

// ---------- drawing on a raw canvas ----------

function fillRect(s: Sheet, x: number, y: number, w: number, h: number, color: [number, number, number]): void {
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(s.width, x + w), y1 = Math.min(s.height, y + h);
  if (x1 <= x0 || y1 <= y0) return;
  if (s.comp === 1) {
    const g = (color[0] * 77 + color[1] * 150 + color[2] * 29) >> 8;
    for (let row = y0; row < y1; row++) s.data.fill(g, row * s.width + x0, row * s.width + x1);
    return;
  }
  const line = Buffer.allocUnsafe((x1 - x0) * 3);
  for (let i = 0; i < line.length; i += 3) { line[i] = color[0]; line[i + 1] = color[1]; line[i + 2] = color[2]; }
  for (let row = y0; row < y1; row++) line.copy(s.data, (row * s.width + x0) * 3);
}

function drawLineSegments(s: Sheet, x: number, y: number, len: number, t: number, horizontal: boolean, color: [number, number, number], style: string): void {
  const dash = style === 'dashed' ? t * 4 : style === 'dotted' ? t : 0;
  const gap = style === 'dashed' ? t * 3 : style === 'dotted' ? t * 2 : 0;
  if (!dash) { if (horizontal) fillRect(s, x, y, len, t, color); else fillRect(s, x, y, t, len, color); return; }
  for (let p = 0; p < len; p += dash + gap) {
    const seg = Math.min(dash, len - p);
    if (horizontal) fillRect(s, x + p, y, seg, t, color); else fillRect(s, x, y + p, t, seg, color);
  }
}

export function drawFrame(s: Sheet, f: { x: number; y: number; w: number; h: number }, t: number, color: [number, number, number], style: string): void {
  const rect = (x: number, y: number, w: number, h: number, thick: number) => {
    drawLineSegments(s, x, y, w, thick, true, color, style);
    drawLineSegments(s, x, y + h - thick, w, thick, true, color, style);
    drawLineSegments(s, x, y, h, thick, false, color, style);
    drawLineSegments(s, x + w - thick, y, h, thick, false, color, style);
  };
  if (style === 'double' && t >= 3) {
    const thin = Math.max(1, Math.round(t / 3));
    rect(f.x, f.y, f.w, f.h, thin);
    rect(f.x + t - thin, f.y + t - thin, f.w - 2 * (t - thin), f.h - 2 * (t - thin), thin);
  } else rect(f.x, f.y, f.w, f.h, t);
}

interface Rgba { width: number; height: number; data: Buffer }

function blend(s: Sheet, img: Rgba, x: number, y: number, opacity = 1): void {
  for (let row = 0; row < img.height; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= s.height) continue;
    for (let col = 0; col < img.width; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= s.width) continue;
      const p = (row * img.width + col) * 4;
      const a = img.data[p + 3] * opacity / 255;
      if (a === 0) continue;
      if (s.comp === 3) {
        const q = (dy * s.width + dx) * 3;
        s.data[q] = s.data[q] * (1 - a) + img.data[p] * a;
        s.data[q + 1] = s.data[q + 1] * (1 - a) + img.data[p + 1] * a;
        s.data[q + 2] = s.data[q + 2] * (1 - a) + img.data[p + 2] * a;
      } else {
        const q = dy * s.width + dx;
        const g = (img.data[p] * 77 + img.data[p + 1] * 150 + img.data[p + 2] * 29) >> 8;
        s.data[q] = s.data[q] * (1 - a) + g * a;
      }
    }
  }
}

const escapeMarkup = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Pango shapes Thai correctly (vowels and tone marks stack), which a hand drawn glyph path cannot. */
async function renderText(text: string, font: string, sizePt: number, dpi: number, color: [number, number, number]): Promise<Rgba | null> {
  if (!text.trim()) return null;
  const sharp = await loadSharp();
  const markup = `<span foreground="${toHex(color)}">${escapeMarkup(text)}</span>`;
  const { data, info } = await sharp({ text: { text: markup, font: `${font} ${sizePt}`, dpi, rgba: true } })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

function fillTokens(template: string, sheetNo: number, total: number, name: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return template
    .replace(/\{page\}/g, String(sheetNo)).replace(/\{pages\}/g, String(total)).replace(/\{name\}/g, name)
    .replace(/\{date\}/g, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    .replace(/\{time\}/g, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

// ---------- the render loop ----------

/** Sheets needed for a selection; the job engine needs this before rendering anything. */
export function sheetCount(pageCount: number, o: PrintOptions): number {
  return Math.ceil(pageCount / (o.n_up ?? 1));
}

export function firstPageIsLandscape(page: MuPage, rotate: number): boolean {
  const [x0, y0, x1, y1] = page.getBounds();
  const w = x1 - x0, h = y1 - y0;
  return rotate === 90 || rotate === 270 ? h > w : w > h;
}

/**
 * Yields one sheet at a time and reuses its buffers, so the consumer must encode each sheet
 * before asking for the next. That keeps a 600 dpi colour job near one page of memory.
 */
export async function* renderSheets(input: RenderInput, plan: JobPlan, o: PrintOptions): AsyncGenerator<Sheet> {
  const mupdf = await loadMupdf();
  const { doc, pages } = input;
  const rotation = o.rotate ?? 0;
  const nUp = o.n_up ?? 1;
  const totalSheets = sheetCount(pages.length, o);

  const first = doc.loadPage(pages[0]);
  const layout = computeLayout(plan, o, firstPageIsLandscape(first, rotation));
  first.destroy();
  const { canvasW, canvasH, cols, rows, box, landscape } = layout;

  const mono = plan.colorMode === 'monochrome' || plan.colorMode === 'black_white';
  const comp: 1 | 3 = mono ? 1 : 3;
  const colorspace = mono ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
  const canvas: Sheet = { width: canvasW, height: canvasH, comp, data: Buffer.allocUnsafe(canvasW * canvasH * comp) };
  const rotated: Sheet | null = landscape ? { width: canvasH, height: canvasW, comp, data: Buffer.allocUnsafe(canvasW * canvasH * comp) } : null;
  let grayBuffer: Buffer | null = null;

  const gapPx = Math.round((o.n_up_gap_mm ?? (nUp > 1 ? 3 : 0)) * plan.dpi / 25.4);
  const cellW = Math.floor((box.w - gapPx * (cols - 1)) / cols), cellH = Math.floor((box.h - gapPx * (rows - 1)) / rows);
  if (cellW < 8 || cellH < 8) throw new Error('n_up gap leaves no room for pages. Make it smaller.');

  const lut = buildToneLut(o);
  const frameColor = parseColor(o.border_color, [0, 0, 0]);
  const overlayColor = parseColor(o.overlay_color, [80, 80, 80]);
  const overlayFont = o.overlay_font ?? 'Tahoma';
  const overlayPt = o.overlay_size_pt ?? 9;
  const sharp = o.sharpen || o.watermark ? await loadSharp() : null;

  let watermark: Rgba | null = null;
  if (o.watermark) {
    const size = o.watermark_size_pt ?? Math.max(24, Math.min(96, Math.round(Math.min(canvasW, canvasH) / plan.dpi * 72 * 1.1 / Math.max(4, [...o.watermark].length * 0.62))));
    const text = await renderText(o.watermark, overlayFont, size, plan.dpi, parseColor(o.watermark_color, [120, 120, 120]));
    if (text) {
      const turned = await sharp!(text.data, { raw: { width: text.width, height: text.height, channels: 4 } })
        .rotate(o.watermark_angle ?? -45, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .raw().toBuffer({ resolveWithObject: true });
      watermark = { width: turned.info.width, height: turned.info.height, data: turned.data };
    }
  }

  const drawBand = async (template: string, sheetNo: number, atTop: boolean) => {
    const [left = '', center = '', right = ''] = template.includes('|') ? template.split('|') : ['', template, ''];
    const band = atTop ? layout.headerBand : layout.footerBand;
    const y = atTop ? box.y - band : box.y + box.h;
    const items: [string, 'l' | 'c' | 'r'][] = [[left, 'l'], [center, 'c'], [right, 'r']];
    for (const [t, where] of items) {
      const img = await renderText(fillTokens(t, sheetNo, totalSheets, input.name), overlayFont, overlayPt, plan.dpi, overlayColor);
      if (!img) continue;
      const x = where === 'l' ? box.x : where === 'r' ? box.x + box.w - img.width : box.x + Math.floor((box.w - img.width) / 2);
      blend(canvas, img, x, y + Math.max(0, Math.floor((band - img.height) / 2)));
    }
  };

  for (let sheetIndex = 0; sheetIndex < totalSheets; sheetIndex++) {
    canvas.data.fill(255);
    for (let slot = 0; slot < nUp; slot++) {
      const pageIndex = pages[sheetIndex * nUp + slot];
      if (pageIndex === undefined) break;
      const col = slot % cols, row = Math.floor(slot / cols);
      // Generated pages already contain their margins, so they map onto the whole sheet.
      // Fitting them into the content box would apply every margin twice.
      const fullSheet = input.generated && nUp === 1;
      const cell = fullSheet ? { x: 0, y: 0, w: canvasW, h: canvasH }
        : { x: box.x + col * (cellW + gapPx), y: box.y + row * (cellH + gapPx), w: cellW, h: cellH };
      const page = doc.loadPage(pageIndex);
      try {
        const { matrix, clip } = placePage(page.getBounds(), cell, o, plan.dpi, rotation, fullSheet && !o.scale_percent ? 'fit' : undefined);
        if (clip.w > 0 && clip.h > 0) {
          const pix = new mupdf.Pixmap(colorspace, [clip.x, clip.y, clip.x + clip.w, clip.y + clip.h], false);
          try {
            pix.clear(255);
            const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
            try {
              page.run(device, matrix);
              device.close();
            } finally {
              device.destroy();
            }
            const src = Buffer.from(pix.getPixels().buffer, pix.getPixels().byteOffset, pix.getPixels().byteLength);
            const stride = pix.getStride(), lineBytes = clip.w * comp;
            for (let y = 0; y < clip.h; y++) {
              src.copy(canvas.data, (((clip.y + y) * canvasW) + clip.x) * comp, y * stride, y * stride + lineBytes);
            }
          } finally {
            pix.destroy();
          }
        }
        if (o.cell_border_mm && nUp > 1) {
          drawFrame(canvas, cell, Math.max(1, Math.round(o.cell_border_mm * plan.dpi / 25.4)), frameColor, 'solid');
        }
      } finally {
        page.destroy();
      }
      // Rendering is synchronous WASM; yield so status and cancel calls stay responsive.
      await new Promise(setImmediate);
    }

    // Tone adjusts the document only, so headers and frames keep their exact requested color.
    if (o.saturation && comp === 3) applySaturation(canvas.data, o.saturation);
    if (lut) applyLut(canvas.data, lut);
    if (o.sharpen && sharp) {
      const amount = 0.5 + o.sharpen / 100 * 2.5;
      const out = await sharp(canvas.data, { raw: { width: canvasW, height: canvasH, channels: comp } }).sharpen({ sigma: amount }).raw().toBuffer();
      out.copy(canvas.data);
    }
    if (plan.colorMode === 'black_white') {
      const cut = o.threshold ?? 128;
      for (let i = 0; i < canvas.data.length; i++) canvas.data[i] = canvas.data[i] < cut ? 0 : 255;
    }
    if (watermark) {
      blend(canvas, watermark, Math.floor((canvasW - watermark.width) / 2), Math.floor((canvasH - watermark.height) / 2), (o.watermark_opacity ?? 15) / 100);
    }
    if (o.header) await drawBand(o.header, sheetIndex + 1, true);
    if (o.footer) await drawBand(o.footer, sheetIndex + 1, false);
    if (layout.frame) drawFrame(canvas, layout.frame, layout.frame.thickness, frameColor, o.border_style ?? 'solid');
    if (o.mirror) mirrorRows(canvas);

    let out: Sheet = canvas;
    if (rotated) {
      rotateCcw(canvas, rotated);
      out = rotated;
    }
    if (plan.colorMode === 'auto' && comp === 3 && isGrayscale(out.data)) {
      grayBuffer ??= Buffer.allocUnsafe(out.width * out.height);
      toGray(out.data, grayBuffer);
      yield { width: out.width, height: out.height, comp: 1, data: grayBuffer };
    } else {
      yield out;
    }
    await new Promise(setImmediate);
  }
}

function mirrorRows(s: Sheet): void {
  const { width, height, comp, data } = s;
  for (let y = 0; y < height; y++) {
    const row = y * width * comp;
    for (let l = 0, r = width - 1; l < r; l++, r--) {
      const a = row + l * comp, b = row + r * comp;
      for (let c = 0; c < comp; c++) { const t = data[a + c]; data[a + c] = data[b + c]; data[b + c] = t; }
    }
  }
}

/** Canvas left edge lands on the sheet's bottom: IPP's "landscape" orientation. */
function rotateCcw(src: Sheet, dst: Sheet): void {
  const { width, height, comp } = src;
  const s = src.data, d = dst.data;
  const dstW = dst.width;
  if (comp === 3) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = (y * width + x) * 3;
        const to = ((width - 1 - x) * dstW + y) * 3;
        d[to] = s[from]; d[to + 1] = s[from + 1]; d[to + 2] = s[from + 2];
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) d[(width - 1 - x) * dstW + y] = s[y * width + x];
    }
  }
}

/** PNG pages for preview and the Windows spooler path. */
export async function sheetToPng(s: Sheet, compressionLevel = 1): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(s.data, { raw: { width: s.width, height: s.height, channels: s.comp } }).png({ compressionLevel }).toBuffer();
}

export async function sheetToJpeg(s: Sheet, quality = 92): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(s.data, { raw: { width: s.width, height: s.height, channels: s.comp } }).jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer();
}
