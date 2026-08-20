// Quick logic verification: recurrence, dedupe, grades, planner, ics
import { expandComponent } from '../src/lib/recurrence';
import { classifyIncoming, normTitle, dice } from '../src/lib/dedupe';
import { classStanding } from '../src/lib/grades';
import { buildIcs } from '../src/lib/ics';
import { etToUtc, utcToEtDate, etWeekday, addDaysStr, weekStart } from '../src/lib/time';
import type { ClassComponent, Item, Klass, Semester } from '../src/lib/types';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}

// ── time ──
const d1 = etToUtc('2026-08-24', '09:35'); // EDT (-4)
ok(d1.toISOString() === '2026-08-24T13:35:00.000Z', `etToUtc EDT: ${d1.toISOString()}`);
const d2 = etToUtc('2026-12-01', '09:35'); // EST (-5)
ok(d2.toISOString() === '2026-12-01T14:35:00.000Z', `etToUtc EST: ${d2.toISOString()}`);
ok(utcToEtDate(new Date('2026-08-25T02:30:00Z')) === '2026-08-24', 'utcToEtDate late-night rollover');
ok(etWeekday('2026-08-24') === 1, 'Aug 24 2026 is Monday');
ok(weekStart('2026-08-27') === '2026-08-24', 'weekStart Thu → Mon');
ok(addDaysStr('2026-08-30', 3) === '2026-09-02', 'addDaysStr month rollover');

// ── recurrence ──
const sem: Semester = { id: 's1', name: 'Fall 2026', start_date: '2026-08-24', end_date: '2026-12-11' };
const lec: ClassComponent = {
  id: 'c1', class_id: 'k1', kind: 'LEC', title: '', location: 'X', is_async: false,
  days: [1, 3, 5], start_time: '09:35', end_time: '10:25', interval: 1,
  anchor_date: '2026-08-24', start_date: '', end_date: '', skip_dates: [], extra_dates: [], leave_by_min: 10,
};
const hols = [{ id: 'h1', semester_id: 's1', date: '2026-09-07', name: 'Labor Day' }];
const occs = expandComponent(lec, sem, hols, '2026-08-24', '2026-09-11');
// MWF weeks: Aug 24,26,28,31, Sep 2,4,(7 skip),9,11 → 8
ok(occs.length === 8, `MWF expansion w/ holiday: got ${occs.length}`);
ok(!occs.some(o => o.date === '2026-09-07'), 'Labor Day skipped');

const lab: ClassComponent = { ...lec, id: 'c2', kind: 'LAB', days: [2], start_time: '13:30', end_time: '16:15', interval: 2, anchor_date: '2026-08-25' };
const labOccs = expandComponent(lab, sem, [], '2026-08-24', '2026-09-30');
// Tuesdays biweekly from Aug 25: Aug 25, Sep 8, Sep 22 → 3
ok(labOccs.length === 3, `biweekly lab: got ${labOccs.length} (${labOccs.map(o => o.date).join(',')})`);
ok(labOccs[1].date === '2026-09-08', 'biweekly parity correct');

const asyncComp: ClassComponent = { ...lec, id: 'c3', is_async: true, days: [], start_time: '', end_time: '' };
ok(expandComponent(asyncComp, sem, []).length === 0, 'async → no meetings');

// ── dedupe ──
const mk = (p: Partial<Item>): Item => ({
  id: Math.random().toString(36).slice(2), class_id: 'k1', type: 'assignment', title: '', details: '',
  due_at: null, all_day: true, at_home: true, bucket: null, weight_pct: null, effort_min: 0,
  status: 'pending', ghost: false, parent_id: null, start_suggested_at: null, completed_at: null,
  source_id: null, created_at: '', updated_at: '', ...p,
});
const existing = [
  mk({ title: 'Homework 4', due_at: '2026-09-10T03:59:00.000Z' }),
  mk({ title: 'Problem Set 2', due_at: '2026-09-03T03:59:00.000Z' }),
  mk({ title: 'Midterm 1', type: 'exam', due_at: '2026-10-01T13:35:00.000Z', at_home: false }),
];
const inc = { class_id: 'k1', type: 'assignment' as const, title: 'HW #4', due_at: '2026-09-12T03:59:00.000Z', all_day: false, details: '', at_home: true, bucket: null, weight_pct: null, effort_min: 60 };
const c1 = classifyIncoming(inc, existing);
ok(c1.verdict === 'UPDATE', `HW #4 vs Homework 4 (new date) → UPDATE, got ${c1.verdict}`);
const c2 = classifyIncoming({ ...inc, title: 'HW 5' }, existing);
ok(c2.verdict === 'NEW', `HW 5 → NEW, got ${c2.verdict}`);
const c3 = classifyIncoming({ ...inc, title: 'Homework 4', due_at: '2026-09-10T03:59:00.000Z' }, existing);
ok(c3.verdict === 'KNOWN', `identical HW4 → KNOWN, got ${c3.verdict}`);
const c4 = classifyIncoming({ ...inc, title: 'Exam 1 (midterm)', type: 'exam', due_at: '2026-10-01T13:35:00.000Z', at_home: false }, existing);
ok(c4.verdict !== 'NEW', `Exam 1 midterm same date → matches Midterm 1, got ${c4.verdict}`);
ok(dice(normTitle('Lab Report #2'), normTitle('lab report 2')) > 0.95, 'normalization');

// ── grades ──
const k: Klass = {
  id: 'k1', semester_id: 's1', code: 'CH 221', name: 'Orgo', color: '#fff', target_pct: 93, notes: '', created_at: '',
  grading: [
    { name: 'HW', weight_pct: 40, drops: 1 },
    { name: 'Final', weight_pct: 60 },
  ],
};
const scores = [
  { id: 'x1', class_id: 'k1', item_id: null, bucket: 'HW', earned: 50, possible: 100, note: '', graded_at: '' }, // dropped
  { id: 'x2', class_id: 'k1', item_id: null, bucket: 'HW', earned: 95, possible: 100, note: '', graded_at: '' },
  { id: 'x3', class_id: 'k1', item_id: null, bucket: 'HW', earned: 85, possible: 100, note: '', graded_at: '' },
];
const st = classStanding(k, scores);
ok(Math.abs((st.currentPct ?? 0) - 90) < 0.01, `drop-lowest avg = 90, got ${st.currentPct}`);
// need on final: (0.93*100 - 0.40*90) / 0.60 = (93-36)/0.6 = 95
ok(Math.abs((st.neededOnRemaining ?? 0) - 95) < 0.01, `need 95 on final, got ${st.neededOnRemaining}`);

// ── ics ──
const ics = buildIcs({
  semester: sem, holidays: hols,
  classes: [k], components: [lec],
  items: [mk({ title: 'PS 1; test, escape\nnewline', due_at: '2026-09-03T03:59:00.000Z', all_day: false })],
  sources: [], scores: [],
  settings: { gemini_key: '', gemini_model: '', ics_token: 't', sound_on: true, free_min_weekday: 240, free_min_weekend: 420 },
});
ok(ics.includes('BEGIN:VCALENDAR') && ics.includes('VTIMEZONE'), 'ics skeleton');
ok(ics.includes('DTSTART;TZID=America/New_York:20260824T093500'), 'ics meeting local time');
ok(ics.includes('PS 1\\; test\\, escape\\nnewline'), 'ics escaping');
ok(!ics.split('\r\n').some(l => l.length > 76), 'ics line folding');
// due 2026-09-03T03:59Z = 2026-09-02 23:59 ET
ok(ics.includes('DTSTART;TZID=America/New_York:20260902T235900'), 'ics due local time');

// ── panic planner ──
import { panicPlan } from '../src/lib/planner';
const nowD = new Date('2026-09-01T15:00:00Z');
const panicData = {
  semester: sem, holidays: [], classes: [k], components: [], sources: [], scores: [],
  settings: { gemini_key: '', gemini_model: '', ics_token: 't', sound_on: false, free_min_weekday: 240, free_min_weekend: 420 },
  items: [
    mk({ title: 'Midterm 1', type: 'exam', at_home: false, effort_min: 0, due_at: '2026-09-10T13:35:00.000Z' }),
    mk({ title: 'Quiz (in class)', type: 'quiz', at_home: false, effort_min: 0, due_at: '2026-09-04T13:35:00.000Z' }),
    mk({ title: 'Problem Set 5', type: 'assignment', effort_min: 120, due_at: '2026-09-02T03:59:00.000Z' }),
    mk({ title: 'Study: Midterm 1 (T-5)', type: 'study', effort_min: 90, due_at: '2026-09-05T03:59:00.000Z' }),
  ],
};
const picks = panicPlan(panicData, nowD, 90);
ok(picks.length > 0, 'panic returns picks');
ok(!picks.some(p => p.minutes === 0), 'no zero-minute picks');
ok(!picks.some(p => p.item.type === 'exam'), 'sit-down exams excluded from panic plan');
ok(picks[0].item.title === 'Problem Set 5', `most urgent real work first, got ${picks[0].item.title}`);
ok(picks.reduce((a, p) => a + p.minutes, 0) <= 90, 'total minutes within the window');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
