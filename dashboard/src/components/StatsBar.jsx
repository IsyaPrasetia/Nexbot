import { formatBytes } from '../format.js';
import { ActivityIcon, AlertIcon, RamIcon, CpuIcon } from './Icons.jsx';

export default function StatsBar({ processes, system }) {
  if (!processes || !system) return null;

  const online = processes.filter((p) => p.status === 'online').length;
  const problems = processes.filter((p) => p.status === 'errored' || p.status === 'stopped').length;
  const pmMem = processes.reduce((sum, p) => sum + (p.memory || 0), 0);
  const memPct = Math.round((system.mem_used / system.mem_total) * 100);
  const pmMemPctOfTotal = ((pmMem / system.mem_total) * 100).toFixed(1);

  return (
    <div className="stats">
      <div className={`stat-card ${problems > 0 ? 'stat-warn-border' : 'stat-ok-border'}`}>
        <div className="stat-icon ok"><CheckMark /></div>
        <div className="stat-body">
          <span className="stat-value">{online}<small>/{processes.length}</small></span>
          <span className="stat-label">Bot Online</span>
          <span className="stat-sub">
            {problems > 0 ? `${problems} bot perlu perhatian` : 'Semua bot berjalan normal'}
          </span>
        </div>
      </div>

      <div className="stat-card">
        <div className={`stat-icon ${problems > 0 ? 'bad' : 'dim'}`}><AlertIcon size={18} /></div>
        <div className="stat-body">
          <span className="stat-value">{problems}</span>
          <span className="stat-label">Mati / Error</span>
          <span className="stat-sub">{problems > 0 ? 'Segera restart atau start ulang' : 'Tidak ada masalah'}</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-icon accent"><RamIcon size={18} /></div>
        <div className="stat-body">
          <span className="stat-value">{formatBytes(pmMem)}</span>
          <span className="stat-label">RAM Terpakai Bot</span>
          <span className="stat-sub">{pmMemPctOfTotal}% dari total RAM laptop</span>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-icon dim"><CpuIcon size={18} /></div>
        <div className="stat-body stat-bars">
          <MiniBar label="CPU laptop" value={`${system.cpu_percent}%`} pct={system.cpu_percent} bad={system.cpu_percent > 85} />
          <MiniBar label={`RAM laptop (${formatBytes(system.mem_free)} bebas)`} value={`${memPct}%`} pct={memPct} bad={memPct > 90} />
        </div>
      </div>
    </div>
  );
}

function MiniBar({ label, value, pct, bad }) {
  return (
    <div className="minibar">
      <div className="minibar-head">
        <span>{label}</span>
        <b className={bad ? 'warn-text' : ''}>{value}</b>
      </div>
      <div className="bar">
        <div className={`bar-fill ${bad ? 'bar-bad' : 'bar-ok'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function CheckMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
