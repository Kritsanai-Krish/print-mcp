// Persistent state: config.json (user choices), printers.json (discovery cache).
// Several Claude sessions may run this server at once, so writes are atomic.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

export const STATE_DIR = process.env.PRINT_MCP_HOME
  ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'), 'print-mcp');

function ensureDir(): void { fs.mkdirSync(STATE_DIR, { recursive: true }); }

export function readJson<T>(name: string, fallback: T): T {
  const file = path.join(STATE_DIR, name);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`print-mcp: cannot read ${file}:`, e);
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // Keep the bad file for inspection rather than silently destroying user config on next write.
    const bad = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, bad); } catch { /* another process may have moved it first */ }
    console.error(`print-mcp: ${file} was corrupt, moved to ${bad}:`, e);
    return fallback;
  }
}

export function writeJson(name: string, value: unknown): void {
  ensureDir();
  const file = path.join(STATE_DIR, name);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      // Windows refuses to replace a file another process has open for a moment.
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) {
        try { fs.unlinkSync(tmp); } catch { /* best effort cleanup; the write error below is what matters */ }
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30 * (attempt + 1));
    }
  }
}

export interface Config {
  defaultPrinter?: string;
  aliases: Record<string, string>;
  hidden: string[];
  manualHosts: string[];
  /** Options applied to every job, lowest priority. */
  defaults: Record<string, unknown>;
  printerDefaults: Record<string, Record<string, unknown>>;
  presets: Record<string, Record<string, unknown>>;
  /** Stop and ask above this many sheets, so a mistyped copies=500 cannot empty the tray. */
  largeJobSheets: number;
  subnetSweep: boolean;
  /** Repairs that need admin rights may raise the Windows permission prompt. */
  allowElevation: boolean;
}

const EMPTY_CONFIG: Config = { aliases: {}, hidden: [], manualHosts: [], defaults: {}, printerDefaults: {}, presets: {}, largeJobSheets: 50, subnetSweep: true, allowElevation: true };

export function loadConfig(): Config {
  return { ...EMPTY_CONFIG, ...readJson<Partial<Config>>('config.json', {}) };
}

export function saveConfig(c: Config): void { writeJson('config.json', c); }

export function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'print-mcp-'));
}

/** A crash can strand rendered pages of private documents in temp; clear them on the next start. */
export function sweepOldTempDirs(maxAgeMs = 24 * 3600 * 1000): void {
  const root = os.tmpdir();
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch (e) {
    console.error('print-mcp: cannot read temp folder:', e);
    return;
  }
  for (const name of names) {
    if (!name.startsWith('print-mcp-')) continue;
    const dir = path.join(root, name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > maxAgeMs) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`print-mcp: temp cleanup of ${dir}:`, (e as Error).message);
    }
  }
}

export function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    console.error(`print-mcp: could not remove temp dir ${dir}:`, e);
  }
}
