/**
 * Status Bar — persistent bottom status bar
 * Shows: connection, session, tool count, time
 */
import chalk from 'chalk';

export class StatusBar {
  constructor() {
    this.items = {
      mqtt: '⏳',
      session: '-',
      tools: 0,
      calls: 0,
    };
  }

  update(key, value) {
    this.items[key] = value;
  }

  render() {
    const { mqtt, session, tools, calls } = this.items;
    const time = new Date().toLocaleTimeString();
    const line = [
      chalk.dim('─'.repeat(process.stdout.columns || 60)),
      chalk.gray(`  ${mqtt === '✅' ? '🟢' : '🔴'} MQTT: ${mqtt}`),
      chalk.gray(`  📡 Session: ${session}`),
      chalk.gray(`  🔧 Tools: ${tools}`),
      chalk.gray(`  📊 Calls: ${calls}`),
      chalk.gray(`  🕐 ${time}`),
    ].join('  ');
    console.log(line);
  }
}
