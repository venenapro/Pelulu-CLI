/**
 * File Tool — consolidated file operations (1 MCP tool, 9 actions)
 * Actions: read, write, edit, list, delete, mkdir, copy, move, exists
 */
import { readFile, writeFile, readdir, stat, mkdir, unlink, rename, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';

const HOME = homedir();

function safe(p) {
  if (!p) throw new Error('path is required');
  const abs = resolve(p.replace(/^~(?=$|[/\\])/g, HOME));
  const allowed = [HOME, process.cwd()];
  if (!allowed.some(prefix => abs.startsWith(prefix))) throw new Error(`Access denied: ${abs}`);
  return abs;
}

async function statOrNull(p) {
  try { return await stat(p); } catch { return null; }
}

const ACTIONS = {
  read: {
    required: ['path'],
    handler: async ({ path, offset, limit }) => {
      const abs = safe(path);
      const content = await readFile(abs, 'utf-8');
      const start = offset || 0;
      const end = limit ? start + limit : content.length;
      return { path: abs, content: content.slice(start, end), totalSize: content.length };
    },
  },

  write: {
    required: ['path', 'content'],
    handler: async ({ path, content }) => {
      const abs = safe(path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf-8');
      log('file', `[EDIT] Written: ${abs} (${content.length} chars)`);
      return { path: abs, written: content.length };
    },
  },

  edit: {
    // new_text is intentionally NOT required: XiaoZhi (a voice model) often
    // omits it — either it means "delete this text" or it dropped the field
    // mid-call. Treating a missing/undefined new_text as an empty string keeps
    // the edit working (as a deletion) instead of failing the whole turn with
    // "Missing required field: new_text".
    required: ['path', 'old_text'],
    handler: async ({ path, old_text, new_text }) => {
      const abs = safe(path);
      const replacement = new_text ?? '';
      let content = await readFile(abs, 'utf-8');
      if (!content.includes(old_text)) throw new Error(`old_text not found in ${abs}`);
      const count = content.split(old_text).length - 1;
      content = content.split(old_text).join(replacement);
      await writeFile(abs, content, 'utf-8');
      log('file', `[EDIT] Edited: ${abs} (${count} occurrence(s))`);
      return { path: abs, edited: true, occurrences: count };
    },
  },

  list: {
    required: [],
    handler: async ({ path, recursive }) => {
      const dir = safe(path || HOME);
      if (recursive) return { path: dir, items: await _listRecursive(dir, dir) };
      const entries = await readdir(dir, { withFileTypes: true });
      const items = await Promise.all(entries.map(async e => {
        const fp = join(dir, e.name);
        const s = await statOrNull(fp);
        return { name: e.name, type: e.isDirectory() ? 'dir' : 'file', size: s?.size || 0 };
      }));
      return { path: dir, count: items.length, items };
    },
  },

  delete: {
    required: ['path'],
    handler: async ({ path }) => {
      const abs = safe(path);
      if (!existsSync(abs)) throw new Error(`Not found: ${abs}`);
      await unlink(abs);
      log('file', `[DEL] Deleted: ${abs}`);
      return { path: abs, deleted: true };
    },
  },

  mkdir: {
    required: ['path'],
    handler: async ({ path }) => {
      const abs = safe(path);
      await mkdir(abs, { recursive: true });
      return { path: abs, created: true };
    },
  },

  copy: {
    required: ['from', 'to'],
    handler: async ({ from, to }) => {
      const absFrom = safe(from);
      const absTo = safe(to);
      await mkdir(dirname(absTo), { recursive: true });
      await copyFile(absFrom, absTo);
      return { from: absFrom, to: absTo, copied: true };
    },
  },

  move: {
    required: ['from', 'to'],
    handler: async ({ from, to }) => {
      const absFrom = safe(from);
      const absTo = safe(to);
      await mkdir(dirname(absTo), { recursive: true });
      await rename(absFrom, absTo);
      return { from: absFrom, to: absTo, moved: true };
    },
  },

  exists: {
    required: ['path'],
    handler: async ({ path }) => {
      const abs = safe(path);
      if (!existsSync(abs)) return { exists: false, path: abs };
      const s = await stat(abs);
      return { exists: true, path: abs, type: s.isDirectory() ? 'dir' : 'file', size: s.size };
    },
  },
};

async function _listRecursive(base, dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    const fp = join(dir, e.name);
    const rel = fp.slice(base.length + 1);
    if (e.isDirectory()) {
      items.push({ name: rel, type: 'dir' });
      items.push(...(await _listRecursive(base, fp)));
    } else {
      const s = await statOrNull(fp);
      items.push({ name: rel, type: 'file', size: s?.size || 0 });
    }
  }
  return items;
}

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'file',
  description: 'File operations: read, write, edit, list, delete, mkdir, copy, move, exists',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames, description: 'Action to perform' },
      path: { type: 'string', description: 'File or directory path' },
      content: { type: 'string', description: 'Content to write' },
      old_text: { type: 'string', description: 'Exact text to find (for edit)' },
      new_text: { type: 'string', description: 'Replacement text (for edit)' },
      from: { type: 'string', description: 'Source path (for copy/move)' },
      to: { type: 'string', description: 'Destination path (for copy/move)' },
      offset: { type: 'number', description: 'Read start offset (chars)' },
      limit: { type: 'number', description: 'Read max chars' },
      recursive: { type: 'boolean', description: 'Recursive list' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown action: ${action}. Use: ${actionNames.join(', ')}`);
    for (const field of a.required) {
      if (params[field] === undefined) throw new Error(`Missing required field: ${field}`);
    }
    return a.handler(params);
  },
};
