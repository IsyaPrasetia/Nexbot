/**
 * NexBot - ecosystem.config.js
 * PM2 multi-process: tiap modul jalan sendiri (crash isolated).
 *
 * Proses:
 *   name    : script                              port
 *   ------  : -----------------------------------  ----
 *   NexBot-CORE : src/core/ (unified bridge)      5610
 *   AI-CS   : src/modules/cs/index.js             5591 (legacy bridge)
 *   AI-ADMIN: src/modules/admin/index.js          5592 (legacy bridge)
 *   BLASTER : src/modules/blast/index.js          5588 (legacy bridge)
 *   DASHBOARD : dashboard/server/index.js         5577
 *
 * Untuk deploy:  pm2 startDeploy  /  pm2 start ecosystem.config.js
 */
module.exports = {
  apps: [
    {
      name: 'NexBot-CORE',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'AI-CS',
      script: 'src/modules/cs/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
    },
    {
      name: 'AI-ADMIN',
      script: 'src/modules/admin/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
    },
    {
      name: 'BLASTER',
      script: 'src/modules/blast/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
    },
    {
      name: 'DASHBOARD',
      script: 'dashboard/server/index.js',
      cwd: __dirname + '/dashboard',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: { PORT: 5577 },
    },
  ],
};
