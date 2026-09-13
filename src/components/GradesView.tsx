'use client';
// ── GRADES: standing per class + need-on-final solver + what-if ──────────
import React, { useMemo, useState } from 'react';
import { useApp } from './AppContext';
import { classStanding, letterFor } from '@/lib/grades';
import type { Klass } from '@/lib/types';
import { fmtEt } from '@/lib/time';

export default function GradesView() {
  const { data } = useApp();
  return (
    <div className="view-enter" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="micro">GRADE TELEMETRY · TARGET: STRAIGHT A&apos;S</div>
      <h2 className="display" style={{ fontSize: 'var(--t-display-sm)', margin: '10px 0 var(--s-6)' }}>The <span className="iridescent-text">4.0</span> Ledger</h2>
      {data.classes.length === 0 && <div className="empty-note">Add classes first — grading schemes ride in with each syllabus.</div>}
      {data.classes.map(k => <GradeCard key={k.id} k={k} />)}
    </div>
  );
}

function GradeCard({ k }: { k: Klass }) {
  const app = useApp();
  const { data } = app;
  const st = useMemo(() => classStanding(k, data.scores), [k, data.scores]);
  const [whatIf, setWhatIf] = useState(st.neededOnRemaining != null ? Math.min(100, Math.max(0, Math.round(st.neededOnRemaining))) : 90);
  const [logOpen, setLogOpen] = useState(false);
  const [bucket, setBucket] = useState(k.grading[0]?.name ?? '');
  const [earned, setEarned] = useState(''); const [possible, setPossible] = useState(''); const [note, setNote] = useState('');

  // what-if: final grade if remaining weight scores whatIf%
  const totalW = k.grading.reduce((a, b) => a + b.weight_pct, 0) || 100;
  const earnedW = st.buckets.reduce((a, b) => a + b.earnedWeight, 0);
  const remainW = totalW - st.gradedWeight;
  const projected = (earnedW + (remainW * whatIf) / 100) / totalW * 100;

  // Theme tokens, not literals: this is the number the whole screen exists to
  // show, and the light-mode literals it used to carry fail AA on a dark canvas.
  const needColor = st.neededOnRemaining == null ? 'var(--dim)'
    : st.neededOnRemaining > 100 ? 'var(--danger)'
    : st.neededOnRemaining > 92 ? 'var(--warn)' : 'var(--ok)';

  return (
    <div
      className="panel corner"
      style={{
        padding: 24, marginBottom: 18,
        borderLeft: `4px solid ${k.color}`,
        // a faint tint of the class colour bleeding into the card corner —
        // ties the accent bar to the surface instead of leaving it isolated
        backgroundImage: `radial-gradient(420px 180px at 0% 0%, color-mix(in srgb, ${k.color} 7%, transparent), transparent 70%)`,
      }}
    >
      <i className="c3" />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div style={{ minWidth: 180, position: 'relative' }}>
          <div className="row"><strong style={{ fontSize: 'var(--t-lg)' }}>{k.code}</strong><span className="dim" style={{ fontSize: 'var(--t-sm)' }}>{k.name}</span></div>
          <div style={{ position: 'relative', marginTop: 2 }}>
            {/* the one number this whole card exists to show — a soft glow in
                the class colour instead of a flat number on white */}
            <div aria-hidden="true" style={{
              position: 'absolute', left: -24, right: -10, top: -8, height: 88,
              background: `radial-gradient(60% 100% at 15% 55%, color-mix(in srgb, ${k.color} 32%, transparent), transparent 72%)`,
              pointerEvents: 'none', zIndex: 0,
            }} />
            <div className="display-xl num" style={{ color: k.color, position: 'relative', fontSize: 'clamp(40px, 4.4vw, 56px)' }}>
              {st.currentPct != null ? st.currentPct.toFixed(1) : '—'}
              <span style={{ fontSize: 'var(--t-xl)', color: 'var(--dim)', fontWeight: 600, letterSpacing: 0 }}> {st.currentPct != null ? letterFor(st.currentPct) : ''}</span>
            </div>
          </div>
          <div className="micro" style={{ marginTop: 4 }}>CURRENT · {st.gradedWeight}% OF GRADE BANKED</div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          {k.grading.map(b => {
            const bs = st.buckets.find(x => x.bucket.name === b.name)!;
            return (
              <div key={b.name} className="row" style={{ padding: '4px 0' }}>
                <span className="mono dim" style={{ fontSize: 10.5, width: 150 }}>{b.name.toUpperCase()} · {b.weight_pct}%{b.drops ? ` · DROP ${b.drops}` : ''}</span>
                <div className="bar" style={{ flex: 1 }}>
                  <i style={{ width: `${bs.avg ?? 0}%`, background: bs.avg == null ? 'transparent' : bs.avg >= k.target_pct ? '#2E9E7E' : bs.avg >= 80 ? '#E8A33D' : '#E0555F' }} />
                </div>
                <span className="mono num" style={{ fontSize: 11, width: 52, textAlign: 'right', color: bs.avg == null ? 'var(--faint)' : 'var(--text)' }}>
                  {bs.avg == null ? 'N/A' : bs.avg.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ minWidth: 210 }}>
          <div className="micro" style={{ marginBottom: 6 }}>TO HOLD {k.target_pct}% ({letterFor(k.target_pct)})</div>
          <div className="display num" style={{ fontSize: 'var(--t-2xl)', color: needColor }}>
            {st.neededOnRemaining == null ? 'DONE' : st.neededOnRemaining <= 0 ? 'SECURED ✓' : st.neededOnRemaining > 100 ? `${st.neededOnRemaining.toFixed(1)}% ⚠` : `≥ ${st.neededOnRemaining.toFixed(1)}%`}
          </div>
          <div className="micro" style={{ margin: '2px 0 10px' }}>AVG NEEDED ON REMAINING {remainW}%</div>
          <div className="micro">WHAT-IF: SCORE <span className="acc num">{whatIf}%</span> ON THE REST →
            <span className="num" style={{ color: projected >= k.target_pct ? 'var(--ok)' : 'var(--danger)' }}> {projected.toFixed(1)}% {letterFor(projected)}</span>
          </div>
          <label className="sr-only" htmlFor={`whatif-${k.id}`}>What-if score on remaining work, percent</label>
          <input id={`whatif-${k.id}`} type="range" min={50} max={100} value={whatIf}
            aria-valuetext={`${whatIf} percent`}
            onChange={e => setWhatIf(Number(e.target.value))} />
        </div>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm" onClick={() => setLogOpen(!logOpen)}>{logOpen ? 'CLOSE' : `LOG SCORE (${data.scores.filter(s => s.class_id === k.id).length} LOGGED)`}</button>
      </div>
      {logOpen && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="sr-only" htmlFor={`sc-bucket-${k.id}`}>Grading bucket</label>
            <select id={`sc-bucket-${k.id}`} name="bucket" value={bucket} onChange={e => setBucket(e.target.value)} style={{ width: 160 }}>
              {k.grading.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
            <label className="sr-only" htmlFor={`sc-earned-${k.id}`}>Points earned</label>
            <input id={`sc-earned-${k.id}`} type="number" inputMode="decimal" name="earned" autoComplete="off"
              placeholder="earned" value={earned} onChange={e => setEarned(e.target.value)} style={{ width: 90 }} />
            <span className="faint" aria-hidden="true">/</span>
            <label className="sr-only" htmlFor={`sc-possible-${k.id}`}>Points possible</label>
            <input id={`sc-possible-${k.id}`} type="number" inputMode="decimal" name="possible" autoComplete="off"
              placeholder="possible" value={possible} onChange={e => setPossible(e.target.value)} style={{ width: 90 }} />
            <label className="sr-only" htmlFor={`sc-note-${k.id}`}>Note</label>
            <input id={`sc-note-${k.id}`} type="text" name="note" autoComplete="off" spellCheck={false}
              placeholder="note, e.g. HW3…" value={note} onChange={e => setNote(e.target.value)} style={{ width: 130 }} />
            <button className="btn sm primary" disabled={!bucket || !earned || !possible}
              onClick={() => { app.insertScore({ class_id: k.id, item_id: null, bucket, earned: Number(earned), possible: Number(possible), note, graded_at: new Date().toISOString() }); setEarned(''); setPossible(''); setNote(''); }}>
              LOG
            </button>
          </div>
          {data.scores.filter(s => s.class_id === k.id).sort((a, b) => b.graded_at.localeCompare(a.graded_at)).map(s => (
            <div key={s.id} className="row item-row" style={{ padding: '6px 8px', borderRadius: 8, borderBottom: '1px solid var(--line)' }}>
              <span className="mono dim" style={{ fontSize: 10.5, width: 140 }}>{s.bucket.toUpperCase()}</span>
              <span className="mono num" style={{ fontSize: 12 }}>{s.earned}/{s.possible} ({(100 * s.earned / s.possible).toFixed(1)}%)</span>
              <span className="dim" style={{ fontSize: 11 }}>{s.note}</span>
              <span className="mono faint right-align" style={{ fontSize: 10 }}>{s.graded_at ? fmtEt(new Date(s.graded_at), 'MMM d') : ''}</span>
              <button className="btn sm danger" type="button"
                aria-label={`Delete score ${s.earned} of ${s.possible} in ${s.bucket}`}
                onClick={() => app.deleteScore(s.id)}><span aria-hidden="true">✕</span></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
