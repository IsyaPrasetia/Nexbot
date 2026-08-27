const { default: makeWASocket, useMultiFileAuthState, downloadMediaMessage, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const QRCodeLib = require('qrcode');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// Menggunakan fork modern yang mendukung penuh Node.js v24+
const pdfParser = require('pdf-parse-fork');

// --- KONFIGURASI OPERASIONAL (dari config.js terpusat) ---
const config = require('../../config');
const CFG = config.admin;

const NOMOR_WA_ADMIN = '6281290330125';
const INTERVAL_CEK = CFG.INTERVAL_CEK;
const JAM_KIRIM_HARIAN = CFG.JAM_KIRIM_HARIAN;

// --- ENTITAS 1: PSI ---
const URL_PSI = CFG.URL_PSI;
const GRUP_PSI = CFG.GRUP_PSI;

// --- ENTITAS 2: ARTERIA MEDPRO ---
const URL_ARTERIA = CFG.URL_ARTERIA;
const GRUP_ARTERIA = CFG.GRUP_ARTERIA;

// CONFIG AI JALUR LOKAL
const NAMA_MODEL_AI = CFG.NAMA_MODEL_AI;
const DB_FILE = CFG.files.database;
const ARCHIVE_FILE = CFG.files.archive;
const LOG_FILE = CFG.files.logReminder;
const CACHE_PSI = CFG.files.cachePsi;
const CACHE_ARTERIA = CFG.files.cacheArteria;
// const MATERI_FILE = CFG.files.materi;

// CONFIG GOOGLE SHEETS (REKAP PENDAFTAR GOOGLE FORM)
const SPREADSHEET_FILE = CFG.files.daftarSpreadsheet;
const CREDENTIALS_FILE = CFG.files.credentials;

// Slot aktif (default admin1, bisa diganti dari dashboard via bridge /setslot)
const activeSessionDir = () => CFG.slotSession(CFG.activeSlot());
const activeQrFile = () => CFG.slotQr(CFG.activeSlot());

// Global socket reference
let sock = null;
let pemantauanSudahDimulai = false;
let intervalPemantauan = null;

// BATCH BUFFER: kumpulkan materi PDF, respon setelah semua selesai
// const bufferMateri = {};  // { 'Arteria': [{ namaFile, chatId }], 'PSI': [...] }
// const timerMateri = {};   // { 'Arteria': timeoutId, 'PSI': timeoutId }
// const DELAY_MATERI_MS = 5000; // tunggu 5 detik setelah file terakhir

// PROTEKSI DATABASE SAFE-READ
function bacaDatabase() {
    try {
        if (!fs.existsSync(DB_FILE)) { fs.writeFileSync(DB_FILE, '[]', 'utf8'); return []; }
        const isi = fs.readFileSync(DB_FILE, 'utf8').trim();
        if (!isi) { fs.writeFileSync(DB_FILE, '[]', 'utf8'); return []; }
        return JSON.parse(isi);
    } catch (errDb) {
        console.error("Database kosong/corrupt! Mengatur ulang ke format bersih.");
        fs.writeFileSync(DB_FILE, '[]', 'utf8');
        return [];
    }
}

function simpanDatabase(dataBaru) {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(dataBaru, null, 2), 'utf8'); } catch(e) { console.error("Gagal simpan DB:", e); }
}

function bacaArsip() {
    try {
        if (!fs.existsSync(ARCHIVE_FILE)) { fs.writeFileSync(ARCHIVE_FILE, '[]', 'utf8'); return []; }
        const isi = fs.readFileSync(ARCHIVE_FILE, 'utf8').trim();
        if (!isi) { fs.writeFileSync(ARCHIVE_FILE, '[]', 'utf8'); return []; }
        return JSON.parse(isi);
    } catch (errDb) {
        console.error("Arsip corrupt! Mengatur ulang.");
        fs.writeFileSync(ARCHIVE_FILE, '[]', 'utf8');
        return [];
    }
}

function simpanArsip(data) {
    try { fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch(e) { console.error("Gagal simpan arsip:", e); }
}

// 📊 HELPER GOOGLE SHEETS DINAMIS
function bacaDaftarSpreadsheet() {
    try {
        if (!fs.existsSync(SPREADSHEET_FILE)) { fs.writeFileSync(SPREADSHEET_FILE, '[]', 'utf8'); return []; }
        const isi = fs.readFileSync(SPREADSHEET_FILE, 'utf8').trim();
        return isi ? JSON.parse(isi) : [];
    } catch (e) {
        return [];
    }
}

function simpanDaftarSpreadsheet(data) {
    try { fs.writeFileSync(SPREADSHEET_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch (e) { console.error("Gagal simpan daftar spreadsheet:", e.message); }
}

// Ambil judul tab aktif (mengatasi nama tab "Form Responses 1" dll)
async function cariNamaSheet(googleSheets, auth, spreadsheetId) {
    try {
        const meta = await googleSheets.spreadsheets.get({
            auth,
            spreadsheetId,
            fields: 'sheets.properties.title'
        });
        const judul = meta.data.sheets && meta.data.sheets[0] && meta.data.sheets[0].properties.title;
        return judul || null;
    } catch (e) {
        return null;
    }
}

async function ambilRekapGoogleSheets(entitas) {
    try {
        if (!fs.existsSync(CREDENTIALS_FILE)) {
            return `\n\n📊 *Google Form (${entitas}):* ⚠️ File credentials.json belum ditemukan di server.`;
        }

        const daftarSpread = bacaDaftarSpreadsheet();
        const target = daftarSpread.find(item => item.entitas.toUpperCase() === entitas.toUpperCase());

        if (!target || !target.spreadsheetId) {
            return `\n\n📊 *Google Form (${entitas}):* Belum ada Spreadsheet aktif minggu ini. (Gunakan \`!setspread ${entitas} <ID_Sheet>\`)`;
        }

        const { google } = require('googleapis');
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_FILE,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const client = await auth.getClient();
        const googleSheets = google.sheets({ version: 'v4', auth: client });

        // Cari nama tab aktif, fallback "Sheet1"
        const judulSheet = (await cariNamaSheet(googleSheets, auth, target.spreadsheetId)) || 'Sheet1';

        const getRows = await googleSheets.spreadsheets.values.get({
            auth,
            spreadsheetId: target.spreadsheetId,
            range: `${judulSheet}!A:Z`,
        });

        const rows = getRows.data.values;
        if (!rows || rows.length <= 1) {
            return `\n\n📊 *Google Form (${entitas}):*\n📌 *Event:* ${target.namaEvent || 'Event Aktif'}\n👥 *Total Pendaftar:* 0 Orang`;
        }

        const totalPendaftar = rows.length - 1; // Mengabaikan baris header

        let teks = `\n\n📊 *REKAP GOOGLE FORM (${entitas.toUpperCase()}):*\n`;
        if (target.namaEvent) teks += `📌 *Event:* ${target.namaEvent}\n`;
        teks += `👥 *Total Pendaftar:* ${totalPendaftar} Orang\n`;
        teks += `🔗 _ID Sheet: ${target.spreadsheetId.substring(0, 8)}..._`;

        return teks;

    } catch (error) {
        console.error(`Gagal membaca Google Sheets [${entitas}]:`, error.message);
        return `\n\n📊 *Google Form (${entitas}):* ❌ Gagal mengambil data (Cek izin email Service Account).`;
    }
}

// PROTEKSI MATERI SAFE-READ (DINONAKTIFKAN - MENUNGGU TINJAUAN ULANG)
/*
function bacaMateri() {
    try {
        if (!fs.existsSync(MATERI_FILE)) { fs.writeFileSync(MATERI_FILE, '{"events":[]}', 'utf8'); return { events: [] }; }
        const isi = fs.readFileSync(MATERI_FILE, 'utf8').trim();
        if (!isi) { fs.writeFileSync(MATERI_FILE, '{"events":[]}', 'utf8'); return { events: [] }; }
        return JSON.parse(isi);
    } catch (errDb) {
        console.error("Materi corrupt! Mengatur ulang ke format bersih.");
        fs.writeFileSync(MATERI_FILE, '{"events":[]}', 'utf8');
        return { events: [] };
    }
}

function simpanMateri(data) {
    try { fs.writeFileSync(MATERI_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch(e) { console.error("Gagal simpan materi:", e); }
}
*/

function bersihkanArsipLama() {
    const jamSkrg = jamWIB();
    if (jamSkrg !== JAM_KIRIM_HARIAN) return; // Hanya jalan jam 8 pagi

    try {
        const arsip = bacaArsip();
        const hariIni = new Date();
        hariIni.setHours(0, 0, 0, 0);

        const arsipBersih = arsip.filter(item => {
            const tglAcara = parseTanggalIndo(item.tanggalAcara);
            if (tglAcara.getTime() === 0) return true;
            const hPlus3 = new Date(tglAcara);
            hPlus3.setDate(hPlus3.getDate() + 3);
            return hariIni <= hPlus3;
        });

        const dihapus = arsip.length - arsipBersih.length;
        if (dihapus > 0) {
            simpanArsip(arsipBersih);
            console.log(`[Arsip] ${dihapus} entry lama (>H+3) dihapus dari arsip`);
        }
    } catch (e) { console.error("Gagal bersihkan arsip:", e.message); }
}

function arsipkanYangSudahMasuk() {
    try {
        let db = bacaDatabase();
        const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);
        const sudahMasukAkanDatang = [];
        const sudahMasukSudahTerjadi = [];
        const belumMasuk = [];

        for (const item of db) {
            const tanggalAwal = item.tanggalAcara;
            const [hariStr, bulanStr, tahun] = tanggalAwal.split(' ');
            const bulanMap = { "Januari": 1, "Februari": 2, "Maret": 3, "April": 4, "Mei": 5, "Juni": 6, "Juli": 7, "Agustus": 8, "September": 9, "Oktober": 10, "November": 11, "Desember": 12 };
            const bulan = bulanMap[bulanStr] || 1;
            const tanggalObj = new Date(`${tahun}-${bulan}-${hariStr}`);

            if (tanggalObj <= hariIni && item.statusWebsite.includes('SUDAH MASUK')) {
                sudahMasukSudahTerjadi.push(item);
            } else if (item.statusWebsite.includes('SUDAH MASUK')) {
                sudahMasukAkanDatang.push(item);
            } else if (item.statusWebsite.includes('BELUM MASUK')) {
                belumMasuk.push(item);
            }
        }

        if (sudahMasukSudahTerjadi.length === 0) return;

        const arsip = bacaArsip();
        for (const item of sudahMasukSudahTerjadi) {
            if (!arsip.some(e => e.timestamp === item.timestamp)) {
                arsip.push(item);
            }
        }

        const dbBaru = [...sudahMasukAkanDatang, ...belumMasuk];
        simpanArsip(arsip);
        simpanDatabase(dbBaru);

        console.log(`[Arsip] ${sudahMasukSudahTerjadi.length} entry dipindah ke archive.json`);
        bersihkanArsipLama();
    } catch (e) { console.error("Gagal arsipkan data:", e.message); }
}

function ambilTanggalTerakhir() {
    try {
        if (!fs.existsSync(LOG_FILE)) { return ''; }
        const data = fs.readFileSync(LOG_FILE, 'utf8').trim();
        if (!data) return '';
        return JSON.parse(data).lastReminderDate || '';
    } catch (e) { return ''; }
}
function simpanTanggalTerakhir(tanggalTeks) {
    try { fs.writeFileSync(LOG_FILE, JSON.stringify({ lastReminderDate: tanggalTeks }), 'utf8'); } catch (e) {}
}

// CLEAN CRAWLER
function ekstrakKontenBersihPSI($) {
    // Website baru (pondoksehatindonesia.org): tanpa tag <main>, footer berisi counter visitor dinamis
    $('header, footer, nav, script, style, #header, .header, #footer, .footer, .menu, .bg-blob').remove();
    let areaUtama = $('main, article, #content, .content, #main').first();
    let teksHasil = areaUtama.length ? areaUtama.text() : $('body').text();
    return teksHasil.trim().replace(/\s+/g, ' ');
}

function ekstrakKontenBersihArteria($) {
    $('header, footer, nav, script, style, #header, .header, #footer, .footer, .menu, .elementor-location-header').remove();
    let areaUtama = $('main, article, .elementor-page, #content, .content, .main').first();
    let teksHasil = areaUtama.length ? areaUtama.text() : $('body').text();
    return teksHasil.trim().replace(/\s+/g, ' ');
}

// AUTO-REFRESH DATABASE
function ekstrakKataKunci(namaFile) {
    // "registrasi-Arteria-Manajemen Code Stroke.pdf" → ["manajemen", "code", "stroke"]
    // "rv-registrasi-Arteria-Venous Ulcer.pdf" → ["venous", "ulcer"] (prefix rv dibuang)
    const parts = namaFile.replace(/\.pdf$/i, '').replace(/^rv[\s-]*/i, '').split(/[\s-]+/);
    return parts.slice(2).map(s => s.toLowerCase().replace(/[^a-zA-Z0-9]/g, '')).filter(s => s.length > 2);
}

function cocokkanKonten(teksWeb, kataKunci) {
    if (kataKunci.length === 0) return false;
    const matched = kataKunci.filter(k => teksWeb.includes(k));
    const threshold = Math.max(2, Math.ceil(kataKunci.length * 0.5));
    return matched.length >= threshold;
}

function segarkanStatusDatabasePSI(kontenWeb) {
    console.log(`[Database Sync] Menyegarkan status data berkas PSI...`);
    try {
        let db = bacaDatabase();
        let adaPerubahanDb = false;
        const bersihWeb = kontenWeb.toLowerCase().replace(/\s+/g, ' ');

        db = db.map(item => {
            if (item.entitas === 'PSI' && item.statusWebsite.includes('BELUM MASUK')) {
                const bersihTgl = item.tanggalAcara.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').trim();
                const kataKunci = ekstrakKataKunci(item.namaFile);

                if (bersihWeb.includes(bersihTgl) && cocokkanKonten(bersihWeb, kataKunci)) {
                    console.log(`Berkas [PSI] "${item.namaFile}" SUDAH MASUK ke website!`);
                    item.statusWebsite = "SUDAH MASUK";
                    adaPerubahanDb = true;
                }
            }
            return item;
        });
        if (adaPerubahanDb) { simpanDatabase(db); arsipkanYangSudahMasuk(); }
    } catch (err) { console.error(`Gagal sinkronisasi database PSI:`, err.message); }
}

function segarkanStatusDatabaseArteria(kontenWeb) {
    console.log(`[Database Sync] Menyegarkan status data berkas Arteria...`);
    try {
        let db = bacaDatabase();
        let adaPerubahanDb = false;
        const bersihWeb = kontenWeb.toLowerCase().replace(/\s+/g, ' ');

        db = db.map(item => {
            if (item.entitas === 'Arteria' && item.statusWebsite.includes('BELUM MASUK')) {
                const bersihTgl = item.tanggalAcara.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').trim();
                const kataKunci = ekstrakKataKunci(item.namaFile);

                if (bersihWeb.includes(bersihTgl) && cocokkanKonten(bersihWeb, kataKunci)) {
                    console.log(`Berkas [Arteria] "${item.namaFile}" SUDAH MASUK ke website!`);
                    item.statusWebsite = "SUDAH MASUK";
                    adaPerubahanDb = true;
                }
            }
            return item;
        });
        if (adaPerubahanDb) { simpanDatabase(db); arsipkanYangSudahMasuk(); }
    } catch (err) { console.error(`Gagal sinkronisasi database Arteria:`, err.message); }
}

const daftarBulan = {
    januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
    juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11
};

function parseTanggalIndo(teksTanggal) {
    if (!teksTanggal) return new Date(0);
    const bagian = teksTanggal.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/);
    if (bagian.length < 2) return new Date(0);
    const hari = parseInt(bagian[0]);
    const bulan = daftarBulan[bagian[1]];
    const tahun = parseInt(bagian[2]) || new Date().getFullYear();
    if (bulan === undefined || isNaN(hari)) return new Date(0);
    return new Date(tahun, bulan, hari);
}

function waktuWIB() {
    return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: 'numeric', minute: 'numeric', hour12: false });
}

function jamWIB() {
    return parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
}

function tanggalWIB() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // returns YYYY-MM-DD
}
function dapatkanTeksTambahanBelumMasuk(entitas) {
    try {
        const db = bacaDatabase();
        const hariIni = new Date();
        hariIni.setHours(0, 0, 0, 0);

        let daftarBelumMasuk = [];
        let daftarAkanDatang = [];

        for (const item of db) {
            if (item.entitas !== entitas) continue;

            const tanggalAcara = parseTanggalIndo(item.tanggalAcara);
            if (tanggalAcara < hariIni) {
                if (item.statusWebsite.includes('BELUM MASUK')) {
                    daftarBelumMasuk.push(item);
                }
            } else {
                if (item.statusWebsite.includes('BELUM MASUK')) {
                    daftarAkanDatang.push(item);
                }
            }
        }

        if (daftarBelumMasuk.length === 0 && daftarAkanDatang.length === 0) {
            return '\n\n🎉 *Catatan Admin:* Semua dokumen PDF entitas ' + entitas + ' sudah ter-input rapi di website.';
        }

        let teksTambahan = '';

        if (daftarAkanDatang.length > 0) {
            teksTambahan += '\n\n📅 *ACARA AKAN DATANG (belum online):*';
            daftarAkanDatang.forEach((item, index) => {
                const namaDariFile = item.namaFile.replace(/\.pdf$/i, '').split(/[\s-]+/).slice(2).join(' ');
                const namaTampil = item.namaAcara.length > namaDariFile.length ? item.namaAcara : namaDariFile;
                teksTambahan += '\n' + (index + 1) + '. 📌 *' + namaTampil + '*\n   📅 Tanggal: ' + item.tanggalAcara + ' | 📄 File: _' + item.namaFile + '_\n   -------------------------';
            });
        }

        if (daftarBelumMasuk.length > 0) {
            teksTambahan += '\n\n⚠️ *REMINDER BELUM DIMASUKKAN KE WEB ' + entitas.toUpperCase() + ':*';
            daftarBelumMasuk.forEach((item, index) => {
                const namaDariFile = item.namaFile.replace(/\.pdf$/i, '').split(/[\s-]+/).slice(2).join(' ');
                const namaTampil = item.namaAcara.length > namaDariFile.length ? item.namaAcara : namaDariFile;
                teksTambahan += '\n' + (index + 1) + '. 📌 *' + namaTampil + '*\n   📅 Tanggal: ' + item.tanggalAcara + ' | 📄 File: _' + item.namaFile + '_\n   -------------------------';
            });
        }

        return teksTambahan;
    } catch (err) { console.error('Gagal dapatkan teks tambahan:', err.message); return ''; }
}

/* [DINONAKTIFKAN - MENUNGGU TINJAUAN ULANG FITUR MATERI]
// FUZZY MATCH MATERI: Cocokkan filename PDF ke nama acara di database
function fuzzyMatchMateri(namaFile, entitas) {
    // Bersihkan filename: hapus ekstensi, tanggal, angka, underscore
    const namaBersih = namaFile
        .replace(/\.pdf$/i, '')
        .replace(/_/g, ' ')
        .replace(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/g, '')
        .replace(/\d{4}/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    // Split jadi keywords (min 3 karakter)
    const keywords = namaBersih.split(/\s+/).filter(k => k.length > 2);
    if (keywords.length === 0) return null;

    // Ambil semua event dari database + arsip
    let semuaEvent = [];
    try {
        const db = bacaDatabase();
        semuaEvent.push(...db.filter(e => e.entitas === entitas));
    } catch (_) {}
    try {
        const arsip = bacaArsip();
        semuaEvent.push(...arsip.filter(e => e.entitas === entitas));
    } catch (_) {}

    if (semuaEvent.length === 0) return null;

    // Cari match terbaik
    let bestEvent = null;
    let bestSkor = 0;

    for (const event of semuaEvent) {
        const namaAcaraLower = event.namaAcara.toLowerCase();
        let matchCount = 0;

        for (const kw of keywords) {
            if (namaAcaraLower.includes(kw)) {
                matchCount++;
            }
        }

        const skor = matchCount / keywords.length;
        if (skor > bestSkor) {
            bestSkor = skor;
            bestEvent = event;
        }
    }

    if (bestSkor >= 0.5) {
        return { event: bestEvent, skor: bestSkor };
    }
    return null;
}

// Tandai materi sudah upload
function tandaiMateriUpload(namaAcara, tanggalAcara, entitas, namaFile) {
    const materi = bacaMateri();
    const tanggalFormat = tanggalAcara; // sudah format "18 Juli 2026"

    // Cari atau buat event group
    let eventGroup = materi.events.find(e =>
        e.entity === entitas && e.date === tanggalFormat
    );

    if (!eventGroup) {
        eventGroup = { entity: entitas, date: tanggalFormat, items: [] };
        materi.events.push(eventGroup);
    }

    // Cari item berdasarkan nama acara (fuzzy)
    let item = eventGroup.items.find(i =>
        i.name.toLowerCase() === namaAcara.toLowerCase()
    );

    if (!item) {
        // Buat item baru
        item = {
            name: namaAcara,
            uploaded: true,
            matchedFile: namaFile,
            uploadedAt: new Date().toISOString()
        };
        eventGroup.items.push(item);
    } else {
        // Update item existing
        item.uploaded = true;
        item.matchedFile = namaFile;
        item.uploadedAt = new Date().toISOString();
    }

    simpanMateri(materi);
}

// Ambil status materi untuk reminder
function dapatkanStatusMateri(entitas) {
    const materi = bacaMateri();
    const eventGroups = materi.events.filter(e => e.entity === entitas);

    if (eventGroups.length === 0) return '';

    let sudahUpload = 0;
    let belumUpload = 0;
    let belumList = [];

    for (const group of eventGroups) {
        for (const item of group.items) {
            if (item.uploaded) {
                sudahUpload++;
            } else {
                belumUpload++;
                belumList.push({ ...item, date: group.date });
            }
        }
    }

    if (sudahUpload === 0 && belumUpload === 0) return '';

    let teks = '\n\n📎 *STATUS MATERI PEMBICARA:*\n';
    teks += `✅ Sudah Upload: ${sudahUpload} materi\n`;

    if (belumUpload > 0) {
        teks += `❌ Belum Upload: ${belumUpload} materi\n`;
        // Sort by date (nearest first)
        belumList.sort((a, b) => parseTanggalIndo(a.date) - parseTanggalIndo(b.date));
        belumList.forEach((item, idx) => {
            teks += `   ${idx + 1}. ${item.name} (${item.date})\n`;
        });
    }

    return teks;
}

// Format status materi untuk command !statusmateri
function formatStatusMateri(entitas) {
    const materi = bacaMateri();
    const eventGroups = materi.events.filter(e => e.entity === entitas);

    if (eventGroups.length === 0) {
        return `📋 *STATUS MATERI ${entitas.toUpperCase()}:*\n\nBelum ada jadwal materi yang tercatat.`;
    }

    let sudahUpload = [];
    let belumUpload = [];

    for (const group of eventGroups) {
        for (const item of group.items) {
            if (item.uploaded) {
                sudahUpload.push({ ...item, date: group.date });
            } else {
                belumUpload.push({ ...item, date: group.date });
            }
        }
    }

    // Sort by date
    sudahUpload.sort((a, b) => parseTanggalIndo(a.date) - parseTanggalIndo(b.date));
    belumUpload.sort((a, b) => parseTanggalIndo(a.date) - parseTanggalIndo(b.date));

    let teks = `📅 *STATUS MATERI ${entitas.toUpperCase()}*\n`;

    if (sudahUpload.length > 0) {
        teks += `\n✅ *Sudah Upload (${sudahUpload.length}):*`;
        sudahUpload.forEach((item, idx) => {
            teks += `\n${idx + 1}. ${item.name}`;
            teks += `\n   📅 ${item.date} | 📎 ${item.matchedFile}`;
        });
    }

    if (belumUpload.length > 0) {
        teks += `\n\n❌ *Belum Upload (${belumUpload.length}):*`;
        belumUpload.forEach((item, idx) => {
            teks += `\n${idx + 1}. ${item.name}`;
            teks += `\n   📅 ${item.date}`;
        });
    }

    if (sudahUpload.length === 0 && belumUpload.length === 0) {
        teks += '\n\nBelum ada data materi.';
    }

    return teks;
}

// BATCH: Tambah file ke buffer, reset timer
function tambahKeBufferMateri(chatId, entitas, namaFile) {
    if (!bufferMateri[entitas]) bufferMateri[entitas] = [];
    bufferMateri[entitas].push({ namaFile, chatId });

    // Clear timer lama, set baru
    if (timerMateri[entitas]) clearTimeout(timerMateri[entitas]);
    timerMateri[entitas] = setTimeout(() => prosesBufferMateri(entitas), DELAY_MATERI_MS);
    console.log(`[Materi Buffer] +1 file ke ${entitas} (${bufferMateri[entitas].length} file menunggu)`);
}

// BATCH: Proses semua file di buffer, kirim 1 respon gabungan
async function prosesBufferMateri(entitas) {
    const files = bufferMateri[entitas] || [];
    bufferMateri[entitas] = [];
    timerMateri[entitas] = null;

    if (files.length === 0) return;

    const chatId = files[0].chatId;
    let hasil = [];
    let gagal = [];

    for (const f of files) {
        const match = fuzzyMatchMateri(f.namaFile, entitas);
        if (match && match.skor >= 0.5) {
            tandaiMateriUpload(match.event.namaAcara, match.event.tanggalAcara, entitas, f.namaFile);
            hasil.push({ namaFile: f.namaFile, namaAcara: match.event.namaAcara, skor: match.skor });
            console.log(`[${entitas}] Materi ter-upload: ${f.namaFile} → ${match.event.namaAcara} (skor: ${match.skor.toFixed(2)})`);
        } else {
            gagal.push(f.namaFile);
            console.error(`[${entitas}] Tidak ada match materi: ${f.namaFile}`);
        }
    }

    // Kirim 1 respon gabungan
    if (hasil.length > 0) {
        let teks = `📎 *MATERI PEMBICARA TERSERAH (${hasil.length} file):*\n`;
        hasil.forEach((h, i) => {
            teks += `\n${i + 1}. ✅ *${h.namaAcara}* Tersedia`;
        });
        if (gagal.length > 0) {
            teks += `\n\n⚠️ ${gagal.length} file tidak terdeteksi sebagai materi acara (log di terminal).`;
        }
        await sock.sendMessage(chatId, { text: teks });
    }
}
*/

function dapatkanRangkumanJadwal(htmlData, entitas) {
    const $ = cheerio.load(htmlData);
    $('header, footer, nav, #header, #footer').remove();
    const seluruhTeks = $('body').text();
    const polaTanggal = /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/gi;
    const temukanTanggal = seluruhTeks.match(polaTanggal);

    if (!temukanTanggal) return '\nTIDAK ADA JADWAL WEBINAR MENDATANG.';

    const tanggalHariIni = new Date();
    tanggalHariIni.setHours(0, 0, 0, 0);

    const bulanMapInggris = {
        'january': 0, 'february': 1, 'march': 2, 'april': 3,
        'may': 4, 'june': 5, 'july': 6, 'august': 7,
        'september': 8, 'october': 9, 'november': 10, 'december': 11
    };

    const kumpulanTanggal = temukanTanggal;
    let daftarWebinarValid = [];
    const tanggalSudahDilihat = new Set();

    for (const teksTgl of kumpulanTanggal) {
        const bagian = teksTgl.split(/\s+/);
        if (!bagian[1] || !bagian[2]) continue;
        const namaBulanLower = bagian[1].toLowerCase();

        let tglObj;
        if (daftarBulan[namaBulanLower] !== undefined) {
            tglObj = new Date(parseInt(bagian[2]), daftarBulan[namaBulanLower], parseInt(bagian[0]));
        } else if (bulanMapInggris[namaBulanLower] !== undefined) {
            tglObj = new Date(parseInt(bagian[2]), bulanMapInggris[namaBulanLower], parseInt(bagian[0]));
        } else {
            continue;
        }

        const sisaHari = Math.ceil((tglObj.getTime() - tanggalHariIni.getTime()) / (1000 * 60 * 60 * 24));

        if (sisaHari >= 1) {
            const kunciTgl = tglObj.getTime();
            if (tanggalSudahDilihat.has(kunciTgl)) continue;
            tanggalSudahDilihat.add(kunciTgl);
            daftarWebinarValid.push({ teks: teksTgl, sisa: sisaHari, obj: tglObj });
        }
    }

    daftarWebinarValid.sort((a, b) => a.obj - b.obj);
    if (daftarWebinarValid.length === 0) return '\nTIDAK ADA JADWAL WEBINAR MENDATANG.';

    // Cross-reference dengan database: cari nama webinar per tanggal
    let dbEntries = [];
    try { dbEntries = bacaDatabase(); } catch (_) {}
    const dbEntitas = entitas ? dbEntries.filter(e => e.entitas === entitas) : [];

    let teksRangkuman = '\n📋 *Daftar Webinar Mendatang:*';
    daftarWebinarValid.forEach(w => {
        // Cari nama-nama webinar dari database yang tanggalnya cocok
        const namaBulanTgl = w.obj.toLocaleDateString('id-ID', { month: 'long', day: 'numeric', year: 'numeric' });
        const matchingEntries = dbEntitas.filter(e => {
            const tglEntry = e.tanggalAcara.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').trim();
            const tglWeb = w.teks.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').trim();
            return tglEntry.includes(tglWeb) || tglWeb.includes(tglEntry);
        });

        if (matchingEntries.length > 0) {
            teksRangkuman += `\n\n📅 *${w.teks}* (dalam *${w.sisa} Hari*)`;
            matchingEntries.forEach(e => {
                teksRangkuman += `\n   📌 ${e.namaAcara}`;
            });
        } else {
            teksRangkuman += `\n\n📅 *${w.teks}* (dalam *${w.sisa} Hari*)`;
        }
    });
    return teksRangkuman;
}

async function kirimPesanAman(grupTarget, pesanUtama, konteksPesan, tagSemua = false) {
    try {
        if (tagSemua) {
            const meta = await sock.groupMetadata(grupTarget);
            const semuaParticipant = meta.participants.map(p => p.id);
            const tagTeks = semuaParticipant.map(jid => `@${jid.split('@')[0]}`).join(' ');
            const pesanDenganTag = `${pesanUtama}\n\n${tagTeks}`;
            await sock.sendMessage(grupTarget, { text: pesanDenganTag, mentions: semuaParticipant });
        } else {
            await sock.sendMessage(grupTarget, { text: pesanUtama });
        }
        console.log(`Laporan [${konteksPesan}] sukses dikirim.`);
    } catch (errGrup) {
        console.error(`Gagal mengirim ke Grup [${konteksPesan}]:`, errGrup.message);
    }
}

// Helper: extract text body from Baileys message
function ambilTeksPesan(msg) {
    return msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.buttonsResponseMessage?.selectedButtonId
        || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId
        || '';
}

// Helper: check if message has document
function apakahAdaDokumen(msg) {
    return !!(msg.message?.documentMessage);
}

// Helper: get document info from message
function ambilInfoDokumen(msg) {
    const doc = msg.message?.documentMessage;
    if (!doc) return null;
    return {
        fileName: doc.fileName || 'Dokumen.pdf',
        mimetype: doc.mimetype || '',
        fileLength: doc.fileLength || 0,
    };
}

// Helper: Ambil nama acara dari nama file PDF
// Contoh: "registrasi-Arteria-Manajemen Tatalaksana Kegawatdaruratan Pasien Diare.pdf"
//   → "Manajemen Tatalaksana Kegawatdaruratan Pasien Diare"
function ambilNamaAcaraDariFile(namaFile) {
    let nama = namaFile
        .replace(/\.pdf$/i, '')           // buang ekstensi .pdf
        .replace(/^rv[\s-]*/i, '')         // buang prefix "rv-" (mis. rv-registrasi-...)
        .replace(/registrasi/gi, '')       // buang kata "registrasi"
        .replace(/psi/gi, '')             // buang "PSI"
        .replace(/arteria/gi, '')         // buang "Arteria"
        .replace(/[-_]/g, ' ')            // ganti - dan _ dengan spasi
        .replace(/\s+/g, ' ')             // rapikan spasi ganda
        .trim();

    // Kapitalisasi setiap awal kata
    nama = nama.split(' ').map(kata =>
        kata.charAt(0).toUpperCase() + kata.slice(1).toLowerCase()
    ).join(' ');

    return nama.length > 2 ? nama : '';
}

// =========================================================================
// ENGINE CRAWLER WEB AUTOMATION
// =========================================================================
async function mulaiPemantauan() {
    console.log('Memulai pengecekan awal website PSI & Arteria...');

    let htmlPsi = "";
    try {
        const resPsi = await axios.get(URL_PSI, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        htmlPsi = resPsi.data;
        const $psi = cheerio.load(htmlPsi);
        let currentContentPsi = ekstrakKontenBersihPSI($psi);

        if (currentContentPsi.length > 100) {
            segarkanStatusDatabasePSI(currentContentPsi);
            let lastContentPsi = fs.existsSync(CACHE_PSI) ? fs.readFileSync(CACHE_PSI, 'utf8') : '';
            if (lastContentPsi && currentContentPsi !== lastContentPsi) {
                const jadwal = dapatkanRangkumanJadwal(htmlPsi, 'PSI');
                const belum = dapatkanTeksTambahanBelumMasuk('PSI');
                await kirimPesanAman(GRUP_PSI, `*🔔 NOTIFIKASI UPDATE WEBSITE PSI (TERLEWAT)*\n\nSistem mendeteksi adanya update terbaru di website PSI saat bot offline.\n\nSilakan cek: ${URL_PSI}${jadwal}${belum}`, 'Update Terlewat PSI', false);
            }
            fs.writeFileSync(CACHE_PSI, currentContentPsi, 'utf8');
        }
    } catch (e) { console.error('Gagal crawling awal PSI:', e.message); }

    let htmlArteria = "";
    try {
        const resArt = await axios.get(URL_ARTERIA, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        htmlArteria = resArt.data;
        const $art = cheerio.load(htmlArteria);
        let currentContentArt = ekstrakKontenBersihArteria($art);

        if (currentContentArt.length > 100) {
            segarkanStatusDatabaseArteria(currentContentArt);
            let lastContentArt = fs.existsSync(CACHE_ARTERIA) ? fs.readFileSync(CACHE_ARTERIA, 'utf8') : '';
            if (lastContentArt && currentContentArt !== lastContentArt) {
                const jadwal = dapatkanRangkumanJadwal(htmlArteria, 'Arteria');
                const belum = dapatkanTeksTambahanBelumMasuk('Arteria');
                await kirimPesanAman(GRUP_ARTERIA, `*🔔 NOTIFIKASI UPDATE WEBSITE ARTERIA (TERLEWAT)*\n\nSistem mendeteksi adanya update terbaru di website Arteria saat bot offline.\n\nSilakan cek: ${URL_ARTERIA}${jadwal}${belum}`, 'Update Terlewat Arteria', false);
            }
            fs.writeFileSync(CACHE_ARTERIA, currentContentArt, 'utf8');
        }
    } catch (e) { console.error('Gagal crawling awal Arteria:', e.message); }

    const tanggalHariIniTeks = tanggalWIB();
    const tanggalTerakhirKirim = ambilTanggalTerakhir();
    const jamSekarang = jamWIB();

    if (tanggalTerakhirKirim !== tanggalHariIniTeks && jamSekarang >= 7 && jamSekarang <= 22) {
        if (htmlPsi) {
            const j = dapatkanRangkumanJadwal(htmlPsi, 'PSI');
            const b = dapatkanTeksTambahanBelumMasuk('PSI');
                await kirimPesanAman(GRUP_PSI, `*🤖 BOT PSI OPERASIONAL*\n\nSistem pemantauan berkala website PSI telah aktif.\n${j}${b}`, 'Startup PSI', true);
        }
        if (htmlArteria) {
            const j = dapatkanRangkumanJadwal(htmlArteria, 'Arteria');
            const b = dapatkanTeksTambahanBelumMasuk('Arteria');
                await kirimPesanAman(GRUP_ARTERIA, `*🤖 BOT ARTERIA OPERASIONAL*\n\nSistem pemantauan berkala website Arteria MedPro telah aktif.\n${j}${b}`, 'Startup Arteria', true);
        }
        simpanTanggalTerakhir(tanggalHariIniTeks);
    }

    intervalPemantauan = setInterval(async () => {
        const jam = jamWIB();
        const tglTeks = tanggalWIB();
        const tglLast = ambilTanggalTerakhir();

        console.log(`[${waktuWIB()} WIB] Menjalankan siklus pemantauan berkala...`);

        try {
            const rPsi = await axios.get(URL_PSI, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $psi = cheerio.load(rPsi.data);
            let curPsi = ekstrakKontenBersihPSI($psi);
            let oldPsi = fs.existsSync(CACHE_PSI) ? fs.readFileSync(CACHE_PSI, 'utf8') : '';

            if (curPsi.length > 100 && curPsi !== oldPsi) {
                segarkanStatusDatabasePSI(curPsi);
                const j = dapatkanRangkumanJadwal(rPsi.data, 'PSI');
                const b = dapatkanTeksTambahanBelumMasuk('PSI');
                await kirimPesanAman(GRUP_PSI, `*🔔 NOTIFIKASI UPDATE WEBSITE PSI*\n\nAda perubahan materi terbaru di website PSI.\n\nSilakan cek langsung: ${URL_PSI}${j}${b}`, 'Live Update PSI', false);
                fs.writeFileSync(CACHE_PSI, curPsi, 'utf8');
            }
        } catch (err) { console.error('Kendala siklus berkala PSI:', err.message); }

        try {
            const rArt = await axios.get(URL_ARTERIA, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $art = cheerio.load(rArt.data);
            let curArt = ekstrakKontenBersihArteria($art);
            let oldArt = fs.existsSync(CACHE_ARTERIA) ? fs.readFileSync(CACHE_ARTERIA, 'utf8') : '';

            if (curArt.length > 100 && curArt !== oldArt) {
                segarkanStatusDatabaseArteria(curArt);
                const j = dapatkanRangkumanJadwal(rArt.data, 'Arteria');
                const b = dapatkanTeksTambahanBelumMasuk('Arteria');
                await kirimPesanAman(GRUP_ARTERIA, `*🔔 NOTIFIKASI UPDATE WEBSITE ARTERIA*\n\nAda perubahan materi terbaru di website Arteria MedPro.\n\nSilakan cek langsung: ${URL_ARTERIA}${j}${b}`, 'Live Update Arteria', false);
                fs.writeFileSync(CACHE_ARTERIA, curArt, 'utf8');
            }
        } catch (err) { console.error('Kendala siklus berkala Arteria:', err.message); }

        if (jam === JAM_KIRIM_HARIAN && tglLast !== tglTeks) {
            try {
                const rP = await axios.get(URL_PSI, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const jP = dapatkanRangkumanJadwal(rP.data, 'PSI');
                const bP = dapatkanTeksTambahanBelumMasuk('PSI');
                const rekapP = await ambilRekapGoogleSheets('PSI');
                await kirimPesanAman(GRUP_PSI, `*📅 LAPORAN HARIAN WEBINAR PSI*\n\nHalo Admin, berikut status aktivitas terkini dari website PSI:\n${rekapP}${jP}${bP}`, 'Harian PSI', true);
            } catch (e) {}

            try {
                const rA = await axios.get(URL_ARTERIA, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const jA = dapatkanRangkumanJadwal(rA.data, 'Arteria');
                const bA = dapatkanTeksTambahanBelumMasuk('Arteria');
                const rekapA = await ambilRekapGoogleSheets('Arteria');
                await kirimPesanAman(GRUP_ARTERIA, `*📅 LAPORAN HARIAN WEBINAR ARTERIA*\n\nHalo Admin, berikut status aktivitas terkini dari website Arteria:\n${rekapA}${jA}${bA}`, 'Harian Arteria', true);
            } catch (e) {}

            simpanTanggalTerakhir(tglTeks);
        }
    }, INTERVAL_CEK);
}

// =========================================================================
// INTERAKSI CHAT - BAILEYS
// =========================================================================

// Penentuan entitas: prioritas nama file (psi/arteria) → isi PDF (kuota) → grup
function tentukanEntitasDariNamaFile(namaFile) {
    // cocokkan token persis ("psi"/"arteria") agar "Psikologi" tidak dianggap PSI
    const token = namaFile.toLowerCase().replace(/\.pdf$/i, '').split(/[\s-]+/);
    if (token.includes('arteria')) return 'Arteria';
    if (token.includes('psi')) return 'PSI';
    return null;
}

// Kuota disepakati: Arteria internasional = 3000, PSI = 2500
function tentukanEntitasDariIsi(teks) {
    if (!teks) return null;
    const t = teks.toLowerCase();
    if (t.includes('3000')) return 'Arteria';
    if (t.includes('2500')) return 'PSI';
    return null;
}

async function prosesDokumenPDF(msg) {
    const chatId = msg.key.remoteJid;
    const infoDokumen = ambilInfoDokumen(msg);
    if (!infoDokumen) return;

    const namaFile = infoDokumen.fileName;

    // LANGKAH 0: Hanya proses dari dua grup admin
    if (chatId !== GRUP_PSI && chatId !== GRUP_ARTERIA) return;

    // Penentuan entitas sementara dari nama file
    let entitasPesan = tentukanEntitasDariNamaFile(namaFile);
    console.log(`Berkas masuk (${entitasPesan || 'entitas belum diketahui'}): ${namaFile}`);

    // LANGKAH 1: Download media dengan Baileys (built-in, anti-rusak)
    let pdfBuffer;
    try {
        const stream = await downloadMediaMessage(msg, 'buffer', { });
        pdfBuffer = Buffer.from(stream);
        console.log(`[${entitasPesan}] Media berhasil diunduh, size: ${pdfBuffer.length} bytes`);
    } catch (errDl) {
        const errMsg = (errDl instanceof Error) ? errDl.message : String(errDl);
        console.error(`[${entitasPesan}] Gagal mengunduh media:`, errMsg);
        await sock.sendMessage(chatId, { text: '⚠️ *Gagal mengunduh berkas.* Silakan kirim ulang PDF-nya.' });
        return;
    }

    // Validasi PDF
    if (!pdfBuffer || pdfBuffer.length < 100 || pdfBuffer.toString('ascii', 0, 5) !== '%PDF-') {
        console.error(`[${entitasPesan}] ✖ VALIDASI GAGAL: Bukan PDF valid. Header: "${pdfBuffer ? pdfBuffer.toString('ascii', 0, 10) : 'null'}" | Size: ${pdfBuffer ? pdfBuffer.length : 0} | File: ${namaFile}`);
        return;
    }

    // LANGKAH 2: Parse PDF
    let teksMentah;
    try {
        const dataPdf = await pdfParser(pdfBuffer);
        teksMentah = dataPdf.text;
    } catch (e) {
        console.error(`[${entitasPesan}] ✖ VALIDASI GAGAL: Gagal parse PDF. Error: ${e.message || e} | File: ${namaFile}`);
        return;
    }

    // LANGKAH 3: Finalisasi entitas bila nama file tidak mengandung penanda
    if (!entitasPesan) {
        entitasPesan = tentukanEntitasDariIsi(teksMentah);
        if (!entitasPesan) {
            if (chatId === GRUP_PSI) entitasPesan = 'PSI';
            else if (chatId === GRUP_ARTERIA) entitasPesan = 'Arteria';
        }
        if (entitasPesan) {
            console.log(`Berkas "${namaFile}" diklasifikasikan sebagai entitas: ${entitasPesan}`);
        }
    }
    if (!entitasPesan) return;

    // LANGKAH 4: Validasi isi dokumen
    const teksValidasi = teksMentah.toLowerCase();
    const apakahKemenkesAsli = teksValidasi.includes('kementerian kesehatan') && teksValidasi.includes('registrasi') && teksValidasi.includes('kompetensi');

    /* [DINONAKTIFKAN - FITUR MATERI]
    // Jika BUKAN dokumen Kemenkes, masukkan ke buffer materi (batch processing)
    if (!apakahKemenkesAsli) {
        tambahKeBufferMateri(chatId, entitasPesan, namaFile);
        return;
    }
    */

    if (!apakahKemenkesAsli) return;

    if (entitasPesan === 'PSI' && !teksValidasi.includes('internasional')) {
        console.error(`[${entitasPesan}] ✖ VALIDASI GAGAL: Dokumen tidak memuat cakupan Internasional. File: ${namaFile}`);
        return;
    }
    if (entitasPesan === 'Arteria' && !teksValidasi.includes('nasional') && !teksValidasi.includes('internasional')) {
        console.error(`[${entitasPesan}] ✖ VALIDASI GAGAL: Dokumen tidak memuat cakupan Nasional/Internasional. File: ${namaFile}`);
        return;
    }

    // LANGKAH 5: Ekstraksi nama acara dari nama file
    let namaAcara = 'Tidak diketahui';
    let tanggalAcara = 'Tidak diketahui';

    // Prioritas 1: Ambil dari nama file PDF
    const namaDariFile = ambilNamaAcaraDariFile(namaFile);
    if (namaDariFile) {
        namaAcara = namaDariFile;
        console.log(`[${entitasPesan}] Nama acara (file): ${namaAcara}`);
    }

    // Prioritas 2: Regex dari teks PDF jika nama file kurang jelas
    if (namaAcara === 'Tidak diketahui') {
        const polaNama = /Nama\s*:\s*(.+)/i;
        const cocokNama = teksMentah.match(polaNama);
        if (cocokNama && cocokNama[1] && cocokNama[1].trim().length > 2) {
            const namaBersih = cocokNama[1].trim().replace(/\s+/g, ' ').replace(/\r/g, '').replace(/:\s*$/, '').trim();
            namaAcara = namaBersih.toLowerCase().startsWith('webinar') ? namaBersih : 'Webinar ' + namaBersih;
            console.log(`[${entitasPesan}] Nama acara (regex): ${namaAcara}`);
        } else {
            console.log(`[${entitasPesan}] Regex Nama gagal, coba AI fallback...`);
        }
    }

    // Tanggal: "Waktu Pelaksanaan:text" atau "Tanggal:text"
    const polaTanggal = /(?:Waktu Pelaksanaan|Tanggal)\s*:\s*(.+)/i;
    const cocokTanggal = teksMentah.match(polaTanggal);
    if (cocokTanggal && cocokTanggal[1] && cocokTanggal[1].trim().length > 2) {
        tanggalAcara = cocokTanggal[1].trim()
            .replace(/\s*[sS]\/[dD]\s*.*/i, '')
            .replace(/\s+/g, ' ')
            .replace(/\r/g, '')
            .trim();
        console.log(`[${entitasPesan}] Tanggal acara (regex): ${tanggalAcara}`);
    } else {
        console.log(`[${entitasPesan}] Regex Tanggal gagal, coba AI fallback...`);
    }

    // LANGKAH 6: Ekstraksi AI via Ollama (tanggal & topik saja)
    const teksUntukAI = teksMentah.substring(0, 8000);
    let hasilAI;
    try {
        const response = await axios({
            method: 'post',
            url: 'http://127.0.0.1:11434/api/generate',
            timeout: 0,
            data: {
                model: NAMA_MODEL_AI,
                prompt: `Ekstrak dari dokumen Kemenkes ini.

ATURAN:
1. Tanpa markdown (###, **, ===).
2. Tanpa kalimat pembuka/penutup.
3. Tanggal Acara: dari "Waktu Pelaksanaan:", ambil tanggal MULAI saja (buang "s/d ...").
4. Topik: 1 kalimat singkat tentang topik utama acara.

Format Output (2 baris):
Tanggal Acara: [contoh: 2 Agustus 2026]
Topik: [topik singkat]

Teks Dokumen:
"${teksUntukAI}"`,
                stream: false
            }
        });
        // Bersihkan markdown dari output AI
        hasilAI = response.data.response.trim()
            .replace(/\*+/g, '')
            .replace(/=+/g, '')
            .replace(/#{1,6}\s/g, '')
            .trim();
    } catch (e) {
        console.error(`[${entitasPesan}] Gagal ekstraksi AI/Ollama:`, e.message || e);
        await sock.sendMessage(chatId, { text: '⚠️ *Gagal memproses AI.* Pastikan Ollama berjalan di localhost:11434.' });
        return;
    }

    // Fallback: pakai hasil AI kalau regex gagal
    if (tanggalAcara === 'Tidak diketahui') {
        const barisTanggal = hasilAI.match(/Tanggal Acara:\s*(.*)/);
        if (barisTanggal && barisTanggal[1].trim()) {
            tanggalAcara = barisTanggal[1].trim().replace(/\*+/g, '').trim();
        }
        console.log(`[${entitasPesan}] Tanggal acara (AI fallback): ${tanggalAcara}`);
    }

    // LANGKAH 7: Cek status website & simpan ke database
    const cacheFileTeks = entitasPesan === 'PSI' ? CACHE_PSI : CACHE_ARTERIA;
    let kontenWebLokal = fs.existsSync(cacheFileTeks) ? fs.readFileSync(cacheFileTeks, 'utf8') : '';
    const bersihWeb = kontenWebLokal.toLowerCase().replace(/\s+/g, ' ');

    const bersihTgl = tanggalAcara.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const kataKunciJudul = namaAcara.split(' ').slice(0, 3).join(' ').toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').trim();

    const statusAwal = (bersihWeb.includes(bersihTgl) && bersihWeb.includes(kataKunciJudul)) ? "SUDAH MASUK" : "BELUM MASUK";

    const db = bacaDatabase();

    // Cek duplikat: sudah ada entry dengan namaAcara + tanggalAcara yang sama?
    const sudahAda = db.some(item =>
        item.entitas === entitasPesan &&
        item.namaAcara.toLowerCase() === namaAcara.toLowerCase() &&
        item.tanggalAcara.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').trim() === bersihTgl
    );

    if (sudahAda) {
        console.log(`[${entitasPesan}] Duplikat dilewati: "${namaAcara}" (${tanggalAcara}) sudah ada di database.`);
        await sock.sendMessage(chatId, { text: `ℹ️ *"${namaAcara}" sudah tercatat di database.* Tidak perlu diulang.` });
        return;
    }

    db.push({
        entitas: entitasPesan,
        timestamp: new Date().toISOString(),
        namaFile: namaFile,
        namaAcara: namaAcara,
        tanggalAcara: tanggalAcara,
        statusWebsite: statusAwal
    });
    simpanDatabase(db);

    // Arsipkan entry yang sudah SUDAH MASUK
    arsipkanYangSudahMasuk();

    // LANGKAH 8: Kirim notifikasi hasil
    const topikAI = hasilAI.match(/Topik:\s*(.*)/)?.[1]?.trim().replace(/\*+/g, '').trim() || '';
    const pesanNotifikasi = `🤖 *AI AGENT: BERKAS DITERIMA [${entitasPesan.toUpperCase()}]*\n\n📄 *File:* ${namaFile}\n📋 *Nama Acara:* ${namaAcara}\n📅 *Tanggal Acara:* ${tanggalAcara}\n🌐 *Status Web:* ${statusAwal}${topikAI ? `\n\n💡 *Topik:* ${topikAI}` : ''}\n\n_ID Log: ${msg.key.id.substring(0, 8)}..._`;

    await sock.sendMessage(chatId, { text: pesanNotifikasi }).catch(e => {
        console.error(`[${entitasPesan}] Gagal kirim notifikasi:`, e.message);
    });
}

// =========================================================================
// MAIN: START BAILEYS SOCKET
// =========================================================================
let retryDetik = 5;

// DEDUPE PESAN: set ID pesan yang sudah diproses (Baileys kadang emit pesan yang sama 2x)
const pesanDiproses = new Set();

async function mulaiBot() {
    const { state, saveCreds } = await useMultiFileAuthState(activeSessionDir());

    sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: ['AI Admin Bot', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: false,
        logger: pino({ level: 'warn' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            lastQrData = { qr: null, ts: Date.now() };
            QRCodeLib.toDataURL(qr, { width: 300 }, (err, url) => {
                if (!err) lastQrData.qr = url;
            });
            retryDetik = 5;
            console.log('\n╔══════════════════════════════════════╗');
            console.log('║  SCAN QR CODE UNTUK LOGIN WHATSAPP   ║');
            console.log('╚══════════════════════════════════════╝\n');
            qrcode.generate(qr, { small: false });
            try {
                QRCodeLib.toFile(activeQrFile(), qr, { type: 'png', width: 400 }, () => {});
                console.log(`📁 QR disimpan ke ${activeQrFile()} (untuk dashboard)`);
            } catch (e) {}
            console.log('\nScan QR di atas dengan WhatsApp kamu (60 detik sebelum expired).\n');
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Koneksi terputus. Alasan: ${reason}`);

            if (reason === DisconnectReason.loggedOut) {
                console.log('Logged out! Mengarsipkan sesi lama & menyiapkan QR baru otomatis...');
                try {
                    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const archDir = path.join(config.DATA_DIR, 'sessions', 'admin', 'auth_old_' + stamp);
                    fs.renameSync(activeSessionDir(), archDir);
                    fs.mkdirSync(activeSessionDir(), { recursive: true });
                    console.log('📁 Sesi lama diarsipkan ke ' + archDir);
                } catch (e) {
                    console.log('Arsip sesi gagal:', e.message);
                }
                setTimeout(() => mulaiBot(), 3000);
                return;
            }

            if (reason === 405) {
                console.log(`\n⚠️ WhatsApp menolak koneksi (rate limit). Coba lagi dalam ${retryDetik} detik...`);
                if (intervalPemantauan) { clearInterval(intervalPemantauan); intervalPemantauan = null; }
                pemantauanSudahDimulai = false;
                setTimeout(() => mulaiBot(), retryDetik * 1000);
                retryDetik = Math.min(retryDetik + 5, 300);
                return;
            }

            if (state.creds?.me) {
                retryDetik = 5;
                console.log('Mencoba menghubungkan ulang...');
                if (intervalPemantauan) { clearInterval(intervalPemantauan); intervalPemantauan = null; }
                pemantauanSudahDimulai = false;
                setTimeout(() => mulaiBot(), 5000);
            }
        }

        if (connection === 'open') {
            retryDetik = 5;
            console.log('WhatsApp Multi-Group Bot Ready!');
            if (!pemantauanSudahDimulai) {
                pemantauanSudahDimulai = true;
                mulaiPemantauan();
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (msg.key.fromMe) continue;

            // DEDUPE: cegah pesan yang sama diproses dua kali (Baileys kadang emit dobel)
            const idPesan = msg.key.id;
            if (idPesan) {
                if (pesanDiproses.has(idPesan)) continue;
                pesanDiproses.add(idPesan);
                if (pesanDiproses.size > 800) {
                    const entriLama = pesanDiproses.values().next().value;
                    pesanDiproses.delete(entriLama);
                }
            }

            const chatId = msg.key.remoteJid;
            const teksPesan = ambilTeksPesan(msg);

            // Command: !ping
            if (teksPesan.toLowerCase() === '!ping') {
                const waktuMulai = Date.now();
                await sock.sendMessage(chatId, { text: `🤖 *Bot Admin* aktif dengan Respon: *${Date.now() - waktuMulai}ms*` });
                continue;
            }

            // Command: !belum
            if (teksPesan.toLowerCase() === '!belum') {
                const entitasTarget = chatId === GRUP_PSI ? 'PSI' : (chatId === GRUP_ARTERIA ? 'Arteria' : null);
                if (!entitasTarget) continue;

                try {
                    const db = bacaDatabase();
                    const daftarBelum = db.filter(item => item.entitas === entitasTarget && item.statusWebsite.includes('BELUM MASUK'));
                    daftarBelum.sort((a, b) => parseTanggalIndo(a.tanggalAcara) - parseTanggalIndo(b.tanggalAcara));

                    if (daftarBelum.length === 0) {
                        await sock.sendMessage(chatId, { text: `✅ *LAPORAN TRACKER ${entitasTarget.toUpperCase()}:*\nMantap! Semua berkas PDF entitas ini sudah berstatus masuk di website resmi.` });
                        continue;
                    }

                    let teksLaporan = `📋 *BERKAS BELUM MASUK WEB ${entitasTarget.toUpperCase()} (${daftarBelum.length} File):*\n=========================\n`;
                    daftarBelum.forEach((item, index) => {
                        // Ambil nama lengkap dari file sebagai fallback (filename selalu lengkap)
                        const namaDariFile = item.namaFile.replace(/\.pdf$/i, '').split(/[\s-]+/).slice(2).join(' ');
                        // Pakai namaAcara kalau unik, pakai namaFile kalau terlalu pendek/duplikat
                        const namaTampil = item.namaAcara.length > namaDariFile.length ? item.namaAcara : namaDariFile;
                        teksLaporan += `\n${index + 1}. 📌 *${namaTampil}*\n   📅 Tanggal: ${item.tanggalAcara}\n   -------------------------`;
                    });
                    await sock.sendMessage(chatId, { text: teksLaporan });
                } catch (e) {
                    await sock.sendMessage(chatId, { text: '❌ Gagal memuat database.' });
                }
                continue;
            }

            // Command: !sudah
            if (teksPesan.toLowerCase() === '!sudah') {
                const entitasTarget = chatId === GRUP_PSI ? 'PSI' : (chatId === GRUP_ARTERIA ? 'Arteria' : null);
                if (!entitasTarget) continue;

                const urlWeb = entitasTarget === 'PSI' ? URL_PSI : URL_ARTERIA;

                try {
                    // Gabungkan data dari database.json (SUDAH MASUK) + archive.json (sudah diarsip)
                    let daftarSudah = [];
                    try {
                        const db = bacaDatabase();
                        daftarSudah.push(...db.filter(item => item.entitas === entitasTarget && item.statusWebsite.includes('SUDAH MASUK')));
                    } catch (_) {}
                    try {
                        const arsip = bacaArsip();
                        daftarSudah.push(...arsip.filter(item => item.entitas === entitasTarget));
                    } catch (_) {}

                    // Sort by date (nearest first)
                    daftarSudah.sort((a, b) => parseTanggalIndo(a.tanggalAcara) - parseTanggalIndo(b.tanggalAcara));

                    if (daftarSudah.length === 0) {
                        await sock.sendMessage(chatId, { text: `Belum ada berkas yang terdeteksi masuk ke website ${entitasTarget}.` });
                        continue;
                    }

                    let teksLaporan = `✅ *BERKAS SUDAH MASUK WEB ${entitasTarget.toUpperCase()} (${daftarSudah.length} File):*\n`;
                    daftarSudah.forEach((item, index) => {
                        const namaDariFile = item.namaFile.replace(/\.pdf$/i, '').split(/[\s-]+/).slice(2).join(' ');
                        const namaTampil = item.namaAcara.length > namaDariFile.length ? item.namaAcara : namaDariFile;
                        teksLaporan += `\n${index + 1}. ${namaTampil}\nsudah masuk web\n🔗 ${urlWeb}\n`;
                    });
                    teksLaporan += `\n⚙️ *Catatan Sistem:* Data arsip akan otomatis dihapus H+3 hari setelah tanggal kegiatan.`;
                    await sock.sendMessage(chatId, { text: teksLaporan });
                } catch (e) {
                    await sock.sendMessage(chatId, { text: '❌ Gagal memuat data.' });
                }
                continue;
            }

            // Command: !sudahkan [nama] - tandai event sudah masuk web
            if (teksPesan.toLowerCase().startsWith('!sudahkan ')) {
                const entitasTarget = chatId === GRUP_PSI ? 'PSI' : (chatId === GRUP_ARTERIA ? 'Arteria' : null);
                if (!entitasTarget) continue;

                const query = teksPesan.replace('!sudahkan', '').trim().toLowerCase();
                if (!query) {
                    await sock.sendMessage(chatId, { text: '❌ Format: !sudahkan [nama acara]' });
                    continue;
                }

                try {
                    const db = bacaDatabase();
                    let ditemukan = false;

                    for (const item of db) {
                        if (item.entitas === entitasTarget && item.namaAcara.toLowerCase().includes(query)) {
                            if (item.statusWebsite.includes('BELUM MASUK')) {
                                item.statusWebsite = 'SUDAH MASUK';
                                ditemukan = true;
                                console.log(`[${entitasTarget}] Status diupdate manual: "${item.namaAcara}" → SUDAH MASUK`);
                            } else {
                                await sock.sendMessage(chatId, { text: `ℹ️ "${item.namaAcara}" sudah berstatus SUDAH MASUK.` });
                                ditemukan = true;
                            }
                        }
                    }

                    if (ditemukan) {
                        simpanDatabase(db);
                        arsipkanYangSudahMasuk();
                        await sock.sendMessage(chatId, { text: `✅ Status berhasil diupdate!` });
                    } else {
                        await sock.sendMessage(chatId, { text: `❌ Tidak ditemukan event dengan nama "${query}" di ${entitasTarget}.` });
                    }
                } catch (e) {
                    await sock.sendMessage(chatId, { text: '❌ Gagal update status.' });
                }
                continue;
            }

            // Command: !setspread <ID_Spreadsheet> [Nama Event]
            if (teksPesan.toLowerCase().startsWith('!setspread')) {
                const entitasTarget = chatId === GRUP_PSI ? 'PSI' : (chatId === GRUP_ARTERIA ? 'Arteria' : null);
                if (!entitasTarget) continue;

                const input = teksPesan.replace(/^!setspread/i, '').trim().split(' ');
                const idSheet = input[0];
                const namaEvent = input.slice(1).join(' ') || 'Event Minggu Ini';

                if (!idSheet) {
                    await sock.sendMessage(chatId, { text: '❌ Format: !setspread <ID_Spreadsheet> [Nama Event]' });
                    continue;
                }

                let daftar = bacaDaftarSpreadsheet();
                daftar = daftar.filter(item => item.entitas.toUpperCase() !== entitasTarget.toUpperCase());

                daftar.push({
                    entitas: entitasTarget,
                    spreadsheetId: idSheet,
                    namaEvent: namaEvent,
                    updatedAt: new Date().toISOString()
                });

                simpanDaftarSpreadsheet(daftar);
                await sock.sendMessage(chatId, {
                    text: `✅ *Spreadsheet ${entitasTarget} Didaftarkan!*\n📌 Event: ${namaEvent}\n🔗 ID: ${idSheet}`
                });
                continue;
            }

            // Command: !rekap (cek rekap pendaftar kapan saja)
            if (teksPesan.toLowerCase() === '!rekap') {
                const entitasTarget = chatId === GRUP_PSI ? 'PSI' : (chatId === GRUP_ARTERIA ? 'Arteria' : null);
                if (!entitasTarget) continue;

                await sock.sendMessage(chatId, { text: `⏳ Sedang mengambil data pendaftar dari Google Spreadsheet ${entitasTarget}...` });
                const hasilRekap = await ambilRekapGoogleSheets(entitasTarget);
                await sock.sendMessage(chatId, { text: `📊 *REKAP MANUAL PENDAFTARAN*\n${hasilRekap.trim()}` });
                continue;
            }

            /* [DINONAKTIFKAN - FITUR MATERI]
            // Command: !jadwal (input jadwal materi)
            if (teksPesan.toLowerCase().startsWith('!jadwal')) {
                const entitasTarget = chatId === GRUP_PSI ? 'PSI' : (chatId === GRUP_ARTERIA ? 'Arteria' : null);
                if (!entitasTarget) continue;

                try {
                    // Parse input: !jadwal 18-07-2026\n1. Materi A/ Narasumber\n2. Materi B/ Narasumber
                    const barisInput = teksPesan.split('\n');
                    if (barisInput.length < 2) {
                        await sock.sendMessage(chatId, { text: '❌ Format salah. Contoh:\n!jadwal 18-07-2026\n1. Basic Life Support/ Menunggu\n2. Neonatal Life Support/ Ns. Melissa' });
                        continue;
                    }

                    // Parse tanggal dari baris pertama
                    const barisTanggal = barisInput[0].replace('!jadwal', '').trim();
                    const matchTanggal = barisTanggal.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
                    if (!matchTanggal) {
                        await sock.sendMessage(chatId, { text: '❌ Format tanggal salah. Contoh: 18-07-2026' });
                        continue;
                    }

                    const hari = parseInt(matchTanggal[1]);
                    const bulan = parseInt(matchTanggal[2]);
                    const tahun = parseInt(matchTanggal[3]) || new Date().getFullYear();
                    const namaBulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
                    const tanggalFormat = `${hari} ${namaBulan[bulan - 1]} ${tahun}`;

                    // Parse list materi
                    const materi = bacaMateri();
                    let eventGroup = materi.events.find(e => e.entity === entitasTarget && e.date === tanggalFormat);
                    if (!eventGroup) {
                        eventGroup = { entity: entitasTarget, date: tanggalFormat, items: [] };
                        materi.events.push(eventGroup);
                    }

                    let jumlahBaru = 0;
                    for (let i = 1; i < barisInput.length; i++) {
                        const baris = barisInput[i].trim();
                        if (!baris) continue;

                        // Parse: "1. Nama Materi/ Narasumber" atau "1. Nama Materi - Narasumber"
                        const matchItem = baris.match(/^\d+\.\s*(.+?)(?:\s*[\/\|]\s*(.+))?$/);
                        if (matchItem) {
                            const namaMateri = matchItem[1].trim();
                            const narasumber = matchItem[2] ? matchItem[2].trim() : 'Belum Ditentukan';

                            // Cek duplikat
                            const sudahAda = eventGroup.items.some(item =>
                                item.name.toLowerCase() === namaMateri.toLowerCase()
                            );

                            if (!sudahAda) {
                                eventGroup.items.push({
                                    name: namaMateri,
                                    narasumber: narasumber,
                                    uploaded: false,
                                    matchedFile: null,
                                    uploadedAt: null
                                });
                                jumlahBaru++;
                            }
                        }
                    }

                    simpanMateri(materi);
                    await sock.sendMessage(chatId, { text: `✅ *Jadwal ${entitasTarget} Tersimpan*\n📅 Tanggal: ${tanggalFormat}\n📎 Materi ditambah: ${jumlahBaru} item\n📋 Total materi: ${eventGroup.items.length} item` });
                } catch (e) {
                    console.error('Gagal proses !jadwal:', e.message);
                    await sock.sendMessage(chatId, { text: '❌ Gagal memproses jadwal.' });
                }
                continue;
            }

            // Command: !statusmateri
            if (teksPesan.toLowerCase() === '!statusmateri') {
                const entitasTarget = chatId === GRUP_PSI ? 'PSI' : (chatId === GRUP_ARTERIA ? 'Arteria' : null);
                if (!entitasTarget) continue;

                try {
                    const laporan = formatStatusMateri(entitasTarget);
                    await sock.sendMessage(chatId, { text: laporan });
                } catch (e) {
                    await sock.sendMessage(chatId, { text: '❌ Gagal memuat status materi.' });
                }
                continue;
            }
            */

            // Dokumen PDF
            if (apakahAdaDokumen(msg)) {
                const info = ambilInfoDokumen(msg);
                if (info && info.fileName.toLowerCase().includes('.pdf')) {
                    await prosesDokumenPDF(msg);
                }
            }
        }
    });
}

mulaiBot();

// ================================================================
// BRIDGE DASHBOARD (http://127.0.0.1:5592) - dibaca oleh panel kontrol
// ================================================================
const BRIDGE_PORT_ADMIN = 5592;
let lastQrData = null;

function readJsonSafe(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readBodyJson(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (c) => { data += c; });
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    });
}

setTimeout(() => {
    require('http').createServer(async (req, res) => {
        res.setHeader('content-type', 'application/json');
        try {
            if (req.method === 'GET' && req.url === '/status') {
                const connected = !!(sock && sock.user);
                let nomor = null;
                if (connected && sock.user && sock.user.id) {
                    nomor = sock.user.id.split(':')[0];
                    if (nomor.startsWith('+')) nomor = nomor;
                    else if (nomor.startsWith('0')) nomor = '+62' + nomor.slice(1);
                    else if (nomor.startsWith('62')) nomor = '+' + nomor;
                    else nomor = '+' + nomor;
                }
                return res.end(JSON.stringify({
                    connected,
                    nomor,
                    qr: (lastQrData && lastQrData.qr) ? lastQrData.qr : null,
                    qrFresh: lastQrData ? (Date.now() - lastQrData.ts < 120000) : false
                }));
            }

            if (req.method === 'POST' && req.url === '/reset') {
                try {
                    if (sock) {
                        await sock.end(undefined);
                        sock = null;
                    }
                    const authDir = activeSessionDir();
                    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
                    lastQrData = null;
                    return res.end(JSON.stringify({ ok: true, message: 'Sesi dihapus. QR baru akan muncul.' }));
                } catch (e) {
                    return res.end(JSON.stringify({ error: String(e.message || e) }));
                }
            }

            if (req.method === 'POST' && req.url === '/setslot') {
                try {
                    const body = await readBodyJson(req);
                    let slot = String(body.slot || '').trim();
                    if (!/^admin\d+$/.test(slot)) return res.end(JSON.stringify({ error: 'Slot harus format adminN' }));
                    const f = path.join(config.DATA_DIR, 'admin', 'current-slot.json');
                    fs.writeFileSync(f, JSON.stringify({ slot, ts: Date.now() }));
                    if (sock) { await sock.end(undefined); sock = null; }
                    lastQrData = null;
                    setTimeout(() => { mulaiBot().catch(() => {}); }, 800);
                    return res.end(JSON.stringify({ ok: true, slot, message: `Slot diganti ke ${slot}. QR baru siap scan.` }));
                } catch (e) {
                    return res.end(JSON.stringify({ error: String(e.message || e) }));
                }
            }
            if (req.method === 'GET' && req.url === '/slot') {
                return res.end(JSON.stringify({ slot: CFG.activeSlot(), slots: CFG.slots }));
            }

            if (req.method === 'POST' && req.url === '/reset-all') {
                try {
                    if (sock) {
                        await sock.end(undefined);
                        sock = null;
                    }
                    const authDir = activeSessionDir();
                    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
                    lastQrData = null;
                    return res.end(JSON.stringify({ ok: true, reset: ['admin-ai'] }));
                } catch (e) {
                    return res.end(JSON.stringify({ error: String(e.message || e) }));
                }
            }

            if (req.method === 'GET' && req.url === '/database') {
                const db = readJsonSafe(DB_FILE, []);
                const archive = readJsonSafe(ARCHIVE_FILE, []);
                return res.end(JSON.stringify({ database: db, archive: archive }));
            }

            if (req.method === 'GET' && req.url === '/spreadsheets') {
                const sheets = readJsonSafe(SPREADSHEET_FILE, []);
                return res.end(JSON.stringify({ spreadsheets: sheets }));
            }

            if (req.method === 'GET' && req.url === '/crawl-status') {
                const psiMtime = fs.existsSync(CACHE_PSI) ? fs.statSync(CACHE_PSI).mtimeMs : null;
                const artMtime = fs.existsSync(CACHE_ARTERIA) ? fs.statSync(CACHE_ARTERIA).mtimeMs : null;
                return res.end(JSON.stringify({
                    psi: { url: URL_PSI, lastCrawl: psiMtime },
                    arteria: { url: URL_ARTERIA, lastCrawl: artMtime }
                }));
            }

            if (req.method === 'POST' && req.url === '/crawl') {
                try {
                    await mulaiPemantauan();
                    return res.end(JSON.stringify({ ok: true, message: 'Crawl selesai' }));
                } catch (e) {
                    return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
                }
            }

            if (req.method === 'GET' && req.url === '/countdown') {
                const db = readJsonSafe(DB_FILE, []);
                const now = new Date();
                const upcoming = [];
                const months = {
                    'januari': 0, 'februari': 1, 'maret': 2, 'april': 3, 'mei': 4, 'juni': 5,
                    'juli': 6, 'agustus': 7, 'september': 8, 'oktober': 9, 'november': 10, 'desember': 11,
                    'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
                    'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
                };
                for (const item of db) {
                    const raw = String(item.tanggalAcara || '');
                    const m = raw.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
                    if (!m) continue;
                    const monthIdx = months[m[2].toLowerCase()];
                    if (monthIdx == null) continue;
                    const eventDate = new Date(parseInt(m[3]), monthIdx, parseInt(m[1]));
                    const diffMs = eventDate.getTime() - now.getTime();
                    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                    if (diffDays >= 0) {
                        upcoming.push({
                            entitas: item.entitas,
                            namaAcara: item.namaAcara,
                            tanggal: raw,
                            hari: diffDays,
                            statusWebsite: item.statusWebsite
                        });
                    }
                }
                upcoming.sort((a, b) => a.hari - b.hari);
                return res.end(JSON.stringify({ upcoming }));
            }

            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not found' }));
        } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e.message || e) }));
        }
    }).listen(BRIDGE_PORT_ADMIN, '127.0.0.1', () => {
        console.log(`Bridge dashboard AI-ADMIN aktif di http://127.0.0.1:${BRIDGE_PORT_ADMIN}`);
    });
}, 25000);
