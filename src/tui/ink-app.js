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
import { jobManager } from '../core/job-manager.js';

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
    // Watchdog + background task phase tracking
    const activityTimer = useRef(null);   // LLM/agent "thinking" watchdog
    const taskTimer = useRef(null);       // long-running task liveness watchdog
    const lastPhaseRef = useRef(null);
    const taskRunningRef = useRef(false);  // a background task is active
    const wasConnectedRef = useRef(mqtt.connected); // dedupe "connected" spam
    const STUCK_TIMEOUT_MS = config?.agent?.stuck_timeout_ms || 45000;
    // A single step can legitimately run a while; only warn if a task
    // produces NO progress events at all for this long.
    const TASK_STUCK_MS = config?.agent?.task_timeout_ms || 90000;

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

    // Chrome that is ALWAYS present around the message window:
    //   banner (7) + status bar (3) + input box (3) + message paddingY (2) = 15
    // Dynamic single-line chrome (status line, thinking, scroll hints) is
    // accounted for at render time so the frame never exceeds the terminal
    // height — overflow is what causes the duplicated banner + vanishing chat.
    const BASE_CHROME = 15;

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
        if (activityTimer.current) { clearTimeout(activityTimer.current); activityTimer.current = null; }
        // Strip emojis to check if there's real content
        const clean = text.replace(/\p{Emoji_Presentation}/gu, '').replace(/\p{Extended_Pictographic}/gu, '').trim();
        if (!clean) return; // skip emoji-only LLM responses (TTS will carry the real text)
        setMessages(prev => [...prev.slice(-maxMessages), {
          id: Date.now().toString(), role: 'assistant', content: text,
        }]);
      };

      const onToolCalled = ({ name, result, args }) => {
        // A tool just finished -> refresh the watchdog (agent is alive)
        if (activityTimer.current) { clearTimeout(activityTimer.current); activityTimer.current = null; }
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

      // File change tracking — surface each tracked change as a chat line
      const onFilesChanged = ({ path, change }) => {
        const short = path.replace(process.cwd() + '/', '');
        setMessages(prev => [...prev.slice(-maxMessages), {
          id: `track-${Date.now()}`, role: 'system',
          content: `tracked: ${change} ${short}`,
        }]);
      };

      const pushSystem = (content) => setMessages(prev => [...prev.slice(-maxMessages), {
        id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'system', content,
      }]);

      // Watchdog: if the agent is "busy" but nothing happens for a while,
      // recover the UI instead of hanging forever on ".. using tool...".
      const clearWatchdog = () => {
        if (activityTimer.current) { clearTimeout(activityTimer.current); activityTimer.current = null; }
      };
      const armWatchdog = () => {
        clearWatchdog();
        activityTimer.current = setTimeout(() => {
          setThinking('idle');
          pushSystem('still waiting on XiaoZhi to reply — you can keep typing meanwhile.');
        }, STUCK_TIMEOUT_MS);
      };

      const onThinking = ({ state }) => {
        // While a background task owns the UI, ignore transient
        // "thinking/tool_call" states so we never get stuck on ".. using tool..".
        if (taskRunningRef.current) return;
        setThinking(state);
        if (state && state !== 'idle') armWatchdog();
        else clearWatchdog();
      };
      const onReady = () => {
        setConnected(true);
        setSessionId(mqtt.sessionId);
        // Only announce a real disconnected -> connected transition, so
        // reconnects / repeated hellos don't spam and look like a reset.
        if (!wasConnectedRef.current) pushSystem('connected to XiaoZhi.');
        wasConnectedRef.current = true;
      };
      const onDisconnect = (err) => {
        setConnected(false);
        setSessionId(null);
        setThinking('idle');
        clearWatchdog();
        lastPhaseRef.current = null;
        if (wasConnectedRef.current) {
          pushSystem(`disconnected${err?.message ? ` (${err.message})` : ''} — reconnecting...`);
        }
        wasConnectedRef.current = false;
      };
      const onSessionEnd = () => {
        // XiaoZhi ended the session (idle). The next message now auto-reconnects
        // (see mqtt.ensureSession), so this is silent unless the user is waiting.
        setSessionId(null);
        // Don't nag mid-task: background tasks run locally and don't need the session.
        if (!taskRunningRef.current) {
          setThinking('idle');
          clearWatchdog();
          // Surface a subtle, reassuring notice so a paused session doesn't look
          // like a silent reset — the next message reconnects automatically.
          pushSystem('XiaoZhi session paused — it resumes automatically when you send your next message.');
        }
      };
      const onSessionDead = () => {
        // ensureSession() failed to re-establish — tell the user explicitly
        // instead of silently dropping their message.
        setThinking('idle');
        clearWatchdog();
        pushSystem('could not reach XiaoZhi (session lost) — check connection and try again.');
      };

      // Reconnection lifecycle — keep the user informed instead of silently
      // dropping the connection (the old "disconnected forever" symptom).
      const onReconnecting = (data) => {
        setConnected(false);
        setSessionId(null);
        pushSystem(`reconnecting to XiaoZhi (attempt ${data?.attempt || 1})...`);
        wasConnectedRef.current = false;
      };
      const onReconnected = () => {
        setConnected(true);
        setSessionId(mqtt.sessionId);
        pushSystem('reconnected to XiaoZhi.');
        wasConnectedRef.current = true;
      };

      // Long-running task liveness watchdog — reset on EVERY progress event.
      // This replaces the old per-phase timer that false-fired during slow
      // steps (the bogus "no response (timed out)" mid-task).
      const bumpTaskWatchdog = (label) => {
        if (taskTimer.current) clearTimeout(taskTimer.current);
        taskTimer.current = setTimeout(() => {
          taskRunningRef.current = false;
          setThinking('idle');
          pushSystem(`${label} appears stalled (no progress ${Math.round(TASK_STUCK_MS / 1000)}s) — check with "jobs" tool or try again.`);
        }, TASK_STUCK_MS);
      };
      const clearTaskWatchdog = () => {
        if (taskTimer.current) { clearTimeout(taskTimer.current); taskTimer.current = null; }
      };

      // Background task progress -> surface inline in the chat
      const onTaskProgress = (data) => {
        if (!data) return;
        const label = data.target || data.tool || 'task';
        setLogLine(`[${data.tool || 'task'}] ${data.target || ''} ${data.phase || ''} ${data.elapsed || 0}s`.trim());

        if (data.running) {
          taskRunningRef.current = true;
          setThinking('idle');            // never show the generic "using tool"
          bumpTaskWatchdog(label);        // any event = still alive
          // Announce each new phase inline
          if (data.phase && data.phase !== lastPhaseRef.current) {
            lastPhaseRef.current = data.phase;
            pushSystem(`» ${label}: ${data.phase}${data.log ? ` — ${data.log}` : ''}`);
          }
        }

        if (!data.running || data.phase === 'done') {
          clearTaskWatchdog();
          taskRunningRef.current = false;
          if (lastPhaseRef.current !== 'done') {
            lastPhaseRef.current = 'done';
            pushSystem(`» ${label}: finished`);
          }
          setThinking('idle');
        }
      };

      // ─── Universal background-job feedback ───────────
      // Any tool action that runs past the grace window becomes a pollable
      // background job. We announce it, stream its progress on the log line,
      // and confirm completion inline — so EVERY tool gives continuous
      // feedback and never looks "stuck".
      const bgJobs = new Set();
      const onJobBackgrounded = (snap) => {
        if (!snap) return;
        bgJobs.add(snap.id);
        setThinking('idle');
        pushSystem(`~ ${snap.label} is running in the background (${snap.id}); I'll report when it finishes.`);
      };
      const onJobProgress = (p) => {
        if (!p) return;
        setLogLine(`[${p.tool}] ${p.message}`.slice(0, 120));
      };
      const onJobDone = (snap) => {
        if (!snap || !bgJobs.has(snap.id)) return; // only announce jobs we flagged as background
        bgJobs.delete(snap.id);
        if (snap.status === 'error') { pushSystem(`x ${snap.label} failed: ${snap.error}`); return; }
        if (snap.status === 'cancelled') { pushSystem(`- ${snap.label} cancelled.`); return; }
        pushSystem(`+ ${snap.label} finished in ${snap.elapsed_s}s.`);
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
        if (activityTimer.current) { clearTimeout(activityTimer.current); activityTimer.current = null; }
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
          armWatchdog();
        } else if (state === 'tool_done') {
          setThinking('thinking');
          setLogLine(`[TOOL] done, waiting...`);
          armWatchdog();
        } else if (state === 'receiving') {
          setLogLine(`[LLM] ${message}`);
          armWatchdog();
        } else if (state === 'thinking') {
          setThinking('thinking');
          armWatchdog();
        } else if (state === 'timeout') {
          setThinking('idle');
          clearWatchdog();
          setLogLine(`[WARN] ${message}`);
          pushSystem(`timeout: ${message}`);
        }
      };

      bus.on('llm:text', onLlmText);
      bus.on('tts:sentence', onTtsSentence);
      bus.on('tool:called', onToolCalled);
      bus.on('files:changed', onFilesChanged);
      bus.on('thinking', onThinking);
      bus.on('ready', onReady);
      bus.on('session:end', onSessionEnd);
      bus.on('session:dead', onSessionDead);
      bus.on('mqtt:error', onDisconnect);
      bus.on('mqtt:disconnected', onDisconnect);
      bus.on('mqtt:reconnecting', onReconnecting);
      bus.on('mqtt:reconnected', onReconnected);
      bus.on('log:message', onLogMessage);
      bus.on('agent:progress', onAgentProgress);
      bus.on('job:backgrounded', onJobBackgrounded);
      bus.on('job:progress', onJobProgress);
      bus.on('job:done', onJobDone);
      bus.on('task:progress', onTaskProgress);

      return () => {
        bus.off('llm:text', onLlmText);
        bus.off('tts:sentence', onTtsSentence);
        bus.off('tool:called', onToolCalled);
        bus.off('files:changed', onFilesChanged);
        bus.off('thinking', onThinking);
        bus.off('ready', onReady);
        bus.off('session:end', onSessionEnd);
        bus.off('session:dead', onSessionDead);
        bus.off('mqtt:error', onDisconnect);
        bus.off('mqtt:disconnected', onDisconnect);
        bus.off('mqtt:reconnecting', onReconnecting);
        bus.off('mqtt:reconnected', onReconnected);
        bus.off('log:message', onLogMessage);
        bus.off('agent:progress', onAgentProgress);
        bus.off('job:backgrounded', onJobBackgrounded);
        bus.off('job:progress', onJobProgress);
        bus.off('job:done', onJobDone);
        bus.off('task:progress', onTaskProgress);
        if (ttsTimer) clearTimeout(ttsTimer);
        if (activityTimer.current) clearTimeout(activityTimer.current);
        if (taskTimer.current) clearTimeout(taskTimer.current);
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
        if (cmd === '/files' || cmd === '/changes') {
          const changes = extras.fileTracker?.getChanges() || [];
          const body = changes.length
            ? changes.map(c => `  ${c.action} ${c.path.replace(process.cwd() + '/', '')}${c.count > 1 ? ` (${c.count}x)` : ''}`).join('\n')
            : 'No file changes this session';
          setMessages(prev => [...prev, {
            id: `sys-${Date.now()}`, role: 'system', content: `file changes:\n${body}`,
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
          // Route through the job layer: fast commands render inline as before,
          // slow ones self-background (announced + confirmed by the job:* handlers)
          // so the TUI never freezes on a long local action.
          const dispatched = await jobManager.dispatch(
            { tool: intent.tool, action: intent.action, label: `${intent.tool}.${intent.action || ''}` },
            () => registry.call(intent.tool, intent.params),
          );
          setThinking('idle');
          if (!dispatched.done) return; // backgrounded — job:* handlers take over
          if (dispatched.error) {
            setMessages(prev => [...prev.slice(-maxMessages), {
              id: `err-${Date.now()}`, role: 'system', content: `x ${intent.tool} failed: ${dispatched.error.message}`,
            }]);
            return;
          }
          const { formatToolResult } = await import('../core/formatter.js');
          const formatted = formatToolResult(intent.tool, intent.action, dispatched.result);
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
        // Fallback: send directly to XiaoZhi (auto-reconnects if session died)
        const sent = await mqtt.sendText(text);
        setThinking('idle');
        if (!sent) {
          setMessages(prev => [...prev.slice(-maxMessages), {
            id: `error-${Date.now()}`, role: 'system',
            content: 'could not reach XiaoZhi — session lost, try again.',
          }]);
        }
      }
    }, [registry, mqtt, stats, session]);

    // ─── Render ───────────────────────────────────────
    const tools = registry.all();
    const actions = tools.reduce((s, t) => s + (t.actions?.length || 0), 0);

    // Dynamic chrome: base + the single-line widgets actually shown this frame,
    // plus a reserve of 2 rows for the (possible) scroll-up/down hints. This
    // guarantees banner + status + messages + input never exceed the terminal
    // height, which is what caused the duplicated banner and vanishing chat.
    const dynamicChrome =
      BASE_CHROME +
      (logLine ? 1 : 0) +
      (thinking && thinking !== 'idle' ? 1 : 0) +
      2;
    const MAX_RENDER_LINES = Math.max(3, rows - dynamicChrome);

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
      // Top: Banner + Status bar (always visible / pinned)
      React.createElement(AsciiBanner, {
        key: 'ascii-banner',
        version: config?.agent?.version,
      }),
      React.createElement(StatusBar, {
        key: 'status-bar',
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
              `[${startIdx} more above | Shift+Up/Down or PgUp/PgDn to scroll]`
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
