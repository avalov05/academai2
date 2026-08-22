'use client';
// ── Turning on iPhone notifications, and knowing that they work ──────────
//
// iOS only delivers web push to a site that has been added to the Home Screen,
// and only after a tap. Both of those are easy to get wrong silently, so this
// panel detects the situation and says exactly what is missing.
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from './AppContext';
import { supaAccessToken } from '@/components/auth';
import { IS_DEMO } from '@/lib/store';

type State = 'checking' | 'unsupported' | 'needs-install' | 'ready' | 'denied' | 'on';

function b64ToU8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

export default function PushPanel() {
  const { notify } = useApp();
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      // iOS Safari only exposes PushManager once the app is on the Home Screen
      setState(isIOS() && !isStandalone() ? 'needs-install' : 'unsupported');
      return;
    }
    if (isIOS() && !isStandalone()) { setState('needs-install'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { setEndpoint(sub.endpoint); setState('on'); return; }
    } catch { /* fall through */ }
    setState('ready');
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enable = async () => {
    setBusy(true);
    try {
      if (!vapid) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set on the server');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'ready'); return; }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToU8(vapid) as unknown as BufferSource,
      });
      const token = await supaAccessToken();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 60) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save this phone');
      setEndpoint(sub.endpoint);
      setState('on');
      notify('This phone will now get reminders', 'ok');
    } catch (e) {
      notify((e as Error).message, 'danger');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const token = await supaAccessToken();
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEndpoint(null);
      setState('ready');
      notify('Reminders off for this phone');
    } catch (e) {
      notify((e as Error).message, 'danger');
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const token = await supaAccessToken();
      const res = await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Test failed');
      notify(j.sent ? `Sent to ${j.sent} device${j.sent === 1 ? '' : 's'} — check your phone` : 'Nothing was delivered', j.sent ? 'ok' : 'warn');
    } catch (e) {
      notify((e as Error).message, 'danger');
    } finally { setBusy(false); }
  };

  return (
    <section className="panel corner" style={{ padding: 16, marginBottom: 14 }}>
      <i className="c3" />
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="micro">IPHONE REMINDERS — PUSH NOTIFICATIONS</span>
        <span className={`right-align chip ${state === 'on' ? 'ok' : state === 'denied' ? 'hot' : ''}`}
          style={{ fontSize: 9.5, padding: '3px 9px' }}>
          {state === 'on' ? 'ON FOR THIS DEVICE'
            : state === 'denied' ? 'BLOCKED IN SETTINGS'
            : state === 'needs-install' ? 'NEEDS HOME SCREEN'
            : state === 'unsupported' ? 'NOT SUPPORTED HERE'
            : state === 'checking' ? '…' : 'OFF'}
        </span>
      </div>

      {state === 'needs-install' && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px' }}>
          <div className="micro" style={{ marginBottom: 5 }}>ADD TO HOME SCREEN FIRST</div>
          <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
            Apple only lets a website send you notifications once it lives on your Home Screen.
            In Safari on your iPhone: tap <strong>Share</strong> → <strong>Add to Home Screen</strong> →{' '}
            <strong>Add</strong>. Then open AcademAI from that new icon — not from Safari — come back
            here, and this button will work.
          </div>
        </div>
      )}

      {state === 'denied' && (
        <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
          Notifications are blocked for this app. On iPhone: Settings → Notifications → AcademAI →
          Allow Notifications. Then come back and turn them on here.
        </div>
      )}

      {state === 'unsupported' && (
        <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
          This browser cannot receive push. Use Safari on iPhone (added to the Home Screen), or
          Chrome, Edge or Firefox on a computer.
        </div>
      )}

      {(state === 'ready' || state === 'on') && (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {state === 'ready'
              ? <button className="btn primary" disabled={busy || IS_DEMO} onClick={enable}>
                  {busy ? 'Working…' : 'Turn on reminders'}
                </button>
              : <>
                  <button className="btn" disabled={busy} onClick={test}>Send a test now</button>
                  <button className="btn danger" disabled={busy} onClick={disable}>Turn off for this phone</button>
                </>}
            {IS_DEMO && <span className="faint" style={{ fontSize: 11 }}>(available after deploy)</span>}
          </div>
          {endpoint && (
            <div className="mono faint" style={{ fontSize: 9.5, marginTop: 8, wordBreak: 'break-all' }}>
              REGISTERED: {endpoint.slice(0, 58)}…
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        <div className="micro" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>WHAT YOU WILL GET</div>
        {[
          ['Every morning, 8:00', 'What is due today, anything overdue, and the next exam'],
          ['Every evening, 20:00', 'Anything still open that is due within 24 hours'],
          ['24h and 3h before', 'Each assignment, individually'],
          ['2 days, 1 day, 2h before', 'Each exam and in-class quiz'],
          ['15 minutes before', 'Study blocks you accepted'],
          ['15 minutes after', 'Anything that just went overdue'],
        ].map(([when, what]) => (
          <div key={when} className="row" style={{ padding: '7px 12px', borderTop: '1px solid var(--line)', gap: 10 }}>
            <span className="mono" style={{ fontSize: 10.5, minWidth: 150, color: 'var(--dim)' }}>{when}</span>
            <span style={{ fontSize: 12 }}>{what}</span>
          </div>
        ))}
        <div className="faint" style={{ padding: '8px 12px', fontSize: 11, borderTop: '1px solid var(--line)' }}>
          Nothing is sent between 23:00 and 07:00 — a reminder that fires at 3am only teaches you to
          ignore your phone. Anything that would have landed in that window arrives at 07:00 instead.
        </div>
      </div>
    </section>
  );
}
