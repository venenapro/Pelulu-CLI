/**
 * Search Tool — consolidated search operations (1 MCP tool, 3 actions)
 * Actions: grep, find, web
 */
import { exec } from 'child_process';
import { log } from '../core/logger.js';
import { request as httpClientRequest } from '../core/http-client.js';
import { bus } from '../core/event-bus.js';

function runCmd(cmd, timeout = 10000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 256 * 1024 }, (_, stdout, stderr) => {
      resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '' });
    });
  });
}

// Delegates to the shared HTTP engine (gzip-aware, follows redirects).
async function httpGet(url, maxChars = 8000) {
  const r = await httpClientRequest(url, { timeout: 15000, followRedirects: true, maxBody: Math.max(maxChars, 8000) });
  return { status: r.status, body: r.body.slice(0, maxChars) };
}

const ACTIONS = {
  grep: {
    required: ['pattern'],
    handler: async ({ pattern, path, ignoreCase, include, context }) => {
      if (!pattern) throw new Error('pattern required');
      log('search', `[FIND] grep: ${pattern}`);
      const flags = ignoreCase ? '-rn' : '-rn';
      const ic = ignoreCase ? 'i' : '';
      const inc = include ? `--include="*.${include}"` : '';
      const ctx = context ? `-C ${context}` : '';
      const cmd = `grep ${flags}${ic} ${inc} ${ctx} "${pattern}" "${path || '.'}" 2>/dev/null | head -100`;
      bus.emit('task:progress', { tool: 'search', running: true, phase: 'grep', target: path || '.', log: `searching: ${pattern}` });
      const r = await runCmd(cmd);
      bus.emit('task:progress', { tool: 'search', running: false, phase: 'done', target: path || '.' });
      const lines = r.stdout.split('\n').filter(Boolean);
      return { pattern, matches: lines.length, results: lines };
    },
  },

  find: {
    required: ['name'],
    handler: async ({ name, path, type }) => {
      log('search', `[FIND] find: ${name}`);
      const t = type ? `-type ${type}` : '';
      const cmd = `find "${path || '.'}" ${t} -name "${name}" 2>/dev/null | head -50`;
      bus.emit('task:progress', { tool: 'search', running: true, phase: 'find', target: path || '.', log: `finding: ${name}` });
      const r = await runCmd(cmd);
      bus.emit('task:progress', { tool: 'search', running: false, phase: 'done', target: path || '.' });
      return { pattern: name, matches: r.stdout.split('\n').filter(Boolean).length, files: r.stdout.split('\n').filter(Boolean) };
    },
  },

  web: {
    required: ['url'],
    handler: async ({ url, maxChars }) => {
      log('search', `[WEB] fetch: ${url}`);
      const r = await httpGet(url, maxChars || 8000);
      return { url, status: r.status, body: r.body.slice(0, maxChars || 8000), length: r.body.length };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'search',
  description: 'Search: grep (text in files), find (files by name), web (fetch URL content)',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      pattern: { type: 'string', description: 'Search pattern (for grep/find)' },
      path: { type: 'string', description: 'Directory or URL' },
      name: { type: 'string', description: 'Filename glob (for find)' },
      type: { type: 'string', description: 'File type: f=file, d=dir' },
      ignoreCase: { type: 'boolean' },
      include: { type: 'string', description: 'Extension filter for grep' },
      context: { type: 'number', description: 'Context lines for grep' },
      url: { type: 'string', description: 'URL to fetch' },
      maxChars: { type: 'number', description: 'Max response chars' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown action: ${action}. Use: ${actionNames.join(', ')}`);
    for (const field of a.required) {
      if (params[field] === undefined) throw new Error(`Missing required: ${field}`);
    }
    return a.handler(params);
  },
};
