'use client';
// ── SETTINGS: Gemini key, calendar feed, capacity, sound ─────────────────
import React, { useState } from 'react';
import { useApp } from './AppContext';
import { MODEL_CHAIN } from '@/lib/gemini';
import { IS_DEMO } from '@/lib/store';
import { signOut } from './auth';

export default function SettingsView() {
  const app = useApp();
  const { data, notify } = app;
  const s = data.settings;
  const [key, setKey] = useState(s.gemini_key);
  const [showKey, setShowKey] = useState(false);
  const icsUrl = typeof location !== 'undefined' ? `${location.origin}/api/ics/${s.ics_token}` : '';

  return (
    <div className="view-enter" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="micro">SYSTEM CONFIGURATION</div>
      <h2 className="display" style={{ fontSize: 30, margin: '6px 0 16px' }}>Settings</h2>

      <section className="panel corner" style={{ padding: 16, marginBottom: 14 }}>
        <i className="c3" />
        <div className="micro" style={{ marginBottom: 10 }}>EXTRACTION ENGINE — GEMINI API</div>
        <div className="row">
          <input type={showKey ? 'text' : 'password'} placeholder="AIza… (aistudio.google.com → Get API key)"
            value={key} onChange={e => setKey(e.target.value)} style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => setShowKey(!showKey)}>{showKey ? 'HIDE' : 'SHOW'}</button>
          <button className="btn sm primary" onClick={() => { app.saveSettings({ gemini_key: key.trim() }); notify('Gemini key saved'); }}>SAVE</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="micro">MODEL</span>
          <select value={s.gemini_model} onChange={e => app.saveSettings({ gemini_model: e.target.value })} style={{ width: 220 }}>
            {[s.gemini_model, ...MODEL_CHAIN.filter(m => m !== s.gemini_model)].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="mono faint" style={{ fontSize: 10 }}>auto-falls back down the chain if a model 404s or rate-limits</span>
        </div>
      </section>

      <section className="panel corner" style={{ padding: 16, marginBottom: 14 }}>
        <i className="c3" />
        <div className="micro" style={{ marginBottom: 10 }}>PHONE ALARMS — LIVE CALENDAR FEED (ICS)</div>
        <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', padding: 10, background: 'rgba(255,255,255,.7)', border: '1px solid var(--line)', borderRadius: 6 }}>
          {IS_DEMO ? '(available after deploy)' : icsUrl}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => { navigator.clipboard.writeText(icsUrl); notify('Feed URL copied'); }}>COPY URL</button>
          <span className="dim" style={{ fontSize: 11.5 }}>
            Google Calendar: Other calendars → + → From URL. Apple: Settings → Calendar → Accounts → Add Subscribed Calendar. Every meeting (with leave-by alarms), deadline, and study block — updated automatically.
          </span>
        </div>
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
