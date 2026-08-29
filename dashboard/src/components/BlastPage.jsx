import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  QrIcon, ImageIcon, UploadIcon, ZapIcon, PlayIcon, PauseIcon,
  StopIcon, TrashIcon, AlertIcon, ServerIcon, ScriptIcon, LogIcon
} from './Icons.jsx';

const MIN_DELAY = 7;

function normalizeNumber(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  if (!d.startsWith('62') || d.length < 10 || d.length > 15) return null;
  return d;
}

function parseTargetText(text) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  let dupes = 0;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const num = normalizeNumber(rawLine);
    if (!num) {
      const t = rawLine.trim();
      if (t && /\d/.test(t)) invalid.push(t.slice(0, 18));
      continue;
    }
    if (seen.has(num)) { dupes += 1; continue; }
    seen.add(num);
    valid.push(num);
  }
  return { valid, dupes, invalid };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function waPreview(text) {
  let h = escapeHtml(text || '(tidak ada teks)');
  h = h.replace(/\*(.+?)\*/g, '<b>$1</b>');
  h = h.replace(/_(.+?)_/g, '<i>$1</i>');
  h = h.replace(/~(.+?)~/g, '<s>$1</s>');
  h = h.replace(/`(.+?)`/g, '<code>$1</code>');
  h = h.replace(/\n/g, '<br/>');
  return h;
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

async function blastApi(path, options) {
  const res = await fetch('/api/blast' + path, options);
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

export default function BlastPage({ showToast }) {
  const [session, setSession] = useState(null);
  const [job, setJob] = useState(null);
  const [senders, setSenders] = useState([]);
  const [variants, setVariants] = useState([{ text: '', image: null, preview: null }]);
  const [activeV, setActiveV] = useState(0);
  const [targetText, setTargetText] = useState('');
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(20);
  const [distribution, setDistribution] = useState('roundrobin');
  const [blockSize, setBlockSize] = useState(100);
  const [busy, setBusy] = useState('');
  const [qrSlide, setQrSlide] = useState(0);
  const [draftReady, setDraftReady] = useState(false);
  const [batchNext, setBatchNext] = useState(null);
  const taRef = useRef(null);

  const refreshSession = () => blastApi('/session').then(setSession).catch(() => setSession({ offline: true, slots: [], connected_slots: [] }));
  const refreshJob = () => blastApi('/job').then((j) => setJob(j.job)).catch(() => {});

  useEffect(() => {
    refreshSession();
    refreshJob();
    const a = setInterval(refreshSession, 6000);
    const b = setInterval(refreshJob, 2500);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  useEffect(() => {
    blastApi('/draft')
      .then((d) => {
        if (Array.isArray(d.variants) && d.variants.length) {
          setVariants(d.variants.map((v) => ({
            text: v.text || '',
            image: v.image || null,
            preview: v.image ? `/api/blast/upload/${v.image}` : null
          })));
        }
        if (typeof d.targets_text === 'string') setTargetText(d.targets_text);
        const st = d.settings;
        if (st) {
          if (st.delay_min_s >= MIN_DELAY) setDelayMin(st.delay_min_s);
          if (st.delay_max_s >= MIN_DELAY) setDelayMax(st.delay_max_s);
          setDistribution(st.distribution || 'roundrobin');
          if (st.block_size) setBlockSize(st.block_size);
        }
        if (d.batch_last_no) setBatchNext(d.batch_last_no);
      })
      .catch(() => {})
      .finally(() => setTimeout(() => setDraftReady(true), 60));
  }, []);

  useEffect(() => {
    if (!draftReady) return undefined;
    const t = setTimeout(() => {
      blastApi('/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variants: variants.map((x) => ({ text: x.text, image: x.image })),
          targets_text: targetText,
          settings: {
            delay_min_s: delayMin,
            delay_max_s: Math.max(delayMin, delayMax),
            distribution,
            block_size: blockSize
          }
        })
      }).catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  }, [variants, targetText, delayMin, delayMax, distribution, blockSize, draftReady]);

  const slots = session ? session.slots || [] : [];
  const connectedSlots = session ? session.connected_slots || [] : [];

  useEffect(() => {
    if (!session) return;
    setSenders((prev) => {
      const kept = prev.filter((s) => connectedSlots.includes(s));
      return kept.length ? kept : connectedSlots;
    });
  }, [session && session.connected_slots.join(',')]);

  const parsed = useMemo(() => parseTargetText(targetText), [targetText]);

  const v = variants[activeV];

  const setText = (text) => {
    setVariants((vs) => vs.map((x, i) => (i === activeV ? { ...x, text } : x)));
  };

  const wrapSelection = (mark) => {
    const el = taRef.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    if (s === e) {
      setText(v.text.slice(0, s) + mark + mark + v.text.slice(e));
      setTimeout(() => { el.focus(); el.setSelectionRange(s + mark.length, s + mark.length); }, 0);
      return;
    }
    const inner = v.text.slice(s, e);
    setText(v.text.slice(0, s) + mark + inner + mark + v.text.slice(e));
    setTimeout(() => { el.focus(); el.setSelectionRange(s + mark.length, e + mark.length); }, 0);
  };

  const handleImage = (file) => {
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) return showToast('error', 'Format harus JPG/PNG/WEBP');
    if (file.size > 9 * 1024 * 1024) return showToast('error', 'Maksimal 9MB');
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy('upload');
      try {
        const res = await blastApi('/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, data: reader.result })
        });
        setVariants((vs) => vs.map((x, i) => (i === activeV ? { ...x, image: res.name, preview: `/api/blast/upload/${res.name}` } : x)));
        showToast('success', 'Gambar terunggah');
      } catch (e) {
        showToast('error', e.message);
      } finally {
        setBusy('');
      }
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => setVariants((vs) => vs.map((x, i) => (i === activeV ? { ...x, image: null, preview: null } : x)));

  const readFileToTextarea = (file, isExcel) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      let content = '';
      if (isExcel) {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
          content = rows.flat().map((c) => String(c == null ? '' : c)).filter((c) => /\d{8,}/.test(c.replace(/\D/g, ''))).join('\n');
        } catch {
          return showToast('error', 'Gagal membaca file Excel');
        }
      } else {
        content = String(ev.target.result);
      }
      const added = content.split(/\r?\n/).filter(Boolean).length;
      setTargetText((t) => (t ? t + '\n' : '') + content.trim());
      showToast('success', `${file.name}: ${added} baris ditambahkan`);
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };

  const toggleSender = (slot) => {
    setSenders((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));
  };

  const createAndControl = async (startAfter) => {
    const payload = {
      variants: variants.map((x) => ({ text: x.text.trim(), image: x.image })),
      targets: parsed.valid,
      senders,
      delay_min_s: delayMin,
      delay_max_s: Math.max(delayMin, delayMax),
      distribution,
      block_size: blockSize
    };
    if (!payload.variants.some((x) => x.text || x.image)) return showToast('error', 'Isi teks atau gambar dulu');
    if (!payload.targets.length) return showToast('error', 'Belum ada nomor target yang valid');
    if (!payload.senders.length) return showToast('error', 'Pilih minimal 1 nomor pengirim yang tersambung');

    setBusy('create');
    try {
      const created = await blastApi('/job/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast('success', `Antrean dibuat: ${created.summary.total} nomor unik${created.summary.duplicates_removed ? `, ${created.summary.duplicates_removed} duplikat dibuang` : ''}`);
      if (created.job && created.job.batch_no) setBatchNext(created.job.batch_no);
      if (startAfter) {
        await blastApi('/job/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' })
        });
        showToast('success', 'Blast dimulai');
      }
      refreshJob();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusy('');
    }
  };

  const control = async (action) => {
    setBusy(action);
    try {
      const res = await blastApi('/job/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      showToast('success', res.message);
      refreshJob();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusy('');
    }
  };

  const removeQueue = async () => {
    setBusy('del');
    try {
      const res = await blastApi('/job', { method: 'DELETE' });
      showToast('success', res.message);
      setJob(null);
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusy('');
    }
  };

  const logoutSlot = async (slot) => {
    setBusy('logout' + slot);
    try {
      const res = await blastApi('/session/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot })
      });
      showToast('success', res.message);
      refreshSession();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusy('');
    }
  };

  const [statusTab, setStatusTab] = useState('waiting');
  const canStart = !!parsed.valid.length && variants.some((x) => x.text.trim() || x.image) && senders.length > 0;
  const jobActive = job && ['queued', 'running', 'paused'].includes(job.status);
  const connCount = connectedSlots.length;

  return (
    <div className="blast-page">
      <div className="blast-hero">
        <div>
          <h2>WA Blast Multi-Nomor</h2>
          <p>Kirim gambar + teks ke 999+ peserta, dibagi otomatis ke beberapa nomor pengirim.</p>
        </div>
        <span className={`blast-conn ${connCount > 0 ? 'conn-ok' : 'conn-warn'}`}>
          <span className="dot" /> {connCount}/3 nomor tersambung
        </span>
      </div>

      {session && session.offline && (
        <div className="banner banner-error">
          <AlertIcon size={15} />
          Proses <b>BLASTER</b> sedang mati - yang tampil hanya data tersimpan. Jalankan <b>pm2 start BLASTER</b> untuk menghidupkan. Dashboard & bot lain tetap aman.
        </div>
      )}

      <section className="card blast-session">
        <div className="ws-hero">
          <div className="ws-badge"><QrIcon size={22} /></div>
          <div className="ws-hero-text">
            <h3>Sambungkan Nomor WhatsApp</h3>
            <p>Maksimal 3 nomor pengirim • sesi tersimpan permanen di laptop ini</p>
          </div>
          <span className={`ws-pill ${connCount > 0 ? 'on' : ''}`}>{connCount}/3 AKTIF</span>
        </div>

        <div className="ws-body">
          <ol className="ws-steps">
            <li><b>Buka WhatsApp</b> di HP nomor yang mau jadi pengirim</li>
            <li>Ketuk menu <b>⋮</b> lalu pilih <b>Perangkat Terhubung</b></li>
            <li>Pilih <b>Tautkan Perangkat</b>, arahkan kamera ke QR di samping</li>
          </ol>

          <div className="ws-qr">
            <div className="qr-carousel">
          <button type="button" className="qr-arrow" aria-label="QR sebelumnya" onClick={() => setQrSlide((qrSlide + 2) % 3)}>
            ‹
          </button>

          {(() => {
            const list = slots.length ? slots : [{ slot: 's1', state: 'connecting' }, { slot: 's2', state: 'disconnected' }, { slot: 's3', state: 'disconnected' }];
            const s = list[Math.min(qrSlide, list.length - 1)] || list[0];
            return (
              <div className={`qr-slot ${s.state}`}>
                <div className="qr-slot-head">
                  <b>Nomor {s.slot.replace('s', '')}</b>
                  <span className={`tag ${s.state === 'connected' ? 'tag-ok' : s.state === 'waiting_scan' ? 'tag-info' : s.state === 'logged_out' ? 'tag-warn' : 'tag-dim'}`}>
                    {s.state === 'connected' ? 'TERSAMBUUNG' : s.state === 'waiting_scan' ? 'SCAN QR' : s.state === 'logged_out' ? 'LOGOUT' : s.state === 'connecting' ? 'MENGHUBUNGKAN' : 'BELUM ADA'}
                  </span>
                </div>
                <div className="qr-mini">
                  {s.qr ? <img src={s.qr} alt={'QR ' + s.slot} /> : <div className="qr-empty">{s.state === 'connected' ? 'Sudah masuk ✓' : s.state === 'connecting' || s.state === 'disconnected' ? 'Menyambung...' : 'Menunggu...'}</div>}
                </div>
                {s.user && <div className="qr-user">+{String(s.user).split('@')[0].split(':')[0]}</div>}
                {s.state === 'connected' && (s.connected_sec || 0) > 0 && (
                  <div className="qr-durasi">⏱ {s.user ? `Nomor ${String(s.user).split('@')[0].split(':')[0]} • ` : ''}Terhubung selama {formatDurasi(s.connected_sec)}</div>
                )}
                {(s.user || s.state === 'logged_out') && (
                  <button className="btn btn-ghost btn-sm" disabled={busy === 'logout' + s.slot} onClick={() => logoutSlot(s.slot)}>
                    Reset sesi ini
                  </button>
                )}
              </div>
            );
          })()}

          <button type="button" className="qr-arrow" aria-label="QR berikutnya" onClick={() => setQrSlide((qrSlide + 1) % 3)}>
            ›
          </button>
        </div>
        <div className="qr-dots">
          {[0, 1, 2].map((i) => (
            <button key={i} type="button" aria-label={'Nomor ' + (i + 1)} className={`qr-dot ${qrSlide === i ? 'on' : ''}`} onClick={() => setQrSlide(i)} />
          ))}
        </div>
          </div>
        </div>
      </section>

      <div className="blast-grid">
        <section className="card blast-composer">
          <div className="blast-card-head">
            <h3><ScriptIcon size={16} /> Pesan Blast</h3>
            <div className="variant-tabs">
              {variants.map((_, i) => (
                <button key={i} type="button" className={`tab ${activeV === i ? 'tab-active' : ''}`} onClick={() => setActiveV(i)}>
                  Versi {i + 1}
                </button>
              ))}
              {variants.length < 3 && (
                <button type="button" className="tab tab-add" onClick={() => { setVariants((v) => [...v, { text: '', image: null, preview: null }]); setActiveV(variants.length); }}>+</button>
              )}
              {variants.length > 1 && (
                <button type="button" className="tab" title="Hapus varian aktif" onClick={() => { setVariants((vs) => vs.filter((_, i) => i !== activeV)); setActiveV(0); }}>x</button>
              )}
            </div>
          </div>

          <div className="vartoolbar">
            <button type="button" onClick={() => wrapSelection('*')}><b>B</b></button>
            <button type="button" onClick={() => wrapSelection('_')}><i>I</i></button>
            <button type="button" onClick={() => wrapSelection('~')}><s>S</s></button>
            <button type="button" onClick={() => wrapSelection('`')}>Mono</button>
            <label className="vt-img">
              <ImageIcon size={14} /> {busy === 'upload' ? 'Mengunggah...' : v.image ? 'Ganti gambar' : 'Lampir gambar'}
              <input type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handleImage(e.target.files[0])} />
            </label>
            {v.image && <button type="button" className="vt-remove-img" onClick={removeImage}>Hapus gambar</button>}
          </div>

          <textarea
            ref={taRef}
            value={v.text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Contoh (format WA: *tebal* _miring_ ~coret~ `mono`):\n*Kepada Yth Bapak/Ibu* _Terhormat_\n\nAssalamualaikum, webinar *GRATIS* akan dimulai...'}
            rows={7}
          />

          <div className="preview-row">
            <div className="wa-bubble">
              {v.preview ? <img src={v.preview} alt="" /> : null}
              <div className="wa-text" dangerouslySetInnerHTML={{ __html: waPreview(v.text) }} />
              <span className="wa-time">{new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })} ✓✓</span>
            </div>
            <span className="char-count">{(v.text || '').length}/60000</span>
          </div>

          {!!v.image && v.text.length > 1000 && (
            <p className="mode-note">
              📌 Caption panjang ({v.text.length} karakter) tetap dikirim <b>utuh dalam satu chat bersama gambarnya</b>.
            </p>
          )}

          <p className="dist-hint">Konten dikirim PERSIS seperti ditulis - sistem tidak mengubah kalimat/foto kantor sama sekali.</p>
        </section>

        <section className="card blast-targets">
          <div className="blast-card-head">
            <h3><ServerIcon size={16} /> Target Peserta</h3>
            <span className="tag tag-ok">{parsed.valid.length} nomor siap</span>
          </div>

          <div className="target-actions">
            <label className="btn btn-outline btn-sm">
              <UploadIcon size={13} /> CSV
              <input type="file" accept=".csv,.txt" hidden onChange={(e) => readFileToTextarea(e.target.files[0], false)} />
            </label>
            <label className="btn btn-outline btn-sm">
              <UploadIcon size={13} /> Excel
              <input type="file" accept=".xlsx,.xls" hidden onChange={(e) => readFileToTextarea(e.target.files[0], true)} />
            </label>
            <span className="target-hint">atau tempel di bawah - 1 baris = 1 nomor</span>
          </div>

          <textarea
            className="targets-area"
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
            placeholder={'08123456789\n6281234567890\n0812 3456 7890'}
            rows={8}
          />

          <div className="target-stats">
            <span className="tag tag-ok">{parsed.valid.length} unik</span>
            {parsed.dupes > 0 && <span className="tag tag-dim">{parsed.dupes} duplikat dibuang</span>}
            {parsed.invalid.length > 0 && <span className="tag tag-warn" title={parsed.invalid.join(', ')}>{parsed.invalid.length} tak valid</span>}
            <span className="eta-note">
              ≈ {(() => {
                const avg = ((Math.max(MIN_DELAY, delayMin) + Math.max(MIN_DELAY, delayMax)) / 2) / Math.max(1, senders.length);
                const mins = Math.round((parsed.valid.length * avg) / 60);
                return mins >= 60 ? `${Math.floor(mins / 60)} jam ${mins % 60} mnt` : `${mins} menit`;
              })()}
            </span>
          </div>

          <div className="sender-pick">
            <span className="field-label"><ZapIcon size={13} /> Kirim dari:</span>
            {slots.map((s) => (
              <label key={s.slot} className={`radio-chip ${senders.includes(s.slot) ? 'chip-on' : ''} ${s.state !== 'connected' ? 'chip-off' : ''}`} title={s.state !== 'connected' ? 'Scan QR nomor ini dulu' : ''}>
                <input type="checkbox" checked={senders.includes(s.slot)} disabled={s.state !== 'connected'} onChange={() => toggleSender(s.slot)} />
                Nomor {s.slot.replace('s', '')}
              </label>
            ))}
            {connCount === 0 && <span className="dist-note">(scan minimal 1 QR di atas)</span>}
          </div>

          <div className="delay-row">
            <span className="field-label">Jeda acak (detik):</span>
            <input type="number" min={MIN_DELAY} max={600} value={delayMin} onChange={(e) => setDelayMin(Math.max(MIN_DELAY, Number(e.target.value) || MIN_DELAY))} />
            <span>s/d</span>
            <input type="number" min={delayMin} max={600} value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value) || delayMin)} />
          </div>
        </section>
      </div>

      <section className="card blast-control">
        <div className="blast-card-head">
          <h3><ZapIcon size={16} /> Kendali Blast {job && <span className="tag tag-info">Batch #{job.batch_no}</span>}</h3>
          {job && <span className={`badge st-${job.status === 'running' || job.status === 'done' ? 'online' : job.status === 'paused' ? 'warn' : 'stopped'}`}>{String(job.status).toUpperCase()}</span>}
        </div>

        {jobActive && (
          <p className="dist-hint" style={{ marginTop: -6, marginBottom: 12 }}>
            ✏️ Editor tetap bisa kamu isi untuk persiapan batch berikutnya — aman, tidak memengaruhi Batch #{job.batch_no} ({job.totals.all} nomor) yang sedang terdaftar.
          </p>
        )}

        {job && job.pause_reason && (
          <div className="banner banner-warn" style={{ marginBottom: 12 }}>
            <AlertIcon size={14} /> {job.pause_reason}
          </div>
        )}

        {!jobActive ? (
          <>
            <div className="control-row next-batch-line">
              <span className="tag tag-info">Batch berikutnya: #{(batchNext ?? 0) + 1}</span>
              <span className="control-hint">{parsed.valid.length} nomor siap di antrean draft</span>
            </div>
            <div className="control-row">
              <button className="btn btn-primary" disabled={!canStart || busy === 'create'} onClick={() => createAndControl(true)}>
                <PlayIcon size={14} /> {busy === 'create' ? 'Memproses...' : `Buat & Mulai Batch #${(batchNext ?? 0) + 1}`}
              </button>
              <button className="btn btn-outline" disabled={!canStart || !connectedSlots.length || busy === 'create'} onClick={() => createAndControl(false)}>
                Simpan Antrean saja
              </button>
              {!canStart && <span className="control-hint">Lengkapi pesan, target, dan pilih pengirim dulu.</span>}
            </div>
          </>
        ) : (
          <div className="control-row">
            {job.status === 'running' && (
              <button className="btn btn-outline" disabled={busy === 'pause'} onClick={() => control('pause')}>
                <PauseIcon size={13} /> Jeda
              </button>
            )}
            {(job.status === 'paused' || job.status === 'queued') && (
              <button className="btn btn-success" disabled={busy === 'resume'} onClick={() => control('resume')}>
                <PlayIcon size={13} /> Lanjut
              </button>
            )}
            <button className="btn btn-danger-outline" disabled={busy === 'stop'} onClick={() => control('stop')}>
              <StopIcon size={13} /> Stop Permanen
            </button>
            {['stopped', 'done'].includes(job.status) && (
              <button className="btn btn-ghost btn-danger-text" disabled={busy === 'del'} onClick={removeQueue}>
                <TrashIcon size={13} /> Bersihkan antrean
              </button>
            )}
          </div>
        )}

        {job && (
          <div className="progress-wrap">
            <div className="minibar-head">
              <span>{job.totals.sent + job.totals.failed}/{job.totals.all} diproses</span>
              <b>{job.totals.pct}%</b>
            </div>
            <div className="bar">
              <div className="bar-fill bar-ok" style={{ width: `${job.totals.pct}%` }} />
            </div>
            <div className="prog-stats">
              <span className="tag tag-ok">Terkirim: {job.totals.sent}</span>
              {job.totals.failed > 0 && <span className="tag tag-warn">Gagal: {job.totals.failed}</span>}
              <span className="tag tag-dim">Sisa: {job.totals.pending}</span>
              {Object.entries(job.per_sender || {}).map(([s, c]) => (
                <span key={s} className="tag tag-info">{s.toUpperCase()}: {c} target</span>
              ))}
              {job.status === 'running' && job.next_at && <span className="tag tag-dim">next {new Date(job.next_at).toLocaleTimeString('id-ID', { hour12: false })}</span>}
            </div>
          </div>
        )}
      </section>

      {job && (
        <section className="card blast-logcard">
          <div className="blast-card-head">
            <h3><LogIcon size={15} /> Status Nomor</h3>
            {job.status === 'running' && job.next_at && (
              <span className="tag tag-info">kirim berikutnya {new Date(job.next_at).toLocaleTimeString('id-ID', { hour12: false })}</span>
            )}
          </div>

          <div className="status-tabs">
            <button type="button" className={`stab ${statusTab === 'sent' ? 'on' : ''}`} onClick={() => setStatusTab('sent')}>
              Terkirim <b>{job.totals.sent}</b>
            </button>
            <button type="button" className={`stab ${statusTab === 'waiting' ? 'on' : ''}`} onClick={() => setStatusTab('waiting')}>
              Waiting List <b>{job.totals.pending}</b>
            </button>
            <button type="button" className={`stab ${statusTab === 'failed' ? 'on' : ''}`} onClick={() => setStatusTab('failed')}>
              Gagal <b>{job.totals.failed}</b>
            </button>
          </div>

          <div className="blast-table">
            {(() => {
              const rows = statusTab === 'sent'
                ? (job.lists && job.lists.sent) || []
                : statusTab === 'failed'
                  ? (job.lists && job.lists.failed) || []
                  : (job.lists && job.lists.waiting) || [];

              if (!rows.length) {
                return (
                  <div className="log-empty">
                    {statusTab === 'sent' && 'Belum ada nomor yang terkirim.'}
                    {statusTab === 'waiting' && (job.totals.pending === 0 ? 'Tidak ada lagi di waiting list - semua sudah diproses.' : 'Menunggu antrean dimulai.')}
                    {statusTab === 'failed' && 'Tidak ada nomor yang gagal. Bagus!'}
                  </div>
                );
              }

              return rows.map((t, i) => (
                <div key={i} className="incident-row">
                  <span className={`incident-dot ${t.status === 'sent' ? 'dot-ok' : t.status === 'failed' ? 'dot-bad' : ''}`} style={t.status === 'pending' ? { background: '#64748b' } : {}} />
                  <div className="incident-main">
                    <b>+{t.num}</b>
                    <span className="incident-sub">
                      via {(t.sender_slot || '?').toUpperCase()} • varian {(t.variant_index ?? 0) + 1}
                      {t.error ? ` • ${t.error}` : ''}
                      {t.ts ? ` • ${new Date(t.ts).toLocaleTimeString('id-ID', { hour12: false })}` : ''}
                      {statusTab === 'waiting' && i === 0 && job.status === 'running' ? ' • BERIKUTNYA' : ''}
                    </span>
                  </div>
                  <span className={`tag ${t.status === 'sent' ? 'tag-ok' : t.status === 'failed' ? 'tag-warn' : 'tag-dim'}`}>
                    {t.status === 'pending' ? `#${job.targets.findIndex((x) => x.jid === t.jid) + 1}` : t.status}
                  </span>
                </div>
              ));
            })()}
          </div>
        </section>
      )}
    </div>
  );
}
