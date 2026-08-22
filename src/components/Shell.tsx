'use client';
// ── App shell: nav, status, keyboard map, view switching ─────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { useApp, type View } from './AppContext';
import Radar from './Radar';
import TodayView from './TodayView';
import TableView from './TableView';
import IntakeView from './IntakeView';
import PlanView from './PlanView';
import ClassesView from './ClassesView';
import GradesView from './GradesView';
import SettingsView from './SettingsView';
import DetailPanel from './DetailPanel';
import CommandPalette from './CommandPalette';
import PanicModal from './PanicModal';
import FirstRun from './FirstRun';
import { isOverdue, integrity, briefing } from '@/lib/planner';
import { fmtEt } from '@/lib/time';

const NAV: Array<{ v: View; label: string; k: string }> = [
  { v: 'RADAR', label: 'RADAR', k: 'R' },
  { v: 'TODAY', label: 'TODAY', k: 'D' },
  { v: 'TABLE', label: 'MANIFEST', k: 'T' },
  { v: 'INTAKE', label: 'INTAKE', k: 'V' },
  { v: 'PLAN', label: 'PLAN', k: 'W' },
  { v: 'CLASSES', label: 'CLASSES', k: 'C' },
  { v: 'GRADES', label: 'GRADES', k: 'G' },
];

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return <span className="mono dim num" style={{ fontSize: 11 }}>{fmtEt(t, 'HH:mm:ss')} ET</span>;
}

export default function Shell() {
  const app = useApp();
  const { data, now, view, setView, detailId } = app;

  const overdueCount = useMemo(() => data.items.filter(i => isOverdue(i, now)).length, [data.items, now]);
  const dueToday = useMemo(() => briefing(data, now).dueToday.length, [data, now]);
  const intg = useMemo(() => integrity(data, now), [data, now]);
  const inZone = useMemo(() => data.items.filter(i =>
    !i.ghost && i.status === 'pending' && i.due_at
    && new Date(i.due_at).getTime() > now.getTime()
    && (new Date(i.due_at).getTime() - now.getTime()) / 3600000 <= 24).length,
  [data.items, now]);
  const ghostCount = data.items.filter(i => i.ghost && i.status === 'pending').length;
  const needsSetup = !data.semester || data.classes.length === 0;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); app.setPaletteOpen(true); return; }
      if (typing) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Escape') { app.openDetail(null); app.setPanicOpen(false); app.setPaletteOpen(false); return; }
      const k = e.key.toUpperCase();
      const nav = NAV.find(n => n.k === k);
      if (nav) { setView(nav.v); return; }
      if (k === 'P') app.setPanicOpen(true);
      if (k === 'S') setView('SETTINGS');
      if (k === 'N') { app.setPaletteOpen(true); setTimeout(() => { /* user types + */ }, 0); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [app, setView]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="sig" />
          ACADEM<span className="acc">AI</span>
        </div>
        <nav className="nav">
          {NAV.map(n => (
            <button key={n.v} className={view === n.v ? 'active' : ''} onClick={() => setView(n.v)}>
              {n.label}
              {n.v === 'PLAN' && ghostCount > 0 && <span className="warn"> ◇{ghostCount}</span>}
              <span className="k">{n.k}</span>
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="right">
          {overdueCount > 0 && <span className="chip hot">{overdueCount} OVERDUE</span>}
          {inZone > 0 && (
            <span className="chip danger-zone" title="due within 24 hours — the band where a miss stops being recoverable">
              {inZone} IN 24H
            </span>
          )}
          <span className="chip">{dueToday} DUE TODAY</span>
          <span className="chip ok" title="on-time / missed / day streak">{intg.missed === 0 ? `0 MISSED · ${intg.streakDays}D` : `${intg.missed} MISSED`}</span>
          <button className="btn sm primary" onClick={() => app.setPanicOpen(true)} title="Panic — I have N minutes (P)">Panic</button>
          <button className="btn sm" onClick={() => setView('SETTINGS')} title="Settings (S)" style={{ padding: '5px 10px' }}>⚙</button>
          <Clock />
        </div>
      </header>

      <main className="main">
        {view === 'RADAR' && (needsSetup ? <FirstRun /> : <Radar />)}
        {view === 'TODAY' && <TodayView />}
        {view === 'TABLE' && <TableView />}
        {view === 'INTAKE' && <IntakeView />}
        {view === 'PLAN' && <PlanView />}
        {view === 'CLASSES' && <ClassesView />}
        {view === 'GRADES' && <GradesView />}
        {view === 'SETTINGS' && <SettingsView />}
      </main>

      {view === 'RADAR' && !needsSetup && (
        <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '10px 18px', display: 'flex', gap: 18, pointerEvents: 'none', flexWrap: 'wrap' }}>
          <span className="mono dim" style={{ fontSize: 10 }}>◆ COMMITTED · ◇ PROPOSED (dashed) · CENTER = NOW · RIM = 3 WEEKS OUT</span>
          <span className="mono dim" style={{ fontSize: 10 }}>RINGED ◆ = TEST (EXAM / IN-CLASS QUIZ) · ■ PROJECT · ● WORK</span>
          <span className="mono dim right-align" style={{ fontSize: 10 }}>⌘K PALETTE · P PANIC · V PASTE-IN · CLICK BLIP = DETAIL</span>
        </footer>
      )}

      {detailId && <DetailPanel />}
      <CommandPalette />
      <PanicModal />
      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts } = useApp();
  return (
    <div style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} className="panel-solid boot-in" style={{
          padding: '12px 16px', fontSize: 12.5, maxWidth: 360,
          boxShadow: 'var(--shadow-dark)',
          borderLeft: `4px solid var(--${t.tone === 'ok' ? 'ok' : t.tone === 'warn' ? 'warn' : 'danger'})`,
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
