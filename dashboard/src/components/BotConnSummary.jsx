import { useEffect, useState } from 'react';

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

async function getJson(url) {
  try {
    const r = await fetch(url);
    const b = await r.json();
    return b;
  } catch { return null; }
}

function stripNum(user) {
  if (!user) return null;
  return String(user).split('@')[0].split(':')[0] || null;
}

export default function BotConnSummary() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [cs, admin, blast] = await Promise.all([
        getJson('/api/csbridge/status'),
        getJson('/api/adminbridge/status'),
        getJson('/api/blast/session'),
      ]);
      if (!alive) return;
      const rows = [];
      for (const s of (cs && cs.slots) || []) {
        rows.push({
          id: 'cs-' + s.slot,
          bot: 'AI-CS',
          label: s.slot.replace('admin', ''),
          connected: !!s.connected,
          sec: s.connected_sec,
          nomor: s.nomor,
        });
      }
      if (admin) {
        rows.push({
          id: 'admin',
          bot: 'AI-ADMIN',
          label: '1',
          connected: !!admin.connected,
          sec: admin.connected_sec,
          nomor: admin.nomor,
        });
      }
      for (const s of (blast && blast.slots) || []) {
        rows.push({
          id: 'blast-' + s.slot,
          bot: 'BLAST',
          label: String(s.slot || '').replace('s', ''),
          connected: s.state === 'connected',
          sec: s.connected_sec,
          nomor: stripNum(s.user),
        });
      }
      setState(rows);
    };
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!state || state.length === 0) return null;

  return (
    <section className="card conn-summary">
      <div className="blast-card-head">
        <h3>Koneksi WhatsApp (refresh tiap 6 dtk)</h3>
      </div>
      <div className="conn-summary-grid">
        {state.map((r) => (
          <div key={r.id} className={`conn-chip ${r.connected ? 'on' : 'off'}`}>
            <span className="conn-chip-name">{r.bot} <b>#{r.label}</b></span>
            <span className={`conn-chip-state ${r.connected ? 'ok' : 'bad'}`}>
              {r.connected ? 'TERSAMBUNG' : 'PUTUS'}
            </span>
            {r.connected && r.sec > 0 && (
              <span className="conn-chip-dur">
                ⏱ {r.nomor ? `Nomor ${r.nomor} • ` : ''}{formatDurasi(r.sec)}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
