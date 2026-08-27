import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStatus, fetchActivity, processAction, savePm2, setLock, fetchTunnelInfo, updateProcess, restartTunnel, checkMe, doLogout, fetchNetwork } from './api.js';
import ProcessCard from './components/ProcessCard.jsx';
import LogsDrawer from './components/LogsDrawer.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';
import AddBotModal from './components/AddBotModal.jsx';
import EditBotModal from './components/EditBotModal.jsx';
import DataPanel from './components/DataPanel.jsx';
import IncidentsDrawer from './components/IncidentsDrawer.jsx';
import LoginLogDrawer from './components/LoginLogDrawer.jsx';
import BlastPage from './components/BlastPage.jsx';
import FileEditor from './components/FileEditor.jsx';
import BotPage from './components/BotPage.jsx';
import AdminPage from './components/AdminPage.jsx';
import LockModal from './components/LockModal.jsx';
import LoginPage from './components/LoginPage.jsx';
import NetBar from './components/NetBar.jsx';
import StatsBar from './components/StatsBar.jsx';
import LineChart from './components/LineChart.jsx';
import { formatClock, formatUptime, formatBytes } from './format.js';
import {
  PlusIcon, SaveIcon, RefreshIcon, PauseIcon, LogIcon,
  AlertIcon, ServerIcon, DatabaseIcon, SunIcon, MoonIcon, BellIcon, BellOffIcon,
  HistoryIcon, BellRingIcon, LockIcon, UnlockIcon, LinkIcon, CopyIcon, PencilIcon,
  LogOutIcon, KeyIcon, ZapIcon, CpuIcon, QrIcon, ScriptIcon
} from './components/Icons.jsx';

const POLL_MS = 5000;
const HIST_MAX = 48;
const BLOCKED_WHEN_LOCKED = new Set(['stop', 'restart', 'delete', 'update']);

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 660].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      o.start(t);
      o.stop(t + 0.13);
    });
  } catch {}
}

const CONFIRM_TEXT = {
  restart: {
    title: 'Restart Proses',
    danger: false,
    label: 'Ya, Restart',
    msg: (n) => `Yakin mau restart "${n}"? Bot berhenti sesaat lalu menyala kembali. Pesan WhatsApp yang masuk saat proses restart bisa terlewat.`
  },
  stop: {
    title: 'Stop Proses',
    danger: true,
    label: 'Ya, Stop',
    msg: (n) => `Yakin mau menghentikan "${n}"? Bot tidak akan membalas pesan sampai kamu menekan tombol Mulai lagi.`
  },
  delete: {
    title: 'Hapus dari PM2',
    danger: true,
    label: 'Ya, Hapus',
    msg: (n) => `"${n}" akan dihentikan dan dihapus dari daftar PM2. Tenang, file & folder bot TETAP AMAN di disk — kamu bisa tambahkan lagi lewat tombol Tambah Bot.`
  },
  update: {
    title: 'Simpan Perubahan Proses',
    danger: false,
    label: 'Ya, Terapkan',
    msg: (n) => `Perubahan pada "${n}" diterapkan dengan me-restart proses secara singkat (±beberapa detik offline). Lanjutkan?`
  }
};

function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {}
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
  return Promise.resolve();
}

const NAME_ORDER = { 'AI-ADMIN': 0, 'AI-CS': 1, 'BLASTER': 2, 'BLAST': 2, 'DASHBOARD': 3, 'TUNNEL': 4 };

function orderWeight(p) {
  const n = String(p.name || '').toUpperCase();
  if (Object.prototype.hasOwnProperty.call(NAME_ORDER, n)) return NAME_ORDER[n];
  if (String(p.script || '').toLowerCase().includes('cloudflared')) return 4;
  return 10 + p.pm_id;
}

export default function App() {
  const [data, setData] = useState(null);
  const [activity, setActivity] = useState({});
  const [error, setError] = useState(null);
  const [paused, setPaused] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showData, setShowData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [sysHist, setSysHist] = useState([]);
  const [memHist, setMemHist] = useState({});
  const [theme, setTheme] = useState(() => localStorage.getItem('dash-theme') || 'dark');
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('dash-sound') !== 'off');
  const [notifOn, setNotifOn] = useState(() => localStorage.getItem('dash-notif') === 'on');
  const [showIncidents, setShowIncidents] = useState(false);
  const [locked, setLocked] = useState(true);
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockPurpose, setLockPurpose] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [tunnel, setTunnel] = useState(null);
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [net, setNet] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [authed, setAuthed] = useState(null);
  const [loginUser, setLoginUser] = useState('');
  const [showLoginLog, setShowLoginLog] = useState(false);
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem('dash-view');
    return ['monitor', 'cs', 'admin', 'blast', 'files'].includes(saved) ? saved : 'monitor';
  });
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const authedRef = useRef(authed);
  authedRef.current = authed;
  const soundRef = useRef(soundOn);
  const notifRef = useRef(notifOn);
  soundRef.current = soundOn;
  notifRef.current = notifOn;
  const toastSeq = useRef(0);
  const prevStatuses = useRef({});

  const addToast = useCallback((type, text) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-4), { id, type, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('dash-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (sessionStorage.getItem('dash-unlock') === '1') {
      setLock(false).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'Escape') return;
      setShowData(false);
      setShowIncidents(false);
      setDrawer(null);
      setShowAdd(false);
      setConfirmState(null);
      setShowLockModal(false);
      setPendingAction(null);
      setEditTarget(null);
      sessionStorage.removeItem('dash-unlock');
      setLocked(true);
      setLock(true)
        .then((r) => addToast('success', r.message || 'Dashboard dikunci (ESC)'))
        .catch(() => {});
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [addToast]);

  useEffect(() => {
    localStorage.setItem('dash-view', view);
  }, [view]);

  useEffect(() => {
    checkMe()
      .then((j) => { setLoginUser(j.user || ''); setAuthed(true); })
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    localStorage.setItem('dash-sound', soundOn ? 'on' : 'off');
  }, [soundOn]);

  const toggleNotif = async () => {
    if (!notifOn) {
      if (!('Notification' in window)) {
        addToast('error', 'Browser ini tidak mendukung notifikasi.');
        return;
      }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        addToast('error', 'Izin notifikasi ditolak browser. Cek pengaturan notifikasi Chrome/Edge.');
        return;
      }
      setNotifOn(true);
      localStorage.setItem('dash-notif', 'on');
      new Notification('Notifikasi dashboard aktif', { body: 'Kamu akan diberi tahu kalau ada bot mati.' });
    } else {
      setNotifOn(false);
      localStorage.setItem('dash-notif', 'off');
    }
  };

  const load = useCallback(async () => {
    if (!authedRef.current) return;
    try {
      const json = await fetchStatus();
      setData(json);
      setLocked(json.locked === true);
      setError(null);

      setSysHist((h) => {
        const cpu = json.system.cpu_percent;
        const memPct = (json.system.mem_used / json.system.mem_total) * 100;
        return [...h, { cpu, mem: memPct }].slice(-HIST_MAX);
      });
      setMemHist((prev) => {
        const next = { ...prev };
        for (const p of json.processes) {
          const arr = [...(next[p.pm_id] || []), p.memory];
          next[p.pm_id] = arr.slice(-HIST_MAX);
        }
        return next;
      });

      for (const p of json.processes) {
        const before = prevStatuses.current[p.name];
        if (before && before !== p.status) {
          if (p.status === 'stopped' || p.status === 'errored') {
            addToast('error', `${p.name} berubah jadi ${p.status === 'errored' ? 'ERROR' : 'MATI'}! Segera cek log.`);
            if (soundRef.current) beep();
            if (notifRef.current) notify(`BOT MATI: ${p.name}`, `Status: ${p.status}. Buka dashboard untuk cek log & restart.`);
          } else if (p.status === 'online') {
            addToast('success', `${p.name} kembali online.`);
          }
        }
        prevStatuses.current[p.name] = p.status;
      }

      try {
        const act = await fetchActivity();
        const map = {};
        for (const it of act.items || []) map[it.pm_id] = it;
        setActivity(map);
      } catch {}
    } catch (e) {
      setError(e.message);
    }
  }, [addToast]);

  useEffect(() => {
    if (authed !== true) return undefined;
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, paused, authed]);

  useEffect(() => {
    if (authed !== true) return undefined;
    let alive = true;
    const fetchIt = () => fetchNetwork().then((r) => { if (alive) setNet(r); }).catch(() => {});
    fetchIt();
    const t = setInterval(fetchIt, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [authed]);

  useEffect(() => {
    if (authed !== true) return undefined;
    let alive = true;
    const fetchIt = () => fetchTunnelInfo()
      .then((json) => { if (alive) setTunnel(json); })
      .catch(() => {});
    fetchIt();
    const t = setInterval(fetchIt, 12000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [authed]);

  const runAction = async (proc, action, payload) => {
    setBusyId(proc.pm_id);
    try {
      const res = action === 'update'
        ? await updateProcess(proc.pm_id, payload)
        : await processAction(proc.pm_id, action);
      addToast('success', res.message || `"${proc.name}" berhasil di-${action}`);
    } catch (e) {
      addToast('error', `Gagal ${action} "${proc.name}": ${e.message}`);
    } finally {
      setBusyId(null);
      load();
    }
  };

  const requestAction = (proc, action, payload) => {
    if (lockedRef.current && BLOCKED_WHEN_LOCKED.has(action)) {
      setPendingAction({ proc, action, payload });
      const verbs = { stop: 'menghentikan', restart: 'me-restart', delete: 'menghapus', update: 'mengubah pengaturan' };
      setLockPurpose(`Untuk ${verbs[action] || 'menjalankan aksi'} "${proc.name}", buka kunci dulu.`);
      setShowLockModal(true);
      return;
    }
    if (CONFIRM_TEXT[action]) setConfirmState({ action, proc, payload });
    else runAction(proc, action, payload);
  };

  const handleEditClick = (p) => {
    if (lockedRef.current && BLOCKED_WHEN_LOCKED.has('update')) {
      setPendingAction({ proc: p, action: 'open-edit' });
      setLockPurpose(`Untuk mengubah pengaturan "${p.name}", buka kunci dulu.`);
      setShowLockModal(true);
      return;
    }
    setEditTarget(p);
  };

  const handleUnlockSuccess = () => {
    const pa = pendingAction;
    setShowLockModal(false);
    setPendingAction(null);
    lockedRef.current = false;
    setLocked(false);
    addToast('success', 'Kunci dibuka — tombol aksi aktif. Tekan ESC untuk mengunci ulang.');
    try {
      if (!pa) return;
      if (pa.action === 'tunnel-restart') {
        handleTunnelRestart();
      } else if (pa.action === 'open-edit' && pa.proc) {
        setEditTarget(pa.proc);
      } else if (pa.proc) {
        // Langsung konfirmasi tanpa lewat cek kunci lagi (nilai state belum sinkron di tick ini)
        if (CONFIRM_TEXT[pa.action]) setConfirmState({ action: pa.action, proc: pa.proc, payload: pa.payload });
        else runAction(pa.proc, pa.action, pa.payload);
      }
    } catch (e) {
      addToast('error', e.message);
    }
  };

  const handleTunnelRestart = async () => {
    setTunnelBusy(true);
    try {
      const res = await restartTunnel();
      addToast('success', res.message);
      setTunnel((t) => (t ? { ...t, url: null } : t));
      setTimeout(() => {
        fetchTunnelInfo().then(setTunnel).catch(() => {});
      }, 6000);
    } catch (e) {
      addToast('error', `Gagal restart tunnel: ${e.message}`);
    } finally {
      setTunnelBusy(false);
    }
  };

  const handleTunnelRefreshClick = () => {
    if (locked) {
      setPendingAction({ action: 'tunnel-restart' });
      setLockPurpose('Untuk membuat URL tunnel baru, buka kunci dulu.');
      setShowLockModal(true);
      return;
    }
    handleTunnelRestart();
  };

  const toggleLockButton = () => {
    if (locked) {
      setPendingAction(null);
      setLockPurpose('');
      setShowLockModal(true);
    } else {
      sessionStorage.removeItem('dash-unlock');
      setLocked(true);
      setLock(true)
        .then((r) => addToast('success', r.message || 'Dashboard dikunci'))
        .catch((e) => addToast('error', e.message));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await savePm2();
      addToast('success', res.message);
    } catch (e) {
      addToast('error', `Gagal simpan: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try { await doLogout(); } catch {}
    setAuthed(false);
    setLoginUser('');
  };

  const restartByName = (name) => {
    const p = processes.find((x) => x.name === name);
    if (!p) return addToast('error', `${name} tidak ditemukan di PM2`);
    requestAction(p, 'restart');
  };

  const processes = [...(data?.processes || [])].sort(
    (a, b) => orderWeight(a) - orderWeight(b) || a.pm_id - b.pm_id
  );
  const sys = data?.system;
  const onlineCount = processes.filter((p) => p.status === 'online').length;
  const problemList = processes.filter((p) => p.status === 'errored' || p.status === 'stopped');

  if (authed === null) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-sub" style={{ textAlign: 'center', margin: 0 }}>Memeriksa sesi login...</p>
        </div>
      </div>
    );
  }

  if (authed === false) {
    return (
      <LoginPage
        onSuccess={(u) => { setLoginUser(u); setAuthed(true); load(); }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className={`logo-dot ${problemList.length === 0 && !error ? 'ok' : 'warn'}`} />
          <div>
            <h1>Bot Admin Dashboard</h1>
            <p className="sub">
              Panel kendali bot WhatsApp {sys ? `- ${sys.hostname}` : ''} • Node {sys?.node_version || '-'} • user: <b>{loginUser || '-'}</b>
            </p>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            className={`btn btn-outline btn-lock ${locked ? 'btn-lock-closed' : 'btn-lock-open'}`}
            onClick={toggleLockButton}
            title={locked ? 'Dashboard TERKUNCI — klik untuk buka kunci' : 'Dashboard terbuka — klik untuk kunci ulang'}
          >
            {locked ? <LockIcon size={14} /> : <UnlockIcon size={14} />}
            {locked ? 'Terkunci' : 'Terbuka'}
          </button>
          <button
            className="icon-btn"
            onClick={handleLogout}
            title={`Logout (${loginUser})`}
          >
            <LogOutIcon size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
          >
            {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </button>
          <button
            className="icon-btn"
            onClick={() => setSoundOn((s) => !s)}
            title={soundOn ? 'Suara alarm aktif (klik untuk matikan)' : 'Suara alarm mati (klik untuk nyalakan)'}
          >
            {soundOn ? <BellIcon size={15} /> : <BellOffIcon size={15} />}
          </button>
          <button
            className="icon-btn"
            onClick={toggleNotif}
            title={notifOn ? 'Notifikasi Windows aktif (klik untuk matikan)' : 'Aktifkan notifikasi Windows saat bot mati'}
          >
            {notifOn ? <BellRingIcon size={15} /> : <BellOffIcon size={15} />}
          </button>
          <button className={`btn btn-outline btn-chip-btn ${paused ? 'btn-warn-text' : ''}`} onClick={() => setPaused((p) => !p)} title={paused ? 'Nyalakan auto-refresh' : 'Matikan auto-refresh'}>
            {paused ? <PauseIcon size={13} /> : <RefreshIcon size={13} />}
            {paused ? 'Auto-refresh: Jeda' : 'Auto-refresh'}
          </button>
          <button className="btn btn-outline" onClick={load} title="Muat ulang sekarang">
            <RefreshIcon size={13} /> Refresh
          </button>
          <button className="btn btn-outline" disabled={saving} onClick={handleSave} title="Simpan daftar agar bot auto-start saat laptop restart">
            <SaveIcon size={13} /> {saving ? 'Menyimpan...' : 'Simpan PM2'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <PlusIcon size={14} /> Tambah Bot
          </button>
        </div>
      </header>

      <nav className="viewtabs">
        <button className={`viewtab ${view === 'monitor' ? 'viewtab-active' : ''}`} onClick={() => setView('monitor')}>
          <ServerIcon size={15} /> Monitor
        </button>
        <button className={`viewtab ${view === 'cs' ? 'viewtab-active' : ''}`} onClick={() => setView('cs')}>
          <QrIcon size={15} /> AI-CS
        </button>
        <button className={`viewtab ${view === 'admin' ? 'viewtab-active' : ''}`} onClick={() => setView('admin')}>
          <CpuIcon size={15} /> AI-ADMIN
        </button>
        <button className={`viewtab ${view === 'blast' ? 'viewtab-active' : ''}`} onClick={() => setView('blast')}>
          <ZapIcon size={15} /> WA Blast
        </button>
        <button className={`viewtab ${view === 'files' ? 'viewtab-active' : ''}`} onClick={() => setView('files')}>
          <ScriptIcon size={15} /> Files
        </button>
      </nav>

      {view === 'monitor' && (
      <>
      {error && (
        <div className="banner banner-error">
          <AlertIcon size={15} />
          Gagal terhubung ke server dashboard: {error}
        </div>
      )}

      {!error && problemList.length > 0 && (
        <div className="banner banner-warn">
          <AlertIcon size={15} />
          <b>{problemList.map((p) => p.name).join(', ')}</b> sedang tidak berjalan. Periksa log-nya lalu tekan Mulai / Restart.
        </div>
      )}

      {tunnel && tunnel.running && (
        <div className="tunnel-strip">
          <LinkIcon size={15} />
          <span className="tunnel-label">Akses dari luar:</span>
          {tunnel.url ? (
            <>
              <a className="tunnel-url" href={tunnel.url} target="_blank" rel="noreferrer">{tunnel.url}</a>
              <button
                className="btn btn-outline btn-sm"
                disabled={tunnelBusy}
                onClick={handleTunnelRefreshClick}
                title="Dapatkan URL baru — link lama akan mati otomatis"
              >
                <RefreshIcon size={13} /> {tunnelBusy ? 'Merestart...' : 'URL Baru'}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => copyText(tunnel.url).then(() => addToast('success', 'Link tunnel disalin ke clipboard'))}
              >
                <CopyIcon size={13} /> Salin Link
              </button>
              <a className="btn btn-ghost btn-sm" href={tunnel.url} target="_blank" rel="noreferrer">Buka</a>
            </>
          ) : (
            <span className="tunnel-waiting">Menyambungkan ke Cloudflare... ({tunnel.name})</span>
          )}
        </div>
      )}

      <StatsBar processes={processes} system={sys} />

      <div className="chart-row">
        <LineChart
          title="CPU Laptop"
          sub={`riwayat ${(sysHist.length * POLL_MS / 1000 / 60).toFixed(0)} menit terakhir`}
          data={sysHist.map((d) => d.cpu)}
          color="#6366f1"
        />
        <LineChart
          title="RAM Laptop"
          sub={`total ${formatBytes(sys?.mem_total || 0)}`}
          data={sysHist.map((d) => d.mem)}
          color="#22c55e"
        />
      </div>

      {sys && (
        <div className="sysinfo">
          <span><b>{sys.platform}</b></span>
          <span>CPU: <b title={sys.cpu_model}>{sys.cpu_cores} core</b></span>
          <span>Laptop nyala: <b>{formatUptime(sys.os_uptime_s * 1000)}</b></span>
          <span>RAM bebas: <b>{formatBytes(sys.mem_free)}</b></span>
          <span>Waktu server: <b>{formatClock(data?.timestamp)}</b></span>
        </div>
      )}

      <NetBar data={net} />

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Daftar Bot</h2>
            <p>
              {onlineCount}/{processes.length} online
              {' • '}diperbarui {formatClock(data?.timestamp)}
              {' • '}auto-refresh tiap 5 detik{paused ? ' (dijeda)' : ''}
              {' • '}kolom Aktivitas = laju tulis log per siklus polling
            </p>
          </div>
          <div className="section-head-actions">
            <button className="btn btn-primary" onClick={() => setView('blast')}>
              <ZapIcon size={13} /> Buka WA Blast
            </button>
            <button className="btn btn-outline" onClick={() => setShowLoginLog(true)}>
              <KeyIcon size={13} /> Log Login
            </button>
            <button className="btn btn-outline" onClick={() => setShowIncidents(true)}>
              <HistoryIcon size={13} /> Insiden
            </button>
            <button className="btn btn-outline" onClick={() => setShowData(true)}>
              <DatabaseIcon size={13} /> Data Bot
            </button>
            <button className="btn btn-outline" onClick={() => setDrawer({ name: '__ALL__', stream: 'out' })}>
              <LogIcon size={13} /> Log Semua Bot
            </button>
            <button className="btn btn-danger" onClick={async () => {
              try {
                await fetch('/api/logout-all', { method: 'POST' });
                setAuthed(false);
                setLoginUser('');
              } catch (e) {
                addToast('error', e.message);
              }
            }}>
              <LogOutIcon size={13} /> Keluar Semua
            </button>
          </div>
        </div>

        <main className="grid">
          {processes.map((p) => (
            <ProcessCard
              key={p.pm_id}
              proc={p}
              system={sys}
              busy={busyId === p.pm_id}
              activity={activity[p.pm_id]}
              memHistory={memHist[p.pm_id]}
              onEdit={() => handleEditClick(p)}
              onAction={(a) => requestAction(p, a)}
              onOpenLogs={(stream) => setDrawer({ name: p.name, stream: stream || 'out' })}
            />
          ))}
          {!data && !error && (
            <div className="empty"><ServerIcon size={26} /> Memuat status proses...</div>
          )}
          {data && processes.length === 0 && (
            <div className="empty">
              <ServerIcon size={26} />
              Belum ada bot terdaftar di PM2.<br />Klik <b>Tambah Bot</b> untuk mendaftarkan bot pertamamu.
            </div>
          )}
        </main>
      </section>
      </>
      )}
      {view === 'cs' && (
        <BotPage
          kind="cs"
          label="AI-CS"
          proc={processes.find((p) => p.name === 'AI-CS') || null}
          net={net}
          showToast={addToast}
          onRequestRestart={restartByName}
        />
      )}
      {view === 'admin' && (
        <AdminPage
          proc={processes.find((p) => p.name === 'AI-ADMIN') || null}
          net={net}
          showToast={addToast}
          onRequestRestart={restartByName}
        />
      )}
      {view === 'blast' && (
        <BlastPage showToast={addToast} />
      )}
      {view === 'files' && (
        <FileEditor
          showToast={addToast}
          locked={locked}
          onNeedUnlock={() => {
            setLockPurpose('Menyimpan file mengubah kode production — buka kunci dulu.');
            setShowLockModal(true);
          }}
          onRequestRestart={restartByName}
        />
      )}

      <footer className="footer">
        Dashboard ini hanya bisa dibuka dari laptop ini (127.0.0.1). Alur bot baru: siapkan folder bot → <b>Tambah Bot</b> → tes jalan → <b>Simpan PM2</b> supaya otomatis hidup saat laptop restart.
      </footer>

      {drawer && <LogsDrawer target={drawer} onClose={() => setDrawer(null)} />}
      {showData && <DataPanel onClose={() => setShowData(false)} />}
      {showIncidents && <IncidentsDrawer onClose={() => setShowIncidents(false)} />}
      {showLoginLog && <LoginLogDrawer onClose={() => setShowLoginLog(false)} />}
      {editTarget && (
        <EditBotModal
          proc={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(msg) => { addToast('success', msg); load(); }}
        />
      )}
      <LockModal
        open={showLockModal}
        purpose={lockPurpose}
        onCancel={() => { setShowLockModal(false); setPendingAction(null); }}
        onUnlocked={handleUnlockSuccess}
      />

      <AddBotModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={(msg) => { addToast('success', msg); load(); }}
      />

      <ConfirmModal
        open={!!confirmState}
        danger={confirmState ? CONFIRM_TEXT[confirmState.action].danger : false}
        title={confirmState ? CONFIRM_TEXT[confirmState.action].title : ''}
        message={confirmState ? CONFIRM_TEXT[confirmState.action].msg(confirmState.proc.name) : ''}
        confirmLabel={confirmState ? CONFIRM_TEXT[confirmState.action].label : ''}
        busy={busyId !== null}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          const cs = confirmState;
          setConfirmState(null);
          runAction(cs.proc, cs.action, cs.payload);
        }}
      />

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'success' ? <SaveIcon size={14} /> : <AlertIcon size={14} />}
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
