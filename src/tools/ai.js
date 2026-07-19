/**
 * AI Tool — code analysis helpers (1 MCP tool, 5 actions)
 * These are LOCAL helpers — the heavy lifting is done by XiaoZhi LLM via MQTT.
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { homedir } from 'os';

const HOME = homedir();

function safePath(p) {
  return resolve(p.replace(/^~(?=$|[/\\])/g, HOME));
}

function detectLanguage(file) {
  const ext = file.split('.').pop()?.toLowerCase();
  const map = {
    js: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'typescript',
    tsx: 'typescript', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', html: 'html', css: 'css', sql: 'sql',
  };
  return map[ext] || 'unknown';
}

function analyzeCode(content, lang) {
  const lines = content.split('\n');
  const stats = {
    totalLines: lines.length,
    blankLines: lines.filter(l => !l.trim()).length,
    commentLines: lines.filter(l => {
      const t = l.trim();
      return t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*');
    }).length,
    language: lang,
  };
  stats.codeLines = stats.totalLines - stats.blankLines - stats.commentLines;

  // Detect functions/classes
  const functions = [];
  const classes = [];
  for (const line of lines) {
    const fnMatch = line.match(/(?:function|def|fn|func|async\s+function)\s+(\w+)/);
    if (fnMatch) functions.push(fnMatch[1]);
    const clsMatch = line.match(/(?:class|struct|interface)\s+(\w+)/);
    if (clsMatch) classes.push(clsMatch[1]);
  }

  return { ...stats, functions: functions.slice(0, 20), classes: classes.slice(0, 10) };
}

const ACTIONS = {
  async explain({ path, code, language }) {
    const lang = language || (path ? detectLanguage(path) : 'unknown');
    return {
      language: lang,
      hint: 'To get a full explanation, send this code to XiaoZhi with: "Explain this code: <code>"',
      metadata: path ? { file: path } : null,
    };
  },

  async analyze({ path }) {
    if (!path) throw new Error('path required');
    const abs = safePath(path);
    const content = await readFile(abs, 'utf-8');
    const lang = detectLanguage(abs);
    return { file: abs, ...analyzeCode(content, lang) };
  },

  async detectLanguage({ path }) {
    if (!path) throw new Error('path required');
    return { file: path, language: detectLanguage(path) };
  },

  async summarize({ path }) {
    if (!path) throw new Error('path required');
    const abs = safePath(path);
    const content = await readFile(abs, 'utf-8');
    const lang = detectLanguage(abs);
    const analysis = analyzeCode(content, lang);
    const firstLine = content.split('\n').find(l => l.trim() && !l.trim().startsWith('#!'));
    return {
      file: abs,
      language: lang,
      summary: `${analysis.totalLines} lines, ${analysis.functions.length} functions, ${analysis.classes.length} classes`,
      firstLine: firstLine?.trim().slice(0, 100),
      stats: analysis,
    };
  },

  async diff({ file1, file2 }) {
    if (!file1 || !file2) throw new Error('file1 and file2 required');
    const c1 = (await readFile(safePath(file1), 'utf-8')).split('\n');
    const c2 = (await readFile(safePath(file2), 'utf-8')).split('\n');
    const changes = [];
    const maxLen = Math.max(c1.length, c2.length);
    for (let i = 0; i < maxLen; i++) {
      if (c1[i] !== c2[i]) {
        changes.push({ line: i + 1, file1: c1[i] || '(EOF)', file2: c2[i] || '(EOF)' });
      }
    }
    return { file1, file2, differences: changes.length, changes: changes.slice(0, 50) };
  },
};

export default {
  name: 'ai',
  description: 'Code analysis: explain, analyze, detectLanguage, summarize, diff (local helpers)',
  actions: Object.keys(ACTIONS).map(name => ({ name })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: Object.keys(ACTIONS) },
      path: { type: 'string', description: 'File path' },
      code: { type: 'string', description: 'Code snippet' },
      language: { type: 'string', description: 'Programming language' },
      file1: { type: 'string', description: 'First file (for diff)' },
      file2: { type: 'string', description: 'Second file (for diff)' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    if (!ACTIONS[action]) throw new Error(`Unknown action: ${action}. Use: ${Object.keys(ACTIONS).join(', ')}`);
    return ACTIONS[action](params);
  },
};
