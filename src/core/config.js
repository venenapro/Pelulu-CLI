/**
 * Config — load, merge, save configuration
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CONFIG_FILE = 'config.json';
const HOME = homedir();

function expand(p) {
  return p?.replace(/^~(?=$|[/\\])/g, HOME) ?? p;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

let _config = null;

export async function loadConfig(root) {
  const path = join(root, CONFIG_FILE);
  const defaults = {
    agent: { name: 'Pelulu CLI', version: '1.0.0', workspace: '~/Pelulu-CLI' },
    mqtt: { ota_url: 'https://api.tenclass.net/xiaozhi/ota/', keepalive: 240 },
    mcp: { endpoint_url: '' },
    tools: { shell_timeout: 30000, max_output: 10000, auto_format: true },
    plugins: { enabled: [], disabled: [] },
  };

  if (existsSync(path)) {
    try {
      const raw = await readFile(path, 'utf-8');
      _config = deepMerge(defaults, JSON.parse(raw));
    } catch { _config = defaults; }
  } else {
    _config = defaults;
    await saveConfig(root, _config);
  }

  _config._root = root;
  _config._path = path;
  _config.agent.workspace = expand(_config.agent.workspace);
  return _config;
}

export function getConfig() {
  if (!_config) throw new Error('Config not loaded');
  return _config;
}

export async function saveConfig(root, config) {
  const path = join(root, CONFIG_FILE);
  await mkdir(dirname(path), { recursive: true });
  const { _root, _path, ...clean } = config;
  await writeFile(path, JSON.stringify(clean, null, 2), 'utf-8');
}

export { expand };
