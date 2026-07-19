/**
 * Ink App — Main Pelulu TUI Application
 * Full React component with message list, input, status, thinking
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import {
  StatusBar, MessageBubble, InputBar, ThinkingIndicator, Divider,
} from './ink-components.js';

export function createApp({ registry, mqtt, stats, session, bus, config, extras }) {
  return function App() {
    const { exit } = useApp();
    const [messages, setMessages] = useState([]);
    const [thinking, setThinking] = useState('idle');
    const [connected, setConnected] = useState(mqtt.connected);
    const [sessionId, setSessionId] = useState(mqtt.sessionId);
    const scrollRef = useRef(null);
    const maxMessages = 200;

    // ─── Bus Events ───────────────────────────────────
    useEffect(() => {
      const onLlmText = (text) => {
        setThinking('idle');
        setMessages(prev => [...prev.slice(-maxMessages), {
          id: Date.now().toString(), role: 'assistant', content: text,
        }]);
      };

      const onToolCalled = ({ name, result, args }) => {
        setMessages(prev => [...prev.slice(-maxMessages), {
          id: `tool-${Date.now()}`, role: 'tool',
          toolName: name, action: args?.action,
          detail: args?.path || args?.command || args?.pattern || '',
        }, {
          id: `result-${Date.now()}`, role: 'tool',
          toolName: '', action: '',
          detail: result.isError
            ? `x ${result.content?.[0]?.text || 'error'}`
            : 'v OK',
        }]);
      };

      const onThinking = ({ state }) => setThinking(state);
      const onReady = () => {
        setConnected(true);
        setSessionId(mqtt.sessionId);
      };
      const onDisconnect = () => {
        setConnected(false);
        setSessionId(null);
      };

      bus.on('llm:text', onLlmText);
      bus.on('tool:called', onToolCalled);
      bus.on('thinking', onThinking);
      bus.on('ready', onReady);
      bus.on('mqtt:error', onDisconnect);

      return () => {
        bus.off('llm:text', onLlmText);
        bus.off('tool:called', onToolCalled);
        bus.off('thinking', onThinking);
        bus.off('ready', onReady);
        bus.off('mqtt:error', onDisconnect);
      };
    }, []);

    // ─── Keyboard shortcuts ───────────────────────────
    useInput((input, key) => {
      if (key.ctrl && input === 'c') {
        exit();
      }
    });

    // ─── Handle Submit ────────────────────────────────
    const handleSubmit = useCallback(async (text) => {
      // Add user message
      setMessages(prev => [...prev.slice(-maxMessages), {
        id: `user-${Date.now()}`, role: 'user', content: text,
      }]);

      // Slash commands
      if (text.startsWith('/')) {
        const [cmd, ...rest] = text.split(' ');
        const arg = rest.join(' ');
        const ctx = { registry, mqtt, stats, session, fileTracker: extras.fileTracker, history: [] };

        if (cmd === '/quit' || cmd === '/exit') {
          exit();
          return;
        }
        if (cmd === '/clear') {
          setMessages([]);
          return;
        }
        if (cmd === '/status') {
          const s = session.getStats();
          setMessages(prev => [...prev, {
            id: `sys-${Date.now()}`, role: 'system',
            content: `MQTT: ${mqtt.connected ? 'Connected' : 'Disconnected'} | Session: ${mqtt.sessionId || '-'} | Tools: ${registry.all().length} | Turns: ${s.turns} | Calls: ${s.toolCalls}`,
          }]);
          return;
        }
        if (cmd === '/tools') {
          const tools = registry.list();
          const lines = tools.map(t => `  ${t.name} (${t.actions?.length || 0} actions)`).join('\n');
          setMessages(prev => [...prev, {
            id: `sys-${Date.now()}`, role: 'system', content: `Tools:\n${lines}`,
          }]);
          return;
        }

        // Try repl-commands handler
        try {
          const { handleCommand } = await import('../repl-commands.js');
          const special = await handleCommand(cmd, arg, ctx);
          if (special === 'help') {
            setMessages(prev => [...prev, {
              id: `sys-${Date.now()}`, role: 'system',
              content: '/tools /status /stats /clear /quit /call <tool> <action> /keys',
            }]);
          }
        } catch {}
        return;
      }

      // Intent parsing (natural language shortcuts)
      try {
        const { parseIntent } = await import('../core/intent.js');
        const intent = parseIntent(text);
        if (intent.matched) {
          setThinking('tool_call');
          const result = await registry.call(intent.tool, intent.params);
          setThinking('idle');
          const { formatToolResult } = await import('../core/formatter.js');
          const formatted = formatToolResult(intent.tool, intent.action, result);
          setMessages(prev => [...prev.slice(-maxMessages), {
            id: `tool-${Date.now()}`, role: 'tool',
            toolName: intent.tool, action: intent.action,
            detail: '',
          }, {
            id: `result-${Date.now()}`, role: 'assistant', content: formatted,
          }]);
          return;
        }
      } catch {}

      // Send to XiaoZhi
      setThinking('thinking');
      mqtt.sendText(text);
    }, [registry, mqtt, stats, session]);

    // ─── Render ───────────────────────────────────────
    const tools = registry.all();
    const actions = tools.reduce((s, t) => s + (t.actions?.length || 0), 0);

    return React.createElement(Box, {
      flexDirection: 'column', width: '100%', height: '100%',
    },
      // Top: Status bar
      React.createElement(StatusBar, {
        connected, session: sessionId,
        toolCount: tools.length, actionCount: actions,
      }),

      // Middle: Messages (scrollable area)
      React.createElement(Box, {
        flexDirection: 'column', flexGrow: 1,
        overflowY: 'hidden', paddingY: 0,
      },
        messages.length === 0
          ? React.createElement(Box, { paddingLeft: 2, paddingTop: 1 },
              React.createElement(Text, { dimColor: true },
                'type a message to get started. tab for autocomplete. /help for commands.'
              ),
            )
          : messages.map((msg) =>
              React.createElement(MessageBubble, { key: msg.id, message: msg })
            ),
        React.createElement(ThinkingIndicator, { state: thinking }),
      ),

      // Bottom: Input
      React.createElement(Box, {
        borderStyle: 'single', borderColor: 'cyan',
        paddingX: 0, paddingY: 0,
      },
        React.createElement(InputBar, {
          onSubmit: handleSubmit,
          placeholder: 'type a message or /help ...',
        }),
      ),
    );
  };
}
