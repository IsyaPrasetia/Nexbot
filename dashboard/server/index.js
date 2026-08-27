const express = require('express');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const PORT = process.env.PORT || 5577;
const HOST = '127.0.0.1';
const SELF_NAME = 'DASHBOARD';
const ALLOWED_ACTIONS = ['start', 'stop', 'restart'];
const LOG_TAIL_BYTES = 256 * 1024;
const lastSizes = new Map();

const DATASETS = [
  {
    id: 'grup-webinar',
    label: 'Grup Webinar Terdaftar',
    desc: 'Grup WhatsApp penerima broadcast (!bulkkirim) di AI-CS',
    file: 'D:\\Nexbot\\data\\cs\\grup_webinar.json'
  },
  {
    id: 'berkas-terpantau',
    label: 'Riwayat Berkas PSI & Arteria',
    desc: 'Status pemrosesan PDF dan apakah sudah masuk website',
    file: 'D:\\Nexbot\\data\\admin\\database.json'
  },
  {
    id: 'statistik-menu',
    label: 'Statistik Menu Bot CS',
    desc: 'Rekap pilihan menu peserta (tracking_menu.db AI-CS)',
    file: 'D:\\Nexbot\\data\\cs\\tracking_menu.db',
    ndjson: true
  }
];

function runPm2(args) {
  const cmd = 'pm2 ' + args
    .map((a) => (/[\s"]/.test(String(a)) ? '"' + String(a).replace(/"/g, '') + '"' : String(a)))
    .join(' ');
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim()));
      resolve(stdout);
    });
  });
}

let prevCpus = os.cpus();

function cpuPercent() {
  const cur = os.cpus();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < cur.length; i++) {
    const c = cur[i].times;
    const p = prevCpus[i] ? prevCpus[i].times : c;
    total += (c.user - p.user) + (c.nice - p.nice) + (c.sys - p.sys) + (c.idle - p.idle) + (c.irq - p.irq);
    idle += c.idle - p.idle;
  }
  prevCpus = cur;
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

async function getRawProcesses() {
  const out = await runPm2(['jlist']);
  const start = out.indexOf('[');
  if (start === -1) throw new Error('Output pm2 jlist tidak valid');
  return JSON.parse(out.slice(start));
}

function summarize(list) {
  const now = Date.now();
  return list.map((p) => {
    const env = p.pm2_env || {};
    const status = env.status || 'unknown';
    return {
      pm_id: p.pm_id,
      name: p.name,
      status,
      pid: status === 'online' ? p.pid : null,
      cpu: p.monit ? p.monit.cpu : 0,
      memory: p.monit ? p.monit.memory : 0,
      restarts: env.restart_time || 0,
      uptime_ms: status === 'online' && env.pm_uptime ? now - env.pm_uptime : 0,
      started_at: env.pm_uptime || env.created_at || null,
      script: env.pm_exec_path || null,
      cwd: env.pm_cwd || null,
      mode: String(env.exec_mode || 'fork').replace('_mode', ''),
      autorestart: env.autorestart !== false,
      watch: !!env.watch,
      out_log: env.pm_out_log_path || null,
      err_log: env.pm_err_log_path || null
    };
  });
}

function findProc(summaries, pmId) {
  return summaries.find((p) => String(p.pm_id) === String(pmId));
}

async function tailFile(filePath, maxBytes) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return null;
    const size = Math.min(stat.size, maxBytes);
    const fh = await fsp.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, stat.size - size);
      return { text: buf.toString('utf8'), truncated: stat.size > maxBytes, size: stat.size };
    } finally {
      await fh.close();
    }
  } catch (e) {
    if (e.code === 'ENOENT') return { text: '', truncated: false, size: 0 };
    throw e;
  }
}

const app = express();

app.use('/api/blast', async (req, res) => {
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Belum login' });
  const targetPath = '/api' + (req.url.replace(/^\/api\/blast/, '') || '/');
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: 5588,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:5588' }
    },
    (pr) => {
      res.writeHead(pr.statusCode || 502, pr.headers);
      pr.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.status(503).json({ error: 'Proses BLASTER tidak aktif. Jalankan: pm2 start BLASTER' });
  });
  req.pipe(upstream);
});

app.use('/api/csbridge', async (req, res) => {
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Belum login' });
  const targetPath = req.url || '/';
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: 5591,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:5591' }
    },
    (pr) => {
      res.writeHead(pr.statusCode || 502, pr.headers);
      pr.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.status(503).json({ error: 'Bridge AI-CS belum aktif — jalankan pm2 restart AI-CS untuk mengaktifkannya.' });
  });
  req.pipe(upstream);
});

app.use('/api/adminbridge', async (req, res) => {
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Belum login' });
  const targetPath = req.url || '/';
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: 5592,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:5592' }
    },
    (pr) => {
      res.writeHead(pr.statusCode || 502, pr.headers);
      pr.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.status(503).json({ error: 'Bridge AI-ADMIN belum aktif — jalankan pm2 restart AI-ADMIN untuk mengaktifkannya.' });
  });
  req.pipe(upstream);
});

app.use(express.json());

app.use('/api', async (req, res, next) => {
  if (req.path === '/login') return next();
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Belum login' });
  req.dashboardUser = user;
  next();
});

app.post('/api/login', async (req, res) => {
  const body = req.body || {};
  const userId = String(body.user || body.id || '').trim();
  const pass = String(body.pass || body.password || '');
  const ip = clientIp(req);

  const fails = await loadFails();
  const now = Date.now();
  const rec = fails[ip] || { count: 0, strikes: 0, until: 0 };

  if (rec.until > now) {
    const wait = fmtDur(rec.until - now);
    await writeLoginLog(ip, userId || '(kosong)', false, 'diblokir sementara');
    return res.status(429).json({ error: `Terlalu banyak percobaan gagal dari IP ini. Coba lagi dalam ${wait}.` });
  }

  let ok = false;
  try {
    const users = JSON.parse(await fsp.readFile(USERS_FILE, 'utf8'));
    const u = (Array.isArray(users) ? users : []).find((x) => String(x.id).toLowerCase() === userId.toLowerCase());
    ok = !!u && verifyPassword(pass, u.pass);
  } catch {}

  if (!ok) {
    rec.count += 1;
    let lockMsg = '';
    if (rec.count >= FAIL_LIMIT) {
      rec.strikes = (rec.strikes || 0) + 1;
      const ms = 5 * 60 * 1000 * Math.pow(5, rec.strikes - 1);
      rec.until = Date.now() + ms;
      rec.count = 0;
      lockMsg = fmtDur(ms);
    }
    fails[ip] = rec;
    for (const k of Object.keys(fails)) {
      const r = fails[k];
      if ((!r.count || r.count <= 0) && (!r.until || r.until < now)) delete fails[k];
    }
    await saveFails();
    await writeLoginLog(ip, userId || '(kosong)', false, lockMsg ? `kepung ${lockMsg}` : undefined);
    return res.status(lockMsg ? 429 : 401).json({
      error: lockMsg
        ? `${FAIL_LIMIT}x salah berturut-turut. Login dikunci sementara ${lockMsg}.`
        : 'ID atau password salah'
    });
  }

  delete fails[ip];
  await saveFails();
  await writeLoginLog(ip, userId.toUpperCase(), true);

  const token = crypto.randomBytes(32).toString('hex');
  const s = await loadSessions();
  s.boot_uptime_ms = os.uptime() * 1000;
  s.sessions[token] = { user: userId.toUpperCase(), exp: Date.now() + SESSION_TTL_MS };
  for (const k of Object.keys(s.sessions)) if (s.sessions[k].exp < Date.now()) delete s.sessions[k];
  await saveSessions();
  res.setHeader('Set-Cookie', `dash_session=${token}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; SameSite=Lax`);
  res.json({ ok: true, user: userId.toUpperCase(), message: 'Login berhasil' });
});

app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: req.dashboardUser });
});

app.post('/api/logout', async (req, res) => {
  const token = extractSessionToken(req);
  if (token) {
    const s = await loadSessions();
    delete s.sessions[token];
    await saveSessions();
  }
  res.setHeader('Set-Cookie', 'dash_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true, message: 'Logout berhasil' });
});

app.post('/api/logout-all', async (req, res) => {
  const s = await loadSessions();
  const count = Object.keys(s.sessions).length;
  s.sessions = {};
  await saveSessions();
  res.setHeader('Set-Cookie', 'dash_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true, message: `${count} session dihapus dari semua device` });
});

app.get('/api/login-log', async (req, res) => {
  try {
    const text = await fsp.readFile(LOGIN_LOG_FILE, 'utf8').catch(() => '');
    const lines = text.split('\n').filter((l) => l.trim()).slice(-300).reverse();
    const entries = [];
    for (const l of lines) {
      try { entries.push(JSON.parse(l)); } catch {}
    }
    res.json({ entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const raw = await getRawProcesses();
    const free = os.freemem();
    const total = os.totalmem();
    res.json({
      processes: summarize(raw),
      system: {
        cpu_percent: cpuPercent(),
        mem_used: total - free,
        mem_total: total,
        mem_free: free,
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        node_version: process.version,
        os_uptime_s: Math.round(os.uptime()),
        cpu_model: os.cpus()[0] ? os.cpus()[0].model.trim() : '-',
        cpu_cores: os.cpus().length
      },
      locked: LOCKED,
      timestamp: Date.now()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/processes', async (req, res) => {
  if (LOCKED) return res.status(423).json({ error: 'Dashboard TERKUNCI — buka kunci dulu untuk menambah bot.' });
  const { name, script, cwd, autorestart = true, watch = false } = req.body || {};
  const trimmedName = String(name || '').trim();
  const scriptPath = String(script || '').trim().replace(/^"|"$/g, '');
  const cwdPath = String(cwd || '').trim().replace(/^"|"$/g, '');

  if (!/^[\w.\- ]{1,40}$/.test(trimmedName)) {
    return res.status(400).json({ error: 'Nama proses wajib diisi (1-40 karakter, huruf/angka/spasi/tanda - _ .)' });
  }
  if (!scriptPath || !path.isAbsolute(scriptPath)) {
    return res.status(400).json({ error: 'Lokasi file bot harus berupa path absolut, contoh: D:\\bot-baru\\index.js' });
  }
  let scriptStat;
  try {
    scriptStat = await fsp.stat(scriptPath);
  } catch {
    return res.status(400).json({ error: `File tidak ditemukan: ${scriptPath}` });
  }
  if (!scriptStat.isFile()) {
    return res.status(400).json({ error: 'Path yang dimasukkan bukan file .js' });
  }
  if (cwdPath) {
    try {
      const s = await fsp.stat(cwdPath);
      if (!s.isDirectory()) return res.status(400).json({ error: 'Folder kerja bukan direktori yang valid' });
    } catch {
      return res.status(400).json({ error: `Folder kerja tidak ditemukan: ${cwdPath}` });
    }
  }

  try {
    const existing = summarize(await getRawProcesses());
    if (existing.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      return res.status(400).json({ error: `Nama proses "${trimmedName}" sudah dipakai. Pilih nama lain.` });
    }
    const args = ['start', scriptPath, '--name', trimmedName];
    if (cwdPath) args.push('--cwd', cwdPath);
    if (!autorestart) args.push('--no-autorestart');
    if (watch) args.push('--watch');
    await runPm2(args);
    const fresh = summarize(await getRawProcesses());
    const created = existing.length ? fresh.find((p) => p.name.toLowerCase() === trimmedName.toLowerCase()) : null;
    res.json({ ok: true, message: `Bot "${trimmedName}" berhasil ditambahkan ke PM2`, process: created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/processes/:pmId/:action', async (req, res) => {
  const { pmId, action } = req.params;

  if (LOCKED && action !== 'start') {
    return res.status(423).json({ error: 'Dashboard TERKUNCI — buka kunci lewat tombol gembok di kanan atas sebelum melakukan aksi ini.' });
  }

  if (action === 'delete') {
    if (!/^\d+$/.test(pmId)) return res.status(400).json({ error: 'pmId tidak valid' });
    try {
      const summaries = summarize(await getRawProcesses());
      const target = findProc(summaries, pmId);
      if (!target) return res.status(404).json({ error: 'Proses tidak ditemukan' });
      if (target.name.toUpperCase() === SELF_NAME) {
        return res.status(400).json({ error: 'Dashboard tidak boleh menghapus dirinya sendiri. Hapus lewat terminal jika benar-benar perlu.' });
      }
      await runPm2(['delete', pmId]);
      return res.json({ ok: true, action, message: `"${target.name}" dihapus dari daftar PM2` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === 'update') {
    try {
      const summaries = summarize(await getRawProcesses());
      const cur = findProc(summaries, pmId);
      if (!cur) return res.status(404).json({ error: 'Proses tidak ditemukan' });

      const body = req.body || {};
      const newName = String(body.name != null ? body.name : cur.name).trim();
      const scriptPath = String(body.script != null ? body.script : cur.script || '').trim().replace(/^"|"$/g, '');
      const cwdInput = String(body.cwd != null ? body.cwd : '').trim().replace(/^"|"$/g, '');
      const cwdPath = cwdInput || cur.cwd || '';
      const autorestart = body.autorestart !== false;
      const watch = !!body.watch;

      if (!/^[\w.\- ]{1,40}$/.test(newName)) return res.status(400).json({ error: 'Nama proses tidak valid (1-40 karakter)' });
      if (summaries.some((p) => p.pm_id !== cur.pm_id && p.name.toLowerCase() === newName.toLowerCase())) {
        return res.status(400).json({ error: `Nama "${newName}" sudah dipakai proses lain` });
      }
      let st;
      try { st = await fsp.stat(scriptPath); } catch { return res.status(400).json({ error: `File tidak ditemukan: ${scriptPath}` }); }
      if (!st.isFile()) return res.status(400).json({ error: 'Lokasi file bukan sebuah file .js' });
      if (cwdPath) {
        try {
          const s2 = await fsp.stat(cwdPath);
          if (!s2.isDirectory()) return res.status(400).json({ error: `Folder kerja tidak valid: ${cwdPath}` });
        } catch {
          return res.status(400).json({ error: `Folder kerja tidak ditemukan: ${cwdPath}` });
        }
      }

      const wasOnline = cur.status === 'online';
      await runPm2(['delete', pmId]);
      const args = ['start', scriptPath, '--name', newName];
      if (cwdPath) args.push('--cwd', cwdPath);
      if (!autorestart) args.push('--no-autorestart');
      if (watch) args.push('--watch');
      await runPm2(args);

      let fresh = summarize(await getRawProcesses());
      let created = fresh.find((p) => p.name.toLowerCase() === newName.toLowerCase()) || null;
      if (!wasOnline && created) {
        await runPm2(['stop', String(created.pm_id)]);
        fresh = summarize(await getRawProcesses());
        created = fresh.find((p) => p.name.toLowerCase() === newName.toLowerCase()) || null;
      }
      return res.json({ ok: true, action: 'update', message: `Proses "${newName}" berhasil diperbarui`, process: created });
    } catch (e) {
      return res.status(500).json({ error: `${e.message} — kalau proses hilang dari daftar, jalankan ulang lewat tombol Mulai atau Tambah Bot.` });
    }
  }

  if (!ALLOWED_ACTIONS.includes(action)) return res.status(400).json({ error: `Aksi tidak diizinkan: ${action}` });
  if (!/^\d+$/.test(pmId)) return res.status(400).json({ error: 'pmId tidak valid' });

  try {
    const summaries = summarize(await getRawProcesses());
    const target = findProc(summaries, pmId);
    if (!target) return res.status(404).json({ error: 'Proses tidak ditemukan' });
    if ((action === 'stop' || action === 'delete') && target.name.toUpperCase() === SELF_NAME) {
      return res.status(400).json({ error: 'Aksi ini akan mematikan dashboard itu sendiri, jadi diblokir dari web. Gunakan terminal.' });
    }
    await runPm2([action, pmId]);
    const fresh = summarize(await getRawProcesses());
    res.json({ ok: true, action, process: findProc(fresh, pmId) || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pm2/save', async (req, res) => {
  try {
    await runPm2(['save']);
    res.json({ ok: true, message: 'Daftar proses disimpan. Bot akan hidup otomatis saat laptop restart.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs', async (req, res) => {
  const name = String(req.query.name || '');
  const stream = req.query.stream === 'err' ? 'err' : 'out';
  const lines = Math.min(Math.max(parseInt(req.query.lines, 10) || 300, 10), 2000);
  if (!/^[\w.\- ]+$/.test(name)) return res.status(400).json({ error: 'Nama proses tidak valid' });
  try {
    const target = summarize(await getRawProcesses()).find((p) => p.name === name);
    if (!target) return res.status(404).json({ error: `Proses "${name}" tidak ditemukan` });
    const filePath = stream === 'err' ? target.err_log : target.out_log;
    if (!filePath) return res.status(404).json({ error: 'File log tidak tersedia' });
    const result = await tailFile(filePath, LOG_TAIL_BYTES);
    const allLines = result.text.replace(/\r/g, '').split('\n');
    while (allLines.length && allLines[allLines.length - 1] === '') allLines.pop();
    res.json({
      name,
      stream,
      lines: allLines.slice(-lines),
      truncated: result.truncated,
      file_size: result.size,
      file_path: filePath
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/activity', async (req, res) => {
  try {
    const procs = summarize(await getRawProcesses());
    const items = [];
    for (const p of procs) {
      let bytes = 0;
      for (const fp of [p.out_log, p.err_log]) {
        if (!fp) continue;
        try {
          const st = await fsp.stat(fp);
          if (st.isFile()) bytes += st.size;
        } catch {}
      }
      const key = String(p.pm_id);
      const prev = lastSizes.get(key);
      lastSizes.set(key, { size: bytes });
      items.push({
        pm_id: p.pm_id,
        name: p.name,
        delta_bytes: prev ? Math.max(0, bytes - prev.size) : 0
      });
    }
    res.json({ items, timestamp: Date.now() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/datasets', async (req, res) => {
  const results = [];
  for (const ds of DATASETS) {
    try {
      const text = await fsp.readFile(ds.file, 'utf8');
      let rows;
      if (ds.ndjson) {
        rows = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
      } else {
        const json = JSON.parse(text);
        rows = Array.isArray(json) ? json : [json];
      }
      results.push({
        id: ds.id,
        label: ds.label,
        desc: ds.desc,
        ok: true,
        count: rows.length,
        updated_at: (await fsp.stat(ds.file)).mtime.toISOString(),
        rows: rows.slice(0, 400)
      });
    } catch (e) {
      results.push({ id: ds.id, label: ds.label, desc: ds.desc, ok: false, error: e.message, rows: [] });
    }
  }
  res.json({ datasets: results });
});

app.get('/api/incidents', async (req, res) => {
  res.json({ incidents: (await loadIncidents()).slice(0, 300), file: INCIDENTS_FILE });
});

app.post('/api/incidents/clear', async (req, res) => {
  try {
    await fsp.writeFile(INCIDENTS_FILE, '[]');
    res.json({ ok: true, message: 'Riwayat insiden dibersihkan' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/open', async (req, res) => {
  if (LOCKED) return res.status(423).json({ error: 'Dashboard TERKUNCI — buka kunci dulu.' });
  const { type, name } = req.body || {};
  try {
    let targetPath;
    if (type === 'logs') {
      targetPath = path.join(os.homedir(), '.pm2', 'logs');
    } else if (type === 'proc') {
      if (!/^[\w.\- ]+$/.test(String(name || ''))) return res.status(400).json({ error: 'Nama tidak valid' });
      const t = summarize(await getRawProcesses()).find((p) => p.name === name);
      if (!t) return res.status(404).json({ error: 'Proses tidak ditemukan' });
      targetPath = t.cwd || (t.script ? path.dirname(t.script) : '');
      if (!targetPath) return res.status(400).json({ error: 'Folder kerja tidak tersedia' });
    } else {
      return res.status(400).json({ error: 'Tipe tidak dikenal' });
    }
    await fsp.access(targetPath);
    exec(`explorer.exe "${targetPath}"`, { windowsHide: true }, () => {});
    res.json({ ok: true, message: `Membuka ${targetPath}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const INCIDENTS_FILE = path.join(__dirname, '..', 'incidents.json');
let LOCKED = true;
let incidentStatuses = null;
const downSince = {};

const USERS_FILE = path.join(__dirname, '..', 'users.json');
const LOGIN_LOG_FILE = path.join(__dirname, '..', 'login-log.jsonl');
const SESSIONS_FILE = path.join(__dirname, '..', 'sessions.json');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
const BOOT_GRACE_MS = 2 * 60 * 1000;

let sessionCache = null;

function normalizeSessions(data) {
  const curUptimeMs = os.uptime() * 1000;
  if (!data || typeof data !== 'object' || typeof data.boot_uptime_ms !== 'number') {
    return { boot_uptime_ms: curUptimeMs, sessions: {} };
  }
  if (curUptimeMs + BOOT_GRACE_MS < data.boot_uptime_ms) {
    return { boot_uptime_ms: curUptimeMs, sessions: {} };
  }
  return { boot_uptime_ms: data.boot_uptime_ms, sessions: data.sessions || {} };
}

async function loadSessions() {
  if (sessionCache) return sessionCache;
  try {
    sessionCache = normalizeSessions(JSON.parse(await fsp.readFile(SESSIONS_FILE, 'utf8')));
  } catch {
    sessionCache = { boot_uptime_ms: os.uptime() * 1000, sessions: {} };
  }
  return sessionCache;
}

async function saveSessions() {
  try {
    await fsp.writeFile(SESSIONS_FILE, JSON.stringify(sessionCache));
  } catch {}
}

function extractSessionToken(req) {
  const m = /(?:^|;\s*)dash_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

async function sessionUser(req) {
  const token = extractSessionToken(req);
  if (!token) return null;
  const s = await loadSessions();
  const rec = s.sessions[token];
  if (!rec || rec.exp < Date.now()) return null;
  return rec.user;
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const calc = crypto.scryptSync(plain, salt, 32);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), calc);
  } catch {
    return false;
  }
}

async function ensureUsersFile() {
  try {
    await fsp.access(USERS_FILE);
  } catch {
    await fsp.writeFile(
      USERS_FILE,
      JSON.stringify(
        [{ id: 'VM505', name: 'Administrator', pass: hashPassword('X505'), created_at: new Date().toISOString() }],
        null,
        1
      )
    );
  }
}
ensureUsersFile();

setInterval(async () => {
  const s = await loadSessions();
  const now = Date.now();
  let dirty = false;
  for (const k of Object.keys(s.sessions)) {
    if (s.sessions[k].exp < now) { delete s.sessions[k]; dirty = true; }
  }
  if (dirty) await saveSessions();
}, 60 * 60 * 1000);

async function writeLoginLog(ip, user, ok, note) {
  try {
    await fsp.appendFile(LOGIN_LOG_FILE, JSON.stringify({ ts: Date.now(), user, ok, ip, ...(note ? { note } : {}) }) + '\n');
  } catch {}
}

const FAILS_FILE = path.join(__dirname, '..', 'login-fails.json');
const FAIL_LIMIT = 5;

// ================= Network Check =================
const NET_CACHE_TTL = 8000;
let netCache = null;
let netCacheAt = 0;
let netInflight = null;

async function ollamaCheck() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3500) });
    const j = await r.json();
    return { ok: true, models_count: (j.models || []).length, models: (j.models || []).map((m) => m.name).slice(0, 5) };
  } catch {
    return { ok: false, models_count: 0, models: [] };
  }
}

function diskCheck(drive) {
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -Command "(Get-PSDrive -Name ${drive}) | Select-Object Name,Free,Used | ConvertTo-Json -Compress"`,
      { windowsHide: true },
      (err, stdout) => {
        try {
          const j = JSON.parse(stdout);
          const free = Number(j.Free || 0);
          const used = Number(j.Used || 0);
          const total = free + used;
          resolve({
            drive,
            total_gb: +(total / 2 ** 30).toFixed(1),
            free_gb: +(free / 2 ** 30).toFixed(1),
            pct_used: total ? Math.round((used / total) * 100) : null
          });
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function pingHost(host) {
  return new Promise((resolve) => {
    exec(`ping -n 1 -w 2500 ${host}`, { windowsHide: true }, (err, stdout) => {
      const m = /(?:time|waktu)[=<](\d+)\s*ms/i.exec(stdout || '');
      if (!err && m) resolve({ ok: true, latency_ms: Number(m[1]) });
      else resolve({ ok: false, latency_ms: null });
    });
  });
}

async function httpCheck(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    return { ok: r.status < 500, status: r.status, latency_ms: Date.now() - t0, body: await r.text() };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, error: String(e.message || e).slice(0, 60) };
  }
}

async function collectNetwork() {
  const started = Date.now();
  const [g, c, cfTrace, domain, ollama, diskC, diskD] = await Promise.all([
    pingHost('8.8.8.8'),
    pingHost('1.1.1.1'),
    httpCheck('https://cloudflare.com/cdn-cgi/trace'),
    httpCheck('https://x505.my.id'),
    ollamaCheck(),
    diskCheck('C'),
    diskCheck('D')
  ]);

  let public_ip = null, loc = null, colo = null;
  if (cfTrace.ok) {
    for (const line of (cfTrace.body || '').split('\n')) {
      if (line.startsWith('ip=')) public_ip = line.slice(3);
      if (line.startsWith('loc=')) loc = line.slice(4);
      if (line.startsWith('colo=')) colo = line.slice(5);
    }
  }

  return {
    timestamp: Date.now(),
    duration_ms: Date.now() - started,
    checks: [
      { id: 'google', label: 'Ping Google 8.8.8.8', ok: g.ok, latency_ms: g.latency_ms },
      { id: 'cf', label: 'Ping Cloudflare 1.1.1.1', ok: c.ok, latency_ms: c.latency_ms },
      { id: 'https', label: 'HTTPS Internet', ok: cfTrace.ok, latency_ms: cfTrace.latency_ms },
      { id: 'domain', label: 'Domain x505.my.id', ok: domain.ok, latency_ms: domain.latency_ms }
    ],
    ollama,
    disks: [diskC, diskD].filter(Boolean),
    public_ip,
    loc,
    colo
  };
}

function getNetwork() {
  if (netInflight) return netInflight;
  if (netCache && Date.now() - netCacheAt < NET_CACHE_TTL) return Promise.resolve(netCache);
  netInflight = collectNetwork()
    .then((r) => { netCache = r; netCacheAt = Date.now(); return r; })
    .finally(() => { netInflight = null; });
  return netInflight;
}
// ==================================================

let failsCache = null;

async function loadFails() {
  if (failsCache) return failsCache;
  try {
    failsCache = JSON.parse(await fsp.readFile(FAILS_FILE, 'utf8'));
    if (!failsCache || typeof failsCache !== 'object') failsCache = {};
  } catch {
    failsCache = {};
  }
  return failsCache;
}

async function saveFails() {
  try { await fsp.writeFile(FAILS_FILE, JSON.stringify(failsCache)); } catch {}
}

function clientIp(req) {
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  return cf || (req.socket.remoteAddress || '-');
}

function fmtDur(ms) {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} menit`;
  return m ? `${h} jam ${m} menit` : `${h} jam`;
}

async function loadIncidents() {
  try {
    return JSON.parse(await fsp.readFile(INCIDENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function recordIncidents() {
  try {
    const procs = summarize(await getRawProcesses());
    const cur = {};
    for (const p of procs) cur[p.name] = p.status;
    if (incidentStatuses) {
      const list = await loadIncidents();
      let changed = false;
      const now = Date.now();
      for (const [name, st] of Object.entries(cur)) {
        const prev = incidentStatuses[name];
        if (!prev || prev === st) continue;
        if (st === 'stopped' || st === 'errored') {
          downSince[name] = now;
          list.unshift({ ts: now, name, event: 'down', from: prev, to: st });
          changed = true;
        } else if (st === 'online' && (prev === 'stopped' || prev === 'errored')) {
          const entry = { ts: now, name, event: 'up', from: prev, to: st };
          if (downSince[name]) {
            entry.downtime_ms = now - downSince[name];
            delete downSince[name];
          }
          list.unshift(entry);
          changed = true;
        }
      }
      if (changed) {
        try { await fsp.writeFile(INCIDENTS_FILE, JSON.stringify(list.slice(0, 500))); } catch {}
      }
    }
    incidentStatuses = cur;
  } catch {}
}

recordIncidents();
setInterval(recordIncidents, 60 * 1000);

app.get('/api/network', async (req, res) => {
  try {
    res.json(await getNetwork());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= File Manager (whitelist 2 folder bot) =================
const FILE_ROOTS = ['D:\\Nexbot\\src', 'D:\\Nexbot\\data'];
const EDIT_EXTS = ['.js', '.json', '.txt', '.md', '.html', '.css', '.env', '.log'];
const BACKUP_DIR = path.join(__dirname, '..', 'file-backups');
const MAX_EDIT_SIZE = 3 * 1024 * 1024;

function isPathAllowed(p) {
  const rp = path.resolve(String(p));
  const root = FILE_ROOTS.find(
    (r) => rp.toLowerCase() === r.toLowerCase() || rp.toLowerCase().startsWith(r.toLowerCase() + path.sep)
  );
  if (!root) return false;
  const rel = rp.slice(root.length);
  for (const s of rel.split(/[\\/]+/)) {
    const low = s.toLowerCase();
    if (low.startsWith('session_') || low.startsWith('.wwebjs') || (low.startsWith('.') && s !== '.')) return false;
    if (low === 'node_modules' || low === 'file-backups') return false;
  }
  return true;
}

app.get('/api/files/list', async (req, res) => {
  try {
    let dir = req.query.dir ? path.resolve(String(req.query.dir)) : null;
    if (dir && !isPathAllowed(dir)) dir = null;
    const out = [];
    const targets = dir ? [dir] : FILE_ROOTS;
    for (const t of targets) {
      const entries = await fsp.readdir(t, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (/^(node_modules|file-backups)$/i.test(e.name)) continue;
        if (/^session_|^auth_old_/i.test(e.name)) continue;
        const full = path.join(t, e.name);
        let size = 0, mtime = 0;
        try { const st = await fsp.stat(full); size = st.size; mtime = st.mtimeMs; } catch {}
        out.push({ name: e.name, path: full, is_dir: e.isDirectory(), size, mtime });
      }
    }
    out.sort((a, b) => (b.is_dir - a.is_dir) || a.name.localeCompare(b.name));
    res.json({ entries: out, roots: FILE_ROOTS, current: dir });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/file/read', async (req, res) => {
  const p = String(req.query.p || '');
  if (!isPathAllowed(p)) return res.status(403).json({ error: 'Lokasi tidak diizinkan' });
  const ext = path.extname(p).toLowerCase();
  if (!EDIT_EXTS.includes(ext)) return res.status(400).json({ error: `Ekstensi ${ext} tidak bisa dibuka` });
  try {
    const st = await fsp.stat(p);
    if (st.size > MAX_EDIT_SIZE) return res.status(400).json({ error: 'File terlalu besar untuk editor (>3MB)' });
    res.json({ content: await fsp.readFile(p, 'utf8'), size: st.size, mtime: st.mtimeMs, path: p });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/file/save', async (req, res) => {
  if (LOCKED) return res.status(423).json({ error: 'Dashboard TERKUNCI — buka kunci dulu sebelum menyimpan file.' });
  const { p, content } = req.body || {};
  if (!isPathAllowed(p)) return res.status(403).json({ error: 'Lokasi tidak diizinkan' });
  const ext = path.extname(p).toLowerCase();
  if (!EDIT_EXTS.includes(ext)) return res.status(400).json({ error: `Ekstensi ${ext} tidak didukung` });
  const text = String(content ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_EDIT_SIZE) return res.status(400).json({ error: 'Konten >3MB' });
  if (ext === '.json') {
    try { JSON.parse(text); } catch (e) {
      return res.status(400).json({ error: 'JSON tidak valid: ' + String(e.message).slice(0, 120) });
    }
  }
  if (ext === '.js') {
    try {
      await new Promise((resolve2, reject2) => {
        fs.writeFile(path.join(os.tmpdir(), 'syntax-check-tmp.js'), text, (wErr) => {
          if (wErr) return reject2(wErr);
          exec(`node --check "${path.join(os.tmpdir(), 'syntax-check-tmp.js')}"`, { windowsHide: true }, (cErr) => (cErr ? reject2(new Error('Syntax JS tidak valid')) : resolve2()));
        });
      });
    } catch (e) {
      return res.status(400).json({ error: 'Gagal disimpan: ' + e.message });
    }
  }
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `${path.basename(p)}.${stamp}.bak`;
    try { await fsp.copyFile(p, path.join(BACKUP_DIR, backupName)); } catch {}
    await fsp.writeFile(p, text);
    appendLog({ event: 'file-saved', file: p, backup: backupName, by: req.dashboardUser });
    res.json({ ok: true, message: `Tersimpan. Backup lama: ${backupName}`, needs_restart: ['.js'].includes(ext), proc: /modules[\\/]cs[\\/]/.test(p) ? 'AI-CS' : /modules[\\/]admin[\\/]/.test(p) ? 'AI-ADMIN' : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= Bot QR bridge (AI-CS / AI-ADMIN) =================
const BOTQR_SOURCES = {
  cs: { dir: 'D:\\Nexbot\\data\\qr', pattern: /^cs_qr_admin\d+\.png$/i, prefix: 'cs_qr_' },
  admin: { dir: 'D:\\Nexbot\\data\\qr', pattern: /^admin_qr_admin\d+\.png$/i, prefix: 'admin_qr_' }
};

app.get('/api/botqr/:id', async (req, res) => {
  const src = BOTQR_SOURCES[req.params.id];
  if (!src) return res.status(404).json({ error: 'Bot tidak dikenal' });
  const slotFilter = String(req.query.slot || '').toLowerCase().match(/^admin\d+$/);
  try {
    let files = (await fsp.readdir(src.dir)).filter((f) => src.pattern.test(f));
    if (slotFilter) files = files.filter((f) => f.toLowerCase() === `${src.prefix}${slotFilter[0]}.png`);
    let newest = null;
    for (const f of files) {
      const st = await fsp.stat(path.join(src.dir, f));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { name: f, mtimeMs: st.mtimeMs };
    }
    const age_min = newest ? +((Date.now() - newest.mtimeMs) / 60000).toFixed(1) : null;
    const fresh = !!newest && age_min !== null && age_min <= 35;
    let qr = null;
    if (fresh && newest) {
      const buf = await fsp.readFile(path.join(src.dir, newest.name));
      qr = 'data:image/png;base64,' + buf.toString('base64');
    }
    res.json({ qr, fresh, age_min, file: newest ? newest.name : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/lock', (req, res) => {
  const v = req.body ? req.body.locked : undefined;
  if (typeof v !== 'boolean') return res.status(400).json({ error: 'Nilai locked harus true/false' });
  LOCKED = v;
  res.json({
    ok: true,
    locked: LOCKED,
    message: LOCKED ? 'Dashboard DIKUNCI — aksi berbahaya diblokir' : 'Dashboard DIBUKA — hati-hati saat menekan tombol'
  });
});

app.get('/api/tunnel-info', async (req, res) => {
  try {
    const procs = summarize(await getRawProcesses());
    const t = procs.find(
      (p) => p.name.toUpperCase() === 'TUNNEL' || (p.script && p.script.toLowerCase().includes('cloudflared'))
    );
    if (!t) return res.json({ running: false });
    for (const fp of [t.err_log, t.out_log]) {
      if (!fp) continue;
      try {
        const r = await tailFile(fp, 64 * 1024);
        const all = [...r.text.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi)];
        if (all.length) return res.json({ running: true, url: all[all.length - 1][0], name: t.name, status: t.status });
      } catch {}
    }
    res.json({ running: true, url: null, name: t.name, status: t.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tunnel/restart', async (req, res) => {
  if (LOCKED) return res.status(423).json({ error: 'Dashboard TERKUNCI — buka kunci dulu untuk me-restart tunnel.' });
  try {
    const procs = summarize(await getRawProcesses());
    const t = procs.find(
      (p) => p.name.toUpperCase() === 'TUNNEL' || (p.script && p.script.toLowerCase().includes('cloudflared'))
    );
    if (!t) return res.status(404).json({ error: 'Proses TUNNEL tidak ditemukan di PM2' });
    await runPm2(['restart', String(t.pm_id)]);
    res.json({ ok: true, message: 'Tunnel di-restart. URL baru terbentuk dalam ±5 detik.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function extractTs(line) {
  let m = line.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  m = line.match(/"time"\s*:\s*(\d{13})/);
  if (m) return Number(m[1]);
  m = line.match(/\[(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\]/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
  }
  m = line.match(/^\W*(\d{1,2}):(\d{2}):(\d{2})\b/);
  if (m) {
    const d = new Date();
    d.setHours(+m[1], +m[2], +m[3], 0);
    return d.getTime();
  }
  return null;
}

app.get('/api/logs/all', async (req, res) => {
  const stream = req.query.stream === 'err' ? 'err' : 'out';
  const maxLines = Math.min(Math.max(parseInt(req.query.lines, 10) || 300, 10), 2000);
  try {
    const procs = summarize(await getRawProcesses());
    const entries = [];
    let idx = 0;
    for (const p of procs) {
      const filePath = stream === 'err' ? p.err_log : p.out_log;
      if (!filePath) continue;
      const result = await tailFile(filePath, 128 * 1024);
      const ls = result.text.replace(/\r/g, '').split('\n');
      while (ls.length && ls[ls.length - 1] === '') ls.pop();
      let carryTs = null;
      for (const text of ls) {
        const ts = extractTs(text);
        if (ts) carryTs = ts;
        entries.push({ n: p.name, t: text, ts: ts || carryTs || 0, i: idx++ });
      }
    }
    entries.sort((a, b) => (a.ts - b.ts) || (a.i - b.i));
    res.json({
      stream,
      lines: entries.slice(-maxLines),
      truncated: true,
      total_merged: entries.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const distDir = path.join(__dirname, '..', 'dist');

app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});

app.use('/assets', express.static(path.join(distDir, 'assets'), { immutable: true, maxAge: '30d' }));

app.use(express.static(distDir));

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(503).send('Frontend belum di-build. Jalankan: npm run build');
  });
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

app.listen(PORT, HOST, () => {
  console.log(`[DASHBOARD] Berjalan di http://${HOST}:${PORT}`);
});
