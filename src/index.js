/**
 * NexBot - src/index.js
 * Unified Bridge (port 5610). Meng-agregasi semua modul:
 *   GET  /            -> ringkasan status tiap bridge
 *   GET  /status      -> sama
 *   /cs/*    -> diteruskan ke AI-CS   (5591)
 *   /admin/* -> diteruskan ke AI-ADMIN (5592)
 *   /blast/* -> diteruskan ke BLASTER  (5588)
 */
const http = require('http');
const config = require('./config');
const { version, name } = require('../package.json');

const ROUTES = [
  { prefix: '/cs', port: config.cs.port, probePath: '/status' },
  { prefix: '/admin', port: config.admin.port, probePath: '/status' },
  { prefix: '/blast', port: config.blast.port, probePath: '/api/session' },
];

function proxy(req, res, targetPort, targetPath) {
  const headers = { ...req.headers, host: `127.0.0.1:${targetPort}`, connection: 'close' };
  const upstream = http.request(
    { hostname: '127.0.0.1', port: targetPort, path: targetPath || '/', method: req.method, headers },
    (pr) => {
      res.writeHead(pr.statusCode || 502, pr.headers);
      pr.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: `Bridge (port ${targetPort}) tidak aktif.` }));
  });
  req.pipe(upstream);
}

async function aggregateStatus() {
  const bridges = {};
  for (const r of ROUTES) bridges[r.prefix.slice(1)] = await probe(r.port, r.probePath);
  return bridges;
}

function probe(port, path) {
  return new Promise((resolve) => {
    const r = http.get({ hostname: '127.0.0.1', port, path: path || '/', timeout: 2500 }, (res) => {
      res.resume();
      resolve({ up: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode, port });
    });
    r.on('timeout', () => { r.destroy(); resolve({ up: false, port }); });
    r.on('error', () => resolve({ up: false, port }));
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const pathname = url.split('?')[0];
  const qs = url.includes('?') ? url.slice(url.indexOf('?')) : '';

  if (req.method === 'GET' && (pathname === '/' || pathname === '/status')) {
    res.setHeader('content-type', 'application/json');
    const bridges = await aggregateStatus();
    return res.end(JSON.stringify({ name, version, bridges, time: new Date().toISOString() }));
  }

  const route = ROUTES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  if (!route) {
    res.setHeader('content-type', 'application/json');
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: 'Endpoint tidak ditemukan', routes: ROUTES.map((r) => r.prefix) }));
  }
  const targetPath = (pathname.slice(route.prefix.length) || '/') + qs;
  proxy(req, res, route.port, targetPath);
});

server.listen(config.bridge.port, config.bridge.host, () => {
  console.log('==============================================');
  console.log('  NexBot - Platform Bot WhatsApp (Baileys)');
  console.log(`  Unified Bridge : http://${config.bridge.host}:${config.bridge.port}`);
  console.log('  Routes: /cs -> AI-CS | /admin -> AI-ADMIN | /blast -> BLASTER');
  console.log('  Lihat ecosystem.config.js untuk mode PM2 multi-proses.');
  console.log('==============================================');
});

process.on('uncaughtException', (e) => console.error('[NexBot-CORE] uncaught:', e.message));