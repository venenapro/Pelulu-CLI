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
   * Send prompt to XiaoZhi (fire and forget)
   * Response comes back via llm:text or mcp:tool_call events
   */
  async sendPrompt(prompt) {
    if (prompt.length > MAX_PROMPT_LEN) {
      debug('llm', `Prompt too long: ${prompt.length} > ${MAX_PROMPT_LEN}`);
      throw new Error(`Prompt terlalu panjang (${prompt.length}/${MAX_PROMPT_LEN} chars). Pendekin ya!`);
    }
    debug('llm', `Sending: ${prompt}`);
    await this.#mqtt.sendText(prompt);
  }
}
