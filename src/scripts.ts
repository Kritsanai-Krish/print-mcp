// User scripts: small JavaScript tools that the AI or the person writes once and runs again later.
// Each script is a plain file in <state dir>/tools/<name>.js, so it survives restarts and can be edited by hand.
// Running one starts a child process under Node's permission model (no file access of its own, no child
// processes); everything it needs goes through the parent, which applies the rules in `allowedRead`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STATE_DIR } from './state.js';
import { resolveLocalPath } from './sources.js';

export const TOOLS_DIR = path.join(STATE_DIR, 'tools');
const NAME = /^[a-z][a-z0-9_-]{1,39}$/i;
const MAX_CODE = 200_000;
const MAX_READ = 200 * 1024 * 1024;
const MAX_DEPTH = 3;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'script-runner.js');

export type CallBuiltin = (name: string, args: Record<string, unknown>) => Promise<unknown>;
let callBuiltin: CallBuiltin = async () => { throw new Error('Scripts cannot call tools in this process'); };
/** index.ts hands over a function that runs any registered MCP tool and returns its text result. */
export function setBuiltinCaller(fn: CallBuiltin): void { callBuiltin = fn; }

export interface ScriptInfo { name: string; description: string; params: string; bytes: number; updated: string }
export interface ScriptFull extends ScriptInfo { code: string }

function file(name: string): string {
  if (!NAME.test(name)) throw new Error(`Bad script name "${name}". Use 2-40 letters, digits, "_" or "-", starting with a letter (example: remove_white).`);
  return path.join(TOOLS_DIR, name + '.js');
}

function parse(name: string, text: string, stat: fs.Stats): ScriptFull {
  let description = '', params = '';
  const lines = text.split(/\r?\n/); let i = 0;
  for (; i < lines.length; i++) {
    const m = /^\/\/\s*(description|params):\s?(.*)$/i.exec(lines[i]); if (!m) break;
    if (m[1].toLowerCase() === 'description') description = m[2].trim(); else params = m[2].trim();
  }
  return { name, description, params, bytes: stat.size, updated: stat.mtime.toISOString(), code: lines.slice(i).join('\n').replace(/^\n+/, '') };
}

function render(code: string, description: string, params: string): string {
  const one = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  return `${description ? `// description: ${one(description)}\n` : ''}${params ? `// params: ${one(params)}\n` : ''}${code.replace(/^\n+/, '')}${code.endsWith('\n') ? '' : '\n'}`;
}

function read(name: string): ScriptFull {
  const f = file(name);
  if (!fs.existsSync(f)) {
    const have = (toolList() as ScriptInfo[]).map(s => s.name);
    throw new Error(`No script named "${name}".${have.length ? ` Saved scripts: ${have.join(', ')}.` : ' None saved yet: create one with tool_write.'}`);
  }
  return parse(name, fs.readFileSync(f, 'utf8'), fs.statSync(f));
}

function check(code: string): void {
  if (!code.trim()) throw new Error('The script code is empty.');
  if (code.length > MAX_CODE) throw new Error(`The script is ${code.length} characters; the limit is ${MAX_CODE}.`);
  try { new Function(`return (async () => {\n${code}\n})`); } catch (e) { throw new Error(`The script has a syntax error: ${(e as Error).message}`); }
}

/** toolList: every saved script (newest first), or one script with its code when `name` is given. */
export function toolList(name?: string): ScriptInfo[] | ScriptFull {
  if (name) return read(name);
  if (!fs.existsSync(TOOLS_DIR)) return [];
  return fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.js')).map(f => {
    const n = f.slice(0, -3); try { const { code: _c, ...info } = parse(n, fs.readFileSync(path.join(TOOLS_DIR, f), 'utf8'), fs.statSync(path.join(TOOLS_DIR, f))); return info; } catch { return null; }
  }).filter((x): x is ScriptInfo => !!x).sort((a, b) => b.updated.localeCompare(a.updated));
}

/** toolWrite: save a new script. Refuses to replace an existing one unless overwrite is true. */
export function toolWrite(a: { name: string; code: string; description?: string; params?: string; overwrite?: boolean }): ScriptInfo {
  const f = file(a.name); check(a.code);
  if (fs.existsSync(f) && !a.overwrite) throw new Error(`A script named "${a.name}" already exists. Use tool_edit to change it, or tool_write with overwrite:true to replace it.`);
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  fs.writeFileSync(f, render(a.code, a.description ?? '', a.params ?? ''));
  const { code: _c, ...info } = read(a.name); return info;
}

/** toolEdit: change the code, the description or the name of a saved script. */
export function toolEdit(a: { name: string; code?: string; description?: string; params?: string; new_name?: string; find?: string; replace?: string }): ScriptInfo {
  const cur = read(a.name); let code = a.code ?? cur.code;
  if (a.find !== undefined) { if (!code.includes(a.find)) throw new Error('The text to find is not in the script.'); code = code.replace(a.find, () => a.replace ?? ''); }
  check(code);
  const next = a.new_name ?? a.name; const target = file(next);
  if (next !== a.name && fs.existsSync(target)) throw new Error(`A script named "${next}" already exists.`);
  fs.writeFileSync(target, render(code, a.description ?? cur.description, a.params ?? cur.params));
  if (next !== a.name) fs.rmSync(file(a.name));
  const { code: _c, ...info } = read(next); return info;
}

/** toolRemove: delete a saved script. This cannot be undone. */
export function toolRemove(name: string): { removed: string } {
  const f = file(name); if (!fs.existsSync(f)) throw new Error(`No script named "${name}".`);
  fs.rmSync(f); return { removed: name };
}

const stringsIn = (v: unknown, out: string[] = [], depth = 0): string[] => {
  if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object' && depth < 5) for (const x of Object.values(v)) stringsIn(x, out, depth + 1);
  return out;
};

/** Folders the script may read from: those named by its arguments, its output folder and anything a tool it called produced. */
function allowAround(allow: Set<string>, text: string): void {
  if (text.length > 4096 || /[\r\n]/.test(text)) return;
  let p: string; try { p = resolveLocalPath(text); } catch { return; }
  try { const s = fs.statSync(p); allow.add(s.isDirectory() ? p : path.dirname(p)); } catch { /* not a path */ }
}
const inside = (p: string, dirs: Set<string>) => [...dirs].some(d => { const r = path.relative(d, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); });

export interface RunResult { value: unknown; files: { path: string; bytes: number }[]; logs: string[]; ms: number }

/** toolUse: run a saved script with `args`. The script's `return` value comes back as `value`; files it wrote are listed. */
export async function toolUse(a: { name?: string; code?: string; args?: Record<string, unknown>; timeout_ms?: number }, depth = 0): Promise<RunResult> {
  if (depth >= MAX_DEPTH) throw new Error(`Scripts may call other scripts at most ${MAX_DEPTH} levels deep.`);
  const code = a.code ?? read(a.name ?? '').code; check(code);
  const args = a.args ?? {}, timeout = Math.min(300_000, Math.max(1000, a.timeout_ms ?? 60_000));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-mcp-script-'));
  const allow = new Set<string>([outDir]); for (const s of stringsIn(args)) allowAround(allow, s);
  const major = Number(process.versions.node.split('.')[0]);
  const child = fork(RUNNER, [], {
    serialization: 'advanced', silent: true, cwd: outDir,
    execArgv: [major >= 24 ? '--permission' : '--experimental-permission', `--allow-fs-read=${ROOT}`, '--allow-addons'],
    env: { PATH: process.env.PATH ?? '', PRINT_MCP_RUNNER: '1' },
  });
  const t0 = Date.now(); let stderr = '';
  child.stderr?.on('data', d => { stderr = (stderr + d).slice(-2000); });
  return new Promise<RunResult>((resolve, reject) => {
    const files = () => fs.readdirSync(outDir).map(n => ({ path: path.join(outDir, n), bytes: fs.statSync(path.join(outDir, n)).size }));
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`The script ran longer than ${timeout / 1000} s and was stopped. Pass a larger timeout_ms (up to 300000) if that is expected.`)); }, timeout);
    const finish = (fn: () => void) => { clearTimeout(timer); child.kill(); fn(); };
    child.on('error', e => finish(() => reject(e)));
    child.on('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`The script process stopped (exit ${code}).${stderr ? ' ' + stderr.trim().split('\n').slice(-3).join(' | ') : ''}`)); } });
    child.on('message', async (m: { type: string; id?: number; [k: string]: unknown }) => {
      const reply = (ok: boolean, value?: unknown) => child.connected && child.send({ type: 'reply', id: m.id, ok, ...(ok ? { value } : { error: String(value) }) });
      try {
        if (m.type === 'done') return finish(() => m.ok ? resolve({ value: m.value, files: files(), logs: (m.logs as string[]) ?? [], ms: Date.now() - t0 }) : reject(new Error(String(m.error))));
        if (m.type === 'read') {
          const p = resolveLocalPath(String(m.path));
          if (!inside(p, allow)) throw new Error(`The script may not read ${p}. It can read files named in its args, files it wrote, and files that tools it called returned.`);
          if (fs.statSync(p).size > MAX_READ) throw new Error('That file is larger than 200 MB.');
          return reply(true, fs.readFileSync(p));
        }
        if (m.type === 'write') {
          const name = path.basename(String(m.name)); if (!name || name.startsWith('.')) throw new Error('Give writeFile a plain file name such as "result.png".');
          if (files().length >= 200) throw new Error('A script may write at most 200 files.');
          const p = path.join(outDir, name); fs.writeFileSync(p, m.data as Buffer); return reply(true, p);
        }
        if (m.type === 'call') {
          const name = String(m.name), callArgs = (m.args ?? {}) as Record<string, unknown>;
          const value = name === 'tool_use' ? await toolUse(callArgs as never, depth + 1)
            : name === 'tool_list' ? toolList(callArgs.name as string | undefined)
            : name === 'tool_write' ? toolWrite(callArgs as never) : name === 'tool_edit' ? toolEdit(callArgs as never) : name === 'tool_remove' ? toolRemove(String(callArgs.name))
            : await callBuiltin(name, callArgs);
          for (const s of stringsIn(value)) allowAround(allow, s);
          return reply(true, value);
        }
      } catch (e) { reply(false, e instanceof Error ? e.message : e); }
    });
    child.send({ type: 'run', code, args });
  }).finally(() => { /* outputs stay in outDir so the caller can open them; the temp sweeper removes them after a day */ });
}
