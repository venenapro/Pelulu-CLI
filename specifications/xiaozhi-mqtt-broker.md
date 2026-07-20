# XiaoZhi MQTT Broker Specifications

## MCP Tools/List Response Size Limit

- **Limit:** ~8KB (8,192 bytes estimated)
- **Behavior:** Broker disconnects client immediately after receiving `tools/list` response that exceeds the limit
- **Tested:** 
  - 15,423 bytes → ❌ Disconnected
  - 10,344 bytes → ❌ Disconnected  
  - 9,104 bytes → ❌ Disconnected
  - 8,894 bytes → ❌ Disconnected
  - 8,079 bytes → ✅ Connected
  - 7,656 bytes → ✅ Connected
  - 7,928 bytes → ✅ Connected (Pelulu-CLI baseline)

## Content Filtering

- **No content filtering detected.** Tool names like `bruteforce`, `exploit`, `sqli`, `injection`, `fuzzer`, `evasion`, `vuln` are accepted as long as response is under 8KB.

## Optimization Techniques (to stay under 8KB)

1. Remove `description` from inputSchema properties
2. Remove `action` enum values (keep as plain `{ type: "string" }`)
3. Trim tool descriptions to essential keywords only

## MQTT Connection

- **Endpoint:** `mqtt.xiaozhi.me:8883` (MQTTS)
- **Keepalive:** 60s recommended (240s may cause issues)
- **Protocol:** MQTT v3.1.1 (v5 rejected)
- **Subscribe topic:** `devices/p2p/#`
- **Publish topic:** `device-server` (from OTA response)
- **subscribe_topic from OTA:** Always `"null"` (string, not null)

## Device Activation

- **OTA URL:** `https://api.tenclass.net/xiaozhi/ota/`
- **Activation URL:** `https://xiaozhi.me`
- **Device name:** Set in `board.name` field of OTA request
- **Credentials:** Fresh credentials from OTA for each connection (do not cache/reuse)

## Tool Execution Notes

- **Port scanning:** Use `nc -z -w1` (netcat) instead of `bash /dev/tcp` for reliable scanning
- **Timeout:** 15 default ports × 1s timeout = ~15-20s total (within 30s tool timeout)
- **Shell escaping:** Use semicolons (`;`) not newlines when passing multi-command scripts to `bash -c` via `JSON.stringify`
