/**
 * ContextBuilder — Enhanced workspace context (OpenHands-style)
 * 
 * Builds rich context about the workspace including:
 * - Git status and history
 * - Project type and structure
 * - Recent files and changes
 * - Dependencies and configuration
 * - Runtime environment
 */
import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative, extname } from 'path';
import { exec } from 'child_process';
import { getConfig } from '../core/config.js';

function run(cmd, cwd, timeout = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout, maxBuffer: 256 * 1024 }, (_, stdout) => resolve(stdout?.trim() || ''));
  });
}

export class ContextBuilder {
  #cwd;
  #cache = new Map();
  #cacheTTL = 30000; // 30 seconds

  constructor(cwd) {
    this.#cwd = cwd || getConfig().agent?.workspace || process.cwd();
  }

  /**
   * Build full context
   */
  async build() {
    const sections = await Promise.all([
      this.#buildGitContext(),
      this.#buildProjectContext(),
      this.#buildRuntimeContext(),
      this.#buildFileSystemContext(),
    ]);

    return sections.filter(Boolean).join('\n\n');
  }

  /**
   * Build git context
   */
  async #buildGitContext() {
    if (!existsSync(join(this.#cwd, '.git'))) return null;

    const cacheKey = 'git';
    const cached = this.#getCache(cacheKey);
    if (cached) return cached;

    const [branch, status, lastCommits, remotes] = await Promise.all([
      run('git rev-parse --abbrev-ref HEAD', this.#cwd),
      run('git status --porcelain', this.#cwd),
      run('git log --oneline -5', this.#cwd),
      run('git remote -v', this.#cwd),
    ]);

    const changes = status.split('\n').filter(Boolean);
    const changeSummary = changes.length > 0
      ? `${changes.length} uncommitted change(s):\n${changes.slice(0, 10).map(c => `  ${c}`).join('\n')}${changes.length > 10 ? `\n  ... and ${changes.length - 10} more` : ''}`
      : 'Clean working tree';

    const sections = [
      `## Git`,
      `Branch: ${branch}`,
      changeSummary,
    ];

    if (lastCommits) {
      sections.push(`Recent commits:\n${lastCommits}`);
    }

    if (remotes) {
      const uniqueRemotes = [...new Set(remotes.split('\n').map(r => r.split('\t')[0]).filter(Boolean))];
      if (uniqueRemotes.length > 0) {
        sections.push(`Remotes: ${uniqueRemotes.join(', ')}`);
      }
    }

    const result = sections.join('\n');
    this.#setCache(cacheKey, result);
    return result;
  }

  /**
   * Build project context
   */
  async #buildProjectContext() {
    const cacheKey = 'project';
    const cached = this.#getCache(cacheKey);
    if (cached) return cached;

    const type = await this.#detectProjectType();
    const sections = [`## Project`, `Type: ${type}`];

    // Package.json (Node.js)
    if (type === 'node' || existsSync(join(this.#cwd, 'package.json'))) {
      try {
        const pkg = JSON.parse(await readFile(join(this.#cwd, 'package.json'), 'utf-8'));
        if (pkg.name) sections.push(`Name: ${pkg.name}@${pkg.version || '?'}`);
        if (pkg.scripts) {
          const scripts = Object.keys(pkg.scripts);
          sections.push(`Scripts: ${scripts.slice(0, 10).join(', ')}${scripts.length > 10 ? '...' : ''}`);
        }
        if (pkg.dependencies) {
          const deps = Object.keys(pkg.dependencies);
          sections.push(`Dependencies: ${deps.length} (${deps.slice(0, 5).join(', ')}${deps.length > 5 ? '...' : ''})`);
        }
      } catch {}
    }

    // pyproject.toml (Python)
    if (existsSync(join(this.#cwd, 'pyproject.toml'))) {
      try {
        const content = await readFile(join(this.#cwd, 'pyproject.toml'), 'utf-8');
        const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch) sections.push(`Name: ${nameMatch[1]}`);
      } catch {}
    }

    // README
    if (existsSync(join(this.#cwd, 'README.md'))) {
      try {
        const readme = await readFile(join(this.#cwd, 'README.md'), 'utf-8');
        const firstPara = readme.split('\n\n').find(p => p.trim() && !p.startsWith('#'));
        if (firstPara) {
          sections.push(`Description: ${firstPara.trim().slice(0, 200)}`);
        }
      } catch {}
    }

    const result = sections.join('\n');
    this.#setCache(cacheKey, result);
    return result;
  }

  /**
   * Build runtime context
   */
  async #buildRuntimeContext() {
    const [nodeVer, npmVer, osInfo] = await Promise.all([
      run('node --version', this.#cwd),
      run('npm --version', this.#cwd),
      run('uname -a', this.#cwd),
    ]);

    return [
      `## Runtime`,
      `Node: ${nodeVer}`,
      `npm: ${npmVer}`,
      `OS: ${osInfo}`,
      `Working Directory: ${this.#cwd}`,
    ].join('\n');
  }

  /**
   * Build file system context (recent files, structure)
   */
  async #buildFileSystemContext() {
    const cacheKey = 'filesystem';
    const cached = this.#getCache(cacheKey);
    if (cached) return cached;

    const sections = ['## Workspace Structure'];

    // Get top-level directory listing
    try {
      const entries = await readdir(this.#cwd, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
      const files = entries.filter(e => e.isFile()).map(e => e.name);

      if (dirs.length > 0) {
        sections.push(`Directories: ${dirs.slice(0, 15).join(', ')}${dirs.length > 15 ? '...' : ''}`);
      }
      if (files.length > 0) {
        sections.push(`Files: ${files.slice(0, 15).join(', ')}${files.length > 15 ? '...' : ''}`);
      }
    } catch {}

    // Recently modified files (via git)
    if (existsSync(join(this.#cwd, '.git'))) {
      const recentFiles = await run('git diff --name-only -10', this.#cwd);
      if (recentFiles) {
        sections.push(`Recently modified:\n${recentFiles}`);
      }
    }

    const result = sections.join('\n');
    this.#setCache(cacheKey, result);
    return result;
  }

  /**
   * Detect project type
   */
  async #detectProjectType() {
    const checks = [
      ['package.json', 'node'],
      ['requirements.txt', 'python'],
      ['pyproject.toml', 'python'],
      ['Cargo.toml', 'rust'],
      ['go.mod', 'go'],
      ['CMakeLists.txt', 'cmake'],
      ['Makefile', 'make'],
      ['pom.xml', 'java'],
      ['build.gradle', 'gradle'],
      ['Gemfile', 'ruby'],
      ['mix.exs', 'elixir'],
      ['composer.json', 'php'],
    ];

    for (const [file, type] of checks) {
      if (existsSync(join(this.#cwd, file))) return type;
    }

    // Check for common file types
    try {
      const files = await readdir(this.#cwd);
      const exts = files.map(f => extname(f).toLowerCase());
      if (exts.includes('.py')) return 'python';
      if (exts.includes('.js') || exts.includes('.ts')) return 'node';
      if (exts.includes('.rs')) return 'rust';
      if (exts.includes('.go')) return 'go';
    } catch {}

    return 'unknown';
  }

  /**
   * Get file tree for a specific directory
   */
  async getFileTree(dir, maxDepth = 3, currentDepth = 0) {
    if (currentDepth >= maxDepth) return [];

    const entries = [];
    try {
      const items = await readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.') || item.name === 'node_modules') continue;

        const fullPath = join(dir, item.name);
        const relPath = relative(this.#cwd, fullPath);

        if (item.isDirectory()) {
          entries.push({ path: relPath, type: 'dir' });
          const children = await this.getFileTree(fullPath, maxDepth, currentDepth + 1);
          entries.push(...children);
        } else {
          const s = await stat(fullPath).catch(() => null);
          entries.push({ path: relPath, type: 'file', size: s?.size || 0 });
        }
      }
    } catch {}

    return entries;
  }

  /**
   * Read a specific file with context
   */
  async readFileWithContext(filePath) {
    const content = await readFile(filePath, 'utf-8');
    const ext = extname(filePath).slice(1);
    const lines = content.split('\n');

    return {
      path: filePath,
      content,
      lines: lines.length,
      language: this.#detectLanguage(ext),
      size: content.length,
    };
  }

  #detectLanguage(ext) {
    const map = {
      js: 'javascript', mjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', tsx: 'typescript',
      py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
      java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
      md: 'markdown', html: 'html', css: 'css', sql: 'sql',
    };
    return map[ext] || 'unknown';
  }

  // Simple cache
  #getCache(key) {
    const entry = this.#cache.get(key);
    if (entry && Date.now() - entry.time < this.#cacheTTL) return entry.value;
    return null;
  }

  #setCache(key, value) {
    this.#cache.set(key, { value, time: Date.now() });
  }

  clearCache() {
    this.#cache.clear();
  }
}
