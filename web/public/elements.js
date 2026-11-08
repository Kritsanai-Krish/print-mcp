// Elements library: shapes, lines, icons, emoji, QR, barcode, tables, a printable ruler. One search box over all of it.
const fillCol = '#2f55c9';
const star = (n, ri, ro = 46, c = 50) => 'M' + Array.from({ length: n * 2 }, (_, i) => { const a = (Math.PI / n) * i - Math.PI / 2, r = i % 2 ? ri : ro; return `${(c + r * Math.cos(a)).toFixed(1)} ${(c + r * Math.sin(a)).toFixed(1)}`; }).join('L') + 'Z';

// Every shape is a path in a 100 x 100 box: the same string draws the picker preview and the real object.
export const SHAPES = [
  ['สี่เหลี่ยมผืนผ้า', 'rect rectangle box', 'M8 22H92V78H8Z'], ['สี่เหลี่ยมจัตุรัส', 'square', 'M18 18H82V82H18Z'],
  ['สี่เหลี่ยมมุมมน', 'rounded rectangle', 'M20 22H80A12 12 0 0 1 92 34V66A12 12 0 0 1 80 78H20A12 12 0 0 1 8 66V34A12 12 0 0 1 20 22Z'],
  ['วงกลม', 'circle', 'M50 10A40 40 0 1 1 50 90A40 40 0 1 1 50 10Z'], ['วงรี', 'ellipse oval', 'M50 24A42 26 0 1 1 50 76A42 26 0 1 1 50 24Z'],
  ['วงแหวน', 'ring donut', 'M50 8A42 42 0 1 1 50 92A42 42 0 1 1 50 8ZM50 28A22 22 0 1 0 50 72A22 22 0 1 0 50 28Z', 'evenodd'],
  ['สามเหลี่ยม', 'triangle', 'M50 12L92 86H8Z'], ['สามเหลี่ยมมุมฉาก', 'right triangle', 'M12 12V88H88Z'], ['สี่เหลี่ยมขนมเปียกปูน', 'diamond rhombus', 'M50 8L92 50L50 92L8 50Z'],
  ['ห้าเหลี่ยม', 'pentagon', 'M50 8L92 38L76 88H24L8 38Z'], ['หกเหลี่ยม', 'hexagon', 'M27 12H73L96 50L73 88H27L4 50Z'], ['แปดเหลี่ยม', 'octagon', 'M31 8H69L92 31V69L69 92H31L8 69V31Z'],
  ['สี่เหลี่ยมด้านขนาน', 'parallelogram', 'M28 24H94L72 76H6Z'], ['สี่เหลี่ยมคางหมู', 'trapezoid', 'M26 24H74L94 76H6Z'],
  ['ดาว 5 แฉก', 'star', star(5, 19)], ['ดาว 4 แฉก', 'star sparkle', star(4, 14)], ['ดาว 6 แฉก', 'star', star(6, 24)], ['ดาวระเบิด', 'burst starburst badge', star(14, 36)], ['ตราประทับ', 'seal badge rosette', star(20, 40)],
  ['หัวใจ', 'heart love', 'M50 88C20 66 8 48 8 32C8 18 18 10 30 10C40 10 47 16 50 24C53 16 60 10 70 10C82 10 92 18 92 32C92 48 80 66 50 88Z'],
  ['เครื่องหมายบวก', 'plus cross add', 'M38 10H62V38H90V62H62V90H38V62H10V38H38Z'], ['ติ๊กถูก', 'check tick correct', 'M10 54L22 42L40 60L78 20L90 32L40 84Z'],
  ['ลูกศรขวา', 'arrow right', 'M8 38H56V16L94 50L56 84V62H8Z'], ['ลูกศรซ้าย', 'arrow left', 'M92 38H44V16L6 50L44 84V62H92Z'], ['ลูกศรขึ้น', 'arrow up', 'M38 92V44H16L50 6L84 44H62V92Z'], ['ลูกศรลง', 'arrow down', 'M38 8V56H16L50 94L84 56H62V8Z'],
  ['เชฟรอน', 'chevron', 'M18 10H52L86 50L52 90H18L52 50Z'], ['บอลลูนข้อความ', 'speech bubble chat', 'M14 12H86A8 8 0 0 1 94 20V62A8 8 0 0 1 86 70H44L24 90V70H14A8 8 0 0 1 6 62V20A8 8 0 0 1 14 12Z'],
  ['เมฆ', 'cloud', 'M28 78A20 20 0 0 1 24 38A24 24 0 0 1 70 30A22 22 0 0 1 76 78Z'], ['พระจันทร์เสี้ยว', 'crescent moon', 'M62 8A42 42 0 1 0 62 92A32 32 0 1 1 62 8Z'], ['ครึ่งวงกลม', 'semicircle', 'M8 70A42 42 0 0 1 92 70Z'],
  ['ริบบิ้น', 'ribbon banner', 'M6 24H94L82 50L94 76H6L18 50Z'], ['ป้ายราคา', 'tag label price', 'M8 20H64L94 50L64 80H8Z'], ['สายฟ้า', 'lightning bolt', 'M56 6L20 56H44L36 94L80 40H54Z'], ['หยดน้ำ', 'drop water', 'M50 8C30 34 18 50 18 64A32 32 0 0 0 82 64C82 50 70 34 50 8Z'],
];

export const ICONS = [
  ['บ้าน', 'home house', 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6'], ['ผู้ใช้', 'user person', 'M4 21a8 8 0 0 1 16 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  ['กลุ่มคน', 'users people team', 'M2 21a7 7 0 0 1 14 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 7M22 21a6 6 0 0 0-4-5.6'],
  ['โทรศัพท์', 'phone call', 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'], ['อีเมล', 'mail email', 'M3 6h18v12H3zM3 7l9 7 9-7'],
  ['ที่อยู่', 'map pin location', 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5'], ['ปฏิทิน', 'calendar date', 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4'],
  ['นาฬิกา', 'clock time', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2'], ['กล้อง', 'camera photo', 'M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  ['ดาว', 'star favorite', 'M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1-4.5-4.3 6.1-.8z'], ['หัวใจ', 'heart love', 'M12 20S4 14.5 4 9a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 5.5-8 11-8 11z'],
  ['ถูกต้อง', 'check ok done', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 12l3 3 5-6'], ['ผิด', 'cross wrong close', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9 9l6 6M15 9l-6 6'],
  ['ข้อมูล', 'info', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v6M12 7.5v.01'], ['ลูกศรขวา', 'arrow right next', 'M4 12h16M14 6l6 6-6 6'], ['ลูกศรซ้าย', 'arrow left back', 'M20 12H4M10 6l-6 6 6 6'],
  ['ลูกศรขึ้น', 'arrow up', 'M12 20V4M6 10l6-6 6 6'], ['ลูกศรลง', 'arrow down', 'M12 4v16M6 14l6 6 6-6'], ['ของขวัญ', 'gift present', 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10 3 8 4.5 9 7 12 7s4-1.5 3-3-3 3-3 3'],
  ['ถ้วยรางวัล', 'trophy award win', 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M9 18h6'], ['ธง', 'flag', 'M5 21V4M5 4h12l-2 4 2 4H5'],
  ['โลก', 'globe world web', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'], ['เมฆ', 'cloud', 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z'],
  ['ร่ม', 'umbrella rain', 'M3 12a9 9 0 0 1 18 0zM12 12v7a2 2 0 0 0 4 0'], ['กาแฟ', 'coffee cup drink', 'M4 8h13v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM17 10h2a2 2 0 0 1 0 4h-2M8 3v2M12 3v2'],
  ['รถยนต์', 'car vehicle', 'M3 16v-4l2-5h14l2 5v4zM3 16v2M21 16v2M6 12h12M7 14h.01M17 14h.01'], ['หนังสือ', 'book read', 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3'],
  ['ดินสอ', 'pencil edit write', 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4'], ['กรรไกร', 'scissors cut', 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M8.5 7.5L20 18M8.5 16.5L20 6'],
  ['กุญแจ', 'key', 'M7 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8M10 11h11M18 11v4M14 11v3'], ['แม่กุญแจ', 'lock secure', 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4'],
  ['ไวไฟ', 'wifi wireless', 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01'], ['แชร์', 'share upload', 'M4 12v7h16v-7M12 16V3M7 8l5-5 5 5'],
  ['ตะกร้า', 'cart shopping', 'M3 4h3l2 12h10l2-8H7M9 20.5v.01M17 20.5v.01'], ['บัตรเครดิต', 'credit card pay', 'M3 6h18v12H3zM3 10h18'], ['ป้ายราคา', 'tag price', 'M3 3h8l10 10-8 8L3 11zM7.5 7.5v.01'],
  ['ที่คั่นหนังสือ', 'bookmark', 'M6 3h12v18l-6-4-6 4z'], ['ถูกใจ', 'thumbs up like', 'M7 11v10H3V11zM7 11l4-8a2 2 0 0 1 3 2l-1 4h6a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 1.5H7'],
  ['ยิ้ม', 'smile happy face', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 14s1.5 2 4 2 4-2 4-2M9 9.5v.01M15 9.5v.01'], ['ฟ้าแลบ', 'zap lightning energy', 'M13 2L4 14h7l-1 8 9-12h-7z'],
  ['ไฟ', 'flame fire hot', 'M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7'], ['ใบไม้', 'leaf eco nature', 'M4 20C4 10 10 4 20 4c0 10-6 16-16 16M4 20l8-8'],
  ['ดนตรี', 'music note', 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3M20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3'], ['ค้นหา', 'search find', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M21 21l-4.3-4.3'],
  ['ถังขยะ', 'trash delete', 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'], ['เครื่องพิมพ์', 'printer', 'M6 9V3h12v6M6 14H4a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2M6 14h12v7H6z'],
];

const EMOJI = '😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😋😎🤩🥳😏😴🤔🤗😢😭😡🤯😱🥺🙄👍👎👏🙌🙏💪👋✌️🤝👌☝️👉👈❤️🧡💛💚💙💜🖤🤍💔💕💖✨⭐🌟💫🔥💥🎉🎊🎁🎈🎂🍰🍕🍔🍟🌭🍜🍣🍩🍪🍎🍌🍇🍓🍉☕🍵🥤🍺🌸🌹🌻🌈☀️🌙⛅☁️❄️⚡🌊🌳🌴🍀🐶🐱🐭🐰🦊🐻🐼🦁🐸🐵🦋🐢🐟🚗🚕🚌🚲✈️🚀⛵🏠🏫🏥🏪📱💻🖨️📷📚✏️📌📎✂️🔑🔒💡⏰📅💰💳🛒🏆🥇🎯🎵🎶⚽🏀🎮✅❌⚠️❓❗➕➖➡️⬅️⬆️⬇️♻️©️®️™️'.match(/\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}️?)*|✅|❌/gu) ?? [];

let libs = {};
const loadScript = src => libs[src] ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('โหลด ' + src + ' ไม่ได้')); document.head.append(s); });
const utf8Latin1 = t => String.fromCharCode(...new TextEncoder().encode(t));

export function installElements(S) {
  const { fabric, h, icon, place, pop, closePops, toast, pw, ph, PX } = S;
  const mkShape = ([, , d, rule]) => { const o = new fabric.Path(d, { fill: fillCol, strokeWidth: 0, fillRule: rule ?? 'nonzero' }); o.scaleToWidth(220); return o; };
  const mkIcon = ([, , d]) => { const o = new fabric.Path(d, { fill: '', stroke: '#111827', strokeWidth: 1.8, strokeLineCap: 'round', strokeLineJoin: 'round' }); o.scaleToWidth(110); return o; };
  const LINES = [
    ['เส้นตรง', 'line', () => new fabric.Line([0, 0, 280, 0], { stroke: '#111827', strokeWidth: 4, strokeLineCap: 'round' }), 'M4 50H96'],
    ['เส้นประ', 'dashed line', () => new fabric.Line([0, 0, 280, 0], { stroke: '#111827', strokeWidth: 3, strokeDashArray: [12, 9], strokeLineCap: 'round' }), 'M4 50H96', '10 8'],
    ['เส้นจุด', 'dotted line', () => new fabric.Line([0, 0, 280, 0], { stroke: '#111827', strokeWidth: 5, strokeDashArray: [1, 11], strokeLineCap: 'round' }), 'M4 50H96', '1 9'],
    ['ลูกศร', 'arrow', () => new fabric.Path('M 0 0 L 260 0 M 228 -24 L 260 0 L 228 24', { stroke: '#111827', strokeWidth: 5, fill: '', strokeLineCap: 'round', strokeLineJoin: 'round' }), 'M6 50H92M70 30L92 50L70 70'],
    ['ลูกศรสองทาง', 'double arrow', () => new fabric.Path('M 32 -24 L 0 0 L 32 24 M 0 0 L 260 0 M 228 -24 L 260 0 L 228 24', { stroke: '#111827', strokeWidth: 5, fill: '', strokeLineCap: 'round', strokeLineJoin: 'round' }), 'M8 50H92M28 30L8 50L28 70M72 30L92 50L72 70'],
    ['เส้นโค้ง', 'curve wave', () => new fabric.Path('M 0 40 Q 50 -10 100 40 T 200 40 T 300 40', { stroke: '#111827', strokeWidth: 4, fill: '', strokeLineCap: 'round' }), 'M4 50Q27 20 50 50T96 50'],
    ['ซิกแซก', 'zigzag', () => new fabric.Path('M 0 24 L 30 0 L 60 24 L 90 0 L 120 24 L 150 0 L 180 24 L 210 0 L 240 24', { stroke: '#111827', strokeWidth: 4, fill: '', strokeLineJoin: 'round', strokeLineCap: 'round' }), 'M4 62L22 38L40 62L58 38L76 62L94 38'],
  ];

  async function addQr(text) {
    await loadScript('vendor/qrcode.js'); const qr = window.qrcode(0, 'M'); qr.addData(utf8Latin1(text)); qr.make();
    const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = await fabric.FabricImage.fromURL('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)); img.set({ name: 'QR: ' + text.slice(0, 20) }); img.scaleToWidth(150); place(img);
  }
  async function addBarcode(text, format) {
    await loadScript('vendor/jsbarcode.min.js'); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    try { window.JsBarcode(svg, text, { format, displayValue: true, fontSize: 18, margin: 8, height: 70 }); } catch { throw new Error(`ข้อมูลนี้สร้างบาร์โค้ด ${format} ไม่ได้ ตรวจจำนวนหลัก/ตัวอักษร`); }
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const img = await fabric.FabricImage.fromURL('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))); img.set({ name: 'บาร์โค้ด: ' + text }); img.scaleToWidth(260); place(img);
  }
  function addTable(rows, cols) {
    const cw = Math.min(110, (pw() - 120) / cols), chh = 44, parts = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      parts.push(new fabric.Rect({ left: c * cw, top: r * chh, width: cw, height: chh, fill: r === 0 ? '#e8edfb' : '#ffffff', stroke: '#9aa3b2', strokeWidth: 1, strokeUniform: true }));
      parts.push(new fabric.Textbox(r === 0 ? 'หัวข้อ' : '', { left: c * cw + 6, top: r * chh + 10, width: cw - 12, fontSize: 16, fontFamily: 'Leelawadee UI', fill: '#111827', fontWeight: r === 0 ? 'bold' : 'normal' }));
    }
    const g = new fabric.Group(parts, { subTargetCheck: true, interactive: true, name: `ตาราง ${rows}×${cols}` }); place(g);
  }
  function addRuler(cm) {
    const parts = [new fabric.Rect({ left: 0, top: 0, width: cm * 10 * PX, height: 14 * PX / 3.78 * 3.78 / 1, fill: '#fffbe6', stroke: '#111827', strokeWidth: 1, strokeUniform: true })];
    for (let i = 0; i <= cm * 10; i++) { const x = i * PX, big = i % 10 === 0, mid = i % 5 === 0; parts.push(new fabric.Line([x, 0, x, (big ? 8 : mid ? 6 : 4) * PX], { stroke: '#111827', strokeWidth: big ? 1.5 : 1 })); if (big && i < cm * 10) parts.push(new fabric.Text(String(i / 10), { left: x + 2, top: 8.5 * PX, fontSize: 13, fontFamily: 'Plex Mono, monospace', fill: '#111827' })); }
    const g = new fabric.Group(parts, { name: `ไม้บรรทัด ${cm} ซม.` }); place(g);
  }

  const group = (name, items) => ({ name, items });
  const tools = [
    ['QR โค้ด', 'qr code scan link', () => ask('QR โค้ด', 'ข้อความหรือลิงก์ที่จะใส่ใน QR', 'https://', t => addQr(t)), 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM19 14v6M14 20h3', 'stroke'],
    ['บาร์โค้ด', 'barcode code128 ean', () => askBarcode(), 'M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14', 'stroke'],
    ['ตาราง 3×3', 'table grid', () => addTable(3, 3), 'M4 5h16v14H4zM4 10h16M4 15h16M9.5 5v14M14.5 5v14', 'stroke'],
    ['ตาราง 5×4', 'table grid big', () => addTable(5, 4), 'M4 4h16v16H4zM4 8h16M4 12h16M4 16h16M8 4v16M12 4v16M16 4v16', 'stroke'],
    ['ไม้บรรทัด 15 ซม.', 'ruler measure calibrate', () => addRuler(15), 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2', 'stroke'],
    ['ไม้บรรทัด 10 ซม.', 'ruler measure', () => addRuler(10), 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2', 'stroke'],
  ];
  function ask(title, ph, def, fn) {
    const i = h('input.input', { value: def, placeholder: ph, 'aria-label': ph });
    const m = S.modal(title, i, close => [h('button.btn', { onclick: close }, 'ยกเลิก'), h('button.btn.primary', { onclick: async () => { const v = i.value.trim(); if (!v) return; close(); try { await fn(v); } catch (e) { toast(e.message, 'bad'); } } }, 'สร้าง')]);
  }
  function askBarcode() {
    const i = h('input.input', { placeholder: 'ตัวเลขหรือข้อความ เช่น 8851234567890' }); let fmt = 'CODE128';
    const sg = h('div.seg', {}, [['CODE128', 'ทั่วไป'], ['EAN13', 'EAN-13'], ['CODE39', 'Code 39']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(fmt === k), onclick: e => { fmt = k; e.target.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.target))); } }, t)));
    S.modal('บาร์โค้ด', h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, i, sg), close => [h('button.btn', { onclick: close }, 'ยกเลิก'), h('button.btn.primary', { onclick: async () => { const v = i.value.trim(); if (!v) return; close(); try { await addBarcode(v, fmt); } catch (e) { toast(e.message, 'bad'); } } }, 'สร้าง')]);
  }

  const items = [
    ...SHAPES.map(s => ({ cat: 'shape', name: s[0], kw: s[1], prev: `<path d="${s[2]}" fill="currentColor" fill-rule="${s[3] ?? 'nonzero'}"/>`, vb: '0 0 100 100', make: () => place(mkShape(s)) })),
    ...LINES.map(l => ({ cat: 'line', name: l[0], kw: l[1], prev: `<path d="${l[3]}" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" ${l[4] ? `stroke-dasharray="${l[4]}"` : ''}/>`, vb: '0 0 100 100', make: () => place(l[2]()) })),
    ...ICONS.map(i => ({ cat: 'icon', name: i[0], kw: i[1], prev: `<path d="${i[2]}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`, vb: '0 0 24 24', make: () => place(mkIcon(i)) })),
    ...tools.map(t => ({ cat: 'tool', name: t[0], kw: t[1], prev: `<path d="${t[3]}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`, vb: '0 0 24 24', make: t[2] })),
    ...EMOJI.map(e => ({ cat: 'emoji', name: e, kw: 'emoji sticker สติกเกอร์ อีโมจิ', emoji: e, make: () => { const o = new fabric.Textbox(e, { fontSize: 110, fontFamily: '"Segoe UI Emoji","Noto Color Emoji","Apple Color Emoji",sans-serif', width: 150, textAlign: 'center', name: 'อีโมจิ' }); place(o); } })),
  ];
  const CATS = [['all', 'ทั้งหมด'], ['shape', 'รูปร่าง'], ['line', 'เส้น'], ['icon', 'ไอคอน'], ['emoji', 'อีโมจิ'], ['tool', 'QR · ตาราง']];
  let q = '', cat = 'all';

  function elementsPop(a) {
    const grid = h('div.elgrid'), input = h('input.input', { type: 'search', placeholder: 'ค้นหา เช่น หัวใจ ลูกศร โทรศัพท์ qr', 'aria-label': 'ค้นหาองค์ประกอบ', value: q, oninput: () => { q = input.value; draw(); } });
    const tabs = h('div.chips', {}, CATS.map(([k, t]) => h('button.chip', { type: 'button', 'aria-pressed': String(cat === k), onclick: e => { cat = k; e.currentTarget.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); draw(); } }, t)));
    const draw = () => {
      const t = q.trim().toLowerCase(); const hit = items.filter(i => (cat === 'all' || i.cat === cat) && (!t || (i.name + ' ' + i.kw).toLowerCase().includes(t)));
      grid.replaceChildren(...(hit.length ? hit.slice(0, cat === 'emoji' || cat === 'all' && !t ? 400 : 200).map(i => i.emoji
        ? h('button.elb.emo', { type: 'button', title: 'อีโมจิ', onclick: () => i.make() }, i.emoji)
        : h('button.elb', { type: 'button', title: i.name, 'aria-label': i.name, onclick: async () => { try { await i.make(); } catch (e) { toast(e.message, 'bad'); } } }, ((s) => { s.setAttribute('viewBox', i.vb); s.innerHTML = i.prev; return s; })(document.createElementNS('http://www.w3.org/2000/svg', 'svg')), h('span', {}, i.name))) : [h('p.muted', { style: 'grid-column:1/-1;margin:8px' }, 'ไม่พบ ลองคำอื่น เช่น "ลูกศร" "หัวใจ" "ตาราง"')]));
    };
    draw(); pop(a, 'องค์ประกอบ', h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, input, tabs, grid), { side: 'right', wide: 400 });
  }
  return { elementsPop, addQr, addBarcode, addTable, addRuler, mkShape, SHAPES };
}
