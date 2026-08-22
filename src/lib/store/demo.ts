// ── Demo store: seeded in-memory data for dev/screenshots ────────────────
import type { AppData, ClassComponent, Holiday, Item, ItemType, Klass, Score, Semester, Settings, Source } from '../types';
import type { Store } from './index';
import { uid } from './index';
import { addDaysStr, etEndOfDay, etToUtc, todayEt } from '../time';

function mkItem(p: Partial<Item> & { title: string; type: ItemType }): Item {
  const now = new Date().toISOString();
  return {
    id: uid(), class_id: null, details: '', due_at: null, all_day: true, at_home: true,
    bucket: null, weight_pct: null, effort_min: 0, status: 'pending', ghost: false,
    parent_id: null, start_suggested_at: null, completed_at: null, source_id: null,
    created_at: now, updated_at: now, ...p,
  };
}

function seed(): AppData {
  const today = todayEt();
  const semStart = addDaysStr(today, -2);
  const semEnd = addDaysStr(today, 108);
  const semester: Semester = { id: uid(), name: 'Fall 2026', start_date: semStart, end_date: semEnd };
  const holidays: Holiday[] = [
    { id: uid(), semester_id: semester.id, date: addDaysStr(today, 40), name: 'Fall Break' },
    { id: uid(), semester_id: semester.id, date: addDaysStr(today, 41), name: 'Fall Break' },
  ];
  const ch: Klass = {
    id: uid(), semester_id: semester.id, code: 'CH 221', name: 'Organic Chemistry I',
    color: '#E4566E', target_pct: 93, notes: '', created_at: new Date().toISOString(),
    grading: [
      { name: 'Problem Sets', weight_pct: 20, drops: 1 },
      { name: 'Quizzes', weight_pct: 15, drops: 1 },
      { name: 'Midterm 1', weight_pct: 15 }, { name: 'Midterm 2', weight_pct: 15 },
      { name: 'Final Exam', weight_pct: 25 }, { name: 'Lab', weight_pct: 10 },
    ],
  };
  const bio: Klass = {
    id: uid(), semester_id: semester.id, code: 'BIO 183', name: 'Intro Biology: Cellular & Molecular',
    color: '#4A72EE', target_pct: 93, notes: '', created_at: new Date().toISOString(),
    grading: [
      { name: 'Homework', weight_pct: 25 }, { name: 'Exams', weight_pct: 45 },
      { name: 'Final', weight_pct: 20 }, { name: 'Participation', weight_pct: 10 },
    ],
  };
  const phi: Klass = {
    id: uid(), semester_id: semester.id, code: 'PHI 205', name: 'Bioethics (Async)',
    color: '#8763DE', target_pct: 93, notes: 'Fully asynchronous', created_at: new Date().toISOString(),
    grading: [
      { name: 'Discussion Posts', weight_pct: 30 }, { name: 'Papers', weight_pct: 50 },
      { name: 'Final Reflection', weight_pct: 20 },
    ],
  };
  const mth: Klass = {
    id: uid(), semester_id: semester.id, code: 'MA 242', name: 'Calculus III',
    color: '#1F9E96', target_pct: 93, notes: '', created_at: new Date().toISOString(),
    grading: [
      { name: 'WebAssign', weight_pct: 15 }, { name: 'Quizzes', weight_pct: 10 },
      { name: 'Tests', weight_pct: 45 }, { name: 'Final', weight_pct: 30 },
    ],
  };
  const comp = (class_id: string, kind: ClassComponent['kind'], days: number[], st: string, en: string, loc: string, extra?: Partial<ClassComponent>): ClassComponent => ({
    id: uid(), class_id, kind, title: '', location: loc, is_async: false, days,
    start_time: st, end_time: en, interval: 1, anchor_date: semStart,
    start_date: '', end_date: '', skip_dates: [], extra_dates: [], leave_by_min: 12, ...extra,
  });
  const components: ClassComponent[] = [
    comp(ch.id, 'LEC', [1, 3, 5], '09:35', '10:25', 'Dabney 210'),
    // labs start in week 2 and run every other week — the pattern that used to
    // get flattened into "every Tuesday"
    comp(ch.id, 'LAB', [2], '13:30', '16:15', 'Cox B12', {
      interval: 2, leave_by_min: 18, start_date: addDaysStr(semStart, 7),
    }),
    comp(bio.id, 'LEC', [2, 4], '11:45', '13:00', 'Bostian 3712'),
    // recitation meets only on the dates printed in the syllabus
    comp(bio.id, 'REC', [], '14:00', '14:50', 'Bostian 2722', {
      extra_dates: [3, 17, 31, 45, 59, 73].map(n => addDaysStr(today, n)),
    }),
    comp(phi.id, 'LEC', [], '', '', '', { is_async: true }),
    comp(mth.id, 'LEC', [1, 3, 5], '13:55', '14:45', 'SAS 2203'),
  ];
  const d = (offset: number, time?: string) =>
    time ? etToUtc(addDaysStr(today, offset), time).toISOString() : etEndOfDay(addDaysStr(today, offset)).toISOString();
  // clock-relative, so the danger-zone states are the same whatever hour the
  // demo is opened at
  const inHours = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
  const items: Item[] = [
    mkItem({ class_id: ch.id, type: 'assignment', title: 'Problem Set 2', bucket: 'Problem Sets', due_at: d(-1, '23:59'), all_day: false, effort_min: 150, details: 'Ch. 3 stereochemistry' }),
    mkItem({ class_id: mth.id, type: 'assignment', title: 'WebAssign 4.5 — Series', bucket: 'WebAssign', due_at: inHours(3.2), all_day: false, effort_min: 70, details: 'Ratio and root tests' }),
    mkItem({ class_id: bio.id, type: 'assignment', title: 'Lab safety module', bucket: 'Homework', due_at: inHours(17), all_day: false, effort_min: 45, details: 'Must pass before Thursday lab' }),
    mkItem({ class_id: ch.id, type: 'assignment', title: 'Problem Set 3', bucket: 'Problem Sets', due_at: d(5, '23:59'), all_day: false, effort_min: 150, details: 'Ch. 4 alkenes' }),
    mkItem({ class_id: ch.id, type: 'quiz', title: 'Quiz 2 (in-class)', bucket: 'Quizzes', due_at: d(2, '09:35'), all_day: false, at_home: false, effort_min: 0 }),
    mkItem({ class_id: ch.id, type: 'exam', title: 'Midterm 1', bucket: 'Midterm 1', weight_pct: 15, due_at: d(12, '09:35'), all_day: false, at_home: false, details: 'Ch. 1–5', effort_min: 0 }),
    mkItem({ class_id: ch.id, type: 'assignment', title: 'Pre-lab: Distillation', bucket: 'Lab', due_at: d(4, '13:30'), all_day: false, effort_min: 40 }),
    mkItem({ class_id: bio.id, type: 'assignment', title: 'Homework 3 — Cell Membranes', bucket: 'Homework', due_at: d(1, '23:59'), all_day: false, effort_min: 90 }),
    mkItem({ class_id: bio.id, type: 'reading', title: 'Read Ch. 7 before lecture', due_at: d(3, '11:45'), all_day: false, effort_min: 50 }),
    mkItem({ class_id: bio.id, type: 'exam', title: 'Exam 1', bucket: 'Exams', due_at: d(16, '11:45'), all_day: false, at_home: false, details: 'Units 1–3', effort_min: 0 }),
    mkItem({ class_id: phi.id, type: 'task', title: 'Discussion post: Autonomy', bucket: 'Discussion Posts', due_at: d(2, '23:59'), all_day: false, effort_min: 45 }),
    mkItem({ class_id: phi.id, type: 'project', title: 'Paper 1: Informed Consent (draft)', bucket: 'Papers', due_at: d(9, '23:59'), all_day: false, effort_min: 300 }),
    mkItem({ class_id: mth.id, type: 'assignment', title: 'WebAssign 4.2–4.4', bucket: 'WebAssign', due_at: d(1, '22:00'), all_day: false, effort_min: 75 }),
    mkItem({ class_id: mth.id, type: 'quiz', title: 'Quiz 3 (take-home)', bucket: 'Quizzes', due_at: d(6, '23:59'), all_day: false, at_home: true, effort_min: 45 }),
    mkItem({ class_id: mth.id, type: 'exam', title: 'Test 1', bucket: 'Tests', due_at: d(19, '13:55'), all_day: false, at_home: false, effort_min: 0 }),
    mkItem({ type: 'social', title: "Call Mom — her birthday", due_at: d(3) }),
    mkItem({ type: 'admin', title: 'Submit MCAT fee assistance form', due_at: d(7), effort_min: 30 }),
    mkItem({ type: 'task', title: 'Pick up lab coat from bookstore', due_at: d(2), effort_min: 20 }),
    mkItem({ type: 'social', title: 'Reply to Dr. Chen re: research hours', due_at: d(1), effort_min: 15 }),
    // completed history for integrity meter
    mkItem({ class_id: ch.id, type: 'assignment', title: 'Problem Set 1', bucket: 'Problem Sets', due_at: d(-8, '23:59'), status: 'done', completed_at: d(-8, '20:11') }),
    mkItem({ class_id: bio.id, type: 'assignment', title: 'Homework 1', bucket: 'Homework', due_at: d(-10, '23:59'), status: 'done', completed_at: d(-10, '22:40') }),
    mkItem({ class_id: bio.id, type: 'assignment', title: 'Homework 2', bucket: 'Homework', due_at: d(-4, '23:59'), status: 'done', completed_at: d(-4, '19:02') }),
    mkItem({ class_id: mth.id, type: 'quiz', title: 'Quiz 1', bucket: 'Quizzes', due_at: d(-6, '23:59'), status: 'done', completed_at: d(-6, '23:10') }),
    mkItem({ class_id: phi.id, type: 'task', title: 'Discussion post: Intro', bucket: 'Discussion Posts', due_at: d(-5, '23:59'), status: 'done', completed_at: d(-5, '18:30') }),
  ];
  const scores: Score[] = [
    { id: uid(), class_id: ch.id, item_id: null, bucket: 'Problem Sets', earned: 46, possible: 50, note: 'PS1', graded_at: d(-6) },
    { id: uid(), class_id: ch.id, item_id: null, bucket: 'Quizzes', earned: 9, possible: 10, note: 'Q1', graded_at: d(-4) },
    { id: uid(), class_id: bio.id, item_id: null, bucket: 'Homework', earned: 19, possible: 20, note: 'HW1', graded_at: d(-7) },
    { id: uid(), class_id: bio.id, item_id: null, bucket: 'Homework', earned: 20, possible: 20, note: 'HW2', graded_at: d(-2) },
    { id: uid(), class_id: mth.id, item_id: null, bucket: 'Quizzes', earned: 8.5, possible: 10, note: 'Q1', graded_at: d(-3) },
    { id: uid(), class_id: phi.id, item_id: null, bucket: 'Discussion Posts', earned: 10, possible: 10, note: 'Intro post', graded_at: d(-3) },
  ];
  const settings: Settings = {
    gemini_key: '', gemini_model: 'gemini-3.7-flash', ics_token: 'demo-token',
    sound_on: true, free_min_weekday: 240, free_min_weekend: 420,
  };
  return { semester, holidays, classes: [ch, bio, phi, mth], components, items, sources: [], scores, settings };
}

const EMPTY: AppData = { semester: null, holidays: [], classes: [], components: [], items: [], sources: [], scores: [], settings: { gemini_key: '', gemini_model: 'gemini-3.7-flash', ics_token: 'demo-token', sound_on: true, free_min_weekday: 240, free_min_weekend: 420 } };

export class DemoStore implements Store {
  private data: AppData = process.env.NEXT_PUBLIC_EMPTY === '1' ? JSON.parse(JSON.stringify(EMPTY)) : seed();
  async load(): Promise<AppData> { return JSON.parse(JSON.stringify(this.data)); }
  async upsertSemester(s: Semester) { this.data.semester = s; }
  async insertHolidays(hs: Holiday[]) { this.data.holidays.push(...hs); }
  async deleteHoliday(id: string) { this.data.holidays = this.data.holidays.filter(h => h.id !== id); }
  async insertClass(k: Klass) { this.data.classes.push(k); }
  async updateClass(id: string, p: Partial<Klass>) { Object.assign(this.data.classes.find(c => c.id === id) ?? {}, p); }
  async deleteClass(id: string) {
    this.data.classes = this.data.classes.filter(c => c.id !== id);
    this.data.components = this.data.components.filter(c => c.class_id !== id);
    this.data.items = this.data.items.filter(i => i.class_id !== id);
  }
  async insertComponents(cs: ClassComponent[]) { this.data.components.push(...cs); }
  async updateComponent(id: string, p: Partial<ClassComponent>) { Object.assign(this.data.components.find(c => c.id === id) ?? {}, p); }
  async deleteComponent(id: string) { this.data.components = this.data.components.filter(c => c.id !== id); }
  async insertItems(its: Item[]) { this.data.items.push(...its); }
  async updateItem(id: string, p: Partial<Item>) { Object.assign(this.data.items.find(i => i.id === id) ?? {}, p); }
  async deleteItem(id: string) { this.data.items = this.data.items.filter(i => i.id !== id); }
  async insertSource(s: Source) { this.data.sources.push(s); }
  async insertScore(s: Score) { this.data.scores.push(s); }
  async deleteScore(id: string) { this.data.scores = this.data.scores.filter(s => s.id !== id); }
  async saveSettings(p: Partial<Settings>) { Object.assign(this.data.settings, p); }
}
