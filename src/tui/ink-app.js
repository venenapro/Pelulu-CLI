/**
 * Ink App — Main Pelulu TUI Application
 * Full React component with message list, input, status, thinking
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import {
  AsciiBanner, StatusBar, MessageBubble, ThinkingIndicator, stripEmojis,
} from './ink-components.js';
import { CompletableInput } from './completable-input.js';
import { setInkMode } from '../core/logger.js';

export function createApp({ registry, mqtt, stats, session, bus, config, extras }) {
  return function App() {
    const { exit } = useApp();
    const { isRawModeSupported } = useStdin();
    const [messages, setMessages] = useState([]);
    const [thinking, setThinking] = useState('idle');
    const [connected, setConnected] = useState(mqtt.connected);
    const [sessionId, setSessionId] = useState(mqtt.sessionId);
    // Show last startup log as initial log line
    const _startupLogs = extras?.startupLogs || [];
    const _lastStartup = _startupLogs.length
      ? _startupLogs[_startupLogs.length - 1].replace(/\x1b\[[0-9;]*m/g, '')
      : '';
    const [logLine, setLogLine] = useState(_lastStartup);
    const logTimer = useRef(null);
    const maxMessages = 200;
    const [scrollOffset, setScrollOffset] = useState(0); // 0 = bottom, N = scrolled up N messages
    const scrollOffsetRef = useRef(0);

    // Track terminal height so the whole UI always fits inside the viewport.
    // If the total output is taller than the terminal, Ink cannot erase the
    // previous frame and re-prints the top border on every render — this is
    // the "duplicate banner" bug. Keeping the tree <= terminal rows avoids it.
    const [rows, setRows] = useState(process.stdout.rows || 24);
    useEffect(() => {
      const onResize = () => setRows(process.stdout.rows || 24);
      process.stdout.on('resize', onResize);
      return () => process.stdout.off('resize', onResize);
    }, []);

    // Fixed chrome around the message window (banner + status + input +
    // paddings + indicators). Message window gets whatever rows are left.
    const RESERVED_ROWS = 20;
    const MAX_RENDER_LINES = Math.max(3, rows - RESERVED_ROWS);

    // ─── Enable Ink mode for logger ──────────────────
    useEffect(() => {
      setInkMode(true, bus);
      return () => {
        setInkMode(false, null);
        if (logTimer.current) clearTimeout(logTimer.current);
      };
    }, []);

    // ─── Bus Events ───────────────────────────────────
    useEffect(() => {
      const onLlmText = (text) => {
        setThinking('idle');
        // Strip emojis to check if there's real content
        const clean = text.replace(/\p{Emoji_Presentation}/gu, '').replace(/\p{Extended_Pictographic}/gu, '').trim();
        if (!clean) return; // skip emoji-only LLM responses (TTS will carry the real text)
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

      // Single log line that updates in place
      const onLogMessage = ({ level, msg }) => {
        const LABELS = { ok: 'OK', err: 'ERR', warn: 'WARN', info: 'i', tool: 'TOOL', mcp: 'MCP', user: 'USER', ai: 'AI' };
        const label = LABELS[level] || level.toUpperCase();
        setLogLine(`[${label}] ${msg}`);
        // Auto-hide after 4s of no new logs
        if (logTimer.current) clearTimeout(logTimer.current);
        logTimer.current = setTimeout(() => setLogLine(''), 4000);
      };

      // XiaoZhi sends responses as TTS sentences, not LLM text
      // Accumulate TTS sentences and display as assistant message
      let ttsBuffer = '';
      let ttsTimer = null;

      const onTtsSentence = (text) => {
        ttsBuffer += text;
        setThinking('idle');
        // Debounce: wait for all TTS sentences to arrive, then display
        if (ttsTimer) clearTimeout(ttsTimer);
        ttsTimer = setTimeout(() => {
          if (ttsBuffer) {
            setMessages(prev => {
              const next = [...prev.slice(-maxMessages), {
                id: Date.now().toString(), role: 'assistant', content: ttsBuffer,
              }];
              // Auto-scroll to bottom on new AI response
              setScrollOffset(0);
              scrollOffsetRef.current = 0;
              return next;
            });
            ttsBuffer = '';
          }
        }, 500);
      };

      // Agent progress events
      const onAgentProgress = ({ state, message, tool, action }) => {
        if (state === 'tool') {
          setThinking('tool_call');
          setLogLine(`[TOOL] ${tool}.${action || ''}...`);
        } else if (state === 'tool_done') {
          setThinking('thinking');
          setLogLine(`[TOOL] done, waiting...`);
        } else if (state === 'receiving') {
          setLogLine(`[LLM] ${message}`);
        } else if (state === 'thinking') {
          setThinking('thinking');
        } else if (state === 'timeout') {
          setLogLine(`[WARN] ${message}`);
        }
      };

      bus.on('llm:text', onLlmText);
      bus.on('tts:sentence', onTtsSentence);
      bus.on('tool:called', onToolCalled);
      bus.on('thinking', onThinking);
      bus.on('ready', onReady);
      bus.on('mqtt:error', onDisconnect);
      bus.on('log:message', onLogMessage);
      bus.on('agent:progress', onAgentProgress);

      return () => {
        bus.off('llm:text', onLlmText);
        bus.off('tts:sentence', onTtsSentence);
        bus.off('tool:called', onToolCalled);
        bus.off('thinking', onThinking);
        bus.off('ready', onReady);
        bus.off('mqtt:error', onDisconnect);
        bus.off('log:message', onLogMessage);
        bus.off('agent:progress', onAgentProgress);
        if (ttsTimer) clearTimeout(ttsTimer);
      };
    }, []);

    // ─── Keyboard shortcuts ─────────────────────────
    useInput((input, key) => {
      if (key.ctrl && input === 'c') exit();

      // Scroll: Shift+Up / Shift+Down / PageUp / PageDown
      if (key.shift && key.upArrow) {
        setScrollOffset(prev => {
          const next = Math.min(prev + 5, messages.length - 1);
          scrollOffsetRef.current = next;
          return next;
        });
      } else if (key.shift && key.downArrow) {
        setScrollOffset(prev => {
          const next = Math.max(0, prev - 5);
          scrollOffsetRef.current = next;
          return next;
        });
      } else if (key.pageUp) {
        setScrollOffset(prev => {
          const next = Math.min(prev + 20, messages.length - 1);
          scrollOffsetRef.current = next;
          return next;
        });
      } else if (key.pageDown) {
        setScrollOffset(prev => {
          const next = Math.max(0, prev - 20);
          scrollOffsetRef.current = next;
          return next;
        });
      }
    });

    // ─── Handle Submit ────────────────────────────────
    const handleSubmit = useCallback(async (text) => {
      // Limit input to 70 chars (XiaoZhi limit)
      const MAX_INPUT = 70;
      if (text.length > MAX_INPUT) {
        setMessages(prev => [...prev.slice(-maxMessages), {
          id: `warn-${Date.now()}`, role: 'system', 
          content: `⚠️ Input too long (${text.length}/${MAX_INPUT} chars)`,
        }]);
        return;
      }

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
          setScrollOffset(0);
          scrollOffsetRef.current = 0;
          return;
        }
        if (cmd === '/status') {
          const s = session.getStats();
          setMessages(prev => [...prev, {
            id: `sys-${Date.now()}`, role: 'system',
            content: `mqtt: ${mqtt.connected ? 'on' : 'off'} | session: ${mqtt.sessionId || '-'} | tools: ${registry.all().length} | turns: ${s.turns} | calls: ${s.toolCalls}`,
          }]);
          return;
        }
        if (cmd === '/tools') {
          const tools = registry.list();
          const lines = tools.map(t => `  ${t.name} (${t.actions?.length || 0})`).join('\n');
          setMessages(prev => [...prev, {
            id: `sys-${Date.now()}`, role: 'system', content: `tools:\n${lines}`,
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

      // Send to XiaoZhi via Agent Controller (if available) or direct
      setThinking('thinking');
      
      const agentController = extras?.agentController;
      if (agentController) {
        // Reset agent if it's stuck in running state
        if (agentController.isRunning) {
          agentController.abort();
          await new Promise(r => setTimeout(r, 500));
        }
        
        // Use agent controller for proper response handling
        try {
          const result = await agentController.run(text, { generatePlan: false });
          setThinking('idle');
          
          if (result.success && result.result) {
            setMessages(prev => [...prev.slice(-maxMessages), {
              id: `assistant-${Date.now()}`, role: 'assistant', content: result.result,
            }]);
          }
        } catch (err) {
          setThinking('idle');
          setMessages(prev => [...prev.slice(-maxMessages), {
            id: `error-${Date.now()}`, role: 'system', content: `Error: ${err.message}`,
          }]);
        }
      } else {
        // Fallback: send directly to XiaoZhi
        mqtt.sendText(text);
      }
    }, [registry, mqtt, stats, session]);

    // ─── Render ───────────────────────────────────────
    const tools = registry.all();
    const actions = tools.reduce((s, t) => s + (t.actions?.length || 0), 0);

    // Calculate visible messages (scrollable window sized to terminal height)
    const totalMessages = messages.length;
    const endIdx = totalMessages - scrollOffset;

    // Count lines backwards from endIdx to fit within MAX_RENDER_LINES
    let usedLines = 0;
    let startIdx = endIdx;
    for (let i = endIdx - 1; i >= 0; i--) {
      const msg = messages[i];
      let msgLines = 1;
      if (msg.role === 'assistant' && msg.content) {
        const w = (process.stdout.columns || 80) - 6;
        const words = stripEmojis(msg.content).split(/\s+/);
        let lineLen = 0;
        msgLines = 1;
        for (const word of words) {
          if (lineLen + word.length + 1 > w && lineLen > 0) { msgLines++; lineLen = word.length; }
          else { lineLen += word.length + (lineLen > 0 ? 1 : 0); }
        }
      }
      if (usedLines + msgLines > MAX_RENDER_LINES) break;
      usedLines += msgLines;
      startIdx = i;
    }

    const visibleMessages = messages.slice(startIdx, endIdx);
    const canScrollUp = startIdx > 0;
    const canScrollDown = scrollOffset > 0;

    return React.createElement(Box, {
      flexDirection: 'column', width: '100%',
    },
      // Top: Banner + Status bar
      React.createElement(AsciiBanner, {
        version: config?.agent?.version,
      }),
      React.createElement(StatusBar, {
        connected, session: sessionId,
      }),

      // Log status line (single line, auto-updating, auto-hiding)
      logLine
        ? React.createElement(Box, { paddingLeft: 1 },
            React.createElement(Text, { dimColor: true, color: 'gray' }, logLine),
          )
        : null,

      // Scroll indicator (only when scrolled up)
      canScrollUp
        ? React.createElement(Box, { paddingLeft: 2 },
            React.createElement(Text, { dimColor: true, color: 'yellow' },
              `[${totalMessages - endIdx} more above | Shift+Up/Down or PgUp/PgDn to scroll]`
            ),
          )
        : null,

      // Middle: Messages (scrollable window)
      React.createElement(Box, {
        flexDirection: 'column', paddingY: 1,
      },
        totalMessages === 0
          ? React.createElement(Box, { paddingLeft: 2 },
              React.createElement(Text, { dimColor: true },
                'type a message to get started. tab for autocomplete. /help for commands.'
              ),
            )
          : visibleMessages.map((msg) =>
              React.createElement(MessageBubble, { key: msg.id, message: msg })
            ),
        canScrollDown
          ? React.createElement(Box, { paddingLeft: 2 },
              React.createElement(Text, { dimColor: true, color: 'yellow' },
                `[${scrollOffset} more below | Shift+Down or PgDn to scroll to bottom]`
              ),
            )
          : null,
        React.createElement(ThinkingIndicator, { state: thinking }),
      ),

      // Bottom: Input
      React.createElement(Box, {
        borderStyle: 'single', borderColor: 'cyan', paddingX: 0,
      },
        React.createElement(CompletableInput, {
          onSubmit: handleSubmit,
          placeholder: 'type a message or /help ...',
        }),
      ),
    );
  };
}
