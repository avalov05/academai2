'use client';
// ── Slide-over item editor ────────────────────────────────────────────────
import React, { useMemo } from 'react';
import { useApp } from './AppContext';
import { ITEM_TYPES } from '@/lib/types';
import { fmtEt, etToUtc, utcToEtDate } from '@/lib/time';

export default function DetailPanel() {
  const { data, detailId, openDetail, updateItem, deleteItem, setStatus, acceptGhost, now } = useApp();
  const it = useMemo(() => data.items.find(i => i.id === detailId), [data.items, detailId]);
  if (!it) return null;
  const k = data.classes.find(c => c.id === it.class_id);
  const children = data.items.filter(i => i.parent_id === it.id && i.status !== 'dropped');
  const dueDate = it.due_at ? utcToEtDate(new Date(it.due_at)) : '';
  const dueTime = it.due_at && !it.all_day ? fmtEt(new Date(it.due_at), 'HH:mm') : '';

  const setDue = (date: string, time: string) => {
    if (!date) { updateItem(it.id, { due_at: null }); return; }
    if (time) updateItem(it.id, { due_at: etToUtc(date, time).toISOString(), all_day: false });
    else updateItem(it.id, { due_at: etToUtc(date, '23:59').toISOString(), all_day: true });
  };

  return (
    <>
      <div className="overlay-dim" onClick={() => openDetail(null)} />
      <aside className="slideover">
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="chip" style={{ borderColor: (k?.color ?? '#6E6250') + '66' }}>
            <span className="dot" style={{ background: k?.color ?? '#6E6250' }} />{k?.code ?? 'LIFE'}
          </span>
          {it.ghost && <span className="chip ghost warn">PROPOSED — NOT COMMITTED</span>}
          <button className="btn sm right-align" onClick={() => openDetail(null)}>ESC ✕</button>
        </div>

        <input type="text" value={it.title} onChange={e => updateItem(it.id, { title: e.target.value })}
          style={{ fontSize: 16, fontFamily: 'var(--font-d)', fontWeight: 700, marginBottom: 14 }} />

        {it.ghost && (
          <button className="btn primary" style={{ width: '100%', marginBottom: 14 }} onClick={() => acceptGhost(it.id)}>
            ACCEPT PROPOSAL — COMMIT TO RADAR
          </button>
        )}

        <div className="grid2">
          <label className="field"><span className="micro">TYPE</span>
            <select value={it.type} onChange={e => updateItem(it.id, { type: e.target.value as typeof it.type })}>
              {ITEM_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </select>
          </label>
          <label className="field"><span className="micro">CLASS</span>
            <select value={it.class_id ?? ''} onChange={e => updateItem(it.id, { class_id: e.target.value || null })}>
              <option value="">LIFE (no class)</option>
              {data.classes.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </label>
          <label className="field"><span className="micro">DUE DATE (ET)</span>
            <input type="date" value={dueDate} onChange={e => setDue(e.target.value, dueTime)} />
          </label>
          <label className="field"><span className="micro">DUE TIME — BLANK = END OF DAY</span>
            <input type="time" value={dueTime} onChange={e => setDue(dueDate || utcToEtDate(now), e.target.value)} />
          </label>
          <label className="field"><span className="micro">EFFORT (MIN)</span>
            <input type="number" value={it.effort_min || ''} placeholder="est. minutes"
              onChange={e => updateItem(it.id, { effort_min: Number(e.target.value) || 0 })} />
          </label>
          <label className="field"><span className="micro">GRADE WEIGHT % (IF KNOWN)</span>
            <input type="number" value={it.weight_pct ?? ''} placeholder="—"
              onChange={e => updateItem(it.id, { weight_pct: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
        </div>

        {k && (
          <label className="field"><span className="micro">GRADING BUCKET</span>
            <select value={it.bucket ?? ''} onChange={e => updateItem(it.id, { bucket: e.target.value || null })}>
              <option value="">—</option>
              {k.grading.map(b => <option key={b.name} value={b.name}>{b.name} ({b.weight_pct}%)</option>)}
            </select>
          </label>
        )}

        <label className="row" style={{ margin: '4px 0 12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={!it.at_home} onChange={e => updateItem(it.id, { at_home: !e.target.checked })} />
          <span className="micro">HAPPENS IN CLASS (in-class quiz/exam)</span>
        </label>

        <label className="field"><span className="micro">DETAILS / TOPICS</span>
          <textarea value={it.details} onChange={e => updateItem(it.id, { details: e.target.value })} />
        </label>

        {children.length > 0 && (
          <div style={{ margin: '12px 0' }}>
            <div className="micro" style={{ marginBottom: 6 }}>LINKED STUDY BLOCKS</div>
            {children.map(c => (
              <div key={c.id} className="row" style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                <span className={c.ghost ? 'faint' : 'dim'} style={{ fontSize: 12 }}>{c.ghost ? '◇' : '◆'} {c.title}</span>
                <span className="mono dim right-align" style={{ fontSize: 10 }}>{c.due_at ? fmtEt(new Date(c.due_at), 'MMM d') : ''}</span>
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 18, flexWrap: 'wrap' }}>
          {it.status !== 'done' && <button className="btn primary" onClick={() => { setStatus(it.id, 'done'); openDetail(null); }}>MARK DONE ✓</button>}
          {it.status === 'done' && <button className="btn" onClick={() => setStatus(it.id, 'pending')}>REOPEN</button>}
          {it.status !== 'missed' && it.status !== 'done' && <button className="btn danger" onClick={() => setStatus(it.id, 'missed')}>MARK MISSED</button>}
          <button className="btn danger right-align" onClick={() => { deleteItem(it.id); openDetail(null); }}>DELETE</button>
        </div>
        <div className="mono faint" style={{ fontSize: 9, marginTop: 16 }}>
          CREATED {fmtEt(new Date(it.created_at), 'MMM d HH:mm')} · UPDATED {fmtEt(new Date(it.updated_at), 'MMM d HH:mm')}
        </div>
      </aside>
    </>
  );
}
