import { useState, useEffect } from 'react';
import { SaveIcon, CheckCircleIcon } from './Icons.jsx';

async function bridgeApi(path, options) {
  const res = await fetch('/api/csbridge' + path, options);
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error((body && body.error) || 'HTTP ' + res.status);
  return body;
}

function waPreview(text) {
  let h = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  h = h.replace(/\*(.+?)\*/g, '<b>$1</b>');
  h = h.replace(/_(.+?)_/g, '<i>$1</i>');
  h = h.replace(/~(.+?)~/g, '<s>$1</s>');
  h = h.replace(/`(.+?)`/g, '<code>$1</code>');
  return h.replace(/\n/g, '<br/>');
}

const MENU_KEYS = [
  { key: 'menu_utama', label: 'Menu Utama', hint: 'Daftar pilihan yang dikirim saat sapaan' },
  { key: 'menu_1a', label: 'Pilihan 1 - Info Promo Webinar', hint: 'Pesan pertama promo' },
  { key: 'menu_1b', label: 'Pilihan 1 - Ajakan Mendaftar', hint: 'Follow-up pilihan 2/3' },
  { key: 'menu_2a', label: 'Pilihan 2 - Cara Pendaftaran', hint: 'Panduan daftar via website' },
  { key: 'menu_3a', label: 'Pilihan 3 - Pendaftaran Langsung', hint: 'Info transfer + form' },
  { key: 'menu_3b', label: 'Pilihan 3 - Form Data', hint: 'Template isi data' },
  { key: 'menu_4a', label: 'Pilihan 4 - Verifikasi / Error', hint: 'Kendala upload' },
  { key: 'menu_4b', label: 'Pilihan 4 - Form Verifikasi', hint: 'Template data verifikasi' },
  { key: 'menu_5a', label: 'Pilihan 5 - Klaim Voucher', hint: 'Info klaim voucher' },
  { key: 'menu_5b', label: 'Pilihan 5 - Form Voucher', hint: 'Template data klaim' },
  { key: 'menu_6a', label: 'Pilihan 6 - Ketentuan Tambahan', hint: 'Aturan & info penting' },
  { key: 'menu_7a', label: 'Pilihan 7 - Customer Care', hint: 'Respons langsung admin' },
];

export default function MenuEditorCard({ showToast }) {
  const [bawaan, setBawaan] = useState({});
  const [overrides, setOverrides] = useState({});
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  const [savedAt, setSavedAt] = useState({});
  const [busyLoad, setBusyLoad] = useState(true);

  useEffect(() => {
    let alive = true;
    bridgeApi('/menus')
      .then((r) => {
        if (!alive) return;
        const b = r.bawaan || {};
        const o = r.overrides || {};
        setBawaan(b);
        setOverrides(o);
        const d = {};
        for (const k of MENU_KEYS.map((x) => x.key)) {
          d[k] = typeof o[k] === 'string' ? o[k] : (typeof b[k] === 'string' ? b[k] : '');
        }
        setDrafts(d);
      })
      .catch((e) => { if (alive) showToast('error', 'Gagal muat menu: ' + e.message); })
      .finally(() => { if (alive) setBusyLoad(false); });
    return () => { alive = false; };
  }, []);

  const effectiveText = (key) => {
    if (typeof overrides[key] === 'string' && overrides[key]) return overrides[key];
    if (typeof bawaan[key] === 'string') return bawaan[key] = '(teks bawaan)';
    return '(belum ada)';
  };

  const isDirty = (key) => {
    const live = typeof overrides[key] === 'string' ? overrides[key] : (bawaan[key] || '');
    return drafts[key] !== live;
  };

  const saveOne = async (key) => {
    setSaving(key);
    try {
      const newOverrides = { ...overrides };
      const bawaanText = bawaan[key] || '';
      if (drafts[key] === bawaanText) {
        delete newOverrides[key];
      } else {
        newOverrides[key] = drafts[key];
      }
      await bridgeApi('/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: newOverrides })
      });
      setOverrides(newOverrides);
      setSavedAt((s) => ({ ...s, [key]: Date.now() }));
      showToast('success', 'Menu ' + key.replace('menu_', '') + ' tersimpan');
    } catch (e) {
      showToast('error', 'Gagal simpan: ' + e.message);
    } finally {
      setSaving(null);
    }
  };

  const saveAll = async () => {
    setSaving('all');
    try {
      const newOverrides = {};
      for (const k of MENU_KEYS.map((x) => x.key)) {
        const bawaanText = bawaan[k] || '';
        if (drafts[k] !== bawaanText) {
          newOverrides[k] = drafts[k];
        }
      }
      await bridgeApi('/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: newOverrides })
      });
      setOverrides(newOverrides);
      const now = Date.now();
      const snap = {};
      for (const k of MENU_KEYS.map((x) => x.key)) snap[k] = now;
      setSavedAt(snap);
      showToast('success', 'Semua menu tersimpan ke production');
    } catch (e) {
      showToast('error', 'Gagal simpan: ' + e.message);
    } finally {
      setSaving(null);
    }
  };

  const resetDraft = (key) => {
    const live = typeof overrides[key] === 'string' ? overrides[key] : (bawaan[key] || '');
    setDrafts((d) => ({ ...d, [key]: live }));
  };

  const resetAll = () => {
    const d = {};
    for (const k of MENU_KEYS.map((x) => x.key)) {
      d[k] = typeof overrides[k] === 'string' ? overrides[k] : (bawaan[k] || '');
    }
    setDrafts(d);
  };

  if (busyLoad) {
    return (
      <section className="card menu-editor">
        <div className="blast-card-head"><h3>Menu Auto-Reply</h3></div>
        <div className="log-empty">Memuat teks menu...</div>
      </section>
    );
  }

  return (
    <section className="card menu-editor">
      <div className="blast-card-head">
        <h3>Menu Auto-Reply (Production)</h3>
        <div className="control-row" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={!!saving} onClick={saveAll}>
            <SaveIcon size={13} /> Simpan Semua
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!!saving} onClick={resetAll}>
            Reset Semua
          </button>
        </div>
      </div>
      <p className="dist-hint">
        Kiri: teks yang sedang tayang di production. Kanan: form untuk ubah teks.
      </p>

      <div className="menu-list">
        {MENU_KEYS.map(({ key, label, hint }) => {
          const dirty = isDirty(key);
          const justSaved = savedAt[key] && (Date.now() - savedAt[key] < 3000);
          const live = typeof overrides[key] === 'string' && overrides[key] ? overrides[key] : (bawaan[key] || '');
          const isDefault = !overrides[key] || overrides[key] === bawaan[key];

          return (
            <div key={key} className="menu-edit-row">
              <div className="menu-edit-head">
                <div className="menu-edit-title">
                  <span className="menu-cmd">{key.replace('menu_', '').toUpperCase()}</span>
                  <span className="menu-label">{label}</span>
                </div>
                <div className="menu-edit-badges">
                  {justSaved && <span className="tag tag-ok"><CheckCircleIcon size={11} /> Tersimpan</span>}
                  {dirty && !justSaved && <span className="tag tag-warn">Ada perubahan</span>}
                  {!dirty && !justSaved && isDefault && <span className="tag tag-dim">Default</span>}
                  {!dirty && !justSaved && !isDefault && <span className="tag tag-info">Override aktif</span>}
                </div>
              </div>
              <div className="menu-edit-hint">{hint}</div>

              <div className="menu-dual">
                <div className="menu-live-panel">
                  <div className="mini-label">SEDANG TAYANG</div>
                  <div className="wa-bubble mini">
                    <div className="wa-text" dangerouslySetInnerHTML={{ __html: waPreview(live) }} />
                  </div>
                </div>
                <div className="menu-form-panel">
                  <div className="mini-label">EDIT TEKS</div>
                  <textarea
                    className="menu-textarea"
                    value={drafts[key] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                    rows={Math.min(8, Math.max(3, Math.ceil((drafts[key] || '').length / 60)))}
                    spellCheck={false}
                  />
                  <div className="control-row">
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={!dirty || !!saving}
                      onClick={() => resetDraft(key)}
                    >
                      Reset
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!dirty || saving === key}
                      onClick={() => saveOne(key)}
                    >
                      {saving === key ? 'Menyimpan...' : 'Simpan'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
