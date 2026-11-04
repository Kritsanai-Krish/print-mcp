import { escapeHtml } from './sources.js';

/** A calibration sheet. Light on ink, but shows alignment, color, gray and small type. */
export function testPageHtml(printerName: string, dpis: number[]): string {
  const ticks = Array.from({ length: 19 }, (_, i) => `<i style="left:${i * 10}mm"><b>${i * 10}</b></i>`).join('');
  const colorRamp = (name: string, c: string) => `<div class="row"><span>${name}</span><div class="bar" style="background:linear-gradient(90deg,#fff,${c})"></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Test page</title><style>
*{box-sizing:border-box}body{margin:0;font:10pt "Leelawadee UI",Tahoma,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:15pt;margin:0 0 1mm}.m{color:#444;font-size:8.5pt;margin:0 0 4mm}
.ruler{position:relative;height:9mm;border-top:.3mm solid #000;margin:0 0 4mm;width:180mm}.ruler i{position:absolute;top:0;width:.25mm;height:4mm;background:#000;font-style:normal}.ruler b{position:absolute;top:4.2mm;left:-2mm;font:7pt Consolas,monospace}
.row{display:flex;align-items:center;gap:3mm;margin:1mm 0}.row span{width:18mm;font-size:8pt}.bar{height:6mm;flex:1;border:.1mm solid #888}
h2{font-size:10.5pt;margin:4mm 0 1.5mm}
.lines{display:flex;gap:3mm;align-items:flex-end}.lines div{width:18mm;border-top-style:solid;border-top-color:#000;text-align:center;font-size:7pt;padding-top:1mm}
.dots{display:flex;gap:2mm}.dots div{width:16mm;height:16mm;font-size:7pt;display:flex;align-items:center;justify-content:center;color:#fff;border-radius:50%}
.sizes p{margin:.4mm 0;line-height:1.25}
</style></head><body>
<h1>Test page</h1>
<p class="m">${escapeHtml(printerName)} · ${dpis.join(', ')} dpi · ${new Date().toLocaleString()}</p>
<div class="ruler">${ticks}</div>
<h2>Line weights (mm)</h2>
<div class="lines">${[0.1, 0.2, 0.3, 0.5, 1, 2].map(t => `<div style="border-top-width:${t}mm">${t}</div>`).join('')}</div>
<h2>Color and gray</h2>
${colorRamp('Cyan', '#00aeef')}${colorRamp('Magenta', '#ec008c')}${colorRamp('Yellow', '#fff200')}${colorRamp('Black', '#000')}
<div class="row"><span>RGB</span><div class="bar" style="background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"></div></div>
<h2>Solids</h2>
<div class="dots">${[['#00aeef', 'C'], ['#ec008c', 'M'], ['#fff200', 'Y'], ['#000', 'K'], ['#d00', 'R'], ['#080', 'G'], ['#00c', 'B']].map(([c, l]) => `<div style="background:${c}">${l}</div>`).join('')}</div>
<h2>Text</h2>
<div class="sizes">${[6, 8, 10, 12, 16].map(s => `<p style="font-size:${s}pt">${s}pt \u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22 \u0E01\u0E48\u0E32 \u0E01\u0E49\u0E33 \u0E1B\u0E35\u0E48 \u0E0E\u0E35\u0E01\u0E32 \u0E24\u0E45\u0E29\u0E35 \u0E51\u0E52\u0E53 The quick brown fox 0123456789</p>`).join('')}</div>
</body></html>`;
}
