/**
 * NexBot - src/index.js
 * Entry point terpusat. Membuka satu Unified Bridge di port 5610
 * yang mem-route ke modul-modul: cs, admin, blast.
 *
 * Mode:
 *   - Biasa: mengumpulkan endpoint dari tiap modul (aggregate)
 *   - Mode terpisah: tiap modul buka bridge sendiri (legacy)
 */
const { createBridge } = require('./core/bridge');
const config = require('./config');

async function main() {
  const bridge = createBridge({ port: config.bridge.port, host: config.bridge.host });

  // Beban modul — bila pakai mode terpisah (masing-masing bot jalan sendiri di PM2),
  // modul tersebut akan buka bridge-nya sendiri & index ini hanya jadi agregator.
  // Untuk kesederhanaan + stabilitas produksi, default = setiap modul berjalan
  // sebagai proses PM2 terpisah (AI-CS, AI-ADMIN, BLASTER) via ecosystem.config.js.
  // Unified Bridge di sini dapat dipakai bila menjalankan semua dalam satu proses.

  console.log('==============================================');
  console.log('  NexBot - Platform Bot WhatsApp (Baileys)');
  console.log(`  Unified Bridge : http://${config.bridge.host}:${config.bridge.port}`);
  console.log('  Modul: AI-CS, AI-ADMIN, BLASTER');
  console.log('  Lihat ecosystem.config.js untuk mode PM2 multi-proses.');
  console.log('==============================================');
}

main().catch((e) => {
  console.error('NexBot gagal start:', e);
  process.exit(1);
});
