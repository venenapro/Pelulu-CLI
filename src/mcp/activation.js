/**
 * Activation — XiaoZhi device activation flow
 * Handles: code display, polling, timeout
 */
import https from 'https';
import { log } from '../core/logger.js';
import { bus } from '../core/event-bus.js';

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

export async function fetchOtaConfig(otaUrl, deviceId, clientId) {
  return httpPost(otaUrl, {
    application: { version: '1.0.0' },
    board: { type: 'linux', name: 'coding-agent', mac: deviceId },
  }, { 'Device-Id': deviceId, 'Client-Id': clientId });
}

export async function handleActivation(data, otaUrl, deviceId, clientId) {
  const a = data.activation;
  if (!a?.code) return data.mqtt;

  bus.emit('activation:required', { code: a.code });

  const timeout = a.timeout_ms || 120000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 5000));
    log('info', 'Checking activation...');
    const poll = await fetchOtaConfig(otaUrl, deviceId, clientId);
    if (!poll.activation?.code && poll.mqtt) {
      log('ok', 'Activated!');
      return poll.mqtt;
    }
  }
  throw new Error('Activation timed out');
}
