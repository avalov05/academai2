'use client';
// ── CLASSES: semester setup + class/component manager ─────────────────────
import React, { useMemo, useState } from 'react';
import { useApp } from './AppContext';
import type { ClassComponent, ComponentKind, Klass } from '@/lib/types';
import { COMPONENT_KINDS, KIND_LABEL, describePattern, isDateList } from '@/lib/types';
import { nextColor } from '@/lib/palette';
import { expandComponent } from '@/lib/recurrence';
import { todayEt, addDaysStr, etEndOfDay, fmtEt } from '@/lib/time';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function ClassesView() {
  const app = useApp();
  const { data } = app;
  const [editingComp, setEditingComp] = useState<string | null>(null);
  const [newClassOpen, setNewClassOpen] = useState(false);

  return (
    <div className="view-enter" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <SemesterPanel />
      <div className="row" style={{ margin: '18px 0 10px' }}>
        <span className="micro">REGISTERED CLASSES · {data.classes.length}</span>
        <button className="btn sm right-align" onClick={() => setNewClassOpen(!newClassOpen)}>+ ADD CLASS MANUALLY</button>
        <button className="btn sm primary" onClick={() => app.setView('INTAKE')}>PASTE SYLLABUS INSTEAD ⟶</button>
      </div>
      {newClassOpen && <NewClassForm onDone={() => setNewClassOpen(false)} />}
      {data.classes.map(k => (
        <ClassCard key={k.id} k={k} editingComp={editingComp} setEditingComp={setEditingComp} />
      ))}
      {data.classes.length === 0 && (
        <div className="panel corner" style={{ padding: 30, textAlign: 'center' }}>
          <i className="c3" />
          <div className="empty-note" style={{ justifyContent: 'center' }}>No classes yet. Fastest path: paste each syllabus into INTAKE — everything builds itself.</div>
        </div>
      )}
      <HolidaysPanel />
    </div>
  );
}

function SemesterPanel() {
  const { data, upsertSemester } = useApp();
  const s = data.semester;
  const [name, setName] = useState(s?.name ?? 'Fall 2026');
  const [start, setStart] = useState(s?.start_date ?? todayEt());
  const [end, setEnd] = useState(s?.end_date ?? addDaysStr(todayEt(), 112));
  return (
    <div className="panel corner" style={{ padding: 16 }}>
      <i className="c3" />
      <div className="micro" style={{ marginBottom: 10 }}>SEMESTER WINDOW — EVERYTHING RECURS INSIDE THIS</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="field" style={{ margin: 0, width: 180 }}><span className="micro">NAME</span>
          <input type="text" value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="field" style={{ margin: 0 }}><span className="micro">FIRST DAY</span>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="field" style={{ margin: 0 }}><span className="micro">LAST DAY</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
        <button className="btn" style={{ alignSelf: 'flex-end' }}
          onClick={() => upsertSemester({ id: s?.id, name, start_date: start, end_date: end })}>
          {s ? 'UPDATE' : 'CREATE'}
        </button>
      </div>
    </div>
  );
}

function NewClassForm({ onDone }: { onDone: () => void }) {
  const app = useApp();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <div className="panel corner" style={{ padding: 14, marginBottom: 12 }}>
      <i className="c3" />
      <div className="row">
        <input type="text" placeholder="CODE (CH 221)" value={code} onChange={e => setCode(e.target.value)} style={{ width: 140 }} />
        <input type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
        <button className="btn primary sm" disabled={!code.trim()} onClick={async () => {
          if (!app.data.semester) { app.notify('Set the semester window first', 'danger'); return; }
          await app.insertClass({
            semester_id: app.data.semester.id, code: code.trim(), name: name.trim() || code.trim(),
            color: nextColor(app.data.classes.map(c => c.color)), grading: [], target_pct: 93, notes: '',
          });
          onDone();
        }}>CREATE</button>
      </div>
    </div>
  );
}

function ClassCard({ k, editingComp, setEditingComp }: {
  k: Klass; editingComp: string | null; setEditingComp: (id: string | null) => void;
}) {
  const app = useApp();
  const { data } = app;
  const comps = data.components.filter(c => c.class_id === k.id);
  const itemCount = data.items.filter(i => i.class_id === k.id && i.status === 'pending' && !i.ghost).length;
  const nextOccs = useMemo(() => {
    if (!data.semester) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const c of comps) {
      const occ = expandComponent(c, data.semester, data.holidays, todayEt(), addDaysStr(todayEt(), 28))[0];
      if (occ) m.set(c.id, occ.date);
    }
    return m;
  }, [comps, data.semester, data.holidays]);
  const totals = useMemo(() => {
    if (!data.semester) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const c of comps) m.set(c.id, expandComponent(c, data.semester, data.holidays).length);
    return m;
  }, [comps, data.semester, data.holidays]);

  return (
    <div className="panel corner" style={{ padding: 16, marginBottom: 12, borderLeft: `3px solid ${k.color}` }}>
      <i className="c3" />
      <div className="row">
        <input type="color" value={k.color} onChange={e => app.updateClass(k.id, { color: e.target.value })} title="Class color" />
        <div>
          <div className="row">
            <strong style={{ fontSize: 16 }}>{k.code}</strong>
            <span className="dim">{k.name}</span>
          </div>
          <div className="mono faint" style={{ fontSize: 10 }}>{itemCount} ACTIVE OBJECTS · {comps.length} COMPONENTS · TARGET {k.target_pct}%</div>
        </div>
        <div className="right-align row">
          <button className="btn sm" onClick={() => setEditingComp(editingComp === k.id ? null : 'new:' + k.id)}>+ COMPONENT</button>
          <button className="btn sm danger" onClick={() => { if (confirm(`Delete ${k.code} and all its items?`)) app.deleteClass(k.id); }}>✕</button>
        </div>
      </div>

      {comps.map(c => (
        <div key={c.id}>
          <div className="row" style={{ padding: '7px 0', borderTop: '1px solid var(--line)', marginTop: 8 }}>
            <span className="chip"><span className="dot" style={{ background: k.color }} />{c.kind}</span>
            <span style={{ fontSize: 12 }}>{describePattern(c)}</span>
            <span className="dim" style={{ fontSize: 11 }}>{c.location}</span>
            {!c.is_async && (
              <span className="chip" style={{ fontSize: 9.5, padding: '3px 8px' }}>{totals.get(c.id) ?? 0} meetings</span>
            )}
            {!c.is_async && nextOccs.get(c.id) && <span className="mono faint" style={{ fontSize: 10 }}>NEXT {fmtEt(etEndOfDay(nextOccs.get(c.id)!), 'EEE MMM d')}</span>}
            <span className="right-align row">
              <button className="btn sm" onClick={() => setEditingComp(editingComp === c.id ? null : c.id)}>{editingComp === c.id ? 'CLOSE' : 'EDIT'}</button>
              <button className="btn sm danger" onClick={() => app.deleteComponent(c.id)}>✕</button>
            </span>
          </div>
          {editingComp === c.id && <ComponentEditor comp={c} onSave={p => { app.updateComponent(c.id, p); setEditingComp(null); }} />}
        </div>
      ))}
      {editingComp === 'new:' + k.id && (
        <ComponentEditor onSave={async p => {
          await app.insertComponent({
            class_id: k.id, kind: 'LEC', title: '', location: '', is_async: false, days: [],
            start_time: '', end_time: '', interval: 1, anchor_date: data.semester?.start_date ?? todayEt(),
            start_date: '', end_date: '', skip_dates: [], extra_dates: [], leave_by_min: 12, ...p,
          });
          setEditingComp(null);
        }} />
      )}
      <GradingEditor k={k} />
    </div>
  );
}

function ComponentEditor({ comp, onSave }: { comp?: ClassComponent; onSave: (p: Partial<ClassComponent>) => void }) {
  const { data, notify } = useApp();
  const [kind, setKind] = useState<ComponentKind>(comp?.kind ?? 'LEC');
  const [days, setDays] = useState<number[]>(comp?.days ?? []);
  const [st, setSt] = useState(comp?.start_time ?? '');
  const [en, setEn] = useState(comp?.end_time ?? '');
  const [loc, setLoc] = useState(comp?.location ?? '');
  const [asy, setAsy] = useState(comp?.is_async ?? false);
  const [leave, setLeave] = useState(comp?.leave_by_min ?? 12);
  const [interval, setInterval] = useState(comp ? Math.max(1, comp.interval || 1) : 1);
  const [anchor, setAnchor] = useState(comp?.anchor_date ?? '');
  const [winStart, setWinStart] = useState(comp?.start_date ?? '');
  const [winEnd, setWinEnd] = useState(comp?.end_date ?? '');
  const [skips, setSkips] = useState((comp?.skip_dates ?? []).join(', '));
  const [listMode, setListMode] = useState(comp ? isDateList(comp) : false);
  const [dateList, setDateList] = useState((comp?.extra_dates ?? []).join(', '));

  const parseDates = (v: string) => v.split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();

  const draft = useMemo<ClassComponent>(() => ({
    id: comp?.id ?? 'preview', class_id: comp?.class_id ?? 'preview',
    kind, title: comp?.title ?? '', location: loc, is_async: asy,
    days: listMode ? [] : days,
    start_time: asy ? '' : st, end_time: asy ? '' : en,
    interval: listMode ? 1 : interval,
    anchor_date: anchor || parseDates(dateList)[0] || data.semester?.start_date || todayEt(),
    start_date: winStart, end_date: winEnd,
    skip_dates: parseDates(skips),
    extra_dates: listMode ? parseDates(dateList) : (comp?.extra_dates ?? []),
    leave_by_min: leave,
  }), [comp, kind, loc, asy, days, st, en, interval, anchor, winStart, winEnd, skips, listMode, dateList, leave, data.semester]);

  const preview = useMemo(() => {
    if (!data.semester || asy || !st || !en) return [];
    return expandComponent(draft, data.semester, data.holidays).map(o => o.date);
  }, [draft, data.semester, data.holidays, asy, st, en]);

  const PATTERNS: Array<[number, string]> = [[1, 'Every week'], [2, 'Every other week'], [3, 'Every 3rd week'], [4, 'Every 4th week']];

  return (
    <div className="panel-solid" style={{ padding: 13, margin: '6px 0' }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select value={kind} onChange={e => setKind(e.target.value as ComponentKind)} style={{ width: 130 }}>
          {COMPONENT_KINDS.map(x => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
        </select>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={asy} onChange={e => setAsy(e.target.checked)} />
          <span className="micro">ASYNC — NEVER MEETS</span>
        </label>
        {!asy && (
          <>
            <input type="time" value={st} onChange={e => setSt(e.target.value)} style={{ width: 132 }} />
            <span className="faint">–</span>
            <input type="time" value={en} onChange={e => setEn(e.target.value)} style={{ width: 132 }} />
            <input type="text" placeholder="Location" value={loc} onChange={e => setLoc(e.target.value)} style={{ width: 160 }} />
          </>
        )}
      </div>

      {!asy && (
        <>
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            <span className="micro">WHEN</span>
            <button className={`btn sm ${!listMode ? 'primary' : ''}`} onClick={() => setListMode(false)}>A repeating pattern</button>
            <button className={`btn sm ${listMode ? 'primary' : ''}`} onClick={() => setListMode(true)}>Only specific dates</button>
          </div>

          {!listMode ? (
            <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <span className="row" style={{ gap: 2 }}>
                {DAY_LETTERS.map((l, i) => (
                  <button key={i} className="btn sm" style={{
                    padding: '4px 9px', minWidth: 30,
                    background: days.includes(i) ? 'var(--charcoal, #1C1C1C)' : 'transparent',
                    color: days.includes(i) ? '#fff' : 'var(--dim)',
                    borderColor: days.includes(i) ? 'var(--charcoal, #1C1C1C)' : 'var(--line)',
                  }} onClick={() => setDays(d => d.includes(i) ? d.filter(x => x !== i) : [...d, i].sort())}>{l}</button>
                ))}
              </span>
              <select value={interval} onChange={e => setInterval(Number(e.target.value))} style={{ width: 170 }}>
                {PATTERNS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}
              </select>
              {interval > 1 && (
                <label className="row"><span className="micro">FIRST MEETING</span>
                  <input type="date" value={anchor} onChange={e => setAnchor(e.target.value)} style={{ width: 150 }} /></label>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <input type="text" placeholder="2026-09-03, 2026-09-17, 2026-10-01 …" value={dateList}
                onChange={e => setDateList(e.target.value)} style={{ width: '100%' }} />
              <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
                Paste the dates straight from the lab schedule. These are the only meetings — nothing is filled in around them.
              </div>
            </div>
          )}

          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <label className="row"><span className="micro">STARTS</span>
              <input type="date" value={winStart} onChange={e => setWinStart(e.target.value)} style={{ width: 148 }} /></label>
            <label className="row"><span className="micro">ENDS</span>
              <input type="date" value={winEnd} onChange={e => setWinEnd(e.target.value)} style={{ width: 148 }} /></label>
            <label className="row"><span className="micro">LEAVE-BY LEAD (MIN)</span>
              <input type="number" value={leave} onChange={e => setLeave(Number(e.target.value) || 10)} style={{ width: 70 }} /></label>
          </div>

          <input type="text" placeholder="Cancelled dates (YYYY-MM-DD, comma separated)" value={skips}
            onChange={e => setSkips(e.target.value)} style={{ width: '100%', marginTop: 8 }} />

          <div style={{
            marginTop: 10, padding: '9px 11px', borderRadius: 10,
            border: '1px solid var(--line)', background: 'var(--card-subtle)',
          }}>
            <div className="row">
              <span className="micro">THIS IS WHAT WILL BE ON YOUR CALENDAR</span>
              <span className="right-align chip" style={{ fontSize: 9.5, padding: '3px 9px' }}>{preview.length} meetings</span>
            </div>
            <div className="mono faint" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7 }}>
              {preview.length
                ? preview.slice(0, 18).map(d => d.slice(5).replace('-', '/')).join('  ') + (preview.length > 18 ? `  …+${preview.length - 18}` : '')
                : (!st || !en ? 'Set a start and end time to see the meetings.' : 'No meetings — check the days, the pattern, and the date window.')}
            </div>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm primary right-align" onClick={() => {
          if (!asy && (!st || !en)) { notify('A meeting needs a start and end time', 'warn'); return; }
          if (!asy && !listMode && days.length === 0) { notify('Pick at least one weekday, or switch to specific dates', 'warn'); return; }
          if (!asy && listMode && parseDates(dateList).length === 0) { notify('Add at least one date in YYYY-MM-DD form', 'warn'); return; }
          onSave({
            kind, days: draft.days, start_time: draft.start_time, end_time: draft.end_time, location: loc,
            interval: draft.interval, anchor_date: draft.anchor_date, is_async: asy, leave_by_min: leave,
            start_date: winStart, end_date: winEnd,
            skip_dates: draft.skip_dates, extra_dates: draft.extra_dates,
          });
        }}>SAVE</button>
      </div>
    </div>
  );
}

function GradingEditor({ k }: { k: Klass }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const total = k.grading.reduce((a, b) => a + b.weight_pct, 0);
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      <div className="row">
        <span className="micro">GRADING SCHEME · {k.grading.length} BUCKETS · Σ {total}%</span>
        {total !== 100 && k.grading.length > 0 && <span className="chip warn">Σ ≠ 100%</span>}
        <button className="btn sm right-align" onClick={() => setOpen(!open)}>{open ? 'CLOSE' : 'EDIT'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          {k.grading.map((b, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input type="text" value={b.name} style={{ flex: 1 }}
                onChange={e => app.updateClass(k.id, { grading: k.grading.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
              <input type="number" value={b.weight_pct} style={{ width: 80 }}
                onChange={e => app.updateClass(k.id, { grading: k.grading.map((x, j) => j === i ? { ...x, weight_pct: Number(e.target.value) || 0 } : x) })} />
              <span className="micro">% · DROP</span>
              <input type="number" value={b.drops ?? 0} style={{ width: 60 }}
                onChange={e => app.updateClass(k.id, { grading: k.grading.map((x, j) => j === i ? { ...x, drops: Number(e.target.value) || 0 } : x) })} />
              <button className="btn sm danger" onClick={() => app.updateClass(k.id, { grading: k.grading.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="row">
            <button className="btn sm" onClick={() => app.updateClass(k.id, { grading: [...k.grading, { name: 'New bucket', weight_pct: 0, drops: 0 }] })}>+ BUCKET</button>
            <label className="row right-align"><span className="micro">TARGET %</span>
              <input type="number" value={k.target_pct} style={{ width: 70 }}
                onChange={e => app.updateClass(k.id, { target_pct: Number(e.target.value) || 93 })} /></label>
          </div>
        </div>
      )}
    </div>
  );
}

function HolidaysPanel() {
  const app = useApp();
  const { data } = app;
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  return (
    <div className="panel corner" style={{ padding: 16, marginTop: 16 }}>
      <i className="c3" />
      <div className="micro" style={{ marginBottom: 8 }}>NO-CLASS DAYS (BREAKS, HOLIDAYS) — AUTO-CANCELS ALL MEETINGS</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {data.holidays.sort((a, b) => a.date.localeCompare(b.date)).map(h => (
          <span key={h.id} className="chip">{h.date} {h.name}
            <button onClick={() => app.deleteHoliday(h.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 10, padding: 0 }}>✕</button>
          </span>
        ))}
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 150 }} />
        <input type="text" placeholder="Name" value={name} onChange={e => setName(e.target.value)} style={{ width: 140 }} />
        <button className="btn sm" disabled={!date} onClick={() => { app.insertHolidays([{ date, name: name || 'No class' }]); setDate(''); setName(''); }}>+ ADD</button>
        <span className="mono faint" style={{ fontSize: 10 }}>TIP: paste the academic calendar into INTAKE — these auto-extract.</span>
      </div>
    </div>
  );
}
