/**
 * MqttClient — XiaoZhi MQTT connection + MCP
 * Uses MQTT library's built-in reconnect (reconnectPeriod: 5000)
 */
import mqtt from 'mqtt';
import crypto from 'crypto';
import { log, debug } from '../core/logger.js';
import { bus } from '../core/event-bus.js';
import { McpHandler } from './mcp-handler.js';
import { fetchOtaConfig, handleActivation } from './activation.js';

// Max serialized bytes for a single MQTT publish. The XiaoZhi broker drops the
// connection the instant a message crosses ~8KB (see specifications/
// xiaozhi-mqtt-broker.md). tools/list is already guarded; tool RESULTS must be
// clamped here too, otherwise a single large file.read / recursive list / shell
// dump silently kills the whole connection.
const MAX_MQTT_BYTES = 7800;

export class MqttClient {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.connected = false;
    this.sessionId = null;
    this.deviceId = config.mqtt?.device_id || null;
    this.clientId = config.mqtt?.client_id || null;
    this.mqttCfg = null;
    this.mcp = new McpHandler();
    this._helloQueue = [];
    // Reconnection state — we manage reconnect ourselves because the broker
    // hands out FRESH credentials from OTA on every connection (cached creds
    // are rejected), so mqtt.js's built-in reconnect can never recover.
    this._manualClose = false;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    // Whether the agent is mid-turn. XiaoZhi closes idle audio sessions with a
    // `goodbye`; if that lands while we're still working we must keep the
    // session warm (re-`hello`) instead of letting it "pause" — otherwise the
    // next tool result / spoken reply is silently dropped and the user sees a
    // confusing "session paused" mid-task. Driven by the agent lifecycle events.
    this._busy = false;
    this._resuming = false;
    bus.on('agent:state', ({ to }) => { this._busy = to === 'thinking' || to === 'acting'; });
    bus.on('agent:progress', ({ state }) => {
      if (state === 'done' || state === 'timeout') this._busy = false;
      else if (state === 'thinking' || state === 'tool' || state === 'tool_done' || state === 'receiving') this._busy = true;
    });
  }

  async connect() {
    if (!this.deviceId) this.deviceId = this._randomMac();
    if (!this.clientId) this.clientId = crypto.randomUUID();
    await this._persistIds();
    this._manualClose = false;
    return this._refreshAndConnect();
  }

  /**
   * Fetch fresh OTA credentials, then (re)connect. Used for the initial
   * connection AND every reconnect — the broker requires new credentials
   * each time, so we must always re-run the OTA handshake.
   */
  async _refreshAndConnect() {
    log('info', 'Fetching device config...');
    const data = await fetchOtaConfig(this.config.mqtt.ota_url, this.deviceId, this.clientId);
    this.mqttCfg = await handleActivation(data, this.config.mqtt.ota_url, this.deviceId, this.clientId);
    log('info', `MQTT: ${this.mqttCfg.endpoint}`);
    return this._connectMqtt();
  }

  async _persistIds() {
    if (this.config.mqtt?.device_id) return;
    this.config.mqtt = { ...this.config.mqtt, device_id: this.deviceId, client_id: this.clientId };
    try {
      const { saveConfig } = await import('../core/config.js');
      await saveConfig(this.config._root, this.config);
      log('info', 'Device ID saved');
    } catch (e) { debug(`Config save: ${e.message}`); }
  }

  _connectMqtt() {
    return new Promise((resolve, reject) => {
      // Tear down any previous client so we never leak listeners / sockets.
      if (this.client) {
        try { this.client.removeAllListeners(); this.client.end(true); } catch {}
        this.client = null;
      }

      this.client = mqtt.connect(`mqtts://${this.mqttCfg.endpoint}:8883`, {
        clientId: this.mqttCfg.client_id,
        username: this.mqttCfg.username,
        password: this.mqttCfg.password,
        keepalive: 60,
        reconnectPeriod: 0, // we manage reconnect ourselves (fresh OTA creds required)
        connectTimeout: 15000,
        clean: true,
        protocolVersion: 4, // MQTT v3.1.1
      });

      let settled = false;

      this.client.on('connect', () => {
        this.connected = true;
        this._reconnectAttempts = 0;
        log('ok', 'MQTT Connected');
        this.client.subscribe('devices/p2p/#');
        this._sendHello();
        bus.emit('mqtt:connected');
        if (!settled) { settled = true; resolve(); }
      });

      this.client.on('message', (_, raw) => this._onMessage(raw));
      this.client.on('error', e => { log('err', `MQTT: ${e.message}`); bus.emit('mqtt:error', e); });
      this.client.on('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.sessionId = null;
        // A dropped MQTT connection invalidates the whole MCP handshake — the
        // server re-runs initialize/tools/list on the next connection, so a
        // full reset here is correct (unlike a `goodbye`, see _onOther).
        this.mcp.reset();
        this._helloQueue = [];
        if (wasConnected) log('warn', 'MQTT Disconnected');
        bus.emit('mqtt:disconnected');
        // Kick off our own reconnect (fresh OTA credentials) unless the user
        // asked to disconnect. This is what recovers from the sudden drops.
        if (!this._manualClose) this._scheduleReconnect();
        if (!settled) { settled = true; reject(new Error('MQTT connection closed before ready')); }
      });
    });
  }

  /**
   * Reconnect with exponential backoff. Each attempt re-fetches OTA config so
   * we always present valid, fresh credentials to the broker.
   */
  _scheduleReconnect() {
    if (this._reconnectTimer || this._manualClose) return;
    this._reconnectAttempts++;
    const delay = Math.min(30000, 2000 * Math.pow(1.6, Math.min(this._reconnectAttempts - 1, 6)));
    log('info', `MQTT reconnecting in ${Math.round(delay / 1000)}s (attempt ${this._reconnectAttempts})...`);
    bus.emit('mqtt:reconnecting', { attempt: this._reconnectAttempts, delay });
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._manualClose) return;
      try {
        await this._refreshAndConnect();
        log('ok', 'MQTT reconnected');
        bus.emit('mqtt:reconnected');
      } catch (e) {
        log('err', `Reconnect failed: ${e.message}`);
        this._scheduleReconnect();
      }
    }, delay);
  }

  _sendHello() {
    this.client.publish(this.mqttCfg.publish_topic, JSON.stringify({
      type: 'hello', version: 3, transport: 'udp',
      features: { mcp: true },
      audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
      system_prompt: 'You are Pelulu, a CLI coding agent. When the user asks to create, write, or edit files, you MUST use the file tool (action write/edit/mkdir) — actually do it, never just describe it. For multi-file work, call the tools one after another until the whole task is done. When you finish, ALWAYS say one short sentence confirming what you did (e.g. "Done, created 3 files.") so the client knows the turn is complete. Keep spoken replies short.',
    }));
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.session_id) this.sessionId = msg.session_id;

    if (msg.type === 'hello') {
      if (!this.mcp.toolsReceived) { this._helloQueue.push(msg); return; }
      this._onHello(msg);
    } else if (msg.type === 'mcp') {
      this._onMcp(msg);
    } else {
      this._onOther(msg);
    }
  }

  _onHello(msg) {
    this.sessionId = msg.session_id;
    log('ok', `Session: ${this.sessionId}`);
    bus.emit('ready');
  }

  _onMcp(msg) {
    const responses = this.mcp.handleMessage(msg);
    for (const r of responses) {
      if (r.type === 'mcp') { this._send(r); }
      else if (r.type === 'tool_call') {
        log('tool', r.name);
        // Emit tool call event so agent can track it
        bus.emit('mcp:tool_call', { name: r.name, args: r.args, id: r.id });
        this.mcp.executeTool(r.name, r.args)
          .then(result => {
            log('tool', result.isError ? 'failed' : 'done');
            this._send({ type: 'mcp', payload: { jsonrpc: '2.0', id: r.id, result: this._clampResult(result) } });
            // Emit tool result event
            bus.emit('mcp:tool_result', { name: r.name, args: r.args, result, id: r.id });
          })
          .catch(err => {
            const errResult = { content: [{ type: 'text', text: err.message }], isError: true };
            this._send({ type: 'mcp', payload: { jsonrpc: '2.0', id: r.id, result: this._clampResult(errResult) } });
            bus.emit('mcp:tool_result', { name: r.name, args: r.args, result: errResult, id: r.id });
          });
      }
    }
    if (this.mcp.toolsReceived && this._helloQueue.length) {
      for (const h of this._helloQueue) this._onHello(h);
      this._helloQueue = [];
    }
  }

  _onOther(msg) {
    if (msg.type === 'stt') { log('user', `"${msg.text}"`); bus.emit('stt', msg.text); }
    if (msg.type === 'llm' && msg.text) { bus.emit('llm:text', msg.text); }
    if (msg.type === 'tts' && msg.state === 'sentence_start' && msg.text) { bus.emit('tts:sentence', msg.text); }
    if (msg.type === 'goodbye') {
      // A server `goodbye` only closes the audio SESSION — the MQTT connection
      // and the MCP handshake (tools/list) remain valid. So we must NOT reset
      // the MCP handler here; doing so made ensureSession() wait forever for a
      // tools/list that never comes again, which looked like a permanent
      // disconnect. We only drop the session id; the next message re-opens a
      // session via a fresh hello (see ensureSession).
      this.sessionId = null;
      bus.emit('session:end', { busy: this._busy });
      // Stay connected while there's still work in progress. If the agent is
      // mid-turn we immediately re-open the session so XiaoZhi's remaining tool
      // calls / spoken reply keep flowing, instead of pausing until the user
      // types again. The MCP handshake is still valid, so this is a cheap
      // `hello` round-trip, not a full reconnect.
      if (this._busy && !this._manualClose && this.mcp.toolsReceived && !this._resuming) {
        this._resuming = true;
        this.ensureSession()
          .then(ok => { if (ok) bus.emit('session:resumed'); })
          .catch(() => {})
          .finally(() => { this._resuming = false; });
      }
    }
  }

  /**
   * Clamp an MCP tool-result so the serialized MQTT message stays under the
   * broker's ~8KB limit. Oversized output (large file reads, recursive
   * listings, shell dumps, search hits) would otherwise drop the whole
   * connection the moment it's published. We truncate the result text and
   * append a clear notice so the model knows the output was cut and can fetch
   * the rest with a narrower request (e.g. offset/limit on file reads).
   */
  _clampResult(result) {
    const measure = (res) => Buffer.byteLength(JSON.stringify({
      type: 'mcp', payload: { jsonrpc: '2.0', id: 0, result: res }, session_id: this.sessionId || '',
    }));
    try {
      if (measure(result) <= MAX_MQTT_BYTES) return result;

      const text = result?.content?.[0]?.text;
      if (typeof text !== 'string') return result; // can't safely trim non-text

      const notice = '\n\n[output truncated: exceeded the 8KB transport limit — request less at once (e.g. use offset/limit for file reads or a narrower query)]';
      // Binary-search the largest text prefix that still fits once re-wrapped.
      let lo = 0, hi = text.length, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const candidate = { ...result, content: [{ type: 'text', text: text.slice(0, mid) + notice }] };
        if (measure(candidate) <= MAX_MQTT_BYTES) { best = mid; lo = mid + 1; }
        else { hi = mid - 1; }
      }
      log('warn', `Tool result truncated to ${best}/${text.length} chars to fit 8KB`);
      return { ...result, content: [{ type: 'text', text: text.slice(0, best) + notice }] };
    } catch { return result; }
  }

  _send(msg) {
    if (!this.client || !this.mqttCfg) return;
    if (this.sessionId) msg.session_id = this.sessionId;
    const payload = JSON.stringify(msg);
    // Final safety net: never publish a message that would trip the broker's
    // ~8KB cutoff and drop the connection. Results are pre-clamped above; this
    // catches any other oversized message type before it does damage.
    if (Buffer.byteLength(payload) > MAX_MQTT_BYTES) {
      log('warn', `Dropping oversized MQTT message (${Buffer.byteLength(payload)} bytes > ${MAX_MQTT_BYTES})`);
      return;
    }
    this.client.publish(this.mqttCfg.publish_topic, payload);
  }

  /**
   * Ensure a live XiaoZhi session exists before sending.
   * XiaoZhi ends idle sessions with `goodbye` (common during long local
   * tasks). When that happens we must re-send `hello` to get a fresh session
   * + MCP handshake, otherwise all further messages are silently dropped.
   * Resolves true once ready, false on timeout.
   */
  async ensureSession(timeoutMs = 15000) {
    if (this.sessionId && this.mcp.toolsReceived) return true;
    if (!this.client) return false;

    // Re-initiate the handshake (server replies with a new hello + session_id)
    this._sendHello();

    return new Promise((resolve) => {
      if (this.sessionId && this.mcp.toolsReceived) return resolve(true);
      const onReady = () => { cleanup(); resolve(true); };
      const poll = setInterval(() => {
        if (this.sessionId && this.mcp.toolsReceived) { cleanup(); resolve(true); }
      }, 200);
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      const cleanup = () => { clearInterval(poll); clearTimeout(timer); bus.off('ready', onReady); };
      bus.on('ready', onReady);
    });
  }

  async sendText(text) {
    // Re-establish the session if XiaoZhi dropped it while idle.
    const ok = await this.ensureSession();
    if (!ok) { bus.emit('session:dead'); return false; }
    this._send({ type: 'listen', state: 'detect', text });
    log('user', `"${text}"`);
    bus.emit('user:text', text);
    return true;
  }

  abort() { this._send({ type: 'abort' }); }

  registerToolHandler(handler, toolsFn) {
    this.mcp.setToolCaller(handler);
    this.mcp.setToolProvider(toolsFn);
  }

  _randomMac() {
    return Array.from(crypto.randomBytes(6)).map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
  }

  disconnect() {
    this._manualClose = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.client) {
      try { this.client.removeAllListeners(); this.client.end(true); } catch {}
      this.client = null;
    }
    this.connected = false;
  }
}
