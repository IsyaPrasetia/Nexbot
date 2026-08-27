import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchLogs, fetchAllLogs, openFolder } from '../api.js';
import { formatBytes } from '../format.js';
import { CloseIcon, SearchIcon, FolderOpenIcon } from './Icons.jsx';

const REFRESH_MS = 4000;

function nameColorClass(n) {
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 5;
  return `cn-${h}`;
}

export default function LogsDrawer({ target, onClose }) {
  const isAll = target.name === '__ALL__';
  const [stream, setStream] = useState(target.stream || 'out');
  const [rows, setRows] = useState([]);
  const [lineCount, setLineCount] = useState(300);
  const [query, setQuery] = useState('');
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const bodyRef = useRef(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    let alive = true;
    const fetchIt = async () => {
      try {
        const res = isAll
          ? await fetchAllLogs(stream, lineCount)
          : await fetchLogs(target.name, stream, lineCount);
        if (!alive) return;
        setRows(res.lines || []);
        setInfo(res);
        setError(null);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    setLoading(true);
    setRows([]);
    setQuery('');
    pinnedRef.current = true;
    fetchIt();
    const t = setInterval(fetchIt, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [isAll, target.name, stream, lineCount]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) =>
      typeof r === 'string'
        ? r.toLowerCase().includes(q)
        : r.t.toLowerCase().includes(q) || r.n.toLowerCase().includes(q)
    );
  }, [rows, query]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && pinnedRef.current && !query) el.scrollTop = el.scrollHeight;
  }, [filtered, query]);

  const handleScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="drawer-title">
            <h3>{isAll ? 'Log Semua Bot' : `Log: ${target.name}`}</h3>
            <div className="tabs">
              <button className={`tab ${stream === 'out' ? 'tab-active' : ''}`} onClick={() => setStream('out')}>OUT</button>
              <button className={`tab ${stream === 'err' ? 'tab-active tab-err' : ''}`} onClick={() => setStream('err')}>ERR</button>
            </div>
          </div>
          <div className="drawer-tools">
            <select value={lineCount} onChange={(e) => setLineCount(Number(e.target.value))} className="select">
              <option value={200}>200 baris</option>
              <option value={500}>500 baris</option>
              <option value={1000}>1000 baris</option>
            </select>
            <button className="icon-btn" onClick={onClose} aria-label="Tutup"><CloseIcon /></button>
          </div>
        </div>

        <div className="drawer-search">
          <SearchIcon size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari di log... (misal: error, QR, debug)"
          />
          <span className="search-count">
            {query.trim() ? `${filtered.length}/${rows.length} cocok` : `${rows.length} baris`}
          </span>
        </div>

        <div className="log-body" ref={bodyRef} onScroll={handleScroll}>
          {error && <div className="log-error">Gagal memuat log: {error}</div>}
          {!error && filtered.length === 0 && !loading && (
            <div className="log-empty">
              {query.trim() ? 'Tidak ada baris yang cocok dengan pencarian.' : `Belum ada isi log untuk stream ${stream.toUpperCase()}.`}
            </div>
          )}
          {filtered.map((r, i) => {
            const text = typeof r === 'string' ? r : r.t;
            const name = typeof r === 'string' ? null : r.n;
            return (
              <div key={i} className={`log-line ${/\b(error|gagal|failed)\b/i.test(text) ? 'log-line-bad' : ''}`}>
                {name && <span className={`log-chip ${nameColorClass(name)}`}>{name}</span>}
                {text || '\u00a0'}
              </div>
            );
          })}
        </div>

        <div className="drawer-foot">
          <span title={info?.file_path}>
            {isAll
              ? 'Gabungan log semua bot, diurutkan berdasarkan waktu'
              : info?.file_path || '-'}
          </span>
          <span className="drawer-foot-right">
            {info && !isAll
              ? `${formatBytes(info.file_size)}${info.truncated ? ' • 256KB terakhir' : ''}`
              : ''}
            <button
              className="btn btn-ghost btn-sm"
              title="Buka folder di Windows Explorer"
              onClick={() => openFolder(isAll ? { type: 'logs' } : { type: 'proc', name: target.name })}
            >
              <FolderOpenIcon size={13} /> Explorer
            </button>
          </span>
        </div>
      </aside>
    </>
  );
}
