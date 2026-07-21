# XiaoZhi AI — Specifications & Limitations

Dokumen ini berisi semua batasan XiaoZhi AI yang ditemukan selama pengembangan Pelulu-CLI dan shellulu.

> **Lihat juga:** `xiaozhi-capabilities.md` untuk hasil pengukuran empiris
> (latency, panjang input, memori, tools, session) beserta skrip reproduksinya
> (`scripts/capabilities.js`). Beberapa angka di bawah sudah diverifikasi ulang
> di sana (mis. panjang input terukur ~57–70 char, dan prefix ternyata tidak
> selalu memblokir balasan).

---

## Ringkasan Batasan

| # | Batasan | Limit | Solusi |
|---|---------|-------|--------|
| 1 | MCP tools/list response | ~8KB | Optimasi tool schema |
| 2 | Message length | ~70 karakter | Input validation di TUI |
| 3 | System prompt | Tidak didukung | Kirim user message saja |
| 4 | Message prefixes | `[System]:` dll | Hapus semua prefix |
| 5 | MQTT keepalive | 60s | Set ke 60s |
| 6 | MQTT protocol | v3.1.1 | Set protocolVersion: 4 |
| 7 | Response format | Plain text | Parse tool calls dari text |
| 8 | MCP tool calls | Via MCP | Listen `mcp:tool_call` event |
| 9 | Response timeout | 10-60s | Buffer + 2s silence detect |

---

## 1. MCP Tools/List Response Size

- **Limit:** ~8KB (8,192 bytes)
- **Behavior:** Broker disconnects client jika response melebihi limit
- **Solusi:** Optimasi tool schema — hapus descriptions, enums, required arrays

```javascript
_optimizeTool(tool) {
  return {
    name: tool.name,
    description: tool.description?.slice(0, 60),
    inputSchema: { type: 'object', properties: {} }
  };
}
```

---

## 2. Message Length Limit

- **Limit:** ~70 karakter per pesan
- **Behavior:** XiaoZhi tidak merespons jika pesan > 70 chars
- **Solusi:** Input validation di TUI + controller

```javascript
if (text.length > 70) {
  // Tampilkan warning
  return;
}
```

---

## 3. System Prompt Tidak Didukung

- **Behavior:** XiaoZhi mengabaikan system prompt
- **Solusi:** Kirim hanya user message

---

## 4. Message Prefixes

- **Prefix yang tidak didukung:** `[System]:`, `[User]:`, `[Assistant]:`
- **Solusi:** Hapus semua prefix

---

## 5. MQTT Settings

| Parameter | Value |
|-----------|-------|
| Endpoint | `mqtt.xiaozhi.me:8883` |
| Keepalive | 60s |
| Protocol | MQTT v3.1.1 |
| Subscribe | `devices/p2p/#` |
| Publish | `device-server` |

---

## 6. Response Handling

- **Format:** Plain text (bukan JSON)
- **Tool calls:** Via MCP protocol (`mcp:tool_call` event)
- **Silence detection:** 2 detik tanpa text baru = response selesai

---

## Best Practices

1. **Input ≤ 70 karakter** — Jika lebih, TUI akan reject
2. **Jangan gunakan system prompt** — Kirim user message saja
3. **Handle MCP tool calls** — Listen `mcp:tool_call` event
4. **Buffer response** — Tunggu 2 detik setelah text terakhir
5. **Set keepalive 60s** — Jangan gunakan 240s
6. **Gunakan MQTT v3.1.1** — Set `protocolVersion: 4`

---

## File Structure

```
src/agent/
├── agent-controller.js  # Orchestrator
├── agent-loop.js        # Observe→think→act cycle
├── llm-client.js        # MQTT wrapper
├── context-builder.js   # Workspace context
├── system-prompt.js     # Internal prompt (not sent)
└── index.js             # Exports
```

---

*Last updated: 2026-07-20*
