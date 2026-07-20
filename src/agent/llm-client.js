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
    debug('llm', 'Waiting for MCP handshake...');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MCP handshake timeout')), 30000);
      const check = setInterval(() => {
        if (this.#mqtt.mcp?.toolsReceived && this.#mqtt.sessionId) {
          clearInterval(check);
          clearTimeout(timeout);
          debug('llm', 'MCP ready');
          resolve();
        }
      }, 200);
    });
  }

  /**
   * Send prompt to XiaoZhi (waits for MCP handshake first)
   * Response comes back via llm:text or mcp:tool_call events
   */
  async sendPrompt(prompt) {
    if (prompt.length > MAX_PROMPT_LEN) {
      debug('llm', `Prompt too long: ${prompt.length} > ${MAX_PROMPT_LEN}`);
      throw new Error(`Prompt terlalu panjang (${prompt.length}/${MAX_PROMPT_LEN} chars). Pendekin ya!`);
    }
    await this.#waitForReady();
    debug('llm', `Sending: ${prompt}`);
    await this.#mqtt.sendText(prompt);
  }
}
