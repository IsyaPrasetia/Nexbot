/**
 * health-monitor.js (NexBot)
 * Monitor kesehatan bot PRODUKSI dengan logika "jangan restart saat operasi berjalan".
 *
 * Tujuan utama: mencegah daemon PM2 OOM (mis. server RAM kecil) TANPA memotong
 * blast/broadcast yang sedang berjalan.
 *
 * Logika per interval:
 *   1. Baca memori tiap app produksi (via `pm2 jlist`).
 *   2. Deteksi apakah sedang ada OPERASI BERJALAN (blast/broadcast):
 *        - BLASTER: jobs.json berisi job berstatus `running` (atau queued/paused + pending>0)
 *        - CS      : blast-flag.json baru disentuh (< 2 menit)
 *   3. Jika memori app melebihi SOFT limit:
 *        - sedang operasi  -> TIDAK restart; catat "tunda" (biarkan operasi selesai dl).
 *        - tidak operasi   -> restart app tsb (satu per satu, pelan) supaya memori turun.
 *   4. HARD limit (jaring terakhir): tetap dibiarkan ke PM2 max_memory_restart —
 *      hanya sebagai pengaman darurat, nilainya sengaja tinggi.
 *
 * Sesuaikan path di blok CONFIG dengan lokasi instalasi Anda.
 *
 * Jalankan sebagai app PM2:
 *   pm2 start ecosystem.infra.config.js   (atau) pm2 start scripts/health-monitor.js --name health-monitor
 *   pm2 save
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// CONFIG — sesuaikan dengan lingkungan produksi Anda
// ---------------------------------------------------------------------------
const INTERVAL_MS = 45000;              // cek tiap 45 detik
const APPS = ['AI-CS', 'AI-ADMIN', 'BLASTER', 'DASHBOARD'];

// Limit memori (bytes). SOFT = restart cerdas oleh monitor. HARD = biarkan PM2.
const LIMITS = {
  'AI-CS':     { soft: 500 * 1024 * 1024,  hard: 900 * 1024 * 1024 },
  'AI-ADMIN':  { soft: 400 * 1024 * 1024,  hard: 700 * 1024 * 1024 },
  'BLASTER':   { soft: 300 * 1024 * 1024,  hard: 700 * 1024 * 1024 },
  'DASHBOARD': { soft: 200 * 1024 * 1024,  hard: 400 * 1024 * 1024 },
};

// Lokasi file penanda jalur proyek produksi (sesuaikan dengan instalasi Anda).
const BLAST_JOBS = 'D:\\wa-blast\\jobs.json';
const CS_FLAG = 'D:\\bot-multi-admin\\blast-flag.json';

// Sinyal broadcast CS (ditulis oleh cs.js saat bulkkirim / bulk-groups berjalan).
// Dipakai agar monitor MENUNDA restart saat CS sedang broadcast sendiri.
const CS_MONITOR = 'D:\\bot-multi-admin\\.blast-monitor.json';
const CS_FLAG_FRESH_MS = 2 * 60 * 1000; // flag dianggap aktif jika mtime < 2 menit
// ---------------------------------------------------------------------------

let flag = false;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getApps() {
  try {
    const raw = execSync('pm2 jlist', { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    return JSON.parse(raw);
  } catch (e) {
    log('Gagal ambil pm2 jlist: ' + e.message);
    return null;
  }
}

function blastActive() {
  // 1) BLASTER jobs.json
  try {
    if (fs.existsSync(BLAST_JOBS)) {
      const job = JSON.parse(fs.readFileSync(BLAST_JOBS, 'utf8'));
      if (job && job.status === 'running') return true;
      // queued / paused dengan sisa target => masih ada kerja
      if (job && ['queued', 'paused'].includes(job.status)) {
        const pending = (job.targets || []).filter((t) => t.status !== 'sent' && t.status !== 'failed').length;
        if (pending > 0) return true;
      }
    }
  } catch (e) { /* abaikan */ }

  // 2) Sinyal broadcast CS (.blast-monitor.json freshly-touched)
  try {
    if (fs.existsSync(CS_MONITOR)) {
      const m = fs.statSync(CS_MONITOR).mtimeMs;
      if (Date.now() - m < CS_FLAG_FRESH_MS) return true;
    }
  } catch (e) { /* abaikan */ }

  // 3) CS flag blast-flag.json freshly-touched
  try {
    if (fs.existsSync(CS_FLAG)) {
      const m = fs.statSync(CS_FLAG).mtimeMs;
      if (Date.now() - m < CS_FLAG_FRESH_MS) return true;
    }
  } catch (e) { /* abaikan */ }

  return false;
}

async function tick() {
  const online = getApps();
  if (!online) return;
  const byName = {};
  for (const a of online) byName[a.name] = a;

  const mem = os.freemem() / os.totalmem();
  log(`RAM bebas ${(mem * 100).toFixed(1)}% | sedang-operasi=${blastActive()}`);

  for (const name of APPS) {
    const app = byName[name];
    if (!app) { log(`[${name}] tidak terdaftar di PM2 (skip)`); continue; }
    if (app.pm2_env && app.pm2_env.status !== 'online') {
      log(`[${name}] status=${app.pm2_env.status} (skip cek memori)`);
      continue;
    }
    const used = app.monit && app.monit.memory ? app.monit.memory : 0;
    const lim = LIMITS[name];
    if (!lim) continue;

    if (used > lim.soft) {
      if (blastActive()) {
        log(`[${name}] memori ${(used / 1048576).toFixed(0)}MB > SOFT — TUNDA restart (sedang operasi/blast)`);
        continue;
      }
      log(`[${name}] memori ${(used / 1048576).toFixed(0)}MB > SOFT (${(lim.soft / 1048576).toFixed(0)}MB) — RESTART cerdas`);
      try {
        execSync(`pm2 restart ${name}`, { windowsHide: true, timeout: 20000, stdio: 'ignore' });
      } catch (e) {
        log(`[${name}] GAGAL restart: ${e.message}`);
      }
    }
  }
}

function start() {
  if (flag) return;
  flag = true;
  log('Health-monitor dimulai (interval ' + INTERVAL_MS / 1000 + 's)');
  tick();
  setInterval(() => { tick().catch((e) => log('tick error: ' + e.message)); }, INTERVAL_MS);
}

start();
