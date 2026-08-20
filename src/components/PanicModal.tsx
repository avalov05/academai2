'use client';
// ── PANIC BUTTON: "I have N minutes" → exact marching orders ─────────────
import React, { useMemo, useState } from 'react';
import { useApp } from './AppContext';
import { panicPlan } from '@/lib/planner';
import { humanDelta } from '@/lib/time';
import { sfx } from '@/lib/sound';

const PRESETS = [30, 60, 90, 120, 180];

export default function PanicModal() {
  const { data, now, panicOpen, setPanicOpen, openDetail, setStatus } = useApp();
  const [mins, setMins] = useState(90);
  const picks = useMemo(() => panicPlan(data, now, mins), [data, now, mins]);
  if (!panicOpen) return null;
  const classById = new Map(data.classes.map(c => [c.id, c]));

  return (
    <div className="modal-wrap" onClick={() => setPanicOpen(false)}>
      <div className="modal panel-solid corner" style={{ padding: 22 }} onClick={e => e.stopPropagation()}>
        <i className="c3" />
        <div className="micro danger">PANIC PROTOCOL</div>
        <h2 className="display" style={{ fontSize: 30, margin: '6px 0 2px' }}>
          I HAVE <span className="iridescent-text num">{mins}</span> MINUTES
        </h2>
        <div className="mono dim" style={{ fontSize: 11, marginBottom: 14 }}>OPTIMIZED BY URGENCY × GRADE IMPACT ÷ EFFORT. NO THINKING REQUIRED — EXECUTE.</div>
        <div className="row" style={{ marginBottom: 6 }}>
          {PRESETS.map(p => (
            <button key={p} className={`btn sm ${p === mins ? 'primary' : ''}`} onClick={() => { setMins(p); sfx.tick(); }}>{p}M</button>
          ))}
          <input type="range" min={15} max={300} step={15} value={mins} onChange={e => setMins(Number(e.target.value))} style={{ flex: 1 }} />
        </div>
        <hr className="hairline" style={{ margin: '12px 0' }} />
        {picks.length === 0 && <div className="mono ok" style={{ padding: 20, textAlign: 'center', fontSize: 13 }}>NOTHING URGENT. THE RADAR IS QUIET — REST OR GET AHEAD.</div>}
        {picks.map((p, i) => {
          const k = classById.get(p.item.class_id ?? '');
          return (
            <div key={p.item.id} className="row" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
              <span className="display num" style={{ fontSize: 22, width: 34, color: i === 0 ? 'var(--acc)' : 'var(--dim)' }}>{String(i + 1).padStart(2, '0')}</span>
              <div style={{ flex: 1 }}>
                <div className="row">
                  <span className="chip" style={{ borderColor: (k?.color ?? '#6E6250') + '55' }}><span className="dot" style={{ background: k?.color ?? '#6E6250' }} />{k?.code ?? 'LIFE'}</span>
                  <button onClick={() => { setPanicOpen(false); openDetail(p.item.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 13.5, fontFamily: 'inherit', padding: 0 }}>
                    {p.item.title}
                  </button>
                </div>
                <div className="mono faint" style={{ fontSize: 10, marginTop: 2 }}>
                  {p.why}{p.item.due_at ? ` · due in ${humanDelta(new Date(p.item.due_at).getTime() - now.getTime())}` : ''}
                </div>
              </div>
              <span className="mono acc num" style={{ fontSize: 13 }}>{p.minutes}m</span>
              <button className="btn sm" onClick={() => setStatus(p.item.id, 'done')}>DONE ✓</button>
            </div>
          );
        })}
        <div className="row" style={{ marginTop: 14 }}>
          <span className="mono faint" style={{ fontSize: 10 }}>ESC TO CLOSE</span>
          <button className="btn right-align" onClick={() => setPanicOpen(false)}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}
