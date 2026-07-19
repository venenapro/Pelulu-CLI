/**
 * Context — inject workspace context into prompts
 * Like Claude Code: auto-detect project, git status, recent files
 */
import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getConfig } from './config.js';

function run(cmd, cwd, timeout = 5000) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout, maxBuffer: 256 * 1024 }, (_, stdout) => resolve(stdout?.trim() || ''));
  });
}

export async function buildContext() {
  const cfg = getConfig();
  const cwd = cfg.agent?.workspace || process.cwd();
  const lines = [];

  // Git context
  if (existsSync(join(cwd, '.git'))) {
    const branch = await run('git rev-parse --abbrev-ref HEAD', cwd);
    const status = await run('git status --porcelain', cwd);
    const lastCommit = await run('git log --oneline -1', cwd);
    lines.push(`Git: branch=${branch}, ${status.split('\n').filter(Boolean).length} changes`);
    if (lastCommit) lines.push(`Last commit: ${lastCommit}`);
  }

  // Project context
  const type = await detectType(cwd);
  lines.push(`Project: ${type}`);

  if (type === 'node') {
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8'));
      lines.push(`Package: ${pkg.name}@${pkg.version}`);
      if (pkg.scripts) lines.push(`Scripts: ${Object.keys(pkg.scripts).join(', ')}`);
    } catch {}
  }

  // Node/npm versions
  const nodeVer = await run('node --version', cwd);
  const npmVer = await run('npm --version', cwd);
  lines.push(`Runtime: node=${nodeVer}, npm=${npmVer}`);

  return lines.join('\n');
}

async function detectType(cwd) {
  const checks = [
    ['package.json', 'node'], ['requirements.txt', 'python'], ['pyproject.toml', 'python'],
    ['Cargo.toml', 'rust'], ['go.mod', 'go'], ['CMakeLists.txt', 'cmake'],
    ['Makefile', 'make'], ['pom.xml', 'java'], ['build.gradle', 'gradle'],
  ];
  for (const [file, type] of checks) {
    if (existsSync(join(cwd, file))) return type;
  }
  return 'unknown';
}

export async function getWorkspaceSummary() {
  const cfg = getConfig();
  const cwd = cfg.agent?.workspace || process.cwd();
  const type = await detectType(cwd);
  const git = existsSync(join(cwd, '.git'));
  return { path: cwd, type, hasGit: git };
}
