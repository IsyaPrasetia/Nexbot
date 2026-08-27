import { useEffect, useState } from 'react';
import { setLock } from '../api.js';
import { UnlockIcon } from './Icons.jsx';

export default function LockModal({ open, purpose, onCancel, onUnlocked }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setChecked(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!checked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setLock(false);
      sessionStorage.setItem('dash-unlock', '1');
      onUnlocked();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon confirm-unlock"><UnlockIcon size={22} /></div>
        <h3>Buka Kunci Keamanan</h3>
        <p>{purpose || 'Aksi berbahaya sedang diblokir sistem kunci.'}</p>

        {error && <div className="form-error">{error}</div>}

        <button
          type="button"
          className={`toggle-row ${checked ? 'toggle-on' : ''}`}
          style={{ width: '100%' }}
          onClick={() => setChecked((c) => !c)}
        >
          <span className={`switch ${checked ? 'switch-on' : ''}`} />
          <span className="toggle-text">
            <b>Saya yakin mau membuka kunci</b>
            <small>Setelah terbuka, semua tombol Stop / Restart / Hapus aktif. Tekan ESC atau tutup tab untuk mengunci ulang.</small>
          </span>
        </button>

        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>Batal</button>
          <button
            className={`btn ${checked ? 'btn-primary' : 'btn-outline'}`}
            disabled={!checked || busy}
            onClick={submit}
            style={{ opacity: checked || busy ? 1 : 0.5 }}
          >
            <UnlockIcon size={14} /> {busy ? 'Membuka...' : 'Buka Kunci'}
          </button>
        </div>
      </div>
    </div>
  );
}
