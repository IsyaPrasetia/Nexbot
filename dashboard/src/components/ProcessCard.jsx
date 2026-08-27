import { formatBytes, formatUptime, formatSince } from '../format.js';
import { PlayIcon, RestartIcon, StopIcon, TrashIcon, LogIcon, ScriptIcon, PencilIcon } from './Icons.jsx';
import LineChart from './LineChart.jsx';

const STATUS_META = {
  online: { label: 'Online', cls: 'st-online', desc: 'Bot berjalan normal' },
  launching: { label: 'Menyala', cls: 'st-launching', desc: 'Proses sedang startup' },
  stopping: { label: 'Berhenti...', cls: 'st-warn', desc: 'Sedang dalam proses berhenti' },
  stopped: { label: 'Mati', cls: 'st-stopped', desc: 'Bot tidak sedang berjalan' },
  errored: { label: 'Error', cls: 'st-errored', desc: 'Bot crash / gagal dijalankan' }
};

export default function ProcessCard({ proc, system, busy, activity, memHistory, onAction, onOpenLogs, onEdit }) {
  const meta = STATUS_META[proc.status] || { label: proc.status, cls: 'st-stopped', desc: 'Status tidak diketahui' };
  const isOnline = proc.status === 'online';
  const memPct = system ? ((proc.memory || 0) / system.mem_total) * 100 : 0;

  const act = !activity || activity.delta_bytes === 0
    ? { cls: 'tag tag-dim', label: 'Sepi', sub: 'tidak ada log baru' }
    : activity.delta_bytes < 2048
      ? { cls: 'tag tag-ok', label: 'Normal', sub: `${(activity.delta_bytes / 1024).toFixed(1)} KB log / siklus` }
      : { cls: 'tag tag-ramai', label: 'Ramai', sub: `${(activity.delta_bytes / 1024).toFixed(1)} KB log / siklus` };

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <span className={`dot ${meta.cls} ${isOnline ? 'pulse' : ''}`} title={meta.desc} />
          <div>
            <h2>{proc.name}</h2>
            <span className="card-sub">{meta.desc}</span>
          </div>
          <span className="id-badge">#{proc.pm_id}</span>
        </div>
        <span className={`badge ${meta.cls}`}>{meta.label}</span>
      </div>

      <div className="path-box" title={proc.script || ''}>
        <ScriptIcon size={13} />
        <code>{proc.script || '-'}</code>
      </div>

      <div className="meta">
        <Meta label="Uptime" value={isOnline ? formatUptime(proc.uptime_ms) : '-'} sub={isOnline ? `sejak ${formatSince(proc.uptime_ms)}` : 'tidak berjalan'} />
        <Bar label="CPU" text={`${proc.cpu}%`} pct={proc.cpu} bad={proc.cpu > 80} />
        <Bar label="Memori" text={formatBytes(proc.memory)} pct={memPct} bad={memPct > 20} />
        <Meta label="Restart" value={`${proc.restarts}x`} sub={proc.restarts > 30 ? 'sering restart, perlu dicek' : 'jumlah crash/restart'} warn={proc.restarts > 30} />
        <Meta label="Mode" value={proc.mode === 'cluster' ? 'Cluster' : 'Fork'} sub={`PID ${proc.pid ?? '-'}`} />
        <Meta
          label="Perlindungan"
          value={
            <span className="tag-row">
              <span className={`tag ${proc.autorestart ? 'tag-ok' : 'tag-warn'}`}>
                {proc.autorestart ? 'Auto-restart ON' : 'Auto-restart OFF'}
              </span>
              {proc.watch && <span className="tag tag-info">Watch</span>}
            </span>
          }
          sub={proc.autorestart ? 'hidup sendiri saat crash' : 'mati permanen saat crash'}
        />
        <Meta label="Aktivitas" value={<span className={act.cls}>{act.label}</span>} sub={act.sub} />
      </div>

      <LineChart mini title={`RAM ${proc.name}`} data={memHistory || []} unit=" MB" autoMax color="#818cf8" />

      <div className="actions">
        {!isOnline && (
          <button className="btn btn-success" disabled={busy} onClick={() => onAction('start')}>
            <PlayIcon size={13} /> Mulai
          </button>
        )}
        <button className="btn btn-outline" disabled={busy} onClick={() => onAction('restart')}>
          <RestartIcon size={13} /> Restart
        </button>
        <button className="btn btn-danger-outline" disabled={busy || !isOnline} onClick={() => onAction('stop')}>
          <StopIcon size={13} /> Stop
        </button>
        <span className="actions-gap" />
        <button className="btn btn-ghost" disabled={busy} onClick={() => onOpenLogs('out')} title="Log standar (output)">
          <LogIcon size={13} /> Out
        </button>
        <button className="btn btn-ghost btn-err-text" disabled={busy} onClick={() => onOpenLogs('err')} title="Log error">
          <LogIcon size={13} /> Err
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => onEdit()} title="Edit proses: nama, file, auto-restart, watch">
          <PencilIcon size={13} />
        </button>
        <button className="btn btn-ghost btn-danger-text" disabled={busy} onClick={() => onAction('delete')} title="Hapus dari daftar PM2 (file bot tetap aman)">
          <TrashIcon size={13} />
        </button>
      </div>
    </section>
  );
}

function Meta({ label, value, sub, warn }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className={`meta-value ${warn ? 'warn-text' : ''}`}>{value}</span>
      <span className="meta-sub">{sub || ''}</span>
    </div>
  );
}

function Bar({ label, text, pct, bad }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className={`meta-value ${bad ? 'warn-text' : ''}`}>{text}</span>
      <div className="bar bar-thin">
        <div className={`bar-fill ${bad ? 'bar-bad' : 'bar-ok'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
