/**
 * Doctor — diagnostic checks for the coding agent
 * Like Claude Code's diagnostic/health check
 */
import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getConfig } from './config.js';
import { COLORS } from './logger.js';

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 5000 }, (err, stdout) => resolve(!err && stdout?.trim()));
  });
}

export async function runDoctor() {
  const cfg = getConfig();
  const cwd = cfg.agent?.workspace || process.cwd();
  const checks = [];

  // Node.js
  const nodeVer = await run('node --version');
  checks.push({ name: 'Node.js', ok: !!nodeVer, value: nodeVer || 'not found' });

  // npm
  const npmVer = await run('npm --version');
  checks.push({ name: 'npm', ok: !!npmVer, value: npmVer || 'not found' });

  // git
  const gitVer = await run('git --version');
  checks.push({ name: 'git', ok: !!gitVer, value: gitVer || 'not found' });

  // Workspace
  checks.push({ name: 'Workspace', ok: existsSync(cwd), value: cwd });

  // Config
  checks.push({ name: 'Config', ok: !!cfg, value: cfg._path });

  // Device ID
  checks.push({ name: 'Device ID', ok: !!cfg.mqtt?.device_id, value: cfg.mqtt?.device_id || 'not set' });

  // MQTT
  checks.push({ name: 'MQTT endpoint', ok: !!cfg.mqtt?.ota_url, value: cfg.mqtt?.ota_url || 'not set' });

  // Git repo
  const hasGit = existsSync(join(cwd, '.git'));
  checks.push({ name: 'Git repo', ok: hasGit, value: hasGit ? 'yes' : 'no' });

  // Print report
  console.log(`\n${COLORS.bold}[DOC] Doctor Report:${COLORS.reset}\n`);
  let allOk = true;
  for (const c of checks) {
    const icon = c.ok ? `${COLORS.green}[OK]${COLORS.reset}` : `${COLORS.red}[ERR]${COLORS.reset}`;
    console.log(`  ${icon} ${c.name.padEnd(18)} ${c.value}`);
    if (!c.ok) allOk = false;
  }
  console.log(`\n${allOk ? `${COLORS.green}All checks passed!${COLORS.reset}` : `${COLORS.yellow}Some checks failed.${COLORS.reset}`}\n`);
  return allOk;
}
