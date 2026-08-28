# NexBot

**NexBot** — Platform kontrol bot WhatsApp berbasis **Baileys** (multi-device WebSocket, bukan `whatsapp-web.js`). Satu inti (core) yang dipakai ulang oleh banyak bot/modul, satu dashboard untuk mengontrol semuanya.

Proyek ini mengonsolidasikan 4 aplikasi terpisah menjadi **satu repo & satu mekanisme**:

| Modul | Fungsi | Bridge (legacy) |
|-------|--------|-----------------|
| **AI-CS** (`src/modules/cs`) | Auto-reply menu webinar + broadcast grup (multi-slot admin1/2/3) | `5591` |
| **AI-ADMIN** (`src/modules/admin`) | Crawler website, ekstraksi PDF, AI (Ollama), laporan harian (multi-slot, bisa ganti nomor) | `5592` |
| **BLASTER** (`src/modules/blast`) | WA blast massal (3 slot s1/s2/s3) | `5588` |
| **DASHBOARD** (`dashboard/`) | Panel monitor & kontrol semua bot | `5577` |

---

## Disclaimer (Tanggung Jawab Pengguna)

- Penggunaan repo ini sepenuhnya **tanggung jawab individu masing-masing**.
- Anda wajib memastikan setiap penggunaan **sesuai dengan hukum dan peraturan yang berlaku** di wilayah Anda.
- **Kami tidak memfasilitasi, menangani, maupun bertanggung jawab** atas pelanggaran hukum yang terjadi akibat penggunaan repo ini.
- Penyalahgunaan untuk aktivitas ilegal — termasuk spam massal tanpa izin, penipuan, *phishing*, atau pelanggaran Syarat Layanan WhatsApp — sepenuhnya menjadi tanggung jawab Anda.
- Repo ini disediakan apa adanya (**as-is**), tanpa jaminan apa pun.

---

## Fitur Utama

- **Satu core Baileys** (`src/core/`) — `session.js`, `manager.js`, `bridge.js`, `paths.js`. Kode koneksi/session/QR/reconnect dipakai bersama, bukan ditulis ulang per bot.
- **Konfigurasi terpusat** (`src/config.js`) — semua port, path data, grup, timing dalam satu file.
- **Multi-slot** — AI-CS sudah multi-admin; AI-ADMIN kini juga bisa diganti nomornya dari dashboard (slot `admin1/admin2/admin3`).
- **Slot utama = `admin1`** — bot pertama yang aktif; sisanya slot tambahan.
- **Unified bridge** (`src/core/bridge.js`) — satu port (default `5610`) dengan prefix `/cs`, `/admin`, `/blast`. Bisa dipakai bila ingin menjalankan semua modul dalam satu proses.
- **Dashboard** — monitor PM2, log, insiden, data bot, login, tunel Cloudflare, editor file, dengan lock/session system.

---

## Struktur Direktori

```
NexBot/
├── package.json
├── ecosystem.config.js      # PM2 multi-proses
├── README.md
├── .gitignore
├── src/
│   ├── index.js             # entry utama (unified bridge)
│   ├── config.js            # KONFIGURASI TERPUSAT
│   ├── core/                # 🔧 inti bersama Baileys
│   │   ├── session.js       # koneksi WASocket + QR + reconnect
│   │   ├── manager.js       # manajer multi-slot
│   │   ├── bridge.js        # unified HTTP bridge
│   │   └── paths.js         # helper path session/QR
│   └── modules/
│       ├── cs/              # AI-CS
│       ├── admin/           # AI-ADMIN
│       └── blast/           # BLASTER
├── dashboard/               # React + Vite + Express dashboard
└── data/                    # runtime (session, QR, DB, uploads) — di-ignore git
```

---

## Instalasi

### Prasyarat
- **Node.js 18+** (disarankan 20/22; proyek ini diuji di v24)
- **Ollama** (hanya untuk AI-ADMIN) berjalan di `http://127.0.0.1:11434` dengan model `qwen2.5:1.5b`
- **PM2** global: `npm i -g pm2`
- Internet untuk koneksi WhatsApp & crawler website

### Langkah
```bash
# 1. Clone & masuk
git clone <url-repo> NexBot
cd NexBot

# 2. Install dependensi
npm install

# 3. (Opsional) salin data runtime lama supaya langsung jalan
#    - data/cs/    : grup_webinar.json, menu_texts.json, *.db
#    - data/admin/ : database.json, archive.json, credentials.json, cache-*.txt, daftar_spreadsheet.json

# 4. Jalankan mode single-process (semua modul + unified bridge)
npm start
```

> **Catatan kredensial Google Sheets**: taruh file service-account di
> `data/admin/credentials.json` (tidak di-commit, lihat `.gitignore`).

---

## Menjalankan di Lokal (komputer sendiri / dev)

NexBot **tidak menyentuh bot produksi**. Semua session & datanya di folder
`data/` yang terpisah (kosong saat pertama clone), jadi bot produksi aman.

> ⚠️ **PENTING untuk port**: NexBot memakai port yang SAMA dengan produksi
> (5591/5592/5588/5577/5610). Kalau kamu jalankan **di mesin yang sama** dengan
> server produksi, ganti port dulu supaya tidak bentrok (lihat bagian "Ganti
> port" di bawah). Di laptop kamu sendiri, aman tanpa ganti apa pun.

### 1. Clone & install
```bash
git clone https://github.com/IsyaPrasetia/Nexbot.git NexBot
cd NexBot

# dependensi backend
npm install

# dependensi + build dashboard
cd dashboard
npm install
npm run build
cd ..
```

### 2. Jalankan (mode multi-proses, recommended)
```bash
pm2 start ecosystem.config.js
pm2 status
```

Atau mode single-process sederhana (semua modul + unified bridge di satu proses):
```bash
npm start
```

### 3. Scan QR
Tiap modul mencetak QR di terminal dan menyimpan gambar ke `data/qr/`:
- AI-CS → `cs_qr_admin1.png` / `admin2` / `admin3`
- AI-ADMIN → `admin_qr_admin1.png` (slot aktif; ganti via dashboard / `/setslot`)
- BLASTER → QR muncul di log

Scan dengan nomor WhatsApp yang mau dipasang. **Gunakan nomor uji coba**, bukan
nomor bot produksi, agar tidak tabrakan dengan WhatsApp yang sedang jalan.

### 4. Buka dashboard
`http://localhost:5577` — login pakai akun yang kamu buat di `dashboard/users.json`.
Contoh format akun di file tsb:
```json
{ "user": "ganti-user", "passwordHash": "<hash scrypt>", "role": "admin" }
```
> Buat akun baru & ganti password sebelum dipakai serius (jangan pakai kredensial lama/default).

### Opsional: data pengujian
Kalau mau menguji dengan seeding data (bukan dari produksi), salin contoh dari
`data/` starter yang sudah di-commit (mis. `database.json`, `daftar_spreadsheet.json`).

---

### Ganti port (hanya kalau jalan bareng produksi/servis lain)
Semua port diatur sekali di `src/config.js`:
- `bridge.port` (5610)
- `cs.port` (5591)
- `admin.port` (5592)
- `blast.port` (5588)
- DASHBOARD di `ecosystem.config.js` (`env.PORT`, default 5577)

Lalu jika dashboard mem-proxy ke port, sesuaikan juga di
`dashboard/server/index.js` (proksi `/api/csbridge`, `/api/adminbridge`, `/api/blast`).

---

## Deploy dengan PM2 (Recommended — multi-proses)

Setiap modul jalan sendiri sehingga satu crash tidak menumbangkan yang lain.

```bash
pm2 start ecosystem.config.js
pm2 save                 # agar auto-start saat reboot
pm2 restart AI-CS        # restart satu modul saja
pm2 logs AI-CS           # lihat log satu modul
```

Proses yang dibuat:

| Nama | Script | Port |
|------|--------|------|
| `NexBot-CORE` | `src/index.js` | 5610 |
| `AI-CS` | `src/modules/cs/index.js` | 5591 |
| `AI-ADMIN` | `src/modules/admin/index.js` | 5592 |
| `BLASTER` | `src/modules/blast/index.js` | 5588 |
| `DASHBOARD` | `dashboard/server/index.js` | 5577 |

---

## Setelah Pertama Jalan

1. **Scan QR tiap slot** — setiap modul mencetak QR di terminal dan menyimpan gambar QR di `data/qr/`. Scan dengan WhatsApp yang ingin dipasang:
   - AI-CS: `admin1` (utama, full fitur), `admin2` (bulk-only), `admin3` (reply-only).
   - AI-ADMIN: slot aktif (default `admin1`) mengirim notifikasi ke 2 grup.
   - BLASTER: `s1`, `s2`, `s3` (pengirim blast massal).
2. **Buka dashboard** di `http://localhost:5577` (login pakai akun yang kamu buat di `dashboard/users.json`).
3. Pastikan **Ollama** aktif sebelum menghidupkan AI-ADMIN.

---

## Mengganti Nomor AI-ADMIN (Multi-Slot)

Melalui dashboard (tab AI-ADMIN) atau langsung via bridge:

```bash
# lihat slot aktif
curl http://127.0.0.1:5592/slot
# ganti slot (QR baru akan muncul untuk nomor tsb)
curl -X POST http://127.0.0.1:5592/setslot -H "Content-Type: application/json" -d '{"slot":"admin2"}'
```

---

## Konfigurasi (src/config.js)

Semua diset terpusat di `src/config.js`:

- **bridge.port** — port unified bridge (`5610`)
- **cs / admin / blast** — port legacy, daftar slot, grup WA, timing, semua path file
- **data dir** — semua runtime di `data/` (session, QR, DB, cache, uploads)

Ubah di sini, efek ke seluruh modul — tidak perlu edit per-file.

---

## Catatan Migrasi / Kompatibilitas

- Semua bot asli (cs.js, admin.js, blast.js) **sudah berbasis Baileys** — tidak ada migrasi dari `whatsapp-web.js`.
- Modul NexBot menjaga **semua logika bisnis asli** (auto-reply, broadcast, crawler, PDF pipeline, daily report, blast engine) — hanya pindah jalur koneksi/session/path ke core & config.
- File asli disimpan sebagai referensi: `src/modules/<m>/<m>.original.js`.
- Dashboard **tetap kompatibel** dengan port legacy (5591/5592/5588) sehingga tidak perlu ubah frontend bila hanya upgrade backend.

---

## Troubleshooting

- **Ollama mati saat proses PDF** → hidupkan `ollama serve`, restart `AI-ADMIN`.
- **QR tidak muncul di dashboard** → QR dianggap "fresh" ≤120 detik; pastikan slot masih menunggu scan.
- **Blast tidak jalan (consecutive fail ≥10)** → job otomatis di-pause (anti-ban); cek log `data/blast/blast-log.jsonl`.
- **Lupa password dashboard** → hapus/edit `dashboard/users.json` (password di-hash scrypt).

---

## Kontribusi

- Panduan berkontribusi: [CONTRIBUTING.md](CONTRIBUTING.md)
- Kode etik komunitas: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Lapor kerentanan keamanan: [SECURITY.md](SECURITY.md)

## Lisensi

MIT © Prasetia. Gunakan secara bertanggung jawab; hormati ketentuan WhatsApp.
