/**
 * Conversation — save/load conversation history
 */
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getConfig } from './config.js';

const CONV_DIR = 'conversations';

function getConvDir() {
  const cfg = getConfig();
  return join(cfg._root, CONV_DIR);
}

export async function saveConversation(messages, name) {
  const dir = getConvDir();
  await mkdir(dir, { recursive: true });
  const filename = name || `conv-${Date.now()}.json`;
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify({ messages, savedAt: Date.now() }, null, 2));
  return path;
}

export async function loadConversation(name) {
  const path = join(getConvDir(), name);
  if (!existsSync(path)) throw new Error(`Conversation not found: ${name}`);
  const data = JSON.parse(await readFile(path, 'utf-8'));
  return data.messages;
}

export async function listConversations() {
  const dir = getConvDir();
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const convs = [];
  for (const f of files.filter(f => f.endsWith('.json'))) {
    try {
      const data = JSON.parse(await readFile(join(dir, f), 'utf-8'));
      convs.push({
        name: f,
        messages: data.messages?.length || 0,
        savedAt: data.savedAt,
      });
    } catch {}
  }
  return convs.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function formatConversationSummary(messages) {
  const turns = messages.filter(m => m.role === 'user').length;
  const toolCalls = messages.filter(m => m.role === 'tool').length;
  const duration = messages.length > 1
    ? Math.round((messages[messages.length - 1].ts - messages[0].ts) / 1000)
    : 0;
  return `${turns} turns, ${toolCalls} tool calls, ${duration}s`;
}
