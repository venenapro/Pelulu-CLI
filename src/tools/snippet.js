/**
 * Snippet Tool — save and reuse code snippets (1 MCP tool, 4 actions)
 * Actions: save, load, list, delete
 */
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getConfig } from '../core/config.js';
import { log } from '../core/logger.js';

function snippetDir() {
  return join(getConfig()._root, 'snippets');
}

function snippetPath(name) {
  return join(snippetDir(), `${name}.json`);
}

const ACTIONS = {
  save: {
    required: ['name', 'code'],
    handler: async ({ name, code, language, description }) => {
      const dir = snippetDir();
      await mkdir(dir, { recursive: true });
      const data = { name, code, language: language || 'unknown', description: description || '', savedAt: Date.now() };
      await writeFile(snippetPath(name), JSON.stringify(data, null, 2));
      log('snippet', `💾 Saved: ${name}`);
      return { saved: true, name, path: snippetPath(name) };
    },
  },

  load: {
    required: ['name'],
    handler: async ({ name }) => {
      const path = snippetPath(name);
      if (!existsSync(path)) throw new Error(`Snippet not found: ${name}`);
      const data = JSON.parse(await readFile(path, 'utf-8'));
      return data;
    },
  },

  list: {
    required: [],
    handler: async () => {
      const dir = snippetDir();
      if (!existsSync(dir)) return { snippets: [] };
      const files = await readdir(dir);
      const snippets = [];
      for (const f of files.filter(f => f.endsWith('.json'))) {
        try {
          const data = JSON.parse(await readFile(join(dir, f), 'utf-8'));
          snippets.push({ name: data.name, language: data.language, description: data.description });
        } catch {}
      }
      return { count: snippets.length, snippets };
    },
  },

  delete: {
    required: ['name'],
    handler: async ({ name }) => {
      const path = snippetPath(name);
      if (!existsSync(path)) throw new Error(`Snippet not found: ${name}`);
      await unlink(path);
      return { deleted: true, name };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'snippet',
  description: 'Code snippets: save, load, list, delete',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      name: { type: 'string', description: 'Snippet name' },
      code: { type: 'string', description: 'Code content' },
      language: { type: 'string', description: 'Programming language' },
      description: { type: 'string', description: 'Snippet description' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown action: ${action}`);
    for (const f of a.required) {
      if (params[f] === undefined) throw new Error(`Missing required: ${f}`);
    }
    return a.handler(params);
  },
};
