/**
 * LLMClient — XiaoZhi AI MQTT wrapper
 * 
 * Sends user messages to XiaoZhi via MQTT.
 * Response handling is done by AgentLoop via bus events.
 */
import { debug } from '../core/logger.js';

const MAX_PROMPT_LEN = 70;

export class LLMClient {
  #mqtt;

  constructor(mqtt) {
    this.#mqtt = mqtt;
  }

  /**
   * Wait for MCP handshake to complete (tools received + session assigned)
   */
  async #waitForReady() {
    if (this.#mqtt.mcp?.toolsReceived && this.#mqtt.sessionId) return;
    debug('llm', 'Session not ready — re-establishing...');
    // Actively re-send hello to recover from an idle `goodbye`, rather than
    // polling for a session that will never come back on its own.
    const ok = await this.#mqtt.ensureSession(30000);
    if (!ok) throw new Error('MCP handshake timeout');
    debug('llm', 'MCP ready');
  }

  /**
   * Send prompt to XiaoZhi (waits for MCP handshake first)
   * Response comes back via llm:text or mcp:tool_call events
   */
  async sendPrompt(prompt) {
    if (prompt.length > MAX_PROMPT_LEN) {
      debug('llm', `Prompt too long: ${prompt.length} > ${MAX_PROMPT_LEN}`);
      throw new Error(`Prompt too long (${prompt.length}/${MAX_PROMPT_LEN} chars)`);
    }
    await this.#waitForReady();
    debug('llm', `Sending: ${prompt}`);
    await this.#mqtt.sendText(prompt);
  }
}
