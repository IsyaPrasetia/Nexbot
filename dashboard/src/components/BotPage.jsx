import { useEffect, useRef, useState } from 'react';
import { fetchBotQr } from '../api.js';
import { formatBytes, formatUptime } from '../format.js';
import {
  QrIcon, ImageIcon, AlertIcon, CopyIcon, ServerIcon,
  ZapIcon, CpuIcon
} from './Icons.jsx';
import MenuEditorCard from './MenuEditorCard.jsx';

async function bridgeApi(path, options) {
  const res = await fetch('/api/csbridge' + path, options);
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

async function blastApi(path, options) {
  const res = await fetch('/api/blast' + path, options);
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function waPreviewHtml(text) {
  let h = escapeHtml(text || '(kosong)');
  h = h.replace(/\*(.+?)\*/g, '<b>$1</b>');
  h = h.replace(/_(.+?)_/g, '<i>$1</i>');
  h = h.replace(/~(.+?)~/g, '<s>$1</s>');
  h = h.replace(/`(.+?)`/g, '<code>$1</code>');
  return h.replace(/\n/g, '<br/>');
}

export default function BotPage({ kind, label, proc, net, showToast, onRequestRestart }) {
  const [qr, setQr] = useState(null);
  const [slots, setSlots] = useState(null);
  const [job, setJob] = useState(null);

  const online = proc ? proc.status === 'online' : false;

  // ===== QR polling =====
  useEffect(() => {
    let alive = true;
    const fetchIt = async () => {
      try {
        if (kind === 'admin') {
          const r = await fetchBotQr('admin');
          if (alive) setQr(r);
        } else {
          const r = await bridgeApi('/status');
          if (alive) setSlots(r.slots || []);
        }
      } catch {
        if (alive && kind === 'admin') setQr(null);
      }
    };
    fetchIt();
    const t = setInterval(fetchIt, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [kind]);

  // ===== Konsep pesan live (AI-CS) =====
  useEffect(() => {
    if (kind !== 'cs') return undefined;
    let alive = true;
    const fetchIt = () => blastApi('/job').then((j) => { if (alive) setJob(j.job); }).catch(() => {});
    fetchIt();
    const t = setInterval(fetchIt, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [kind]);

  const connectedCount = slots ? slots.filter((s) => s.connected).length : 0;

  return (
    <div className="bot-page">
      <div className={`bot-hero ${kind}`}>
        <div className="bot-hero-icon">
          {kind === 'cs' ? <ZapIcon size={24} /> : <CpuIcon size={24} />}
        </div>
        <div className="bot-hero-text">
          <h2>{label}</h2>
          <p>{online ? 'Bot production berjalan normal.' : 'Bot TIDAK berjalan - start dari tab Monitor.'}</p>
        </div>
        <span className={`bot-hero-badge ${online ? 'on' : 'off'}`}>
          {online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      <div className="bot-grid">
        {/* ===== Info Proses ===== */}
        <section className="card">
          <div className="blast-card-head"><h3><ServerIcon size={15} /> Info Proses</h3></div>
          <div className="meta" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
            <div className="meta-item"><span className="meta-label">Uptime</span><span className="meta-value">{formatUptime(proc?.uptime_ms)}</span><span className="meta-sub">sejak restart terakhir</span></div>
            <div className="meta-item"><span className="meta-label">Memori</span><span className="meta-value">{formatBytes(proc?.memory || 0)}</span><span className="meta-sub">RAM proses</span></div>
            <div className="meta-item"><span className="meta-label">Restart</span><span className="meta-value">{proc?.restarts ?? '-'}x</span><span className="meta-sub">total sejak daftar</span></div>
            <div className="meta-item"><span className="meta-label">Folder</span><span className="meta-value" style={{ fontSize: 11 }}>{kind === 'cs' ? 'src/modules/cs' : 'src/modules/admin'}</span><span className="meta-sub">edit via tab Files</span></div>
          </div>
          {kind === 'admin' && net && net.ollama && (
            <div style={{ marginTop: 10 }}>
              <span className={`tag ${net.ollama.ok ? 'tag-ok' : 'tag-warn'}`}>
                OLLAMA {net.ollama.ok ? `${net.ollama.models_count} model siap` : 'MATI'}
              </span>
            </div>
          )}
          <div className="control-row" style={{ marginTop: 12 }}>
            <button className="btn btn-outline btn-sm" disabled={!proc} onClick={() => onRequestRestart(proc.name)}>
              Restart {label}
            </button>
          </div>
        </section>

        {/* ===== Bulk Grup (AI-CS) ===== */}
        {kind === 'cs' && (
          <section className="card">
            <div className="blast-card-head"><h3><ZapIcon size={15} /> Bulk Kirim Grup Terdaftar</h3></div>
            <BulkGrupCard showToast={showToast} />
          </section>
        )}
      </div>

      {/* ===== QR SECTION ===== */}
      {kind === 'admin' ? (
        <section className="card bot-session">
          <div className="ws-hero ws-hero-wa">
            <div className="ws-badge"><QrIcon size={22} /></div>
            <div className="ws-hero-text">
              <h3>Koneksi WhatsApp AI-ADMIN</h3>
              <p>Scan saat sesi logout - sesi lama otomatis diarsipkan.</p>
            </div>
          </div>
          <div className="ws-body">
            <AdminQrCard qr={qr} online={online} />
          </div>
        </section>
      ) : (
        <CsSlotSwitcher slots={slots} online={online} showToast={showToast} />
      )}

      {/* ===== KONSEP PESAN LIVE ===== */}
      {kind === 'cs' && (
        <section className="card konsep-card">
          <div className="blast-card-head">
            <h3>Konsep Pesan Live (Prod)</h3>
            {job && <span className="badge st-online">Batch #{job.batch_no} • {String(job.status).toUpperCase()}</span>}
          </div>
          <p className="dist-hint" style={{ marginBottom: 12 }}>
            Pesan yang sedang aktif di production. Tekan kopi, ubah beberapa baris, tempel di form pesan baru.
          </p>
          <div className="variant-grid">
            {(job && job.variants ? job.variants : []).map((v, i) => (
              <div key={i} className="variant-live">
                <div className="variant-live-head">
                  <span className="tag tag-info">Varian {i + 1}{v.image ? ' - gambar' : ''}</span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => copyText(v.text)}>
                      <CopyIcon size={12} /> Kopi
                    </button>
                </div>
                <div className="wa-bubble" style={{ maxWidth: '100%', marginTop: 8 }}>
                  {v.image && <img src={`/api/blast/upload/${v.image}`} alt="" />}
                  <div className="wa-text" dangerouslySetInnerHTML={{ __html: waPreviewHtml(v.text) }} />
                </div>
              </div>
            ))}
            {(!job || !job.variants || !job.variants.length) && (
              <div className="log-empty">Belum ada batch dibuat.</div>
            )}
          </div>
        </section>
      )}

      {/* ===== MENU EDITOR (AI-CS) ===== */}
      {kind === 'cs' && (
        <MenuEditorCard showToast={showToast} />
      )}
    </div>
  );
}

function BulkGrupCard({ showToast }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [st, setSt] = useState(null);

  useEffect(() => {
    let alive = true;
    const f = () => bridgeApi('/bulk-status').then((r) => { if (alive) setSt(r.bulk || null); }).catch(() => {});
    f();
    const t = setInterval(f, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const handleImage = (file) => {
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) return showToast('error', 'Format harus JPG/PNG/WEBP');
    if (file.size > 9 * 1024 * 1024) return showToast('error', 'Maksimal 9MB');
    const reader = new FileReader();
    reader.onload = () => {
      blastApi('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data: reader.result })
      }).then((res) => { setImage(res.name); showToast('success', 'Gambar siap'); })
        .catch((e) => showToast('error', e.message));
    };
    reader.readAsDataURL(file);
  };

  const start = async () => {
    setBusy('go');
    try {
      const res = await bridgeApi('/bulk-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, imageBase64: image })
      });
      showToast('success', res.message || 'Blast dimulai');
      setText('');
      setImage(null);
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusy('');
    }
  };

  const running = st && st.busy;

  return (
    <>
      {!running && (
        <>
          <textarea className="bot-form-area" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={'Teks blast... (format WA: *tebal* _miring_)'} />
          <div className="vartoolbar" style={{ margin: '9px 0' }}>
            <label className="vt-img">
              <ImageIcon size={14} /> {image ? 'Gambar siap' : 'Lampir gambar'}
              <input type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handleImage(e.target.files[0])} />
            </label>
            {image && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImage(null)}>Hapus</button>}
          </div>
          <div className="control-row" style={{ marginBottom: 8 }}>
            {confirm ? (
              <>
                <span className="tag tag-warn">Yakin kirim sekarang?</span>
                <button type="button" className="btn btn-danger btn-sm" disabled={busy === 'go'} onClick={start}>Ya, Kirim</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Batal</button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setConfirm(true)}>Kirim Blast Grup</button>
            )}
          </div>
        </>
      )}
      {st && (
        <div className="progress-wrap">
          <div className="minibar-head">
            <span>Via {(st.sender || '').toUpperCase()} • {st.busy ? 'berjalan...' : st.total ? 'selesai' : 'idle'}</span>
            <b>{st.sent + st.failed}/{st.total || 0}</b>
          </div>
          <div className="bar">
            <div className="bar-fill bar-ok" style={{ width: `${st.total ? Math.round(((st.sent + st.failed) / st.total) * 100) : 0}%` }} />
          </div>
          <div className="prog-stats">
            <span className="tag tag-ok">Terkirim: {st.sent}</span>
            {st.failed > 0 && <span className="tag tag-warn">Gagal: {st.failed}</span>}
          </div>
        </div>
      )}
    </>
  );
}

function connectedCount(slots) {
  return (slots || []).filter((s) => s.connected).length;
}

function CsSlotSwitcher({ slots, online, showToast }) {
  const [active, setActive] = useState(null);
  const [qr, setQr] = useState(null);
  const [spawning, setSpawning] = useState(false);
  const [resetting, setResetting] = useState(false);

  const list = slots || [];

  useEffect(() => {
    if (!list.length) { setActive(null); return; }
    setActive((cur) => (cur && list.some((s) => s.slot === cur) ? cur : list[0].slot));
  }, [list.map((s) => s.slot).join(',')]);

  const activeSlot = list.find((s) => s.slot === active) || null;
  const connected = !!(activeSlot && activeSlot.connected);

  useEffect(() => {
    if (!online || !active || connected) { setQr(null); return undefined; }
    let alive = true;
    const f = () => fetch(`/api/botqr/cs?slot=${active}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j.fresh !== false) setQr(j.qr || null); })
      .catch(() => {});
    f();
    const t = setInterval(f, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [active, online, connected]);

  const nextName = (() => {
    let n = 1;
    const taken = new Set(list.map((s) => s.slot));
    while (taken.has('admin' + n)) n += 1;
    return 'admin' + n;
  })();

  const doSpawn = async () => {
    setSpawning(true);
    try {
      const r = await bridgeApi('/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName })
      });
      showToast('success', r.message || `${nextName} ditambahkan`);
      setActive(nextName);
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setSpawning(false);
    }
  };

  const doReset = async () => {
    setResetting(true);
    try {
      const r = await bridgeApi('/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: active })
      });
      showToast('success', r.message || `Sesi ${active} dihapus`);
      setQr(null);
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="card wa-session-card" style={{ marginTop: 14 }}>
      <div className="blast-card-head">
        <h3><QrIcon size={15} /> Nomor WhatsApp AI-CS</h3>
        <span className={`ws-pill ${connectedCount(list) > 0 ? 'on' : ''}`}>{connectedCount(list)}/{list.length} AKTIF</span>
      </div>
      {!online && (
        <div className="banner banner-warn" style={{ margin: '0 14px 10px' }}>
          <AlertIcon size={13} /> Proses mati — QR tidak muncul. Start dulu dari tab Monitor.
        </div>
      )}
      <div className="wa-session-body">
        <div className="wa-session-qr">
          {connected ? (
            <div className="qr-mini conn">
              <div className="qr-empty">Sudah masuk<br />ke WhatsApp<br />✓</div>
            </div>
          ) : (activeSlot && qr) ? (
            <div className="qr-mini">
              <img src={qr} alt={'QR ' + active} />
            </div>
          ) : (
            <div className="qr-mini">
              <div className="qr-empty">{online ? (active ? 'Menunggu QR...' : 'Pilih nomor') : ''}<br />refresh otomatis</div>
            </div>
          )}
        </div>
        <div className="wa-session-info">
          <div className="wa-session-status">
            <span className={`tag ${connected ? 'tag-ok' : activeSlot && activeSlot.qr_fresh ? 'tag-info' : 'tag-dim'}`}>
              {connected ? 'TERSAMBUUNG' : activeSlot && activeSlot.qr_fresh ? 'SCAN QR' : 'OFFLINE'}
            </span>
            {!connected && activeSlot && activeSlot.qr_fresh && (
              <span className="tag tag-info" style={{ fontSize: 10 }}>QR BARU SIAP SCAN</span>
            )}
          </div>
          <div className="wa-slot-row">
            <span className="wa-slot-label">Nomor:</span>
            <div className="wa-slot-chips">
              {list.map((s) => (
                <button
                  key={s.slot}
                  className={`wa-slot-chip ${s.slot === active ? 'active' : ''}`}
                  onClick={() => setActive(s.slot)}
                  title={`Nomor ${s.slot.replace('admin', '')} (${s.slot})`}
                >
                  {s.slot.replace('admin', '')}
                </button>
              ))}
              <button
                className="wa-slot-chip add"
                disabled={!online || spawning}
                onClick={doSpawn}
                title={`Tambah nomor baru (${nextName})`}
              >
                + {spawning ? '...' : nextName.replace('admin', '')}
              </button>
            </div>
          </div>
          <div className="wa-session-detail">
            <span>{connected ? 'Sudah masuk ke WhatsApp ✓' : 'Scan QR untuk login'}</span>
            <span className="wa-session-sub">
              {connected ? 'Bot menerima pesan normal.' : 'QR berganti sekitar 15-20 detik — scan segera.'}
            </span>
          </div>
          {connected && (
            <div className="control-row" style={{ marginTop: 8 }}>
              <button className="btn btn-outline btn-sm" disabled={resetting} onClick={doReset}>
                {resetting ? 'Menghapus...' : 'Reset sesi ini'}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminQrCard({ qr, online }) {
  return (
    <>
      {!online && (
        <div className="banner banner-warn" style={{ marginBottom: 10 }}>
          <AlertIcon size={13} /> Proses mati - QR tidak muncul. Start dulu dari Monitor.
        </div>
      )}
      <div className="qr-mini" style={{ margin: '0 auto 10px' }}>
        {qr && qr.qr ? (
          <img src={qr.qr} alt="QR AI-ADMIN" />
        ) : (
          <div className="qr-empty">{qrStateText(qr, online)}</div>
        )}
      </div>
      <div className="prog-stats" style={{ justifyContent: 'center' }}>
        {qr && qr.fresh && <span className="tag tag-info">QR BARU SIAP SCAN</span>}
        {qr && !qr.fresh && qr.age_min != null && <span className="tag tag-dim">QR terakhir {qr.age_min} menit lalu</span>}
        {!online && <span className="tag tag-ok">Kemungkinan bot sudah tersambung</span>}
      </div>
    </>
  );
}

function qrStateText(qr, online) {
  if (!qr) return 'Memeriksa...';
  if (qr.fresh) return 'Scan QR ini';
  if (qr.age_min != null) return `QR terakhir ${qr.age_min} menit lalu. Kemungkinan sudah tersambung.`;
  return 'Belum ada QR baru. Kemungkinan sudah tersambung.';
}
