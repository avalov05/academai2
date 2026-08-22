'use client';
// ── PLAN: workload forecast, hell-week detection, ghost approvals, sweep ──
import React, { useMemo, useState } from 'react';
import { useApp } from './AppContext';
import { weeklyForecast, integrity } from '@/lib/planner';
import { fmtEt, humanDelta } from '@/lib/time';
import { sfx } from '@/lib/sound';

export default function PlanView() {
  const app = useApp();
  const { data, now, openDetail } = app;
  const forecast = useMemo(() => weeklyForecast(data, now, 10), [data, now]);
  const ghosts = data.items.filter(i => i.ghost && i.status === 'pending');
  const intg = useMemo(() => integrity(data, now), [data, now]);
  const classById = new Map(data.classes.map(c => [c.id, c]));
  const [sweepStep, setSweepStep] = useState(-1);
  // bars are scaled by hours, because hours are the number printed above them.
  // ratio decides the colour — that is the "am I over capacity" signal.
  const maxHours = Math.max(1, ...forecast.map(f => f.effortMin / 60));

  const undated = data.items.filter(i => i.status === 'pending' && !i.ghost && !i.due_at);
  const stale = data.items.filter(i => i.status === 'pending' && !i.ghost && i.due_at
    && new Date(i.due_at).getTime() < now.getTime() - 86400000);
  const sweepChecks = [
    { label: 'Overdue items — resolve each one (done, rescheduled, or marked missed)', items: stale },
    { label: 'Undated items — every one is a silent grade risk. Give it a date.', items: undated },
    { label: 'Proposed study blocks — accept or dismiss', items: ghosts },
  ];

  const acceptAll = async () => {
    for (const g of ghosts) await app.acceptGhost(g.id);
    sfx.boot();
  };

  return (
    <div className="view-enter" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="micro">COLLISION FORECAST — {forecast.filter(f => f.hell).length} HELL WEEK{forecast.filter(f => f.hell).length === 1 ? '' : 'S'} DETECTED</div>
      <h2 className="display" style={{ fontSize: 30, margin: '6px 0 16px' }}>The next <span className="iridescent-text">{forecast.length} weeks</span></h2>

      <div className="panel corner" style={{ padding: 18 }}>
        <i className="c3" />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          {forecast.map(f => (
            <div key={f.weekOf} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: f.hell ? 'var(--danger)' : 'var(--dim)' }}>
                {Math.round(f.effortMin / 60)}h
              </span>
              <div style={{ width: '100%', maxWidth: 54, height: 132, display: 'flex', alignItems: 'flex-end' }}>
                <div title={`${f.dueCount} due · ${Math.round(f.effortMin / 60)}h work vs ~${Math.round(f.capacityMin / 60)}h free`}
                  className={f.hell ? 'alarm' : ''}
                  style={{
                    width: '100%', flexShrink: 0,
                    height: `${Math.max(3, (f.effortMin / 60 / maxHours) * 100)}%`,
                    background: f.hell
                      ? 'linear-gradient(to top, #ff6a88 0%, #ffb3a6 100%)'
                      : 'linear-gradient(to top, #a8b2ff 0%, #d9e3ff 100%)',
                    border: '1px solid ' + (f.hell ? '#f2a2ab' : '#c3cdf5'), borderRadius: '8px 8px 3px 3px',
                  }} />
              </div>
              <span className="mono" style={{ fontSize: 8.5, letterSpacing: '.08em', color: f.hell ? 'var(--danger)' : 'var(--faint)' }}>{f.label}</span>
              <span className="mono" style={{ fontSize: 8, color: 'var(--danger)', minHeight: 11, visibility: f.exams.length ? 'visible' : 'hidden' }}>
                {'◆'.repeat(Math.max(1, f.exams.length))} EXAM
              </span>
            </div>
          ))}
        </div>
        {forecast.some(f => f.hell) && (
          <div className="mono warn" style={{ fontSize: 11, marginTop: 12 }}>
            ⚠ {forecast.filter(f => f.hell).map(f => f.label).join(', ')}: load exceeds capacity — the accepted study blocks and early starts below defuse this.
          </div>
        )}
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="panel corner" style={{ padding: 16 }}>
          <i className="c3" />
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="micro">PROPOSED — {ghosts.length} SUGGESTION{ghosts.length === 1 ? '' : 'S'}</span>
            {ghosts.length > 0 && <button className="btn sm primary right-align" onClick={acceptAll}>ACCEPT ALL</button>}
          </div>
          {ghosts.length === 0 && <div className="empty-note">No open proposals. The plan is fully committed.</div>}
          {ghosts.map(g => {
            const k = classById.get(g.class_id ?? '');
            return (
              <div key={g.id} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="chip ghost" style={{ borderColor: (k?.color ?? '#8A8A84') + '77' }}>
                  <span className="dot" style={{ background: k?.color ?? '#8A8A84' }} />{k?.code ?? 'LIFE'}
                </span>
                <button onClick={() => openDetail(g.id)} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, textAlign: 'left', padding: 0, flex: 1 }}>
                  ◇ {g.title}
                </button>
                <span className="mono faint" style={{ fontSize: 10 }}>{g.due_at ? fmtEt(new Date(g.due_at), 'EEE MMM d') : ''}</span>
                <button className="btn sm" onClick={() => app.acceptGhost(g.id)}>A ✓</button>
                <button className="btn sm danger" onClick={() => app.deleteItem(g.id)}>✕</button>
              </div>
            );
          })}
        </section>

        <section className="panel corner dark" style={{ padding: 18 }}>
          <i className="c3" />
          <div className="micro" style={{ marginBottom: 12 }}>INTEGRITY METER — THE 4.0 LEDGER</div>
          <div className="row" style={{ gap: 24 }}>
            <div>
              <div className="display num" style={{ fontSize: 46, color: intg.missed === 0 ? '#7FD1C4' : '#FF949C' }}>{intg.missed === 0 ? '0' : intg.missed}</div>
              <div className="micro">MISSED — EVER</div>
            </div>
            <div>
              <div className="display num" style={{ fontSize: 46 }}>{intg.onTime}</div>
              <div className="micro">ON TIME</div>
            </div>
            <div>
              <div className="display num iridescent-text" style={{ fontSize: 46 }}>{intg.streakDays}</div>
              <div className="micro">DAY STREAK</div>
            </div>
          </div>
          <div className="bar" style={{ marginTop: 14 }}>
            <i style={{ width: `${intg.pct}%`, background: intg.pct >= 95 ? '#7FD1C4' : intg.pct >= 80 ? '#F4C5CA' : '#FF949C' }} />
          </div>
          <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>{intg.pct}% ON-TIME COMPLETION{intg.late ? ` · ${intg.late} LATE` : ''}</div>
        </section>
      </div>

      <section className="panel corner" style={{ padding: 16, marginTop: 16 }}>
        <i className="c3" />
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="micro">SUNDAY SWEEP — 5-MINUTE GAP AUDIT</span>
          {sweepStep === -1 && <button className="btn sm right-align" onClick={() => { setSweepStep(0); sfx.boot(); }}>BEGIN SWEEP</button>}
        </div>
        {sweepStep === -1 && (
          <div className="dim mono" style={{ fontSize: 11.5 }}>
            Weekly ritual: verify nothing slipped through. Checks overdue items, undated items, and open proposals — then asks the one question that saves semesters: &quot;does the app match reality?&quot;
          </div>
        )}
        {sweepStep >= 0 && sweepStep < sweepChecks.length && (() => {
          const step = sweepChecks[sweepStep];
          return (
            <div className="boot-in" key={sweepStep}>
              <div className="mono" style={{ fontSize: 12, margin: '10px 0' }}>
                [{sweepStep + 1}/{sweepChecks.length + 1}] {step.label}
              </div>
              {step.items.length === 0
                ? <div className="ok mono" style={{ fontSize: 12 }}>✓ CLEAR</div>
                : step.items.map(i2 => (
                  <div key={i2.id} className="row" style={{ padding: '5px 0' }}>
                    <button onClick={() => openDetail(i2.id)} style={{ background: 'none', border: 'none', color: 'var(--warn)', cursor: 'pointer', fontFamily: 'var(--font-m)', fontSize: 12, padding: 0 }}>
                      → {i2.title}
                    </button>
                    <span className="mono faint" style={{ fontSize: 10 }}>{i2.due_at ? humanDelta(new Date(i2.due_at).getTime() - now.getTime()) : 'UNDATED'}</span>
                  </div>
                ))}
              <button className="btn sm" style={{ marginTop: 10 }} onClick={() => { setSweepStep(sweepStep + 1); sfx.tick(); }}>NEXT →</button>
            </div>
          );
        })()}
        {sweepStep === sweepChecks.length && (
          <div className="boot-in">
            <div className="mono" style={{ fontSize: 12, margin: '10px 0' }}>
              [{sweepChecks.length + 1}/{sweepChecks.length + 1}] REALITY CHECK — open Moodle/email once. Any assignment announced this week that the radar doesn&apos;t show?
            </div>
            <div className="row">
              <button className="btn sm primary" onClick={() => { app.setView('INTAKE'); setSweepStep(-1); }}>YES — PASTE IT NOW</button>
              <button className="btn sm ok" onClick={() => { setSweepStep(-1); sfx.confirm(); app.notify(`Sweep complete — radar verified against reality ${fmtEt(now, 'MMM d')}`, 'ok'); }}>NO — SWEEP COMPLETE ✓</button>
            </div>
          </div>
        )}
      </section>

      <section style={{ marginTop: 16 }}>
        <div className="micro" style={{ marginBottom: 8 }}>EXAM APPROACH CORRIDOR</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {data.items.filter(i => i.status === 'pending' && !i.ghost && i.type === 'exam' && i.due_at && new Date(i.due_at) > now)
            .sort((a, b) => a.due_at!.localeCompare(b.due_at!))
            .map(ex => {
              const k = classById.get(ex.class_id ?? '');
              const blocks = data.items.filter(i => i.parent_id === ex.id && i.status !== 'dropped');
              const accepted = blocks.filter(b => !b.ghost);
              const daysOut = Math.ceil((new Date(ex.due_at!).getTime() - now.getTime()) / 86400000);
              return (
                <div key={ex.id} className="panel corner" style={{ padding: 14, minWidth: 230, flex: 1, borderColor: daysOut <= 5 ? 'rgba(255,176,59,.5)' : undefined }}>
                  <i className="c3" />
                  <div className="row">
                    <span className="chip" style={{ borderColor: (k?.color ?? '#fff') + '66' }}><span className="dot" style={{ background: k?.color }} />{k?.code}</span>
                    <span className={`mono right-align num ${daysOut <= 5 ? 'warn' : 'dim'}`} style={{ fontSize: 11 }}>T−{daysOut}D</span>
                  </div>
                  <button onClick={() => openDetail(ex.id)} style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontWeight: 700, fontSize: 14, padding: 0, margin: '6px 0 4px', fontFamily: 'inherit' }}>◆ {ex.title}</button>
                  <div className="mono dim" style={{ fontSize: 10 }}>
                    {fmtEt(new Date(ex.due_at!), 'EEE MMM d · HH:mm')} · {accepted.length}/{blocks.length || 3} STUDY BLOCKS ARMED
                  </div>
                  <div className="bar" style={{ marginTop: 8 }}>
                    <i style={{ width: `${blocks.length ? (100 * accepted.length / blocks.length) : 0}%`, background: k?.color ?? 'var(--acc)' }} />
                  </div>
                </div>
              );
            })}
          {data.items.filter(i => i.status === 'pending' && !i.ghost && i.type === 'exam').length === 0 && (
            <div className="dim mono" style={{ fontSize: 12 }}>No exams on the radar yet. When one lands, study blocks auto-spawn at T−5/3/1.</div>
          )}
        </div>
      </section>
    </div>
  );
}
