import { AlertIcon } from './Icons.jsx';

export default function ConfirmModal({ open, title, message, confirmLabel, danger, busy, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className={`confirm-icon ${danger ? 'confirm-danger' : 'confirm-warn'}`}>
          <AlertIcon size={22} />
        </div>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>Batal</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={onConfirm}>
            {busy ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
