# Security Policy

## Supported Versions

Versi yang mendapat dukungan keamanan (security fixes):

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | ✅ Supported       |
| < 1.0   | ❌ Not supported   |

## Melaporkan Kerentanan

**Jangan** membuka issue publik untuk kerentanan keamanan yang belum
diperbaiki. Kirim laporan privat ke:

- **Email:** isyaprasetia@gmail.com

Apa yang perlu disertakan:

- Tipe kerentanan (mis. XSS, SSRF, leak kredensial, path traversal, DoS).
- Langkah reproduksi lengkap (lebih bagus bila ada contoh payload).
- Dampak yang mungkin terjadi pada pengguna/bot.

### Waktu penanganan

1. Konfirmasi penerimaan laporan: **≤ 48 jam**.
2. Status & perkiraan perbaikan: **≤ 7 hari kerja**.
3. Rilis patch lalu publikasi (co-ordinated disclosure).

Kami berkomitmen memperlakukan semua laporan dengan serius dan tanpa
menyalahkan pelapor.

## Area sensitif yang perlu diperhatikan

Proyek ini menangani **kredensial sesi WhatsApp** dan **data pengguna**
(`data/sessions`, `data/admin/credentials.json`). Perubahan yang berpotensi
mengekspos data tersebut (logging, API bridge, dashboard proxy, path traversal
di file server) harus di-review ekstra.

## Disclaimer (Tanggung Jawab Hukum)

- Penggunaan repo ini sepenuhnya **tanggung jawab individu masing-masing**.
- Anda wajib memastikan setiap penggunaan **sesuai dengan hukum dan peraturan yang berlaku** di wilayah Anda.
- **Kami tidak memfasilitasi, menangani, maupun bertanggung jawab** atas pelanggaran hukum yang terjadi akibat penggunaan repo ini.
- Penyalahgunaan untuk aktivitas ilegal, termasuk spam massal tanpa izin, penipuan, *phishing*, atau pelanggaran Syarat Layanan WhatsApp, sepenuhnya menjadi tanggung jawab Anda.
- Repo ini disediakan apa adanya (**as-is**), tanpa jaminan apa pun.

## Praktik aman untuk kontributor

- Jangan commit kredensial, session auth, atau token apa pun.
- Jangan log isi pesan WhatsApp secara mentah tanpa anonimisasi.
- Hati-hati dengan fitur yang menerima input URL/path dari pengguna dashboard;
  selalu validasi & batasi ke root yang diizinkan (`config.DATA_DIR`).