# AGENTS.md — Pelulu CLI

## Arsitektur Sistem

Pelulu CLI dan **shellulu** berbagi **system yang identik**. Yang membedakan hanya:

| Bagian | Pelulu CLI | shellulu |
|--------|-----------|----------|
| **Branding** | 🐱 cyan theme, coding companion | ⚡ red theme, pentest agent |
| **Tools** | 18 tools (file, shell, git, project, network, dll) | 26 tools (+ recon, exploit, vuln, injection, fuzzing, dll) |
| **Plugins** | Standard coding tools | Pentesting toolkit + autopilot |
| **Intents** | Coding shortcuts | Pentest shortcuts (portscan, sqli, xss, dll) |
| **ASCII Art** | Cat coding | Evil hacker cat |

## Aturan Penting

### 1. System Files Harus Identik

Semua file di bawah ini **WAJIB identik** antara Pelulu CLI dan shellulu:

```
src/agent/          (semua file)
src/core/           (kecuali config.js, tool-registry.js, intent.js, wizard.js)
src/mcp/            (kecuali activation.js, wss-endpoint.js)
src/plugins/
src/tui/            (kecuali ink-components.js, ink-entry.js, renderer.js)
src/repl.js
src/repl-commands.js
```

### 2. Beda Hanya Branding & Tools

File yang **boleh beda** (branding/tools):

| File | Alasan |
|------|--------|
| `src/core/config.js` | Default name & workspace |
| `src/core/tool-registry.js` | Custom tool descriptions (pentest tools) |
| `src/core/intent.js` | Pentest intent patterns |
| `src/core/wizard.js` | Setup text |
| `src/mcp/activation.js` | Board name |
| `src/mcp/wss-endpoint.js` | ServerInfo name |
| `src/tui/ink-components.js` | Colors, AsciiBanner, StatusBar |
| `src/tui/ink-entry.js` | Task progress (shellulu only) |
| `src/tui/renderer.js` | ASCII art & banner |
| `src/tui/ink-app.js` | Input border color |
| `src/index.js` | appName default |

### 3. Jangan Edit System Files Tanpa Sync

Sebelum mengubah file system:
1. Pastikan perubahan juga diterapkan ke repo lain
2. Verifikasi dengan `diff` bahwa system files tetap identik
3. Commit & push kedua repo

### 4. Struktur Tool yang Benar

Setiap tool mengikuti pattern:
```javascript
export default {
  name: 'toolname',
  description: 'Short description',
  actions: [{ name: 'action1', required: ['field1'] }],
  inputSchema: { type: 'object', properties: { ... } },
  async handler({ action, ...params }) { ... }
};
```

### 5. MCP Constraint

- Response `tools/list` **WAJIB** di bawah **8KB** (MQTT broker limit)
- `_optimizeTool()` limit 4 properties per tool
- `action` enum wajib disertakan (critical untuk routing)
- Deskripsi tool max 100 chars

### 6. XiaoZhi Integration

- Prompt max **70 chars**
- System prompt dikirim via `hello` message (bukan MCP)
- `LLMClient` harus tunggu MCP handshake sebelum kirim prompt
- Tool calls auto-approved (no y/N confirmation)
- Log hanya di satu baris, auto-hide 4 detik
