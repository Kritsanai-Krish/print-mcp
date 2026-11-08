// UI regression tests for Print Studio. Run: npm run test:ui  (needs Edge or Chrome installed; uses no paper).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 4300 + Math.floor(Math.random() * 500), URL_ = `http://localhost:${PORT}/`;
let srv, browser, page, tmp;
const errs = [];
const tool = (name, body) => fetch(URL_ + 'api/tool/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const ev = (fn, arg) => page.evaluate(fn, arg);
const zoom = () => ev(() => window.__design.cv.getZoom());
const screenPt = (i = 0) => ev(i => { const { cv } = window.__design; const o = cv.getObjects()[i]; const r = o.getBoundingRect(), c = cv.upperCanvasEl.getBoundingClientRect(), k = cv.getZoom(); return [c.left + (r.left + r.width / 2) * k, c.top + (r.top + r.height / 2) * k]; }, i);
async function fresh() {
  await page.goto(URL_); await page.waitForSelector('.pagehost canvas');
  await ev(() => indexedDB.deleteDatabase('print-studio')); await page.reload(); await page.waitForSelector('.pagehost canvas'); await page.waitForTimeout(800);
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-ui-'));
  const block = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#1f3a6b' } }).png().toBuffer();
  await sharp({ create: { width: 600, height: 800, channels: 3, background: '#ffffff' } }).composite([{ input: block, left: 150, top: 200 }]).png().toFile(path.join(tmp, 'scan.png'));
  srv = spawn(process.execPath, ['web/server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), PRINT_MCP_HOME: path.join(tmp, 'home') }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)); }
  browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch({ channel: 'chrome' }));
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errs.push(e.message));
});
after(async () => { await browser?.close(); srv?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('boots with no page errors', async () => {
  await fresh(); assert.deepEqual(errs, []);
});

test('rotation snaps to 45° and Ctrl turns snapping off', async () => {
  await fresh(); await page.keyboard.press('r'); await page.waitForTimeout(200);
  const r = await ev(() => {
    const { cv } = window.__design; const o = cv.getObjects()[0]; const t = a => { o.set('angle', a); return o; };
    cv.fire('object:rotating', { target: t(43), e: {} }); const a = o.angle;
    cv.fire('object:rotating', { target: t(43), e: { ctrlKey: true } }); const b = o.angle;
    cv.fire('object:rotating', { target: t(40), e: { shiftKey: true } }); return [a, b, o.angle];
  });
  assert.deepEqual(r, [45, 43, 45]);
});

test('dragging snaps to the page centre; holding Ctrl does not', async () => {
  await fresh(); await page.keyboard.press('r'); await page.waitForTimeout(200);
  const off = () => ev(() => { const { cv } = window.__design; const o = cv.getObjects()[0]; return Math.round(o.left + o.getScaledWidth() / 2 - cv.getWidth() / cv.getZoom() / 2); });
  const z = await zoom(); const [x, y] = await screenPt();
  const dx = (-(await off()) + 3) * z; // end 3 design px from centre: inside the snap zone
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up();
  assert.equal(await off(), 0, 'snapped to centre');
  const [x2, y2] = await screenPt(); await page.keyboard.down('Control');
  await page.mouse.move(x2, y2); await page.mouse.down(); await page.mouse.move(x2 + 3 * z, y2, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Control');
  assert.notEqual(await off(), 0, 'Ctrl keeps the free position');
});

test('Delete removes locked objects; right-click menu offers unlock', async () => {
  await fresh(); await page.keyboard.press('r'); await page.waitForTimeout(200); await page.keyboard.press('Control+l'); await page.waitForTimeout(100);
  const [x, y] = await screenPt(); await page.mouse.click(x, y, { button: 'right' }); await page.waitForTimeout(250);
  assert.match(await page.$eval('.ctxmenu', e => e.innerText), /ปลดล็อก/); await page.keyboard.press('Escape');
  await page.mouse.click(x, y); await page.keyboard.press('Delete'); await page.waitForTimeout(200);
  assert.equal(await ev(() => window.__design.cv.getObjects().length), 0);
});

test('many pages: the strip scrolls and the zoom controls stay on screen', async () => {
  await fresh(); for (let i = 0; i < 25; i++) await page.click('button.pg.add');
  const r = await page.$eval('.foot .zoom', e => e.getBoundingClientRect().right); assert.ok(r <= 1440, 'zoom right edge ' + r);
});

test('AI display mode is saved and "off" shows no cursor', async () => {
  await fresh(); await page.click('[data-ai=settings]'); await page.click('button:has-text("ปิด")');
  assert.equal(await ev(() => localStorage.getItem('ps-ai-mode')), 'off');
  await tool('job_status', {}); await page.waitForTimeout(600);
  assert.equal(await page.$('.aicur'), null);
});

test('layout_page items land on a new page in millimetres', async () => {
  await fresh();
  const r = await ev(async () => {
    await window.__studio.layoutItems({ paper: 'A5', orientation: 'landscape', items: [{ type: 'shape', shape: 'rect', x_mm: 10, y_mm: 10, width_mm: 40, height_mm: 20, fill: '#f00' }, { type: 'text', text: 'สวัสดี', x_mm: 60, y_mm: 12 }] });
    const { cv, D } = window.__design; const o = cv.getObjects()[0]; return { w: D.w, h: D.h, pages: D.pages.length, rw: Math.round(o.getScaledWidth() / (96 / 25.4)) };
  });
  assert.deepEqual(r, { w: 210, h: 148, pages: 2, rw: 40 });
});

test('image tools: trim and remove background', async () => {
  const src = path.join(tmp, 'scan.png'), out = path.join(tmp, 'out');
  const t = await tool('image_edit', { source: src, ops: [{ op: 'trim' }], output_dir: out, format: 'png' }); assert.ok(t.ok, t.text);
  const m = await sharp(JSON.parse(t.text).files[0].path).metadata();
  assert.ok(m.width < 300 && m.height < 400 && m.width > 190, `trimmed to the navy block, got ${m.width}x${m.height}`);
  const bg = await tool('image_edit', { source: src, ops: [{ op: 'remove_background' }], output_dir: out, format: 'png' }); assert.ok(bg.ok, bg.text);
  const { data, info } = await sharp(JSON.parse(bg.text).files[0].path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'white corner became transparent');
  assert.equal(data[((300 * info.width) + 250) * 4 + 3], 255, 'navy block stays opaque');
});

test('templates: save, rename, duplicate, get and delete', async () => {
  const body = JSON.stringify({ w: 210, h: 297, pages: [] });
  const s = await tool('manage_templates', { action: 'save', name: 'ui-test', data: body, width_mm: 210, height_mm: 297, pages: 1 }); assert.ok(s.ok, s.text);
  const id = s.data.template.id;
  assert.ok((await tool('manage_templates', { action: 'rename', id, name: 'ui-test-2' })).ok);
  const d = await tool('manage_templates', { action: 'duplicate', id }); assert.ok(d.ok, d.text); const id2 = d.data.template?.id ?? d.data.id;
  const list = await tool('manage_templates', { action: 'list' }); assert.ok(list.data.templates.some(x => x.id === id && x.name === 'ui-test-2'));
  assert.ok((await tool('manage_templates', { action: 'get', id })).ok);
  for (const i of [id, id2]) if (i) assert.ok((await tool('manage_templates', { action: 'delete', id: i })).ok);
});

test('rulers are present and a unit is set', async () => {
  await fresh(); assert.ok(await page.$('.ruler'));
  assert.ok(['mm', 'cm', 'in', 'px'].includes(await ev(() => window.__design.D.unit)));
});

test('the web server refuses requests that name another site', async () => {
  const r = await fetch(URL_ + 'api/tool/list_printers', { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.ok(r.status >= 400, 'status ' + r.status);
});

test('image buttons on the page work: remove background and rotate 90°', async () => {
  await fresh(); await page.click('[data-ai=dock-import]'); await page.setInputFiles('.fly input[type=file]', path.join(tmp, 'scan.png')); await page.waitForTimeout(1500);
  const info = () => ev(() => window.__design.cv.getObjects().map(o => Math.round(o.getScaledWidth()) + 'x' + Math.round(o.getScaledHeight())).join(' '));
  const before = await info();
  await page.click('.dctx button:has-text("ลบพื้นหลัง")'); await page.waitForTimeout(3500);
  assert.equal(await page.$('.toast.bad'), null, 'no error toast after remove background');
  await page.click('.dctx button:has-text("เครื่องมือรูป")'); await page.click('.fly .toolrow:has-text("หมุน 90")'); await page.waitForTimeout(3500);
  assert.equal(await page.$('.toast.bad'), null, 'no error toast after rotate');
  const [w, h] = before.split('x').map(Number), after = (await info()).split('x').map(Number);
  assert.ok(Math.abs(after[0] - h) < 3 && Math.abs(after[1] - w) < 3, `rotated: ${before} -> ${after.join('x')}`);
});

test('scripts panel: write, run on the selected image, edit and delete', async () => {
  await fresh(); await page.click('[data-ai=dock-import]'); await page.setInputFiles('.fly input[type=file]', path.join(tmp, 'scan.png')); await page.waitForTimeout(1500);
  await page.click('[data-ai=dock-scripts]'); await page.waitForTimeout(600);
  await page.click('[data-ai=script-new]'); await page.fill('input[aria-label="ชื่อสคริปต์"]', 'trim_ui'); await page.fill('input[aria-label="คำอธิบาย"]', 'ตัดขอบขาว');
  await page.click('[data-ai=script-save]'); await page.waitForTimeout(800);
  await page.click('[data-ai=dock-scripts]'); await page.waitForTimeout(600);
  assert.match(await page.$eval('.fly', e => e.innerText), /trim_ui[\s\S]*ตัดขอบขาว/);
  await page.click('.fly button:has-text("ใช้")'); await page.waitForTimeout(300); await page.click('[data-ai=script-run]'); await page.waitForTimeout(2500);
  assert.equal(await page.$('.toast.bad, .sheet .note.bad'), null, 'script ran without error');
  await page.click('.sheet button:has-text("ใส่ลงหน้า")'); await page.waitForTimeout(800);
  const sizes = await ev(() => window.__design.cv.getObjects().map(o => Math.round(o.getScaledWidth()) + 'x' + Math.round(o.getScaledHeight())));
  assert.equal(sizes.length, 2, 'result image added next to the original: ' + sizes);
  await page.click('[data-ai=dock-scripts]'); await page.waitForTimeout(500);
  await page.click('.fly button[aria-label="ลบ trim_ui"]'); await page.click('.modal button:has-text("ลบ")'); await page.waitForTimeout(600);
  assert.deepEqual((await tool('tool_list', {})).data, []);
});
