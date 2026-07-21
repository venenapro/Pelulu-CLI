#!/usr/bin/env node
/**
 * scripts/probe.js — Raw XiaoZhi protocol probe
 * -----------------------------------------------
 * Connects to the REAL XiaoZhi broker using the credentials in config.json,
 * sends a "listen/detect" text message, and logs EVERY raw message the server
 * sends back (stt, llm, tts sentence_start/stop, mcp, etc).
 *
 * This isolates the transport/protocol layer from the app's agent logic, so we
 * can confirm the broker itself is healthy. Handy any time responses seem to
 * stop — run this first to prove whether the issue is the server or our code.
 *
 * Usage:  node scripts/probe.js ["your message"]
 */
import { loadConfig } from '../src/core/config.js';
import { fetchOtaConfig, handleActivation } from '../src/mcp/activation.js';
import mqtt from 'mqtt';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MESSAGE = process.argv[2] || 'halo';

const config = await loadConfig(ROOT);
const { device_id: deviceId, client_id: clientId, ota_url } = config.mqtt;

console.log(`[probe] OTA handshake for device ${deviceId}...`);
const ota = await fetchOtaConfig(ota_url, deviceId, clientId);
const cfg = await handleActivation(ota, ota_url, deviceId, clientId);
console.log(`[probe] connecting to ${cfg.endpoint}...`);

const client = mqtt.connect(`mqtts://${cfg.endpoint}`, {
  clientId: cfg.client_id,
  username: cfg.username,
  password: cfg.password,
  protocolVersion: 4,
  reconnectPeriod: 0,
});

let sessionId = null;

client.on('connect', () => {
  console.log('[probe] connected, subscribing...');
  client.subscribe(cfg.subscribe_topic);
  // Open a listen session and inject text (spec: listen/detect)
  const hello = { type: 'hello', version: 3, transport: 'mqtt', audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 } };
  client.publish(cfg.publish_topic, JSON.stringify(hello));
});

client.on('message', (topic, payload) => {
  let msg;
  try { msg = JSON.parse(payload.toString()); } catch { return console.log('[recv:raw]', payload.toString()); }
  console.log(`[recv] type=${msg.type}`, JSON.stringify(msg).slice(0, 300));

  if (msg.type === 'hello') {
    sessionId = msg.session_id;
    console.log(`[probe] session=${sessionId} -> sending text: "${MESSAGE}"`);
    const detect = { type: 'listen', state: 'detect', text: MESSAGE, session_id: sessionId };
    client.publish(cfg.publish_topic, JSON.stringify(detect));
  }
});

client.on('error', (e) => console.error('[probe] error:', e.message));

// Auto-exit after 45s
setTimeout(() => { console.log('[probe] done.'); client.end(true); process.exit(0); }, 45000);
