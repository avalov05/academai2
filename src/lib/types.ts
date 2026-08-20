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
  interval: 1 | 2;        // weekly | biweekly
  anchor_date: string;    // YYYY-MM-DD — a date in an "on" week (biweekly parity)
  start_date: string;     // '' → semester start
  end_date: string;       // '' → semester end
  skip_dates: string[];   // YYYY-MM-DD cancellations
  extra_dates: string[];  // YYYY-MM-DD one-off additions
  leave_by_min: number;   // walk-time alarm lead, minutes
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
