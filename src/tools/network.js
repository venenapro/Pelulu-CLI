/**
 * Network Tool — network operations (1 MCP tool, 3 actions)
 */
import https from 'https';
import http from 'http';
import { exec } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { log } from '../core/logger.js';
import { request as httpClientRequest } from '../core/http-client.js';
import { bus } from '../core/event-bus.js';

const ACTIONS = {
  async fetch({ url, method, body, headers }) {
    if (!url) throw new Error('url required');
    const m = method || 'GET';
    log('network', `[WEB] ${m} ${url}`);
    const r = await httpClientRequest(url, { method: m, body, headers: headers || {}, timeout: 15000, followRedirects: true, maxBody: 200000 });
    return {
      url: r.finalUrl || url, status: r.status, headers: r.headers,
      redirects: r.redirectChain, duration_ms: r.duration_ms,
      body: r.body.slice(0, 8000), body_length: r.bytes,
    };
  },

  async download({ url, path }) {
    if (!url || !path) throw new Error('url and path required');
    log('network', `[DL] Downloading: ${url}`);
    const started = Date.now();
    const client = url.startsWith('https') ? https : http;

    bus.emit('task:progress', {
      tool: 'network', running: true, phase: 'download',
      target: url, elapsed: 0, log: 'starting download',
    });

    return new Promise((resolve, reject) => {
      client.get(url, { timeout: 60000, headers: { 'User-Agent': 'pelulu-cli/1.0' } }, async (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try { resolve(await ACTIONS.download({ url: res.headers.location, path })); } catch (e) { reject(e); }
          return;
        }
        if (res.statusCode !== 200) {
          bus.emit('task:progress', { tool: 'network', running: false, phase: 'error', target: url, log: `HTTP ${res.statusCode}` });
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        let lastReport = 0;

        // Track download progress
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          const now = Date.now();
          if (now - lastReport > 2000) { // report every 2s
            lastReport = now;
            const elapsed = Math.round((now - started) / 1000);
            const pct = totalBytes ? `${Math.round(downloaded / totalBytes * 100)}%` : `${Math.round(downloaded / 1024)}KB`;
            bus.emit('task:progress', {
              tool: 'network', running: true, phase: 'download',
              target: url, elapsed, log: `${pct} downloaded`,
            });
          }
        });

        const ws = createWriteStream(path);
        try {
          await pipeline(res, ws);
          const elapsed = Math.round((Date.now() - started) / 1000);
          bus.emit('task:progress', {
            tool: 'network', running: false, phase: 'done',
            target: url, elapsed, log: `${Math.round(downloaded / 1024)}KB saved`,
          });
          resolve({ downloaded: true, path, url, bytes: downloaded, elapsed_s: elapsed });
        } catch (e) {
          bus.emit('task:progress', { tool: 'network', running: false, phase: 'error', target: url, log: e.message });
          reject(e);
        }
      }).on('error', (e) => {
        bus.emit('task:progress', { tool: 'network', running: false, phase: 'error', target: url, log: e.message });
        reject(e);
      });
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
