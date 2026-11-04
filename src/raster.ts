// Page encoders for driverless printers: Apple Raster (URF), PWG Raster, 1-bit PCL.
// URF and PWG share one line compression: a line-repeat byte, then PackBits-style
// pixel runs. Layouts follow CUPS raster-stream.c and PWG 5102.4.

export interface Sheet {
  width: number;
  height: number;
  /** 1 = sGray 8-bit, 3 = sRGB 8-bit, interleaved, top-left origin, no padding. */
  comp: 1 | 3;
  data: Buffer;
}

export interface PageMeta {
  dpi: number;
  /** IPP print-quality enum: 3 draft, 4 normal, 5 high. */
  quality: number;
  duplex: 'none' | 'long' | 'short';
  totalPages: number;
  /** Paper size keyword name for the PWG header, e.g. iso_a4_210x297mm */
  mediaName: string;
  mediaType: string;
}

function encodeLine(src: Buffer, start: number, width: number, bpp: number, out: Buffer, pos: number): number {
  const same = (a: number, b: number): boolean => {
    const pa = start + a * bpp, pb = start + b * bpp;
    if (src[pa] !== src[pb]) return false;
    return bpp === 1 || (src[pa + 1] === src[pb + 1] && src[pa + 2] === src[pb + 2]);
  };
  let i = 0;
  while (i < width) {
    let j = i + 1;
    while (j < width && j - i < 128 && same(i, j)) j++;
    if (j - i >= 2 || j === width) {
      out[pos++] = j - i - 1;
      src.copy(out, pos, start + i * bpp, start + i * bpp + bpp);
      pos += bpp;
      i = j;
      continue;
    }
    // Literal run: stop as soon as two neighbours match so they can become a repeat.
    j = i + 1;
    while (j < width && j - i < 128 && !(j + 1 < width && same(j, j + 1))) j++;
    if (j - i === 1) {
      out[pos++] = 0;
      src.copy(out, pos, start + i * bpp, start + i * bpp + bpp);
      pos += bpp;
    } else {
      out[pos++] = 257 - (j - i);
      src.copy(out, pos, start + i * bpp, start + j * bpp);
      pos += (j - i) * bpp;
    }
    i = j;
  }
  return pos;
}

function compressPage(sheet: Sheet): Buffer {
  const { width, height, comp, data } = sheet;
  const lineBytes = width * comp;
  // True worst case is a control byte for every pixel: halftone patterns like x,y,y alternate
  // single literals with pairs. An undersized buffer would silently drop bytes and garble the page.
  const perLineMax = width * (comp + 1) + 2;
  let chunks: Buffer[] | null = null;
  let buf = Buffer.allocUnsafe(perLineMax * Math.min(height, 64) + height);
  let pos = 0;
  let y = 0;
  while (y < height) {
    const start = y * lineBytes;
    let repeat = 1;
    while (y + repeat < height && repeat < 256 && data.compare(data, start, start + lineBytes, start + repeat * lineBytes, start + (repeat + 1) * lineBytes) === 0) repeat++;
    if (pos + perLineMax + 1 > buf.length) {
      (chunks ??= []).push(Buffer.from(buf.subarray(0, pos)));
      buf = Buffer.allocUnsafe(Math.max(perLineMax * 8, 8 * 1024 * 1024));
      pos = 0;
    }
    buf[pos++] = repeat - 1;
    pos = encodeLine(data, start, width, comp, buf, pos);
    y += repeat;
  }
  const tail = Buffer.from(buf.subarray(0, pos));
  return chunks ? Buffer.concat([...chunks, tail]) : tail;
}

// ---------- URF ----------

export function urfFileHeader(pageCount: number): Buffer {
  const h = Buffer.alloc(12);
  h.write('UNIRAST\0', 0, 'latin1');
  h.writeUInt32BE(pageCount, 8);
  return h;
}

export function urfPage(sheet: Sheet, meta: PageMeta): Buffer[] {
  const h = Buffer.alloc(32);
  h[0] = sheet.comp * 8;
  h[1] = sheet.comp === 3 ? 1 : 0; // CUPS rawcspace[]: 0 sGray, 1 sRGB
  h[2] = meta.duplex === 'none' ? 1 : meta.duplex === 'short' ? 2 : 3;
  h[3] = meta.quality;
  h.writeUInt32BE(sheet.width, 12);
  h.writeUInt32BE(sheet.height, 16);
  h.writeUInt32BE(meta.dpi, 20);
  return [h, compressPage(sheet)];
}

// ---------- PWG ----------

export const PWG_SYNC = Buffer.from('RaS2', 'latin1');

function putString(h: Buffer, off: number, value: string, max = 64): void {
  h.write(value.slice(0, max - 1), off, 'latin1');
}

export function pwgPage(sheet: Sheet, meta: PageMeta): Buffer[] {
  const h = Buffer.alloc(1796);
  const u = (off: number, v: number) => h.writeUInt32BE(v >>> 0, off);
  const pointsW = Math.round(sheet.width * 72 / meta.dpi);
  const pointsH = Math.round(sheet.height * 72 / meta.dpi);
  putString(h, 0, 'PwgRaster');
  putString(h, 128, meta.mediaType);
  u(272, meta.duplex === 'none' ? 0 : 1);
  u(276, meta.dpi);
  u(280, meta.dpi);
  u(340, 1); // NumCopies; copies are expanded by the job engine
  u(352, pointsW);
  u(356, pointsH);
  u(368, meta.duplex === 'short' ? 1 : 0);
  u(372, sheet.width);
  u(376, sheet.height);
  u(384, 8);
  u(388, sheet.comp * 8);
  u(392, sheet.width * sheet.comp);
  u(396, 0); // chunky
  u(400, sheet.comp === 3 ? 19 : 18); // sRGB / sGray
  u(420, sheet.comp);
  u(452, meta.totalPages);
  u(456, 1); // CrossFeedTransform
  u(460, 1); // FeedTransform
  u(452 + 8 * 4, meta.quality); // cupsInteger[8] = PrintQuality
  putString(h, 1668, 'Auto');
  putString(h, 1732, meta.mediaName);
  return [h, compressPage(sheet)];
}

/** For printers whose raster types exclude 8-bit gray. */
export function grayToRgb(sheet: Sheet): Sheet {
  const data = Buffer.allocUnsafe(sheet.width * sheet.height * 3);
  for (let i = 0, j = 0; i < sheet.data.length; i++, j += 3) {
    const v = sheet.data[i];
    data[j] = v; data[j + 1] = v; data[j + 2] = v;
  }
  return { width: sheet.width, height: sheet.height, comp: 3, data };
}

// ---------- back-of-sheet transform for duplex raster ----------

export type SheetBack = 'normal' | 'flipped' | 'rotated' | 'manual-tumble';

/**
 * Returns [crossFeed, feed] flips the printer expects on even pages, per
 * cupsRasterInitPWGHeader. Duplex mechanisms physically invert the back side, and the
 * printer tells us how through pwg-raster-document-sheet-back.
 */
export function backTransform(sheetBack: SheetBack, duplex: 'long' | 'short'): [boolean, boolean] {
  const tumble = duplex === 'short';
  if (sheetBack === 'flipped') return tumble ? [true, false] : [false, true];
  if (sheetBack === 'manual-tumble') return tumble ? [true, true] : [false, false];
  if (sheetBack === 'rotated') return tumble ? [false, false] : [true, true];
  return [false, false];
}

export function flipSheet(sheet: Sheet, crossFeed: boolean, feed: boolean): void {
  const { width, height, comp, data } = sheet;
  const line = width * comp;
  if (feed) {
    const tmp = Buffer.allocUnsafe(line);
    for (let top = 0, bot = height - 1; top < bot; top++, bot--) {
      const a = top * line, b = bot * line;
      data.copy(tmp, 0, a, a + line);
      data.copy(data, a, b, b + line);
      tmp.copy(data, b);
    }
  }
  if (crossFeed) {
    for (let y = 0; y < height; y++) {
      const row = y * line;
      for (let l = 0, r = width - 1; l < r; l++, r--) {
        const a = row + l * comp, b = row + r * comp;
        for (let c = 0; c < comp; c++) {
          const t = data[a + c];
          data[a + c] = data[b + c];
          data[b + c] = t;
        }
      }
    }
  }
}

// ---------- PCL5 mono, for old lasers that speak nothing else ----------

const BAYER = [0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23, 2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21];

export function pclPage(sheet: Sheet, meta: PageMeta, pclPaperCode: number, first: boolean): Buffer[] {
  const { width, height, comp, data } = sheet;
  const lineBytes = (width + 7) >> 3;
  const parts: Buffer[] = [];
  const esc = (s: string) => Buffer.from(`\x1b${s}`, 'latin1');
  if (first) parts.push(esc('E'));
  parts.push(esc(`&l${pclPaperCode}A`), esc('&l0E'), esc(`*t${meta.dpi}R`), esc('*r1A'));
  const row = Buffer.alloc(lineBytes);
  for (let y = 0; y < height; y++) {
    row.fill(0);
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * comp;
      const lum = comp === 1 ? data[p] : (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
      const threshold = (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) * 4;
      if (lum < threshold) row[x >> 3] |= 0x80 >> (x & 7);
    }
    parts.push(esc(`*b${lineBytes}W`), Buffer.from(row));
  }
  parts.push(esc('*rB'), Buffer.from([0x0c]));
  return parts;
}

export function pclPaperCode(mediaName: string): number {
  if (/a4/i.test(mediaName)) return 26;
  if (/a5/i.test(mediaName)) return 25;
  if (/a3/i.test(mediaName)) return 27;
  if (/letter/i.test(mediaName)) return 2;
  if (/legal/i.test(mediaName)) return 3;
  if (/executive/i.test(mediaName)) return 1;
  return 26;
}

// ---------- decoders, used by the test suite to check round trips ----------

export function decodeRaster(stream: Buffer): { format: 'urf' | 'pwg'; declaredPages?: number; pages: (Sheet & { dpi: number; quality: number; duplexCode: number; mediaName?: string; header: Buffer })[] } {
  const pages: ReturnType<typeof decodeRaster>['pages'] = [];
  const isUrf = stream.toString('latin1', 0, 8) === 'UNIRAST\0';
  if (!isUrf && !stream.subarray(0, 4).equals(PWG_SYNC)) throw new Error('not a raster stream');
  let o = isUrf ? 12 : 4;
  while (o < stream.length) {
    let width: number, height: number, bits: number, dpi: number, quality: number, duplexCode: number, mediaName: string | undefined;
    const header = stream.subarray(o, o + (isUrf ? 32 : 1796));
    if (isUrf) {
      bits = header[0];
      duplexCode = header[2];
      quality = header[3];
      width = header.readUInt32BE(12);
      height = header.readUInt32BE(16);
      dpi = header.readUInt32BE(20);
      o += 32;
    } else {
      duplexCode = header.readUInt32BE(272);
      dpi = header.readUInt32BE(276);
      width = header.readUInt32BE(372);
      height = header.readUInt32BE(376);
      bits = header.readUInt32BE(388);
      quality = header.readUInt32BE(452 + 32);
      mediaName = header.toString('latin1', 1732, 1796).replace(/\0.*$/s, '');
      o += 1796;
    }
    const comp = (bits / 8) as 1 | 3;
    const line = width * comp;
    const data = Buffer.alloc(line * height);
    let y = 0;
    while (y < height) {
      const repeat = stream[o++] + 1;
      let x = 0;
      const start = y * line;
      while (x < line) {
        const c = stream[o++];
        if (c === 128) { data.fill(0xff, start + x, start + line); x = line; }
        else if (c < 128) {
          const count = (c + 1) * comp;
          for (let i = 0; i < count; i += comp) stream.copy(data, start + x + i, o, o + comp);
          o += comp;
          x += count;
        } else {
          const count = (257 - c) * comp;
          stream.copy(data, start + x, o, o + count);
          o += count;
          x += count;
        }
      }
      for (let r = 1; r < repeat; r++) data.copy(data, start + r * line, start, start + line);
      y += repeat;
    }
    pages.push({ width, height, comp, data, dpi, quality, duplexCode, mediaName, header });
  }
  return { format: isUrf ? 'urf' : 'pwg', declaredPages: isUrf ? stream.readUInt32BE(8) : undefined, pages };
}
