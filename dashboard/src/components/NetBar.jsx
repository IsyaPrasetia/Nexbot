export default function NetBar({ data }) {
  if (!data || !data.checks) return null;
  const allOk = data.checks.every((c) => c.ok);

  return (
    <div className="netbar">
      <span className="net-title">Internet</span>
      {data.checks.map((c) => (
        <span key={c.id} className={`net-chip ${c.ok ? 'ok' : 'bad'}`} title={c.label}>
          <span className="dot" />
          {c.label.replace('Ping ', '')}
          <b>{c.ok ? `${c.latency_ms}ms` : 'PUTUS'}</b>
        </span>
      ))}
      {data.ollama && (
        <span className={`net-chip ${data.ollama.ok ? 'ok' : 'bad'}`} title={data.ollama.ok ? data.ollama.models.join(', ') : 'Ollama tidak merespons'}>
          <span className="dot" />
          OLLAMA
          <b>{data.ollama.ok ? `${data.ollama.models_count} model` : 'MATI'}</b>
        </span>
      )}
      {(data.disks || []).filter(Boolean).map((d) => (
        <span key={d.drive} className={`net-chip ${d.pct_used > 85 ? 'bad' : 'ok'}`} title={`${d.drive}: bebas ${d.free_gb}GB dari ${d.total_gb}GB`}>
          <span className="dot" />
          DISK {d.drive}:
          <b>{d.free_gb}GB bebas</b>
        </span>
      ))}
      {allOk && data.public_ip && (
        <span className="net-ip">
          IP publik: <b>{data.public_ip}</b>
          {data.loc ? ` • ${data.loc}` : ''}
          {data.colo ? ` • CF-${data.colo}` : ''}
        </span>
      )}
    </div>
  );
}
