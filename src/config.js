/**
 * WACore - Konfigurasi terpusat.
 * Semua modul (cs, admin, blast) membaca konfigurasi dari sini.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

// Auto-buat struktur direktori data
function ensureDirs() {
  const dirs = [
    DATA_DIR, path.join(DATA_DIR, 'sessions'), path.join(DATA_DIR, 'sessions', 'cs'),
    path.join(DATA_DIR, 'sessions', 'admin'), path.join(DATA_DIR, 'sessions', 'blast'),
    path.join(DATA_DIR, 'qr'), path.join(DATA_DIR, 'cs'), path.join(DATA_DIR, 'admin'),
    path.join(DATA_DIR, 'blast', 'uploads'),
  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}
ensureDirs();

module.exports = {
  // ===== Root / data =====
  ROOT,
  DATA_DIR,
  dir(...parts) { return path.join(DATA_DIR, ...parts); },
  moduleDir(moduleName, ...parts) { return path.join(ROOT, 'src', 'modules', moduleName, ...parts); },

  // ===== Persistent storage (cukup di WACore/data) =====
  stores: {
    sessions: (slot, label) => path.join(DATA_DIR, 'sessions', label || 'wa', `session_${slot}`),
    qr: (slot, label) => path.join(DATA_DIR, 'qr', (label ? label + '_' : '') + 'qr_' + slot + '.png'),
  },

  // ===== Unified bridge (satu port untuk semua modul) =====
  bridge: {
    port: 5610,
    host: '127.0.0.1',
  },

  // ===== Modul: AI-CS (auto-reply + broadcast) =====
  cs: {
    label: 'cs',
    slots: ['admin1', 'admin2', 'admin3'],
    primarySlot: 'admin1',
    port: 5591, // legacy bridge (tetap untuk kompatibilitas dashboard lama)
    bridgeEnabled: true,
    // Grup
    GRUP_ADMIN_PSI: '...@g.us',
    GRUP_ADMIN_ARTERIA: '...@g.us',
    GRUP_PROMO: '...@g.us',
    // Timing
    TIMEOUT_BOT: 30 * 60 * 1000,        // 30 menit HUMAN->BOT
    DELAY_MIN: 5000,
    DELAY_MAX: 20000,
    TIMEOUT_MENU_SAPAAN: 15 * 60 * 1000, // 15 menit kooldown sapaan
    broadcastDelayMs: 12000,            // delay dashboard blast
    // Files (bisa absolute / relatif ke data)
    files: {
      grupFile: path.join(DATA_DIR, 'cs', 'grup_webinar.json'),
      menuOverrideFile: path.join(DATA_DIR, 'cs', 'menu_texts.json'),
      spawnedFile: path.join(DATA_DIR, 'cs', 'spawned_admins.json'),
      botDatabase: path.join(DATA_DIR, 'cs', 'bot_database.db'),
      trackingMenu: path.join(DATA_DIR, 'cs', 'tracking_menu.db'),
      blastFlag: path.join(DATA_DIR, 'cs', 'blast-flag.json'),
      bridgeLog: path.join(DATA_DIR, 'cs', 'cs-bridge-log.jsonl'),
    },
  },

  // ===== Modul: AI-ADMIN (crawler + PDF + AI + laporan harian) =====
  admin: {
    label: 'admin',
    slots: ['admin1', 'admin2', 'admin3'], // multi-slot: pilih nomor aktif via dashboard
    primarySlot: 'admin1',
    port: 5592, // legacy
    bridgeEnabled: true,
    // Reno
    URL_PSI: 'https://pondoksehatindonesia.org/',
    URL_ARTERIA: 'https://www.arteriamedpro.com/',
    GRUP_PSI: '...@g.us',
    GRUP_ARTERIA: '...@g.us',
    INTERVAL_CEK: 60 * 60 * 1000,   // 1 jam
    JAM_KIRIM_HARIAN: 8,            // 08:00 WIB
    NAMA_MODEL_AI: 'qwen2.5:1.5b',
    OLLAMA_URL: 'http://127.0.0.1:11434/api/generate',
    // Files
    files: {
      database: path.join(DATA_DIR, 'admin', 'database.json'),
      archive: path.join(DATA_DIR, 'admin', 'archive.json'),
      logReminder: path.join(DATA_DIR, 'admin', 'log-reminder.json'),
      cachePsi: path.join(DATA_DIR, 'admin', 'cache-psi.txt'),
      cacheArteria: path.join(DATA_DIR, 'admin', 'cache-arteria.txt'),
      daftarSpreadsheet: path.join(DATA_DIR, 'admin', 'daftar_spreadsheet.json'),
      credentials: path.join(DATA_DIR, 'admin', 'credentials.json'),
      materi: path.join(DATA_DIR, 'admin', 'materi.json'),
      session: path.join(DATA_DIR, 'sessions', 'admin', 'session_admin1'),
      qr: path.join(DATA_DIR, 'qr', 'admin_qr_admin1.png'),
      currentSlot: path.join(DATA_DIR, 'admin', 'current-slot.json'),
    },
    // Fungsi resolusi slot aktif (multi-slot)
    activeSlot() {
      try {
        const f = path.join(DATA_DIR, 'admin', 'current-slot.json');
        const s = JSON.parse(require('fs').readFileSync(f, 'utf8'));
        if (s && s.slot) return String(s.slot);
      } catch {}
      return 'admin1';
    },
    slotSession(slot) { return path.join(DATA_DIR, 'sessions', 'admin', `session_${slot}`); },
    slotQr(slot) { return path.join(DATA_DIR, 'qr', `admin_qr_${slot}.png`); },
  },

  // ===== Modul: BLASTER (blast massal) =====
  blast: {
    label: 'blast',
    slots: ['s1', 's2', 's3'],
    port: 5588, // legacy
    bridgeEnabled: true,
    MIN_DELAY_S: 60,
    BATCH_SIZE: 50,
    BATCH_REST_S: 300,
    MAX_CONSEC_FAILS: 25,
    MAX_TEXT_LEN: 60000,
    // Files
    files: {
      uploads: path.join(DATA_DIR, 'blast', 'uploads'),
      jobs: path.join(DATA_DIR, 'blast', 'jobs.json'),
      log: path.join(DATA_DIR, 'blast', 'blast-log.jsonl'),
      draft: path.join(DATA_DIR, 'blast', 'draft.json'),
      batches: path.join(DATA_DIR, 'blast', 'batches.json'),
      handoverFlag: path.join(DATA_DIR, 'cs', 'blast-flag.json'),
    },
  },
};
