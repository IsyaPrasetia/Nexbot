/**
 * tunnel-cf.js (NexBot)
 * Wrapper untuk proses tunnel Cloudflare (cloudflared) via PM2.
 *
 * Dipakai agar tunnel bisa dikelola lewat dashboard (restart, info) dengan nama
 * app PM2 = "TUNNEL", sekaligus token tidak pernah di-commit ke repo.
 *
 * Token diambil dari (prioritas):
 *   1. Env var CLOUDFLARED_TUNNEL_TOKEN
 *   2. File .env di root repo (satu baris: CLOUDFLARED_TUNNEL_TOKEN=xxx)
 *
 * Token itu KREDENSIAL — jangan di-commit. Salin .env.example -> .env lalu isi.
 *
 * Jalankan via PM2:
 *   pm2 start ecosystem.infra.config.js
 *   pm2 save
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Lokasi biner cloudflared (sesuaikan dengan instalasi Anda).
const CLOUDFLARED_BIN =
  process.env.CLOUDFLARED_BIN || 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';

function loadToken() {
  if (process.env.CLOUDFLARED_TUNNEL_TOKEN) return process.env.CLOUDFLARED_TUNNEL_TOKEN;
  const envFile = path.join(__dirname, '..', '.env');
  try {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*CLOUDFLARED_TUNNEL_TOKEN\s*=\s*(.+?)\s*$/);
      if (m && m[1]) return m[1];
    }
  } catch (e) {
    /* belum ada .env */
  }
  return null;
}

const token = loadToken();
if (!token) {
  console.error('[TUNNEL] CLOUDFLARED_TUNNEL_TOKEN kosong. Salin .env.example -> .env dan isi token tunnel Anda.');
  process.exit(1);
}

console.log('[TUNNEL] Menjalankan cloudflared tunnel ...');
const proc = spawn(
  CLOUDFLARED_BIN,
  ['tunnel', '--no-autoupdate', 'run', '--token', token],
  { stdio: 'inherit', windowsHide: true }
);

proc.on('error', (err) => {
  console.error('[TUNNEL] Gagal spawn cloudflared: ' + err.message);
  process.exit(1);
});
proc.on('exit', (code) => {
  console.error('[TUNNEL] cloudflared keluar dengan code=' + code);
  process.exit(code || 0);
});
