# XiaoZhi AI — Specifications & Limitations

Dokumen ini berisi semua batasan XiaoZhi AI yang ditemukan selama pengembangan Pelulu-CLI dan shellulu, beserta solusi yang sudah diterapkan.

---

## Ringkasan Batasan

| # | Batasan | Limit | Solusi |
|---|---------|-------|--------|
| 1 | MCP tools/list response size | ~8KB (8,192 bytes) | Optimasi tool schema |
| 2 | Prompt/message length | ~70 karakter | Auto-decompose prompt |
| 3 | System prompt | Tidak didukung | Kirim hanya user message |
| 4 | Message prefixes | Tidak suka `[System]:` `[User]:` | Hapus semua prefix |
| 5 | MQTT keepalive | 60s recommended | Set ke 60s |
| 6 | MQTT protocol | v3.1.1 (v5 rejected) | Set protocolVersion: 4 |
| 7 | Response format | Plain text (bukan JSON) | Parse tool calls dari text |
| 8 | MCP tool calls | Via MCP, bukan text | Listen `mcp:tool_call` event |
| 9 | Response timeout | Bervariasi (10-60s) | Buffer + auto-finalize 2s |
| 10 | Newline dalam message | Bisa masalah | Gunakan single line |

---

## 1. MCP Tools/List Response Size Limit

### Batasan
- **Limit:** ~8KB (8,192 bytes estimated)
- **Behavior:** Broker disconnects client immediately setelah menerima `tools/list` response yang melebihi limit
- **Tested:**
  - 15,423 bytes → ❌ Disconnected
  - 10,344 bytes → ❌ Disconnected
  - 9,104 bytes → ❌ Disconnected
  - 8,894 bytes → ❌ Disconnected
  - 8,079 bytes → ✅ Connected
  - 7,656 bytes → ✅ Connected
  - 7,928 bytes → ✅ Connected (Pelulu-CLI baseline)

### Solusi yang Diterapkan
```javascript
// Di src/mcp/mcp-handler.js
_optimizeTool(tool) {
  return {
    name: tool.name,
    description: tool.description?.slice(0, 60) || '',  // Truncate desc
    inputSchema: { type: 'object', properties: {} }     // Remove descriptions & enums
  };
}
```

**Optimasi yang dilakukan:**
1. Truncate tool description dari ~100+ chars ke 60 chars
2. Hapus `description` dari inputSchema properties
3. Hapus `enum` values (keep sebagai plain `{ type: "string" }`)
4. Hapus `required` array dari schema

**Hasil:**
- Sebelum: 8,523 bytes ❌
- Sesudah: 7,867 bytes ✅ (buffer: 325 bytes)

---

## 2. Prompt/Message Length Limit

### Batasan
- **Limit:** ~70 karakter per pesan
- **Behavior:** XiaoZhi tidak merespons sama sekali jika pesan lebih dari ~70 karakter
- **Tested:**
  - 50 chars → ✅ Respond
  - 60 chars → ✅ Respond
  - 70 chars → ✅ Respond
  - 72 chars → ✅ Respond (emoji only)
  - 78 chars → ✅ Respond (emoji only)
  - 80 chars → ❌ No response
  - 93 chars → ❌ No response

### Solusi yang Diterapkan
```javascript
// Di src/agent/llm-client.js
async sendPrompt(prompt) {
  const MAX_LEN = 70;
  
  if (prompt.length <= MAX_LEN) {
    await this.#mqtt.sendText(prompt);
  } else {
    // Truncate and add context hint
    const truncated = prompt.slice(0, MAX_LEN - 10) + '...';
    await this.#mqtt.sendText(truncated);
  }
}
```

**Aturan:**
- Prompt ≤ 70 chars: Kirim langsung
- Prompt > 70 chars: Truncate ke 60 chars + "..."

---

## 3. System Prompt Tidak Didukung

### Batasan
- **Behavior:** XiaoZhi mengabaikan atau tidak merespons jika pesan mengandung system prompt
- **Format yang tidak didukung:**
  - `[System]: You are...`
  - Multi-line system instructions
  - Context panjang di awal pesan

### Solusi yang Diterapkan
```javascript
// Di src/agent/llm-client.js
#buildPrompt(messages) {
  // XiaoZhi only supports user messages - skip system/assistant/tool!
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return messages[messages.length - 1]?.content || '';
}
```

**Aturan:**
- Kirim HANYA user message
- System prompt, context, dan history TIDAK dikirim ke XiaoZhi
- Tools sudah dikirim via MCP `tools/list`, tidak perlu di prompt

---

## 4. Message Prefixes Tidak Didukung

### Batasan
- **Behavior:** XiaoZhi tidak merespons jika pesan menggunakan prefix
- **Prefix yang tidak didukung:**
  - `[System]:`
  - `[User]:`
  - `[Assistant]:`
  - `[Tool Call]:`
  - `[Tool Result]:`

### Solusi yang Diterapkan
```javascript
// Di src/agent/llm-client.js
#buildPrompt(messages) {
  // NO PREFIXES - XiaoZhi doesn't like them!
  const parts = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      parts.push(msg.content);  // Langsung, tanpa prefix
    }
  }
  return parts.join('\n');
}
```

---

## 5. MQTT Keepalive

### Batasan
- **Recommended:** 60 detik
- **Behavior:** Keepalive 240s dapat menyebabkan koneksi timeout

### Solusi yang Diterapkan
```javascript
// Di src/mcp/mqtt-client.js
this.client = mqtt.connect(`mqtts://${this.mqttCfg.endpoint}:8883`, {
  keepalive: 60,  // Bukan 240
  protocolVersion: 4,  // MQTT v3.1.1
});
```

---

## 6. MQTT Protocol Version

### Batasan
- **Supported:** MQTT v3.1.1 (protocolVersion: 4)
- **Rejected:** MQTT v5 (protocolVersion: 5)

### Solusi yang Diterapkan
```javascript
// Di src/mcp/mqtt-client.js
this.client = mqtt.connect(url, {
  protocolVersion: 4,  // Force MQTT v3.1.1
});
```

---

## 7. Response Format

### Batasan
- **Format:** Plain text (bukan structured JSON)
- **Behavior:** XiaoZhi mengembalikan respons sebagai text biasa, bukan JSON tool calls
- **Contoh respons:**
  - `😊` (emoji saja)
  - `I will help you with that`
  - `{"tool": "file", "action": "read", "path": "test.js"}` (JSON dalam text)

### Solusi yang Diterapkan
```javascript
// Di src/agent/llm-client.js
#parseToolCalls(content) {
  const toolCalls = [];
  const jsonPattern = /\{[^{}]*"tool"\s*:\s*"[^"]+[^{}]*\}/g;
  const matches = content.match(jsonPattern);
  
  if (matches) {
    for (const match of matches) {
      const parsed = JSON.parse(match);
      if (parsed.tool) {
        toolCalls.push({
          id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: parsed.tool,
          args: { ...parsed, tool: undefined },
        });
      }
    }
  }
  
  return toolCalls.length > 0 ? toolCalls : null;
}
```

---

## 8. MCP Tool Calls

### Batasan
- **Behavior:** XiaoZhi mengirim tool calls via MCP protocol, bukan sebagai text
- **Event:** `mcp:tool_call` (bukan `llm:text`)
- **Flow:**
  1. XiaoZhi menerima pesan
  2. XiaoZhi mengirim MCP tool call
  3. Client mengeksekusi tool
  4. Client mengirim result balik ke XiaoZhi
  5. XiaoZhi mengirim respons text

### Solusi yang Diterapkan
```javascript
// Di src/mcp/mqtt-client.js
_onMcp(msg) {
  const responses = this.mcp.handleMessage(msg);
  for (const r of responses) {
    if (r.type === 'tool_call') {
      // Emit event agar agent bisa track
      bus.emit('mcp:tool_call', { name: r.name, args: r.args, id: r.id });
      
      this.mcp.executeTool(r.name, r.args)
        .then(result => {
          this._send({ type: 'mcp', payload: { jsonrpc: '2.0', id: r.id, result } });
          bus.emit('mcp:tool_result', { name: r.name, result, id: r.id });
        });
    }
  }
}

// Di src/agent/agent-loop.js
async #sendAndWaitForResponse(userPrompt, llm, tools) {
  return new Promise((resolve) => {
    const onText = (text) => {
      responseBuffer += text;
      if (responseTimer) clearTimeout(responseTimer);
      responseTimer = setTimeout(() => resolve({ type: 'text', content: responseBuffer }), 2000);
    };
    
    const onToolCall = (data) => {
      resolve({ type: 'tool_call', ...data });
    };
    
    bus.on('llm:text', onText);
    bus.on('mcp:tool_call', onToolCall);
    
    llm.sendPrompt(userPrompt);
  });
}
```

---

## 9. Response Timeout

### Batasan
- **Timeout bervariasi:** 10-60 detik tergantung kompleksitas
- **Behavior:** Kadang XiaoZhi merespons dalam 1 detik, kadang 30+ detik
- **Silence detection:** Jika tidak ada response baru dalam 2 detik, dianggap selesai

### Solusi yang Diterapkan
```javascript
// Di src/agent/llm-client.js
#onLlmText(text) {
  if (!this.#collecting) return;
  this.#responseBuffer += text;
  
  // Reset timer setiap ada text baru
  if (this.#responseTimer) clearTimeout(this.#responseTimer);
  this.#responseTimer = setTimeout(() => this.#finalizeResponse(), 2000);
}
```

---

## 10. Newline dalam Message

### Batasan
- **Behavior:** Newline characters dalam pesan dapat menyebabkan masalah parsing
- **Solusi:** Gunakan single line atau replace newline dengan spasi

---

## Content Filtering

### Temuan
- **Tidak ada content filtering terdeteksi**
- Tool names seperti `bruteforce`, `exploit`, `sqli`, `injection`, `fuzzer`, `evasion`, `vuln` diterima selama response di bawah 8KB

---

## MQTT Connection Details

| Parameter | Value |
|-----------|-------|
| Endpoint | `mqtt.xiaozhi.me:8883` (MQTTS) |
| Keepalive | 60s |
| Protocol | MQTT v3.1.1 |
| Subscribe topic | `devices/p2p/#` |
| Publish topic | `device-server` (from OTA) |
| Clean session | true |

---

## Device Activation

| Parameter | Value |
|-----------|-------|
| OTA URL | `https://api.tenclass.net/xiaozhi/ota/` |
| Activation URL | `https://xiaozhi.me` |
| Device name | Set in `board.name` field |
| Credentials | Fresh untuk setiap connection (jangan cache/reuse) |

---

## Best Practices untuk Pelulu-CLI/shellulu

1. **Prompt harus ≤ 70 karakter** — Jika lebih, truncate atau decompose
2. **Jangan gunakan system prompt** — Kirim hanya user message
3. **Jangan gunakan prefix** — Langsung kirim text tanpa `[System]:` dll
4. **Handle MCP tool calls** — Listen `mcp:tool_call` event, bukan hanya `llm:text`
5. **Buffer response** — XiaoZhi bisa kirim text bertahap, tunggu 2 detik setelah text terakhir
6. **Parse JSON dari text** — Tool calls mungkin dalam format JSON di tengah text
7. **Set keepalive 60s** — Jangan gunakan 240s
8. **Gunakan MQTT v3.1.1** — Set `protocolVersion: 4`

---

## File yang Terpengaruh

| File | Fungsi |
|------|--------|
| `src/mcp/mcp-handler.js` | Optimasi tools/list response |
| `src/mcp/mqtt-client.js` | MQTT connection settings + MCP events |
| `src/agent/llm-client.js` | Prompt building + response parsing |
| `src/agent/agent-loop.js` | Handle MCP tool calls + text responses |
| `src/agent/system-prompt.js` | Minimal system prompt |
| `src/agent/agent-controller.js` | Auto-decompose long prompts |

---

*Last updated: 2026-07-20*
*Tested with: Pelulu-CLI v1.1.0, shellulu v1.1.0*
