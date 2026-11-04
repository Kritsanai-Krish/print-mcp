import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { IppError, decodeResponse, deviceText, encodeRequest, kw, col, int, OP } from '../ipp.js';
import { backTransform, decodeRaster, flipSheet, pwgPage, PWG_SYNC, urfFileHeader, urfPage, type PageMeta, type Sheet } from '../raster.js';
import { hardwareMargins, makePlan, parsePaper, resolveMedia, selectPages, needsPixelWork } from '../options.js';
import { buildToneLut, computeLayout, drawFrame, isGrayscale, parseColor, placePage } from '../render.js';
import { chooseFormat } from '../jobs.js';
import { assertLocalPathAllowed, classifyBytes, decodeText, isInternalAddress, parseCsv, resolveLocalPath } from '../sources.js';
import { parseDns } from '../discovery.js';
import { capsFromAttributes, parseMediaKeyword, normalizeUuid, type PrinterRecord } from '../registry.js';

const meta: PageMeta = { dpi: 300, quality: 4, duplex: 'none', totalPages: 1, mediaName: 'iso_a4_210x297mm', mediaType: 'stationery' };

function roundTrip(sheet: Sheet, format: 'urf' | 'pwg') {
  const stream = format === 'urf'
    ? Buffer.concat([urfFileHeader(1), ...urfPage(sheet, meta)])
    : Buffer.concat([PWG_SYNC, ...pwgPage(sheet, meta)]);
  const out = decodeRaster(stream);
  assert.equal(out.format, format);
  assert.equal(out.pages.length, 1);
  assert.equal(out.pages[0].width, sheet.width);
  assert.equal(out.pages[0].height, sheet.height);
  assert.ok(out.pages[0].data.equals(sheet.data), `${format} pixels differ`);
  return { stream, page: out.pages[0] };
}

test('raster round trips every content shape, including incompressible noise', () => {
  for (const comp of [1, 3] as const) {
    const w = 257, h = 300;
    const shapes: Record<string, Buffer> = {
      white: Buffer.alloc(w * h * comp, 255),
      noise: randomBytes(w * h * comp),
      stripes: Buffer.from(Array.from({ length: w * h * comp }, (_, i) => (Math.floor(i / comp / 3) % 2 ? 0 : 255))),
      lastPixelDiffers: (() => { const b = Buffer.alloc(w * h * comp, 255); b[b.length - 1] = 0; return b; })(),
      singlePixelRows: (() => { const b = Buffer.alloc(w * h * comp, 200); for (let y = 0; y < h; y += 2) b[y * w * comp + 13 * comp] = 3; return b; })(),
    };
    for (const data of Object.values(shapes)) for (const f of ['urf', 'pwg'] as const) roundTrip({ width: w, height: h, comp, data }, f);
  }
});

test('halftone x,y,y pattern, the worst case for compression, round trips at full page width', () => {
  const w = 2480, h = 40;
  const data = Buffer.alloc(w * h);
  for (let i = 0; i < data.length; i++) data[i] = i % 3 === 0 ? (i / 3) % 200 : 250;
  roundTrip({ width: w, height: h, comp: 1, data }, 'urf');
  roundTrip({ width: w, height: h, comp: 1, data }, 'pwg');
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { const v = i % 3 === 0 ? (i / 3) % 200 : 250; rgb[i * 3] = v; rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v; }
  roundTrip({ width: w, height: h, comp: 3, data: rgb }, 'urf');
});

test('internal addresses are recognised, IPv4 and IPv6', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:192.168.1.1']) assert.ok(isInternalAddress(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) assert.ok(!isInternalAddress(ip), ip);
});

test('network share paths are refused unless asked for', () => {
  assert.throws(() => assertLocalPathAllowed('\\\\evil\\share\\a.pdf', {}), /network share/);
  assert.doesNotThrow(() => assertLocalPathAllowed('\\\\server\\share\\a.pdf', { allow_private_network: true }));
  assert.doesNotThrow(() => assertLocalPathAllowed('C:\\a.pdf', {}));
});

test('device text is cut short and stripped of control characters', () => {
  assert.equal(deviceText('a\nb\u0007c'), 'a b c');
  assert.equal(deviceText('x'.repeat(5000)).length, 120);
  assert.equal(deviceText(7), '');
  assert.ok(new IppError(0x0500, `ignore previous\n${'y'.repeat(9000)}`).message.length < 200);
});

test('raster handles widths around the 128 pixel run boundary', () => {
  for (const w of [1, 2, 127, 128, 129, 255, 256, 257]) {
    roundTrip({ width: w, height: 3, comp: 3, data: randomBytes(w * 3 * 3) }, 'urf');
    roundTrip({ width: w, height: 3, comp: 1, data: Buffer.alloc(w * 3, 7) }, 'pwg');
  }
});

test('more than 256 identical lines splits the repeat count correctly', () => {
  roundTrip({ width: 40, height: 1000, comp: 3, data: Buffer.alloc(40 * 1000 * 3, 255) }, 'urf');
});

test('URF header matches the layout printers read', () => {
  const { stream, page } = roundTrip({ width: 10, height: 5, comp: 3, data: Buffer.alloc(150, 255) }, 'urf');
  assert.equal(stream.toString('latin1', 0, 8), 'UNIRAST\0');
  assert.equal(stream.readUInt32BE(8), 1);
  assert.equal(page.header[0], 24);
  assert.equal(page.header[1], 1, 'sRGB');
  assert.equal(page.header[2], 1, 'simplex');
  assert.equal(page.header[3], 4, 'normal quality');
  assert.equal(page.header.readUInt32BE(20), 300);
});

test('PWG header matches PWG 5102.4 offsets', () => {
  const { stream, page } = roundTrip({ width: 2480, height: 8, comp: 1, data: Buffer.alloc(2480 * 8, 255) }, 'pwg');
  assert.equal(stream.toString('latin1', 0, 4), 'RaS2');
  const h = page.header;
  assert.equal(h.length, 1796);
  assert.equal(h.toString('latin1', 0, 9), 'PwgRaster');
  assert.equal(h.readUInt32BE(276), 300);
  assert.equal(h.readUInt32BE(372), 2480);
  assert.equal(h.readUInt32BE(384), 8);
  assert.equal(h.readUInt32BE(388), 8);
  assert.equal(h.readUInt32BE(392), 2480);
  assert.equal(h.readUInt32BE(400), 18, 'sGray');
  assert.equal(h.readUInt32BE(420), 1);
  assert.equal(page.mediaName, 'iso_a4_210x297mm');
});

test('duplex back transforms follow cupsRasterInitPWGHeader', () => {
  assert.deepEqual(backTransform('normal', 'long'), [false, false]);
  assert.deepEqual(backTransform('flipped', 'long'), [false, true]);
  assert.deepEqual(backTransform('flipped', 'short'), [true, false]);
  assert.deepEqual(backTransform('rotated', 'long'), [true, true]);
  assert.deepEqual(backTransform('rotated', 'short'), [false, false]);
  assert.deepEqual(backTransform('manual-tumble', 'short'), [true, true]);
});

test('flipSheet flips exactly', () => {
  const s: Sheet = { width: 2, height: 2, comp: 1, data: Buffer.from([1, 2, 3, 4]) };
  flipSheet(s, true, false);
  assert.deepEqual([...s.data], [2, 1, 4, 3]);
  flipSheet(s, false, true);
  assert.deepEqual([...s.data], [4, 3, 2, 1]);
});

test('IPP request encodes collections the decoder reads back', () => {
  const b = encodeRequest(OP.CreateJob, 7, 'ipp://x/ipp/print', [kw('which', 'a', 'b')], [col('media-col', [col('media-size', [int('x-dimension', 21000)]), int('media-top-margin', 300)])]);
  const d = decodeResponse(b);
  assert.equal(d.requestId, 7);
  assert.deepEqual(d.operation['which'], ['a', 'b']);
  const mc = d.jobs[0]['media-col'][0] as Record<string, Record<string, number> & number>;
  assert.equal(mc['media-size']['x-dimension'], 21000);
  assert.equal(mc['media-top-margin'], 300);
});

test('IPP decoder never crashes on hostile input: it throws or returns', () => {
  const good = encodeRequest(OP.GetPrinterAttributes, 1, 'ipp://x/', [kw('a', 'b')], [col('c', [int('d', 1)])]);
  for (let cut = 0; cut < good.length; cut++) {
    try { decodeResponse(good.subarray(0, cut)); } catch (e) { assert.ok(e instanceof Error); }
  }
  for (let i = 0; i < 3000; i++) {
    const noise = randomBytes(9 + (i % 400));
    try { decodeResponse(noise); } catch (e) { assert.ok(e instanceof Error); }
  }
  // A collection nested past the limit must be refused, not recurse until the stack dies.
  const deep = Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, 1]), ...Array.from({ length: 50000 }, () => Buffer.from([0x34, 0, 0, 0, 0]))]);
  assert.throws(() => decodeResponse(deep));
  // Prototype keys from a device must stay inert.
  const evil = encodeRequest(1, 1, 'x', [kw('__proto__', 'polluted')]);
  decodeResponse(evil);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('DNS parser survives pointer loops and truncation', () => {
  const loop = Buffer.alloc(40);
  loop.writeUInt16BE(1, 6);
  loop[12] = 0xc0; loop[13] = 12;
  assert.throws(() => parseDns(loop));
  for (let i = 0; i < 2000; i++) {
    try { parseDns(randomBytes(12 + (i % 200))); } catch (e) { assert.ok(e instanceof Error); }
  }
});

test('page ranges', () => {
  const sel = (s?: string, set?: 'odd' | 'even', rev?: boolean, n = 10) => selectPages(s, set, rev, n).map(i => i + 1);
  assert.deepEqual(sel(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(sel('1-3,5,last'), [1, 2, 3, 5, 10]);
  assert.deepEqual(sel('10-8'), [10, 9, 8]);
  assert.deepEqual(sel('-1'), [10]);
  assert.deepEqual(sel('-3--1'), [8, 9, 10]);
  assert.deepEqual(sel('last-1'), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(sel(undefined, 'odd'), [1, 3, 5, 7, 9]);
  assert.deepEqual(sel(undefined, 'even', true), [10, 8, 6, 4, 2]);
  assert.throws(() => sel('11'), /out of range/);
  assert.throws(() => sel('0'), /out of range/);
  assert.throws(() => sel('abc'), /Cannot read/);
  assert.throws(() => sel('1-99'), /out of range/);
});

test('paper names', () => {
  assert.deepEqual(parsePaper('A4'), { widthMm: 210, heightMm: 297 });
  assert.deepEqual(parsePaper('100x150mm'), { widthMm: 100, heightMm: 150 });
  assert.deepEqual(parsePaper('150 x 100 mm'), { widthMm: 100, heightMm: 150 });
  assert.deepEqual(parsePaper('4x6in'), { widthMm: 101.6, heightMm: 152.4 });
  assert.equal(parsePaper('4x6').widthMm, 101.6);
  assert.throws(() => parsePaper('banana'));
  assert.throws(() => parsePaper('1x1mm'));
});

const brother = (): PrinterRecord => ({
  id: 'b', name: 'Brother', virtual: false, lastSeen: 0,
  ipp: {
    host: '192.168.1.123', port: 631, path: '/ipp/print', tls: false,
    caps: capsFromAttributes({
      'media-supported': ['iso_a4_210x297mm', 'iso_a5_148x210mm', 'custom_min_88.9x127mm', 'custom_max_215.9x355.6mm'],
      'media-ready': ['iso_a4_210x297mm'],
      'media-col-database': [
        { 'media-size': { 'x-dimension': 21000, 'y-dimension': 29700 }, 'media-top-margin': 300, 'media-bottom-margin': 300, 'media-left-margin': 300, 'media-right-margin': 300 },
        { 'media-size': { 'x-dimension': 21000, 'y-dimension': 29700 }, 'media-top-margin': 0, 'media-bottom-margin': 0, 'media-left-margin': 0, 'media-right-margin': 0 },
      ],
      'sides-supported': ['one-sided'], 'color-supported': [true], 'urf-supported': ['RS300-600'],
    }),
  },
});

test('media resolution, custom range, and refusal', () => {
  const p = brother();
  const w: string[] = [];
  assert.equal(resolveMedia(p, undefined, w).keyword, 'iso_a4_210x297mm');
  assert.equal(resolveMedia(p, 'A5', w).keyword, 'iso_a5_148x210mm');
  assert.match(w[0], /loaded/, 'warns when loaded paper differs');
  assert.ok(resolveMedia(p, '100x150mm', []).custom);
  assert.throws(() => resolveMedia(p, 'A3', []), /does not take/);
});

test('hardware margins come from the printer, and borderless needs a zero set', () => {
  const p = brother();
  const media = resolveMedia(p, 'A4', []);
  const hw = hardwareMargins(p, media);
  assert.equal(hw.margins.top, 3);
  assert.equal(hw.borderlessOk, true);
  const a5 = hardwareMargins(p, resolveMedia(p, 'A5', []));
  assert.equal(a5.borderlessOk, false);
});

test('plan degrades with warnings instead of silently ignoring', () => {
  const p = brother();
  const dup = makePlan(p, { duplex: 'long' });
  assert.equal(dup.duplex, 'none');
  assert.match(dup.warnings.join(), /two-sided/);
  const big = makePlan(p, { dpi: 1200 });
  assert.equal(big.dpi, 600);
  assert.match(big.warnings.join(), /supports/);
  const bl = makePlan(p, { paper: 'A5', borderless: true });
  assert.equal(bl.borderless, false);
  assert.match(bl.warnings.join(), /no borderless/);
  assert.equal(makePlan(p, { quality: 'high' }).dpi, 600);
  assert.equal(makePlan(p, {}).dpi, 300);
});

test('layout clamps margins to hardware, warns, and rejects impossible ones', () => {
  const p = brother();
  const plan = makePlan(p, { margin_mm: 1 });
  const l = computeLayout(plan, {}, false);
  assert.equal(l.box.x, Math.round(3 * 300 / 25.4));
  assert.match(plan.warnings.join(), /hardware margin/);
  const none = makePlan(p, { borderless: true });
  assert.equal(computeLayout(none, {}, false).box.x, 0);
  assert.throws(() => computeLayout(makePlan(p, { margin_mm: 150 }), {}, false), /no room/);
});

test('n-up grid follows the long edge', () => {
  const p = brother();
  const two = computeLayout(makePlan(p, {}), { n_up: 2 }, false);
  assert.equal(two.landscape, true);
  assert.deepEqual([two.cols, two.rows], [2, 1]);
  const four = computeLayout(makePlan(p, {}), { n_up: 4 }, false);
  assert.equal(four.landscape, false);
  assert.deepEqual([four.cols, four.rows], [2, 2]);
  const six = computeLayout(makePlan(p, {}), { n_up: 6 }, false);
  assert.deepEqual([six.cols, six.rows], [3, 2]);
});

test('frame reduces the content box by its thickness and gap', () => {
  const p = brother();
  const plain = computeLayout(makePlan(p, {}), {}, false);
  const framed = computeLayout(makePlan(p, {}), { border_mm: 2, border_gap_mm: 1 }, false);
  assert.equal(framed.frame?.thickness, Math.round(2 * 300 / 25.4));
  assert.equal(framed.box.x - plain.box.x, Math.round(6 * 300 / 25.4) - Math.round(3 * 300 / 25.4));
});

test('placePage centres, respects aspect, and rotates inside the cell', () => {
  const cell = { x: 100, y: 100, w: 1000, h: 1000 };
  const fit = placePage([0, 0, 100, 200], cell, {}, 300, 0);
  assert.equal(fit.clip.h, 1000);
  assert.equal(fit.clip.w, 500);
  assert.equal(fit.clip.x, 350);
  const rot = placePage([0, 0, 100, 200], cell, {}, 300, 90);
  assert.equal(rot.clip.w, 1000);
  assert.equal(rot.clip.h, 500);
  const fill = placePage([0, 0, 100, 200], cell, { scale: 'fill' }, 300, 0);
  assert.deepEqual(fill.clip, cell, 'fill is clipped to the cell');
  const actual = placePage([0, 0, 72, 72], cell, { scale: 'actual' }, 300, 0);
  assert.equal(actual.clip.w, 300, '1 inch at 300 dpi');
  const left = placePage([0, 0, 72, 72], cell, { scale: 'actual', align: 'top-left' }, 300, 0);
  assert.deepEqual([left.clip.x, left.clip.y], [100, 100]);
});

test('tone: neutral settings stay off, darkness darkens, black and white keep their ends', () => {
  assert.equal(buildToneLut({}), null);
  const dark = buildToneLut({ darkness: 50 })!;
  assert.ok(dark[128] < 128);
  assert.equal(dark[255], 255);
  assert.equal(dark[0], 0);
  const light = buildToneLut({ darkness: -50 })!;
  assert.ok(light[128] > 128);
  assert.equal(buildToneLut({ invert: true })![0], 255);
  const saver = buildToneLut({ ink_saver: 50 })!;
  assert.equal(saver[0], 128);
  assert.equal(saver[255], 255);
});

test('frame pixels land exactly where asked', () => {
  const s: Sheet = { width: 100, height: 100, comp: 3, data: Buffer.alloc(30000, 255) };
  drawFrame(s, { x: 10, y: 10, w: 80, h: 80 }, 4, [255, 0, 0], 'solid');
  const at = (x: number, y: number) => [...s.data.subarray((y * 100 + x) * 3, (y * 100 + x) * 3 + 3)];
  assert.deepEqual(at(10, 10), [255, 0, 0]);
  assert.deepEqual(at(13, 50), [255, 0, 0]);
  assert.deepEqual(at(14, 50), [255, 255, 255]);
  assert.deepEqual(at(89, 89), [255, 0, 0]);
  assert.deepEqual(at(90, 90), [255, 255, 255]);
});

test('gray detection tolerates JPEG noise but not real color', () => {
  assert.ok(isGrayscale(Buffer.from([10, 12, 11, 200, 200, 203])));
  assert.ok(!isGrayscale(Buffer.from([10, 10, 10, 200, 100, 200])));
});

test('colors', () => {
  assert.deepEqual(parseColor('#ff0000', [0, 0, 0]), [255, 0, 0]);
  assert.deepEqual(parseColor('f00', [0, 0, 0]), [255, 0, 0]);
  assert.deepEqual(parseColor('blue', [0, 0, 0]), [0, 60, 220]);
  assert.throws(() => parseColor('nope', [0, 0, 0]));
});

test('format choice obeys capability, preference and passthrough', () => {
  const brotherFormats = ['application/octet-stream', 'image/urf', 'image/jpeg', 'image/pwg-raster'];
  assert.equal(chooseFormat(brotherFormats, 'image/urf', true), 'image/urf', 'no PDF support, so raster even when passthrough is possible');
  assert.equal(chooseFormat(['image/pwg-raster', 'application/pdf'], undefined, true), 'application/pdf');
  assert.equal(chooseFormat(['image/pwg-raster', 'application/pdf'], undefined, false), 'image/pwg-raster');
  assert.equal(chooseFormat(['application/pdf'], undefined, false), 'pdf-image');
  assert.equal(chooseFormat(['application/vnd.hp-PCL'], undefined, false), 'application/vnd.hp-PCL');
  assert.equal(chooseFormat(['image/jpeg'], undefined, false), 'image/jpeg');
  assert.equal(chooseFormat(['text/plain'], undefined, false), null);
});

test('pixel-free jobs may pass PDFs straight through', () => {
  assert.equal(needsPixelWork({}), false);
  assert.equal(needsPixelWork({ copies: 3, quality: 'high' }), false);
  assert.ok(needsPixelWork({ border_mm: 1 }));
  assert.ok(needsPixelWork({ pages: '1' }));
  assert.ok(needsPixelWork({ margin_mm: 0 }), 'zero is an explicit request');
});

test('file classification trusts content over the extension', () => {
  assert.equal(classifyBytes(Buffer.from('%PDF-1.7'), '.txt'), 'pdf');
  assert.equal(classifyBytes(Buffer.from([0xff, 0xd8, 0xff]), '.pdf'), 'image');
  assert.equal(classifyBytes(Buffer.from('PK\x03\x04'), '.docx'), 'office');
  assert.equal(classifyBytes(Buffer.from('PK\x03\x04'), '.epub'), 'mupdf');
  assert.equal(classifyBytes(Buffer.from('PK\x03\x04'), '.zip'), null, 'an arbitrary zip is not printable');
  assert.equal(classifyBytes(Buffer.from([0, 1, 2, 0, 9]), '.bin'), null);
  assert.equal(classifyBytes(Buffer.from('# hi'), '.md'), 'markdown');
  assert.equal(classifyBytes(Buffer.from('a,b'), '.csv'), 'csv');
  assert.equal(classifyBytes(Buffer.from('hello'), ''), 'text');
  assert.equal(classifyBytes(Buffer.from('{\\rtf1'), '.dat'), 'office');
});

test('text decoding: UTF-8, UTF-16 and legacy Thai', () => {
  assert.equal(decodeText(Buffer.from('\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35')), '\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35');
  assert.equal(decodeText(Buffer.from([0xff, 0xfe, ...Buffer.from('\u0E44\u0E17\u0E22', 'utf16le')])), '\u0E44\u0E17\u0E22');
  assert.equal(decodeText(Buffer.from([0xca, 0xc7, 0xd1, 0xca, 0xb4, 0xd5])), '\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35', 'TIS-620');
});

test('CSV: quotes, embedded separators and newlines', () => {
  assert.deepEqual(parseCsv('a,"b,c"\n"d""e","f\ng"\n\n', ','), [['a', 'b,c'], ['d"e', 'f\ng']]);
});

test('path resolution: quotes, env vars, file URLs', () => {
  process.env.PRINT_TEST_DIR = 'C:\\tmp';
  assert.match(resolveLocalPath('"%PRINT_TEST_DIR%\\a.pdf"'), /tmp[\\/]a\.pdf$/i);
  assert.match(resolveLocalPath('file:///C:/x%20y/a.pdf'), /x y[\\/]a\.pdf$/);
});

test('media keywords and uuid normalization', () => {
  assert.deepEqual(parseMediaKeyword('iso_a4_210x297mm'), { keyword: 'iso_a4_210x297mm', widthMm: 210, heightMm: 297 });
  assert.equal(parseMediaKeyword('na_letter_8.5x11in')!.widthMm, 215.9);
  assert.equal(parseMediaKeyword('weird'), null);
  assert.equal(normalizeUuid('urn:uuid:ABCD8000-80CE-11DB-8000-001122334455'), 'abcd8000-80ce-11db-8000-001122334455');
  assert.equal(normalizeUuid('nope'), undefined);
});
