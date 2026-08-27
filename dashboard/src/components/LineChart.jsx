export default function LineChart({ title, sub, unit = '%', data = [], color = '#6366f1', max = 100, autoMax = false, mini = false, digits = 0 }) {
  const w = 100;
  const h = 38;
  const n = data.length;
  const last = n > 0 ? data[n - 1] : null;
  const effMax = autoMax ? Math.max(...data, 1) * 1.25 : max;

  let polyline = '';
  let area = '';
  if (n >= 2) {
    const pts = data.map((v, i) => {
      const x = (i / (n - 1)) * w;
      const y = h - Math.min(Math.max(v / effMax, 0), 1) * (h - 3) - 1.5;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    polyline = pts.join(' ');
    area = `0,${h} ${polyline} ${w},${h}`;
  }

  const gradId = `grad-${title.replace(/\W/g, '')}`;

  if (mini) {
    return (
      <div
        className="mini-chart"
        title={`RAM bot ${last != null ? (last / 1048576).toFixed(1) : '-'} MB (riwayat)`}
      >
        {n >= 2 ? (
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={area} fill={`url(#${gradId})`} />
            <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        ) : (
          <div className="chart-loading">Mengumpulkan grafik RAM bot...</div>
        )}
      </div>
    );
  }

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <span className="chart-title">{title}</span>
          <span className="chart-sub">{sub}</span>
        </div>
        <span className="chart-value" style={{ color }}>
          {last !== null ? `${last.toFixed(digits)}${unit}` : '-'}
        </span>
      </div>
      {n >= 2 ? (
        <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gradId})`} />
          <polyline
            points={polyline}
            fill="none"
            stroke={color}
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <div className="chart-loading">Mengumpulkan data grafik...</div>
      )}
    </div>
  );
}
