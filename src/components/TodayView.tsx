'use client';
// ── TODAY: boot-sequence daily briefing ───────────────────────────────────
import React, { useMemo } from 'react';
import { useApp } from './AppContext';
import { briefing } from '@/lib/planner';
import { fmtEt, humanDelta, todayEt, daysBetween, utcToEtDate } from '@/lib/time';
import { KIND_LABEL } from '@/lib/types';
import { urgencyOf, inDangerZone, URGENCY } from '@/lib/types';
import { TYPE_GLYPH } from '@/lib/palette';

export default function TodayView() {
  const { data, now, openDetail, setStatus } = useApp();
  const b = useMemo(() => briefing(data, now), [data, now]);
  const classById = useMemo(() => new Map(data.classes.map(c => [c.id, c])), [data.classes]);
  const compById = useMemo(() => new Map(data.components.map(c => [c.id, c])), [data.components]);
  const dayN = data.semester ? daysBetween(data.semester.start_date, todayEt(now)) + 1 : 0;
  const nextMeeting = b.meetings.find(m => m.end.getTime() > now.getTime());
  const startToday = data.items.filter(i => i.status === 'pending' && !i.ghost && i.start_suggested_at
    && utcToEtDate(new Date(i.start_suggested_at)) <= todayEt(now)
    && (!i.due_at || new Date(i.due_at).getTime() > now.getTime()));

  let d = 0;
  const delay = () => ({ animationDelay: `${(d += 60)}ms` } as React.CSSProperties);

  return (
    <div className="view-enter" style={{ maxWidth: 980, margin: '0 auto' }}>
      <div className="boot-in" style={delay()}>
        <div className="micro">DAILY BRIEF · DAY {String(Math.max(1, dayN)).padStart(2, '0')} OF SEMESTER</div>
        <h1 className="display" style={{ fontSize: 'clamp(34px, 6vw, 64px)', margin: '6px 0 4px' }}>
          {fmtEt(now, 'EEEE')}<br />
          <span className="iridescent-text">{fmtEt(now, 'MMMM d')}</span>
        </h1>
        <div className="mono dim" style={{ fontSize: 12 }}>{fmtEt(now, 'HH:mm')} ET · SYSTEM CHECK: {b.overdue.length ? <span className="danger">{b.overdue.length} OVERDUE</span> : <span className="ok">NOMINAL</span>} · {b.dueToday.length} DUE · {b.meetings.length} MEETINGS</div>
      </div>

      {b.overdue.length > 0 && (
        <section className="panel corner dark boot-in" style={{ marginTop: 22, padding: 18, ...delay() }}>
          <i className="c3" />
          <div className="micro" style={{ color: '#FF8A9E' }}>OVERDUE — RESOLVE FIRST</div>
          {b.overdue.map(it => (
            <RowItem key={it.id} it={it} cls={classById.get(it.class_id ?? '')} now={now}
              onOpen={() => openDetail(it.id)} onDone={() => setStatus(it.id, 'done')} danger />
          ))}
        </section>
      )}

      <div className="grid2" style={{ marginTop: 22 }}>
        <section className="panel corner boot-in" style={{ padding: 16, ...delay() }}>
          <i className="c3" />
          <div className="micro" style={{ marginBottom: 10 }}>TODAY&apos;S MEETINGS</div>
          {b.meetings.length === 0 && <div className="empty-note">No meetings. Async day — the radar still watches.</div>}
          {b.meetings.map(m => {
            const comp = compById.get(m.component_id);
            const k = classById.get(m.class_id);
            const past = m.end.getTime() < now.getTime();
            const isNext = nextMeeting === m;
            const leaveIn = m.leaveBy.getTime() - now.getTime();
            return (
              <div key={m.component_id + m.date + m.start.toISOString()} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', opacity: past ? 0.4 : 1 }}>
                <span className="mono" style={{ fontSize: 12, width: 92 }}>{fmtEt(m.start, 'HH:mm')}–{fmtEt(m.end, 'HH:mm')}</span>
                <span className="chip"><span className="dot" style={{ background: k?.color }} />{k?.code} {comp?.kind}</span>
                <span className="dim" style={{ fontSize: 12 }}>{comp?.location}</span>
                {isNext && !past && (
                  <span className={`right-align mono ${leaveIn < 0 ? 'danger glitch' : leaveIn < 15 * 60000 ? 'warn' : 'dim'}`} style={{ fontSize: 11 }}>
                    {leaveIn < 0 ? 'LEAVE NOW' : `LEAVE IN ${humanDelta(leaveIn)}`}
                  </span>
                )}
              </div>
            );
          })}
        </section>

        <section className="panel corner boot-in" style={{ padding: 16, ...delay() }}>
          <i className="c3" />
          <div className="micro" style={{ marginBottom: 10 }}>DUE TODAY</div>
          {b.dueToday.length === 0 && <div className="empty-note">Nothing due today.</div>}
          {b.dueToday.map(it => (
            <RowItem key={it.id} it={it} cls={classById.get(it.class_id ?? '')} now={now}
              onOpen={() => openDetail(it.id)} onDone={() => setStatus(it.id, 'done')} />
          ))}
        </section>
      </div>

      <div className="grid2" style={{ marginTop: 14 }}>
        <section className="panel corner boot-in" style={{ padding: 16, ...delay() }}>
          <i className="c3" />
          <div className="micro" style={{ marginBottom: 10 }}>START TODAY — DEFUSE FUTURE PILE-UPS</div>
          {startToday.length === 0 && <div className="empty-note">No early starts scheduled.</div>}
          {startToday.slice(0, 6).map(it => (
            <RowItem key={it.id} it={it} cls={classById.get(it.class_id ?? '')} now={now}
              onOpen={() => openDetail(it.id)} onDone={() => setStatus(it.id, 'done')} startMode />
          ))}
        </section>
        <section className="panel corner boot-in" style={{ padding: 16, ...delay() }}>
          <i className="c3" />
          <div className="micro" style={{ marginBottom: 10 }}>INBOUND — NEXT 72H</div>
          {b.upcoming.length === 0 && <div className="empty-note">Clear skies for 72 hours.</div>}
          {b.upcoming.slice(0, 8).map(it => (
            <RowItem key={it.id} it={it} cls={classById.get(it.class_id ?? '')} now={now}
              onOpen={() => openDetail(it.id)} onDone={() => setStatus(it.id, 'done')} />
          ))}
        </section>
      </div>
    </div>
  );
}

function RowItem({ it, cls, now, onOpen, onDone, danger, startMode }: {
  it: import('@/lib/types').Item;
  cls?: import('@/lib/types').Klass;
  now: Date;
  onOpen: () => void; onDone: () => void;
  danger?: boolean; startMode?: boolean;
}) {
  const urg = urgencyOf(it, now);
  const hot = inDangerZone(urg);
  const over = urg === 'overdue';
  return (
    <div className={`row ${hot && !danger ? `zone-row${over ? ' overdue-row' : urg === 'critical' ? ' critical-row' : ''}` : ''}`}
      style={{ padding: hot && !danger ? '7px 9px' : '7px 0', borderBottom: '1px solid var(--line)', borderRadius: hot && !danger ? 8 : 0 }}>
      <input type="checkbox" checked={false} onChange={onDone} title="Mark done" />
      <span className="chip" style={{ borderColor: (cls?.color ?? '#8A8A84') + '55' }}>
        <span className="dot" style={{ background: cls?.color ?? '#8A8A84' }} />{cls?.code ?? 'LIFE'}
      </span>
      <span className="mono faint" style={{ fontSize: 9 }}>{TYPE_GLYPH[it.type]}</span>
      <button onClick={onOpen} style={{ background: 'none', border: 'none', color: danger ? '#FF8A9E' : hot ? URGENCY[urg].ink : 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: hot ? 600 : 400, textAlign: 'left', padding: 0, flex: 1 }} className={danger ? 'glitch-hover' : ''}>
        {startMode ? <span className="warn mono" style={{ fontSize: 10 }}>START · </span> : null}{it.title}
      </button>
      {it.due_at && (
        <span className={`mono right-align ${hot && !danger ? `zone-delta${over ? ' over' : urg === 'critical' ? ' critical' : ''}` : ''}`}
          style={{ fontSize: 11, whiteSpace: 'nowrap', color: danger ? '#FF8A9E' : hot ? undefined : 'var(--dim)' }}>
          {danger || hot
            ? `${humanDelta(new Date(it.due_at).getTime() - now.getTime())}${over ? '' : ' left'}`
            : fmtEt(new Date(it.due_at), it.all_day ? 'MMM d' : 'EEE HH:mm')}
        </span>
      )}
    </div>
  );
}
