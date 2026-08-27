import { useEffect, useState } from 'react';
import { fetchLoginLog } from '../api.js';
import { CloseIcon } from './Icons.jsx';

const REFRESH_MS = 10000;

export default function LoginLogDrawer({ onClose }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const fetchIt = async () => {
      try {
        const res = await fetchLoginLog();
        if (!alive) return;
        setEntries(res.entries || []);
        setError(null);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    fetchIt();
    const t = setInterval(fetchIt, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer drawer-narrow">
        <div className="drawer-head">
          <div className="drawer-title">
            <KeyTitle />
            <h3>Log Login</h3>
          </div>
          <div className="drawer-tools">
            <button className="icon-btn" onClick={onClose} aria-label="Tutup"><CloseIcon /></button>
          </div>
        </div>

        <div className="data-body">
          {error && <div className="log-error">{error}</div>}
          {!error && entries === null && <div className="log-empty">Memuat...</div>}
          {entries && entries.length === 0 && (
            <div className="log-empty">Belum ada aktivitas login tercatat.</div>
          )}
          {entries && entries.map((it, i) => (
            <div key={i} className="incident-row">
              <span className={`incident-dot ${it.ok ? 'dot-ok' : 'dot-bad'}`} />
              <div className="incident-main">
                <b>{it.user}</b> {it.ok ? 'berhasil masuk' : 'GAGAL masuk'}
                <span className="incident-sub">dari {it.ip}{i === 0 ? ' • terbaru' : ''}</span>
              </div>
              <span className="incident-time">
                {new Date(it.ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            </div>
          ))}
        </div>

        <div className="drawer-foot">
          <span>Mencatat semua percobaan login (sukses & gagal), tersimpan di login-log.jsonl</span>
        </div>
      </aside>
    </>
  );
}

function KeyTitle() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}
