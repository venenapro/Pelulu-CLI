/**
 * scripts/lib/harness.js — Shared XiaoZhi test harness
 * ----------------------------------------------------
 * A thin, dependency-free wrapper around the REAL XiaoZhi transport used by all
 * the exploration/limit scripts. It runs the OTA handshake, opens an MQTT
 * connection, and exposes a tiny promise-based API for sending text and
 * collecting the resulting server events with timing.
 *
 * This deliberately talks the raw protocol (not the app's AgentController) so
 * capability probes can measure the SERVER's behaviour and limits directly,
 * without the agent loop's buffering/timeouts getting in the way.
 */
import mqtt from 'mqtt';
import { loadConfig } from '../../src/core/config.js';
import { fetchOtaConfig, handleActivation } from '../../src/mcp/activation.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export class Harness {
  constructor({ quiet = false } = {}) {
    this.quiet = quiet;
    this.client = null;
    this.cfg = null;
    this.sessionId = null;
    this.listeners = new Set();
    this._closed = false;
    // Persistent record of MCP JSON-RPC methods the server has requested
    // (initialize, tools/list, tools/call, ...). Captured from the very first
    // message so probes that attach later can still tell the handshake ran —
    // it happens right after hello, during connect().
    this.mcpMethods = [];
  }

  log(...a) { if (!this.quiet) console.log(...a); }

  /** Run OTA + connect + wait for the first hello/session. */
  async connect({ systemPrompt } = {}) {
    const config = await loadConfig(ROOT);
    const { device_id: deviceId, client_id: clientId, ota_url } = config.mqtt;
    const ota = await fetchOtaConfig(ota_url, deviceId, clientId);
    this.cfg = await handleActivation(ota, ota_url, deviceId, clientId);

    await new Promise((resolve, reject) => {
      this.client = mqtt.connect(`mqtts://${this.cfg.endpoint}:8883`, {
        clientId: this.cfg.client_id,
        username: this.cfg.username,
        password: this.cfg.password,
        keepalive: 60,
        reconnectPeriod: 0,
        connectTimeout: 15000,
        clean: true,
        protocolVersion: 4,
      });
      const t = setTimeout(() => reject(new Error('connect timeout')), 20000);
      this.client.on('connect', () => {
        clearTimeout(t);
        this.client.subscribe('devices/p2p/#');
        const hello = {
          type: 'hello', version: 3, transport: 'udp', features: { mcp: true },
          audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
        };
        if (systemPrompt) hello.system_prompt = systemPrompt;
        this.client.publish(this.cfg.publish_topic, JSON.stringify(hello));
        resolve();
      });
      this.client.on('error', (e) => { clearTimeout(t); reject(e); });
      this.client.on('close', () => { this._closed = true; this._emit({ type: '__closed__' }); });
      this.client.on('message', (_, raw) => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.session_id) this.sessionId = msg.session_id;
        if (msg.type === 'mcp' && msg.payload?.method) this.mcpMethods.push(msg.payload.method);
        this._emit(msg);
      });
    });

    // Wait for the initial hello so a session exists.
    await this.waitFor((m) => m.type === 'hello', 15000).catch(() => null);
    return this;
  }

  _emit(msg) { for (const fn of this.listeners) fn(msg); }

  onMessage(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Resolve on the first message matching predicate, else reject on timeout. */
  waitFor(predicate, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const off = this.onMessage((m) => {
        if (predicate(m)) { off(); clearTimeout(t); resolve(m); }
      });
      const t = setTimeout(() => { off(); reject(new Error('timeout')); }, timeoutMs);
    });
  }

  /** Publish a raw object to the device publish topic. */
  publish(obj) {
    if (this.sessionId && !obj.session_id) obj.session_id = this.sessionId;
    this.client.publish(this.cfg.publish_topic, JSON.stringify(obj));
  }

  /**
   * Send a text turn and collect the whole reply. Resolves with:
   *   { replied, latencyMs, sentences[], stt, closed, raw[] }
   * `replied` is true if any tts sentence_start / llm text came back.
   * Resolves after `quietMs` of silence following the first reply, or after
   * `timeoutMs` with no reply at all.
   */
  sendText(text, { timeoutMs = 12000, quietMs = 2500 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const out = { replied: false, latencyMs: null, sentences: [], stt: null, closed: false, raw: [] };
      let quiet = null;
      const done = () => { off(); clearTimeout(hard); clearTimeout(quiet); resolve(out); };
      const off = this.onMessage((m) => {
        out.raw.push(m.type);
        if (m.type === '__closed__') { out.closed = true; return done(); }
        if (m.type === 'stt') out.stt = m.text;
        const isReply =
          (m.type === 'tts' && m.state === 'sentence_start' && m.text) ||
          (m.type === 'llm' && m.text);
        if (isReply) {
          if (!out.replied) { out.replied = true; out.latencyMs = Date.now() - start; }
          out.sentences.push(m.text);
          clearTimeout(quiet);
          quiet = setTimeout(done, quietMs);
        }
      });
      const hard = setTimeout(done, timeoutMs);
      this.publish({ type: 'listen', state: 'detect', text });
    });
  }

  close() {
    this._closed = true;
    if (this.client) { try { this.client.removeAllListeners(); this.client.end(true); } catch {} }
  }
}
