/**
 * NexBot / core / paths.js
 * Helper path untuk session & QR.
 */
const path = require('path');
const { DATA_DIR } = require('../config');

function sessionPath(label, slot) {
  return path.join(DATA_DIR, 'sessions', label, `session_${slot}`);
}

function qrPath(label, slot) {
  return path.join(DATA_DIR, 'qr', `${label}_qr_${slot}.png`);
}

module.exports = { sessionPath, qrPath };
