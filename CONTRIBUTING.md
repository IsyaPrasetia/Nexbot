# Contributing to NexBot

Terima kasih sudah mau berkontribusi! 👋

NexBot adalah platform kontrol bot WhatsApp berbasis Baileys. Semua logika
koneksi/session/QR dipegang inti bersama (`src/core/`), sedangkan modul
(`src/modules/{cs,admin,blast}`) berisi logika bisnis. Konfigurasi dipusatkan
di `src/config.js`.

## Cara Mulai

1. **Fork** repo ini, lalu clone fork Anda.
2. Buat branch fitur: `git checkout -b fitur/<nama-fitur>`.
3. Jalankan lokal:
   ```bash
   npm install
   cd dashboard && npm install && npm run build && cd ..
   ```
4. Jalankan dengan PM2 (recommended) atau mode single-process:
   ```bash
   pm2 start ecosystem.config.js
   # atau
   npm start
   ```

> ⚠️ Jangan pernah commit isi `data/` (session WhatsApp, QR, DB, kredensial):
> sudah dijaga oleh `.gitignore`.

## Disclaimer (Tanggung Jawab Hukum)

- Penggunaan repo ini sepenuhnya **tanggung jawab individu masing-masing**.
- Anda wajib memastikan setiap penggunaan **sesuai dengan hukum dan peraturan yang berlaku** di wilayah Anda.
- **Kami tidak memfasilitasi, menangani, maupun bertanggung jawab** atas pelanggaran hukum yang terjadi akibat penggunaan repo ini.
- Penyalahgunaan untuk aktivitas ilegal, termasuk spam massal tanpa izin, penipuan, *phishing*, atau pelanggaran Syarat Layanan WhatsApp, sepenuhnya menjadi tanggung jawab Anda.
- Repo ini disediakan apa adanya (**as-is**), tanpa jaminan apa pun.

## Pedoman Kontribusi

### Bug report
Buat issue dengan template *Bug report*. Sertakan:
- Deskripsi singkat & langkah reproduksi.
- Output `pm2 logs <modul>` yang relevan.
- Versi Node.js dan OS.

### Fitur baru
Buat issue dengan template *Feature request* terlebih dulu, atau langsung
buka PR dari branch fitur. Jelaskan *kenapa* fitur ini dibutuhkan.

### Aturan code
- Ikuti gaya kode yang sudah ada (tidak ada formatter ketat; konsisten = kunci).
- Jangan menambah dependensi tanpa alasan jelas.
- Nama variabel/fungsi: Indonesia atau English, tapi **konsisten** di satu file.
- Path/folder harus lewat `src/config.js` : jangan hardcode.

### Commit
- Gaya pesan commit konvensional (ringkas): `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- Satu commit = satu perubahan logis.

## Proses PR

1. Push branch Anda: `git push -u origin fitur/<nama-fitur>`.
2. Buka Pull Request menggunakan template yang disediakan.
3. Sebutkan issue terkait bila ada (contoh `Closes #12`).
4. Tunggu review. Beri tanggapan bila ada permintaan perubahan.

## Pre-flight checklist sebelum membuka PR

- [ ] `npm install` bersih (0 vulnerability).
- [ ] `pm2 logs` tidak menampilkan error baru.
- [ ] Tidak ada session/data runtime yang ikut ter-commit.
- [ ] Utk perubahan dashboard: `npm run build` sukses.

## Areas yang sering butuh bantuan

- Perbaikan reconnect/QR Baileys (stabilitas koneksi multimodal).
- Unit/integration test (saat ini belum ada).
- Internasionalisasi pesan bot.
- Dokumentasi API bridge dan dashboard.