/**
 * NexBot / core / manager.js
 * Manajer slot: mengelola beberapa koneksi WhatsApp (multi-slot) dalam satu modul.
 * Berguna untuk AI-CS (admin1/2/3) dan AI-ADMIN (bisa multi-slot).
 * Menyediakan: status per slot, QR, reset, spawn, logout.
 */
const { connectSlot, deleteSessionDir } = require('./session');
const { qrPath, sessionPath } = require('./paths');

/**
 * @param {object} cfg  konfigurasi cluster: { slots, label, stateRoot, qrRoot, enableLogoutArchive }
 * @returns manager
 */
function createSlotManager(cfg) {
  const {
    slots = [],
    label = 'wa',
    onMessage = null,
    onSlotOpen = () => {},
    enableLogoutArchive = false,
  } = cfg;

  // state per slot
  const state = {};
  const socks = {};       // sock per slot
  const qrData = {};      // { raw, dataUrl, ts }
  const connected = {};   // bool

  for (const s of slots) {
    state[s] = { status: 'disconnected', user: null };
    qrData[s] = { raw: null, dataUrl: null, ts: 0 };
    connected[s] = false;
  }

  async function connect(slot) {
    if (state[slot]?.status === 'connecting') return;
    state[slot] = state[slot] || { status: 'connecting', user: null };
    state[slot].status = 'connecting';
    try {
      const { sock } = await connectSlot({
        slot,
        label,
        stateDir: sessionPath(label, slot),
        qrFile: qrPath(label, slot),
        onQr: (raw, url) => { qrData[slot] = { raw, dataUrl: url, ts: Date.now() }; state[slot].status = 'waiting_scan'; },
        onOpen: (user) => { connected[slot] = true; state[slot] = { status: 'connected', user }; onSlotOpen(slot, user); },
        onClose: ({ reason, isLogout }) => {
          connected[slot] = false;
          state[slot] = state[slot] || {};
          state[slot].status = isLogout ? 'logged_out' : 'disconnected';
          setTimeout(() => { if (!connected[slot]) connect(slot); }, 5000);
        },
        onMessage,
      });
      socks[slot] = sock;
    } catch (e) {
      console.error(`[manager:${label}] gagal connect ${slot}:`, e.message);
      setTimeout(() => connect(slot), 8000);
    }
  }

  async function reset(slot) {
    if (socks[slot]) {
      try { await socks[slot].end(undefined); } catch {}
      delete socks[slot];
    }
    connected[slot] = false;
    state[slot] = { status: 'disconnected', user: null };
    qrData[slot] = { raw: null, dataUrl: null, ts: 0 };
    deleteSessionDir(sessionPath(label, slot));
    setTimeout(() => connect(slot), 500);
  }

  async function resetAll() {
    const done = [];
    for (const s of slots) { await reset(s); done.push(s); }
    return done;
  }

  function status() {
    return slots.map((s) => ({
      slot: s,
      connected: !!connected[s],
      status: state[s]?.status || 'disconnected',
      user: state[s]?.user ? { id: state[s].user.id, nomor: (state[s].user.id || '').split(':')[0] } : null,
      qr: qrData[s]?.dataUrl || null,
      qrFresh: qrData[s] && (Date.now() - qrData[s].ts < 120000),
    }));
  }

  // connect all on start
  slots.forEach((s) => connect(s));

  return { connect, reset, resetAll, status, socks, getState: (s) => state[s], isConnected: (s) => !!connected[s] };
}

module.exports = { createSlotManager };
