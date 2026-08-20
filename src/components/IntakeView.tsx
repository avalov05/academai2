'use client';
// ── INTAKE: paste anything → extraction → review → commit ────────────────
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { processExtraction, type RawExtraction, type ReviewPayload } from '@/lib/intake';
import { fmtEt, etEndOfDay } from '@/lib/time';
import { supaAccessToken } from '@/components/auth';
import { IS_DEMO } from '@/lib/store';
import { sfx } from '@/lib/sound';
import type { Item } from '@/lib/types';

interface Img { mime: string; data: string; preview: string; }

export default function IntakeView() {
  const app = useApp();
  const { data, notify } = app;
  const [text, setText] = useState('');
  const [images, setImages] = useState<Img[]>([]);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [modelUsed, setModelUsed] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        const b64 = url.split(',')[1];
        setImages(im => [...im, { mime: f.type, data: b64, preview: url }]);
      };
      reader.readAsDataURL(f);
    }
  }, []);

  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.length) { addFiles(files); e.preventDefault(); }
  };

  const extract = async () => {
    if (!text.trim() && images.length === 0) { notify('Paste something first — text, a syllabus, or screenshots', 'warn'); return; }
    setBusy(true);
    sfx.tick();
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ text, images: images.map(i => ({ mime: i.mime, data: i.data })) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setModelUsed(body.model ?? '');
      const payload = processExtraction(body.extraction as RawExtraction, data);
      setReview(payload);
      sfx.confirm();
      if (payload.cards.length === 0 && payload.newClasses.length === 0) notify('Nothing schedulable found in that content', 'warn');
    } catch (e) {
      notify(`Extraction failed: ${(e as Error).message}`, 'danger');
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!review) return;
    setBusy(true);
    try {
      // 1) create new classes + components
      const codeToId = new Map<string, string>();
      for (const nc of review.newClasses.filter(c => c.include)) {
        if (!data.semester) { notify('Set up your semester first (CLASSES tab)', 'danger'); setBusy(false); return; }
        const k = await app.insertClass({
          semester_id: data.semester.id, code: nc.code, name: nc.name, color: nc.color,
          grading: nc.grading, target_pct: 93, notes: '',
        });
        codeToId.set(nc.code.toUpperCase().replace(/[^A-Z0-9]/g, ''), k.id);
        for (const comp of nc.components) await app.insertComponent({ ...comp, class_id: k.id });
      }
      // 2) source record
      const src = await app.insertSource({
        class_id: review.detectedClassId, kind: images.length ? 'screenshot' : 'text',
        raw_text: text.slice(0, 20000), image_count: images.length,
        summary: `${review.cards.length} items · ${review.newClasses.length} classes · ${modelUsed}`,
      });
      // 3) items
      const inserts: Array<Partial<Item> & { title: string }> = [];
      let updates = 0;
      for (const card of review.cards.filter(c => c.include)) {
        const inc = card.incoming;
        const classId = inc.class_id
          ?? codeToId.get((card.classCode || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
          ?? null;
        if (card.verdict === 'UPDATE' && card.existingId) {
          await app.updateItem(card.existingId, {
            due_at: inc.due_at, all_day: inc.all_day, at_home: inc.at_home,
            ...(inc.weight_pct != null ? { weight_pct: inc.weight_pct } : {}),
            ...(inc.details ? { details: inc.details } : {}),
            source_id: src.id,
          });
          updates++;
        } else if (card.verdict === 'NEW') {
          inserts.push({
            class_id: classId, type: inc.type, title: inc.title, details: inc.details,
            due_at: inc.due_at, all_day: inc.all_day, at_home: inc.at_home,
            bucket: inc.bucket, weight_pct: inc.weight_pct, effort_min: inc.effort_min,
            source_id: src.id,
          });
        }
      }
      if (inserts.length) await app.insertItemsBatch(inserts);
      // 4) holidays
      const hols = review.holidays.filter(h => h.include);
      if (hols.length) await app.insertHolidays(hols);
      sfx.boot();
      notify(`Committed: ${inserts.length} new · ${updates} updated · ${review.newClasses.filter(c => c.include).length} classes`, 'ok');
      setReview(null); setText(''); setImages([]);
      app.setView('RADAR');
    } catch (e) {
      notify(`Commit failed: ${(e as Error).message}`, 'danger');
    } finally { setBusy(false); }
  };

  return (
    <div className="view-enter" style={{ maxWidth: 900, margin: '0 auto' }}>
      {!review && (
        <>
          <div className="micro">UNIVERSAL INTAKE — FEED ME ANYTHING</div>
          <h2 className="display" style={{ fontSize: 30, margin: '6px 0 14px' }}>
            Syllabus · Screenshot · Email · <span className="iridescent-text">Announcement</span>
          </h2>
          <div className="panel corner" style={{ padding: 16 }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <i className="c3" />
            <textarea
              placeholder={'Paste syllabus text, a Moodle announcement, an email from your professor, or screenshots (Ctrl/Cmd+V right here)…\n\nEverything with a date comes out the other side. Nothing commits without your review.'}
              value={text} onChange={e => setText(e.target.value)} onPaste={onPaste}
              style={{ minHeight: 200, fontSize: 12.5 }} />
            {images.length > 0 && (
              <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                {images.map((im, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.preview} alt="pasted" style={{ height: 74, border: '1px solid var(--line)', borderRadius: 8, display: 'block' }} />
                    <button onClick={() => setImages(x => x.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: -6, right: -6, background: 'var(--danger)', color: '#fff', border: 'none', width: 18, height: 18, borderRadius: '50%', fontSize: 9, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => fileRef.current?.click()}>+ SCREENSHOTS</button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden
                onChange={e => e.target.files && addFiles(e.target.files)} />
              <span className="mono faint" style={{ fontSize: 10 }}>{images.length ? `${images.length} image${images.length > 1 ? 's' : ''} attached` : 'or paste images directly'}</span>
              <button className="btn primary right-align" onClick={extract} disabled={busy}>
                {busy ? 'EXTRACTING…' : 'EXTRACT ⟶'}
              </button>
            </div>
          </div>
          <div className="mono faint" style={{ fontSize: 10, marginTop: 10, lineHeight: 1.7 }}>
            PIPELINE: GEMINI VISION EXTRACTION → DEDUPE VS {data.items.filter(i => !i.ghost).length} KNOWN OBJECTS → COVERAGE AUDIT → YOUR REVIEW → COMMIT.
            {IS_DEMO && ' (DEMO MODE: canned extraction, no API call.)'}
          </div>
        </>
      )}

      {review && (
        <ReviewScreen review={review} setReview={setReview} commit={commit} busy={busy} modelUsed={modelUsed} />
      )}
    </div>
  );
}

function ReviewScreen({ review, setReview, commit, busy, modelUsed }: {
  review: ReviewPayload;
  setReview: (r: ReviewPayload | null) => void;
  commit: () => void; busy: boolean; modelUsed: string;
}) {
  const { data } = useApp();
  const counts = useMemo(() => ({
    NEW: review.cards.filter(c => c.verdict === 'NEW').length,
    UPDATE: review.cards.filter(c => c.verdict === 'UPDATE').length,
    KNOWN: review.cards.filter(c => c.verdict === 'KNOWN').length,
  }), [review.cards]);
  const toggle = (key: string) => setReview({
    ...review,
    cards: review.cards.map(c => c.key === key ? { ...c, include: !c.include } : c),
  });
  const setCardDate = (key: string, date: string) => setReview({
    ...review,
    cards: review.cards.map(c => {
      if (c.key !== key) return c;
      const due_at = date ? etEndOfDay(date).toISOString() : null;
      return { ...c, incoming: { ...c.incoming, due_at, all_day: true }, include: !!date, assumption: 'date set manually' };
    }),
  });
  const included = review.cards.filter(c => c.include).length + review.newClasses.filter(c => c.include).length;

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div>
          <div className="micro">REVIEW BEFORE COMMIT — YOU ARE THE FINAL AUTHORITY</div>
          <h2 className="display" style={{ fontSize: 26, margin: '4px 0' }}>
            <span className="ok">{counts.NEW} NEW</span> · <span className="warn">{counts.UPDATE} UPDATES</span> · <span className="faint">{counts.KNOWN} KNOWN</span>
          </h2>
          <div className="mono faint" style={{ fontSize: 10 }}>ENGINE: {modelUsed || 'demo'}</div>
        </div>
        <div className="right-align row">
          <button className="btn" onClick={() => setReview(null)}>← BACK</button>
          <button className="btn primary" onClick={commit} disabled={busy || included === 0}>
            {busy ? 'COMMITTING…' : `COMMIT ${included} ⏎`}
          </button>
        </div>
      </div>

      {review.coverage.length > 0 && (
        <div className="panel corner" style={{ padding: 14, marginTop: 14, borderColor: 'rgba(255,176,59,.4)' }}>
          <i className="c3" />
          <div className="micro warn" style={{ marginBottom: 8 }}>⚠ COVERAGE AUDIT — READ THIS</div>
          {review.coverage.map((n, i) => (
            <div key={i} className="mono" style={{ fontSize: 11.5, padding: '3px 0', color: 'var(--warn)' }}>· {n}</div>
          ))}
        </div>
      )}

      {review.newClasses.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="micro" style={{ marginBottom: 8 }}>NEW CLASSES DETECTED</div>
          {review.newClasses.map((nc, i) => (
            <div key={i} className="panel corner verdict-NEW" style={{ padding: 14, marginBottom: 10 }}>
              <i className="c3" />
              <div className="row">
                <input type="checkbox" checked={nc.include} onChange={() => setReview({
                  ...review, newClasses: review.newClasses.map((x, j) => j === i ? { ...x, include: !x.include } : x),
                })} />
                <span className="chip"><span className="dot" style={{ background: nc.color }} />{nc.code}</span>
                <strong>{nc.name}</strong>
              </div>
              <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>
                {nc.components.map((c, j) => (
                  <div key={j}>· {c.kind} {c.is_async ? 'ASYNC' : `${c.days.map(dd => 'SMTWTFS'[dd]).join('')} ${c.start_time}–${c.end_time}${c.interval === 2 ? ' (biweekly)' : ''}`} {c.location && `@ ${c.location}`}</div>
                ))}
                {nc.grading.length > 0 && <div style={{ marginTop: 4 }}>GRADING: {nc.grading.map(g => `${g.name} ${g.weight_pct}%${g.drops ? ` (drop ${g.drops})` : ''}`).join(' · ')}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {review.holidays.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="micro" style={{ marginBottom: 8 }}>NO-CLASS DAYS DETECTED</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {review.holidays.map((h, i) => (
              <label key={i} className="chip" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={h.include} onChange={() => setReview({
                  ...review, holidays: review.holidays.map((x, j) => j === i ? { ...x, include: !x.include } : x),
                })} style={{ width: 11, height: 11 }} />
                {h.date} {h.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {(['UPDATE', 'NEW', 'KNOWN'] as const).map(v => review.cards.some(c => c.verdict === v) && (
          <div key={v} style={{ marginBottom: 14 }}>
            <div className="micro" style={{ marginBottom: 8 }}>
              {v === 'NEW' ? '◆ NEW OBJECTS' : v === 'UPDATE' ? '◈ UPDATES TO EXISTING' : '◇ ALREADY TRACKED (no action)'}
            </div>
            {review.cards.filter(c => c.verdict === v).map(card => {
              const k = data.classes.find(c2 => c2.id === card.incoming.class_id);
              return (
                <div key={card.key} className={`panel verdict-${v}`} style={{ padding: '10px 14px', marginBottom: 6 }}>
                  <div className="row">
                    <input type="checkbox" checked={card.include} disabled={v === 'KNOWN'} onChange={() => toggle(card.key)} />
                    <span className="chip" style={{ borderColor: (k?.color ?? '#7A7A88') + '55' }}>
                      <span className="dot" style={{ background: k?.color ?? '#7A7A88' }} />{card.classCode || 'LIFE'}
                    </span>
                    <span className="mono faint" style={{ fontSize: 9 }}>{card.incoming.type.toUpperCase()}{!card.incoming.at_home && '·IN-CLASS'}</span>
                    <span style={{ flex: 1 }}>{card.incoming.title}</span>
                    {card.incoming.due_at
                      ? <span className="mono dim" style={{ fontSize: 11 }}>{fmtEt(new Date(card.incoming.due_at), 'EEE MMM d · HH:mm')}</span>
                      : <input type="date" style={{ width: 140 }} onChange={e => setCardDate(card.key, e.target.value)} />}
                    {card.confidence === 'low' && <span className="chip hot">LOW CONF</span>}
                  </div>
                  {card.changes && card.changes.length > 0 && (
                    <div className="mono warn" style={{ fontSize: 10.5, marginTop: 5, paddingLeft: 24 }}>
                      {card.changes.map((ch, i) => <div key={i}>Δ {ch}</div>)}
                    </div>
                  )}
                  {card.assumption && (
                    <div className="mono faint" style={{ fontSize: 10, marginTop: 3, paddingLeft: 24 }}>◦ {card.assumption}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await supaAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
