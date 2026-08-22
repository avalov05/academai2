'use client';
// ── SETTINGS: Gemini key, calendar feed, capacity, sound ─────────────────
import React, { useMemo, useState } from 'react';
import { useApp } from './AppContext';
import { MODEL_CHAIN } from '@/lib/gemini';
import { IS_DEMO } from '@/lib/store';
import { signOut, supaAccessToken } from './auth';
import { meetingSummary } from '@/lib/ics';
import PushPanel from './PushPanel';

interface KeyCheck { ok: boolean; models: string[]; error?: string; hint?: string; demo?: boolean }

export default function SettingsView() {
  const app = useApp();
  const { data, notify } = app;
  const s = data.settings;
  const [key, setKey] = useState(s.gemini_key);
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<KeyCheck | null>(null);
  const icsUrl = typeof location !== 'undefined' ? `${location.origin}/api/ics/${s.ics_token}` : '';
  const meetings = useMemo(() => meetingSummary(data), [data]);

  return (
    <div className="view-enter" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="micro">SYSTEM CONFIGURATION</div>
      <h2 className="display" style={{ fontSize: 30, margin: '6px 0 16px' }}>Settings</h2>

      <section className="panel corner" style={{ padding: 16, marginBottom: 14 }}>
        <i className="c3" />
        <div className="micro" style={{ marginBottom: 10 }}>EXTRACTION ENGINE — GEMINI API</div>
        <div className="row">
          <input type={showKey ? 'text' : 'password'} placeholder="Paste your Gemini API key"
            value={key} onChange={e => setKey(e.target.value)} style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => setShowKey(!showKey)}>{showKey ? 'HIDE' : 'SHOW'}</button>
          <button className="btn sm primary" onClick={() => { app.saveSettings({ gemini_key: key.trim() }); setCheck(null); notify('Gemini key saved'); }}>SAVE</button>
        </div>

        {key.trim() && !/^AIza[\w-]{20,}$/.test(key.trim()) && (
          <div style={{ fontSize: 11.5, marginTop: 7, color: '#8C4A12', lineHeight: 1.55 }}>
            That does not look like a Gemini API key — they start with{' '}
            <strong className="code">AIza</strong> (capital A, capital I, lowercase z, lowercase a).
            Keys copied from other parts of Google Cloud will be rejected. Get the right one at{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.
          </div>
        )}

        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <span className="micro">MODEL</span>
          <select value={s.gemini_model} onChange={e => app.saveSettings({ gemini_model: e.target.value })} style={{ width: 230 }}>
            {[...new Set([s.gemini_model, ...(check?.models ?? []), ...MODEL_CHAIN])]
              .filter(Boolean).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="btn sm" disabled={checking} onClick={async () => {
            setChecking(true); setCheck(null);
            try {
              const token = await supaAccessToken();
              const res = await fetch('/api/models', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
              const j = await res.json();
              setCheck(j);
              if (j.ok && j.models?.length && !j.models.includes(s.gemini_model)) {
                app.saveSettings({ gemini_model: j.models[0] });
                notify(`Switched to ${j.models[0]} — your old choice is not available on this key`, 'warn');
              }
            } catch (e) {
              setCheck({ ok: false, models: [], error: (e as Error).message });
            } finally { setChecking(false); }
          }}>{checking ? 'Checking…' : 'Check key'}</button>
        </div>

        {check && (
          <div style={{
            marginTop: 10, border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px',
            background: check.ok ? 'rgba(31,158,150,.06)' : 'rgba(224,85,95,.06)',
          }}>
            {check.ok ? (
              <>
                <div className="micro" style={{ color: '#145240' }}>
                  KEY WORKS · {check.models.length} MODELS AVAILABLE{check.demo ? ' (DEMO LIST)' : ''}
                </div>
                <div className="mono faint" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7 }}>
                  {check.models.slice(0, 14).join('  ·  ')}{check.models.length > 14 ? `  …+${check.models.length - 14}` : ''}
                </div>
              </>
            ) : (
              <>
                <div className="micro" style={{ color: '#A8241C' }}>KEY REJECTED</div>
                <div style={{ fontSize: 12.5, marginTop: 5 }}>{check.error}</div>
                {check.hint && <div style={{ fontSize: 12, marginTop: 5, color: 'var(--dim)', lineHeight: 1.55 }}>{check.hint}</div>}
              </>
            )}
          </div>
        )}

        <div className="mono faint" style={{ fontSize: 10, marginTop: 8 }}>
          if a model is unavailable or rate-limited the extractor walks down the list on its own
        </div>
      </section>

      <PushPanel />

      <section className="panel corner" style={{ padding: 16, marginBottom: 14 }}>
        <i className="c3" />
        <div className="micro" style={{ marginBottom: 10 }}>PHONE ALARMS — CALENDAR FEED</div>
        <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', padding: 10, background: 'rgba(255,255,255,.7)', border: '1px solid var(--line)', borderRadius: 6 }}>
          {IS_DEMO ? '(available after deploy)' : icsUrl}
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => { navigator.clipboard.writeText(icsUrl); notify('Feed URL copied'); }}>COPY FEED URL</button>
          <a className="btn sm" href={IS_DEMO ? '#' : `${icsUrl}?download=1`} download="academai.ics"
            onClick={e => { if (IS_DEMO) e.preventDefault(); }}>DOWNLOAD .ICS</a>
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
            <div className="micro" style={{ marginBottom: 4 }}>APPLE CALENDAR — USE THE FEED</div>
            <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
              iPhone: Calendar → Calendars → Add Calendar → Add Subscription → paste the URL.
              Mac: File → New Calendar Subscription. Set auto-refresh to <strong>every hour</strong> and
              turn <strong>Remove Alerts off</strong> — that switch is what decides whether the leave-by
              and deadline alarms actually ring.
            </div>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
            <div className="micro" style={{ marginBottom: 4 }}>GOOGLE CALENDAR — IMPORT, DON&apos;T SUBSCRIBE</div>
            <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
              Google never sends notifications for subscribed calendars, no matter what the feed asks for,
              and it can take a day to notice changes. So: <strong>Download .ICS</strong> above, then
              Settings → Import &amp; export → Import into a calendar you made for this. Alarms work on
              imported events. Re-import after you add a syllabus — same events update, they do not double.
            </div>
          </div>
        </div>

        <div className="mono faint" style={{ fontSize: 10, marginTop: 10, lineHeight: 1.6 }}>
          CONTENTS: every meeting as a proper repeating event (holidays excluded, not deleted) ·
          leave-by alarm on each · deadlines with two reminders · exams with three ·
          accepted study blocks as real busy time. Deadlines are marked free so they never black out a day.
        </div>

        {meetings.length > 0 && (
          <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
            <div className="micro" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
              WHAT IS ACTUALLY GOING ON YOUR CALENDAR — CHECK THESE COUNTS
            </div>
            {meetings.map(m => (
              <div key={m.label} className="row" style={{ padding: '7px 12px', borderTop: '1px solid var(--line)', gap: 10 }}>
                <span style={{ fontSize: 12.5, minWidth: 160 }}>{m.label}</span>
                <span className="chip" style={{ fontSize: 9.5, padding: '3px 9px' }}>{m.count} meetings</span>
                <span className="mono faint right-align" style={{ fontSize: 10.5 }}>{m.first} → {m.last}</span>
              </div>
            ))}
            <div className="faint" style={{ padding: '8px 12px', fontSize: 11, borderTop: '1px solid var(--line)' }}>
              A count that looks too high is almost always a class read as weekly when it is not.
              Fix the pattern in CLASSES and the calendar corrects itself on the next refresh.
            </div>
          </div>
        )}
      </section>

      <section className="panel corner" style={{ padding: 16, marginBottom: 14 }}>
        <i className="c3" />
        <div className="micro" style={{ marginBottom: 10 }}>PLANNING CAPACITY — HONEST FREE HOURS</div>
        <div className="grid2">
          <label className="field"><span className="micro">WEEKDAY FREE MINUTES</span>
            <input type="number" value={s.free_min_weekday} onChange={e => app.saveSettings({ free_min_weekday: Number(e.target.value) || 240 })} /></label>
          <label className="field"><span className="micro">WEEKEND FREE MINUTES</span>
            <input type="number" value={s.free_min_weekend} onChange={e => app.saveSettings({ free_min_weekend: Number(e.target.value) || 420 })} /></label>
        </div>
        <div className="mono faint" style={{ fontSize: 10 }}>drives hell-week collision detection. 240 = 4h of real work time on a class day.</div>
      </section>

      <section className="panel corner" style={{ padding: 16, marginBottom: 14 }}>
        <i className="c3" />
        <div className="row">
          <span className="micro">RADAR AUDIO — PINGS & ALARMS</span>
          <button className={`btn sm right-align ${s.sound_on ? 'primary' : ''}`} onClick={() => app.saveSettings({ sound_on: !s.sound_on })}>
            {s.sound_on ? 'ON' : 'MUTED'}
          </button>
        </div>
      </section>

      {!IS_DEMO && (
        <section className="row" style={{ marginTop: 20 }}>
          <button className="btn danger" onClick={signOut}>SIGN OUT</button>
          <span className="mono faint right-align" style={{ fontSize: 10 }}>ACADEMAI v1.0 · BUILT FOR THE 4.0</span>
        </section>
      )}
    </div>
  );
}
