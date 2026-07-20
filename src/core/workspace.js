/**
 * Workspace — auto-detect project type, structure, and capabilities
 */
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { getConfig } from './config.js';

const PROJECT_TYPES = {
  'package.json': { type: 'node', lang: 'javascript/typescript' },
  'requirements.txt': { type: 'python', lang: 'python' },
  'pyproject.toml': { type: 'python', lang: 'python' },
  'Cargo.toml': { type: 'rust', lang: 'rust' },
  'go.mod': { type: 'go', lang: 'go' },
  'CMakeLists.txt': { type: 'cmake', lang: 'c/c++' },
  'Makefile': { type: 'make', lang: 'varies' },
  'pom.xml': { type: 'maven', lang: 'java' },
  'build.gradle': { type: 'gradle', lang: 'java/kotlin' },
  'Gemfile': { type: 'ruby', lang: 'ruby' },
  'composer.json': { type: 'composer', lang: 'php' },
};

export async function detectWorkspace(dir) {
  const cwd = dir || getConfig().agent?.workspace || process.cwd();
  const info = {
    path: cwd,
    name: basename(cwd),
    type: 'unknown',
    language: 'unknown',
    files: [],
    structure: {},
  };

  // Detect project type
  for (const [file, meta] of Object.entries(PROJECT_TYPES)) {
    if (existsSync(join(cwd, file))) {
      info.type = meta.type;
      info.language = meta.lang;
      info.marker = file;
      break;
    }
  }

  // Read key config files
  if (info.type === 'node') {
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8'));
      info.name = pkg.name || info.name;
      info.version = pkg.version;
      info.scripts = Object.keys(pkg.scripts || {});
      info.dependencies = Object.keys(pkg.dependencies || {});
      info.devDependencies = Object.keys(pkg.devDependencies || {});
      info.moduleType = pkg.type || 'commonjs';
    } catch {}
  }

  if (info.type === 'python') {
    try {
      if (existsSync(join(cwd, 'pyproject.toml'))) {
        const content = await readFile(join(cwd, 'pyproject.toml'), 'utf-8');
        const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch) info.name = nameMatch[1];
      }
    } catch {}
  }

  // Detect common directories
  const commonDirs = ['src', 'lib', 'test', 'tests', 'spec', 'docs', 'public', 'dist', 'build', 'bin'];
  try {
    const entries = await readdir(cwd, { withFileTypes: true });
    info.dirs = entries.filter(e => e.isDirectory() && commonDirs.includes(e.name)).map(e => e.name);
    info.files = entries.filter(e => e.isFile()).map(e => e.name).slice(0, 30);
  } catch {}

  // Detect git
  info.hasGit = existsSync(join(cwd, '.git'));
  info.hasDocker = existsSync(join(cwd, 'Dockerfile')) || existsSync(join(cwd, 'docker-compose.yml'));
  info.hasCI = existsSync(join(cwd, '.github')) || existsSync(join(cwd, '.gitlab-ci.yml'));

  return info;
}

export function formatWorkspace(info) {
  const lines = [
    `[DIR] ${info.name} (${info.type})`,
    `   Language: ${info.language}`,
    `   Path: ${info.path}`,
  ];
  if (info.version) lines.push(`   Version: ${info.version}`);
  if (info.scripts?.length) lines.push(`   Scripts: ${info.scripts.join(', ')}`);
  if (info.dirs?.length) lines.push(`   Dirs: ${info.dirs.join(', ')}`);
  if (info.hasGit) lines.push('   Git: [OK]');
  if (info.hasDocker) lines.push('   Docker: [OK]');
  if (info.hasCI) lines.push('   CI: [OK]');
  return lines.join('\n');
}
