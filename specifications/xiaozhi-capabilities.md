# XiaoZhi AI — Capabilities & Measured Limits

Dokumen ini melengkapi `xiaozhi-specs.md` dan `xiaozhi-mqtt-broker.md`. Isinya
adalah hasil **pengukuran empiris** langsung terhadap broker XiaoZhi
(`mqtt.xiaozhi.me`) menggunakan skrip di `scripts/`. Angka bisa berubah antar
run karena ini server hidup — anggap sebagai panduan, bukan jaminan keras.

Cara reproduksi semua temuan di bawah:

```bash
node scripts/capabilities.js            # jalankan semua eksperimen
node scripts/capabilities.js latency    # satu eksperimen
node scripts/capabilities.js length context tools
```

Eksperimen tersedia: `latency`, `length`, `context`, `language`, `tools`,
`session`, `prefix`, `systemprompt`.

---

## Ringkasan Temuan

| # | Aspek | Temuan terukur | Implikasi untuk agent |
|---|-------|----------------|-----------------------|
| 1 | Latency balasan | ~0.5–2s ke token pertama (avg ~1s) | Aman untuk interaktif; jangan set timeout balasan < 5s |
| 2 | Panjang input | Praktis ~55–70 karakter sebelum server diam | Potong/ringkas prompt user sebelum dikirim |
| 3 | Memori percakapan | Tidak andal per-turn; TAPI ada memori level-akun lintas sesi | Jangan andalkan konteks; kirim info penting eksplisit tiap turn |
| 4 | Bahasa | Fasih ID + EN | Boleh prompt dalam bahasa apa pun |
| 5 | Output kode | Dikembalikan sebagai prosa lisan, bukan kode verbatim | JANGAN minta model "ketik kode"; pakai MCP file tool |
| 6 | MCP tools | Handshake `initialize`/`tools/list` tepat setelah `hello`; tool call terjadi tapi tidak tiap turn | Eksekusi tool di server MCP kita (sudah benar) |
| 7 | Session idle | `goodbye` saat idle; perlu re-`hello` | Sudah ditangani `ensureSession()` |
| 8 | Prefix `[System]:` | Tidak selalu memblokir balasan (toleran di run terbaru) | Tetap aman untuk di-strip |
| 9 | `hello.system_prompt` | Tidak diikuti secara andal | Jangan bergantung pada system prompt |
| 10 | Batas transport MQTT | ~8KB per pesan → koneksi putus | Clamp hasil tool (`_clampResult`) |

---

## 1. Latency

Diukur dari saat `listen/detect` dikirim sampai `tts sentence_start` pertama.

```
"halo"              846 ms
"apa kabar"        2052 ms
"what is 2 plus 2"  537 ms
"sebutkan satu warna" 618 ms
avg ≈ 1013 ms
```

- Balasan **stream** sebagai beberapa event `tts` `sentence_start` berturut-turut
  (biasanya 2–3 kalimat), bukan satu payload.
- Turn dianggap selesai setelah ~2.5s hening (dipakai `agent-loop.js` `quietMs`).

## 2. Panjang Input

Binary-search panjang pesan yang masih dibalas:

```
len=205 -> silent
len=107 -> silent
len=58  -> silent
len=57  -> reply
len=56  -> reply
...
max ~57 karakter masih dibalas
```

- Ambang **content-dependent** (kalimat berulang/aneh lebih cepat diabaikan).
  Praktisnya jaga input di **≤ ~60–70 karakter** untuk aman.
- Di atas ambang, server cenderung **diam total** (bukan error), sehingga terlihat
  seperti "tidak merespons".

## 3. Memori Percakapan

- Dalam satu sesi, model **tidak** mengulang fakta arbitrer secara andal saat
  langsung ditanya ("angka rahasia saya tadi").
- Namun teramati **memori level-akun yang persisten lintas koneksi**: nilai
  "42" yang ditanam di satu run muncul lagi di run/koneksi berikutnya. Artinya
  memori disimpan **server-side per akun/device**, tidak bisa dikontrol per sesi.
- **Implikasi:** jangan mengandalkan riwayat. Kirim konteks penting (path file,
  instruksi) secara eksplisit di tiap turn. Agent kita menyimpan riwayatnya
  sendiri di `agent-loop.js` dan tidak bergantung pada memori server.

## 4. Bahasa

Fasih Bahasa Indonesia dan Inggris:

```
[id] "A variable is like a container that holds data!"
[en] "You give it a name, and it stores a value that can change."
```

## 5. Output Kode (penting)

Ini adalah **model asisten suara**. Saat diminta menulis kode, ia menjawab dalam
**prosa lisan**, bukan blok kode verbatim:

```
[code] "For example, if you have a variable called "score", it might hold 10 now,"
```

- **Jangan** pernah meminta XiaoZhi "mengetik" isi file. Untuk membuat kode nyata,
  arahkan ia memanggil **MCP file tool** (`file.write` / `file.edit`) — konten
  aktual dibuat di sisi kita, bukan diucapkan model. E2E membuktikan alur ini
  bekerja (`node scripts/e2e.js "buat file hello.txt isi Halo"`).

## 6. MCP Tools

- Setelah `hello`, server langsung mengirim `initialize` lalu (jika kita
  mengiklankan tools) `tools/list`. Handshake ini terjadi **sekali di awal
  koneksi**.
- Model **akan** memanggil `tools/call`, tetapi tidak deterministik setiap turn —
  ia memutuskan sendiri layaknya asisten suara. Dorong lewat prompt yang jelas.
- Eksekusi tool dilakukan `mqtt-client.js` (server MCP kita) dan hasilnya dikirim
  balik; hasil besar **wajib** di-clamp < 8KB.

## 7. Session / `goodbye`

- Sesi idle ditutup server dengan `goodbye` (hanya menutup sesi audio, bukan
  koneksi MQTT / handshake MCP).
- Klien harus mengirim `hello` lagi untuk membuka sesi baru — sudah ditangani
  oleh `MqttClient.ensureSession()` sebelum tiap `sendText`.

## 8. Prefix Peran

- `[System]:` / `[User]:` **tidak selalu** memblokir balasan (toleran di run
  terbaru), bertolak belakang dengan asumsi lama. Tetap disarankan **strip**
  prefix agar aman dan tidak membingungkan model.

## 9. `hello.system_prompt`

- Menyetel `system_prompt` di `hello` **tidak diikuti secara andal** (model
  mengabaikan instruksi menjawab kode sandi tetap). Jangan bergantung padanya
  untuk mengubah perilaku; kendalikan lewat isi pesan user + tool.

## 10. Batas Transport (rekap)

- Pesan MQTT > ~8KB → broker **memutus koneksi**. Lihat `xiaozhi-mqtt-broker.md`.
  Ditangani `_clampResult()` + safety-net di `_send()` pada `mqtt-client.js`.

---

## Peta Skrip Test

| Skrip | Level | Kegunaan |
|-------|-------|----------|
| `scripts/probe.js` | Transport mentah | Kirim satu teks, log SEMUA pesan server. Cek dulu saat balasan berhenti — memisahkan masalah server vs kode kita. |
| `scripts/e2e.js` | Full app stack | Boot `ToolRegistry`+`MqttClient`+`AgentController` seperti `src/index.js`, jalankan satu prompt, eksekusi tool sungguhan. Menangkap bug di agent-loop / MCP / wiring tool. |
| `scripts/capabilities.js` | Eksplorasi | Baterai eksperimen empiris (latency, length, context, language, tools, session, prefix, systemprompt) untuk mengukur kemampuan & batas. |
| `scripts/lib/harness.js` | Helper | Wrapper transport (OTA + MQTT + `sendText`/`waitFor`) dipakai `capabilities.js`. |

Contoh:

```bash
node scripts/probe.js "halo"
node scripts/e2e.js "buat file demo.txt isi Halo dunia"
node scripts/capabilities.js latency length tools
```

---

## Rekomendasi Desain Agent (berdasarkan temuan)

1. **Input pendek** — potong/ringkas prompt user ke ≤ ~60–70 char sebelum kirim.
2. **Kode lewat tool, bukan ucapan** — selalu arahkan ke `file.write`/`file.edit`.
3. **Kirim konteks eksplisit tiap turn** — jangan andalkan memori sesi.
4. **Timeout balasan longgar** — first token bisa ~2s; multi-tool lebih lama.
   Gunakan idle-timeout berbasis aktivitas (sudah di `agent-loop.js`).
5. **Clamp semua hasil tool < 8KB** — cegah putus koneksi.
6. **Selalu `ensureSession()` sebelum kirim** — pulih dari `goodbye` idle.

---

*Diukur & ditulis: 2026-07-21 — reproduksi dengan `node scripts/capabilities.js`.*
