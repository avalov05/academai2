'use client';
// ── CLASSES: semester setup + class/component manager ─────────────────────
import React, { useMemo, useState } from 'react';
import { useApp } from './AppContext';
import type { ClassComponent, ComponentKind, Klass } from '@/lib/types';
import { COMPONENT_KINDS, KIND_LABEL } from '@/lib/types';
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
      const occ = expandComponent(c, data.semester, data.holidays, todayEt(), addDaysStr(todayEt(), 21))[0];
      if (occ) m.set(c.id, occ.date);
    }
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
            <span className="mono" style={{ fontSize: 11.5 }}>
              {c.is_async ? 'ASYNC — no meetings' :
                `${c.days.map(d => DAY_LETTERS[d]).join('')} ${c.start_time}–${c.end_time}${c.interval === 2 ? ' · BIWEEKLY' : ''}`}
            </span>
            <span className="dim" style={{ fontSize: 11 }}>{c.location}</span>
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
  const [kind, setKind] = useState<ComponentKind>(comp?.kind ?? 'LEC');
  const [days, setDays] = useState<number[]>(comp?.days ?? []);
  const [st, setSt] = useState(comp?.start_time ?? '');
  const [en, setEn] = useState(comp?.end_time ?? '');
  const [loc, setLoc] = useState(comp?.location ?? '');
  const [biweekly, setBiweekly] = useState(comp?.interval === 2);
  const [anchor, setAnchor] = useState(comp?.anchor_date ?? '');
  const [asy, setAsy] = useState(comp?.is_async ?? false);
  const [leave, setLeave] = useState(comp?.leave_by_min ?? 12);
  const [skips, setSkips] = useState((comp?.skip_dates ?? []).join(', '));
  return (
    <div className="panel-solid" style={{ padding: 12, margin: '6px 0' }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select value={kind} onChange={e => setKind(e.target.value as ComponentKind)} style={{ width: 130 }}>
          {COMPONENT_KINDS.map(x => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
        </select>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={asy} onChange={e => setAsy(e.target.checked)} />
          <span className="micro">ASYNC</span>
        </label>
        {!asy && (
          <>
            <span className="row" style={{ gap: 2 }}>
              {DAY_LETTERS.map((l, i) => (
                <button key={i} className="btn sm" style={{
                  padding: '4px 7px',
                  background: days.includes(i) ? 'var(--acc)' : 'transparent',
                  color: days.includes(i) ? '#05070a' : 'var(--dim)',
                }} onClick={() => setDays(d => d.includes(i) ? d.filter(x => x !== i) : [...d, i].sort())}>{l}</button>
              ))}
            </span>
            <input type="time" value={st} onChange={e => setSt(e.target.value)} style={{ width: 110 }} />
            <span className="faint">–</span>
            <input type="time" value={en} onChange={e => setEn(e.target.value)} style={{ width: 110 }} />
          </>
        )}
      </div>
      {!asy && (
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <input type="text" placeholder="Location" value={loc} onChange={e => setLoc(e.target.value)} style={{ width: 170 }} />
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={biweekly} onChange={e => setBiweekly(e.target.checked)} />
            <span className="micro">EVERY OTHER WEEK</span>
          </label>
          {biweekly && (
            <label className="row"><span className="micro">A DATE IN AN &quot;ON&quot; WEEK:</span>
              <input type="date" value={anchor} onChange={e => setAnchor(e.target.value)} style={{ width: 150 }} /></label>
          )}
          <label className="row"><span className="micro">LEAVE-BY LEAD (MIN)</span>
            <input type="number" value={leave} onChange={e => setLeave(Number(e.target.value) || 10)} style={{ width: 70 }} /></label>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <input type="text" placeholder="Cancelled dates (YYYY-MM-DD, comma separated)" value={skips} onChange={e => setSkips(e.target.value)} style={{ flex: 1 }} />
        <button className="btn sm primary" onClick={() => onSave({
          kind, days, start_time: asy ? '' : st, end_time: asy ? '' : en, location: loc,
          interval: biweekly ? 2 : 1, anchor_date: anchor || undefined, is_async: asy, leave_by_min: leave,
          skip_dates: skips.split(',').map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)),
        } as Partial<ClassComponent>)}>SAVE</button>
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
