/**
 * ModelInfo — display and manage AI model information
 */
import { COLORS } from './logger.js';

export function getModelInfo() {
  return {
    name: 'XiaoZhi',
    provider: 'Tenclass',
    protocol: 'MQTT + MCP',
    features: ['text', 'voice', 'tool_use', 'mcp'],
    maxTools: 32,
  };
}

export function formatModelInfo() {
  const info = getModelInfo();
  return [
    `${COLORS.bold}🧠 Model:${COLORS.reset}`,
    `  Name:     ${info.name}`,
    `  Provider: ${info.provider}`,
    `  Protocol: ${info.protocol}`,
    `  Features: ${info.features.join(', ')}`,
    `  Max Tools: ${info.maxTools}`,
  ].join('\n');
}
