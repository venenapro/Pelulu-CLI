/**
 * REPL Commands — slash command handlers
 * Extracted from repl.js to keep it under 200 lines
 */
import { log, COLORS } from './core/logger.js';
import { getConfig } from './core/config.js';
import { detectWorkspace, formatWorkspace } from './core/workspace.js';
import { saveConversation, listConversations, loadConversation } from './core/conversation.js';
import { formatToolResult } from './core/formatter.js';
import { showToolHelp, showAllToolHelp } from './core/tool-help.js';
import { runDoctor } from './core/doctor.js';
import { formatModelInfo } from './core/model-info.js';

export async function handleCommand(cmd, arg, ctx) {
  const { registry, mqtt, stats, session, fileTracker, history } = ctx;

  switch (cmd) {
    case '/quit': case '/exit':
      console.log(stats.formatReport());
      console.log(fileTracker.getSummary());
      await registry.shutdown();
      mqtt.disconnect();
      process.exit(0);

    case '/help':
      if (arg) showToolHelp(arg);
      else return 'help';
      break;

    case '/tools': return 'tools';
    case '/status': return 'status';
    case '/stats': console.log(`\n${stats.formatReport()}\n`); break;
    case '/workspace':
      try { console.log(`\n${formatWorkspace(await detectWorkspace())}\n`); }
      catch (e) { log('err', e.message); }
      break;

    case '/files': console.log(`\n${fileTracker.getSummary()}\n`); break;

    case '/call': {
      if (!arg) { log('warn', 'Usage: /call <tool> <action> [params]'); break; }
      const parts = arg.split(' ');
      const toolName = parts[0];
      let args = {};
      if (parts.length > 1) {
        try { args = JSON.parse(parts.slice(1).join(' ')); }
        catch { args = { action: parts[1], path: parts.slice(2).join(' ') || undefined }; }
      }
      const result = await registry.call(toolName, args);
      console.log(`\n${formatToolResult(toolName, args.action, result)}\n`);
      break;
    }

    case '/conv': {
      const [sub, ...rest] = (arg || '').split(' ');
      const name = rest.join(' ');
      try {
        if (sub === 'save') { const p = await saveConversation(history, name || undefined); log('ok', `Saved: ${p}`); }
        else if (sub === 'list') {
          const convs = await listConversations();
          if (!convs.length) { log('info', 'No saved conversations'); break; }
          console.log(`\n${COLORS.bold}💾 Conversations:${COLORS.reset}\n`);
          for (const c of convs) console.log(`  ${c.name} (${c.messages} msgs)`);
          console.log();
        } else if (sub === 'load') {
          if (!name) { log('warn', 'Usage: /conv load <name>'); break; }
          const msgs = await loadConversation(name);
          history.length = 0;
          history.push(...msgs);
          log('ok', `Loaded ${msgs.length} messages`);
        } else { log('info', 'Usage: /conv save|list|load [name]'); }
      } catch (e) { log('err', e.message); }
      break;
    }

    case '/history': {
      const recent = history.slice(-10);
      if (!recent.length) { log('info', 'No history'); break; }
      console.log(`\n${COLORS.bold}📜 Recent:${COLORS.reset}\n`);
      for (const h of recent) console.log(`  ${COLORS.dim}${new Date(h.ts).toLocaleTimeString()}${COLORS.reset} ${h.text.slice(0, 80)}`);
      console.log();
      break;
    }

    case '/doctor': await runDoctor(); break;
    case '/model': console.log(`\n${formatModelInfo()}\n`); break;
    case '/keys': return 'keys';
    case '/clear': console.clear(); break;
    default: log('info', `Unknown: ${cmd}. /help`);
  }
  return null;
}
