// ── Meeting patterns and the calendar feed ────────────────────────────────
const { expandComponent } = await import('../src/lib/recurrence');
const { buildIcs, meetingSummary } = await import('../src/lib/ics');
const { describePattern, isDateList } = await import('../src/lib/types');
const { mergeExtractions } = await import('../src/lib/gemini');
import type { AppData, ClassComponent, Holiday, Item, Klass, Semester } from '../src/lib/types';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// Fall 2026: Aug 19 (Wed) → Dec 11 (Fri)
const sem: Semester = { id: 's', name: 'Fall 2026', start_date: '2026-08-19', end_date: '2026-12-11' };
const comp = (p: Partial<ClassComponent>): ClassComponent => ({
  id: 'c1', class_id: 'k1', kind: 'LAB', title: '', location: 'Cox B12', is_async: false,
  days: [], start_time: '13:30', end_time: '16:15', interval: 1, anchor_date: '',
  start_date: '', end_date: '', skip_dates: [], extra_dates: [], leave_by_min: 15, ...p,
});

// ── every-Nth-week ────────────────────────────────────────────────────────
const weekly = expandComponent(comp({ days: [3] }), sem, []);          // Wednesdays
ok(weekly.length === 17, `weekly Wednesdays: ${weekly.length}`);

const biweek = expandComponent(comp({ days: [3], interval: 2, anchor_date: '2026-08-26' }), sem, []);
eq(biweek.slice(0, 4).map(o => o.date), ['2026-08-26', '2026-09-09', '2026-09-23', '2026-10-07'], 'every other Wednesday');
ok(biweek.length === Math.ceil(16 / 2), `biweekly count: ${biweek.length}`);

// the anchor is mid-semester: dates BEFORE it must still alternate correctly.
// JS % keeps the dividend's sign, so this is the case that used to break.
const backwards = expandComponent(comp({ days: [3], interval: 2, anchor_date: '2026-10-07' }), sem, []);
ok(backwards.map(o => o.date).includes('2026-08-26'), 'parity holds before the anchor');
ok(!backwards.map(o => o.date).includes('2026-09-02'), 'off weeks stay off before the anchor');

const every3 = expandComponent(comp({ days: [3], interval: 3, anchor_date: '2026-08-19' }), sem, []);
eq(every3.slice(0, 3).map(o => o.date), ['2026-08-19', '2026-09-09', '2026-09-30'], 'every 3rd week');

// ── explicit date lists ───────────────────────────────────────────────────
const dates = ['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16'];
const listed = comp({ days: [], extra_dates: dates });
ok(isDateList(listed), 'recognised as a date list');
eq(expandComponent(listed, sem, []).map(o => o.date), dates, 'date list expands to exactly its dates');

const hol: Holiday[] = [
  { id: 'h1', semester_id: 's', date: '2026-09-30', name: 'Fall Break' },   // falls on a lab
  { id: 'h2', semester_id: 's', date: '2026-10-02', name: 'Fall Break' },   // falls on a recitation
];
eq(expandComponent(listed, sem, hol).map(o => o.date),
   ['2026-09-04', '2026-09-18', '2026-10-16'], 'a holiday cancels a listed date too');

// a component that starts late does not meet before its start_date
const late = expandComponent(comp({ days: [3], start_date: '2026-09-16' }), sem, []);
ok(late[0].date === '2026-09-16', `late start honoured: ${late[0].date}`);

// ── human description ─────────────────────────────────────────────────────
ok(describePattern(comp({ days: [3], interval: 2 })).startsWith('Every other Wed'), describePattern(comp({ days: [3], interval: 2 })));
ok(describePattern(listed).startsWith('4 listed dates'), describePattern(listed));
ok(describePattern(comp({ is_async: true })) === 'Async — no meetings', 'async described');

// ── the calendar feed ─────────────────────────────────────────────────────
const k: Klass = { id: 'k1', semester_id: 's', code: 'CH 221', name: 'Organic Chemistry I; Section 002', color: '#E4566E', grading: [], target_pct: 93, notes: '', created_at: '2026-08-01T00:00:00.000Z' };
const mkItem = (p: Partial<Item> & { title: string }): Item => ({
  id: 'i1', class_id: 'k1', type: 'assignment', details: '', due_at: null, all_day: true,
  at_home: true, bucket: null, weight_pct: null, effort_min: 0, status: 'pending', ghost: false,
  parent_id: null, start_suggested_at: null, completed_at: null, source_id: null,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z', ...p,
});
const data: AppData = {
  semester: sem, holidays: hol, classes: [k],
  components: [
    comp({ id: 'lab', days: [3], interval: 2, anchor_date: '2026-09-02', location: 'Cox B12; Bench 4' }),
    comp({ id: 'rec', kind: 'REC', days: [], extra_dates: dates, start_time: '14:00', end_time: '14:50' }),
  ],
  items: [
    mkItem({ id: 'a1', title: 'Problem Set 4', due_at: '2026-09-19T03:59:00.000Z', all_day: true, bucket: 'Problem Sets', effort_min: 150 }),
    mkItem({ id: 'e1', title: 'Midterm 1', type: 'exam', at_home: false, all_day: false, weight_pct: 15, due_at: '2026-10-07T13:35:00.000Z' }),
    mkItem({ id: 's1', title: 'Study: Midterm 1 (T−3)', type: 'study', all_day: false, effort_min: 90, due_at: '2026-10-04T22:00:00.000Z' }),
    mkItem({ id: 'd1', title: 'Done already', status: 'done', due_at: '2026-09-01T03:59:00.000Z' }),
    mkItem({ id: 'g1', title: 'A proposal', ghost: true, due_at: '2026-09-01T03:59:00.000Z' }),
  ],
  sources: [], scores: [],
  settings: { gemini_key: '', gemini_model: '', ics_token: 't', sound_on: true, free_min_weekday: 240, free_min_weekend: 420 },
};
const ics = buildIcs(data, { appUrl: 'https://academai2.vercel.app' });
const L = ics.split('\r\n');

ok(ics.endsWith('\r\n'), 'feed ends with CRLF');
ok(!ics.includes('\n\n') && !/[^\r]\n/.test(ics), 'every line break is CRLF');
ok(L.filter(l => l === 'BEGIN:VEVENT').length === L.filter(l => l === 'END:VEVENT').length, 'VEVENTs balanced');
ok(L[0] === 'BEGIN:VCALENDAR' && L[L.length - 2] === 'END:VCALENDAR', 'calendar wrapper intact');

// DTSTAMP must be UTC — a TZID here is invalid and is what makes feeds flaky
ok(L.some(l => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l)), 'DTSTAMP is UTC with Z');
ok(!L.some(l => l.startsWith('DTSTAMP;')), 'no TZID on DTSTAMP');

// folding: 75 octets max per line
const enc = new TextEncoder();
const long = L.filter(l => enc.encode(l).length > 75);
ok(long.length === 0, `all lines ≤75 octets (${long.length} too long)`);

// semicolons inside text values are escaped
ok(L.some(l => l.includes('Organic Chemistry I\\; Section 002')), 'semicolons escaped in text');
ok(L.some(l => l.includes('Cox B12\\; Bench 4')), 'semicolons escaped in LOCATION');

// patterned meeting → ONE event with an RRULE, holiday as EXDATE
const rrules = L.filter(l => l.startsWith('RRULE:FREQ=WEEKLY'));
ok(rrules.length === 1, `one RRULE for the patterned lab (${rrules.length})`);
ok(/INTERVAL=2/.test(rrules[0]) && /BYDAY=WE/.test(rrules[0]) && /WKST=MO/.test(rrules[0]), `RRULE shape: ${rrules[0]}`);
ok(/UNTIL=\d{8}T\d{6}Z/.test(rrules[0]), 'RRULE has a UTC UNTIL');
ok(L.some(l => l.startsWith('EXDATE;TZID=America/New_York:20260930T133000')), 'holiday emitted as EXDATE, not a deleted event');
ok(L.filter(l => l === 'UID:lab@academai').length === 1, 'recurring meeting has one stable UID');

// date-list meeting → one event per date, no RRULE
ok(L.filter(l => /^UID:rec-2026-\d\d-\d\d@academai$/.test(l)).length === 3, 'listed recitations emitted individually, holiday dropped');

// deadlines
ok(L.some(l => l === 'SUMMARY:CH 221 · Problem Set 4 (due)'), 'class code leads the title');
ok(L.some(l => l.startsWith('DTSTART;VALUE=DATE:2026091')), 'all-day deadline uses VALUE=DATE');
ok(L.filter(l => l === 'TRANSP:TRANSPARENT').length >= 1, 'deadlines do not mark the day busy');
ok(L.filter(l => l === 'TRANSP:OPAQUE').length >= 3, 'meetings and study blocks are busy time');
ok(!ics.includes('Done already') && !ics.includes('A proposal'), 'done and proposed items stay out of the feed');
ok(L.some(l => l.startsWith('SEQUENCE:') && l !== 'SEQUENCE:0'), 'edited items carry a sequence');
ok(L.some(l => l === 'URL:https://academai2.vercel.app'), 'events link back to the app');

// alarms: an exam is warned about three times, a lab has a leave-by
const exam = ics.slice(ics.indexOf('UID:item-e1'), ics.indexOf('END:VEVENT', ics.indexOf('UID:item-e1')));
ok((exam.match(/BEGIN:VALARM/g) ?? []).length === 3, 'exam has three warnings');
ok(exam.includes('TRIGGER:-PT45M'), 'exam warns 45 minutes out');
ok(exam.includes('PRIORITY:1'), 'exam is high priority');
ok(L.some(l => l === 'TRIGGER:-PT15M'), 'meeting carries the leave-by alarm');
const allDay = ics.slice(ics.indexOf('UID:item-a1'), ics.indexOf('END:VEVENT', ics.indexOf('UID:item-a1')));
ok(allDay.includes('TRIGGER:-PT9H') && allDay.includes('TRIGGER:PT9H'), 'all-day deadline warns at a civilised hour');

// ── the "does this look right" summary ────────────────────────────────────
const sum = meetingSummary(data);
ok(sum.length === 2, `summary covers both components (${sum.length})`);
ok(sum[0].count === expandComponent(data.components[0], sem, hol).length, 'summary count matches the engine');

// ── a stated first meeting bounds the start ───────────────────────────────
const { processExtraction } = await import('../src/lib/intake');
const blank = { ...data, classes: [], components: [], items: [] };
const pay = processExtraction({
  classes: [{
    code: 'PY 205', name: 'Physics',
    components: [{ kind: 'REC', days: ['TH'], start_time: '08:30', end_time: '09:45', every_n_weeks: 2, first_date: '2026-09-03' }],
  }],
}, blank);
const rec = pay.newClasses[0].components[0];
ok(rec.start_date === '2026-09-03', `first_date bounds the start (got "${rec.start_date}")`);
ok(rec.interval === 2, 'every_n_weeks carried through');
const recDates = expandComponent({ ...rec, id: 'x', class_id: 'x' }, sem, []).map(o => o.date);
ok(recDates[0] === '2026-09-03', `no meeting before the stated first one (got ${recDates[0]})`);
eq(recDates.slice(0, 3), ['2026-09-03', '2026-09-17', '2026-10-01'], 'alternating from the stated start');

// an explicit date list never also produces a weekday pattern
const pay2 = processExtraction({
  classes: [{
    code: 'PY 205', name: 'Physics',
    components: [{ kind: 'LAB', days: ['TH'], start_time: '13:30', end_time: '16:15', meeting_dates: ['2026-09-10', '2026-09-24'] }],
  }],
}, blank);
const lab = pay2.newClasses[0].components[0];
eq(lab.days, [], 'listed dates win over the weekday pattern');
eq(lab.extra_dates, ['2026-09-10', '2026-09-24'], 'the listed dates are kept');
eq(expandComponent({ ...lab, id: 'y', class_id: 'y' }, sem, []).map(o => o.date), ['2026-09-10', '2026-09-24'], 'exactly two labs, not sixteen');

// item-level explicit dates
const pay3 = processExtraction({
  items: [{ class_code: '', type: 'quiz', title: 'Reading quiz', due_date: '', due_time: '09:00', at_home: true, confidence: 'high',
    recurrence: { dates: ['2026-09-04', '2026-09-18', '2026-10-02'], skip_dates: ['2026-09-18'] } }],
}, blank);
ok(pay3.cards.length === 2, `listed quiz dates minus a skip (${pay3.cards.length})`);
ok(pay3.cards.every(c => (c.assumption ?? '').includes('listed in the source')), 'assumption records where the date came from');

// ── audit merge never loses a deadline ────────────────────────────────────
const draft = { items: [{ title: 'PS 1', due_date: '2026-09-04', class_code: 'CH 221' }, { title: 'PS 2', due_date: '2026-09-11', class_code: 'CH 221' }], coverage_notes: ['a'] };
const audit = { items: [{ title: 'PS 1', due_date: '2026-09-04', class_code: 'CH 221' }, { title: 'PS 3', due_date: '2026-09-18', class_code: 'CH 221' }], coverage_notes: ['FIXED: b'] };
const merged = mergeExtractions(draft, audit) as { items: Array<{ title: string }>; coverage_notes: string[] };
eq(merged.items.map(i => i.title).sort(), ['PS 1', 'PS 2', 'PS 3'], 'merge keeps what either pass found');
ok(merged.items.length === 3, 'no duplicate for the item both passes found');
ok(merged.coverage_notes[0].startsWith('CHECK:'), 'dropped items are flagged for the student');
ok(JSON.stringify(mergeExtractions(draft, {})) === JSON.stringify(draft), 'an empty audit changes nothing');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
