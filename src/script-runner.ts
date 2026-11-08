// Child process that runs one user script (see scripts.ts). It has no file or process permissions of its own:
// reading, writing and calling tools all go through the parent, which applies the rules.
import vm from 'node:vm';
import { createRequire } from 'node:module';

if (!process.send) throw new Error('script-runner is started by print-mcp, not by hand');
const send = process.send.bind(process);
const require_ = createRequire(import.meta.url);
const pending = new Map<number, { ok: (v: unknown) => void; no: (e: Error) => void }>();
let seq = 0;
const ask = (m: Record<string, unknown>) => new Promise<unknown>((ok, no) => { const id = ++seq; pending.set(id, { ok, no }); send({ ...m, id }); });
process.on('message', (m: { type: string; id?: number; ok?: boolean; value?: unknown; error?: string; code?: string; args?: unknown }) => {
  if (m.type === 'reply' && m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.ok ? p.ok(m.value) : p.no(new Error(m.error)); }
  if (m.type === 'run') void run(m.code ?? '', m.args);
});

/** sharp without the ways out: no file paths in, no toFile out (a native library would bypass the permission model). */
function safeSharp() {
  const real = require_('sharp') as ((...i: unknown[]) => Record<string, (...a: unknown[]) => unknown>) & Record<string, unknown>;
  const no = (what: string) => { throw new Error(`${what} is not available in scripts. Use readFile(path) to get a Buffer, pass it to sharp(), and save with writeFile(name, await image.toBuffer()).`); };
  const wrapped = (...a: unknown[]) => { if (typeof a[0] === 'string') no('sharp(path)'); return real(...a); };
  Object.assign(wrapped, { kernel: real.kernel, fit: real.fit, gravity: real.gravity, strategy: real.strategy, blend: real.blend });
  const proto = Object.getPrototypeOf(real({ create: { width: 1, height: 1, channels: 3, background: '#000' } }) as object) as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ['toFile', 'tile', 'join']) if (proto[m]) proto[m] = () => no('.' + m + '()');
  const composite = proto.composite;
  proto.composite = function (this: unknown, ...a: unknown[]) {
    const list = a[0] as { input?: unknown }[] | undefined;
    for (const o of list ?? []) if (typeof o.input === 'string') no('composite() with a file path');
    return composite.apply(this, a);
  };
  return wrapped;
}

/** Scripts can reach the host realm (for example through Buffer.constructor), so take the dangerous host globals away first. */
function lockDown(): void {
  const g = globalThis as Record<string, unknown>;
  for (const k of ['fetch', 'WebSocket', 'EventSource', 'Request', 'Response', 'Headers', 'FormData', 'XMLHttpRequest', 'WebAssembly']) delete g[k];
  const p = process as unknown as Record<string, unknown>;
  for (const k of ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen', 'mainModule', 'chdir', 'kill', 'abort', 'reallyExit']) try { delete p[k]; p[k] = undefined; } catch { /* already locked */ }
}

async function run(code: string, args: unknown) {
  const logs: string[] = [];
  const sandbox = {
    args, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    sleep: (ms: number) => new Promise(r => setTimeout(r, Math.min(ms, 30000))),
    log: (...a: unknown[]) => { if (logs.length < 200) logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 2000)); },
    console: { log: (...a: unknown[]) => sandbox.log(...a), error: (...a: unknown[]) => sandbox.log(...a), warn: (...a: unknown[]) => sandbox.log(...a) },
    readFile: (p: string) => ask({ type: 'read', path: p }),
    writeFile: (name: string, data: Buffer | Uint8Array | string) => ask({ type: 'write', name, data: typeof data === 'string' ? Buffer.from(data) : Buffer.from(data) }),
    call: (name: string, a: Record<string, unknown> = {}) => ask({ type: 'call', name, args: a }),
    sharp: safeSharp(),
  };
  lockDown();
  const toolFns = {
    toolList: (name?: string) => sandbox.call('tool_list', name ? { name } : {}),
    toolUse: (name: string, a?: unknown) => sandbox.call('tool_use', { name, args: a }),
    toolWrite: (o: Record<string, unknown>) => sandbox.call('tool_write', o),
    toolEdit: (o: Record<string, unknown>) => sandbox.call('tool_edit', o),
    toolRemove: (name: string) => sandbox.call('tool_remove', { name }),
  };
  try {
    const ctx = vm.createContext(Object.assign(sandbox, toolFns), { codeGeneration: { strings: false, wasm: false } });
    const fn = vm.runInContext(`(async () => {\n${code}\n})`, ctx, { filename: 'script.js' }) as () => Promise<unknown>;
    const value = await fn();
    send({ type: 'done', ok: true, value: JSON.parse(JSON.stringify(value ?? null)), logs });
  } catch (e) {
    send({ type: 'done', ok: false, error: e instanceof Error ? e.message : String(e), logs });
  }
}
