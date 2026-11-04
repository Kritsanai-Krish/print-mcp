// The installer edits other programs' config files, so every test runs against a throwaway home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'print-mcp-setup-'));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'roaming'), LOCALAPPDATA: path.join(home, 'local'), XDG_CONFIG_HOME: path.join(home, 'xdg'), PRINT_MCP_HOME: path.join(home, 'state') };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', timeout: 60000 });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const write = (rel: string, text: string) => {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  return { home, run, write, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const backups = (file: string) => fs.readdirSync(path.dirname(file)).filter(n => n.startsWith(`${path.basename(file)}.bak-print-mcp-`));

test('setup registers the server, keeps other settings, backs up, and is idempotent', () => {
  const s = sandbox();
  try {
    const claude = s.write('.claude.json', JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));
    fs.mkdirSync(path.join(s.home, '.claude'));
    const first = s.run('setup', '--no-scan');
    assert.equal(first.code, 0, first.out);
    const config = readJson(claude);
    assert.equal(config.theme, 'dark');
    assert.deepEqual(config.mcpServers.other, { command: 'x' });
    assert.equal(config.mcpServers.printer.command, process.execPath);
    assert.ok(fs.existsSync(config.mcpServers.printer.args[0]), 'registered server file exists');
    assert.equal(backups(claude).length, 1);
    const second = s.run('setup', '--no-scan');
    assert.match(second.out, /Claude Code: unchanged/);
    assert.equal(backups(claude).length, 1, 'no change means no new backup');
  } finally { s.cleanup(); }
});

test('setup keeps what the user added to the entry but corrects a stale path', () => {
  const s = sandbox();
  try {
    const claude = s.write('.claude.json', JSON.stringify({ mcpServers: { printer: { command: 'old-node', args: ['old.js'], env: { PRINT_MCP_HOME: 'custom' } } } }));
    assert.match(s.run('setup', '--no-scan').out, /Claude Code: updated/);
    const entry = readJson(claude).mcpServers.printer;
    assert.equal(entry.command, process.execPath);
    assert.deepEqual(entry.env, { PRINT_MCP_HOME: 'custom' });
  } finally { s.cleanup(); }
});

test('only clients that exist get an entry, and each uses its own format', () => {
  const s = sandbox();
  try {
    fs.mkdirSync(path.join(s.home, '.cursor'));
    const vscodeDir = process.platform === 'win32' ? path.join('roaming', 'Code', 'User') : process.platform === 'darwin' ? path.join('Library', 'Application Support', 'Code', 'User') : path.join('xdg', 'Code', 'User');
    fs.mkdirSync(path.join(s.home, vscodeDir), { recursive: true });
    const out = s.run('setup', '--no-scan').out;
    assert.ok(readJson(path.join(s.home, '.cursor', 'mcp.json')).mcpServers.printer);
    assert.equal(readJson(path.join(s.home, vscodeDir, 'mcp.json')).servers.printer.type, 'stdio');
    assert.doesNotMatch(out, /Claude Code:|Windsurf:|Gemini CLI:/);
    assert.ok(!fs.existsSync(path.join(s.home, '.claude')), 'no folder created for a missing client');
  } finally { s.cleanup(); }
});

test('the Store build of Claude Desktop gets its own entry on Windows', { skip: process.platform !== 'win32' }, () => {
  const s = sandbox();
  try {
    const file = s.write(path.join('local', 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'), '{}');
    s.run('setup', '--no-scan');
    assert.ok(readJson(file).mcpServers.printer);
  } finally { s.cleanup(); }
});

test('a broken or commented config is never overwritten, and other clients still get set up', () => {
  const s = sandbox();
  try {
    const original = '{ // my settings\n "mcpServers": {} }';
    const broken = s.write(path.join('.cursor', 'mcp.json'), original);
    const notObject = s.write(path.join('.gemini', 'settings.json'), JSON.stringify({ mcpServers: ['x'] }));
    const good = s.write(path.join('.codeium', 'windsurf', 'mcp_config.json'), '﻿{}');
    const r = s.run('setup', '--no-scan');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Cursor: skipped/);
    assert.equal(fs.readFileSync(broken, 'utf8'), original);
    assert.match(r.out, /Gemini CLI: skipped/);
    assert.deepEqual(readJson(notObject).mcpServers, ['x']);
    assert.ok(readJson(good).mcpServers.printer, 'a BOM is tolerated');
  } finally { s.cleanup(); }
});

test('codex TOML: other settings survive setup, re-setup and uninstall', () => {
  const s = sandbox();
  try {
    const before = 'model = "x"\n\n[mcp_servers.other]\ncommand = "y"\n';
    const file = s.write(path.join('.codex', 'config.toml'), before);
    assert.match(s.run('setup', '--no-scan').out, /Codex: added/);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith(before.trimEnd()));
    assert.ok(text.includes(`command = ${JSON.stringify(process.execPath)}`));
    assert.match(s.run('setup', '--no-scan').out, /Codex: unchanged/);
    // A section in the middle of the file must not swallow the table after it.
    fs.writeFileSync(file, `[mcp_servers.printer]\ncommand = "old"\n\n[after]\nkeep = 1\n`);
    assert.match(s.run('setup', '--no-scan').out, /Codex: updated/);
    assert.match(fs.readFileSync(file, 'utf8'), /\[after\]\nkeep = 1/);
    s.run('uninstall');
    const left = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(left, /mcp_servers\.printer/);
    assert.match(left, /\[after\]\nkeep = 1/);
  } finally { s.cleanup(); }
});

test('uninstall removes only what setup added', () => {
  const s = sandbox();
  try {
    const claude = s.write('.claude.json', JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));
    fs.mkdirSync(path.join(s.home, '.claude'));
    s.run('setup', '--no-scan');
    assert.match(s.run('uninstall').out, /Claude Code: removed/);
    assert.deepEqual(readJson(claude), { theme: 'dark', mcpServers: { other: { command: 'x' } } });
  } finally { s.cleanup(); }
});

test('with no AI client it prints how to connect one by hand', () => {
  const s = sandbox();
  try {
    const r = s.run('setup', '--no-scan');
    assert.equal(r.code, 0);
    assert.match(r.out, /No AI client found[\s\S]*command:/);
  } finally { s.cleanup(); }
});

test('an unknown command fails and shows help', () => {
  const s = sandbox();
  try {
    const r = s.run('frobnicate');
    assert.equal(r.code, 1);
    assert.match(r.out, /print-mcp setup/);
  } finally { s.cleanup(); }
});

test('the serve command speaks MCP on stdout and nothing else', () => {
  const s = sandbox();
  try {
    const hello = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    const r = spawnSync(process.execPath, [cli, 'serve'], {
      input: `${hello}\n`, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PRINT_MCP_HOME: path.join(s.home, 'state') },
    });
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 1, r.stdout);
    assert.equal(JSON.parse(lines[0]).result.serverInfo.name, 'printer');
  } finally { s.cleanup(); }
});
