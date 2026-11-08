// image_edit: a pipeline of image clean-up steps (trim, split, deskew, remove background, ...) so an AI
// never needs another program. Pixels travel between steps as raw RGBA buffers; analysis (background
// colour, masks, skew) runs on a small downscaled copy, edits run at full resolution.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { STATE_DIR } from './state.js';
import { assertLocalPathAllowed, resolveLocalPath } from './sources.js';

type SharpFn = typeof import('sharp').default;
type SharpInst = ReturnType<SharpFn>;
let sharpP: Promise<SharpFn> | null = null;
const loadSharp = () => (sharpP ??= import('sharp').then(m => m.default));

export const MAX_MEGAPIXELS = 40;
const SWEEP_MS = 7 * 24 * 3600 * 1000;

/** Raw RGBA picture. */
export interface Img { data: Buffer; w: number; h: number }

// ---------- op schemas ----------

const col = z.string().max(40);
const OPS = {
  trim: z.strictObject({ threshold: z.number().min(1).max(120).default(14), padding_px: z.number().min(0).max(1000).default(6), background: z.string().max(20).default('auto') }),
  split: z.strictObject({ min_area_pct: z.number().min(0).max(90).default(2), padding_px: z.number().min(0).max(1000).default(10), threshold: z.number().min(1).max(120).default(14), deskew: z.boolean().default(true) }),
  deskew: z.strictObject({ max_degrees: z.number().min(1).max(45).default(15) }),
  remove_background: z.strictObject({ method: z.enum(['auto', 'color', 'ai']).default('auto'), tolerance: z.number().min(0).max(100).default(24), feather: z.number().min(0).max(20).default(1.5) }),
  crop: z.strictObject({ x: z.number().min(0), y: z.number().min(0), width: z.number().min(1), height: z.number().min(1) }),
  rotate: z.strictObject({ degrees: z.number().min(-360).max(360), fill: col.default('transparent') }),
  flip: z.strictObject({ horizontal: z.boolean().default(false), vertical: z.boolean().default(false) }),
  resize: z.strictObject({ width: z.number().int().min(1).max(20000).optional(), height: z.number().int().min(1).max(20000).optional(), scale: z.number().min(0.01).max(20).optional(), fit: z.enum(['inside', 'contain', 'cover', 'fill']).default('inside'), kernel: z.enum(['nearest', 'cubic', 'mitchell', 'lanczos2', 'lanczos3']).default('lanczos3') }),
  denoise: z.strictObject({ strength: z.number().int().min(1).max(5).default(2) }),
  sharpen: z.strictObject({ amount: z.number().min(0).max(3).default(1) }),
  upscale: z.strictObject({ scale: z.number().min(2).max(4).default(2) }),
  enhance_document: z.strictObject({ mode: z.enum(['color', 'gray', 'bw']).default('color'), strength: z.number().min(0.2).max(3).default(1) }),
  adjust: z.strictObject({ brightness: z.number().min(-100).max(100).optional(), contrast: z.number().min(-100).max(100).optional(), saturation: z.number().min(-100).max(100).optional(), hue: z.number().min(-360).max(360).optional(), gamma: z.number().min(0.1).max(5).optional() }),
  grayscale: z.strictObject({}),
  invert: z.strictObject({}),
  threshold: z.strictObject({ value: z.number().int().min(1).max(254).default(160) }),
  round: z.strictObject({ radius_px: z.number().min(0).optional(), circle: z.boolean().optional() }),
  border: z.strictObject({ width_px: z.number().int().min(1).max(2000), color: col.default('black') }),
  pad: z.strictObject({ top: z.number().int().min(0).max(5000).default(0), right: z.number().int().min(0).max(5000).default(0), bottom: z.number().int().min(0).max(5000).default(0), left: z.number().int().min(0).max(5000).default(0), color: col.default('transparent') }),
} as const;
export type OpName = keyof typeof OPS;
export const OP_NAMES = Object.keys(OPS) as OpName[];

/** One line per op for the tool description. */
export const OP_HELP = `Ops (each item is {op, ...params}; defaults in brackets): `
  + [
    'trim {threshold=14, padding_px=6, background="auto"|"white"|"#rrggbb"} crop the uniform border (scanner glass), ignores dust',
    'split {min_area_pct=2, padding_px=10, threshold=14, deskew=true} one file per object on a plain background; must be last',
    'deskew {max_degrees=15} straighten a tilted page',
    'remove_background {method="auto"|"color"|"ai", tolerance=24, feather=1.5} transparent PNG',
    'crop {x,y,width,height}', 'rotate {degrees, fill="transparent"|"auto"|css colour}', 'flip {horizontal,vertical}',
    'resize {width,height,scale,fit="inside"|"contain"|"cover"|"fill",kernel="lanczos3"}',
    'denoise {strength=2 (1-5)}', 'sharpen {amount=1 (0-3)}', 'upscale {scale=2 (2-4)} (smooth enlarge, not AI)',
    'enhance_document {mode="color"|"gray"|"bw", strength=1}', 'adjust {brightness,contrast,saturation (-100..100), hue (deg), gamma (0.1-5)}',
    'grayscale {}', 'invert {}', 'threshold {value=160}', 'round {radius_px | circle:true}', 'border {width_px, color="black"}', 'pad {top,right,bottom,left,color="transparent"}',
  ].join('; ');

export interface OpItem { op: string; [k: string]: unknown }
interface ParsedOp { op: OpName; p: Record<string, any> }

function parseOps(ops: OpItem[]): ParsedOp[] {
  const out = ops.map((item, i) => {
    const { op, ...rest } = item;
    const schema = (OPS as Record<string, z.ZodType>)[op];
    if (!schema) throw new Error(`ops[${i}]: unknown op "${op}". Valid ops: ${OP_NAMES.join(', ')}.`);
    const r = schema.safeParse(rest);
    if (!r.success) {
      const keys = Object.keys((schema as z.ZodObject).shape);
      throw new Error(`ops[${i}] "${op}": ${r.error.issues.map(x => `${x.path.join('.') || 'params'}: ${x.message}`).join('; ')}. Valid params: ${keys.length ? keys.join(', ') : 'none'}.`);
    }
    return { op: op as OpName, p: r.data as Record<string, any> };
  });
  const s = out.findIndex(o => o.op === 'split');
  if (s >= 0 && s !== out.length - 1) throw new Error(`ops[${s}] "split" produces several files, so it must be the last op. Move the ops that follow it into a second image_edit call per file.`);
  return out;
}

// ---------- raw pixel helpers ----------

function checkSize(w: number, h: number, what = 'The image'): void {
  if (w * h > MAX_MEGAPIXELS * 1e6) throw new Error(`${what} would be ${(w * h / 1e6).toFixed(1)} megapixels (${w}x${h}); the limit is ${MAX_MEGAPIXELS}. Use a lower scan resolution (300 dpi is enough for print) or add a resize op with a smaller size first.`);
}

/** sharp may hand back 1 (gray), 2 (gray+alpha), 3 or 4 channels after some filters. */
function toRgba(d: Buffer, ch: number): Buffer {
  if (ch === 4) return d;
  const n = d.length / ch, out = Buffer.alloc(n * 4, 255);
  for (let i = 0; i < n; i++) {
    const g = ch <= 2;
    out[i * 4] = d[i * ch]; out[i * 4 + 1] = d[i * ch + (g ? 0 : 1)]; out[i * 4 + 2] = d[i * ch + (g ? 0 : 2)];
    if (ch === 2) out[i * 4 + 3] = d[i * 2 + 1];
  }
  return out;
}

async function viaSharp(img: Img, f: (s: SharpInst) => SharpInst): Promise<Img> {
  const sharp = await loadSharp();
  const { data, info } = await f(sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  checkSize(info.width, info.height, 'The result');
  return { data: toRgba(data, info.channels), w: info.width, h: info.height };
}

function cropImg(img: Img, x: number, y: number, w: number, h: number): Img {
  x = Math.max(0, Math.min(img.w - 1, Math.floor(x))); y = Math.max(0, Math.min(img.h - 1, Math.floor(y)));
  w = Math.max(1, Math.min(img.w - x, Math.round(w))); h = Math.max(1, Math.min(img.h - y, Math.round(h)));
  const out = Buffer.allocUnsafe(w * h * 4);
  for (let r = 0; r < h; r++) img.data.copy(out, r * w * 4, ((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4);
  return { data: out, w, h };
}

const hex = (c: number[]) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function parseHex(s: string): number[] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null;
}

const median = (a: number[]) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 255; };

/** Background colour = per-channel median of the outer ring of pixels (robust to one lit edge or a shadow corner). */
export function estimateBackground(img: Img): number[] {
  const t = Math.max(1, Math.round(Math.min(img.w, img.h) * 0.01));
  const R: number[] = [], G: number[] = [], B: number[] = [];
  const step = Math.max(1, Math.floor((img.w + img.h) / 4000));
  const take = (x: number, y: number) => { const i = (y * img.w + x) * 4; if (img.data[i + 3] > 128) { R.push(img.data[i]); G.push(img.data[i + 1]); B.push(img.data[i + 2]); } };
  for (let k = 0; k < t; k++) {
    for (let x = 0; x < img.w; x += step) { take(x, k); take(x, img.h - 1 - k); }
    for (let y = 0; y < img.h; y += step) { take(k, y); take(img.w - 1 - k, y); }
  }
  return [median(R), median(G), median(B)];
}

function pickBackground(img: Img, spec: string): number[] {
  if (spec === 'auto') return estimateBackground(img);
  if (spec === 'white') return [255, 255, 255];
  const c = parseHex(spec);
  if (!c) throw new Error(`background must be "auto", "white" or "#rrggbb", not "${spec}".`);
  return c;
}

interface Mask { m: Uint8Array; w: number; h: number; sx: number; sy: number }

/** Foreground mask on a copy no larger than ~800 px: area averaging also dims 1-pixel dust. */
async function foregroundMask(img: Img, bg: number[], threshold: number, side = 800): Promise<Mask> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .flatten({ background: { r: bg[0], g: bg[1], b: bg[2] } }).resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = new Uint8Array(info.width * info.height);
  for (let i = 0; i < m.length; i++) {
    const d = Math.max(Math.abs(data[i * 3] - bg[0]), Math.abs(data[i * 3 + 1] - bg[1]), Math.abs(data[i * 3 + 2] - bg[2]));
    m[i] = d > threshold ? 1 : 0;
  }
  return { m, w: info.width, h: info.height, sx: img.w / info.width, sy: img.h / info.height };
}

/** Separable min (erode) or max (dilate) filter with a (2r+1) window. */
function morph(m: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array {
  if (r <= 0) return m;
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  const hit = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (m[y * w + k] === hit) { v = hit; break; }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] === hit) { v = hit; break; }
    out[y * w + x] = v;
  }
  return out;
}

const openMask = (m: Uint8Array, w: number, h: number, r: number) => morph(morph(m, w, h, r, false), w, h, r, true);

function bbox(m: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// ---------- trim ----------

async function trimImg(img: Img, p: { threshold: number; padding_px: number; background: string }, notes: string[]): Promise<Img> {
  const bg = pickBackground(img, p.background);
  const k = await foregroundMask(img, bg, p.threshold);
  // Opening removes specks up to ~4 px at 800 px scale; if it removes everything the object itself is tiny, so use the raw mask.
  let m = openMask(k.m, k.w, k.h, 2);
  let b = bbox(m, k.w, k.h);
  if (!b) { m = k.m; b = bbox(m, k.w, k.h); }
  if (!b) { notes.push(`trim: found no content different from the background ${hex(bg)}; left unchanged. Lower threshold (now ${p.threshold}) if the content is faint.`); return img; }
  const x0 = Math.max(0, Math.floor(b.x0 * k.sx) - p.padding_px), y0 = Math.max(0, Math.floor(b.y0 * k.sy) - p.padding_px);
  const x1 = Math.min(img.w, Math.ceil((b.x1 + 1) * k.sx) + p.padding_px), y1 = Math.min(img.h, Math.ceil((b.y1 + 1) * k.sy) + p.padding_px);
  if (x1 - x0 >= img.w * 0.995 && y1 - y0 >= img.h * 0.995) { notes.push(`trim: no uniform border found (background ${hex(bg)}); left unchanged.`); return img; }
  notes.push(`trim: background ${hex(bg)}, cropped ${img.w}x${img.h} to ${x1 - x0}x${y1 - y0}.`);
  return cropImg(img, x0, y0, x1 - x0, y1 - y0);
}

// ---------- split ----------

function hull(pts: number[][]): number[][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], up: number[][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Clockwise rotation (degrees, image coordinates with y down) that makes the point set's bounding box smallest. */
export function minAreaAngle(pts: number[][]): number {
  const h = hull(pts);
  const area = (deg: number) => {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    let a = 1e18, b = -1e18, d = 1e18, e = -1e18;
    for (const [x, y] of h) { const u = x * c - y * s, v = x * s + y * c; if (u < a) a = u; if (u > b) b = u; if (v < d) d = v; if (v > e) e = v; }
    return (b - a) * (e - d);
  };
  const search = (from: number, to: number, step: number, seed: number) => {
    const list: number[] = [];
    for (let a = from; a <= to + 1e-9; a += step) list.push(a);
    list.sort((x, y) => Math.abs(x - seed) - Math.abs(y - seed));
    let best = list[0], bestA = area(best);
    for (const a of list) { const v = area(a); if (v < bestA * 0.9995) { best = a; bestA = v; } }
    return best;
  };
  const coarse = search(-45, 45, 1, 0);
  return Math.round(search(coarse - 1, coarse + 1, 0.1, coarse) * 10) / 10;
}

async function splitImg(img: Img, p: { min_area_pct: number; padding_px: number; threshold: number; deskew: boolean }, notes: string[]): Promise<Img[]> {
  const bg = estimateBackground(img);
  const k = await foregroundMask(img, bg, p.threshold);
  const m = openMask(k.m, k.w, k.h, 2);
  const merged = morph(m, k.w, k.h, Math.max(2, Math.round(0.008 * Math.max(k.w, k.h))), true); // joins fragments of one object
  const label = new Int32Array(k.m.length);
  const comps: { id: number; pts: number[][]; area: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack = new Int32Array(k.m.length);
  for (let s = 0; s < merged.length; s++) {
    if (!merged[s] || label[s]) continue;
    const id = comps.length + 1, c = { id, pts: [] as number[][], area: 0, x0: k.w, y0: k.h, x1: 0, y1: 0 };
    let sp = 0; stack[sp++] = s; label[s] = id;
    while (sp) {
      const i = stack[--sp], x = i % k.w, y = (i / k.w) | 0;
      if (m[i]) {
        c.area++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        if (x === 0 || y === 0 || x === k.w - 1 || y === k.h - 1 || !m[i - 1] || !m[i + 1] || !m[i - k.w] || !m[i + k.w]) c.pts.push([x, y]);
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= k.w || ny >= k.h) continue;
        const ni = ny * k.w + nx;
        if (merged[ni] && !label[ni]) { label[ni] = id; stack[sp++] = ni; }
      }
    }
    comps.push(c);
  }
  const minArea = (p.min_area_pct / 100) * k.w * k.h;
  const big = comps.filter(c => c.area >= minArea && c.area > 0);
  const dropped = comps.length - big.length;
  if (!big.length) { notes.push(`split: found no object bigger than ${p.min_area_pct}% of the image (background ${hex(bg)}); returned the whole image. Lower min_area_pct or threshold.`); return [img]; }
  // Rows top to bottom, then left to right inside a row.
  big.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows: typeof big[] = [];
  for (const c of big) {
    const row = rows[rows.length - 1];
    if (row && (c.y0 + c.y1) / 2 < row[0].y1 && (c.y0 + c.y1) / 2 > row[0].y0) row.push(c); else rows.push([c]);
  }
  const ordered = rows.flatMap(r => r.sort((a, b) => a.x0 - b.x0));
  const out: Img[] = [];
  for (const c of ordered) {
    const margin = p.padding_px + Math.ceil(4 * Math.max(k.sx, k.sy));
    let piece = cropImg(img, c.x0 * k.sx - margin, c.y0 * k.sy - margin, (c.x1 - c.x0 + 1) * k.sx + 2 * margin, (c.y1 - c.y0 + 1) * k.sy + 2 * margin);
    let angle = 0;
    if (p.deskew && c.pts.length >= 8) {
      angle = minAreaAngle(c.pts);
      if (Math.abs(angle) >= 0.5 && Math.abs(angle) < 44) piece = await viaSharp(piece, s => s.rotate(angle, { background: { r: bg[0], g: bg[1], b: bg[2], alpha: 1 } }));
      else angle = 0;
    }
    out.push(await trimImg(piece, { threshold: p.threshold, padding_px: p.padding_px, background: hex(bg) }, []));
    if (angle) notes.push(`split: object ${out.length} straightened by ${angle} deg.`);
  }
  notes.push(`split: ${out.length} object(s) found${dropped ? `, ${dropped} tiny piece(s) ignored` : ''}; order is top-to-bottom, left-to-right.`);
  return out;
}

// ---------- deskew ----------

/** Skew in degrees (clockwise rotation that straightens the content) by maximising the variance of the row profile. */
export function estimateSkew(gray: Uint8Array, w: number, h: number, maxDeg: number): { angle: number; points: number } {
  const edge: number[] = [];
  for (let x = 0; x < w; x++) { edge.push(gray[x], gray[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { edge.push(gray[y * w], gray[y * w + w - 1]); }
  const bg = median(edge);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - bg) > 40) { xs.push(i % w); ys.push((i / w) | 0); }
  const stride = Math.max(1, Math.floor(xs.length / 80000));
  const n = Math.floor(xs.length / stride);
  if (n < 50) return { angle: 0, points: n };
  const bins = w + h + 2, hist = new Float64Array(bins);
  const score = (deg: number) => {
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    hist.fill(0);
    for (let i = 0; i < xs.length; i += stride) hist[Math.round(xs[i] * s + ys[i] * c + w)]++;
    let sum = 0, sq = 0;
    for (let i = 0; i < bins; i++) { sum += hist[i]; sq += hist[i] * hist[i]; }
    return sq - (sum * sum) / bins;
  };
  let best = 0, bestV = score(0);
  const coarse: number[] = [];
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += 0.5) coarse.push(a);
  coarse.sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const a of coarse) { const v = score(a); if (v > bestV * 1.002) { best = a; bestV = v; } }
  const c0 = best;
  for (let a = c0 - 0.5; a <= c0 + 0.5 + 1e-9; a += 0.1) { const v = score(a); if (v > bestV) { best = a; bestV = v; } }
  return { angle: Math.round(best * 10) / 10, points: n };
}

async function deskewImg(img: Img, p: { max_degrees: number }, notes: string[]): Promise<Img> {
  const sharp = await loadSharp();
  const bg = estimateBackground(img);
  const { data, info } = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .flatten({ background: { r: bg[0], g: bg[1], b: bg[2] } }).resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { angle, points } = estimateSkew(data, info.width, info.height, p.max_degrees);
  if (points < 50) { notes.push('deskew: too little content to measure skew; left unchanged.'); return img; }
  if (Math.abs(angle) < 0.2) { notes.push('deskew: already straight (under 0.2 deg).'); return img; }
  notes.push(`deskew: rotated ${angle} deg, filled corners with ${hex(bg)}.`);
  return viaSharp(img, s => s.rotate(angle, { background: { r: bg[0], g: bg[1], b: bg[2], alpha: 1 } }));
}

// ---------- remove background ----------

function toLab(r: number, g: number, b: number): [number, number, number] {
  const f = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  const g2 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = g2((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = g2(0.2126 * R + 0.7152 * G + 0.0722 * B), z = g2((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

async function removeBgColor(img: Img, p: { tolerance: number; feather: number }, notes: string[]): Promise<Img> {
  const bg = estimateBackground(img), ref = toLab(bg[0], bg[1], bg[2]);
  const { w, h, data } = img, tol2 = p.tolerance * p.tolerance;
  const isBg = (i: number) => {
    if (data[i * 4 + 3] < 8) return true;
    const l = toLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const d0 = l[0] - ref[0], d1 = l[1] - ref[1], d2 = l[2] - ref[2];
    return d0 * d0 + d1 * d1 + d2 * d2 <= tol2;
  };
  const seen = new Uint8Array(w * h); // 1 = queued, 2 = background
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (i: number) => { if (!seen[i] && isBg(i)) { seen[i] = 2; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  let removed = 0;
  while (sp) {
    const i = stack[--sp]; removed++;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  if (removed === w * h) { notes.push('remove_background(color): everything matched the background; lower tolerance. Image left unchanged.'); return img; }
  const alpha = Buffer.alloc(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = seen[i] === 2 ? 0 : Math.min(255, data[i * 4 + 3]);
  let a = alpha;
  if (p.feather > 0) {
    const sharp = await loadSharp();
    a = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(p.feather).extractChannel(0).raw().toBuffer();
    for (let i = 0; i < a.length; i++) if (seen[i] === 2) a[i] = Math.min(a[i], 255); // background stays background; blur only softens the rim
  }
  const out = Buffer.from(data);
  for (let i = 0; i < a.length; i++) out[i * 4 + 3] = Math.min(a[i], data[i * 4 + 3]);
  notes.push(`remove_background: method=color (flood fill from the borders, background ${hex(bg)}, tolerance ${p.tolerance}, ${(100 * removed / (w * h)).toFixed(0)}% removed). Works best on plain backgrounds; for photos with busy backgrounds install the AI method.`);
  return { data: out, w, h };
}

async function removeBgAi(img: Img): Promise<Img> {
  let mod: any;
  try {
    const name = '@imgly/background-removal-node';
    mod = await import(name);
  } catch {
    throw new Error('remove_background method "ai" needs the optional package. Install it with: npm i @imgly/background-removal-node (in the print-mcp folder), then retry. Or use method "color" for plain backgrounds.');
  }
  const sharp = await loadSharp();
  const png = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer();
  const blob: Blob = await mod.removeBackground(new Blob([new Uint8Array(png)], { type: 'image/png' }));
  const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).resize(img.w, img.h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

// ---------- tone and filters ----------

function lutMap(img: Img, lut: Uint8Array): void {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
}

/** Moving-average over a (2r+1) square, separable running sums. */
function boxMean(g: Uint8Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0, cnt = 0;
    for (let x = 0; x < Math.min(w, r); x++) { sum += g[y * w + x]; cnt++; }
    for (let x = 0; x < w; x++) {
      if (x + r < w) { sum += g[y * w + x + r]; cnt++; }
      if (x - r - 1 >= 0) { sum -= g[y * w + x - r - 1]; cnt--; }
      tmp[y * w + x] = sum / cnt;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0, cnt = 0;
    for (let y = 0; y < Math.min(h, r); y++) { sum += tmp[y * w + x]; cnt++; }
    for (let y = 0; y < h; y++) {
      if (y + r < h) { sum += tmp[(y + r) * w + x]; cnt++; }
      if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]; cnt--; }
      out[y * w + x] = sum / cnt;
    }
  }
  return out;
}

/** Adaptive (local-mean) threshold: a pixel is ink when clearly darker than its neighbourhood, so shaded scans stay clean. */
function adaptiveBw(img: Img, strength: number): Img {
  const { w, h, data } = img;
  const g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) {
    const a = data[i * 4 + 3] / 255;
    g[i] = Math.round((0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * a + 255 * (1 - a));
  }
  const mean = boxMean(g, w, h, Math.max(8, Math.round(Math.max(w, h) / 40)));
  const ratio = 1 - 0.1 / strength; // higher strength keeps lighter strokes (thicker text)
  const out = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < g.length; i++) { const v = g[i] < mean[i] * ratio ? 0 : 255; out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; }
  return { data: out, w, h };
}

async function enhanceDocument(img: Img, p: { mode: string; strength: number }): Promise<Img> {
  const flat = await viaSharp(img, s => s.flatten({ background: '#ffffff' }));
  if (p.mode === 'bw') {
    const g = await viaSharp(flat, s => s.grayscale().normalise());
    return adaptiveBw(g, p.strength);
  }
  const tile = Math.max(3, Math.min(Math.round(flat.w / 8), flat.w, Math.round(flat.h / 8) || 3));
  return viaSharp(flat, s => {
    let t = p.mode === 'gray' ? s.grayscale() : s;
    t = t.normalise().clahe({ width: tile, height: tile, maxSlope: Math.min(100, Math.round(2 + p.strength * 2)) });
    return t.sharpen({ sigma: 1, m1: 0.5 * p.strength, m2: 1 * p.strength });
  });
}

// ---------- apply ----------

const sharpBg = (c: string, auto?: number[]) => {
  if (c === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  if (c === 'auto' && auto) return { r: auto[0], g: auto[1], b: auto[2], alpha: 1 };
  return c;
};

async function applyOp(img: Img, op: OpName, p: Record<string, any>, notes: string[]): Promise<Img> {
  switch (op) {
    case 'trim': return trimImg(img, p as never, notes);
    case 'deskew': return deskewImg(img, p as never, notes);
    case 'remove_background': {
      let method = p.method as string;
      if (method === 'auto') {
        try { await import('@imgly/background-removal-node' as string); method = 'ai'; } catch { method = 'color'; notes.push('remove_background: AI package not installed, used the color method.'); }
      }
      return method === 'ai' ? removeBgAi(img).then(r => { notes.push('remove_background: method=ai (@imgly/background-removal-node).'); return r; }) : removeBgColor(img, p as never, notes);
    }
    case 'crop': {
      if (p.x >= img.w || p.y >= img.h) throw new Error(`crop: x=${p.x}, y=${p.y} is outside the ${img.w}x${img.h} image.`);
      const r = cropImg(img, p.x, p.y, p.width, p.height);
      if (r.w < p.width || r.h < p.height) notes.push(`crop: clamped to the image, result ${r.w}x${r.h}.`);
      return r;
    }
    case 'rotate': {
      const bg = p.fill === 'auto' ? estimateBackground(img) : undefined;
      return viaSharp(img, s => s.rotate(p.degrees, { background: sharpBg(p.fill, bg) as never }));
    }
    case 'flip': return viaSharp(img, s => { let t = s; if (p.vertical) t = t.flip(); if (p.horizontal) t = t.flop(); return t; });
    case 'resize': {
      let width = p.width as number | undefined, height = p.height as number | undefined, fit = p.fit as string;
      if (p.scale) { width = Math.max(1, Math.round(img.w * p.scale)); height = Math.max(1, Math.round(img.h * p.scale)); fit = 'fill'; }
      if (!width && !height) throw new Error('resize needs width, height or scale.');
      checkSize(width ?? img.w * (height! / img.h), height ?? img.h * (width! / img.w), 'The resized image');
      return viaSharp(img, s => s.resize({ width, height, fit: fit as never, kernel: p.kernel, background: { r: 0, g: 0, b: 0, alpha: 0 } }));
    }
    case 'denoise': {
      // Median filter: removes speckle and scanner grain while keeping edges sharp (unlike a blur). Size 3/3/5/5/7 for strength 1..5.
      const size = [3, 3, 5, 5, 7][p.strength - 1];
      return viaSharp(img, s => s.median(size));
    }
    case 'sharpen': return p.amount === 0 ? img : viaSharp(img, s => s.sharpen({ sigma: 1, m1: 0.8 * p.amount, m2: 1.6 * p.amount }));
    case 'upscale': {
      checkSize(img.w * p.scale, img.h * p.scale, 'The upscaled image');
      return viaSharp(img, s => s.resize({ width: Math.round(img.w * p.scale), height: Math.round(img.h * p.scale), fit: 'fill', kernel: 'lanczos3' }).sharpen({ sigma: 0.8, m1: 0.6, m2: 1.2 }));
    }
    case 'enhance_document': return enhanceDocument(img, p as never);
    case 'adjust': {
      let r: Img = { data: Buffer.from(img.data), w: img.w, h: img.h };
      if (p.brightness !== undefined || p.contrast !== undefined || p.gamma !== undefined) {
        const lut = new Uint8Array(256), f = 1 + (p.contrast ?? 0) / 100, add = (p.brightness ?? 0) * 2.55;
        for (let v = 0; v < 256; v++) {
          let x = 255 * Math.pow(v / 255, 1 / (p.gamma ?? 1));
          x = (x + add - 128) * f + 128;
          lut[v] = Math.max(0, Math.min(255, Math.round(x)));
        }
        lutMap(r, lut);
      }
      if (p.saturation !== undefined || p.hue !== undefined) r = await viaSharp(r, s => s.modulate({ saturation: 1 + (p.saturation ?? 0) / 100, hue: p.hue ?? 0 }));
      return r;
    }
    case 'grayscale': return viaSharp(img, s => s.grayscale());
    case 'invert': return viaSharp(img, s => s.negate({ alpha: false }));
    case 'threshold': {
      const r: Img = { data: Buffer.from(img.data), w: img.w, h: img.h }, d = r.data;
      for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] >= p.value ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
      return r;
    }
    case 'round': {
      const rad = Math.min(p.radius_px ?? 0, Math.min(img.w, img.h) / 2);
      if (!p.circle && !(rad > 0)) throw new Error('round needs radius_px > 0 or circle:true.');
      const shape = p.circle ? `<circle cx="${img.w / 2}" cy="${img.h / 2}" r="${Math.min(img.w, img.h) / 2}" fill="#fff"/>` : `<rect width="${img.w}" height="${img.h}" rx="${rad}" ry="${rad}" fill="#fff"/>`;
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${img.w}" height="${img.h}">${shape}</svg>`);
      return viaSharp(img, s => s.composite([{ input: svg, blend: 'dest-in' }]));
    }
    case 'border': return viaSharp(img, s => s.extend({ top: p.width_px, bottom: p.width_px, left: p.width_px, right: p.width_px, background: sharpBg(p.color) as never }));
    case 'pad': {
      if (!(p.top || p.right || p.bottom || p.left)) throw new Error('pad needs at least one of top, right, bottom, left (px).');
      checkSize(img.w + p.left + p.right, img.h + p.top + p.bottom, 'The padded image');
      return viaSharp(img, s => s.extend({ top: p.top, right: p.right, bottom: p.bottom, left: p.left, background: sharpBg(p.color) as never }));
    }
    default: throw new Error(`Unknown op ${op}. Valid ops: ${OP_NAMES.join(', ')}.`);
  }
}

// ---------- load / save ----------

interface Loaded { img: Img; base: string; format: string; density?: number; hadAlpha: boolean }

async function loadSource(source: string): Promise<Loaded> {
  const sharp = await loadSharp();
  let input: Buffer, base = 'image';
  const s = source.trim();
  if (s.startsWith('data:')) {
    const m = /^data:([^;,]*)(;base64)?,/.exec(s.slice(0, 200));
    if (!m) throw new Error('Malformed data: URI. Expected data:image/png;base64,....');
    const raw = s.slice(s.indexOf(',') + 1);
    input = m[2] ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw));
  } else {
    if (/^https?:\/\//i.test(s)) throw new Error('source must be a local image path or a data: URI. Download the image to a file first.');
    const file = resolveLocalPath(s);
    assertLocalPathAllowed(file, {});
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { throw new Error(`Image not found: ${file}. Pass the full path of an existing image file.`); }
    if (!st.isFile()) throw new Error(`${file} is not a file.`);
    if (st.size > 512 * 1024 * 1024) throw new Error(`${file} is over 512 MB.`);
    input = fs.readFileSync(file);
    base = path.basename(file, path.extname(file)) || 'image';
  }
  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: false }).metadata();
  } catch (e) {
    throw new Error(`Cannot read this as an image (${(e as Error).message}). Supported: png, jpg, webp, tif, gif, bmp, svg${base === 'image' ? '' : ''} (heic only if the sharp build includes it). For PDF pages use preview, or convert first.`);
  }
  const pages = meta.pages ?? 1;
  const w = meta.width ?? 0, h = meta.height ?? 0;
  if (!w || !h) throw new Error('Image has no size.');
  if (w * h > MAX_MEGAPIXELS * 1e6) throw new Error(`Image is ${(w * h / 1e6).toFixed(1)} megapixels (${w}x${h}); the limit is ${MAX_MEGAPIXELS}. Rescan at 300 dpi or downsize it first.`);
  const { data, info } = await sharp(input, { limitInputPixels: false }).rotate().ensureAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  void pages;
  const safe = base.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60) || 'image';
  return { img: { data, w: info.width, h: info.height }, base: safe, format: meta.format ?? 'png', density: meta.density, hadAlpha: !!meta.hasAlpha };
}

function hasTransparency(img: Img): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

export interface EditArgs {
  source: string; ops: OpItem[];
  output_file?: string; output_dir?: string; overwrite?: boolean;
  format?: 'png' | 'jpeg' | 'webp'; quality?: number; dpi?: number;
}
export interface EditFile { path: string; width: number; height: number; bytes: number; format: string; has_alpha: boolean }
export interface EditResult { files: EditFile[]; ops_applied: { op: string; params: Record<string, unknown> }[]; notes: string[]; hint: string }

const IMAGES_DIR = () => path.join(STATE_DIR, 'images');

function sweepImages(dir: string): void {
  try {
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n);
      try { const st = fs.statSync(f); if (st.isFile() && n.includes('-edit-') && Date.now() - st.mtimeMs > SWEEP_MS) fs.unlinkSync(f); } catch { /* another process may own it */ }
    }
  } catch { /* directory does not exist yet */ }
}

export async function editImage(a: EditArgs): Promise<EditResult> {
  const ops = parseOps(a.ops);
  if (!ops.length) throw new Error('ops is empty. Give at least one op, e.g. [{"op":"trim"}]. Valid ops: ' + OP_NAMES.join(', '));
  if (a.output_file && !/\.(png|jpe?g|webp)$/i.test(a.output_file)) throw new Error('output_file must end in .png, .jpg, .jpeg or .webp.');
  const sharp = await loadSharp();
  const notes: string[] = [];
  const loaded = await loadSource(a.source);

  let imgs: Img[] = [loaded.img];
  const applied: EditResult['ops_applied'] = [];
  for (const { op, p } of ops) {
    if (op === 'split') imgs = await splitImg(imgs[0], p as never, notes);
    else imgs = [await applyOp(imgs[0], op, p, notes)];
    applied.push({ op, params: p });
  }

  const wantAlpha = imgs.map(hasTransparency);
  const ext0 = a.output_file ? path.extname(a.output_file).toLowerCase().slice(1) : '';
  let format: 'png' | 'jpeg' | 'webp' = a.format ?? (ext0 ? (ext0 === 'jpg' ? 'jpeg' : ext0) as never : wantAlpha.some(Boolean) ? 'png' : (['jpeg', 'webp', 'png'].includes(loaded.format) ? loaded.format as never : 'png'));
  if (a.format && ext0 && (ext0 === 'jpg' ? 'jpeg' : ext0) !== a.format) notes.push(`output_file extension .${ext0} wins over format=${a.format}.`), format = (ext0 === 'jpg' ? 'jpeg' : ext0) as never;
  if (format === 'jpeg' && wantAlpha.some(Boolean)) notes.push('JPEG has no transparency: transparent areas were filled with white. Use png or webp to keep them.');

  let dir: string;
  if (a.output_file) dir = path.dirname(resolveLocalPath(a.output_file));
  else if (a.output_dir) dir = resolveLocalPath(a.output_dir);
  else { dir = IMAGES_DIR(); sweepImages(dir); }
  assertLocalPathAllowed(dir, {});
  fs.mkdirSync(dir, { recursive: true });

  const extOut = format === 'jpeg' ? 'jpg' : format;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const files: EditFile[] = [];
  for (let n = 0; n < imgs.length; n++) {
    let target: string;
    if (a.output_file) {
      const t = resolveLocalPath(a.output_file);
      target = imgs.length === 1 ? t : path.join(path.dirname(t), `${path.basename(t, path.extname(t))}-${n + 1}${path.extname(t)}`);
      assertLocalPathAllowed(target, {});
      if (fs.existsSync(target) && !a.overwrite) throw new Error(`${target} already exists and would be overwritten. Choose another output_file or pass overwrite:true.`);
    } else {
      const suffix = imgs.length > 1 ? `-${n + 1}` : '';
      target = path.join(dir, `${loaded.base}-edit-${stamp}${suffix}.${extOut}`);
      for (let c = 2; fs.existsSync(target); c++) target = path.join(dir, `${loaded.base}-edit-${stamp}${suffix}-${c}.${extOut}`);
    }
    const im = imgs[n], alpha = wantAlpha[n] && format !== 'jpeg';
    let s = sharp(im.data, { raw: { width: im.w, height: im.h, channels: 4 } });
    s = alpha ? s : s.flatten({ background: '#ffffff' }).removeAlpha();
    const density = a.dpi ?? loaded.density;
    if (density) s = s.withMetadata({ density });
    s = format === 'jpeg' ? s.jpeg({ quality: a.quality ?? 92, mozjpeg: true }) : format === 'webp' ? s.webp({ quality: a.quality ?? 92 }) : s.png({ compressionLevel: 6 });
    const buf = await s.toBuffer();
    fs.writeFileSync(target, buf);
    files.push({ path: target, width: im.w, height: im.h, bytes: buf.length, format, has_alpha: alpha });
  }
  const first = files[0].path;
  const hint = files.length > 1
    ? `${files.length} files saved. Print one with print source=<path>, place one on a page with layout_page (image item source=<path>), or run image_edit again on a single file for more clean-up.`
    : `Saved. Print it with print source=${first}, put it on a page with layout_page (image item source=${first}), or run image_edit again for more clean-up.`;
  return { files, ops_applied: applied, notes, hint };
}
