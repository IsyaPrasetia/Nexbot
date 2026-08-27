/**
 * NexBot / core / bridge.js
 * Server HTTP terpadu untuk semua modul NexBot.
 * Satu port, banyak modul — routing berdasarkan prefix path:
 *   /cs/...   -> AI-CS
 *   /admin/.. -> AI-ADMIN
 *   /blast/.. -> BLASTER
 * Setiap modul mendaftarkan handler via router.
 */
const http = require('http');

function createBridge({ port = 5610, host = '127.0.0.1', logger = console }) {
  // router[prefix] = { GET: {path: handler}, POST: {...} }
  const handlers = {};

  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('X-Powered-By', 'NexBot');
    try {
      const url = req.url || '/';
      const pathname = url.split('?')[0];
      const method = req.method || 'GET';

      // cari prefix terpanjang yang cocok
      let match = null;
      let matchedHandler = null;
      let rest = url;

      for (const prefix of Object.keys(handlers)) {
        if (pathname === prefix || pathname.startsWith(prefix + '/')) {
          // pilih yang terpanjang
          if (prefix && (!match || prefix.length > match.length)) {
            match = prefix;
            rest = pathname.slice(prefix.length) || '/';
            const rt = handlers[prefix];
            const fn = rt?.[method]?.[rest];
            if (fn) matchedHandler = fn;
          }
        }
      }

      // fallback: root '/' sebagai handler
      if (!matchedHandler && match) {
        const rt = handlers[match];
        const fn = rt?.[method]?.[rest];
        if (fn) matchedHandler = fn;
      }

      if (!matchedHandler) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Endpoint tidak ditemukan' }));
      }

      // body reader untuk POST
      let body = {};
      if (method === 'POST') {
        body = await readBody(req);
      }

      const result = await matchedHandler({ body, query: url.includes('?') ? Object.fromEntries(new URL(searchUrl(url)) ) : {}, req, res });
      if (!res.writableEnded) {
        res.end(JSON.stringify(result === undefined ? { ok: true } : result));
      }
    } catch (e) {
      res.statusCode = e.statusCode || 500;
      if (!res.writableEnded) res.end(JSON.stringify({ error: String(e.message || e) }));
      logger.error(`[bridge] error: ${e.message}`);
    }
  });

  server.listen(port, host, () => {
    console.log(`[NexBot] 🌐 Bridge aktif di http://${host}:${port}`);
  });

  return {
    /**
     * Daftarkan handler untuk suatu prefix/route.
     * @param {string} prefix  e.g. '/cs'
     * @param {object} routes  { GET: { '/status': fn }, POST: { '/reset': fn } }
     */
    register(prefix, routes) {
      if (!handlers[prefix]) handlers[prefix] = {};
      for (const method of Object.keys(routes)) {
        if (!handlers[prefix][method]) handlers[prefix][method] = {};
        for (const p of Object.keys(routes[method])) {
          handlers[prefix][method][p] = routes[method][p];
        }
      }
    },
    /** List semua route terdaftar (untuk debug). */
    routes() { return handlers; },
    server,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 12 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function searchUrl(url) {
  const i = url.indexOf('?');
  return i >= 0 ? url.slice(i + 1) : '';
}

module.exports = { createBridge };
