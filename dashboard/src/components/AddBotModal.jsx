import { useState } from 'react';
import { addBot } from '../api.js';
import { PlusIcon, CloseIcon, FolderIcon, ScriptIcon } from './Icons.jsx';

export default function AddBotModal({ open, onClose, onAdded }) {
  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [cwd, setCwd] = useState('');
  const [autorestart, setAutorestart] = useState(true);
  const [watch, setWatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  const reset = () => {
    setName('');
    setScript('');
    setCwd('');
    setAutorestart(true);
    setWatch(false);
    setError(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await addBot({ name, script, cwd, autorestart, watch });
      onAdded(res.message || 'Bot berhasil ditambahkan');
      reset();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <form className="modal modal-form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h3>Tambah Bot Baru</h3>
            <p>Daftarkan bot Node.js ke PM2 supaya bisa dipantau & dikontrol dari sini.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Tutup">
            <CloseIcon />
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <label className="field">
          <span className="field-label">Nama proses <em>*</em></span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="contoh: BOT-CS-BARU"
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label"><ScriptIcon size={13} /> Lokasi file utama bot <em>*</em></span>
          <input
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder='contoh: D:\bot-baru\index.js'
          />
        </label>

        <label className="field">
          <span className="field-label"><FolderIcon size={13} /> Folder kerja (opsional)</span>
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder='contoh: D:\bot-baru'
          />
          <span className="field-hint">Biasanya folder yang sama dengan file bot. Wajib jika bot membaca file relatif.</span>
        </label>

        <div className="switches">
          <Toggle
            checked={autorestart}
            onChange={setAutorestart}
            title="Auto-restart saat crash"
            desc="Bot langsung hidup lagi kalau tiba-tiba error/crash."
          />
          <Toggle
            checked={watch}
            onChange={setWatch}
            title="Watch mode"
            desc="Restart otomatis tiap file berubah. Tidak disarankan untuk production."
          />
        </div>

        <div className="form-note">
          Setelah ditambahkan, klik tombol <b>Simpan ke PM2</b> di header agar bot ikut menyala otomatis saat laptop restart.
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <PlusIcon size={14} /> {busy ? 'Menambahkan...' : 'Tambahkan ke PM2'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Toggle({ checked, onChange, title, desc }) {
  return (
    <button type="button" className={`toggle-row ${checked ? 'toggle-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className={`switch ${checked ? 'switch-on' : ''}`} />
      <span className="toggle-text">
        <b>{title}</b>
        <small>{desc}</small>
      </span>
    </button>
  );
}
