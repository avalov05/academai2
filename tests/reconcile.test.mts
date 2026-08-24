// ── Which course does this belong to, and what is already wrong? ─────────
const { resolveClass, processExtraction } = await import('../src/lib/intake');
const { classifyIncoming, findDuplicates, sameIdentity } = await import('../src/lib/dedupe');
import type { AppData, Item, Klass, Semester } from '../src/lib/types';
import type { IncomingItem } from '../src/lib/dedupe';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const mkClass = (code: string, name: string): Klass => ({
  id: 'id-' + code.replace(/\s/g, ''), semester_id: 's', code, name,
  color: '#000', grading: [], target_pct: 93, notes: '', created_at: '',
});
const CH = mkClass('CH 221', 'Organic Chemistry I');
const BIO = mkClass('BIO 183', 'Intro Biology');
const MA = mkClass('MA 242', 'Calculus III');
const PSY = mkClass('PSY 200', 'Intro Psychology');
const CLASSES = [CH, BIO, MA, PSY];

// ── the code that used to be a substring guess ───────────────────────────
ok(resolveClass('CH 221', CLASSES).klass === CH, 'exact code');
ok(resolveClass('ch221', CLASSES).klass === CH, 'case and spacing do not matter');
ok(resolveClass('CH-221', CLASSES).klass === CH, 'a dash does not matter');
ok(resolveClass('CHEM 221', CLASSES).klass === CH, 'CHEM 221 resolves to CH 221');
ok(resolveClass('Organic Chemistry I', CLASSES).klass === CH, 'the course name resolves too');

// The number is the identity. "CH 225" is a different course from "CH 221",
// and the old both-ways substring test was happy to conflate near-misses.
ok(resolveClass('CH 225', CLASSES).klass === null, 'a different number is a different course');
ok(resolveClass('BIO 181', CLASSES).klass === null, 'BIO 181 is not BIO 183');

// A bare department with no number cannot pick between two courses of that
// department, and must not silently take the first one in array order.
const two = [...CLASSES, mkClass('CH 225', 'Organic Chemistry II')];
const amb = resolveClass('CH', two);
ok(amb.klass === null && amb.ambiguous, 'a bare department with two candidates refuses to guess');
ok(/could be/.test(amb.why), `and says why: ${amb.why}`);

// "PSYCH" contains "CH" — the old test matched it against CH 221.
const psych = resolveClass('PSYCH 200', CLASSES);
ok(psych.klass === PSY, `PSYCH 200 is psychology, not chemistry (got ${psych.klass?.code})`);
ok(resolveClass('PSYCH', CLASSES).klass === PSY, 'PSYCH alone still reaches PSY, nothing else contains it');

// number alone, unique → fine; number alone, shared → refuse
ok(resolveClass('242', CLASSES).klass === MA, 'a unique bare number resolves');
const shared = resolveClass('221', [CH, mkClass('PY 221', 'Physics')]);
ok(shared.klass === null && shared.ambiguous, 'a bare number shared by two courses refuses to guess');

ok(resolveClass('', CLASSES).klass === null, 'an empty code resolves to nothing');
ok(resolveClass('HIST 101', CLASSES).klass === null, 'an unknown course resolves to nothing');
ok(/no class matches/.test(resolveClass('HIST 101', CLASSES).why), `and says so: ${resolveClass('HIST 101', CLASSES).why}`);

// ── the misfiling itself ─────────────────────────────────────────────────
const mkItem = (p: Partial<Item> & { id: string; title: string }): Item => ({
  class_id: null, type: 'assignment', details: '', due_at: null, all_day: false, at_home: true,
  bucket: null, weight_pct: null, effort_min: 0, status: 'pending', ghost: false, parent_id: null,
  start_suggested_at: null, completed_at: null, source_id: null,
  created_at: '', updated_at: '', ...p,
});
const inc = (p: Partial<IncomingItem> & { title: string }): IncomingItem => ({
  class_id: CH.id, type: 'assignment', due_at: '2026-09-18T03:59:00.000Z', all_day: false,
  details: '', at_home: true, bucket: null, weight_pct: null, effort_min: 0, ...p,
});

// Problem Set 4 is a CH 221 assignment, but it is sitting on BIO 183.
const misfiled = mkItem({ id: 'x1', title: 'Problem Set 4', class_id: BIO.id, due_at: '2026-09-18T03:59:00.000Z' });
const r = classifyIncoming(inc({ title: 'Problem Set 4' }), [misfiled]);
ok(r.verdict === 'MOVE', `the same thing on another course is a MOVE, not a NEW (got ${r.verdict})`);
ok(r.existing?.id === 'x1', 'and it points at the copy that already exists');
ok(r.fromClassId === BIO.id, 'and records where it is filed today');

// The old behaviour, for contrast: same-class comparison alone sees nothing,
// which is exactly how a duplicate ends up on the wrong course.
ok(!sameIdentity(inc({ title: 'Problem Set 4' }), misfiled), 'same-class comparison cannot see it');
ok(sameIdentity(inc({ title: 'Problem Set 4' }), misfiled, true), 'cross-class comparison can');

// Once it is on the right course it is an ordinary match again.
const filed = mkItem({ id: 'x2', title: 'Problem Set 4', class_id: CH.id, due_at: '2026-09-18T03:59:00.000Z' });
ok(classifyIncoming(inc({ title: 'Problem Set 4' }), [filed]).verdict === 'KNOWN', 'correctly filed is KNOWN');

// A MOVE must not fire on a coincidence. Two courses can both have "Homework 3".
const other = mkItem({ id: 'x3', title: 'Homework 3', class_id: BIO.id, due_at: '2026-10-01T03:59:00.000Z' });
ok(classifyIncoming(inc({ title: 'Homework 5', due_at: '2026-09-18T03:59:00.000Z' }), [other]).verdict === 'NEW',
   'different numbers never move');
ok(classifyIncoming(inc({ title: 'Reading response', due_at: '2026-10-01T03:59:00.000Z' }), [other]).verdict === 'NEW',
   'a shared due date alone is not enough to move something');

// Ambiguity is safety: if two courses both hold something that matches, do nothing.
const twoStrays = [
  mkItem({ id: 'y1', title: 'Problem Set 4', class_id: BIO.id, due_at: '2026-09-18T03:59:00.000Z' }),
  mkItem({ id: 'y2', title: 'Problem Set 4', class_id: MA.id, due_at: '2026-09-18T03:59:00.000Z' }),
];
ok(classifyIncoming(inc({ title: 'Problem Set 4' }), twoStrays).verdict === 'NEW',
   'two possible strays means no automatic move');

// ── duplicates that exist regardless of any upload ───────────────────────
const dupes = findDuplicates([
  mkItem({ id: 'd1', title: 'Lab safety module', class_id: BIO.id, due_at: '2026-09-20T18:00:00.000Z' }),
  mkItem({ id: 'd2', title: 'Lab safety module', class_id: MA.id, due_at: '2026-09-20T18:00:00.000Z' }),
  mkItem({ id: 'd3', title: 'Lab safety module', class_id: CH.id, due_at: '2026-11-02T18:00:00.000Z' }),
  mkItem({ id: 'd4', title: 'Reading response', class_id: CH.id, due_at: '2026-09-20T18:00:00.000Z' }),
]);
ok(dupes.length === 1, `one duplicate pair found, not ${dupes.length}`);
ok(dupes[0].kind === 'DUPLICATE', 'reported as a duplicate');
ok(['d1', 'd2'].includes(dupes[0].item.id), 'naming one of the pair');
ok(findDuplicates([mkItem({ id: 'a', title: 'Essay', class_id: CH.id }), mkItem({ id: 'b', title: 'Essay', class_id: BIO.id })]).length === 0,
   'undated items are not called duplicates on the strength of a shared title');

// ── the whole pass, through processExtraction ────────────────────────────
const sem: Semester = { id: 's', name: 'Fall 2026', start_date: '2026-08-19', end_date: '2026-12-11' };
const world = (items: Item[]): AppData => ({
  semester: sem, holidays: [], classes: CLASSES, components: [], items, sources: [], scores: [],
  settings: { gemini_key: '', gemini_model: '', ics_token: '', sound_on: true, free_min_weekday: 240, free_min_weekend: 420 },
});

// an item with no course code at all lands on the course the document is about
const p1 = processExtraction({
  detected_class_code: 'CH 221',
  items: [
    { class_code: '', type: 'assignment', title: 'Problem Set 7', due_date: '2026-10-09', due_time: '23:59', at_home: true, confidence: 'high' },
    { class_code: 'CH 221', type: 'assignment', title: 'Problem Set 8', due_date: '2026-10-16', due_time: '23:59', at_home: true, confidence: 'high' },
  ],
}, world([]));
eq(p1.cards.map(c => c.incoming.class_id), [CH.id, CH.id], 'an uncoded item follows the document, instead of falling into LIFE');
ok(/this document is about/.test(p1.cards[0].classNote ?? ''), `and says why: ${p1.cards[0].classNote}`);
ok(!p1.cards[1].classNote, 'an item that matched cleanly needs no explanation');

// a code that matches nothing also follows the document, and says so
const p2 = processExtraction({
  detected_class_code: 'CH 221',
  items: [{ class_code: 'CHM-2210', type: 'assignment', title: 'Problem Set 9', due_date: '2026-10-23', due_time: '23:59', at_home: true, confidence: 'high' }],
}, world([]));
ok(p2.cards[0].incoming.class_id === CH.id, 'an unrecognised code falls back to the document class');
ok(/CHM-2210/.test(p2.cards[0].classNote ?? ''), 'the original code is quoted so you can check it');
ok(p2.cards[0].rawCode === 'CHM-2210', 'the raw code is kept for the picker');

// with no document class either, it stays unassigned rather than guessing
const p3 = processExtraction({
  detected_class_code: '',
  items: [{ class_code: 'HIST 101', type: 'assignment', title: 'Essay', due_date: '2026-10-23', due_time: '23:59', at_home: true, confidence: 'high' }],
}, world([]));
ok(p3.cards[0].incoming.class_id === null, 'nothing to fall back to means nothing is guessed');

// ── the cross-check produces corrections ─────────────────────────────────
const p4 = processExtraction({
  detected_class_code: 'CH 221',
  items: [
    { class_code: 'CH 221', type: 'assignment', title: 'Problem Set 4', due_date: '2026-09-18', due_time: '23:59', at_home: true, confidence: 'high' },
  ],
}, world([
  mkItem({ id: 'm1', title: 'Problem Set 4', class_id: BIO.id, due_at: '2026-09-19T03:59:00.000Z' }),
  mkItem({ id: 'm2', title: 'Midterm 1', class_id: CH.id, type: 'exam', at_home: false, due_at: '2026-10-07T13:35:00.000Z' }),
  mkItem({ id: 'm3', title: 'Study: Midterm 1 (T−3)', class_id: CH.id, type: 'study', due_at: '2026-10-04T22:00:00.000Z' }),
  mkItem({ id: 'm4', title: 'Homework 3', class_id: BIO.id, due_at: '2026-10-01T03:59:00.000Z' }),
]));

const reassign = p4.corrections.filter(c => c.kind === 'REASSIGN');
ok(reassign.length === 1, `one reassignment proposed (${reassign.length})`);
ok(reassign[0].item.id === 'm1', 'naming the misfiled item');
ok(reassign[0].toClassId === CH.id, 'and where it should go');
ok(reassign[0].include, 'ticked by default — it is a correction, not a suggestion');
ok(/BIO 183/.test(reassign[0].reason) && /CH 221/.test(reassign[0].reason), `the reason names both courses: ${reassign[0].reason}`);

const orphans = p4.corrections.filter(c => c.kind === 'ORPHAN');
ok(orphans.some(o => o.item.id === 'm2'), 'a CH 221 item the syllabus never mentions is surfaced');
ok(!orphans.some(o => o.item.id === 'm3'), 'study blocks the planner made are not called orphans');
ok(!orphans.some(o => o.item.id === 'm4'), 'items on other courses are not this document’s business');
ok(orphans.every(o => !o.include), 'orphans are off by default — plenty comes from Moodle');

// the card itself is a MOVE, so committing relocates rather than duplicates
ok(p4.cards[0].verdict === 'MOVE', 'the incoming row is a MOVE');
ok(p4.cards[0].fromClassId === BIO.id, 'and knows where it came from');

// nothing wrong → nothing to fix
const clean = processExtraction({
  detected_class_code: 'CH 221',
  items: [{ class_code: 'CH 221', type: 'assignment', title: 'Problem Set 4', due_date: '2026-09-18', due_time: '23:59', at_home: true, confidence: 'high' }],
}, world([mkItem({ id: 'c1', title: 'Problem Set 4', class_id: CH.id, due_at: '2026-09-19T03:59:00.000Z' })]));
ok(clean.corrections.filter(c => c.kind !== 'ORPHAN').length === 0, 'a tidy database proposes no changes');
ok(clean.cards[0].verdict === 'KNOWN', 'and the item is simply already known');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
