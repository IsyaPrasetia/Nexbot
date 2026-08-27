import { useState } from 'react';
import { updateProcess } from '../api.js';
import { CloseIcon, PencilIcon, FolderIcon, ScriptIcon } from './Icons.jsx';

export default function EditBotModal({ proc, onClose, onSaved }) {
  const [name, setName] = useState(proc.name);
  const [script, setScript] = useState(proc.script || '');
  const [cwd, setCwd] = useState(proc.cwd || '');
  const [autorestart, setAutorestart] = useState(proc.autorestart !== false);
  const [watch, setWatch] = useState(!!proc.watch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!proc) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await updateProcess(proc.pm_id, {
        name,
        script,
        cwd,
        autorestart,
        watch
      });
      onSaved(res.message || 'Perubahan tersimpan');
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
            <h3>Edit Proses #{proc.pm_id}</h3>
            <p>Ubah pengaturan perlindungan & identitas proses yang sudah terdaftar.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Tutup">
            <CloseIcon />
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <label className="field">
          <span className="field-label">Nama proses</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>

        <label className="field">
          <span className="field-label"><ScriptIcon size={13} /> Lokasi file utama bot</span>
          <input value={script} onChange={(e) => setScript(e.target.value)} />
        </label>

        <label className="field">
          <span className="field-label"><FolderIcon size={13} /> Folder kerja</span>
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder='contoh: D:\bot-baru' />
        </label>

        <div className="switches">
          <ToggleRow checked={autorestart} onChange={setAutorestart}
            title="Auto-restart saat crash"
            desc="Bot langsung hidup lagi kalau tiba-tiba error/crash." />
          <ToggleRow checked={watch} onChange={setWatch}
            title="Watch mode"
            desc="Restart otomatis tiap file berubah. Tidak disarankan untuk production." />
        </div>

        <div className="form-note form-note-warn">
          Menyimpan perubahan akan <b>me-restart singkat</b> proses ini (±beberapa detik offline, sesi WhatsApp aman karena tersimpan di disk).
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <PencilIcon size={14} /> {busy ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ToggleRow({ checked, onChange, title, desc }) {
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
