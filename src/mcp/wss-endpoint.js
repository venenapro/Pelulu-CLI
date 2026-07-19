/**
 * WssEndpoint — official XiaoZhi MCP endpoint (WSS)
 * Alternative to MQTT-based tool serving
 * Reference: https://github.com/78/mcp-calculator/blob/main/mcp_pipe.py
 */
import WebSocket from 'ws';
import { log, debug } from '../core/logger.js';

const INITIAL_BACKOFF = 1000;
const MAX_BACKOFF = 60000;
const HEARTBEAT_INTERVAL = 25000;

export class WssEndpoint {
  constructor(url, getTools, callTool) {
    this.url = url;
    this.getTools = getTools;
    this.callTool = callTool;
    this.ws = null;
    this.backoff = INITIAL_BACKOFF;
    this.closed = false;
    this.nameMap = new Map();
    this._heartbeat = null;
    this._reconnectTimer = null;
  }

  start() {
    if (!this.url) { debug('WSS endpoint: no URL'); return; }
    this.closed = false;
    this._connect();
  }

  _connect() {
    const safe = this.url.replace(/token=[^&]+/i, 'token=***');
    log('mcp', `WSS connecting: ${safe}`);

    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.backoff = INITIAL_BACKOFF;
      this.nameMap.clear();
      log('ok', 'WSS connected');
      this._startHeartbeat();
    });

    this.ws.on('message', (data) => this._onMessage(data));

    this.ws.on('close', (code) => {
      log('warn', `WSS closed (${code})`);
      this._stopHeartbeat();
      this.nameMap.clear();
      if (!this.closed) this._reconnect();
    });

    this.ws.on('error', (e) => debug(`WSS error: ${e.message}`));
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeat = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.ping(); } catch {}
      }
    }, HEARTBEAT_INTERVAL);
  }

  _stopHeartbeat() {
    if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = null; }
  }

  _reconnect() {
    if (this.closed || this._reconnectTimer) return;
    const delay = this.backoff;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
      this._connect();
    }, delay);
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  async _onMessage(data) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    const { id, method } = msg;

    if (method === 'initialize') {
      this._send({ jsonrpc: '2.0', id, result: {
        protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'coding-agent', version: '1.0.0' },
      }});
    }

    if (method === 'notifications/initialized') log('mcp', 'WSS initialized ✓');

    if (method === 'tools/list') {
      this.nameMap.clear();
      const tools = this.getTools().map(t => {
        const name = t.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        this.nameMap.set(name, t.name);
        return { name, description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} } };
      });
      this._send({ jsonrpc: '2.0', id, result: { tools } });
      log('mcp', `WSS sent ${tools.length} tools`);
    }

    if (method === 'tools/call') {
      const name = this.nameMap.get(msg.params?.name) || msg.params?.name;
      try {
        const result = await this.callTool(name, msg.params?.arguments || {});
        this._send({ jsonrpc: '2.0', id, result: { content: result.content || [{ type: 'text', text: 'OK' }], isError: !!result.isError } });
      } catch (e) {
        this._send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    }

    if (method === 'ping') this._send({ jsonrpc: '2.0', id, result: {} });
  }

  isConnected() { return this.ws?.readyState === WebSocket.OPEN; }

  stop() {
    this.closed = true;
    this._stopHeartbeat();
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
  }
}
