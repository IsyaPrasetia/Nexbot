const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const PORT = process.env.PORT || 5588;
const config = require('../../config');
const CFG = config.blast;
const ROOT = __dirname;
const UPLOAD_DIR = CFG.files.uploads;
const JOBS_FILE = CFG.files.jobs;
const LOG_FILE = CFG.files.log;
const DRAFT_FILE = CFG.files.draft;
const BATCH_META_FILE = CFG.files.batches;
const HANDOVER_FLAG_FILE = CFG.files.handoverFlag;

function touchHandoverFlag() {
  try {
    fs.mkdirSync(path.dirname(HANDOVER_FLAG_FILE), { recursive: true });
    fs.writeFileSync(HANDOVER_FLAG_FILE, JSON.stringify({ active: true, ts: Date.now() }));
  } catch {}
}

function clearHandoverFlag() {
  try { fs.unlinkSync(HANDOVER_FLAG_FILE); } catch {}
}

const SLOT_IDS = ['s1', 's2', 's3'];
const MIN_DELAY_S = CFG.MIN_DELAY_S;
const MAX_CONSEC_FAILS = CFG.MAX_CONSEC_FAILS;
const MAX_TEXT_LEN = CFG.MAX_TEXT_LEN;
const BATCH_SIZE = CFG.BATCH_SIZE || 50;
const BATCH_REST_S = CFG.BATCH_REST_S || 300;

for (const dir of [UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const RETRY_DELAYS = [5, 15, 30, 45, 60]; // detik, lalu ulang ke 5

const sockets = {};
const states = {};
for (const slot of SLOT_IDS) {
  states[slot] = { qrRaw: null, state: 'disconnected', user: null, retryIdx: 0 };
}

let job = null;
let engineRunning = false;

function sessionDir(slot) {
  return path.join(config.DATA_DIR, 'sessions', 'blast', 'session_' + slot);
}

function getState(slot) {
  return states[slot] || { qrRaw: null, state: 'disconnected', user: null };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Acak urutan array (Fisher-Yates)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Tambah karakter zero-width acak ke teks agar tidak identik 100%
// Karakter tak terlihat: \u200B (zero-width space), \u200C (zero-width non-joiner), \u200D (zero-width joiner)
const ZW_CHARS = ['\u200B', '\u200C', '\u200D'];
function addInvisibleChars(text) {
  if (!text || text.length < 5) return text;
  // Sisipkan 1-3 karakter zero-width di posisi acak (setelah spasi, bukan di awal/akhir kata)
  const words = text.split(/(\s+)/);
  const insertions = Math.min(randInt(1, 3), Math.floor(words.length / 3));
  for (let i = 0; i < insertions; i++) {
    const pos = randInt(2, words.length - 2);
    if (words[pos] && !/^\s+$/.test(words[pos])) {
      const zw = ZW_CHARS[randInt(0, ZW_CHARS.length - 1)];
      words[pos] = words[pos] + zw;
    }
  }
  return words.join('');
}

// Jeda acak bernada manusiawi: mayoritas di zona 80-120s,
// kadang cepat (60-80s), kadang lama (120-180s).
function weightedDelay(minS, maxS) {
  const midLow = Math.min(80, maxS);
  const midHigh = Math.min(120, maxS);
  const r = Math.random();
  if (r < 0.65 && midHigh > midLow) {
    // Zona utama 80-120s
    return randInt(midLow, midHigh);
  }
  if (r < 0.85) {
    // Zona cepat, tidak di bawah minS
    return randInt(minS, Math.min(80, maxS));
  }
  // Zona lama hingga maxS
  return randInt(Math.min(120, maxS), maxS);
}

async function appendLog(entry) {
  try {
    await fsp.appendFile(LOG_FILE, JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  } catch {}
}

async function loadJob() {
  try {
    job = JSON.parse(await fsp.readFile(JOBS_FILE, 'utf8'));
  } catch {
    job = null;
  }
  return job;
}

function saveJob() {
  if (!job) return Promise.resolve();
  return fsp.writeFile(JOBS_FILE, JSON.stringify(job)).catch(() => {});
}

let batchMetaCache = null;
async function loadBatchMeta() {
  if (batchMetaCache) return batchMetaCache;
  try {
    batchMetaCache = JSON.parse(await fsp.readFile(BATCH_META_FILE, 'utf8'));
    if (!batchMetaCache || typeof batchMetaCache.last_no !== 'number') throw 0;
  } catch {
    batchMetaCache = { last_no: 0 };
  }
  return batchMetaCache;
}

async function nextBatchNo() {
  const meta = await loadBatchMeta();
  meta.last_no += 1;
  try { await fsp.writeFile(BATCH_META_FILE, JSON.stringify(meta)); } catch {}
  return meta.last_no;
}

async function getBatchLastNo() {
  return (await loadBatchMeta()).last_no;
}

function normalizeNumber(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  if (!d.startsWith('62')) return null;
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

async function connectSlot(slot) {
  const st = states[slot];
  st.state = 'connecting';
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir(slot));
    let version;
    try {
      const v = await fetchLatestBaileysVersion();
      if (v && v.version) version = v.version;
    } catch {}

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      markOnlineOnSend: false,
      syncFullHistory: false,
      browser: ['Windows', 'Chrome', '1.0.0']
    });

    sockets[slot] = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', () => {});

    sock.ev.on('connection.update', (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        st.qrRaw = qr;
        st.state = 'waiting_scan';
      }
      if (connection === 'open') {
        st.state = 'connected';
        st.qrRaw = null;
        st.user = (sock.user && sock.user.id) || null;
        st.retryIdx = 0;
        appendLog({ event: 'connected', slot, user: st.user });
      }
      if (connection === 'close') {
        const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output ? lastDisconnect.error.output.statusCode : null;
        st.state = 'disconnected';
        st.user = null;
        appendLog({ event: 'disconnected', slot, code });
        if (code === DisconnectReason.loggedOut) {
          st.state = 'logged_out';
          st.retryIdx = 0;
          fsp.rm(sessionDir(slot), { recursive: true, force: true })
            .then(() => fs.mkdirSync(sessionDir(slot), { recursive: true }))
            .then(() => connectSlot(slot))
            .catch(() => {});
        } else {
          const idx = st.retryIdx % RETRY_DELAYS.length;
          const delaySec = RETRY_DELAYS[idx];
          st.retryIdx += 1;
          appendLog({ event: 'retry', slot, code, delay_s: delaySec, attempt: st.retryIdx });
          setTimeout(() => connectSlot(slot), delaySec * 1000);
        }
      }
    });
  } catch (e) {
    st.state = 'disconnected';
    const idx = st.retryIdx % RETRY_DELAYS.length;
    const delaySec = RETRY_DELAYS[idx];
    st.retryIdx += 1;
    appendLog({ event: 'retry', slot, error: String(e.message || e).slice(0, 120), delay_s: delaySec, attempt: st.retryIdx });
    setTimeout(() => connectSlot(slot), delaySec * 1000);
  }
}

function isSlotConnected(slot) {
  const st = getState(slot);
  return st.state === 'connected' && !!sockets[slot];
}

async function waitSenderReady(slot) {
  while (job && job.status === 'running') {
    if (isSlotConnected(slot)) return true;
    const st = getState(slot);
    if (st.state === 'logged_out') {
      job.status = 'paused';
      job.pause_reason = `Sesi ${slot.toUpperCase()} logout dari HP - scan ulang QR-nya lalu tekan Lanjut.`;
      await saveJob();
      return false;
    }
    await sleep(2000);
  }
  return false;
}

async function runEngine() {
  if (engineRunning) return;
  engineRunning = true;
  try {
    // Acak urutan target agar tidak pola berurutan
    const pending = job.targets.filter((t) => t.status === 'pending');
    const pendingSet = new Set(pending.map((t) => t.jid));
    const shuffled = shuffle(pending);
    // Susun ulang targets: shuffled di depan, sisanya di belakang
    const rest = job.targets.filter((t) => !pendingSet.has(t.jid));
    job.targets = [...shuffled, ...rest];
    await saveJob();

    let randomBreakCounter = 0;
    const randomBreakAt = randInt(10, 15); // istirahat acak tiap 10-15 pesan

    while (job && job.status === 'running') {
      const target = job.targets.find((t) => t.status === 'pending');
      if (!target) {
        job.status = 'done';
        job.finished_at = Date.now();
        await saveJob();
        appendLog({ event: 'done', total: job.targets.length });
        break;
      }

      if (!(await waitSenderReady(target.sender_slot))) break;

      const variant = job.variants[target.variant_index] || job.variants[0];
      try {
        // Simulasi "sedang mengetik" sebelum kirim
        const sock = sockets[target.sender_slot];
        if (sock) {
          try {
            await sock.sendPresenceUpdate('composing', target.jid);
            await sleep(randInt(1500, 3000));
          } catch {}
        }

        let mode = 'text';
        const textToSend = addInvisibleChars(variant.text || '');
        if (variant.image) {
          const buf = await fsp.readFile(path.join(UPLOAD_DIR, variant.image));
          await sock.sendMessage(target.jid, { image: buf, caption: textToSend || undefined });
          mode = textToSend ? 'image+caption' : 'image';
        } else {
          await sock.sendMessage(target.jid, { text: textToSend });
        }
        target.status = 'sent';
        target.ts = Date.now();
        delete target.error;
        target.mode = mode;
        job.sent_count += 1;
        job.consec_fail = 0;
        randomBreakCounter += 1;
        touchHandoverFlag();
        appendLog({ event: 'sent', to: target.jid, from: target.sender_slot, variant: target.variant_index + 1, mode });
      } catch (e) {
        target.status = 'failed';
        target.ts = Date.now();
        target.error = String((e && e.message) || e).slice(0, 160);
        job.failed_count += 1;
        job.consec_fail += 1;
        appendLog({ event: 'failed', to: target.jid, from: target.sender_slot, error: target.error });
        if (job.consec_fail >= MAX_CONSEC_FAILS) {
          job.status = 'paused';
          job.pause_reason = `${MAX_CONSEC_FAILS} gagal beruntun - kemungkinan sesi putus/nomor diblokir. Periksa lalu tekan Lanjut.`;
        }
      }

      await saveJob();
      if (!job || job.status !== 'running') {
        clearHandoverFlag();
        break;
      }

      const delayMs = weightedDelay(job.settings.delay_min_s, job.settings.delay_max_s) * 1000;
      job.next_at = Date.now() + delayMs;
      await saveJob();
      await sleep(delayMs);

      // Break acak tambahan: istirahat 3-8 menit tiap 10-15 pesan (di luar batch rest)
      if (job && job.status === 'running' && randomBreakCounter >= randomBreakAt) {
        const hasMore = job.targets.some((t) => t.status === 'pending');
        if (hasMore) {
          const breakS = randInt(180, 480); // 3-8 menit
          appendLog({ event: 'random_break', sent: job.sent_count, break_s: breakS });
          job.next_at = Date.now() + breakS * 1000;
          await saveJob();
          await sleep(breakS * 1000);
          randomBreakCounter = 0;
        }
      }

      // Batch rest: istirahat panjang setiap BATCH_SIZE pesan terkirim
      if (job && job.status === 'running' && job.sent_count > 0 && job.sent_count % BATCH_SIZE === 0) {
        const hasMore = job.targets.some((t) => t.status === 'pending');
        if (hasMore) {
          const restMs = BATCH_REST_S * 1000;
          appendLog({ event: 'batch_rest', sent: job.sent_count, rest_s: BATCH_REST_S, next_batch: Math.floor(job.sent_count / BATCH_SIZE) + 1 });
          job.next_at = Date.now() + restMs;
          await saveJob();
          await sleep(restMs);
        }
      }
    }
  } finally {
    engineRunning = false;
  }
}

const app = express();
app.use(express.json({ limit: '12mb' }));

app.get('/api/session', async (req, res) => {
  const slots = [];
  for (const slot of SLOT_IDS) {
    const st = getState(slot);
    let qr = null;
    if (st.state === 'waiting_scan' && st.qrRaw) {
      try {
        qr = await QRCode.toDataURL(st.qrRaw, { margin: 1, width: 300 });
      } catch {}
    }
    slots.push({ slot, state: st.state, user: st.user, qr });
  }
  res.json({
    slots,
    any_connected: slots.some((s) => s.state === 'connected'),
    connected_slots: slots.filter((s) => s.state === 'connected').map((s) => s.slot)
  });
});

app.post('/api/session/logout', async (req, res) => {
  const slot = String((req.body || {}).slot || '');
  if (!SLOT_IDS.includes(slot)) return res.status(400).json({ error: 'Slot tidak dikenal' });
  try {
    if (sockets[slot]) await sockets[slot].logout();
  } catch {}
  const st = states[slot];
  st.state = 'disconnected';
  st.user = null;
  st.qrRaw = null;
  try {
    await fsp.rm(sessionDir(slot), { recursive: true, force: true });
    fs.mkdirSync(sessionDir(slot), { recursive: true });
  } catch {}
  connectSlot(slot);
  res.json({ ok: true, message: `Sesi ${slot.toUpperCase()} dihapus. Scan ulang untuk masuk.` });
});

app.post('/api/upload', async (req, res) => {
  const { name, data } = req.body || {};
  const ext = String(name || '').toLowerCase().match(/\.(jpe?g|png|webp)$/);
  if (!ext) return res.status(400).json({ error: 'Format harus JPG/PNG/WEBP' });
  if (!data || typeof data !== 'string') return res.status(400).json({ error: 'Data gambar kosong' });
  const b64 = data.includes(',') ? data.split(',')[1] : data;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 1024) return res.status(400).json({ error: 'Gambar terlalu kecil/korup' });
  if (buf.length > 9 * 1024 * 1024) return res.status(400).json({ error: 'Maksimal 9MB' });
  const fname = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext[0]}`;
  await fsp.writeFile(path.join(UPLOAD_DIR, fname), buf);
  res.json({ ok: true, name: fname, size: buf.length });
});

app.get('/api/upload/:name', async (req, res) => {
  const name = path.basename(String(req.params.name || ''));
  if (!/^[\w.\-]+\.(jpe?g|png|webp)$/i.test(name)) return res.status(400).end();
  try {
    const buf = await fsp.readFile(path.join(UPLOAD_DIR, name));
    const type = name.toLowerCase().endsWith('.png') ? 'image/png' : name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch {
    res.status(404).end();
  }
});

app.get('/api/draft', async (req, res) => {
  try {
    const draft = JSON.parse(await fsp.readFile(DRAFT_FILE, 'utf8'));
    res.json({ ...draft, batch_last_no: await getBatchLastNo() });
  } catch {
    res.json({ batch_last_no: await getBatchLastNo() });
  }
});

app.post('/api/draft', async (req, res) => {
  const body = req.body || {};
  const draft = {
    variants: Array.isArray(body.variants) ? body.variants.slice(0, 3).map((v) => ({ text: String(v.text || '').slice(0, MAX_TEXT_LEN), image: v.image || null })) : [],
    targets_text: String(body.targets_text || '').slice(0, 300000),
    settings: {
      delay_min_s: Number(body.settings && body.settings.delay_min_s) || MIN_DELAY_S,
      delay_max_s: Number(body.settings && body.settings.delay_max_s) || 20,
      distribution: body.settings && body.settings.distribution === 'block' ? 'block' : 'roundrobin',
      block_size: Number(body.settings && body.settings.block_size) || 50
    }
  };
  try {
    await fsp.writeFile(DRAFT_FILE, JSON.stringify(draft));
    res.json({ ok: true, batch_last_no: await getBatchLastNo() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/job/create', async (req, res) => {
  if (job && ['queued', 'running', 'paused'].includes(job.status)) {
    return res.status(400).json({ error: `Masih ada job ${job.status}. Stop dulu sebelum buat antrean baru.` });
  }
  const body = req.body || {};

  const senders = Array.isArray(body.senders) ? [...new Set(body.senders)].filter((s) => SLOT_IDS.includes(s)) : [];
  if (!senders.length) return res.status(400).json({ error: 'Pilih minimal 1 nomor pengirim yang sudah tersambung.' });

  const variants = Array.isArray(body.variants) ? body.variants.slice(0, 3) : [];
  if (!variants.length) return res.status(400).json({ error: 'Minimal 1 varian teks/gambar' });
  for (const v of variants) {
    if (!v.text && !v.image) return res.status(400).json({ error: 'Setiap varian harus punya teks atau gambar' });
    if (typeof v.text === 'string' && v.text.length > MAX_TEXT_LEN) return res.status(400).json({ error: `Teks maksimal ${MAX_TEXT_LEN} karakter` });
  }

  let delayMin = parseInt(body.delay_min_s, 10);
  let delayMax = parseInt(body.delay_max_s, 10);
  if (!Number.isFinite(delayMin)) delayMin = MIN_DELAY_S;
  if (!Number.isFinite(delayMax)) delayMax = Math.max(delayMin, delayMin + 5);
  delayMin = Math.max(MIN_DELAY_S, delayMin);
  delayMax = Math.max(delayMin, Math.min(delayMax, 600));

  const rawTargets = Array.isArray(body.targets) ? body.targets : [];
  const seen = new Set();
  const targets = [];
  let duplicates = 0;
  const invalid = [];
  for (const raw of rawTargets) {
    const num = normalizeNumber(raw);
    if (!num) {
      if (String(raw).trim()) invalid.push(String(raw).trim().slice(0, 18));
      continue;
    }
    if (seen.has(num)) { duplicates += 1; continue; }
    seen.add(num);
    targets.push({ jid: `${num}@s.whatsapp.net`, num, status: 'pending' });
  }
  if (!targets.length) {
    return res.status(400).json({ error: 'Tidak ada nomor valid untuk dikirim' + (invalid.length ? ` (${invalid.length} baris tak valid)` : '') });
  }

  const distribution = body.distribution === 'block' ? 'block' : 'roundrobin';
  const blockSize = Math.max(1, parseInt(body.block_size, 10) || 50);

  targets.forEach((t, i) => {
    t.variant_index = distribution === 'block'
      ? Math.floor(i / blockSize) % variants.length
      : i % variants.length;
    t.sender_slot = senders[i % senders.length];
  });

  const batchNo = await nextBatchNo();

  job = {
    id: crypto.randomBytes(4).toString('hex'),
    batch_no: batchNo,
    created_at: Date.now(),
    status: 'queued',
    pause_reason: null,
    senders,
    variants: variants.map((v) => ({ text: v.text || '', image: v.image || null })),
    settings: { delay_min_s: delayMin, delay_max_s: delayMax, distribution, block_size: blockSize },
    targets,
    sent_count: 0,
    failed_count: 0,
    consec_fail: 0,
    next_at: null,
    finished_at: null
  };
  await saveJob();
  appendLog({ event: 'created', total: targets.length, duplicates, invalid: invalid.length, senders, variants: variants.length });
  res.json({
    ok: true,
    summary: {
      total: targets.length,
      duplicates_removed: duplicates,
      invalid_sample: invalid.slice(0, 5),
      invalid_total: invalid.length,
      variants: variants.length,
      senders: senders.map((s) => s.toUpperCase())
    },
    job: publicJob()
  });
});

app.post('/api/job/control', async (req, res) => {
  if (!job) return res.status(404).json({ error: 'Belum ada antrean. Buat dulu.' });
  const action = (req.body || {}).action;
  if (action === 'start' || action === 'resume') {
    if (!['queued', 'paused'].includes(job.status)) return res.status(400).json({ error: `Job sedang ${job.status}, tidak bisa di-${action}` });
    const notReady = (job.senders || []).filter((s) => !isSlotConnected(s));
    if (notReady.length) {
      return res.status(400).json({ error: `Pengirim belum tersambung: ${notReady.map((s) => s.toUpperCase()).join(', ')}. Scan QR-nya dulu.` });
    }
    job.status = 'running';
    job.pause_reason = null;
    await saveJob();
    runEngine();
    return res.json({ ok: true, message: action === 'resume' ? 'Melanjutkan blast...' : 'Blast dimulai' });
  }
    if (action === 'pause') {
    if (job.status !== 'running') return res.status(400).json({ error: 'Job tidak sedang berjalan' });
    job.status = 'paused';
    clearHandoverFlag();
    await saveJob();
    return res.json({ ok: true, message: 'Dijeda. Tekan Lanjut untuk meneruskan.' });
  }
  if (action === 'stop') {
    job.status = 'stopped';
    job.next_at = null;
    clearHandoverFlag();
    await saveJob();
    return res.json({ ok: true, message: 'Blast dihentikan permanen. Buat antrean baru untuk mulai lagi.' });
  }
  if (action === 'resume') {
    // flag akan ditouch lagi pada pengiriman pertama
  }
  res.status(400).json({ error: 'Aksi tidak dikenal' });
});

function publicJob() {
  if (!job) return null;
  const pending = job.targets.filter((t) => t.status === 'pending').length;
  const done = job.sent_count + job.failed_count;
  const pct = job.targets.length ? Math.round((done / job.targets.length) * 1000) / 10 : 0;
  let eta_ms = null;
  if (job.status === 'running' && pending > 0) {
    const avg = ((job.settings.delay_min_s + job.settings.delay_max_s) / 2) * 1000;
    eta_ms = pending * avg;
  }
  const perSender = {};
  for (const s of job.senders || []) perSender[s] = job.targets.filter((t) => t.sender_slot === s).length;

  const sentTargets = job.targets.filter((t) => t.status === 'sent');
  const failedTargets = job.targets.filter((t) => t.status === 'failed');
  const pendingTargets = job.targets.filter((t) => t.status === 'pending');

  return {
    id: job.id,
    batch_no: job.batch_no || 1,
    status: job.status,
    pause_reason: job.pause_reason,
    created_at: job.created_at,
    finished_at: job.finished_at,
    next_at: job.next_at,
    senders: job.senders || [],
    per_sender: perSender,
    settings: job.settings,
    variants: job.variants.map((v) => ({ text: v.text || '', image: v.image })),
    totals: { all: job.targets.length, sent: job.sent_count, failed: job.failed_count, pending, pct, eta_ms },
    lists: {
      sent: sentTargets.slice(-20).reverse(),
      waiting: pendingTargets.slice(0, 20),
      failed: failedTargets.slice(-20).reverse()
    }
  };
}

app.get('/api/job', (req, res) => {
  res.json({ job: publicJob(), connections: SLOT_IDS.map((s) => ({ slot: s, ...getState(s), qr: undefined })) });
});

app.delete('/api/job', async (req, res) => {
  if (job && ['running', 'paused'].includes(job.status)) {
    return res.status(400).json({ error: 'Stop dulu antreannya sebelum menghapus.' });
  }
  job = null;
  try { await fsp.unlink(JOBS_FILE); } catch {}
  res.json({ ok: true, message: 'Antrean dihapus dari BLASTER.' });
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint BLASTER tidak ditemukan' }));

loadJob().then(() => {
  if (job && job.status === 'running') {
    console.log('[BLASTER] Ada job running tersimpan - melanjutkan otomatis...');
    runEngine();
  }
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[BLASTER] API siap di http://127.0.0.1:${PORT}`);
    for (const slot of SLOT_IDS) connectSlot(slot);
  });
});
