// ── What reaches the phone, and exactly once ─────────────────────────────
const { planPushes, respectQuietHours, QUIET_END } = await import('../src/lib/push');
const { etToUtc, fmtEt } = await import('../src/lib/time');
import type { AppData, Item, Klass, Semester } from '../src/lib/types';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const sem: Semester = { id: 's', name: 'Fall 2026', start_date: '2026-08-19', end_date: '2026-12-11' };
const ch: Klass = { id: 'k1', semester_id: 's', code: 'CH 221', name: 'Organic Chemistry I', color: '#E4566E', grading: [], target_pct: 93, notes: '', created_at: '' };
const mk = (p: Partial<Item> & { id: string; title: string }): Item => ({
  class_id: 'k1', type: 'assignment', details: '', due_at: null, all_day: false, at_home: true,
  bucket: null, weight_pct: null, effort_min: 0, status: 'pending', ghost: false, parent_id: null,
  start_suggested_at: null, completed_at: null, source_id: null, created_at: '', updated_at: '', ...p,
});
const world = (items: Item[]): AppData => ({
  semester: sem, holidays: [], classes: [ch], components: [], items, sources: [], scores: [],
  settings: { gemini_key: '', gemini_model: '', ics_token: '', sound_on: true, free_min_weekday: 240, free_min_weekend: 420 },
});
const et = (d: string, t: string) => etToUtc(d, t);
const keysIn = (data: AppData, from: Date, to: Date) => planPushes(data, from, to).map(p => p.key);

// ── quiet hours ───────────────────────────────────────────────────────────
ok(fmtEt(respectQuietHours(et('2026-09-15', '03:00')), 'yyyy-MM-dd HH') === '2026-09-15 07', 'a 3am reminder waits for 7am');
ok(fmtEt(respectQuietHours(et('2026-09-15', '23:30')), 'yyyy-MM-dd HH') === '2026-09-16 07', 'a 23:30 reminder waits for the next morning');
ok(respectQuietHours(et('2026-09-15', '14:00')).getTime() === et('2026-09-15', '14:00').getTime(), 'daytime is left alone');
ok(Number(fmtEt(respectQuietHours(et('2026-09-15', '06:59')), 'H')) === QUIET_END, 'the boundary resolves to 07:00');

// ── an assignment gets warned about twice, then chased once ───────────────
const hw = mk({ id: 'a1', title: 'Problem Set 4', due_at: et('2026-09-18', '23:59').toISOString(), effort_min: 150 });
const wide = planPushes(world([hw]), et('2026-09-10', '00:00'), et('2026-09-25', '00:00'));
const hwKeys = wide.filter(p => p.key.startsWith('a1:')).map(p => p.key);
eq(hwKeys.sort(), ['a1:h24', 'a1:h3', 'a1:late'], 'assignment stages');

const h24 = wide.find(p => p.key === 'a1:h24')!;
// 23:59 minus 24h is 23:59 the day before — inside quiet hours, so it moves
ok(fmtEt(h24.at, 'yyyy-MM-dd HH:mm') === '2026-09-18 07:00', `24h warning moved out of the night (got ${fmtEt(h24.at, 'yyyy-MM-dd HH:mm')})`);
ok(h24.at.getTime() < new Date(hw.due_at!).getTime(), 'and still lands before the deadline');
ok(/CH 221/.test(h24.title) && /Problem Set 4/.test(h24.title), `title carries class and item: ${h24.title}`);
ok(/Due in/.test(h24.body), `body says how long is left: ${h24.body}`);

const late = wide.find(p => p.key === 'a1:late')!;
ok(/Overdue/.test(late.title) && late.urgent, 'the overdue chase is marked urgent');

// ── an exam gets three, further out ───────────────────────────────────────
const exam = mk({ id: 'e1', title: 'Midterm 1', type: 'exam', at_home: false, due_at: et('2026-10-07', '09:35').toISOString() });
const ex = planPushes(world([exam]), et('2026-10-01', '00:00'), et('2026-10-08', '00:00'));
eq(ex.filter(p => p.key.startsWith('e1:')).map(p => p.key).sort(), ['e1:h2', 'e1:h24', 'e1:h48', 'e1:late'], 'exam stages');
ok(ex.filter(p => p.key.startsWith('e1:') && p.key !== 'e1:late').every(p => p.urgent), 'every exam warning is urgent');
const h2 = ex.find(p => p.key === 'e1:h2')!;
ok(fmtEt(h2.at, 'HH:mm') === '07:35', `the 2h warning lands at 07:35 (got ${fmtEt(h2.at, 'HH:mm')})`);

// an in-class quiz is treated as a sit-down thing, not homework
const quiz = mk({ id: 'q1', title: 'Quiz 3', type: 'quiz', at_home: false, due_at: et('2026-10-09', '09:35').toISOString() });
eq(planPushes(world([quiz]), et('2026-10-01', '00:00'), et('2026-10-10', '00:00')).filter(p => p.key.startsWith('q1:')).map(p => p.key).sort(),
   ['q1:h2', 'q1:h24', 'q1:h48', 'q1:late'], 'in-class quiz is treated like an exam');

// ── a study block only gets a nudge as it starts ──────────────────────────
const study = mk({ id: 's1', title: 'Study: Midterm 1 (T−3)', type: 'study', due_at: et('2026-10-04', '18:00').toISOString(), effort_min: 90 });
const st = planPushes(world([study]), et('2026-10-04', '00:00'), et('2026-10-05', '00:00'));
eq(st.filter(p => p.key.startsWith('s1:')).map(p => p.key), ['s1:start', 's1:late'], 'study block stages');
const startPush = st.find(p => p.key === 's1:start')!;
ok(fmtEt(startPush.at, 'HH:mm') === '17:45', `study nudge is 15 minutes ahead (got ${fmtEt(startPush.at, 'HH:mm')})`);

// ── the window is exclusive at the start, inclusive at the end ────────────
// so consecutive runs can never send the same thing twice, nor skip one
const boundary = startPush.at;
ok(!keysIn(world([study]), boundary, new Date(boundary.getTime() + 60000)).includes('s1:start'), 'a moment already sent is not resent');
ok(keysIn(world([study]), new Date(boundary.getTime() - 60000), boundary).includes('s1:start'), 'and it is not skipped either');

// running the whole span in one go, or minute by minute, gives the same set
const from = et('2026-10-03', '00:00'), to = et('2026-10-05', '12:00');
const oneShot = new Set(keysIn(world([study, exam]), from, to));
const stepped = new Set<string>();
for (let t = from.getTime(); t < to.getTime(); t += 37 * 60000) {
  for (const k of keysIn(world([study, exam]), new Date(t), new Date(Math.min(t + 37 * 60000, to.getTime())))) stepped.add(k);
}
eq([...stepped].sort(), [...oneShot].sort(), 'chunked runs produce exactly the same notifications');

// ── nothing is sent about things that are finished, dropped or proposed ───
const quiet = world([
  mk({ id: 'd1', title: 'Done', status: 'done', due_at: et('2026-09-18', '12:00').toISOString() }),
  mk({ id: 'g1', title: 'Proposed', ghost: true, due_at: et('2026-09-18', '12:00').toISOString() }),
  mk({ id: 'n1', title: 'No date' }),
]);
ok(planPushes(quiet, et('2026-09-01', '00:00'), et('2026-09-30', '00:00')).every(p => p.key.startsWith('digest:')),
   'finished, proposed and undated items generate nothing but the digest');

// ── the daily digest ──────────────────────────────────────────────────────
const day = world([
  mk({ id: 't1', title: 'Reading response', due_at: et('2026-09-18', '23:59').toISOString() }),
  mk({ id: 't2', title: 'Lab report', due_at: et('2026-09-18', '17:00').toISOString() }),
  mk({ id: 'o1', title: 'Old thing', due_at: et('2026-09-14', '23:59').toISOString() }),
  exam,
]);
const dg = planPushes(day, et('2026-09-18', '07:00'), et('2026-09-18', '09:00')).find(p => p.key === 'digest:2026-09-18')!;
ok(!!dg, 'a digest goes out in the morning');
ok(fmtEt(dg.at, 'HH:mm') === '08:00', 'at 08:00');
ok(/1 overdue/.test(dg.body) && /2 due today/.test(dg.body), `digest counts: ${dg.body.replace(/\n/g, ' | ')}`);
ok(/Lab report/.test(dg.body), 'digest names what is first up');
ok(/overdue/i.test(dg.title), 'digest title leads with the overdue count');
ok(planPushes(day, et('2026-09-18', '07:00'), et('2026-09-20', '09:00')).filter(p => p.key.startsWith('digest:')).length === 3,
   'one digest per day in the window');

// ── the evening sweep ─────────────────────────────────────────────────────
const sw = planPushes(day, et('2026-09-17', '19:00'), et('2026-09-17', '21:00')).find(p => p.key.startsWith('sweep:'));
ok(!!sw, 'an evening sweep goes out when something is due within 24h');
ok(fmtEt(sw!.at, 'HH:mm') === '20:00', 'at 20:00');
ok(/due within 24 hours|overdue/.test(sw!.title), `sweep title: ${sw!.title}`);
const calm = world([mk({ id: 'far', title: 'Next month', due_at: et('2026-10-20', '12:00').toISOString() })]);
ok(!planPushes(calm, et('2026-09-17', '19:00'), et('2026-09-17', '21:00')).some(p => p.key.startsWith('sweep:')),
   'no sweep on a night with nothing near');

// ── keys are unique, so the log can be the dedupe guarantee ───────────────
const all = planPushes(day, et('2026-09-01', '00:00'), et('2026-10-31', '00:00'));
ok(new Set(all.map(p => p.key)).size === all.length, 'every planned notification has a distinct key');
ok(all.every(p => p.title.length > 0 && p.title.length <= 90), 'titles are present and phone-sized');
ok(all.every(p => p.tag.length > 0), 'everything is taggable so old ones collapse');
ok(all.every((p, i, a) => i === 0 || a[i - 1].at.getTime() <= p.at.getTime()), 'output is in time order');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
