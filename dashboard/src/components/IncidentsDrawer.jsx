import { useEffect, useState } from 'react';
import { fetchIncidents, clearIncidents } from '../api.js';
import { formatUptime } from '../format.js';
import { CloseIcon, AlertIcon, CheckCircleIcon, TrashIcon } from './Icons.jsx';

const REFRESH_MS = 10000;

export default function IncidentsDrawer({ onClose }) {
  const [incidents, setIncidents] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const fetchIt = async () => {
      try {
        const res = await fetchIncidents();
        if (!alive) return;
        setIncidents(res.incidents || []);
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

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    try {
      await clearIncidents();
      setIncidents([]);
      setConfirmClear(false);
    } catch (e) {
      setError(e.message);
      setConfirmClear(false);
    }
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer drawer-narrow">
        <div className="drawer-head">
          <div className="drawer-title">
            <HistoryTitle />
            <h3>Riwayat Insiden</h3>
          </div>
          <div className="drawer-tools">
            <button
              className={`btn btn-sm ${confirmClear ? 'btn-danger' : 'btn-ghost'}`}
              onClick={handleClear}
              title="Bersihkan seluruh riwayat"
            >
              <TrashIcon size={13} /> {confirmClear ? 'Yakin?' : 'Bersihkan'}
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Tutup"><CloseIcon /></button>
          </div>
        </div>

        <div className="data-body">
          {error && <div className="log-error">{error}</div>}
          {!error && incidents === null && <div className="log-empty">Memuat...</div>}
          {incidents && incidents.length === 0 && (
            <div className="log-empty">Belum ada insiden tercatat. Pemeriksaan berjalan otomatis tiap 60 detik meski dashboard tidak dibuka.</div>
          )}
          {incidents && incidents.map((it, i) => (
            <div key={i} className="incident-row">
              <span className={`incident-dot ${it.event === 'down' ? 'dot-bad' : 'dot-ok'}`} />
              <div className="incident-main">
                <b>{it.name}</b> {it.event === 'down' ? 'MATI / bermasalah' : 'kembali online'}
                <span className="incident-sub">
                  {it.from} → {it.to}
                  {it.downtime_ms ? ` • mati selama ${formatUptime(it.downtime_ms)}` : ''}
                  {i === 0 ? ' • terbaru' : ''}
                </span>
              </div>
              <span className="incident-time">{new Date(it.ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
            </div>
          ))}
        </div>

        <div className="drawer-foot">
          <span>Pencatatan berjalan di server dashboard tiap 1 menit, tersimpan di incidents.json</span>
        </div>
      </aside>
    </>
  );
}

function HistoryTitle() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><line x1="12" y1="7" x2="12" y2="12" /><line x1="12" y1="12" x2="15" y2="14" />
    </svg>
  );
}
