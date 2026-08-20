'use client';
// ── MANIFEST: dense Swiss table, keyboard-first ───────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from './AppContext';
import type { Item, ItemType } from '@/lib/types';
import { ITEM_TYPES, itemImpact } from '@/lib/types';
import { fmtEt, humanDelta } from '@/lib/time';
import { TYPE_GLYPH } from '@/lib/palette';
import { isOverdue } from '@/lib/planner';

type SortKey = 'due' | 'class' | 'type' | 'impact' | 'title';

export default function TableView() {
  const { data, now, openDetail, setStatus, acceptGhost } = useApp();
  const [q, setQ] = useState('');
  const [fClass, setFClass] = useState('');
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState<'active' | 'done' | 'all' | 'ghost'>('active');
  const [sort, setSort] = useState<SortKey>('due');
  const [asc, setAsc] = useState(true);
  const [sel, setSel] = useState(0);

  const classById = useMemo(() => new Map(data.classes.map(c => [c.id, c])), [data.classes]);

  const rows = useMemo(() => {
    let r = data.items.filter(i => i.status !== 'dropped');
    if (fStatus === 'active') r = r.filter(i => i.status === 'pending' && !i.ghost);
    if (fStatus === 'done') r = r.filter(i => i.status === 'done' || i.status === 'missed');
    if (fStatus === 'ghost') r = r.filter(i => i.ghost);
    if (fClass) r = r.filter(i => (i.class_id ?? 'LIFE') === fClass);
    if (fType) r = r.filter(i => i.type === fType);
    if (q) {
      const qq = q.toLowerCase();
      r = r.filter(i => i.title.toLowerCase().includes(qq) || i.details.toLowerCase().includes(qq));
    }
    const dir = asc ? 1 : -1;
    r.sort((a, b) => {
      switch (sort) {
        case 'due': return dir * ((a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
        case 'class': return dir * ((classById.get(a.class_id ?? '')?.code ?? 'zz').localeCompare(classById.get(b.class_id ?? '')?.code ?? 'zz'));
        case 'type': return dir * a.type.localeCompare(b.type);
        case 'impact': return dir * (itemImpact(b) - itemImpact(a));
        case 'title': return dir * a.title.localeCompare(b.title);
      }
    });
    return r;
  }, [data.items, fClass, fType, fStatus, q, sort, asc, classById]);

  useEffect(() => { setSel(s => Math.min(s, Math.max(0, rows.length - 1))); }, [rows.length]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'j' || e.key === 'ArrowDown') { setSel(s => Math.min(s + 1, rows.length - 1)); e.preventDefault(); }
      if (e.key === 'k' || e.key === 'ArrowUp') { setSel(s => Math.max(s - 1, 0)); e.preventDefault(); }
      if (e.key === 'x' && rows[sel]) { setStatus(rows[sel].id, rows[sel].status === 'done' ? 'pending' : 'done'); }
      if (e.key === 'Enter' && rows[sel]) openDetail(rows[sel].id);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [rows, sel, setStatus, openDetail]);

  const th = (key: SortKey, label: string) => (
    <th onClick={() => { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(true); } }}>
      {label}{sort === key ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="view-enter">
      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="micro-b micro">MANIFEST · {rows.length} OBJECTS</div>
        <input placeholder="SEARCH…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 190 }} />
        <select value={fClass} onChange={e => setFClass(e.target.value)} style={{ width: 130 }}>
          <option value="">ALL CLASSES</option>
          {data.classes.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
          <option value="LIFE">LIFE</option>
        </select>
        <select value={fType} onChange={e => setFType(e.target.value)} style={{ width: 120 }}>
          <option value="">ALL TYPES</option>
          {ITEM_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value as typeof fStatus)} style={{ width: 110 }}>
          <option value="active">ACTIVE</option>
          <option value="ghost">PROPOSED</option>
          <option value="done">RESOLVED</option>
          <option value="all">ALL</option>
        </select>
        <span className="right-align mono faint" style={{ fontSize: 10 }}>J/K NAV · X DONE · ⏎ OPEN</span>
      </div>
      <div className="panel corner" style={{ overflow: 'auto' }}>
        <i className="c3" />
        <table className="swiss">
          <thead>
            <tr>
              <th style={{ width: 30 }}>✓</th>
              {th('class', 'CLASS')}
              {th('type', 'TYPE')}
              {th('title', 'OBJECT')}
              {th('due', 'DUE (ET)')}
              <th>T-MINUS</th>
              {th('impact', 'IMPACT')}
              <th>EST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => {
              const k = classById.get(it.class_id ?? '');
              const over = isOverdue(it, now);
              const done = it.status === 'done' || it.status === 'missed';
              return (
                <tr key={it.id} className={`row ${done ? 'done' : ''} ${i === sel ? 'sel' : ''}`}
                  onClick={() => { setSel(i); openDetail(it.id); }}>
                  <td onClick={e => e.stopPropagation()}>
                    {it.ghost
                      ? <button className="btn sm ghosty" onClick={() => acceptGhost(it.id)} title="Accept proposal">＋</button>
                      : <input type="checkbox" checked={it.status === 'done'} onChange={() => setStatus(it.id, it.status === 'done' ? 'pending' : 'done')} />}
                  </td>
                  <td><span className="chip" style={{ borderColor: (k?.color ?? '#7A7A88') + '55' }}><span className="dot" style={{ background: k?.color ?? '#7A7A88' }} />{k?.code ?? 'LIFE'}</span></td>
                  <td className="mono dim" style={{ fontSize: 10 }}>{TYPE_GLYPH[it.type]}{it.at_home === false ? '·IC' : ''}</td>
                  <td style={{ maxWidth: 340 }}>
                    <span className={over ? 'danger glitch' : ''}>{it.ghost ? <span className="faint">◇ </span> : null}{it.title}</span>
                    {it.status === 'missed' && <span className="chip hot" style={{ marginLeft: 8 }}>MISSED</span>}
                  </td>
                  <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {it.due_at ? fmtEt(new Date(it.due_at), it.all_day ? 'EEE MMM d' : 'EEE MMM d · HH:mm') : <span className="warn">UNDATED</span>}
                  </td>
                  <td className={`mono ${over ? 'danger' : 'dim'}`} style={{ fontSize: 11 }}>
                    {it.due_at && it.status === 'pending' ? humanDelta(new Date(it.due_at).getTime() - now.getTime()) : '—'}
                  </td>
                  <td style={{ width: 80 }}>
                    <div className="bar" style={{ width: 64 }}>
                      <i style={{ width: `${itemImpact(it) * 100}%`, background: over ? 'var(--danger)' : (k?.color ?? '#7A7A88') }} />
                    </div>
                  </td>
                  <td className="mono dim" style={{ fontSize: 11 }}>{it.effort_min ? `${it.effort_min}m` : '—'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="dim mono" style={{ textAlign: 'center', padding: 30, fontSize: 12 }}>NO OBJECTS IN THIS FILTER</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
