/**
 * Wizard — first-run configuration wizard
 */
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import { join } from 'path';
import { getConfig, saveConfig } from './config.js';
import { COLORS } from './logger.js';

export async function runWizard(root) {
  const config = getConfig();
  if (config._wizard_done) return config;

  console.log(`\n${COLORS.cyan}╔══════════════════════════════════════╗`);
  console.log(`║          Pelulu CLI Setup             ║`);
  console.log(`╚══════════════════════════════════════╝${COLORS.reset}\n`);

  if (!process.stdin.isTTY) {
    console.log(`${COLORS.yellow}Non-interactive mode. Using defaults.${COLORS.reset}`);
    config._wizard_done = true;
    await saveConfig(root, config);
    return config;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q, def) => new Promise((resolve) => {
    rl.question(`${q}${def ? ` ${COLORS.dim}[${def}]${COLORS.reset}` : ''}: `, (a) => {
      resolve(a.trim() || def);
    });
  });

  try {
    // Workspace
    const workspace = await ask('[DIR] Workspace path?', config.agent?.workspace || '~/coding-agent');
    config.agent = { ...config.agent, workspace };

    // MCP endpoint (optional)
    console.log(`\n${COLORS.dim}MCP Endpoint (optional, for official XiaoZhi MCP):${COLORS.reset}`);
    console.log(`${COLORS.dim}Get from: xiaozhi.me → Configure → Extensions → MCP Endpoint${COLORS.reset}`);
    const mcpUrl = await ask('[MCP] MCP Endpoint URL?', '');
    if (mcpUrl) config.mcp = { ...config.mcp, endpoint_url: mcpUrl };

    // Shell timeout
    const timeout = await ask('Shell timeout (ms)?', String(config.tools?.shell_timeout || 30000));
    config.tools = { ...config.tools, shell_timeout: parseInt(timeout) || 30000 };

    config._wizard_done = true;
    await saveConfig(root, config);

    console.log(`\n${COLORS.green}[OK] Configuration saved!${COLORS.reset}\n`);
    return config;
  } finally {
    rl.close();
  }
}
