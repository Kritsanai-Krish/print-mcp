// Lets the Print Studio web page show what an MCP client is doing: a cursor moves over the real
// controls before each tool runs. Every call here is best effort; with no page open it costs one refused connection.
const BASE = process.env.PRINT_WEB_URL ?? 'http://127.0.0.1:4177';
const OFF = process.env.PRINT_WEB_CHILD === '1' || process.env.PRINT_MCP_THEATER === 'off';

async function post(path: string, body: unknown, ms: number): Promise<{ live?: boolean; id?: string } | null> {
  try {
    const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    return (await r.json()) as { live?: boolean; id?: string };
  } catch { return null; }
}

// The page needs the text of a document or message, not secrets or huge payloads.
function brief(args: unknown): unknown {
  const { password: _password, ...rest } = (args ?? {}) as Record<string, unknown>;
  if (typeof rest.content === 'string' && rest.content.length > 6000) rest.content = rest.content.slice(0, 6000);
  return rest;
}

/** Resolves when the page has moved its cursor to the control the tool will use, or at once when no page is open. */
export async function theaterBegin(tool: string, args: unknown): Promise<string | null> {
  if (OFF) return null;
  const r = await post('/api/ai/begin', { tool, args: brief(args) }, 15000);
  return r?.live && r.id ? r.id : null;
}

export async function theaterEnd(id: string | null, result: { isError?: boolean; content?: { type: string; text?: string }[] }): Promise<void> {
  if (!id) return;
  const text = (result?.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n').slice(0, 4000);
  await post('/api/ai/end', { id, ok: !result?.isError, text }, 1500);
}
