// User scripts (tool_list / tool_use / tool_write / tool_edit / tool_remove), tested without any printer or paper.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'print-mcp-scripts-'));
process.env.PRINT_MCP_HOME = home;
const { toolList, toolWrite, toolEdit, toolRemove, toolUse, setBuiltinCaller } = await import('../scripts.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

const img = path.join(home, 'in.png');
await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } })
  .composite([{ input: await sharp({ create: { width: 20, height: 30, channels: 3, background: '#123456' } }).png().toBuffer(), left: 40, top: 30 }]).png().toFile(img);
const secret = fs.mkdtempSync(path.join(os.tmpdir(), 'print-mcp-secret-')); after(() => fs.rmSync(secret, { recursive: true, force: true })); fs.writeFileSync(path.join(secret, 'private.txt'), 'nope');

test('write, list, run, edit and remove a script', async () => {
  assert.deepEqual(toolList(), []);
  toolWrite({ name: 'trim_it', description: 'Trim white borders', params: '{"source":"image path"}', code: 'const out = await sharp(await readFile(args.source)).trim().png().toBuffer(); log("trimmed"); return { saved: await writeFile("t.png", out) };' });
  assert.equal((toolList() as { name: string }[]).length, 1);
  assert.equal((toolList('trim_it') as { description: string }).description, 'Trim white borders');
  assert.throws(() => toolWrite({ name: 'trim_it', code: 'return 1' }), /already exists/);
  const r = await toolUse({ name: 'trim_it', args: { source: img } });
  assert.equal(r.files.length, 1); assert.deepEqual(r.logs, ['trimmed']);
  const m = await sharp(r.files[0].path).metadata(); assert.deepEqual([m.width, m.height], [20, 30]);
  toolEdit({ name: 'trim_it', find: '.trim()', replace: '.rotate(90)', new_name: 'turn_it' });
  assert.equal((toolList() as { name: string }[])[0].name, 'turn_it');
  const r2 = await toolUse({ name: 'turn_it', args: { source: img } });
  assert.equal((await sharp(r2.files[0].path).metadata()).width, 100);
  assert.deepEqual(toolRemove('turn_it'), { removed: 'turn_it' });
  assert.deepEqual(toolList(), []);
});

test('a script can call another tool and another script', async () => {
  setBuiltinCaller(async (name, a) => ({ name, got: a }));
  toolWrite({ name: 'inner', code: 'return args.n * 2;' });
  toolWrite({ name: 'outer', code: 'const t = await call("print_test_page", { x: 1 }); const v = await toolUse("inner", { n: 21 }); return { t, inner: v.value };' });
  const r = await toolUse({ name: 'outer' }); assert.deepEqual(r.value, { t: { name: 'print_test_page', got: { x: 1 } }, inner: 42 });
});

test('bad names, bad syntax and unknown scripts give plain errors', async () => {
  assert.throws(() => toolWrite({ name: '../x', code: 'return 1' }), /Bad script name/);
  assert.throws(() => toolWrite({ name: 'broken', code: 'return (' }), /syntax error/);
  assert.throws(() => toolList('nothing'), /No script named/);
  await assert.rejects(toolUse({ code: 'throw new Error("boom")' }), /boom/);
});

test('the sandbox keeps scripts away from files, processes and the network', async () => {
  const run = (code: string, args = {}) => toolUse({ code, args });
  await assert.rejects(run(`return await readFile(${JSON.stringify(path.join(secret, 'private.txt'))})`, { src: img }), /may not read/);
  await assert.rejects(run('return require("fs").readFileSync("/etc/passwd")'), /require is not defined/);
  await assert.rejects(run('return process.env'), /process is not defined/);
  await assert.rejects(run('return fetch("http://example.com")'), /fetch is not defined/);
  await assert.rejects(run('return eval("1")'), /./);
  // reaching the host realm through an object we handed in must not give network or module access either
  assert.equal((await run('return [Buffer.constructor("return typeof fetch")(), Buffer.constructor("return typeof process.getBuiltinModule")()]')).value?.toString(), 'undefined,undefined');
  await assert.rejects(run(`return Buffer.constructor("return process.binding('fs')")()`), /./);
  await assert.rejects(run('return await sharp(args.p).toBuffer()', { p: img }), /sharp\(path\)/);
  await assert.rejects(run('return await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000" } }).toFile("x.png")'), /toFile/);
  const w = await run('return await writeFile("../escape.txt", "x")'); assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'escape.txt'))); assert.equal(path.basename(path.dirname(String(w.value))).startsWith('print-mcp-script-'), true);
});

test('a script that never ends is stopped', async () => {
  await assert.rejects(toolUse({ code: 'while (true) { await sleep(10); }', timeout_ms: 1500 }), /longer than/);
});
