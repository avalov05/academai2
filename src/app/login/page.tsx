'use client';
import { useState } from 'react';
import { IS_DEMO } from '@/lib/store';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (IS_DEMO) { location.href = '/'; return; }
    setBusy(true); setErr('');
    try {
      const { supa } = await import('@/lib/store/supabase');
      const { error } = await supa().auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      location.href = '/';
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <form onSubmit={go} className="panel corner fade-up" style={{ padding: 28, width: 400, maxWidth: '94vw' }}>
        <i className="c3" />
        <div className="micro">YOUR SEMESTER · ONE PLACE</div>
        <h1 className="display" style={{ fontSize: 40, margin: '10px 0 2px' }}>
          ACADEM<span className="iridescent-text">AI</span>
        </h1>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 24 }}>Everything you owe anyone, on one screen.</div>
        <label className="field"><span className="micro">EMAIL</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus required /></label>
        <label className="field"><span className="micro">PASSWORD</span>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} required /></label>
        {err && <div className="mono danger" style={{ fontSize: 11, margin: '8px 0' }}>✕ {err}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 10, padding: 12 }} disabled={busy}>
          {busy ? 'AUTHENTICATING…' : 'ENTER ⟶'}
        </button>
      </form>
    </div>
  );
}
