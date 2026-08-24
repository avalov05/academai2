'use client';
// ── INTAKE: paste anything → extraction → review → commit ────────────────
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { processExtraction, type CorrectionCard, type RawExtraction, type ReviewCard, type ReviewPayload } from '@/lib/intake';
import { fmtEt, etEndOfDay } from '@/lib/time';
import { supaAccessToken } from '@/components/auth';
import { IS_DEMO } from '@/lib/store';
import { sfx } from '@/lib/sound';
import { readDocument, buildDocText, ACCEPT, type DocResult } from '@/lib/docs';
import type { Attempt } from '@/lib/gemini';
import type { ClassComponent, Item } from '@/lib/types';
import { describePattern, isDateList } from '@/lib/types';
import { expandComponent } from '@/lib/recurrence';

interface Attachment extends DocResult { preview?: string; }

interface ExtractFailure {
  error: string;
  hint?: string;
  kind?: string;
  attempts: Attempt[];
}

export default function IntakeView() {
  const app = useApp();
  const { data, notify } = app;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [verify, setVerify] = useState(true);
  const [failure, setFailure] = useState<ExtractFailure | null>(null);
  const [reading, setReading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [modelUsed, setModelUsed] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (incoming: FileList | File[]) => {
    const list = [...incoming];
    if (!list.length) return;
    setReading(n => n + list.length);
    for (const f of list) {
      try {
        const res = await readDocument(f);
        const att: Attachment = res;
        if (res.image) att.preview = `data:${res.image.mime};base64,${res.image.data}`;
        setFiles(x => [...x, att]);
      } finally {
        setReading(n => Math.max(0, n - 1));
      }
    }
  }, []);

  const onPaste = (e: React.ClipboardEvent) => {
    const dropped = [...e.clipboardData.files];
    if (dropped.length) { addFiles(dropped); e.preventDefault(); }
  };

  const extract = async () => {
    const usable = files.filter(f => !f.failed);
    if (!text.trim() && usable.length === 0) {
      notify('Paste something first — text, a syllabus PDF, a Word doc, or screenshots', 'warn'); return;
    }
    const { text: docText, truncated } = buildDocText(usable);
    if (truncated.length) notify(`Very long document — ${truncated.join(', ')} was read up to the size limit`, 'warn');
    setBusy(true);
    setFailure(null);
    sfx.tick();
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          text: [text, docText].filter(Boolean).join('\n\n'),
          images: usable.filter(f => f.image).map(f => f.image!),
          pdfs: usable.filter(f => f.pdf).map(f => f.pdf!),
          verify,
          // demo builds only: lets the suite act out each failure mode
          ...(IS_DEMO ? { simulate: (window as unknown as { __simulate?: string }).__simulate } : {}),
        }),
      });
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setFailure({
          error: String(body.error ?? `The server returned HTTP ${res.status}`),
          hint: typeof body.hint === 'string' ? body.hint : undefined,
          kind: typeof body.kind === 'string' ? body.kind : undefined,
          attempts: Array.isArray(body.attempts) ? body.attempts as Attempt[] : [],
        });
        sfx.crash();
        return;
      }
      setFailure(null);
      setModelUsed(`${body.model ?? ''}${body.passes === 2 ? ' · 2 passes' : body.auditFailed ? ' · 1 pass (re-read failed)' : ''}`);
      const payload = processExtraction(body.extraction as RawExtraction, data);
      setReview(payload);
      sfx.confirm();
      if (payload.cards.length === 0 && payload.newClasses.length === 0) notify('Nothing schedulable found in that content', 'warn');
    } catch (e) {
      setFailure({
        error: (e as Error).message,
        hint: 'The request never reached the server. Check your connection and try again.',
        attempts: [],
      });
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
        class_id: review.detectedClassId,
        kind: files.some(f => f.pdf || (f.text && !f.image)) ? 'syllabus' : files.length ? 'screenshot' : 'text',
        raw_text: text.slice(0, 20000), image_count: files.length,
        summary: `${review.cards.length} items · ${review.newClasses.length} classes · ${modelUsed}`,
      });
      // 3) items
      const inserts: Array<Partial<Item> & { title: string }> = [];
      let updates = 0, moved = 0, fixed = 0;
      // a row in the main list and its entry in the corrections panel are the
      // same fix seen twice — apply it once
      const movedIds = new Set<string>();
      for (const card of review.cards.filter(c => c.include)) {
        const inc = card.incoming;
        const classId = inc.class_id
          ?? codeToId.get((card.classCode || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
          ?? null;
        if (card.verdict === 'MOVE' && card.existingId) {
          // the same real thing, already tracked under another course — move it
          // rather than adding a second copy under this one
          await app.updateItem(card.existingId, {
            class_id: classId,
            due_at: inc.due_at, all_day: inc.all_day, at_home: inc.at_home,
            ...(inc.bucket ? { bucket: inc.bucket } : {}),
            ...(inc.weight_pct != null ? { weight_pct: inc.weight_pct } : {}),
            ...(inc.details ? { details: inc.details } : {}),
            source_id: src.id,
          });
          moved++;
          movedIds.add(card.existingId);
        } else if (card.verdict === 'UPDATE' && card.existingId) {
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

      // 3b) corrections to things that were already tracked
      for (const c of review.corrections.filter(x => x.include)) {
        if (c.kind === 'REASSIGN') {
          if (movedIds.has(c.item.id)) continue;   // its row already moved it
          await app.updateItem(c.item.id, { class_id: c.toClassId ?? null, source_id: src.id });
          fixed++;
        } else if (c.kind === 'DUPLICATE') {
          await app.setStatus(c.item.id, 'dropped');
          fixed++;
        }
        // ORPHAN is informational — ticking it changes nothing destructive
      }

      // 4) holidays
      const hols = review.holidays.filter(h => h.include);
      if (hols.length) await app.insertHolidays(hols);
      sfx.boot();
      notify(
        `Committed: ${inserts.length} new · ${updates} updated`
        + (moved ? ` · ${moved} moved to the right course` : '')
        + (fixed ? ` · ${fixed} corrected` : '')
        + ` · ${review.newClasses.filter(c => c.include).length} classes`,
        'ok');
      setReview(null); setText(''); setFiles([]);
      app.setView('RADAR');
    } catch (e) {
      notify(`Commit failed: ${(e as Error).message}`, 'danger');
    } finally { setBusy(false); }
  };

  return (
    <div className="view-enter" style={{ maxWidth: 900, margin: '0 auto' }}>
      {!review && (
        <>
          {failure && <FailurePanel f={failure} onDismiss={() => setFailure(null)} onSettings={() => app.setView('SETTINGS')} />}
          <div className="micro">UNIVERSAL INTAKE — FEED ME ANYTHING</div>
          <h2 className="display" style={{ fontSize: 30, margin: '6px 0 14px' }}>
            Syllabus PDF · Screenshot · Email · <span className="iridescent-text">Announcement</span>
          </h2>
          <div className="panel corner" style={{ padding: 16 }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <i className="c3" />
            <textarea
              placeholder={'Paste syllabus text, a Moodle announcement, or an email from your professor. Screenshots and files work too — Ctrl/Cmd+V them right here, or drag a PDF or Word doc onto this box.\n\nEverything with a date comes out the other side. Nothing commits without your review.'}
              value={text} onChange={e => setText(e.target.value)} onPaste={onPaste}
              style={{ minHeight: 200, fontSize: 12.5 }} />
            {(files.length > 0 || reading > 0) && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {files.map((f, i) => (
                  <div key={i} className="row" style={{
                    padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10,
                    alignItems: 'flex-start',
                    background: f.failed ? 'var(--status-danger)' : 'var(--card-subtle)',
                  }}>
                    {f.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.preview} alt="" style={{ height: 34, width: 34, flex: '0 0 34px', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    ) : (
                      // fixed-width column so every filename starts on the same line
                      <span className="chip" style={{
                        fontSize: 9.5, padding: '3px 0', flex: '0 0 46px',
                        justifyContent: 'center', textAlign: 'center', marginTop: 1,
                      }}>
                        {f.pdf ? 'PDF' : (f.name.split('.').pop() || 'DOC').toUpperCase()}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                      <div className="faint" style={{ fontSize: 10.5 }}>
                        {(f.bytes / 1024).toFixed(0)} KB
                        {f.text ? ` · ${f.text.length.toLocaleString()} characters read` : ''}
                        {f.pdf ? ' · sent to the reader as-is' : ''}
                        {f.image ? ' · image' : ''}
                      </div>
                      {f.note && (
                        <div style={{ fontSize: 10.5, marginTop: 2, color: f.failed ? '#8c2f28' : 'var(--dim)' }}>{f.note}</div>
                      )}
                    </div>
                    <button className="btn sm danger" onClick={() => setFiles(x => x.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                {reading > 0 && <div className="faint" style={{ fontSize: 11.5 }}>Reading {reading} file{reading > 1 ? 's' : ''}…</div>}
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => fileRef.current?.click()}>+ Add files</button>
              <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden
                onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              <span className="faint" style={{ fontSize: 11 }}>
                {files.length ? `${files.length} attached` : 'PDF · DOCX · PPTX · XLSX · images — or drag them in'}
              </span>
              <label className="row" style={{ gap: 6, cursor: 'pointer' }} title="Reads the source a second time with its own first answer in front of it. Catches the deadlines a single pass misses. Costs one extra API call.">
                <input type="checkbox" checked={verify} onChange={e => setVerify(e.target.checked)} />
                <span className="micro" style={{ fontSize: 9.5 }}>DOUBLE-CHECK PASS</span>
              </label>
              <button className="btn primary right-align" onClick={extract} disabled={busy || reading > 0}>
                {busy ? 'Extracting…' : 'Extract ⟶'}
              </button>
            </div>
          </div>
          <div className="mono faint" style={{ fontSize: 10, marginTop: 10, lineHeight: 1.7 }}>
            PIPELINE: DOCUMENT + VISION READ → DEDUPE VS {data.items.filter(i => !i.ghost).length} KNOWN OBJECTS → COVERAGE AUDIT → YOUR REVIEW → COMMIT.
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
    MOVE: review.cards.filter(c => c.verdict === 'MOVE').length,
    FIX: review.corrections.filter(c => c.kind !== 'ORPHAN').length,
  }), [review.cards, review.corrections]);
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
  /** Re-file one row. This is the escape hatch: whatever the extractor guessed,
   *  a wrong course is two seconds to fix here instead of weeks to notice. */
  const setCardClass = (key: string, classId: string | null) => setReview({
    ...review,
    cards: review.cards.map(c => {
      if (c.key !== key) return c;
      const k = data.classes.find(x => x.id === classId);
      // re-filing away from the class the existing copy was matched in makes
      // that match meaningless, so drop back to being a new item
      const keepsMatch = c.verdict !== 'MOVE' && c.incoming.class_id === classId;
      return {
        ...c,
        incoming: { ...c.incoming, class_id: classId },
        classCode: k?.code ?? 'LIFE',
        classNote: 'you set this course',
        ...(keepsMatch ? {} : c.verdict === 'MOVE' ? {} : { verdict: 'NEW' as const, existingId: undefined, changes: undefined }),
      };
    }),
  });
  const toggleCorrection = (key: string) => setReview({
    ...review,
    corrections: review.corrections.map(c => c.key === key ? { ...c, include: !c.include } : c),
  });
  const included = review.cards.filter(c => c.include).length
    + review.newClasses.filter(c => c.include).length
    + review.corrections.filter(c => c.include).length;

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div>
          <div className="micro">REVIEW BEFORE COMMIT — YOU ARE THE FINAL AUTHORITY</div>
          <h2 className="display" style={{ fontSize: 26, margin: '4px 0' }}>
            <span className="ok">{counts.NEW} NEW</span> · <span className="warn">{counts.UPDATE} UPDATES</span>
            {counts.MOVE > 0 && <> · <span style={{ color: '#8C4A12' }}>{counts.MOVE} MISFILED</span></>}
            {counts.FIX > 0 && <> · <span style={{ color: '#8C4A12' }}>{counts.FIX} TO FIX</span></>}
            {' '}· <span className="faint">{counts.KNOWN} KNOWN</span>
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
              <div style={{ marginTop: 10 }}>
                {nc.components.map((c, j) => <MeetingPreview key={j} comp={c} color={nc.color} />)}
                {nc.grading.length > 0 && (
                  <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>
                    GRADING: {nc.grading.map(g => `${g.name} ${g.weight_pct}%${g.drops ? ` (drop ${g.drops})` : ''}`).join(' · ')}
                  </div>
                )}
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

      <CorrectionsPanel corrections={review.corrections} onToggle={toggleCorrection} />

      <div style={{ marginTop: 16 }}>
        {(['MOVE', 'UPDATE', 'NEW', 'KNOWN'] as const).map(v => review.cards.some(c => c.verdict === v) && (
          <div key={v} style={{ marginBottom: 14 }}>
            <div className="micro" style={{ marginBottom: 8 }}>
              {v === 'NEW' ? '◆ NEW OBJECTS'
                : v === 'UPDATE' ? '◈ UPDATES TO EXISTING'
                : v === 'MOVE' ? '⇄ ALREADY TRACKED, BUT ON THE WRONG COURSE'
                : '◇ ALREADY TRACKED (no action)'}
            </div>
            {review.cards.filter(c => c.verdict === v).map(card => {
              return (
                <div key={card.key} className={`panel verdict-${v}`} style={{ padding: '10px 14px', marginBottom: 6 }}>
                  <div className="row">
                    <input type="checkbox" checked={card.include} disabled={v === 'KNOWN'} onChange={() => toggle(card.key)} />
                    <ClassPicker card={card} onPick={id => setCardClass(card.key, id)} />
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
                  {card.verdict === 'MOVE' && (
                    <div style={{ fontSize: 11, marginTop: 5, paddingLeft: 24, color: '#8C4A12' }}>
                      ⇄ this already exists under <strong>{data.classes.find(c2 => c2.id === card.fromClassId)?.code ?? 'LIFE'}</strong> —
                      committing moves it instead of creating a second copy
                    </div>
                  )}
                  {card.classNote && (
                    <div style={{ fontSize: 10.5, marginTop: 3, paddingLeft: 24, color: '#8C4A12' }}>⌖ {card.classNote}</div>
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

/**
 * The meeting schedule, shown before anything commits. This is the check the
 * student actually needs: a wrong pattern is invisible in a summary line but
 * obvious the moment you see the real dates listed out.
 */
function MeetingPreview({ comp, color }: { comp: Omit<ClassComponent, 'id' | 'class_id'>; color: string }) {
  const { data } = useApp();
  const dates = useMemo(() => {
    if (!data.semester || comp.is_async) return [];
    const full = { ...comp, id: 'preview', class_id: 'preview' } as ClassComponent;
    return expandComponent(full, data.semester, data.holidays).map(o => o.date);
  }, [comp, data.semester, data.holidays]);

  const c = { ...comp, id: '', class_id: '' } as ClassComponent;
  const listed = isDateList(c);
  const weekly = !comp.is_async && !listed && comp.interval === 1 && comp.days.length > 0;

  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px',
      marginBottom: 6, background: 'var(--card-subtle)',
    }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="chip" style={{ fontSize: 9.5, padding: '3px 9px' }}>
          <span className="dot" style={{ background: color }} />{comp.kind}
        </span>
        <strong style={{ fontSize: 12.5 }}>{describePattern(c)}</strong>
        {comp.location && <span className="dim" style={{ fontSize: 11.5 }}>@ {comp.location}</span>}
        <span className="right-align chip" style={{ fontSize: 9.5, padding: '3px 9px' }}>
          {comp.is_async ? 'no meetings' : `${dates.length} meetings`}
        </span>
      </div>
      {dates.length > 0 && (
        <div className="mono faint" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.6 }}>
          {dates.slice(0, 12).map(d => d.slice(5).replace('-', '/')).join('  ')}
          {dates.length > 12 ? `  …+${dates.length - 12}` : ''}
        </div>
      )}
      {weekly && (
        <div style={{ fontSize: 10.5, marginTop: 5, color: 'var(--dim)' }}>
          Read as <strong>every week</strong>. If this one actually meets every other week or only on
          certain dates, fix it in CLASSES after committing — that takes ten seconds and saves a semester.
        </div>
      )}
    </div>
  );
}

const KIND_TITLE: Record<string, string> = {
  key: 'That API key was rejected',
  quota: 'Out of free quota for now',
  'missing-model': 'No usable model on this key',
  'bad-request': 'Google rejected the request',
  blocked: 'The content was blocked',
  network: 'Could not reach Google',
  empty: 'The model returned nothing',
};

/**
 * A failure you can act on. The previous version threw the message into a
 * toast that vanished, and the server had already discarded Google's actual
 * explanation — so "extraction failed" was all anyone ever saw.
 */
function FailurePanel({ f, onDismiss, onSettings }: {
  f: ExtractFailure; onDismiss: () => void; onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel corner" style={{
      padding: 16, marginBottom: 14,
      borderColor: 'var(--danger, #E0555F)', background: 'rgba(224,85,95,.055)',
    }}>
      <i className="c3" />
      <div className="row">
        <span className="micro" style={{ color: '#A8241C' }}>
          EXTRACTION FAILED — {KIND_TITLE[f.kind ?? ''] ?? 'SOMETHING WENT WRONG'}
        </span>
        <button className="btn sm right-align" onClick={onDismiss}>Dismiss</button>
      </div>

      <div style={{ fontSize: 13.5, marginTop: 9, color: 'var(--text)' }}>{f.error}</div>
      {f.hint && <div style={{ fontSize: 12.5, marginTop: 7, color: 'var(--dim)', lineHeight: 1.6 }}>{f.hint}</div>}
      {f.kind === 'key' && (
        // "AIza" in a proportional face reads as "Alza" — capital I and
        // lowercase L are the same glyph. Show it where they are not.
        <div className="code" style={{ fontSize: 12, marginTop: 6, color: 'var(--text)' }}>
          a real key looks like <strong>AIzaSyC…</strong> (capital A, capital I, lowercase z, lowercase a)
        </div>
      )}

      <div className="row" style={{ marginTop: 11, flexWrap: 'wrap' }}>
        <button className="btn sm primary" onClick={onSettings}>Open settings</button>
        <a className="btn sm" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a free key</a>
        {f.attempts.length > 0 && (
          <button className="btn sm" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide' : `What was tried (${f.attempts.length})`}
          </button>
        )}
      </div>

      {open && f.attempts.length > 0 && (
        <div style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          {f.attempts.map((a, i) => (
            <div key={i} style={{ padding: '7px 11px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, minWidth: 150 }}>{a.model}</span>
                <span className="chip" style={{ fontSize: 9, padding: '2px 7px' }}>{a.status || 'no response'}</span>
                <span className="micro" style={{ fontSize: 9 }}>{a.kind}</span>
                {a.schemaless && <span className="micro faint" style={{ fontSize: 9 }}>RETRY WITHOUT STRICT FORMAT</span>}
              </div>
              <div className="mono faint" style={{ fontSize: 10.5, marginTop: 3, lineHeight: 1.5 }}>{a.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Which course this row goes to — always visible, always changeable. */
function ClassPicker({ card, onPick }: { card: ReviewCard; onPick: (id: string | null) => void }) {
  const { data } = useApp();
  const k = data.classes.find(c => c.id === card.incoming.class_id);
  const unresolved = !card.incoming.class_id && card.classCode !== 'LIFE';
  return (
    <span className="row" style={{ gap: 5 }}>
      <span className="dot" style={{
        width: 8, height: 8, borderRadius: 2, display: 'inline-block',
        background: k?.color ?? (unresolved ? '#E08A3C' : '#8A8A84'),
      }} />
      <select
        value={card.incoming.class_id ?? ''}
        onChange={e => onPick(e.target.value || null)}
        title={card.rawCode ? `the document said "${card.rawCode}"` : 'no course code in the document'}
        style={{
          padding: '2px 6px', fontSize: 11, width: 116,
          borderColor: unresolved ? '#E08A3C' : undefined,
        }}
      >
        <option value="">{card.classCode && card.classCode !== 'LIFE' ? `${card.classCode} (new)` : 'LIFE'}</option>
        {data.classes.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
      </select>
    </span>
  );
}

const CORRECTION_LABEL: Record<string, { title: string; tone: string }> = {
  REASSIGN: { title: 'MOVE TO THE RIGHT COURSE', tone: '#8C4A12' },
  DUPLICATE: { title: 'TRACKED TWICE', tone: '#A8241C' },
  ORPHAN: { title: 'ON THIS COURSE BUT NOT IN THIS SYLLABUS', tone: '#63635f' },
};

/**
 * What this document says about things already tracked. The point of uploading
 * a syllabus is not only to add what is missing — it is to find out what is
 * wrong, which is the part you cannot do by hand.
 */
function CorrectionsPanel({ corrections, onToggle }: {
  corrections: CorrectionCard[]; onToggle: (key: string) => void;
}) {
  const { data } = useApp();
  const codeOf = (id: string | null | undefined) =>
    id ? data.classes.find(c => c.id === id)?.code ?? '—' : 'LIFE';
  const groups = (['REASSIGN', 'DUPLICATE', 'ORPHAN'] as const)
    .map(kind => ({ kind, rows: corrections.filter(c => c.kind === kind) }))
    .filter(g => g.rows.length);
  if (!groups.length) return null;

  const actionable = corrections.filter(c => c.kind !== 'ORPHAN').length;
  return (
    <div className="panel corner" style={{
      padding: 15, marginTop: 14,
      borderColor: actionable ? '#e8bf95' : 'var(--line)',
      background: actionable ? 'rgba(224,138,60,.05)' : undefined,
    }}>
      <i className="c3" />
      <div className="micro" style={{ marginBottom: 4, color: actionable ? '#8C4A12' : 'var(--dim)' }}>
        ⇄ CROSS-CHECK AGAINST WHAT YOU ALREADY TRACK — {corrections.length} FINDING{corrections.length === 1 ? '' : 'S'}
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginBottom: 10, lineHeight: 1.55 }}>
        Ticked changes are applied to existing items when you commit.
      </div>

      {groups.map(g => (
        <div key={g.kind} style={{ marginTop: 10 }}>
          <div className="micro" style={{ fontSize: 9.5, color: CORRECTION_LABEL[g.kind].tone, marginBottom: 5 }}>
            {CORRECTION_LABEL[g.kind].title} · {g.rows.length}
          </div>
          {g.rows.map(c => (
            <div key={c.key} style={{
              border: '1px solid var(--line)', borderRadius: 9, background: '#fff',
              padding: '8px 11px', marginBottom: 5,
            }}>
              <div className="row" style={{ gap: 9 }}>
                <input type="checkbox" checked={c.include} onChange={() => onToggle(c.key)} />
                <span className="chip" style={{ fontSize: 9.5, padding: '2px 8px' }}>{codeOf(c.item.class_id)}</span>
                <span style={{ flex: 1, fontSize: 12.5 }}>{c.item.title}</span>
                {c.kind === 'REASSIGN' && (
                  <span className="chip" style={{ fontSize: 9.5, padding: '2px 8px', borderColor: '#e8bf95', color: '#8C4A12' }}>
                    → {codeOf(c.toClassId)}
                  </span>
                )}
                {c.kind === 'DUPLICATE' && (
                  <span className="chip hot" style={{ fontSize: 9.5, padding: '2px 8px' }}>drop this copy</span>
                )}
                {c.item.due_at && (
                  <span className="mono faint" style={{ fontSize: 10.5 }}>{fmtEt(new Date(c.item.due_at), 'MMM d')}</span>
                )}
              </div>
              <div style={{ fontSize: 10.5, marginTop: 3, paddingLeft: 25, color: 'var(--dim)' }}>{c.reason}</div>
              {c.detail && <div className="mono faint" style={{ fontSize: 10, marginTop: 2, paddingLeft: 25 }}>{c.detail}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
