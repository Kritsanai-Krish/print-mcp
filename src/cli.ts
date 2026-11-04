#!/usr/bin/env node
// The installed command. `print-mcp setup` wires the server into every AI client on this machine.
// Clients are registered with dist/index.js directly, so printing never passes through this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { STATE_DIR } from './state.js';

const SERVER = 'printer';
const here = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.join(here, 'index.js');
const home = os.homedir();
const entry = { command: process.execPath, args: [serverFile] };

type Outcome = 'added' | 'updated' | 'removed' | 'unchanged';

function userConfigDir(): string {
  if (process.platform === 'win32') return process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
}

const claudeHome = process.env.CLAUDE_CONFIG_DIR;
const claudeDir = claudeHome ?? path.join(home, '.claude');

/** The Microsoft Store build of Claude Desktop keeps its config inside its package folder. */
function storeDesktopConfigs(): string[] {
  const packages = path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Packages');
  let names: string[];
  try {
    names = fs.readdirSync(packages);
  } catch {
    return [];
  }
  return names.filter(n => n.startsWith('Claude_')).map(n => path.join(packages, n, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
}

interface JsonClient { name: string; file: string; key: string; extra?: Record<string, unknown> }

/** Only clients whose folder already exists get an entry, so setup never creates clutter. */
function jsonClients(): JsonClient[] {
  const desktop = [path.join(userConfigDir(), 'Claude', 'claude_desktop_config.json'), ...(process.platform === 'win32' ? storeDesktopConfigs() : [])];
  return [
    { name: 'Claude Code', file: path.join(claudeHome ?? home, '.claude.json'), key: 'mcpServers' },
    ...desktop.map(file => ({ name: 'Claude Desktop', file, key: 'mcpServers' })),
    { name: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), key: 'mcpServers' },
    { name: 'Windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers' },
    { name: 'VS Code', file: path.join(userConfigDir(), 'Code', 'User', 'mcp.json'), key: 'servers', extra: { type: 'stdio' } },
    { name: 'Gemini CLI', file: path.join(home, '.gemini', 'settings.json'), key: 'mcpServers' },
  ];
}

const isInstalled = (c: JsonClient) => (c.name === 'Claude Code' ? fs.existsSync(c.file) || fs.existsSync(claudeDir) : fs.existsSync(path.dirname(c.file)));

/** Replace a file in one step, keeping a backup, so a crash cannot leave a client's config half-written. */
function replaceFile(file: string, text: string): void {
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak-print-mcp-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function readConfig(file: string): Record<string, any> {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('its top level is not an object');
  return parsed;
}

function applyJson(c: JsonClient, remove: boolean): Outcome {
  const config = readConfig(c.file);
  const servers = config[c.key];
  if (servers !== undefined && (typeof servers !== 'object' || servers === null || Array.isArray(servers))) throw new Error(`"${c.key}" is not an object`);
  const current = servers?.[SERVER];
  if (remove) {
    if (current === undefined) return 'unchanged';
    delete servers[SERVER];
    replaceFile(c.file, JSON.stringify(config, null, 2));
    return 'removed';
  }
  // Keep settings the user added to our entry, such as env or alwaysLoad.
  const wanted = { ...c.extra, ...current, ...entry };
  if (JSON.stringify(current) === JSON.stringify(wanted)) return 'unchanged';
  config[c.key] = { ...servers, [SERVER]: wanted };
  replaceFile(c.file, JSON.stringify(config, null, 2));
  return current === undefined ? 'added' : 'updated';
}

// Our own whole section: the header up to the next table. Codex keeps settings in TOML, not JSON.
const CODEX_SECTION = new RegExp(`^\\[mcp_servers\\.${SERVER}\\]\\r?\\n(?:(?!\\[).*(?:\\r?\\n|$))*`, 'm');

function applyCodex(file: string, remove: boolean): Outcome {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const had = CODEX_SECTION.test(text);
  if (remove && !had) return 'unchanged';
  const rest = text.replace(CODEX_SECTION, '').trimEnd();
  // JSON string escapes are valid in a TOML basic string, which also covers Windows backslashes.
  const section = `[mcp_servers.${SERVER}]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${JSON.stringify(entry.args[0])}]\n`;
  const next = remove ? (rest ? `${rest}\n` : '') : `${rest ? `${rest}\n\n` : ''}${section}`;
  if (next === text) return 'unchanged';
  replaceFile(file, next);
  return remove ? 'removed' : had ? 'updated' : 'added';
}

/** One broken client config must not stop the others, and is never overwritten. */
function applyAll(remove: boolean): number {
  let touched = 0;
  const report = (name: string, file: string, run: () => Outcome) => {
    try {
      const outcome = run();
      if (outcome !== 'unchanged' || !remove) console.log(`${name}: ${outcome}`);
      if (!remove || outcome === 'removed') touched++;
    } catch (e) {
      console.log(`${name}: skipped, could not read ${file} (${e instanceof Error ? e.message : e}). Nothing was changed there.`);
    }
  };
  for (const c of jsonClients().filter(isInstalled)) report(c.name, c.file, () => applyJson(c, remove));
  const codexDir = path.join(process.env.CODEX_HOME ?? path.join(home, '.codex'));
  if (fs.existsSync(codexDir)) report('Codex', path.join(codexDir, 'config.toml'), () => applyCodex(path.join(codexDir, 'config.toml'), remove));
  return touched;
}

/** Fill the printer cache now, so the very first print starts instantly. */
async function scan(): Promise<void> {
  const { registry } = await import('./registry.js');
  console.log('\nLooking for printers...');
  try {
    await registry.refresh();
  } catch (e) {
    console.log(`Scan failed (${e instanceof Error ? e.message : e}). The server scans again on its own.`);
    return;
  }
  const found = registry.visible();
  if (!found.length) console.log('None found yet. Turn the printer on; the server keeps looking.');
  for (const p of found) console.log(`  ${p.name}${p.ipp ? `  (${p.ipp.host})` : p.queue ? '  (Windows queue)' : ''}`);
}

async function setup(args: string[]): Promise<void> {
  const touched = applyAll(false);
  if (!touched) {
    console.log(`\nNo AI client found. Add this server to yours:\n  command: ${entry.command}\n  args:    ${entry.args[0]}`);
  }
  if (!args.includes('--no-scan')) await scan();
  console.log('\nDone. Restart your AI client, then say "print this file".');
}

function uninstall(): void {
  applyAll(true);
  console.log(`\nDone. Saved printers and settings stay in ${STATE_DIR}; delete that folder if you no longer want them.\nTo remove the program itself: npm uninstall -g print-mcp`);
}

function version(): string {
  return (JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string }).version;
}

const HELP = `print-mcp ${version()}: print anything on your LAN from any AI client.

  print-mcp setup       Add the server to every AI client here and find printers
  print-mcp uninstall   Undo setup
  print-mcp serve       Run the MCP server on stdio (your AI client does this for you)
`;

const [command, ...rest] = process.argv.slice(2);
if (command === 'setup') {
  await setup(rest);
  process.exit(0); // Discovery leaves timers and sockets that would otherwise hold the terminal.
} else if (command === 'uninstall') {
  uninstall();
} else if (command === '--version' || command === '-v') {
  console.log(version());
} else if (command === 'serve' || (command === undefined && !process.stdin.isTTY)) {
  await import('./index.js');
} else {
  console.log(HELP);
  if (command !== undefined && command !== 'help' && command !== '--help' && command !== '-h') process.exitCode = 1;
}
