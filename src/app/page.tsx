'use client';
import { useEffect, useState } from 'react';
import type { AppData } from '@/lib/types';
import { getStore, IS_DEMO } from '@/lib/store';
import { AppProvider } from '@/components/AppContext';
import Shell from '@/components/Shell';

export default function Home() {
  const [data, setData] = useState<AppData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        if (!IS_DEMO) {
          const { supa } = await import('@/lib/store/supabase');
          const { data: s } = await supa().auth.getSession();
          if (!s.session) { location.href = '/login'; return; }
        }
        const store = await getStore();
        setData(await store.load());
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, []);

  if (err) return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <div className="panel corner" style={{ padding: 24, maxWidth: 420 }}>
        <div className="micro danger">SYSTEM FAULT</div>
        <div className="mono" style={{ fontSize: 12, marginTop: 8 }}>{err}</div>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => location.reload()}>RETRY</button>
      </div>
    </div>
  );
  if (!data) return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <div className="mono acc" style={{ fontSize: 12, letterSpacing: '.2em' }} suppressHydrationWarning>
        ▸ ACQUIRING SIGNAL…
      </div>
    </div>
  );
  return (
    <AppProvider initial={data}>
      <Shell />
    </AppProvider>
  );
}
