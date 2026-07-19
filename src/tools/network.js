/**
 * Network Tool — network operations (1 MCP tool, 3 actions)
 */
import https from 'https';
import http from 'http';
import { exec } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { log } from '../core/logger.js';

function httpGet(url, maxChars = 5000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 15000, headers: { 'User-Agent': 'coding-agent/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, maxChars).then(resolve, reject);
      }
      let d = '';
      res.on('data', c => { if (d.length < maxChars) d += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    }).on('error', reject);
  });
}

const ACTIONS = {
  async fetch({ url, method, body, headers }) {
    if (!url) throw new Error('url required');
    log('network', `🌐 ${method || 'GET'} ${url}`);
    const result = await httpGet(url);
    return { url, status: result.status, body: result.body.slice(0, 5000) };
  },

  async download({ url, path }) {
    if (!url || !path) throw new Error('url and path required');
    log('network', `📥 Downloading: ${url}`);
    const client = url.startsWith('https') ? https : http;
    return new Promise((resolve, reject) => {
      client.get(url, { timeout: 30000, headers: { 'User-Agent': 'coding-agent/1.0' } }, async (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try { resolve(await ACTIONS.download({ url: res.headers.location, path })); } catch (e) { reject(e); }
          return;
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const ws = createWriteStream(path);
        try {
          await pipeline(res, ws);
          resolve({ downloaded: true, path, url });
        } catch (e) { reject(e); }
      }).on('error', reject);
    });
  },

  async ping({ host, count }) {
    if (!host) throw new Error('host required');
    const n = count || 3;
    const r = await new Promise((resolve) => {
      exec(`ping -c ${n} "${host}"`, { timeout: 15000 }, (_, stdout, stderr) => {
        resolve({ stdout: stdout?.trim() || '', stderr: stderr?.trim() || '' });
      });
    });
    return { host, result: r.stdout || r.stderr };
  },
};

export default {
  name: 'network',
  description: 'Network operations: fetch (HTTP request), download (save file), ping',
  actions: Object.keys(ACTIONS).map(name => ({ name })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: Object.keys(ACTIONS) },
      url: { type: 'string', description: 'URL' },
      method: { type: 'string', description: 'HTTP method' },
      body: { type: 'string', description: 'Request body' },
      headers: { type: 'object', description: 'Request headers' },
      path: { type: 'string', description: 'Save path (for download)' },
      host: { type: 'string', description: 'Host to ping' },
      count: { type: 'number', description: 'Ping count' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    if (!ACTIONS[action]) throw new Error(`Unknown action: ${action}. Use: ${Object.keys(ACTIONS).join(', ')}`);
    return ACTIONS[action](params);
  },
};
