// Every print setting, and the logic that fits a request to what a printer can really do.
// Unsupported requests degrade with a stated warning, or fail before any paper moves.
import { z } from 'zod';
import type { Config } from './state.js';
import { supportsColor, supportsDuplex, type MediaCol, type PrinterRecord } from './registry.js';

const adjust = (d: string) => z.number().min(-100).max(100).optional().describe(d);
const mm = (d: string) => z.number().min(0).max(200).optional().describe(d);

export const printOptionsShape = {
  // paper
  paper: z.string().optional().describe('A4, A5, A6, letter, legal, 4x6, 5x7, photo-l, DL, C5, or custom like "100x150mm", "4x6in". Default: what the printer has loaded.'),
  paper_type: z.string().optional().describe('plain, inkjet, photo, glossy, or a printer keyword'),
  paper_source: z.string().optional().describe('Tray: auto, main, manual, or a name from printer_status'),
  // pages
  pages: z.string().optional().describe('e.g. "1-3,5,last", "-2" (second to last), "10-8" (reversed)'),
  page_set: z.enum(['all', 'odd', 'even']).optional(),
  reverse: z.boolean().optional().describe('Print last page first'),
  copies: z.number().int().min(1).max(999).optional(),
  collate: z.boolean().optional().describe('true 1,2,3,1,2,3 (default). false 1,1,2,2,3,3'),
  duplex: z.enum(['none', 'long', 'short']).optional().describe('Two-sided: long = book, short = notepad'),
  // layout
  orientation: z.enum(['auto', 'portrait', 'landscape']).optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe('Extra clockwise rotation'),
  scale: z.enum(['fit', 'shrink', 'fill', 'stretch', 'actual']).optional().describe('fit (default) whole page; shrink only if too big; fill crop to cover; stretch ignore aspect; actual 100%'),
  scale_percent: z.number().min(1).max(1000).optional().describe('Exact zoom, overrides scale'),
  margin_mm: mm('Blank margin on all sides'),
  margin_top_mm: mm('Top margin'),
  margin_right_mm: mm('Right margin'),
  margin_bottom_mm: mm('Bottom margin'),
  margin_left_mm: mm('Left margin'),
  borderless: z.boolean().optional().describe('Edge to edge, if the printer supports it'),
  align: z.enum(['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  n_up: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(6), z.literal(8), z.literal(9), z.literal(16)]).optional().describe('Pages per sheet'),
  n_up_gap_mm: mm('Gap between pages on a sheet'),
  // border (a printed frame, separate from the blank margin)
  border_mm: z.number().min(0).max(50).optional().describe('Thickness of a printed frame around the content'),
  border_color: z.string().optional().describe('#rrggbb or a name: black, red, blue, gray...'),
  border_style: z.enum(['solid', 'dashed', 'dotted', 'double']).optional(),
  border_gap_mm: mm('Space between frame and content'),
  cell_border_mm: z.number().min(0).max(20).optional().describe('Frame around each page in n-up'),
  // color and tone
  color: z.enum(['auto', 'color', 'monochrome', 'black_white']).optional().describe('auto (default) sends pages with no color as gray, saving color ink. black_white is pure 1-bit look'),
  quality: z.enum(['draft', 'normal', 'high']).optional(),
  dpi: z.number().int().min(50).max(4800).optional().describe('Overrides the resolution chosen by quality'),
  darkness: adjust('Ink density, -100 lighter to 100 darker'),
  brightness: adjust('-100 to 100'),
  contrast: adjust('-100 to 100'),
  saturation: adjust('-100 gray to 100 vivid'),
  gamma: z.number().min(0.1).max(5).optional().describe('1 = unchanged'),
  sharpen: z.number().min(0).max(100).optional(),
  ink_saver: z.number().min(0).max(90).optional().describe('Percent lighter overall'),
  threshold: z.number().int().min(1).max(254).optional().describe('Cutoff for black_white, default 128'),
  invert: z.boolean().optional(),
  mirror: z.boolean().optional().describe('Horizontal flip, for iron-on transfers'),
  // overlays
  watermark: z.string().optional().describe('Text across each sheet'),
  watermark_opacity: z.number().min(1).max(100).optional().describe('Percent, default 15'),
  watermark_color: z.string().optional(),
  watermark_angle: z.number().min(-180).max(180).optional().describe('Default -45'),
  watermark_size_pt: z.number().min(6).max(400).optional(),
  header: z.string().optional().describe('Left|Center|Right. Tokens: {page} {pages} {date} {time} {name}'),
  footer: z.string().optional().describe('Same format as header, e.g. "|{page}/{pages}|"'),
  overlay_font: z.string().optional().describe('Font for header, footer, watermark'),
  overlay_size_pt: z.number().min(4).max(72).optional(),
  overlay_color: z.string().optional(),
  // text, markdown, html rendering
  font: z.string().optional().describe('Body font for text and markdown. Default handles Thai and English'),
  font_size_pt: z.number().min(4).max(96).optional(),
  line_height: z.number().min(0.8).max(4).optional(),
  line_numbers: z.boolean().optional().describe('For text sources'),
  css: z.string().optional().describe('Extra CSS for text, markdown or html'),
  javascript: z.boolean().optional().describe('Run page scripts. Default: on for URLs and html files, off for inline content'),
  allow_network: z.boolean().optional().describe('Fetch remote resources. Same defaults as javascript'),
  allow_private_network: z.boolean().optional().describe('Required to print a URL on this LAN or PC (router, intranet, localhost) or a \\\\server\\share path. Off by default so a page or link cannot reach internal systems'),
  wait_ms: z.number().int().min(0).max(30000).optional().describe('Extra wait before capturing a web page'),
  print_background: z.boolean().optional().describe('Web page backgrounds, default true'),
  password: z.string().optional().describe('For protected PDFs'),
};

const zodOptions = z.object(printOptionsShape).strict();
export type PrintOptions = z.infer<typeof zodOptions>;

/** Ready-made recipes; users can add their own with manage_presets. */
export const BUILTIN_PRESETS: Record<string, PrintOptions> = {
  document: { quality: 'normal', color: 'auto', scale: 'fit' },
  draft: { quality: 'draft', color: 'monochrome', ink_saver: 30 },
  eco: { quality: 'draft', color: 'monochrome', ink_saver: 50, n_up: 2 },
  sharp_text: { quality: 'high', color: 'monochrome', darkness: 15 },
  photo: { quality: 'high', color: 'color', paper_type: 'photo', scale: 'fill', orientation: 'auto' },
  photo_borderless: { quality: 'high', color: 'color', paper_type: 'photo', borderless: true, scale: 'fill' },
  booklet_2up: { n_up: 2, cell_border_mm: 0.2, n_up_gap_mm: 6 },
  handout_4up: { n_up: 4, cell_border_mm: 0.2, n_up_gap_mm: 4, color: 'monochrome' },
  poster_vivid: { quality: 'high', color: 'color', saturation: 25, contrast: 10 },
  scan_cleanup: { color: 'monochrome', contrast: 35, brightness: 10, sharpen: 30 },
};

export function mergeOptions(config: Config, printerId: string | undefined, preset: string | undefined, explicit: PrintOptions): PrintOptions {
  let presetValues: PrintOptions = {};
  if (preset) {
    const key = preset.toLowerCase();
    const found = config.presets[key] ?? BUILTIN_PRESETS[key];
    if (!found) throw new Error(`Unknown preset "${preset}". Available: ${[...Object.keys(BUILTIN_PRESETS), ...Object.keys(config.presets)].join(', ')}`);
    presetValues = found as PrintOptions;
  }
  return {
    ...(config.defaults as PrintOptions),
    ...((printerId && config.printerDefaults[printerId]) as PrintOptions | undefined),
    ...presetValues,
    ...explicit,
  };
}

// ---------- paper ----------

const NAMED_PAPER: Record<string, [number, number]> = {
  a3: [297, 420], a4: [210, 297], a5: [148, 210], a6: [105, 148], b5: [176, 250], jisb5: [182, 257],
  letter: [215.9, 279.4], legal: [215.9, 355.6], executive: [184.15, 266.7], tabloid: [279.4, 431.8],
  foolscap: [215.9, 330.2], f4: [215.9, 330.2], oficio: [215.9, 340.36],
  '4x6': [101.6, 152.4], '5x7': [127, 177.8], '5x8': [127, 203.2], '3.5x5': [88.9, 127], 'photo-l': [88.9, 127], l: [88.9, 127], '2l': [127, 177.8],
  dl: [110, 220], c5: [162, 229], '#10': [104.8, 241.3], com10: [104.8, 241.3], monarch: [98.4, 190.5],
};

export interface ResolvedMedia {
  keyword: string;
  widthMm: number;
  heightMm: number;
  custom: boolean;
}

export function parsePaper(paper: string): { widthMm: number; heightMm: number } {
  const key = paper.trim().toLowerCase().replace(/\s+/g, '');
  const named = NAMED_PAPER[key];
  if (named) return { widthMm: named[0], heightMm: named[1] };
  const m = /^(\d+(?:\.\d+)?)[x×*](\d+(?:\.\d+)?)(mm|cm|in|")?$/.exec(key);
  if (m) {
    const k = m[3] === 'in' || m[3] === '"' ? 25.4 : m[3] === 'cm' ? 10 : 1;
    const w = Math.round(+m[1] * k * 100) / 100, h = Math.round(+m[2] * k * 100) / 100;
    if (w < 20 || h < 20 || w > 2000 || h > 5000) throw new Error(`Paper size "${paper}" is outside any sane range.`);
    return { widthMm: Math.min(w, h), heightMm: Math.max(w, h) };
  }
  const exact = /_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|in)$/.exec(key);
  if (exact) {
    const k = exact[3] === 'in' ? 25.4 : 1;
    return { widthMm: +exact[1] * k, heightMm: +exact[2] * k };
  }
  throw new Error(`Unknown paper "${paper}". Use A4, letter, 4x6, or a size like 100x150mm.`);
}

function near(a: number, b: number): boolean { return Math.abs(a - b) < 1.2; }

function mmKeyword(w: number, h: number): string {
  const f = (n: number) => String(Math.round(n * 100) / 100);
  return `custom_${f(w)}x${f(h)}mm_${f(w)}x${f(h)}mm`;
}

export function resolveMedia(p: PrinterRecord, paper: string | undefined, warnings: string[]): ResolvedMedia {
  const caps = p.ipp?.caps;
  if (!paper) {
    const keyword = caps?.mediaReady[0] ?? caps?.mediaDefault;
    const hit = keyword ? caps!.media.find(m => m.keyword === keyword) : undefined;
    if (hit) return { keyword: hit.keyword, widthMm: hit.widthMm, heightMm: hit.heightMm, custom: false };
    return resolveMedia(p, 'A4', warnings);
  }
  const want = parsePaper(paper);
  if (caps) {
    const hit = caps.media.find(m => near(m.widthMm, want.widthMm) && near(m.heightMm, want.heightMm));
    if (hit) {
      if (caps.mediaReady.length && !caps.mediaReady.some(k => k === hit.keyword)) {
        warnings.push(`Printer reports ${caps.mediaReady.join(', ')} loaded but this job wants ${paper}. Load that paper or the printer may stop and ask.`);
      }
      return { keyword: hit.keyword, widthMm: hit.widthMm, heightMm: hit.heightMm, custom: false };
    }
    const r = caps.customRange;
    if (r && want.widthMm >= r.minW && want.widthMm <= r.maxW && want.heightMm >= r.minH && want.heightMm <= r.maxH) {
      return { keyword: mmKeyword(want.widthMm, want.heightMm), ...want, custom: true };
    }
    throw new Error(`${p.name} does not take "${paper}". It takes: ${caps.media.map(m => m.keyword).join(', ')}${r ? `, or custom ${r.minW}-${r.maxW} x ${r.minH}-${r.maxH} mm` : ''}.`);
  }
  const papers = p.queue?.caps?.papers;
  if (papers?.length && !papers.some(s => near(s.widthMm, want.widthMm) && near(s.heightMm, want.heightMm))) {
    warnings.push(`Driver lists no exact ${paper} size; asking for it as a custom size.`);
  }
  return { keyword: mmKeyword(want.widthMm, want.heightMm), ...want, custom: true };
}

// ---------- margins ----------

export interface Margins { top: number; right: number; bottom: number; left: number }

/** Hardware unprintable margins on the physical portrait sheet, from media-col-database. */
export function hardwareMargins(p: PrinterRecord, media: ResolvedMedia): { margins: Margins; borderlessOk: boolean } {
  const cols = p.ipp?.caps.mediaCols ?? [];
  const forSize = cols.filter(c => near(c.widthMm, media.widthMm) && near(c.heightMm, media.heightMm));
  const pool: MediaCol[] = forSize.length ? forSize : cols;
  const borderlessOk = forSize.some(c => c.topMm === 0 && c.bottomMm === 0 && c.leftMm === 0 && c.rightMm === 0);
  const bordered = pool.filter(c => c.topMm > 0 || c.bottomMm > 0 || c.leftMm > 0 || c.rightMm > 0);
  if (bordered.length) {
    const best = bordered.reduce((a, b) => (a.topMm + a.bottomMm + a.leftMm + a.rightMm <= b.topMm + b.bottomMm + b.leftMm + b.rightMm ? a : b));
    return { margins: { top: best.topMm, right: best.rightMm, bottom: best.bottomMm, left: best.leftMm }, borderlessOk };
  }
  // Without a report (driver queues draw with the driver's own hard margins) 3 mm is the safe minimum.
  return { margins: { top: 3, right: 3, bottom: 3, left: 3 }, borderlessOk };
}

// ---------- plan ----------

export interface JobPlan {
  media: ResolvedMedia;
  dpi: number;
  quality: 'draft' | 'normal' | 'high';
  qualityEnum: number;
  colorMode: 'auto' | 'color' | 'monochrome' | 'black_white';
  duplex: 'none' | 'long' | 'short';
  /** Reading-orientation margins requested by the user (undefined = automatic). */
  requestedMargins: Partial<Margins>;
  hardware: Margins;
  borderless: boolean;
  warnings: string[];
}

function pick(values: number[], target: number): number {
  return values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best));
}

export function availableDpis(p: PrinterRecord): number[] {
  const caps = p.ipp?.caps;
  const set = new Set<number>();
  // URF and PWG can list different resolutions, so use the list of the format that will be sent.
  const usesUrf = caps?.formats.includes('image/urf') && (caps.preferredFormat === 'image/urf' || !caps.formats.includes('image/pwg-raster') || caps.preferredFormat !== 'image/pwg-raster');
  const rs = usesUrf ? caps?.urf.find(u => u.startsWith('RS')) : undefined;
  if (rs) rs.slice(2).split('-').map(Number).filter(n => n > 0).forEach(n => set.add(n));
  if (!set.size) (caps?.rasterResolutions ?? []).forEach(n => set.add(n));
  if (!set.size) (caps?.resolutions ?? []).forEach(n => set.add(n));
  if (!set.size) p.queue?.caps?.resolutions.filter(r => r.x > 0).forEach(r => set.add(r.x));
  if (!set.size) { set.add(300); set.add(600); }
  return [...set].sort((a, b) => a - b);
}

export function makePlan(p: PrinterRecord, o: PrintOptions): JobPlan {
  const warnings: string[] = [];
  const media = resolveMedia(p, o.paper, warnings);
  const hw = hardwareMargins(p, media);

  const borderless = !!o.borderless && (() => {
    if (hw.borderlessOk || (!p.ipp && p.queue)) return true;
    warnings.push(`${p.name} has no borderless mode for this paper; printing with its normal ${hw.margins.top} mm margin.`);
    return false;
  })();

  const dpis = availableDpis(p);
  const quality = o.quality ?? 'normal';
  const wanted = o.dpi ?? (quality === 'high' ? 600 : 300);
  const dpi = pick(dpis, quality === 'draft' && !o.dpi ? Math.min(...dpis) : wanted);
  if (o.dpi && dpi !== o.dpi) warnings.push(`${p.name} supports ${dpis.join(', ')} dpi; using ${dpi}.`);

  let colorMode = o.color ?? 'auto';
  if (!supportsColor(p) && (colorMode === 'color' || colorMode === 'auto')) {
    if (colorMode === 'color') warnings.push(`${p.name} prints in monochrome only.`);
    colorMode = 'monochrome';
  }

  let duplex = o.duplex ?? 'none';
  // Exact edge, not just "some two-sided": flipped back pages on a printer that then prints them
  // one-sided would waste paper and look garbled.
  const sides = p.ipp?.caps.sides;
  const canDoThisEdge = sides ? sides.includes(duplex === 'long' ? 'two-sided-long-edge' : 'two-sided-short-edge') : supportsDuplex(p);
  if (duplex !== 'none' && !canDoThisEdge) {
    const other = sides?.some(s => s.startsWith('two-sided'));
    warnings.push(other
      ? `${p.name} cannot flip on the ${duplex} edge; printing one-sided. It offers: ${sides!.join(', ')}.`
      : `${p.name} has no automatic two-sided unit; printing one-sided. For manual two-sided, print page_set=odd, flip the stack, then page_set=even with reverse=true.`);
    duplex = 'none';
  }

  const requestedMargins: Partial<Margins> = {};
  const set = (k: keyof Margins, v: number | undefined) => { if (v !== undefined) requestedMargins[k] = v; };
  set('top', o.margin_top_mm ?? o.margin_mm);
  set('right', o.margin_right_mm ?? o.margin_mm);
  set('bottom', o.margin_bottom_mm ?? o.margin_mm);
  set('left', o.margin_left_mm ?? o.margin_mm);

  return {
    media, dpi, quality, qualityEnum: quality === 'draft' ? 3 : quality === 'high' ? 5 : 4, colorMode, duplex,
    requestedMargins, hardware: borderless ? { top: 0, right: 0, bottom: 0, left: 0 } : hw.margins, borderless, warnings,
  };
}

// ---------- page selection ----------

export function selectPages(spec: string | undefined, pageSet: PrintOptions['page_set'], reverse: boolean | undefined, count: number): number[] {
  let pages: number[] = [];
  if (!spec) pages = Array.from({ length: count }, (_, i) => i);
  else {
    const resolve = (t: string): number => {
      const v = t === 'last' ? count : Number(t);
      const n = v < 0 ? count + v + 1 : v;
      if (!Number.isInteger(n) || n < 1 || n > count) throw new Error(`Page "${t}" is out of range; the document has ${count} page${count === 1 ? '' : 's'}.`);
      return n - 1;
    };
    for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
      // Matches 2-6, 10-8, -3--1, last-1 style ranges without splitting a leading minus.
      const m = /^(-?\d+|last)-(-?\d+|last)$/.exec(part);
      if (m) {
        const a = resolve(m[1]), b = resolve(m[2]);
        for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) pages.push(i);
      } else if (/^(-?\d+|last)$/.test(part)) pages.push(resolve(part));
      else throw new Error(`Cannot read page range "${part}". Examples: 1-3,5,last`);
    }
  }
  // odd/even refer to document page numbers, which is what manual duplexing needs.
  if (pageSet === 'odd') pages = pages.filter(i => (i + 1) % 2 === 1);
  if (pageSet === 'even') pages = pages.filter(i => (i + 1) % 2 === 0);
  if (reverse) pages = pages.toReversed();
  return pages;
}

export function needsPixelWork(o: PrintOptions): boolean {
  return !!(o.pages || (o.page_set && o.page_set !== 'all') || o.reverse || o.rotate || (o.n_up && o.n_up > 1) || o.scale || o.scale_percent
    || o.margin_mm !== undefined || o.margin_top_mm !== undefined || o.margin_right_mm !== undefined || o.margin_bottom_mm !== undefined || o.margin_left_mm !== undefined
    || o.border_mm || o.darkness || o.brightness || o.contrast || o.saturation || (o.gamma && o.gamma !== 1) || o.sharpen || o.ink_saver
    || o.invert || o.mirror || o.watermark || o.header || o.footer || o.color === 'black_white' || (o.orientation && o.orientation !== 'auto'));
}
