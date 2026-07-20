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
  }

  async connect() {
    if (!this.deviceId) this.deviceId = this._randomMac();
    if (!this.clientId) this.clientId = crypto.randomUUID();
    await this._persistIds();

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
      this.client = mqtt.connect(`mqtts://${this.mqttCfg.endpoint}:8883`, {
        clientId: this.mqttCfg.client_id,
        username: this.mqttCfg.username,
        password: this.mqttCfg.password,
        keepalive: 60,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        clean: true,
        protocolVersion: 4, // MQTT v3.1.1
      });

      this.client.on('connect', () => {
        this.connected = true;
        log('ok', 'MQTT Connected');
        this.client.subscribe('devices/p2p/#');
        this._sendHello();
        resolve();
      });

      this.client.on('message', (_, raw) => this._onMessage(raw));
      this.client.on('error', e => { log('err', `MQTT: ${e.message}`); bus.emit('mqtt:error', e); });
      this.client.on('close', () => {
        this.connected = false;
        this.sessionId = null;
        this.mcp.reset();
        this._helloQueue = [];
        log('warn', 'MQTT Disconnected');
      });
      this.client.on('reconnect', () => log('info', 'MQTT Reconnecting...'));
    });
  }

  _sendHello() {
    this.client.publish(this.mqttCfg.publish_topic, JSON.stringify({
      type: 'hello', version: 3, transport: 'udp',
      features: { mcp: true },
      audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
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
        this.mcp.executeTool(r.name, r.args)
          .then(result => { log('tool', result.isError ? 'failed' : 'done'); this._send({ type: 'mcp', payload: { jsonrpc: '2.0', id: r.id, result } }); })
          .catch(err => { this._send({ type: 'mcp', payload: { jsonrpc: '2.0', id: r.id, result: { content: [{ type: 'text', text: err.message }], isError: true } } }); });
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
    if (msg.type === 'goodbye') { this.sessionId = null; this.mcp.reset(); this._helloQueue = []; }
  }

  _send(msg) {
    if (!this.client || !this.mqttCfg) return;
    if (this.sessionId) msg.session_id = this.sessionId;
    this.client.publish(this.mqttCfg.publish_topic, JSON.stringify(msg));
  }

  sendText(text) {
    this._send({ type: 'listen', state: 'detect', text });
    log('user', `"${text}"`);
    bus.emit('user:text', text);
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
    if (this.client) { this.client.end(true); this.client = null; }
    this.connected = false;
  }
}
