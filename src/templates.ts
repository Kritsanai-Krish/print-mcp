// User-owned page templates shared by the web editor and the AI. `data` is the editor's own JSON, kept as an opaque string.
import { randomBytes } from 'node:crypto';
import { readJson, writeJson } from './state.js';

const FILE = 'templates.json';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_NAME = 80;

export interface Template {
  id: string; name: string; created: string; updated: string;
  width_mm: number; height_mm: number; pages: number;
  thumbnail?: string; data: string;
}
export type TemplateInfo = Omit<Template, 'data'>;

export interface TemplateArgs {
  action: 'list' | 'get' | 'save' | 'rename' | 'delete' | 'duplicate';
  id?: string; name?: string; data?: string; width_mm?: number; height_mm?: number; thumbnail?: string; pages?: number;
}

const load = (): Template[] => {
  const v = readJson<{ templates?: Template[] }>(FILE, {});
  return Array.isArray(v.templates) ? v.templates : [];
};

function store(list: Template[]): void {
  const size = Buffer.byteLength(JSON.stringify({ templates: list }));
  if (size > MAX_FILE_BYTES) throw new Error(`Templates file would be ${(size / 1048576).toFixed(1)} MB; the limit is 25 MB. Delete templates you no longer need (action delete), then retry.`);
  writeJson(FILE, { templates: list });
}

const info = ({ data: _d, ...rest }: Template): TemplateInfo => rest;

function cleanName(name: string | undefined): string {
  const n = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('name is required (1-80 characters).');
  if ([...n].length > MAX_NAME) throw new Error(`name is ${[...n].length} characters; the limit is ${MAX_NAME}. Shorten it.`);
  return n;
}

/** "Card", then "Card 2", "Card 3" ... when the name is taken by another template. */
function uniqueName(list: Template[], name: string, exceptId?: string): string {
  const taken = new Set(list.filter(t => t.id !== exceptId).map(t => t.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const c = `${[...name].slice(0, MAX_NAME - String(i).length - 1).join('')} ${i}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
}

function find(list: Template[], id: string | undefined): Template {
  if (!id) throw new Error('id is required. Use action list to see the ids.');
  const t = list.find(x => x.id === id);
  if (!t) throw new Error(`No template with id "${id}". Use action list to see the ids.`);
  return t;
}

const newId = () => 't_' + randomBytes(6).toString('hex');

export function manageTemplates(a: TemplateArgs): Record<string, unknown> {
  const list = load();
  const now = new Date().toISOString();
  switch (a.action) {
    case 'list': {
      const templates = [...list].sort((x, y) => y.updated.localeCompare(x.updated)).map(info);
      return { templates, count: templates.length, hint: templates.length ? 'get {id} returns a template with its data; save {name,data,width_mm,height_mm} creates one.' : 'No templates yet. Create one with action save.' };
    }
    case 'get': return { template: find(list, a.id) };
    case 'save': {
      if (typeof a.data !== 'string' || !a.data) throw new Error('data is required: the editor JSON as a string.');
      const w = Number(a.width_mm), h = Number(a.height_mm);
      if (!(w > 0 && w <= 5000 && h > 0 && h <= 5000)) throw new Error('width_mm and height_mm are required numbers between 0 and 5000.');
      if (a.thumbnail !== undefined && !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(a.thumbnail)) throw new Error('thumbnail must be a data:image/jpeg;base64,... URL.');
      if (a.id !== undefined && !/^[\w-]{1,64}$/.test(a.id)) throw new Error('id may only contain letters, digits, _ and -, up to 64 characters.');
      const existing = a.id ? list.find(t => t.id === a.id) : undefined;
      const name = uniqueName(list, cleanName(a.name ?? existing?.name), existing?.id);
      const pages = a.pages === undefined ? existing?.pages ?? 1 : Math.round(a.pages);
      if (!(pages >= 1 && pages <= 1000)) throw new Error('pages must be 1-1000.');
      const t: Template = { id: existing?.id ?? a.id ?? newId(), name, created: existing?.created ?? now, updated: now, width_mm: w, height_mm: h, pages, ...(a.thumbnail ? { thumbnail: a.thumbnail } : existing?.thumbnail ? { thumbnail: existing.thumbnail } : {}), data: a.data };
      store(existing ? list.map(x => (x.id === t.id ? t : x)) : [...list, t]);
      return { template: info(t), created: !existing, count: existing ? list.length : list.length + 1 };
    }
    case 'rename': {
      const t = find(list, a.id);
      const name = uniqueName(list, cleanName(a.name), t.id);
      const next = { ...t, name, updated: now };
      store(list.map(x => (x.id === t.id ? next : x)));
      return { template: info(next) };
    }
    case 'delete': {
      const t = find(list, a.id);
      store(list.filter(x => x.id !== t.id));
      return { deleted: t.id, name: t.name, count: list.length - 1 };
    }
    case 'duplicate': {
      const t = find(list, a.id);
      const copy: Template = { ...t, id: newId(), name: uniqueName(list, a.name ? cleanName(a.name) : t.name), created: now, updated: now };
      store([...list, copy]);
      return { template: info(copy), count: list.length + 1 };
    }
    default: throw new Error(`Unknown action "${(a as { action: string }).action}". Use list, get, save, rename, delete or duplicate.`);
  }
}
