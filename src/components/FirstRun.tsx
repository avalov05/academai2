'use client';
// ── First-run initialization sequence (empty database) ───────────────────
import React, { useState } from 'react';
import { useApp } from './AppContext';
import { todayEt, addDaysStr } from '@/lib/time';
import { sfx } from '@/lib/sound';

export default function FirstRun() {
  const app = useApp();
  const { data } = app;
  const [name, setName] = useState('Fall 2026');
  const [start, setStart] = useState(todayEt());
  const [end, setEnd] = useState(addDaysStr(todayEt(), 112));

  const hasSemester = !!data.semester;
  const hasKey = !!data.settings.gemini_key;
  const hasClasses = data.classes.length > 0;
  const step = !hasSemester ? 1 : !hasKey ? 2 : 3;

  const Step = ({ n, title, done, children }: { n: number; title: string; done: boolean; children?: React.ReactNode }) => (
    <div className="panel corner" style={{
      padding: 18, marginBottom: 12,
      borderLeft: `3px solid ${done ? 'var(--ok)' : step === n ? 'var(--acc)' : 'var(--line)'}`,
      opacity: done ? 0.62 : step === n ? 1 : 0.5,
    }}>
      <i className="c3" />
      <div className="row">
        <span className="display num" style={{ fontSize: 24, color: done ? 'var(--ok)' : step === n ? 'var(--acc)' : 'var(--faint)' }}>
          {done ? '✓' : String(n).padStart(2, '0')}
        </span>
        <span className="micro micro-b" style={{ fontSize: 11 }}>{title}</span>
      </div>
      {step === n && !done && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );

  return (
    <div className="view-enter" style={{ maxWidth: 720, margin: '0 auto', paddingTop: 12 }}>
      <div className="micro">COLD START · NO DATA IN SYSTEM</div>
      <h1 className="display" style={{ fontSize: 'clamp(30px,5vw,52px)', margin: '8px 0 4px' }}>
        Initialize <span className="iridescent-text">AcademAI</span>
      </h1>
      <div className="dim" style={{ fontSize: 13.5, marginBottom: 24 }}>
        Three steps. Then paste a syllabus and the radar fills itself.
      </div>

      <Step n={1} title="DEFINE THE SEMESTER WINDOW" done={hasSemester}>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Everything recurs inside this window — class meetings, weekly quizzes, study blocks.
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="field" style={{ margin: 0, width: 160 }}><span className="micro">NAME</span>
            <input type="text" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="field" style={{ margin: 0 }}><span className="micro">FIRST DAY OF CLASSES</span>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label className="field" style={{ margin: 0 }}><span className="micro">LAST DAY (INCL. FINALS)</span>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }}
            onClick={() => { app.upsertSemester({ name, start_date: start, end_date: end }); sfx.confirm(); }}>
            Set
          </button>
        </div>
      </Step>

      <Step n={2} title="ARM THE EXTRACTION ENGINE" done={hasKey}>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Paste your free Gemini API key so the app can read syllabi and screenshots.
          Get one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.
        </div>
        <button className="btn primary" onClick={() => app.setView('SETTINGS')}>Open settings</button>
      </Step>

      <Step n={3} title="FEED IT YOUR FIRST SYLLABUS" done={hasClasses}>
        <div className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Paste the whole syllabus — text or screenshots. It builds the class, its lecture/lab/recitation
          schedule, the grading breakdown, and every deadline it can find. You review before anything commits.
          Repeat for each class.
        </div>
        <button className="btn primary" onClick={() => app.setView('INTAKE')}>Open intake</button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={() => app.setView('CLASSES')}>Add manually</button>
      </Step>

      {hasSemester && hasKey && hasClasses && (
        <div className="panel corner" style={{ padding: 18, borderLeft: '3px solid var(--ok)' }}>
          <i className="c3" />
          <div className="micro ok">SYSTEM ARMED</div>
          <button className="btn primary" style={{ marginTop: 10 }} onClick={() => location.reload()}>Enter radar</button>
        </div>
      )}

      <div className="dim" style={{ fontSize: 12.5, marginTop: 22, lineHeight: 1.7, maxWidth: 560 }}>
        After setup, open Settings and copy the calendar feed URL into Google or Apple Calendar.
        That&apos;s what puts &quot;leave for lab in 15 min&quot; on your phone.
      </div>
    </div>
  );
}
