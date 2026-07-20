# Changelog

All notable changes to **Pelulu CLI** will be documented in this file.

## [1.1.0] - 2026-07-21

### Fixed
- **MQTT disconnect loop** — `tools/list` response exceeded 8KB broker limit, now optimized to ~4KB
- **Agent sends prompt before session ready** — `LLMClient` now waits for MCP handshake + session before sending
- **Double tool execution** — agent loop no longer re-executes tools already handled by MQTT client
- **Prompt sent multiple times** — agent loop now sends prompt only once per run
- **AI responses not in log file** — added `llm:text` and `tts:sentence` event logging
- **Log files accumulate** — old logs deleted on startup, only latest kept
- **y/N confirmation prompt flashing** — agent tool calls auto-approved (no more UI glitches)
- **Version mismatch** — version now read from `package.json` (auto-sync)

### Changed
- **Statusbar redesigned** — clean minimal layout: `🐱 PELULU ● online  session:xxx  xiaozhi.me`
- **Tool schema optimization** — `action` enum preserved, first 4 properties sent (under 8KB)
- **System prompt added to hello message** — tells XiaoZhi to use tools instead of just chatting

## [1.0.5] - 2026-07-20

### Added
- File logging (`logs/` directory)
- Char counter on TUI input (70 char limit)
- Scrollable chat (Shift+Up/Down, PgUp/PgDn)

### Fixed
- Chat limited to 12 visible lines
- Progress feedback and timeout handling in agent loop

## [1.0.4] - 2026-07-19

### Changed
- Update checker uses npm registry instead of GitHub releases

### Fixed
- Activation code displays directly to console

## [1.0.3] - 2026-07-19

### Fixed
- Duplicate user messages (Enter key fired onSubmit twice)
- TTS responses handled as assistant messages

## [1.0.2] - 2026-07-18

### Added
- Cute ASCII cat banner above CLI header
- Block CLI when update is available

### Fixed
- Redirect ALL startup logs into Ink TUI
- Clean status bar header format

## [1.0.1] - 2026-07-17

### Added
- OpenHands-style agent system (AgentLoop, AgentController, LLMClient)
- Auto-completion with Tab key
- Auto-format for written files

### Changed
- Replaced readline with Ink React TUI

### Fixed
- Compact banner text
- TTY fallback for non-interactive mode
- Log status as single-line auto-updating text

## [1.0.0] - 2026-07-16

### Added
- Initial release
- XiaoZhi AI integration via MQTT
- MCP tool protocol support
- 18 built-in tools (file, shell, git, project, network, etc.)
- Interactive REPL with syntax highlighting
- Plugin system
- Workspace detection and context building
