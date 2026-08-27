/**
 * NexBot / core / session.js
 * Manajemen koneksi WhatsApp (Baileys) untuk satu slot.
 * Menyediakan: connect, QR, reconnect otomatis, status, reset.
 */
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const QRCodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

/**
 * Membuat koneksi WhatsApp baru untuk satu slot.
 * @param {object} opts
 *   - slot: nama slot (mis 'admin1', 's1')
 *   - label: label modul (mis 'cs', 'admin', 'blast')
 *   - stateDir: direktori penyimpanan session
 *   - qrFile: path file PNG QR (opsional; kalau tidak mau simpan, kasih null)
 *   - onQr: callback(qrRaw, dataUrl)
 *   - onOpen: callback(user)
 *   - onClose: callback(reason, isLogout)
 *   - onUpsert: callback(messages)  -> saat ada pesan masuk
 *   - browser: array browser label
 *   - logger: pino instance (default silent-ish warn)
 * @returns {Promise<{sock, state}>}
 */
async function connectSlot(opts) {
  const {
    slot, label = 'wa', stateDir, qrFile = null,
    onQr = () => {}, onOpen = () => {}, onClose = () => {},
    onUpsert = null,
    browser = ['NexBot', 'Chrome', '1.0.0'],
  } = opts;

  const logger = opts.logger || pino({ level: 'warn' });
  const { state, saveCreds } = await useMultiFileAuthState(stateDir);

  const sock = makeWASocket({
    version: [2, 3000, 1015901307],
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser,
    generateHighQualityLinkPreview: false,
    markOnlineOnSend: false,
    syncFullHistory: false,
    logger,
    printQRInTerminal: true,
    qrTimeout: 60000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      QRCodeTerminal.generate(qr, { small: false });
      // cache data URL untuk dashboard
      QRCode.toDataURL(qr, { width: 300 }, (err, url) => {
        if (err) {
          onQr(qr, null);
        } else {
          onQr(qr, url);
        }
      });
      if (qrFile && qrFile !== null) {
        try {
          QRCode.toFile(qrFile, qr, { type: 'png', width: 400 }, () => {});
        } catch (e) {}
      }
    }

    if (connection === 'open') {
      const user = sock.user || null;
      onOpen(user);
      console.log(`[${label}:${slot}] ✅ Tersambung: ${user?.id ? user.id.split(':')[0] : '?'}`);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const isLogout = reason === DisconnectReason.loggedOut;
      const isRate = reason === 405;
      onClose({ reason, isLogout, isRate });
      console.log(`[${label}:${slot}] ⚠️ Koneksi tertutup. reason=${reason} logout=${isLogout}`);
    }
  });

  if (onUpsert) {
    sock.ev.on('messages.upsert', (m) => onUpsert(m, sock));
  }

  return { sock, state };
}

/**
 * Hapus direktori session (reset total).
 */
function deleteSessionDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Arsipkan session lama lalu buat baru (untuk kasus loggedOut).
 * @returns nama arsip baru
 */
function archiveSessionDir(dir, archiveBase) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const arch = path.join(archiveBase, `auth_old_${stamp}`);
  if (fs.existsSync(dir)) fs.renameSync(dir, arch);
  fs.mkdirSync(dir, { recursive: true });
  return arch;
}

module.exports = { connectSlot, deleteSessionDir, archiveSessionDir, DisconnectReason };
