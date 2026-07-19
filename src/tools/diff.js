/**
 * Diff Tool — file comparison (1 MCP tool, 3 actions)
 * Actions: compare, stats, patch
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';
import { showDiff } from '../core/diff.js';

const HOME = homedir();

function safe(p) {
  if (!p) throw new Error('path required');
  return resolve(p.replace(/^~(?=$|[/\\])/g, HOME));
}

function diffLines(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const changes = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) {
      changes.push({ line: i + 1, old: oldLines[i] || null, new: newLines[i] || null });
    }
  }
  return changes;
}

const ACTIONS = {
  compare: {
    required: ['file1', 'file2'],
    handler: async ({ file1, file2, context }) => {
      const abs1 = safe(file1);
      const abs2 = safe(file2);
      const c1 = await readFile(abs1, 'utf-8');
      const c2 = await readFile(abs2, 'utf-8');
      const changes = diffLines(c1, c2);
      const ctx = context || 3;

      // Build hunks with context
      const hunks = [];
      for (const change of changes) {
        const start = Math.max(0, change.line - ctx - 1);
        const end = Math.min(Math.max(c1.split('\n').length, c2.split('\n').length), change.line + ctx);
        const oldSlice = c1.split('\n').slice(start, end);
        const newSlice = c2.split('\n').slice(start, end);
        hunks.push({ line: change.line, old: change.old, new: change.new, context: { old: oldSlice, new: newSlice } });
      }

      return { file1: abs1, file2: abs2, totalChanges: changes.length, hunks: hunks.slice(0, 20) };
    },
    format: async ({ file1, file2 }) => {
      const c1 = await readFile(file1, 'utf-8').catch(() => '');
      const c2 = await readFile(file2, 'utf-8').catch(() => '');
      if (c1 && c2) showDiff(c1, c2, file1);
    },
  },

  stats: {
    required: ['file1', 'file2'],
    handler: async ({ file1, file2 }) => {
      const abs1 = safe(file1);
      const abs2 = safe(file2);
      const c1 = await readFile(abs1, 'utf-8');
      const c2 = await readFile(abs2, 'utf-8');
      const changes = diffLines(c1, c2);
      const l1 = c1.split('\n').length;
      const l2 = c2.split('\n').length;
      return {
        file1: abs1, file2: abs2,
        lines1: l1, lines2: l2,
        changes: changes.length,
        identical: changes.length === 0,
      };
    },
  },

  patch: {
    required: ['file1', 'file2'],
    handler: async ({ file1, file2 }) => {
      const abs1 = safe(file1);
      const abs2 = safe(file2);
      const c1 = await readFile(abs1, 'utf-8');
      const c2 = await readFile(abs2, 'utf-8');
      const changes = diffLines(c1, c2);

      const patch = [`--- ${abs1}`, `+++ ${abs2}`];
      for (const change of changes.slice(0, 50)) {
        if (change.old !== null) patch.push(`-${change.old}`);
        if (change.new !== null) patch.push(`+${change.new}`);
      }

      return { patch: patch.join('\n'), changes: changes.length };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'diff',
  description: 'File comparison: compare, stats, patch',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      file1: { type: 'string', description: 'First file path' },
      file2: { type: 'string', description: 'Second file path' },
      context: { type: 'number', description: 'Context lines (default 3)' },
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
