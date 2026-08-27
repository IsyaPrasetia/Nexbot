import { useEffect, useRef, useState } from 'react';
import { fetchFileList, readFile, saveFile } from '../api.js';
import { ScriptIcon, SaveIcon, FolderIcon, AlertIcon } from './Icons.jsx';

const QUICK_FILES = [
  { label: 'AI-CS · cs.js', path: 'D:\\bot-multi-admin\\cs.js' },
  { label: 'AI-ADMIN · admin.js', path: 'D:\\ai-admin-bot\\admin.js' },
  { label: 'CS · Grup Webinar (JSON)', path: 'D:\\bot-multi-admin\\grup_webinar.json' },
  { label: 'ADMIN · Database Berkas', path: 'D:\\ai-admin-bot\\database.json' },
  { label: 'PM2 · bot.config.js', path: 'D:\\Admin\\bot.config.js' }
];

export default function FileEditor({ showToast, locked, onNeedUnlock, onRequestRestart }) {
  const [entries, setEntries] = useState(null);
  const [browseDir, setBrowseDir] = useState(null);
  const [openPath, setOpenPath] = useState(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const taRef = useRef(null);

  const loadList = (dir) => {
    fetchFileList(dir)
      .then((r) => { setEntries(r.entries || []); setBrowseDir(r.current || null); })
      .catch((e) => showToast('error', e.message));
  };

  useEffect(() => { loadList(null); }, []);

  const openFile = async (p) => {
    setBusy('read');
    setErr(null);
    try {
      const r = await readFile(p);
      setOpenPath(p);
      setContent(r.content);
      setSavedContent(r.content);
      setMeta({ size: r.size, mtime: r.mtimeMs });
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusy('');
    }
  };

  const doSave = async () => {
    if (!openPath) return;
    if (locked) {
      onNeedUnlock();
      showToast('error', 'Menyimpan file mengubah kode production — buka kunci dulu.');
      return;
    }
    if (/\.json$/i.test(openPath)) {
      try { JSON.parse(content); } catch (e) {
        return showToast('error', 'JSON tidak valid: ' + e.message);
      }
    }
    setBusy('save');
    try {
      const res = await saveFile(openPath, content);
      setSavedContent(res.needs_restart ? content : content);
      showToast('success', res.message);
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setBusy('');
    }
  };

  const dirty = openPath && content !== savedContent;
  const fileName = openPath ? openPath.split('\\').pop() : '';
  const needsRestart = dirty === false && openPath && /\.js$/i.test(openPath) && meta && ['AI-CS', 'AI-ADMIN'].some((n) => openPath.toLowerCase().includes(n === 'AI-CS' ? 'bot-multi' : 'ai-admin'));

  return (
    <div className="files-page">
      <div className="blast-hero">
        <div>
          <h2>Files & Editor</h2>
          <p>Edit kode & data langsung dari sini. Setiap save otomatis dibackup, dan isi yang tampil = file production yang aktif di server.</p>
        </div>
      </div>

      <div className="files-layout">
        <aside className="card files-side">
          <h4 className="files-side-title">File Cepat</h4>
          {QUICK_FILES.map((q) => (
            <button key={q.path} type="button" className={`file-item ${openPath === q.path ? 'on' : ''}`} onClick={() => openFile(q.path)}>
              <ScriptIcon size={13} /> {q.label}
            </button>
          ))}

          <h4 className="files-side-title" style={{ marginTop: 18 }}>
            <FolderIcon size={14} /> Jelajahi Folder
          </h4>
          <div className="folder-chips">
            <button type="button" className={`btn btn-outline btn-sm ${!browseDir ? 'active-dir' : ''}`} onClick={() => loadList(null)}>Root</button>
            {['D:\\ai-admin-bot', 'D:\\bot-multi-admin'].map((r) => (
              <button key={r} type="button" className={`btn btn-outline btn-sm ${browseDir === r ? 'active-dir' : ''}`} onClick={() => loadList(r)}>
                {r.split('\\').pop()}
              </button>
            ))}
            {browseDir && <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadList(browseDir.split('\\').slice(0, -1).join('\\') || null)}>Naik..</button>}
          </div>

          <div className="file-list">
            {entries === null && <div className="log-empty">Memuat...</div>}
            {entries && entries.length === 0 && <div className="log-empty">Kosong.</div>}
            {entries && entries.map((e) => (
              <button
                key={e.path}
                type="button"
                className={`file-item ${e.is_dir ? 'dir' : ''} ${openPath === e.path ? 'on' : ''}`}
                disabled={busy === 'read'}
                onClick={() => (e.is_dir ? loadList(e.path) : openFile(e.path))}
              >
                <ScriptIcon size={12} />
                <span className="fi-name">{e.name}</span>
                {!e.is_dir && <span className="fi-size">{(e.size / 1024).toFixed(0)}KB</span>}
              </button>
            ))}
          </div>
        </aside>

        <section className="card editor-card">
          {!openPath ? (
            <div className="empty"><ScriptIcon size={26} /> Pilih file di kiri untuk mulai mengedit.<br />Isi yang tampil selalu = versi PRODUCTION terbaru di disk.</div>
          ) : (
            <>
              <div className="editor-head">
                <div className="editor-file">
                  <b>{fileName}</b>
                  {dirty && <span className="tag tag-warn">belum disimpan</span>}
                  {meta && <span className="editor-meta">{(meta.size / 1024).toFixed(1)} KB • aktif sejak {new Date(meta.mtime).toLocaleString('id-ID')}</span>}
                </div>
                <div className="editor-actions">
                  <button className={`btn ${dirty ? 'btn-primary' : 'btn-outline'}`} disabled={!dirty || busy === 'save'} onClick={doSave}>
                    <SaveIcon size={13} /> {busy === 'save' ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </div>

              {err && <div className="form-error">{err}</div>}

              {needsRestart && !dirty && (
                <div className="banner banner-warn" style={{ marginBottom: 10 }}>
                  <AlertIcon size={13} />
                  File .js tersimpan — proses masih memakai kode lama sampai di-restart.
                  <button className="btn btn-outline btn-sm" style={{ marginLeft: 10 }} onClick={() => onRequestRestart(/cs\.js$/i.test(openPath) ? 'AI-CS' : 'AI-ADMIN')}>
                    Restart sekarang
                  </button>
                </div>
              )}

              <textarea
                ref={taRef}
                className="editor-area"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    if (!dirty || busy === 'save') return;
                    if (/\.json$/i.test(openPath)) {
                      try { JSON.parse(content); } catch (er) { showToast('error', 'JSON tidak valid: ' + er.message); return; }
                    }
                    doSave();
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const s = e.target.selectionStart;
                    setContent(content.slice(0, s) + '    ' + content.slice(e.target.selectionEnd));
                    setTimeout(() => e.target.setSelectionRange(s + 4, s + 4), 0);
                  }
                }}
                spellCheck={false}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
