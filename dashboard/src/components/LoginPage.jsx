import { useEffect, useRef, useState } from 'react';
import { doLogin } from '../api.js';
import { AlertIcon } from './Icons.jsx';

const PRANK_LINES = [
  '> MENGHUBUNGKAN KE SERVER UTAMA...',
  '> VERIFIKASI TANDA TANGAN DIGITAL... OK',
  '> MEMINDAI PERANGKAT YANG ISENG...',
  '> LOKASI TERDETEKSI. KAMERA: AKTIF. MIKROFON: AKTIF.',
  '> MENGUMPULKAN RIWAYAT CHAT WHATSAPP...',
  '> SEMUA DATA SIAP DIKIRIM KE SANG ADMIN...'
];

export default function LoginPage({ onSuccess }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [prank, setPrank] = useState(false);
  const [lines, setLines] = useState(0);

  useEffect(() => {
    if (!prank) {
      setLines(0);
      return undefined;
    }
    const timers = PRANK_LINES.map((_, i) =>
      setTimeout(() => setLines(i + 1), 650 * (i + 1))
    );
    timers.push(setTimeout(() => setPrank('reveal'), 650 * PRANK_LINES.length + 1100));
    return () => timers.forEach(clearTimeout);
  }, [prank]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await doLogin(user.trim(), pass);
      onSuccess(res.user || user.trim().toUpperCase());
    } catch (err) {
      setError(err.message);
      setPass('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
        <span className="grid-layer" />
        <span className="scanline" />
      </div>

      <span className="corner-note corner-tl">PM2 GUARDED</span>
      <span className="corner-note corner-br">SECURE GATEWAY v2</span>

      <form className="login-card" onSubmit={submit}>
        <div className="eyebrow">RESTRICTED AREA - AKSES TERBATAS</div>
        <h1 className="login-title">Bot Admin Dashboard</h1>
        <p className="tagline">
          Satu pintu untuk memerintah seluruh bot.<br />
          Yang bukan penjaga, cukup menikmati layanannya.
        </p>

        {error && (
          <div className="form-error">
            <AlertIcon size={13} /> {error}
          </div>
        )}

        <label className="field">
          <span className="field-label">ID Penjaga</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Masukkan ID-mu"
            autoFocus
            autoComplete="username"
          />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Rahasia kecilmu"
            autoComplete="current-password"
          />
        </label>

        <button type="submit" className="btn btn-primary login-btn" disabled={busy || !user.trim() || !pass}>
          {busy ? 'Memeriksa...' : 'Masuk ke Command Center'}
        </button>

        <p className="login-foot">
          Sesi aktif 30 hari. Laptop restart, gerbang diminta lagi.
        </p>

        <div className="login-divider" />
        <button type="button" className="login-contact" onClick={() => setPrank(true)}>
          Mengalami error? Hubungi Admin
        </button>
      </form>

      {prank && (
        <div className="prank-screen">
          {prank === true ? (
            <div className="prank-term">
              {PRANK_LINES.slice(0, lines).map((l, i) => (
                <div key={i} className={`prank-line ${i >= 2 ? 'prank-line-red' : ''}`}>{l}</div>
              ))}
              <span className="prank-cursor" />
            </div>
          ) : (
            <div className="prank-reveal">
              <div className="prank-code">403</div>
              <h2>WKWKWK - KENA JEBAKAN!</h2>
              <p>
                Tombol "Hubungi Admin" itu cuma umpan.<br />
                Kalau memang error beneran, ketuk tombolnya sambil bilang: "bang, tolong".
              </p>
              <button className="btn btn-outline" onClick={() => setPrank(false)}>
                Ya udah, aku balik
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
