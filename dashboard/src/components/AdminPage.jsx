import { useState, useEffect } from 'react';
import { formatUptime } from '../format.js';
import {
  CpuIcon, RefreshIcon, ServerIcon, DatabaseIcon, LinkIcon,
  SearchIcon, CheckCircleIcon, AlertIcon, ImageIcon, QrIcon
} from './Icons.jsx';

async function adminApi(path, options) {
  const res = await fetch('/api/adminbridge' + path, options);
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body && body.error) || 'HTTP ' + res.status);
  return body;
}

function timeAgo(ms) {
  if (!ms) return 'Belum pernah';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Baru saja';
  if (min < 60) return min + ' menit lalu';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' jam ' + (min % 60) + ' menit lalu';
  const day = Math.floor(hr / 24);
  return day + ' hari lalu';
}

function daysWord(n) {
  if (n === 0) return 'HARI INI';
  if (n === 1) return '1 hari lagi';
  return n + ' hari lagi';
}

// Format durasi (detik) menjadi "X jam Y menit" / "Y menit" / "Z dtk"
function formatDurasi(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h} jam ${mm} menit` : `${h} jam`;
}

export default function AdminPage({ proc, net, showToast, onRequestRestart }) {
  const [db, setDb] = useState([]);
  const [archive, setArchive] = useState([]);
  const [spreadsheets, setSpreadsheets] = useState([]);
  const [crawlStatus, setCrawlStatus] = useState(null);
  const [countdown, setCountdown] = useState([]);
  const [crawling, setCrawling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [waStatus, setWaStatus] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [slotInfo, setSlotInfo] = useState(null);
  const [switching, setSwitching] = useState(null);

  const online = proc ? proc.status === 'online' : false;

  const loadAll = async () => {
    try {
      const [dbRes, ssRes, csRes, cdRes, waRes] = await Promise.all([
        adminApi('/database'),
        adminApi('/spreadsheets'),
        adminApi('/crawl-status'),
        adminApi('/countdown'),
        adminApi('/status')
      ]);
      setDb(dbRes.database || []);
      setArchive(dbRes.archive || []);
      setSpreadsheets(ssRes.spreadsheets || []);
      setCrawlStatus(csRes);
      setCountdown(cdRes.upcoming || []);
      setWaStatus(waRes);
      setSlotInfo(null);
      try {
        const slotRes = await adminApi('/slot');
        setSlotInfo(slotRes.slots ? slotRes : { slot: slotRes.slot, slots: slotRes.slots });
      } catch (_) {
        setSlotInfo(null);
      }
    } catch (e) {
      showToast('error', 'Gagal muat data: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 10000);
    return () => clearInterval(t);
  }, []);

  const triggerCrawl = async () => {
    setCrawling(true);
    try {
      const r = await adminApi('/crawl', { method: 'POST' });
      showToast('success', r.message || 'Crawl selesai');
      loadAll();
    } catch (e) {
      showToast('error', 'Crawl gagal: ' + e.message);
    } finally {
      setCrawling(false);
    }
  };

  const doReset = async () => {
    setResetting(true);
    try {
      const r = await adminApi('/reset', { method: 'POST' });
      showToast('success', r.message || 'Sesi dihapus');
      setWaStatus(null);
      loadAll();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setResetting(false);
    }
  };

  const doSetSlot = async (slot) => {
    if (slot === slotInfo?.slot) return;
    setSwitching(slot);
    try {
      const r = await adminApi('/setslot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot }) });
      showToast('success', r.message || `Slot diganti ke ${slot}`);
      setWaStatus(null);
      loadAll();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setSwitching(null);
    }
  };

  const belumMasuk = (entitas) => db.filter((d) => d.entitas === entitas && d.statusWebsite === 'BELUM MASUK');
  const sudahMasuk = (entitas) => db.filter((d) => d.entitas === entitas && d.statusWebsite === 'SUDAH MASUK');
  const archiveCount = (entitas) => archive.filter((d) => d.entitas === entitas).length;

  const psiSheet = spreadsheets.find((s) => s.entitas === 'PSI');
  const artSheet = spreadsheets.find((s) => s.entitas === 'Arteria');

  if (loading) {
    return (
      <div className="bot-page">
        <div className="card"><div className="log-empty">Memuat data AI-ADMIN...</div></div>
      </div>
    );
  }

  const waConnected = waStatus && waStatus.connected;

  return (
    <div className="bot-page">
      <div className="bot-hero admin">
        <div className="bot-hero-icon"><CpuIcon size={24} /></div>
        <div className="bot-hero-text">
          <h2>AI-ADMIN</h2>
          <p>Monitor crawler, dokumen PDF, spreadsheet, dan countdown webinar.</p>
        </div>
        <span className={`bot-hero-badge ${online ? 'on' : 'off'}`}>
          {online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* WA SESSION CARD */}
      <section className="card wa-session-card" style={{ marginBottom: 14 }}>
        <div className="blast-card-head"><h3><QrIcon size={15} /> WhatsApp AI-ADMIN</h3></div>
        {!online && (
          <div className="banner banner-warn" style={{ margin: '0 14px 10px' }}>
            <AlertIcon size={13} /> Proses mati — QR tidak muncul. Start dulu dari tab Monitor.
          </div>
        )}
        <div className="wa-session-body">
          <div className="wa-session-qr">
            {waConnected ? (
              <div className="qr-mini conn">
                <div className="qr-empty">Sudah masuk<br />ke WhatsApp<br />✓</div>
              </div>
            ) : (waStatus && waStatus.qr) ? (
              <div className="qr-mini">
                <img src={waStatus.qr} alt="QR AI-ADMIN" />
              </div>
            ) : (
              <div className="qr-mini">
                <div className="qr-empty">Menunggu QR...<br />refresh otomatis</div>
              </div>
            )}
          </div>
          <div className="wa-session-info">
            <div className="wa-session-status">
              <span className={`tag ${waConnected ? 'tag-ok' : 'tag-dim'}`}>
                {waConnected ? 'TERSAMBUUNG' : 'OFFLINE'}
              </span>
              {waConnected && waStatus.nomor && (
                <span className="wa-session-nomor">{waStatus.nomor}</span>
              )}
              {!waConnected && !waStatus?.qrFresh && (
                <span className="tag tag-dim" style={{ fontSize: 10 }}>Belum ada QR baru</span>
              )}
            </div>
            {slotInfo && (
              <div className="wa-slot-row">
                <span className="wa-slot-label">Slot aktif:</span>
                <div className="wa-slot-chips">
                  {(slotInfo.slots || []).map((s) => (
                    <button
                      key={s}
                      className={`wa-slot-chip ${s === slotInfo.slot ? 'active' : ''}`}
                      disabled={switching === s}
                      onClick={() => doSetSlot(s)}
                      title={s === slotInfo.slot ? 'Slot sedang dipakai' : `Pindah ke ${s} (ganti nomor WA)`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {waConnected ? (
              <div className="wa-session-detail">
                <span>Sudah masuk ke WhatsApp ✓</span>
                <span className="wa-session-sub">Bot menerima pesan normal.</span>
                {(waStatus.connected_sec || 0) > 0 && (
                  <span className="wa-session-sub" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                    ⏱ {waStatus.nomor ? `Nomor ${waStatus.nomor} • ` : ''}Terhubung selama {formatDurasi(waStatus.connected_sec)}
                  </span>
                )}
              </div>
            ) : (
              <div className="wa-session-detail">
                <span>Scan QR untuk login</span>
                {waStatus?.qrFresh && <span className="tag tag-info" style={{ fontSize: 10 }}>QR BARU SIAP SCAN</span>}
              </div>
            )}
            {waConnected && (
              <div className="control-row" style={{ marginTop: 8 }}>
                <button className="btn btn-outline btn-sm" disabled={resetting} onClick={doReset}>
                  {resetting ? 'Menghapus...' : 'Reset sesi ini'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="bot-grid">
        <section className="card">
          <div className="blast-card-head"><h3><ServerIcon size={15} /> Info Proses</h3></div>
          <div className="meta" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
            <div className="meta-item"><span className="meta-label">Uptime</span><span className="meta-value">{formatUptime(proc?.uptime_ms)}</span></div>
            <div className="meta-item"><span className="meta-label">Memori</span><span className="meta-value">{(proc?.memory / 1048576 || 0).toFixed(0)} MB</span></div>
            <div className="meta-item"><span className="meta-label">Restart</span><span className="meta-value">{proc?.restarts ?? '-'}x</span></div>
            <div className="meta-item"><span className="meta-label">Ollama</span><span className="meta-value">{net?.ollama?.ok ? net.ollama.models_count + ' model' : 'MATI'}</span></div>
          </div>
          <div className="control-row" style={{ marginTop: 12 }}>
            <button className="btn btn-outline btn-sm" disabled={!proc} onClick={() => onRequestRestart(proc.name)}>
              <RefreshIcon size={13} /> Restart AI-ADMIN
            </button>
          </div>
        </section>

        <section className="card">
          <div className="blast-card-head"><h3><SearchIcon size={15} /> Crawl Website</h3></div>
          <div className="crawl-grid">
            <div className="crawl-card">
              <div className="crawl-card-head">
                <span className="tag tag-info">PSI</span>
                <span className="crawl-time">{timeAgo(crawlStatus?.psi?.lastCrawl)}</span>
              </div>
              <a className="crawl-url" href={crawlStatus?.psi?.url} target="_blank" rel="noreferrer">
                <LinkIcon size={11} /> {crawlStatus?.psi?.url}
              </a>
            </div>
            <div className="crawl-card">
              <div className="crawl-card-head">
                <span className="tag tag-info">Arteria</span>
                <span className="crawl-time">{timeAgo(crawlStatus?.arteria?.lastCrawl)}</span>
              </div>
              <a className="crawl-url" href={crawlStatus?.arteria?.url} target="_blank" rel="noreferrer">
                <LinkIcon size={11} /> {crawlStatus?.arteria?.url}
              </a>
            </div>
          </div>
          <div className="control-row" style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={crawling || !online} onClick={triggerCrawl}>
              {crawling ? <><span className="spinner" /> Crawling...</> : <><SearchIcon size={13} /> Crawl Sekarang</>}
            </button>
          </div>
        </section>
      </div>

      {/* Spreadsheet Tracking */}
      <section className="card" style={{ marginTop: 14 }}>
        <div className="blast-card-head"><h3><DatabaseIcon size={15} /> Spreadsheet Tracking</h3></div>
        <div className="ss-grid">
          <div className="ss-card">
            <div className="ss-card-head">
              <span className="tag tag-info">PSI</span>
              <span className="ss-name">{psiSheet?.namaEvent || 'Belum diset'}</span>
            </div>
            {psiSheet ? (
              <div className="ss-meta">
                <span className="ss-id">{psiSheet.spreadsheetId}</span>
                <span className="ss-updated">Update: {timeAgo(psiSheet.updatedAt ? new Date(psiSheet.updatedAt).getTime() : null)}</span>
              </div>
            ) : (
              <div className="ss-empty">Gunakan perintah <code>!setspread ID NamaEvent</code> di WA grup</div>
            )}
          </div>
          <div className="ss-card">
            <div className="ss-card-head">
              <span className="tag tag-info">Arteria</span>
              <span className="ss-name">{artSheet?.namaEvent || 'Belum diset'}</span>
            </div>
            {artSheet ? (
              <div className="ss-meta">
                <span className="ss-id">{artSheet.spreadsheetId}</span>
                <span className="ss-updated">Update: {timeAgo(artSheet.updatedAt ? new Date(artSheet.updatedAt).getTime() : null)}</span>
              </div>
            ) : (
              <div className="ss-empty">Gunakan perintah <code>!setspread ID NamaEvent</code> di WA grup</div>
            )}
          </div>
        </div>
      </section>

      {/* Dokumen PDF Status */}
      <section className="card" style={{ marginTop: 14 }}>
        <div className="blast-card-head"><h3><ImageIcon size={15} /> Dokumen PDF (Kemenkes)</h3></div>
        <div className="pdf-grid">
          {['PSI', 'Arteria'].map((ent) => (
            <div key={ent} className="pdf-card">
              <div className="pdf-card-head">
                <span className="tag tag-info">{ent}</span>
                <div className="pdf-counts">
                  <span className="tag tag-warn">{belumMasuk(ent).length} belum masuk</span>
                  <span className="tag tag-ok">{sudahMasuk(ent).length} sudah masuk</span>
                  <span className="tag tag-dim">{archiveCount(ent)} arsip</span>
                </div>
              </div>
              {belumMasuk(ent).length > 0 && (
                <div className="pdf-list">
                  {belumMasuk(ent).map((d, i) => (
                    <div key={i} className="pdf-item pdf-pending">
                      <div className="pdf-item-name">{d.namaAcara}</div>
                      <div className="pdf-item-meta">{d.tanggalAcara}</div>
                    </div>
                  ))}
                </div>
              )}
              {belumMasuk(ent).length === 0 && (
                <div className="log-empty" style={{ marginTop: 8 }}>Semua dokumen sudah masuk website</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Countdown Webinar */}
      <section className="card" style={{ marginTop: 14 }}>
        <div className="blast-card-head"><h3>Webinar Terdekat</h3></div>
        {countdown.length > 0 ? (
          <div className="countdown-list">
            {countdown.map((c, i) => (
              <div key={i} className={`countdown-item ${c.hari <= 3 ? 'urgent' : c.hari <= 7 ? 'soon' : ''}`}>
                <div className="countdown-days">
                  <span className="countdown-num">{c.hari}</span>
                  <span className="countdown-label">{daysWord(c.hari)}</span>
                </div>
                <div className="countdown-info">
                  <div className="countdown-name">{c.namaAcara}</div>
                  <div className="countdown-meta">
                    <span className="tag tag-info" style={{ fontSize: 10 }}>{c.entitas}</span>
                    {c.tanggal}
                    <span className={`tag ${c.statusWebsite === 'SUDAH MASUK' ? 'tag-ok' : 'tag-warn'}`} style={{ fontSize: 10 }}>
                      {c.statusWebsite}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="log-empty">Tidak ada webinar mendatang</div>
        )}
      </section>
    </div>
  );
}
