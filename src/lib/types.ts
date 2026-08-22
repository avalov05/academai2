// ── AcademAI domain types ────────────────────────────────────────────────
export type ComponentKind = 'LEC' | 'REC' | 'LAB' | 'SEM' | 'STU' | 'OTH';
export type ItemType =
  | 'assignment' | 'quiz' | 'exam' | 'project' | 'reading'
  | 'study' | 'task' | 'social' | 'admin';
export type ItemStatus = 'pending' | 'done' | 'missed' | 'dropped';

export const ITEM_TYPES: ItemType[] = [
  'assignment', 'quiz', 'exam', 'project', 'reading', 'study', 'task', 'social', 'admin',
];
export const COMPONENT_KINDS: ComponentKind[] = ['LEC', 'REC', 'LAB', 'SEM', 'STU', 'OTH'];
export const KIND_LABEL: Record<ComponentKind, string> = {
  LEC: 'Lecture', REC: 'Recitation', LAB: 'Lab', SEM: 'Seminar', STU: 'Studio', OTH: 'Other',
};

export interface Semester {
  id: string;
  name: string;
  start_date: string; // YYYY-MM-DD (ET)
  end_date: string;   // YYYY-MM-DD (ET)
}

export interface Holiday {
  id: string;
  semester_id: string;
  date: string; // YYYY-MM-DD
  name: string;
}

export interface GradeBucket {
  name: string;        // "Homework", "Midterm 1", "Final Exam"
  weight_pct: number;  // 0..100
  drops?: number;      // lowest N dropped
}

export interface Klass {
  id: string;
  semester_id: string;
  code: string;   // "CH 221"
  name: string;   // "Organic Chemistry I"
  color: string;  // hex, auto-assigned
  grading: GradeBucket[];
  target_pct: number; // % needed for the A (default 93)
  notes: string;
  created_at: string;
}

export interface ClassComponent {
  id: string;
  class_id: string;
  kind: ComponentKind;
  title: string;          // "Section 002"
  location: string;
  is_async: boolean;
  days: number[];         // 0=Sun..6=Sat (ET weekdays)
  start_time: string;     // "HH:MM" ET ('' if async)
  end_time: string;
  interval: number;       // 1 weekly, 2 every other week, 3/4 every Nth week
  anchor_date: string;    // YYYY-MM-DD — a date in an "on" week (parity anchor)
  start_date: string;     // '' → semester start
  end_date: string;       // '' → semester end
  skip_dates: string[];   // YYYY-MM-DD cancellations
  extra_dates: string[];  // YYYY-MM-DD one-off additions
  leave_by_min: number;   // walk-time alarm lead, minutes
}

/**
 * A component whose meetings are an explicit list rather than a pattern:
 * `days` empty, every meeting in `extra_dates`. Labs and recitations are very
 * often like this, and treating them as weekly is the single worst thing this
 * app can do — it hides the weeks that actually matter.
 */
export function isDateList(c: ClassComponent): boolean {
  return !c.is_async && c.days.length === 0 && c.extra_dates.length > 0;
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EVERY: Record<number, string> = { 2: 'Every other', 3: 'Every 3rd', 4: 'Every 4th' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-16" → "Sep 16" — dates in a summary line should read, not decode. */
const pretty = (d: string) => `${MON[Number(d.slice(5, 7)) - 1] ?? d.slice(5, 7)} ${Number(d.slice(8, 10))}`;

/** Human sentence for a meeting pattern — used everywhere a pattern is shown. */
export function describePattern(c: ClassComponent): string {
  if (c.is_async) return 'Async — no meetings';
  if (isDateList(c)) return `${c.extra_dates.length} listed dates${c.start_time ? ` · ${c.start_time}–${c.end_time}` : ''}`;
  if (!c.days.length) return 'No days set';
  const days = c.days.map(d => DAY_ABBR[d]).join('/');
  const every = c.interval > 1 ? `${EVERY[c.interval] ?? `Every ${c.interval}th`} ` : '';
  const time = c.start_time ? ` · ${c.start_time}–${c.end_time}` : '';
  const win = c.start_date && c.end_date ? ` · ${pretty(c.start_date)}–${pretty(c.end_date)}`
    : c.start_date ? ` · from ${pretty(c.start_date)}`
    : c.end_date ? ` · until ${pretty(c.end_date)}` : '';
  const skips = c.skip_dates.length ? ` · ${c.skip_dates.length} cancelled` : '';
  return `${every}${days}${time}${win}${skips}`;
}

export interface Item {
  id: string;
  class_id: string | null;
  type: ItemType;
  title: string;
  details: string;
  due_at: string | null;   // ISO UTC
  all_day: boolean;        // due "that day" (23:59 ET semantics)
  at_home: boolean;        // take-home quiz/exam
  bucket: string | null;   // grading bucket name
  weight_pct: number | null; // this single item's share of final grade, if known
  effort_min: number;      // estimated effort
  status: ItemStatus;
  ghost: boolean;          // AI proposal awaiting acceptance
  parent_id: string | null; // study blocks → their exam
  start_suggested_at: string | null; // ISO — planner's proposed start
  completed_at: string | null;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: string;
  class_id: string | null;
  kind: 'syllabus' | 'screenshot' | 'email' | 'text' | 'manual';
  raw_text: string;
  image_count: number;
  summary: string;
  created_at: string;
}

export interface Score {
  id: string;
  class_id: string;
  item_id: string | null;
  bucket: string;
  earned: number;
  possible: number;
  note: string;
  graded_at: string;
}

export interface Settings {
  gemini_key: string;
  gemini_model: string;
  ics_token: string;
  sound_on: boolean;
  free_min_weekday: number; // planning capacity
  free_min_weekend: number;
  push_enabled?: boolean;
  push_last_run_at?: string | null;
}

export interface AppData {
  semester: Semester | null;
  holidays: Holiday[];
  classes: Klass[];
  components: ClassComponent[];
  items: Item[];
  sources: Source[];
  scores: Score[];
  settings: Settings;
}

// One concrete meeting of a component on a date
export interface Occurrence {
  component_id: string;
  class_id: string;
  date: string;      // YYYY-MM-DD ET
  start: Date;       // UTC instant
  end: Date;
  leaveBy: Date;
}

/**
 * One urgency scale, used by the radar, the tables and the header so that
 * "this is about to hurt you" looks the same everywhere.
 *
 * The thresholds are deliberately asymmetric: the gap between 72h and 24h is
 * where planning still works, and everything under 24h is the band where a
 * missed item is usually unrecoverable.
 */
export type Urgency = 'overdue' | 'critical' | 'danger' | 'soon' | 'normal';

export const DANGER_HOURS = 24;
export const CRITICAL_HOURS = 6;
export const SOON_HOURS = 72;

export function urgencyFromHours(hours: number): Urgency {
  if (hours <= 0) return 'overdue';
  if (hours <= CRITICAL_HOURS) return 'critical';
  if (hours <= DANGER_HOURS) return 'danger';
  if (hours <= SOON_HOURS) return 'soon';
  return 'normal';
}

export function hoursUntil(due: string | null | undefined, now: Date): number {
  if (!due) return Infinity;
  return (new Date(due).getTime() - now.getTime()) / 3600000;
}

export function urgencyOf(it: Pick<Item, 'due_at' | 'ghost' | 'status'>, now: Date): Urgency {
  if (it.ghost || it.status !== 'pending') return 'normal';
  return urgencyFromHours(hoursUntil(it.due_at, now));
}

/** true for anything the radar draws inside the danger band */
export const inDangerZone = (u: Urgency) => u === 'overdue' || u === 'critical' || u === 'danger';

export const URGENCY: Record<Urgency, { ink: string; line: string; wash: string; label: string }> = {
  overdue:  { ink: '#A8241C', line: '#E0555F', wash: 'rgba(224,85,95,0.16)',  label: 'OVERDUE' },
  critical: { ink: '#B8352C', line: '#E0555F', wash: 'rgba(224,85,95,0.11)',  label: 'HOURS LEFT' },
  danger:   { ink: '#8C4A12', line: '#E08A3C', wash: 'rgba(224,138,60,0.11)', label: 'UNDER 24H' },
  soon:     { ink: '#63635f', line: '#c9c9c0', wash: 'transparent',           label: 'THIS WEEK' },
  normal:   { ink: '#63635f', line: '#dedcd4', wash: 'transparent',           label: '' },
};

export const DEFAULT_EFFORT: Record<ItemType, number> = {
  assignment: 120, quiz: 45, exam: 0, project: 300, reading: 60,
  study: 90, task: 30, social: 15, admin: 20,
};

// How much an item "can hurt you" 0..1 — drives radar blip size & panic ranking
export function itemImpact(it: Item): number {
  if (it.weight_pct != null && it.weight_pct > 0) return Math.min(1, 0.25 + it.weight_pct / 25);
  const base: Record<ItemType, number> = {
    exam: 0.95, project: 0.8, assignment: 0.6, quiz: 0.55, reading: 0.3,
    study: 0.4, task: 0.35, social: 0.3, admin: 0.25,
  };
  return base[it.type] ?? 0.4;
}
