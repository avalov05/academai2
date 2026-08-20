'use client';
// ── Cmd+K palette: jump, search, quick-create ─────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, type View } from './AppContext';
import { etEndOfDay, todayEt, addDaysStr } from '@/lib/time';

const VIEWS: Array<{ v: View; label: string }> = [
  { v: 'RADAR', label: 'GO → RADAR' },
  { v: 'TODAY', label: 'GO → TODAY BRIEFING' },
  { v: 'TABLE', label: 'GO → MANIFEST (TABLE)' },
  { v: 'INTAKE', label: 'GO → INTAKE (PASTE ANYTHING)' },
  { v: 'PLAN', label: 'GO → PLAN / FORECAST' },
  { v: 'CLASSES', label: 'GO → CLASSES' },
  { v: 'GRADES', label: 'GO → GRADES' },
  { v: 'SETTINGS', label: 'GO → SETTINGS' },
];

export default function CommandPalette() {
  const app = useApp();
  const { paletteOpen, setPaletteOpen, data } = app;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (paletteOpen) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [paletteOpen]);

  const isCreate = q.startsWith('+');
  const createTitle = q.replace(/^\+\s*/, '');

  const results = useMemo(() => {
    if (isCreate) return [];
    const qq = q.toLowerCase().trim();
    const cmds = VIEWS.filter(v => !qq || v.label.toLowerCase().includes(qq))
      .map(v => ({ kind: 'view' as const, id: v.v as string, label: v.label, sub: '' }));
    const panic = (!qq || 'panic'.includes(qq)) ? [{ kind: 'panic' as const, id: 'panic', label: '⚠ PANIC — I HAVE N MINUTES', sub: '' }] : [];
    const items = qq.length >= 2
      ? data.items.filter(i => i.status === 'pending' && i.title.toLowerCase().includes(qq)).slice(0, 6)
        .map(i => ({
          kind: 'item' as const, id: i.id, label: i.title,
          sub: data.classes.find(c => c.id === i.class_id)?.code ?? 'LIFE',
        }))
      : [];
    return [...panic, ...items, ...cmds].slice(0, 10);
  }, [q, data, isCreate]);

  const run = async (idx: number) => {
    if (isCreate && createTitle.trim()) {
      // micro NLP: trailing "today"/"tomorrow"/"mon..sun" → due date
      let title = createTitle.trim(); let due: string | null = null;
      const m = title.match(/\s+(today|tomorrow|mon|tue|wed|thu|fri|sat|sun)$/i);
      if (m) {
        const w = m[1].toLowerCase();
        const t = todayEt();
        if (w === 'today') due = t;
        else if (w === 'tomorrow') due = addDaysStr(t, 1);
        else {
          const target = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w);
          for (let i = 1; i <= 7; i++) { const d = addDaysStr(t, i); if (new Date(d + 'T12:00:00').getUTCDay() === target) { due = d; break; } }
        }
        title = title.slice(0, m.index).trim();
      }
      const it = await app.addItem({ title, type: 'task', due_at: due ? etEndOfDay(due).toISOString() : null });
      app.notify(due ? `Added "${title}" due ${due}` : `Added "${title}" — set a date in the panel`, due ? 'ok' : 'warn');
      setPaletteOpen(false);
      if (!due) app.openDetail(it.id);
      return;
    }
    const r = results[idx];
    if (!r) return;
    if (r.kind === 'view') app.setView(r.id as View);
    if (r.kind === 'panic') app.setPanicOpen(true);
    if (r.kind === 'item') app.openDetail(r.id);
    setPaletteOpen(false);
  };

  if (!paletteOpen) return null;
  return (
    <div className="modal-wrap" onClick={() => setPaletteOpen(false)}>
      <div className="modal panel-solid corner" onClick={e => e.stopPropagation()}>
        <i className="c3" />
        <input
          ref={inputRef} type="text" value={q}
          placeholder="Type to jump / search · start with + to quick-add ( + call mom tue )"
          onChange={e => { setQ(e.target.value); setSel(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { setSel(s => Math.min(s + 1, results.length - 1)); e.preventDefault(); }
            if (e.key === 'ArrowUp') { setSel(s => Math.max(s - 1, 0)); e.preventDefault(); }
            if (e.key === 'Enter') run(sel);
            if (e.key === 'Escape') setPaletteOpen(false);
          }}
          style={{ fontSize: 14, padding: 14, border: 'none', borderBottom: '1px solid var(--line-strong)' }}
        />
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {isCreate && (
            <div className="row" style={{ padding: '12px 14px' }}>
              <span className="chip ok">CREATE</span>
              <span>{createTitle || '…'}</span>
              <span className="mono faint right-align" style={{ fontSize: 10 }}>⏎ TO ADD</span>
            </div>
          )}
          {!isCreate && results.map((r, i) => (
            <div key={r.kind + r.id} className="row" onMouseEnter={() => setSel(i)} onClick={() => run(i)}
              style={{ padding: '10px 14px', cursor: 'pointer', background: i === sel ? 'var(--accent-peri)' : 'transparent', borderLeft: i === sel ? '2px solid var(--charcoal)' : '2px solid transparent' }}>
              <span className="mono" style={{ fontSize: 12 }}>{r.label}</span>
              {r.sub && <span className="chip right-align">{r.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
