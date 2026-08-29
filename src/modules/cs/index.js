const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const Datastore = require('nedb-promises');
const path = require('path');

process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [UNHANDLED REJECTION]:', reason?.message || reason);
});
const fs = require('fs');

const config = require('../../config');
const CFG = config.cs;

// Database utk sesi per user
const db = Datastore.create({ filename: CFG.files.botDatabase, autoload: true });

// Database untuk tracking pemilihan menu user
const dbTrack = Datastore.create({ filename: CFG.files.trackingMenu, autoload: true });

// Tracker kapan bot terakhir kirim balasan ke user (untuk bedakan bot reply vs admin manual reply)
const lastBotReply = {};

// Global sock registry: admin1 & admin2
const adminSocks = {};
const reconnectCount = {};
const connectedAdmins = {};

// Pending broadcast state: menunggu pemilihan admin
let pendingBroadcast = null;

// Lock untuk mencegah double broadcast dari dua sock
let broadcastLock = false;

// Flag untuk stop broadcast
let broadcastStop = false;

// Sock yang sedang melakukan broadcast
let broadcastSockName = null;

// Progress tracking untuk broadcast
let broadcastProgress = {
    total: 0,
    sent: 0,
    failed: 0,
    remaining: [],
    status: 'idle'
};

// Pending fallback: menunggu konfirmasi kirim ulang ke grup gagal
let pendingFallback = null;

// Helper: kirim balasan ke user sambil mark waktu bot reply
async function sendReply(sock, userJid, content) {
    lastBotReply[userJid] = Date.now();
    return sock.sendMessage(userJid, content);
}

// Fungsi eksekusi broadcast ke semua grup webinar
async function jalankanBroadcast(replySock, userJid, broadcastData, namaAdmin, targetSock, daftarGrupTarget) {
    broadcastLock = true;
    broadcastSockName = namaAdmin;

    console.log(`🔒 Broadcast lock AKTIF. Pesan type: ${broadcastData.pesan.image ? 'image' : 'text'}`);
    if (broadcastData.pesan.caption) console.log(`   Caption: ${broadcastData.pesan.caption.substring(0, 50)}...`);
    if (broadcastData.pesan.text) console.log(`   Text: ${broadcastData.pesan.text.substring(0, 50)}...`);

    const grupGagal = [];
    broadcastStop = false;
    broadcastProgress = {
        total: daftarGrupTarget.length,
        sent: 0,
        failed: 0,
        remaining: daftarGrupTarget.map(g => g.nama || g.id),
        status: 'running'
    };
    await replySock.sendMessage(userJid, { text: `📤 Memulai broadcast dari *${namaAdmin.toUpperCase()}* ke ${daftarGrupTarget.length} grup...` });

    for (const grup of daftarGrupTarget) {
        if (broadcastStop) {
            broadcastProgress.status = 'stopped';
            await replySock.sendMessage(userJid, { text: `🛑 Broadcast dari *${namaAdmin.toUpperCase()}* dihentikan oleh admin.` });
            break;
        }
        const grupId = grup.id;
        const grupNama = grup.nama || grupId;
        try {
            await targetSock.sendMessage(grupId, broadcastData.pesan);
            console.log(`✅ [Bulk Sukses] ${namaAdmin} -> ${grupNama} (${grupId})`);
            broadcastProgress.sent++;
            broadcastProgress.remaining.shift();
            if (broadcastStop) {
                broadcastProgress.status = 'stopped';
                await replySock.sendMessage(userJid, { text: `🛑 Broadcast dari *${namaAdmin.toUpperCase()}* dihentikan oleh admin.` });
                break;
            }
            await randomDelay();
        } catch (errGrup) {
            console.error(`❌ [Bulk Gagal] ${namaAdmin} di ${grupNama} (${grupId}):`, errGrup.message);
            broadcastProgress.failed++;
            broadcastProgress.remaining.shift();
            grupGagal.push({ id: grupId, nama: grupNama });
        }
    }

    broadcastProgress.status = 'completed';
    broadcastLock = false;

    if (broadcastStop) {
        broadcastStop = false;
        return;
    }

    const jumlahSukses = daftarGrupTarget.length - grupGagal.length;
    if (grupGagal.length === 0) {
        await replySock.sendMessage(userJid, { text: `🏁 Selesai! Broadcast dari *${namaAdmin.toUpperCase()}* sukses ke ${daftarGrupTarget.length} grup.` });
    } else {
        const namaFallback = namaAdmin === 'admin1' ? 'admin2' : 'admin1';
        let daftarGagal = `⚠️ *${grupGagal.length} grup gagal terkirim* (nomor ${namaAdmin.toUpperCase()} tidak masuk grup):\n\n`;
        grupGagal.forEach((g, i) => {
            daftarGagal += `${i + 1}. ${g.nama}\n`;
        });
        daftarGagal += `\n✅ ${jumlahSukses} grup sukses | ❌ ${grupGagal.length} gagal\n\n`;
        daftarGagal += `Kirim ulang dari *${namaFallback.toUpperCase()}*?\nKetik *1* = ya, *0* = batal`;

        pendingFallback = {
            pesan: broadcastData.pesan,
            grupGagal: grupGagal,
            namaAdminFallback: namaFallback,
            waktu: Date.now()
        };

        await replySock.sendMessage(userJid, { text: daftarGagal });
    }
}

// File JSON untuk menyimpan daftar grup webinar secara dinamis
const GRUP_FILE = CFG.files.grupFile;

// =========================================================================
// 🎯 KONFIGURASI TARGET ID & WAKTU (DAFTAR 2 GRUP ADMIN INTERNAL)
// =========================================================================
const GRUP_ADMIN_PSI = CFG.GRUP_ADMIN_PSI;     // Grup Admin PSI
const GRUP_ADMIN_ARTERIA = CFG.GRUP_ADMIN_ARTERIA; // Grup Admin Arteria
const GRUP_PROMO = CFG.GRUP_PROMO;         // Grup Data Promosi

const TIMEOUT_BOT = CFG.TIMEOUT_BOT;              // 30 menit auto-reset ke BOT_MODE
const DELAY_MIN = CFG.DELAY_MIN;                          // Minimum jeda antar grup (5 detik)
const DELAY_MAX = CFG.DELAY_MAX;                         // Maksimum jeda antar grup (20 detik)
const TIMEOUT_MENU_SAPAAN = CFG.TIMEOUT_MENU_SAPAAN;      // 15 menit cooldown sapaan setelah pilih menu

// Fungsi Pembantu Jeda (Sleep)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = () => sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));

// Fungsi membaca/membuat file daftar grup webinar dinamis
// Format baru: array of objects { id, nama }
// Format lama (array of strings) otomatis di-convert
function ambilDaftarGrup() {
    if (!fs.existsSync(GRUP_FILE)) {
        const defaultGrup = [
            { id: GRUP_ADMIN_PSI, nama: '' },
            { id: GRUP_ADMIN_ARTERIA, nama: '' }
        ];
        fs.writeFileSync(GRUP_FILE, JSON.stringify(defaultGrup, null, 2), 'utf8');
        return defaultGrup;
    }
    try {
        const data = JSON.parse(fs.readFileSync(GRUP_FILE, 'utf8'));
        // Convert format lama (array of strings) ke format baru (array of objects)
        const converted = data.map(item => {
            if (typeof item === 'string') {
                return { id: item, nama: '' };
            }
            return item;
        });
        // Simpan hasil convert jika ada perubahan
        if (converted.some((item, i) => typeof data[i] === 'string')) {
            fs.writeFileSync(GRUP_FILE, JSON.stringify(converted, null, 2), 'utf8');
        }
        return converted;
    } catch (e) {
        return [];
    }
}

// Fungsi menyimpan grup baru ke file JSON
function simpanDaftarGrup(daftarBaru) {
    fs.writeFileSync(GRUP_FILE, JSON.stringify(daftarBaru, null, 2), 'utf8');
}

// Fungsi log pemilihan menu user
function logMenuSelection(userPhone, pilihan) {
    dbTrack.insert({ user_phone: userPhone, pilihan: pilihan, waktu: Date.now() });
}

// Fungsi fetch nama grup yang kosong dari WhatsApp

// =========================================================================
// 🤖 JALANKAN INSTANCE BOT UTAMA
// =========================================================================
async function jalankanBotAdmin(namaAdmin, isBulkOnly = false, isReplyOnly = false) {
    const { state, saveCreds } = await useMultiFileAuthState(config.stores.sessions(namaAdmin, CFG.label));

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        qrTimeout: 30 * 60 * 1000
    });

    adminSocks[namaAdmin] = sock;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            const qrFile = config.stores.qr(namaAdmin, CFG.label);
            QRCode.toFile(qrFile, qr, { type: 'png', width: 400 }, (err) => {
                if (err) console.error(`❌ Gagal simpan QR ${namaAdmin}:`, err.message);
            });
            const expiryTime = new Date(Date.now() + 30 * 60 * 1000);
            const expiryStr = expiryTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            console.log(`\n📸 [QR CODE] SILAKAN SCAN UNTUK: BOT ${namaAdmin.toUpperCase()}`);
            console.log(`⏰ QR valid sampai ${expiryStr} (30 menit)`);
            console.log(`📁 File QR: ${qrFile}`);
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            connectedAdmins[namaAdmin] = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`🔌 Koneksi Bot ${namaAdmin} terputus (code: ${statusCode}). Reconnect otomatis: ${shouldReconnect}`);
            if (shouldReconnect) {
                reconnectCount[namaAdmin] = (reconnectCount[namaAdmin] || 0) + 1;
                const delay = Math.min(20000 + ((reconnectCount[namaAdmin] - 1) * 10000), 60000);
                console.log(`⏳ Reconnect ${namaAdmin} dalam ${delay/1000} detik (attempt ${reconnectCount[namaAdmin]})...`);
                setTimeout(() => { jalankanBotAdmin(namaAdmin, isBulkOnly, isReplyOnly); }, delay);
            }
        } else if (connection === 'open') {
            connectedAdmins[namaAdmin] = true;
            reconnectCount[namaAdmin] = 0;
            console.log(`\n✅ INSTANCE BOT [${namaAdmin.toUpperCase()}] BERHASIL AKTIF & TERHUBUNG!`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // EVENT HANDLER PESAN MASUK DAN KELUAR
    sock.ev.on('messages.upsert', async (m) => {
        // 🛡️ BENTENG TRY-CATCH UTAMA
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;
            // Skip pesan dari sendiri HANYA di grup (cegah bot trigger perintah sendiri)
            // Di DM jangan di-skip supaya KONDISI 3 (handover admin) bisa jalan
            const isFromMe = msg.key.fromMe;

            // Filter pesan dari sock bot LAIN (bukan sendiri) agar gak trigger perintah
            const senderJid = msg.key.participant || msg.key.remoteJid;
            const adminJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const otherBotJids = Object.values(adminSocks)
                .filter(s => s !== sock)
                .map(s => s.user?.id?.split(':')[0] + '@s.whatsapp.net')
                .filter(Boolean);
            if (otherBotJids.includes(senderJid)) return;

            const userJid = msg.key.remoteJid; 
            const waktuSekarang = Date.now();

            // -------------------------------------------------------------------------
            // KONDISI 1: CHAT MASUK DI GRUP PROMOSI (BULK BROADCAST)
            // -------------------------------------------------------------------------
            if (userJid === GRUP_PROMO) {
                if (isFromMe) return; // Skip pesan sendiri di grup promosi
                let incomingText = "";
                let tipePesan = "";
                let mediaMessage = null;

                if (msg.message.conversation) {
                    incomingText = msg.message.conversation;
                    tipePesan = "text";
                } else if (msg.message.extendedTextMessage?.text) {
                    incomingText = msg.message.extendedTextMessage.text;
                    tipePesan = "text";
                } else if (msg.message.imageMessage) {
                    incomingText = msg.message.imageMessage.caption || "";
                    tipePesan = "image";
                    mediaMessage = msg.message.imageMessage;
                }

                // !bulkkirim → simpan pending, tanya admin
                if (incomingText.includes('!bulkkirim')) {
                    // Prevent double reply dari kedua sock
                    if (pendingBroadcast && (Date.now() - pendingBroadcast.waktu < 3000)) {
                        return;
                    }

                    const pesanPromosi = incomingText.replace('!bulkkirim', '').trim().replace(/\\n/g, '\n');
                    const daftarGrupTarget = ambilDaftarGrup();

                    if (daftarGrupTarget.length === 0) {
                        await sock.sendMessage(userJid, { text: "⚠️ Tidak ada grup webinar yang terdaftar." });
                        return;
                    }

                    let konfigurasiPesan = {};

                    if (tipePesan === "image" && mediaMessage) {
                        try {
                            console.log("📥 Mengunduh flyer utama dari Grup Promosi...");
                            const stream = await downloadContentFromMessage(mediaMessage, 'image');
                            let bufferGambar = Buffer.alloc(0);
                            for await (const chunk of stream) {
                                bufferGambar = Buffer.concat([bufferGambar, chunk]);
                            }
                            konfigurasiPesan = { image: bufferGambar, caption: pesanPromosi };
                        } catch (errDownload) {
                            console.error("❌ Gagal mendownload gambar:", errDownload.message);
                            await sock.sendMessage(userJid, { text: "❌ Gagal memproses gambar Brosur." });
                            return;
                        }
                    } else {
                        if (!pesanPromosi) {
                            await sock.sendMessage(userJid, { text: "⚠️ Gagal. Teks promosi webinar kosong!" });
                            return;
                        }
                        konfigurasiPesan = { text: pesanPromosi };
                    }

                    pendingBroadcast = {
                        pesan: konfigurasiPesan,
                        jumlahGrup: daftarGrupTarget.length,
                        waktu: Date.now()
                    };

                    // Auto-detect: jika hanya 1 admin online, skip prompt
                    const admin1Ready = connectedAdmins['admin1'] && adminSocks['admin1'];
                    const admin2Ready = connectedAdmins['admin2'] && adminSocks['admin2'];

                    if (!admin1Ready && admin2Ready) {
                        // Auto kirim via admin2 (admin1 offline)
                        pendingBroadcast.kirimDengan = 'admin2';
                        await sock.sendMessage(userJid, { text: `🚀 Brosur & Teks diterima! (${daftarGrupTarget.length} grup)\n\n⚠️ Admin1 sedang offline, otomatis dikirim via *Admin2*...` });
                        // Trigger broadcast langsung
                        const broadcastData = pendingBroadcast;
                        pendingBroadcast = null;
                        await jalankanBroadcast(sock, userJid, broadcastData, 'admin2', adminSocks['admin2'], daftarGrupTarget);
                    } else if (admin1Ready && !admin2Ready) {
                        // Auto kirim via admin1 (admin2 offline)
                        pendingBroadcast.kirimDengan = 'admin1';
                        await sock.sendMessage(userJid, { text: `🚀 Brosur & Teks diterima! (${daftarGrupTarget.length} grup)\n\n⚠️ Admin2 sedang offline, otomatis dikirim via *Admin1*...` });
                        const broadcastData = pendingBroadcast;
                        pendingBroadcast = null;
                        await jalankanBroadcast(sock, userJid, broadcastData, 'admin1', adminSocks['admin1'], daftarGrupTarget);
                    } else if (!admin1Ready && !admin2Ready) {
                        await sock.sendMessage(userJid, { text: `❌ Admin1 dan Admin2 sedang offline. Broadcast tidak dapat dikirim.` });
                        pendingBroadcast = null;
                    } else {
                        // Kedua admin online → prompt pilihan
                        await sock.sendMessage(userJid, { 
                            text: `🚀 Brosur & Teks diterima! (${daftarGrupTarget.length} grup)\n\nKirim dengan nomor berapa?\n1️⃣ Admin1\n2️⃣ Admin2` 
                        });
                    }
                    return;
                }

                // Pilihan admin: 1 atau 2
                if (pendingBroadcast && !broadcastLock && (Date.now() - pendingBroadcast.waktu < 30000)) {
                    const pilihanAdmin = incomingText.trim();
                    if (pilihanAdmin === '1' || pilihanAdmin === '2') {
                        let namaAdmin = pilihanAdmin === '1' ? 'admin1' : 'admin2';
                        let targetSock = adminSocks[namaAdmin];

                        // Auto-fallback jika admin yang dipilih tidak terhubung
                        if (!targetSock || !connectedAdmins[namaAdmin]) {
                            const fallbackAdmin = namaAdmin === 'admin1' ? 'admin2' : 'admin1';
                            console.log(`⚠️ ${namaAdmin} tidak terhubung, auto-fallback ke ${fallbackAdmin}`);
                            if (connectedAdmins[fallbackAdmin] && adminSocks[fallbackAdmin]) {
                                namaAdmin = fallbackAdmin;
                                targetSock = adminSocks[fallbackAdmin];
                                await sock.sendMessage(userJid, { text: `⚠️ *${namaAdmin === 'admin1' ? 'Admin2' : 'Admin1'}* sedang offline. Broadcast dialihkan ke *${fallbackAdmin === 'admin1' ? 'Admin1' : 'Admin2'}*.` });
                            }
                        }

                        if (!targetSock) {
                            await sock.sendMessage(userJid, { text: `❌ Bot ${namaAdmin} belum terhubung. Silakan tunggu atau scan QR.` });
                            pendingBroadcast = null;
                            return;
                        }

                        const broadcastData = pendingBroadcast;
                        pendingBroadcast = null;
                        const daftarGrupTarget = ambilDaftarGrup();
                        await jalankanBroadcast(sock, userJid, broadcastData, namaAdmin, targetSock, daftarGrupTarget);
                        return;
                    }
                }

                // !stop → hentikan broadcast yang sedang berjalan
                if (incomingText.trim().toLowerCase() === '!stop') {
                    if (namaAdmin !== 'admin1') return;
                    if (broadcastLock) {
                        broadcastStop = true;
                        await sock.sendMessage(userJid, { text: "🛑 Sinyal stop diterima. Broadcast akan dihentikan setelah grup saat ini selesai..." });
                    } else {
                        await sock.sendMessage(userJid, { text: "⚠️ Tidak ada broadcast yang sedang berjalan." });
                    }
                    return;
                }

                // !status → cek progress broadcast
                if (incomingText.trim().toLowerCase() === '!status') {
                    if (namaAdmin !== 'admin1') return;
                    if (broadcastProgress.status === 'running') {
                        let msg = `📊 *STATUS BROADCAST*\n\n`;
                        msg += `• Total: ${broadcastProgress.total} grup\n`;
                        msg += `✅ Terkirim: ${broadcastProgress.sent}\n`;
                        msg += `❌ Gagal: ${broadcastProgress.failed}\n`;
                        msg += `⏳ Tersisa: ${broadcastProgress.remaining.length} grup\n`;
                        if (broadcastProgress.remaining.length > 0) {
                            msg += `\n*Belum dikirim:*\n`;
                            broadcastProgress.remaining.slice(0, 10).forEach((g, i) => {
                                msg += `${i + 1}. ${g}\n`;
                            });
                            if (broadcastProgress.remaining.length > 10) {
                                msg += `... dan ${broadcastProgress.remaining.length - 10} lagi`;
                            }
                        }
                        await sock.sendMessage(userJid, { text: msg });
                    } else if (broadcastProgress.status === 'completed') {
                        await sock.sendMessage(userJid, { text: `✅ Broadcast sudah selesai. Total: ${broadcastProgress.total}, Terkirim: ${broadcastProgress.sent}, Gagal: ${broadcastProgress.failed}` });
                    } else {
                        await sock.sendMessage(userJid, { text: "ℹ️ Tidak ada broadcast yang sedang berjalan." });
                    }
                    return;
                }

                // Timeout pending broadcast
                if (pendingBroadcast && (Date.now() - pendingBroadcast.waktu >= 30000)) {
                    pendingBroadcast = null;
                    await sock.sendMessage(userJid, { text: "⏰ Waktu pemilihan admin habis. Silakan kirim ulang perintah broadcast dari awal." });
                }

                // =========================================================================
                // FALLBACK: Kirim ulang ke grup gagal dari admin lain
                // =========================================================================
                if (pendingFallback && !broadcastLock && (Date.now() - pendingFallback.waktu < 60000)) {
                    const pilihan = incomingText.trim();
                    if (pilihan === '1') {
                        const fallbackData = pendingFallback;
                        pendingFallback = null;
                        broadcastLock = true;

                        const targetSock = adminSocks[fallbackData.namaAdminFallback];
                        if (!targetSock) {
                        broadcastLock = false;
                        broadcastSockName = null;
                            await sock.sendMessage(userJid, { text: `❌ Bot ${fallbackData.namaAdminFallback} belum terhubung. Fallback dibatalkan.` });
                            return;
                        }

                        await sock.sendMessage(userJid, { text: `📤 Mengirim ulang dari *${fallbackData.namaAdminFallback.toUpperCase()}* ke ${fallbackData.grupGagal.length} grup gagal...` });

                        const grupGagalBaru = [];
                        broadcastSockName = fallbackData.namaAdminFallback;
                        for (const grup of fallbackData.grupGagal) {
                            if (broadcastStop) {
                                await sock.sendMessage(userJid, { text: `🛑 Fallback dari *${fallbackData.namaAdminFallback.toUpperCase()}* dihentikan oleh admin.` });
                                break;
                            }
                            try {
                                await targetSock.sendMessage(grup.id, fallbackData.pesan);
                                console.log(`✅ [Fallback Sukses] ${fallbackData.namaAdminFallback} -> ${grup.nama} (${grup.id})`);
                                if (broadcastStop) {
                                    await sock.sendMessage(userJid, { text: `🛑 Fallback dari *${fallbackData.namaAdminFallback.toUpperCase()}* dihentikan oleh admin.` });
                                    break;
                                }
                                await randomDelay();
                            } catch (errGrup) {
                                console.error(`❌ [Fallback Gagal] ${fallbackData.namaAdminFallback} di ${grup.nama} (${grup.id}):`, errGrup.message);
                                grupGagalBaru.push(grup);
                            }
                        }

                        broadcastLock = false;
                        broadcastSockName = null;
                        broadcastStop = false;

                        if (grupGagalBaru.length > 0) {
                            const nextAdmin = fallbackData.namaAdminFallback === 'admin1' ? 'admin2' : 'admin1';
                            let daftarGagal = `⚠️ Masih ada *${grupGagalBaru.length} grup gagal* dari ${fallbackData.namaAdminFallback.toUpperCase()}:\n\n`;
                            grupGagalBaru.forEach((g, i) => {
                                daftarGagal += `${i + 1}. ${g.nama}\n`;
                            });
                            daftarGagal += `\nCoba kirim dari *${nextAdmin.toUpperCase()}*?\nKetik *1* = ya, *0* = batal`;

                            pendingFallback = {
                                pesan: fallbackData.pesan,
                                grupGagal: grupGagalBaru,
                                namaAdminFallback: nextAdmin,
                                waktu: Date.now()
                            };

                            await sock.sendMessage(userJid, { text: daftarGagal });
                        } else {
                            const jumlahSukses = fallbackData.grupGagal.length;
                            await sock.sendMessage(userJid, { text: `🏁 Semua ${jumlahSukses} grup gagal berhasil terkirim dari *${fallbackData.namaAdminFallback.toUpperCase()}*!` });
                        }
                        return;
                    }
                    if (pilihan === '0') {
                        pendingFallback = null;
                        await sock.sendMessage(userJid, { text: "❌ Broadcast ke grup gagal dibatalkan." });
                        return;
                    }
                }

                // Timeout pending fallback
                if (pendingFallback && (Date.now() - pendingFallback.waktu >= 60000)) {
                    pendingFallback = null;
                    await sock.sendMessage(userJid, { text: "⏰ Waktu konfirmasi fallback habis. Grup gagal tidak dikirim ulang." });
                }

                if (incomingText.trim().toLowerCase() === '!cekgrup') {
                    if (namaAdmin !== 'admin1') return; // Hanya admin1 yang handle cekgrup
                    const daftarGrup = ambilDaftarGrup();
                    if (daftarGrup.length === 0) {
                        await sock.sendMessage(userJid, { text: "⚠️ Belum ada grup yang terdaftar." });
                    } else {
                        let listGrup = "📋 *DAFTAR GRUP WEBINAR TERDAFTAR:*\n\n";
                        daftarGrup.forEach((grup, index) => {
                            const nama = grup.nama || '(nama belum diambil)';
                            listGrup += `${index + 1}. ${nama}\n   ID: ${grup.id}\n`;
                        });
                        listGrup += `\nTotal: ${daftarGrup.length} grup`;
                        await sock.sendMessage(userJid, { text: listGrup });
                    }
                    return;
                }

                if (incomingText.trim().toLowerCase().startsWith('!tambahgrup ')) {
                    const grupId = incomingText.trim().replace('!tambahgrup', '').trim();
                    if (!grupId || !grupId.endsWith('@g.us')) {
                        await sock.sendMessage(userJid, { text: "⚠️ Format salah. Gunakan: !tambahgrup [ID_GRUP]" });
                        return;
                    }

                    let daftarGrup = ambilDaftarGrup();
                    if (daftarGrup.some(g => g.id === grupId)) {
                        await sock.sendMessage(userJid, { text: "⚠️ Grup ini sudah terdaftar sebelumnya." });
                        return;
                    }

                    let namaGrup = '';
                    try {
                        const metadata = await sock.groupMetadata(grupId);
                        namaGrup = metadata.subject;
                    } catch (err) {
                        console.log(`⚠️ Gagal ambil nama grup: ${err.message}`);
                    }

                    daftarGrup.push({ id: grupId, nama: namaGrup });
                    simpanDaftarGrup(daftarGrup);
                    const namaTampil = namaGrup || grupId;
                    await sock.sendMessage(userJid, { text: `✅ Grup *${namaTampil}* sukses ditambahkan ke daftar broadcast!` });
                }

                if (incomingText.trim().toLowerCase().startsWith('!hapusgrup ')) {
                    const grupId = incomingText.trim().replace('!hapusgrup', '').trim();
                    if (!grupId) {
                        await sock.sendMessage(userJid, { text: "⚠️ Format salah. Gunakan: !hapusgrup [ID_GRUP]" });
                        return;
                    }

                    let daftarGrup = ambilDaftarGrup();
                    const index = daftarGrup.findIndex(g => g.id === grupId);
                    if (index === -1) {
                        await sock.sendMessage(userJid, { text: "⚠️ Grup tidak ditemukan dalam daftar." });
                        return;
                    }

                    const removed = daftarGrup.splice(index, 1)[0];
                    simpanDaftarGrup(daftarGrup);
                    const namaTampil = removed.nama || grupId;
                    await sock.sendMessage(userJid, { text: `✅ Grup *${namaTampil}* berhasil dihapus dari daftar broadcast.` });
                }

                if (incomingText.trim().toLowerCase() === '!ping') {
                    if (namaAdmin !== 'admin1') return;
                    const latency = Date.now() - waktuSekarang;
                    await sock.sendMessage(userJid, { text: `🤖 Bot CS aktif dengan Respon: ${latency}ms` });
                }

                return; 
            }

            // -------------------------------------------------------------------------
            // KONDISI 1B: CHAT MASUK DI GRUP ADMIN (STATISTIK & PING)
            // -------------------------------------------------------------------------
            if (userJid === GRUP_ADMIN_PSI || userJid === GRUP_ADMIN_ARTERIA) {
                if (namaAdmin !== 'admin1') return; // Hanya admin1 yang merespons grup admin
                let incomingText = "";
                if (msg.message.conversation) {
                    incomingText = msg.message.conversation;
                } else if (msg.message.extendedTextMessage?.text) {
                    incomingText = msg.message.extendedTextMessage.text;
                }

                if (incomingText.trim().toLowerCase() === '!statistik') {
                    try {
                        const semuaData = await dbTrack.find({});
                        const total = semuaData.length;
                        
                        if (total === 0) {
                            await sock.sendMessage(userJid, { text: "📊 *STATISTIK MENU*\n\nBelum ada data pemilihan menu." });
                        } else {
                            const hitung = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0 };
                            semuaData.forEach(d => {
                                if (hitung[d.pilihan] !== undefined) hitung[d.pilihan]++;
                            });

                            const namaMenu = {
                                '1': 'Info Promo',
                                '2': 'Cara Daftar',
                                '3': 'Pendaftaran Langsung',
                                '4': 'Verifikasi / Eror',
                                '5': 'Claim Voucher',
                                '6': 'Ketentuan Tambahan',
                                '7': 'Customer Care'
                            };

                            let statistik = "📊 *STATISTIK PEMILIHAN MENU*\n\n";
                            for (let i = 1; i <= 7; i++) {
                                const persen = total > 0 ? Math.round((hitung[String(i)] / total) * 100) : 0;
                                statistik += `• Menu ${i} (${namaMenu[String(i)]}): *${hitung[String(i)]}* kali (${persen}%)\n`;
                            }
                            statistik += `\n📈 *Total interaksi: ${total}*`;

                            await sock.sendMessage(userJid, { text: statistik });
                        }
                    } catch (err) {
                        console.error("❌ Error statistik:", err.message);
                        await sock.sendMessage(userJid, { text: "❌ Gagal mengambil data statistik." });
                    }
                }

                if (incomingText.trim().toLowerCase() === '!ping') {
                    const latency = Date.now() - waktuSekarang;
                    await sock.sendMessage(userJid, { text: `🤖 Bot CS aktif dengan Respon: ${latency}ms` });
                }

                return;
            }

            // Ambil teks pesan masuk japri
            let textCek = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";
            const command = textCek.trim().toLowerCase();

            // -------------------------------------------------------------------------
            // KONDISI 2: REGISTER GRUP WEBINAR BARU
            // -------------------------------------------------------------------------
            if (command === '!daftargrup' && userJid.endsWith('@g.us')) {
                if (namaAdmin !== 'admin1') return;
                let daftarGrup = ambilDaftarGrup();
                if (!daftarGrup.some(g => g.id === userJid)) {
                    let namaGrup = '';
                    try {
                        const metadata = await sock.groupMetadata(userJid);
                        namaGrup = metadata.subject;
                    } catch (err) {
                        console.log(`⚠️ Gagal ambil nama grup: ${err.message}`);
                    }
                    daftarGrup.push({ id: userJid, nama: namaGrup });
                    simpanDaftarGrup(daftarGrup);
                    const namaTampil = namaGrup || userJid;
                    await sock.sendMessage(userJid, { text: `✅ Grup *${namaTampil}* sukses didaftarkan ke sistem bulk dinamis!` });
                } else {
                    await sock.sendMessage(userJid, { text: "⚠️ Grup ini sudah terdaftar sebelumnya." });
                }
                return;
            }

            // -------------------------------------------------------------------------
            // KONDISI 2B: CEK DAFTAR GRUP WEBINAR
            // -------------------------------------------------------------------------
            if (command === '!cekgrup' && userJid.endsWith('@g.us')) {
                if (namaAdmin !== 'admin1') return;
                const daftarGrup = ambilDaftarGrup();
                if (daftarGrup.length === 0) {
                    await sock.sendMessage(userJid, { text: "⚠️ Belum ada grup yang terdaftar." });
                } else {
                    let listGrup = "📋 *DAFTAR GRUP WEBINAR TERDAFTAR:*\n\n";
                    daftarGrup.forEach((grup, index) => {
                        const nama = grup.nama || '(nama belum diambil)';
                        listGrup += `${index + 1}. ${nama}\n   ID: ${grup.id}\n`;
                    });
                    listGrup += `\nTotal: ${daftarGrup.length} grup`;
                    await sock.sendMessage(userJid, { text: listGrup });
                }
                return;
            }
            // -------------------------------------------------------------------------
            // KONDISI 2C: CEK ID GRUP
            // -------------------------------------------------------------------------
            if (command === '!id' && userJid.endsWith('@g.us')) {
                if (namaAdmin !== 'admin1') return;
                let namaGrup = userJid;
                try {
                    const metadata = await sock.groupMetadata(userJid);
                    namaGrup = metadata.subject;
                } catch (err) {}
                await sock.sendMessage(userJid, { text: `📌 *ID GRUP*\n\nNama: *${namaGrup}*\nID: \`${userJid}\`\n\nGunakan ID di atas untuk perintah !hapusgrup` });
                return;
            }
            // -------------------------------------------------------------------------
            // KONDISI 2D: HAPUS GRUP WEBINAR DARI GRUP MANAPUN
            // -------------------------------------------------------------------------
            if (command.startsWith('!hapusgrup ') && userJid.endsWith('@g.us')) {
                if (namaAdmin !== 'admin1') return;
                const grupId = textCek.replace(/^!hapusgrup\s+/i, '').trim();
                if (!grupId) {
                    await sock.sendMessage(userJid, { text: "⚠️ Format salah. Gunakan: !hapusgrup [ID_GRUP]" });
                    return;
                }
                let daftarGrup = ambilDaftarGrup();
                const index = daftarGrup.findIndex(g => g.id === grupId);
                if (index === -1) {
                    await sock.sendMessage(userJid, { text: "⚠️ Grup tidak ditemukan dalam daftar." });
                    return;
                }
                const removed = daftarGrup.splice(index, 1)[0];
                simpanDaftarGrup(daftarGrup);
                const namaTampil = removed.nama || grupId;
                await sock.sendMessage(userJid, { text: `✅ Grup *${namaTampil}* berhasil dihapus dari daftar broadcast.` });
                return;
            }
            // -------------------------------------------------------------------------
            // GUARD: Blok SEMUA pesan grup dari auto-reply (KONDISI 3 & 4)
            // -------------------------------------------------------------------------
            if (userJid.endsWith('@g.us')) return;

            // -------------------------------------------------------------------------
            // 🛡️ KONDISI 3: JIKA ADMIN YANG MENGETIK JAPRI (Handover Manual)
            // -------------------------------------------------------------------------
            // KONDISI 3 & 4: Hanya untuk admin yang punya auto-reply (bukan bulk-only)
            if (!isBulkOnly) {
            if (msg.key.fromMe) {
                // 🛡️ GUARD WA BLAST: selama blast aktif (flag disentuh < 2 menit),
                // pesan fromMe dari perangkat BLASTER jangan dianggap handover admin manual
                try {
                    const blastFlagMtime = require('fs').statSync(CFG.files.blastFlag).mtimeMs;
                    if (Date.now() - blastFlagMtime < 120000) {
                        console.log('[HANDOVER DEBUG] SKIP handover - WA Blast sedang berjalan');
                        return;
                    }
                } catch (e) { /* flag tidak ada = tidak sedang blast */ }

                if (userJid.endsWith('@g.us')) return;

                // Cek apakah ini balasan bot atau admin manual
                // Jika bot baru saja balas (< 3 detik), skip — ini bukan admin manual
                const waktuBalasanBot = lastBotReply[userJid] || 0;
                const selisihBalasan = waktuSekarang - waktuBalasanBot;
                
                console.log(`[HANDOVER DEBUG] fromMe detected. userJid=${userJid}, adminJid=${adminJid}, selisihBalasan=${selisihBalasan}ms, lastBotReply=${waktuBalasanBot}`);

                if (selisihBalasan < 3000) {
                    // Bot baru saja balas, skip handover
                    console.log(`[HANDOVER DEBUG] SKIP handover - bot baru saja balas (${selisihBalasan}ms < 3000ms)`);
                    delete lastBotReply[userJid];
                    return;
                }

                const isTextMessage = msg.message.conversation || msg.message.extendedTextMessage;
                if (isTextMessage) {
                    const updateResult = await db.update(
                        { admin_phone: adminJid, user_phone: userJid },
                        { $set: { mode: 'HUMAN_MODE', last_interaction: waktuSekarang } },
                        { upsert: true }
                    );
                    console.log(`[HANDOVER OTOMATIS] Admin membalas manual chat ke ${userJid}. Bot otomatis OFF. DB update result:`, updateResult);
                } else {
                    console.log(`[HANDOVER DEBUG] Bukan text message, skip handover`);
                }
                return;
            }
            // -------------------------------------------------------------------------
            // KONDISI 4: JIKA YANG KETIK ADALAH PESERTA (Japri Masuk)
            // -------------------------------------------------------------------------

            // DETEKSI FORMAT DATA ISIAN (VERIFIKASI ATAU KLAIM VOUCHER)
            if (command.includes('email plataran sehat') && command.includes('nik ktp')) {
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { mode: 'HUMAN_MODE', last_interaction: waktuSekarang } },
                    { upsert: true }
                );

                await sendReply(sock, userJid, {
                    text: "⏳ *KLAIM / LAPORAN SEDANG DIPROSES*\n\nTerima kasih. Data Anda telah masuk ke antrean sistem validasi. Mohon tidak mengirimkan chat berulang agar antrean Anda tidak bergeser ke atas.\n\nRoom chat ini sekarang telah terhubung langsung dengan Customer Care untuk penanganan lebih lanjut."
                });
                console.log(`[INTELLIGENT DETECTION] User ${userJid} menyetor data format. Bot otomatis OFF.`);
                return; 
            }

            console.log(`[KONDISI 4 DEBUG] Peserta DM masuk. userJid=${userJid}, adminJid=${adminJid}, command="${command}"`);
            let session = await db.findOne({ admin_phone: adminJid, user_phone: userJid });
            console.log(`[KONDISI 4 DEBUG] DB findOne result:`, session);
            let isActivatedByTimeout = false;

            if (!session) {
                await db.insert({ admin_phone: adminJid, user_phone: userJid, mode: 'BOT_MODE', last_interaction: waktuSekarang });
                session = { mode: 'BOT_MODE', last_interaction: waktuSekarang };
                console.log(`[KONDISI 4 DEBUG] Session baru dibuat: BOT_MODE`);
            }

            if (session.mode === 'HUMAN_MODE') {
                const selisihWaktu = waktuSekarang - (session.last_interaction || 0);
                console.log(`[KONDISI 4 DEBUG] Mode HUMAN_MODE. selisihWaktu=${selisihWaktu}ms, TIMEOUT_BOT=${TIMEOUT_BOT}ms`);
                
                if (selisihWaktu > TIMEOUT_BOT) {
                    await db.update(
                        { admin_phone: adminJid, user_phone: userJid },
                        { $set: { mode: 'BOT_MODE', last_interaction: waktuSekarang } }
                    );
                    session.mode = 'BOT_MODE';
                    isActivatedByTimeout = true; 
                    console.log(`[AUTO-RESET] Bot otomatis aktif kembali untuk ${userJid} karena timeout.`);
                } else {
                    console.log(`[KONDISI 4 DEBUG] Masih HUMAN_MODE, bot diam.`);
                    await db.update(
                        { admin_phone: adminJid, user_phone: userJid },
                        { $set: { last_interaction: waktuSekarang } }
                    );
                    return; 
                }
            }

            await db.update(
                { admin_phone: adminJid, user_phone: userJid },
                { $set: { last_interaction: waktuSekarang } }
            );

            // LOGIKA RESPONS MENU JAPRI
            const kataSapaan = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'admin', 'assalamu\'alaikum', 'assalamualaikum', 'bot', 'cara', 'Cara', 'chat', 'Chat', 'customer care', 'customer service', 'cs', 'hallo', 'Hallo', 'halo', 'hello', 'hi', 'hola', 'ikut', 'Ikut', 'ka', 'Ka', 'KAK', 'kak', 'Kak', 'malam', 'menu', 'Menu', 'pa', 'Pa', 'pak', 'Pak', 'p', 'pagi', 'ping', 'selamat malam', 'selamat pagi', 'selamat siang', 'selamat sore', 'siang', 'sore', 'tes', 'test', 'Test'];

            const kataPengakuan = ['baik', 'betul', 'good', 'hmm', 'iye', 'mantab', 'mantap', 'mengerti', 'noted', 'ok', 'oke', 'paham', 'sip', 'siap', 'terima kasih', 'thanks', 'thank you', 'yes'];

            const isPengakuan = command.split(/\s+/).some(kata => kataPengakuan.includes(kata));
            if (isPengakuan) {
                console.log(`[PENGAKUAN] Peserta ${userJid} mengirim pengakuan: "${command}". Bot diam.`);
                return;
            }

            if (command === '1') {
                logMenuSelection(userJid, '1');
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { last_menu_selection: waktuSekarang, last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
                await sendReply(sock, userJid, { 
                    text: "-"
                });
                await sendReply(sock, userJid, { 
                    text: "-"
                });
            } 
            else if (command === '2') {
                logMenuSelection(userJid, '2');
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { last_menu_selection: waktuSekarang, last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
                await sendReply(sock, userJid, { 
                    text: "-"
                });
            } 
            else if (command === '3') {
                logMenuSelection(userJid, '3');
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { last_menu_selection: waktuSekarang, last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
                await sendReply(sock, userJid, { 
                    text: "-"
                });
            }
            else if (command === '4') {
                logMenuSelection(userJid, '4');
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { last_menu_selection: waktuSekarang, last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
                await sendReply(sock, userJid, { 
                    text: "-"
                });
            } 
            else if (command === '5') {
                logMenuSelection(userJid, '5');
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { last_menu_selection: waktuSekarang, last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
                await sendReply(sock, userJid, {
                    text: "-"
                });
            }
            else if (command === '6') {
                logMenuSelection(userJid, '6');
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { last_menu_selection: waktuSekarang, last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
                
                await sendReply(sock, userJid, { 
                    text: "-"
                });
            }
            else if (command === '7') {
                logMenuSelection(userJid, '7');
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { mode: 'HUMAN_MODE', last_interaction: waktuSekarang, last_menu_selection: waktuSekarang, last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
                
                await sendReply(sock, userJid, { 
                    text: "-"
                });
            }
            else if (command === '0' || isActivatedByTimeout) {
                await kirimMenuUtamaTeks(sock, userJid);
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
            }
            else if (kataSapaan.some(kata => command.includes(kata))) {
                const sessionMenu = await db.findOne({ admin_phone: adminJid, user_phone: userJid });
                const lastShown = sessionMenu?.last_menu_shown || 0;

                if (waktuSekarang - lastShown < TIMEOUT_MENU_SAPAAN) {
                    console.log(`[COOLDOWN] Menu sudah ditampilkan untuk ${userJid}. Bot diam.`);
                    return;
                }

                await kirimMenuUtamaTeks(sock, userJid);
                await db.update(
                    { admin_phone: adminJid, user_phone: userJid },
                    { $set: { last_menu_shown: waktuSekarang } },
                    { upsert: true }
                );
            }
            else {
                return;
            }
            } // end if (!isBulkOnly)
        } catch (errorPesan) {
            // Error handling agar bot tidak berhenti
        }
    });
}

async function kirimMenuUtamaTeks(sock, userJid) {
    const menuTeks = 
        "Selamat datang di *Layanan Terpadu Terotomatisasi*.\n\n" +
        "Ada yang bisa kami bantu hari ini? Silakan balas dengan mengetik *angka pilihan* di bawah ini:\n\n" +
        "📌 *1* 🎁 Info Promo Webinar\n" +
        "📝 *2* 📝 Cara Pendaftaran\n" +
        "✍️ *3* ✍️ Pendaftaran Langsung\n" +
        "⚠️ *4* ⚠️ Verifikasi / Error Pada Upload\n" +
        "🎟️ *5* 🎟️ Claim Voucher\n" +
        "📋 *6* 📋 Ketentuan Tambahan\n" +
        "🧑‍💼 *7* 📞 Hubungi Customer Care\n\n" +
        "💡 _Silakan balas langsung berupa angka 1, 2, 3, 4, 5, 6, atau 7._";

    await sendReply(sock, userJid, { text: menuTeks });
}

async function startServer() {
    console.log("🚀 Menjalankan Sesi Produksi Multi-Admin Akhir...");
    await jalankanBotAdmin('admin1');
    await new Promise(r => setTimeout(r, 5000));
    await jalankanBotAdmin('admin2', true);  // admin2: bulk-only, no auto-reply
    await new Promise(r => setTimeout(r, 5000));
    await jalankanBotAdmin('admin3', false, true); // admin3: reply-only, no bulk
}

startServer().catch(err => console.error("❌ Gagal menjalankan server utama:", err));


// ================================================================
// 🌉 BRIDGE DASHBOARD - dibaca oleh panel kontrol (via config)
// ================================================================
const BRIDGE_PORT = CFG.port;
const MENU_OVERRIDE_FILE = CFG.files.menuOverrideFile;
const SPAWNED_FILE = CFG.files.spawnedFile;

const MENU_BAWAAN = {
    'menu_1a': "-",
    'menu_1b': "-",
    'menu_2a': "-",
    'menu_3a': "-",
    'menu_3b': "-",
    'menu_4a': "-",
    'menu_4b': "-",
    'menu_5a': "-",
    'menu_5b': "-",
    'menu_6a': "-",
    'menu_7a': "-",
    'menu_utama': "-"
};
const bridgeBulk = { busy: false, total: 0, sent: 0, failed: 0, sender: null };

function bridgeReadBody(req) {
    return new Promise((resolve) => {
        let d = '';
        req.on('data', (c) => (d += c));
        req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    });
}

function bridgeReadJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function bridgeSlotList() {
    const extras = bridgeReadJson(SPAWNED_FILE, []);
    const slots = ['admin1', 'admin2', 'admin3'];
    for (const s of extras) if (!slots.includes(s)) slots.push(s);
    return slots;
}

function qrInfoBridge(slot) {
    try {
        const f = config.stores.qr(slot, CFG.label);
        const st = fs.statSync(f);
        const ageMin = +((Date.now() - st.mtimeMs) / 60000).toFixed(1);
        return { fresh: ageMin <= 35, age_min: ageMin };
    } catch { return { fresh: false, age_min: null }; }
}

setInterval(() => {
    const extras = bridgeReadJson(SPAWNED_FILE, []).filter((s) => !['admin1', 'admin2', 'admin3'].includes(s));
    for (const s of extras) {
        if (!adminSocks[s]) {
            console.log(`🌉 Respawn ${s} dari daftar tersimpan...`);
            jalankanBotAdmin(s);
        }
    }
}, 30000);

setTimeout(() => {
    require('http').createServer(async (req, res) => {
        res.setHeader('content-type', 'application/json');
        try {
            if (req.method === 'GET' && req.url === '/status') {
                const slots = bridgeSlotList().map((s) => {
                    const q = qrInfoBridge(s);
                    return {
                        slot: s,
                        connected: !!(connectedAdmins[s] && adminSocks[s]),
                        qr_fresh: q.fresh,
                        qr_age_min: q.age_min
                    };
                });
                return res.end(JSON.stringify({ slots }));
            }

            if (req.method === 'POST' && req.url === '/spawn') {
                const body = await bridgeReadBody(req);
                const name = String(body.name || '').trim().toLowerCase();
                if (!/^admin\d+$/.test(name)) return res.end(JSON.stringify({ error: 'Nama harus format adminN, contoh: admin4' }));
                if (adminSocks[name]) return res.end(JSON.stringify({ error: `${name} sudah berjalan` }));
                jalankanBotAdmin(name);
                const extras = bridgeReadJson(SPAWNED_FILE, []);
                if (!extras.includes(name)) { extras.push(name); try { fs.writeFileSync(SPAWNED_FILE, JSON.stringify(extras)); } catch {} }
                return res.end(JSON.stringify({ ok: true, message: `${name} dijalankan - scan QR-nya di dashboard` }));
            }

            if (req.method === 'POST' && req.url === '/reset') {
                const body = await bridgeReadBody(req);
                const name = String(body.slot || '').trim().toLowerCase();
                if (!/^admin\d+$/.test(name)) return res.end(JSON.stringify({ error: 'Slot harus format adminN' }));
                try {
                    if (adminSocks[name]) {
                        await adminSocks[name].end(undefined);
                        delete adminSocks[name];
                    }
                    connectedAdmins[name] = false;
                    const sesDir = config.stores.sessions(name, CFG.label);
                    if (fs.existsSync(sesDir)) fs.rmSync(sesDir, { recursive: true, force: true });
                    appendLogBridge({ event: 'reset-sesi', slot: name, by: 'dashboard' });
                    return res.end(JSON.stringify({ ok: true, message: `Sesi ${name} dihapus. Scan QR baru.` }));
                } catch (e) {
                    return res.end(JSON.stringify({ error: String(e.message || e) }));
                }
            }

            if (req.method === 'POST' && req.url === '/reset-all') {
                const reset = [];
                for (const s of ['admin1', 'admin2', 'admin3']) {
                    try {
                        if (adminSocks[s]) {
                            await adminSocks[s].end(undefined);
                            delete adminSocks[s];
                        }
                        connectedAdmins[s] = false;
                        const sesDir = config.stores.sessions(s, CFG.label);
                        if (fs.existsSync(sesDir)) fs.rmSync(sesDir, { recursive: true, force: true });
                        reset.push(s);
                    } catch (e) {
                        reset.push(s + '(err:' + e.message + ')');
                    }
                }
                appendLogBridge({ event: 'reset-all-sesi', slots: reset.join(','), by: 'dashboard' });
                return res.end(JSON.stringify({ ok: true, reset }));
            }

            if (req.method === 'GET' && req.url === '/bulk-status') {
                return res.end(JSON.stringify({ bulk: bridgeBulk }));
            }

            if (req.method === 'POST' && req.url === '/bulk-groups') {
                const body = await bridgeReadBody(req);
                if (bridgeBulk.busy) return res.end(JSON.stringify({ error: 'Blast grup masih berjalan. Tunggu selesai dulu.' }));
                const senderName = ['admin1', 'admin2'].find((n) => connectedAdmins[n] && adminSocks[n]);
                if (!senderName) return res.end(JSON.stringify({ error: 'Tidak ada pengirim grup (admin1/admin2) yang terhubung.' }));

                const text = String(body.text || '');
                const groups = await Promise.resolve(ambilDaftarGrup());
                if (!groups.length) return res.end(JSON.stringify({ error: 'Daftar grup kosong.' }));

                let konfigurasiPesan;
                if (body.imageBase64) {
                    const buf = Buffer.from(String(body.imageBase64).includes(',') ? body.imageBase64.split(',')[1] : body.imageBase64, 'base64');
                    if (buf.length < 1024) return res.end(JSON.stringify({ error: 'Gambar korup/terlalu kecil' }));
                    konfigurasiPesan = { image: buf, caption: text || undefined };
                } else {
                    if (!text.trim()) return res.end(JSON.stringify({ error: 'Teks kosong' }));
                    konfigurasiPesan = { text };
                }

                bridgeBulk.busy = true;
                bridgeBulk.total = groups.length;
                bridgeBulk.sent = 0;
                bridgeBulk.failed = 0;
                bridgeBulk.sender = senderName;

                const senderSock = adminSocks[senderName];
                (async () => {
                    for (let i = 0; i < groups.length; i++) {
                        const g = groups[i];
                        const jid = typeof g === 'string' ? g : (g.id || g.jid);
                        if (!jid) continue;
                        try {
                            await senderSock.sendMessage(jid, konfigurasiPesan);
                            bridgeBulk.sent += 1;
                            appendLogBridge({ event: 'blast-grup', to: jid, via: senderName });
                        } catch (e) {
                            bridgeBulk.failed += 1;
                            appendLogBridge({ event: 'blast-gagal', to: jid, error: String(e.message || e).slice(0, 100) });
                        }
                        await new Promise((r) => setTimeout(r, 12000));
                    }
                    bridgeBulk.busy = false;
                    appendLogBridge({ event: 'blast-selesai', sent: bridgeBulk.sent, failed: bridgeBulk.failed });
                })();
                return res.end(JSON.stringify({ ok: true, started: true, total_groups: groups.length, via: senderName, message: 'Blast mulai - pantau progres di sini' }));
            }

            if (req.method === 'GET' && req.url === '/menus') {
                return res.end(JSON.stringify({ overrides: bridgeReadJson(MENU_OVERRIDE_FILE, {}), bawaan: MENU_BAWAAN }));
            }

            if (req.method === 'POST' && req.url === '/menus') {
                const body = await bridgeReadBody(req);
                const o = body.overrides || {};
                for (const k of Object.keys(o)) {
                    if (!/^menu_(utama|[1-7][ab]?)$/.test(k)) delete o[k];
                }
                fs.writeFileSync(MENU_OVERRIDE_FILE, JSON.stringify(o, null, 1));
                return res.end(JSON.stringify({ ok: true, message: 'Teks menu disimpan - langsung aktif tanpa restart' }));
            }

            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not found' }));
        } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e.message || e) }));
        }
    }).listen(BRIDGE_PORT, '127.0.0.1', () => {
        console.log(`🌐 Bridge dashboard aktif di http://127.0.0.1:${BRIDGE_PORT}`);
    });
}, 20000);

function appendLogBridge(entry) {
    try { fs.appendFileSync(CFG.files.bridgeLog, JSON.stringify({ ts: Date.now(), ...entry }) + '\n'); } catch {}
}
