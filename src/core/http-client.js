/**
 * Shared HTTP engine for all tools.
 *
 * Why this exists: previously every tool re-implemented raw http.request with
 * subtle differences and NONE of them decompressed responses. Real-world
 * servers (Cloudflare, nginx gzip, brotli via CDNs) return compressed bodies,
 * so body-based detection silently failed everywhere. This module centralizes:
 *   - transparent gzip / deflate / br decompression
 *   - accurate wall-clock timing (duration_ms) for time-based detection
 *   - real redirect following with a recorded chain + loop protection
 *   - bounded retries with backoff for transient network errors
 *   - a global concurrency limiter so batch scans don't self-DoS the target
 *   - a hard body-size cap to stay memory-safe on huge responses
 */
import https from 'https';
import http from 'http';
import zlib from 'zlib';
import { URL } from 'url';

export const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_MAX_BODY = 2 * 1024 * 1024; // 2 MB
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_RETRIES = 1;

// ---------------------------------------------------------------------------
// Global concurrency limiter (shared across every tool in the process).
// Keeps aggressive batch scanning from opening hundreds of sockets at once.
// ---------------------------------------------------------------------------
let MAX_CONCURRENCY = 8;
let active = 0;
const queue = [];

export function setMaxConcurrency(n) {
  MAX_CONCURRENCY = Math.max(1, n | 0);
}

function acquire() {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

function decompress(buffer, encoding) {
  if (!buffer || buffer.length === 0) return '';
  try {
    const enc = (encoding || '').toLowerCase();
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer).toString('utf8');
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer).toString('utf8');
    if (enc.includes('deflate')) {
      try {
        return zlib.inflateSync(buffer).toString('utf8');
      } catch {
        return zlib.inflateRawSync(buffer).toString('utf8');
      }
    }
  } catch {
    // Corrupt / partial compressed stream — fall back to raw bytes.
  }
  return buffer.toString('utf8');
}

function normalizeHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

/** Return set-cookie always as an array (Node gives array or string). */
function rawSetCookies(headers) {
  const sc = headers['set-cookie'];
  if (!sc) return [];
  return Array.isArray(sc) ? sc : [sc];
}

function singleRequest(rawUrl, opts) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = DEFAULT_TIMEOUT,
    maxBody = DEFAULT_MAX_BODY,
  } = opts;

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return reject(new Error(`Invalid URL: ${rawUrl}`));
    }
    const lib = parsed.protocol === 'https:' ? https : http;

    const outHeaders = {
      'User-Agent': DEFAULT_UA,
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'close',
      ...headers,
    };
    if (body && !outHeaders['Content-Length'] && !outHeaders['content-length']) {
      outHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const reqOpts = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method.toUpperCase(),
      headers: outHeaders,
      timeout,
      rejectUnauthorized: false,
    };

    const start = Date.now();
    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', (c) => {
        size += c.length;
        if (size <= maxBody) chunks.push(c);
        else truncated = true;
      });
      res.on('end', () => {
        const headersLower = normalizeHeaders(res.headers);
        const buf = Buffer.concat(chunks);
        const decoded = decompress(buf, headersLower['content-encoding']);
        resolve({
          status: res.statusCode,
          headers: headersLower,
          setCookies: rawSetCookies(headersLower),
          body: decoded,
          bytes: size,
          truncated,
          duration_ms: Date.now() - start,
          url: rawUrl,
          finalUrl: rawUrl,
          location: headersLower['location'] || null,
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeout}ms`));
    });
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(reqOpts.method)) req.write(body);
    req.end();
  });
}

/**
 * Perform an HTTP request with retries, redirect following and decompression.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {object} [options.headers]
 * @param {string} [options.body]
 * @param {number} [options.timeout=15000]
 * @param {boolean} [options.followRedirects=false]
 * @param {number} [options.maxRedirects=5]
 * @param {number} [options.retries=1]
 * @param {number} [options.maxBody]
 * @returns {Promise<object>} normalized response with duration_ms, redirectChain, etc.
 */
export async function request(url, options = {}) {
  const {
    followRedirects = false,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    retries = DEFAULT_RETRIES,
  } = options;

  await acquire();
  try {
    let attempt = 0;
    let lastErr;
    let res;
    // Retry loop for transient failures (ECONNRESET / timeouts / etc).
    while (attempt <= retries) {
      try {
        res = await singleRequest(url, options);
        break;
      } catch (err) {
        lastErr = err;
        attempt++;
        if (attempt > retries) throw lastErr;
        await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }

    const redirectChain = [];
    const visited = new Set([url]);
    let current = res;
    let hops = 0;
    let currentUrl = url;
    while (
      followRedirects &&
      current.status >= 300 &&
      current.status < 400 &&
      current.location &&
      hops < maxRedirects
    ) {
      let nextUrl;
      try {
        nextUrl = new URL(current.location, currentUrl).href;
      } catch {
        break;
      }
      redirectChain.push({ status: current.status, from: currentUrl, to: nextUrl });
      if (visited.has(nextUrl)) break; // loop guard: already fetched this absolute URL
      visited.add(nextUrl);
      // Per RFC, 303 (and commonly 301/302) downgrade to GET without a body.
      const nextMethod = [301, 302, 303].includes(current.status) ? 'GET' : options.method || 'GET';
      const nextBody = nextMethod === 'GET' ? null : options.body;
      current = await singleRequest(nextUrl, { ...options, method: nextMethod, body: nextBody });
      currentUrl = nextUrl;
      hops++;
    }

    current.redirectChain = redirectChain;
    current.finalUrl = currentUrl;
    current.requestedUrl = url;
    return current;
  } finally {
    release();
  }
}

/** Convenience GET. */
export function get(url, options = {}) {
  return request(url, { ...options, method: 'GET' });
}

/**
 * Run an async mapper over items with bounded parallelism.
 * (The global limiter also applies, but this keeps result ordering + batching.)
 */
export async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await mapper(items[i], i);
      } catch (err) {
        results[i] = { __error: err?.message || String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Parse a "key:value|key:value" header string into an object. */
export function parseHeaderString(headerStr) {
  const headers = {};
  if (!headerStr) return headers;
  for (const pair of headerStr.split('|')) {
    const idx = pair.indexOf(':');
    if (idx > 0) headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return headers;
}

export default { request, get, mapLimit, setMaxConcurrency, parseHeaderString, DEFAULT_UA };
