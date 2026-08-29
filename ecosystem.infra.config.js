/**
 * NexBot - ecosystem.infra.config.js
 * PM2 infra: tunnel Cloudflare + health-monitor (terpisah dari modul bot).
 *
 * Proses:
 *   name          : script
 *   ------------- : --------------------------------
 *   TUNNEL        : scripts/tunnel-cf.js   (nama "TUNNEL" supaya ketangkap dashboard)
 *   health-monitor: scripts/health-monitor.js
 *
 * Untuk menjalankan:
 *   1. Salin .env.example -> .env lalu isi CLOUDFLARED_TUNNEL_TOKEN (token tunnel Anda).
 *   2. pm2 start ecosystem.infra.config.js
 *   3. pm2 save
 *
 * TOKEN TUNNEL ADALAH KREDENSIAL — jangan pernah di-commit ke repo.
 */
module.exports = {
  apps: [
    {
      name: 'TUNNEL',
      script: __dirname + '/scripts/tunnel-cf.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      // Nilai token dibaca dari env var / .env oleh scripts/tunnel-cf.js.
      // Jangan isi token di sini — pakai .env (gitignored).
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'health-monitor',
      script: __dirname + '/scripts/health-monitor.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
