import { useEffect, useMemo, useState } from 'react';
import { CloseIcon, SearchIcon, DatabaseIcon } from './Icons.jsx';

const REFRESH_MS = 10000;

export default function DataPanel({ onClose }) {
  const [datasets, setDatasets] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const fetchIt = async () => {
      try {
        const res = await fetch('/api/datasets').then((r) => r.json());
        if (!alive) return;
        if (res.error) throw new Error(res.error);
        setDatasets(res.datasets || []);
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

  const filtered = useMemo(() => {
    if (!datasets) return null;
    if (!query.trim()) return datasets;
    const q = query.toLowerCase();
    return datasets.map((ds) => ({
      ...ds,
      rows: ds.rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
    }));
  }, [datasets, query]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="drawer-title">
            <DatabaseIcon size={17} />
            <h3>Data Bot</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup"><CloseIcon /></button>
        </div>

        <div className="drawer-search">
          <SearchIcon size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari di semua data... (nama grup, nama acara, status)"
          />
        </div>

        <div className="data-body">
          {error && <div className="log-error">Gagal memuat: {error}</div>}
          {!error && !filtered && <div className="log-empty">Memuat data...</div>}
          {filtered && filtered.map((ds) => (
            <section key={ds.id} className="dataset">
              <div className="dataset-head">
                <h4>{ds.label}</h4>
                {ds.ok ? (
                  <span className="tag tag-info">{ds.id === 'statistik-menu' ? `${ds.rows.length} pemilihan` : `${ds.count} item`}</span>
                ) : (
                  <span className="tag tag-warn">tidak tersedia</span>
                )}
              </div>
              <p className="dataset-desc">{ds.desc}{ds.ok ? ` • file berubah: ${new Date(ds.updated_at).toLocaleString('id-ID')}` : ''}</p>
              {!ds.ok && <div className="data-error">{ds.error}</div>}
              {ds.ok && ds.id === 'statistik-menu' && <MenuStats rows={ds.rows} />}
              {ds.ok && ds.id !== 'statistik-menu' && ds.rows.length === 0 && (
                <div className="log-empty">{query.trim() ? 'Tidak ada yang cocok.' : 'Data masih kosong.'}</div>
              )}
              {ds.ok && ds.id !== 'statistik-menu' && ds.rows.map((row, i) => (
                <div key={i} className="data-row">
                  {Object.entries(row).map(([k, v]) => (
                    <span key={k} className="kv" title={`${k}: ${v}`}>
                      <b>{k}</b>{typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </span>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="drawer-foot">
          <span>Data dibaca langsung dari file JSON bot (read-only)</span>
        </div>
      </aside>
    </>
  );
}

function MenuStats({ rows }) {
  const counts = {};
  const users = new Set();
  let last = 0;
  for (const r of rows) {
    counts[r.pilihan] = (counts[r.pilihan] || 0) + 1;
    if (r.user_phone) users.add(r.user_phone);
    if (r.waktu > last) last = r.waktu;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...sorted.map(([, c]) => c), 1);

  return (
    <div className="menu-stats">
      <div className="menu-chips">
        <span className="tag tag-info">{users.size} pengguna unik</span>
        <span className="tag tag-ok">terakhir: {last ? new Date(last).toLocaleDateString('id-ID') : '-'}</span>
      </div>
      {sorted.map(([menu, count]) => (
        <div key={menu} className="menu-row">
          <span className="menu-label">Menu {menu}</span>
          <div className="bar">
            <div className="bar-fill bar-ok" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <b className="menu-count">{count}x</b>
        </div>
      ))}
      {sorted.length === 0 && <div className="log-empty">Belum ada data pemilihan menu.</div>}
    </div>
  );
}
