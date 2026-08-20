// ── Intake processing: Gemini JSON → reviewable, committable payload ──────
import type { AppData, ClassComponent, ComponentKind, GradeBucket, ItemType, Klass } from './types';
import { classifyIncoming, type Classified, type IncomingItem } from './dedupe';
import { addDaysStr, etToUtc, etEndOfDay, etWeekday, todayEt } from './time';
import { nextColor } from './palette';

const DAY_NUM: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export interface RawExtraction {
  detected_class_code?: string;
  classes?: Array<{
    code?: string; name?: string;
    components?: Array<{
      kind?: string; title?: string; location?: string; is_async?: boolean;
      days?: string[]; start_time?: string; end_time?: string; biweekly?: boolean;
      first_date?: string; notes?: string;
    }>;
    grading?: Array<{ name?: string; weight_pct?: number; drops?: number }>;
  }>;
  items?: Array<{
    class_code?: string; type?: string; title?: string; due_date?: string; due_time?: string;
    at_home?: boolean; bucket?: string; weight_pct?: number; effort_min_guess?: number;
    details?: string; confidence?: string;
    recurrence?: { freq?: string; day?: string; first_date?: string; until?: string };
  }>;
  holidays?: Array<{ date?: string; name?: string }>;
  coverage_notes?: string[];
}

export interface NewClassDraft {
  code: string; name: string; color: string;
  grading: GradeBucket[];
  components: Array<Omit<ClassComponent, 'id' | 'class_id'>>;
  include: boolean;
}

export interface ReviewCard {
  key: string;
  verdict: 'NEW' | 'UPDATE' | 'KNOWN';
  include: boolean;
  incoming: IncomingItem;
  existingId?: string;
  changes?: string[];
  assumption?: string;   // e.g. "assumed 23:59", "expanded from weekly pattern"
  classCode: string;     // display
  confidence: string;
}

export interface ReviewPayload {
  cards: ReviewCard[];
  newClasses: NewClassDraft[];
  holidays: Array<{ date: string; name: string; include: boolean }>;
  coverage: string[];
  detectedClassId: string | null;
}

const VALID_TYPES = new Set(['assignment', 'quiz', 'exam', 'project', 'reading', 'task', 'social', 'admin']);
const VALID_KINDS = new Set(['LEC', 'REC', 'LAB', 'SEM', 'STU', 'OTH']);

function normCode(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, ''); }

export function matchClass(code: string, classes: Klass[]): Klass | null {
  if (!code) return null;
  const n = normCode(code);
  if (!n) return null;
  return classes.find(c => normCode(c.code) === n)
    ?? classes.find(c => normCode(c.code).includes(n) || n.includes(normCode(c.code)))
    ?? null;
}

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string | undefined): s is string => !!s && /^\d{2}:\d{2}$/.test(s);

/** first date ≥ from that falls on weekday wd */
function nextWeekday(from: string, wd: number): string {
  let d = from;
  for (let i = 0; i < 7; i++) { if (etWeekday(d) === wd) return d; d = addDaysStr(d, 1); }
  return from;
}

export function processExtraction(raw: RawExtraction, data: AppData): ReviewPayload {
  const semStart = data.semester?.start_date ?? todayEt();
  const semEnd = data.semester?.end_date ?? addDaysStr(todayEt(), 112);
  const usedColors = data.classes.map(c => c.color);

  // 1) new classes
  const newClasses: NewClassDraft[] = [];
  for (const rc of raw.classes ?? []) {
    if (!rc.code && !rc.name) continue;
    const code = (rc.code || rc.name || '').trim();
    if (matchClass(code, data.classes)) continue; // exists → skip (components not overwritten)
    const color = nextColor([...usedColors, ...newClasses.map(n => n.color)]);
    const comps: NewClassDraft['components'] = [];
    for (const c of rc.components ?? []) {
      const kind = (VALID_KINDS.has(c.kind ?? '') ? c.kind : 'LEC') as ComponentKind;
      const days = (c.days ?? []).map(d => DAY_NUM[d ?? '']).filter(n => n != null);
      comps.push({
        kind, title: c.title ?? '', location: c.location ?? '',
        is_async: !!c.is_async || (days.length === 0 && !c.start_time),
        days,
        start_time: isTime(c.start_time) ? c.start_time : '',
        end_time: isTime(c.end_time) ? c.end_time : '',
        interval: c.biweekly ? 2 : 1,
        anchor_date: isDate(c.first_date) ? c.first_date : semStart,
        start_date: '', end_date: '', skip_dates: [], extra_dates: [],
        leave_by_min: 12,
      });
    }
    if (comps.length === 0) comps.push({
      kind: 'LEC', title: '', location: '', is_async: true, days: [], start_time: '', end_time: '',
      interval: 1, anchor_date: semStart, start_date: '', end_date: '', skip_dates: [], extra_dates: [], leave_by_min: 12,
    });
    newClasses.push({
      code, name: rc.name ?? code, color,
      grading: (rc.grading ?? []).filter(g => g.name && g.weight_pct != null)
        .map(g => ({ name: g.name!, weight_pct: g.weight_pct!, drops: g.drops || 0 })),
      components: comps, include: true,
    });
  }

  // 2) items (expand recurrences, resolve classes, classify)
  const cards: ReviewCard[] = [];
  let key = 0;
  const compsByClass = new Map<string, ClassComponent[]>();
  for (const c of data.components) {
    compsByClass.set(c.class_id, [...(compsByClass.get(c.class_id) ?? []), c]);
  }

  for (const ri of raw.items ?? []) {
    if (!ri.title) continue;
    const type = (VALID_TYPES.has(ri.type ?? '') ? ri.type : 'task') as ItemType;
    const cls = matchClass(ri.class_code ?? '', data.classes);
    const isNewClass = !cls && !!newClasses.find(n => normCode(n.code) === normCode(ri.class_code ?? ''));
    const classId = cls?.id ?? null;
    const classCode = cls?.code ?? (isNewClass ? (ri.class_code ?? '').trim() : (ri.class_code || 'LIFE'));

    const instances: Array<{ date: string; assumption?: string; suffix?: string }> = [];
    if (ri.recurrence?.freq && ri.recurrence.day && DAY_NUM[ri.recurrence.day] != null) {
      const wd = DAY_NUM[ri.recurrence.day];
      const first = isDate(ri.recurrence.first_date) ? ri.recurrence.first_date : nextWeekday(semStart, wd);
      const until = isDate(ri.recurrence.until) ? ri.recurrence.until : semEnd;
      const step = ri.recurrence.freq === 'BIWEEKLY' ? 14 : 7;
      let d = nextWeekday(first, wd);
      while (d <= until) {
        instances.push({ date: d, suffix: ` — ${d.slice(5).replace('-', '/')}`, assumption: `expanded from ${ri.recurrence.freq?.toLowerCase()} pattern` });
        d = addDaysStr(d, step);
      }
    } else if (isDate(ri.due_date)) {
      instances.push({ date: ri.due_date });
    } else {
      instances.push({ date: '' }); // undated → flag
    }

    for (const inst of instances) {
      let due_at: string | null = null;
      let all_day = true;
      let assumption = inst.assumption ?? '';
      if (inst.date) {
        if (isTime(ri.due_time)) { due_at = etToUtc(inst.date, ri.due_time).toISOString(); all_day = false; }
        else if (ri.at_home === false) {
          // in-class: try the class's primary meeting time
          const comps = classId ? (compsByClass.get(classId) ?? []) : [];
          const lec = comps.find(c => c.kind === 'LEC' && c.start_time) ?? comps.find(c => c.start_time);
          if (lec) { due_at = etToUtc(inst.date, lec.start_time).toISOString(); all_day = false; assumption = (assumption ? assumption + ' · ' : '') + `assumed ${lec.kind} time ${lec.start_time}`; }
          else { due_at = etEndOfDay(inst.date).toISOString(); assumption = (assumption ? assumption + ' · ' : '') + 'in-class, time unknown'; }
        } else {
          due_at = etEndOfDay(inst.date).toISOString();
          assumption = (assumption ? assumption + ' · ' : '') + 'no time stated → 23:59';
        }
      } else {
        assumption = 'NO DATE FOUND — set one before committing';
      }
      const incoming: IncomingItem = {
        class_id: classId, type,
        title: instances.length > 1 ? `${ri.title}${inst.suffix ?? ''}` : ri.title,
        due_at, all_day,
        details: ri.details ?? '',
        at_home: ri.at_home !== false,
        bucket: ri.bucket || null,
        weight_pct: ri.weight_pct && ri.weight_pct > 0 ? ri.weight_pct : null,
        effort_min: Math.max(0, Math.round(ri.effort_min_guess ?? 0)),
      };
      const cls2: Classified<IncomingItem> = classId !== null || !isNewClass
        ? classifyIncoming(incoming, data.items)
        : { verdict: 'NEW', incoming };
      cards.push({
        key: String(key++),
        verdict: cls2.verdict,
        include: cls2.verdict !== 'KNOWN' && !!due_at,
        incoming,
        existingId: cls2.existing?.id,
        changes: cls2.changes,
        assumption: assumption || undefined,
        classCode,
        confidence: ri.confidence ?? 'medium',
      });
    }
  }

  // 3) holidays
  const knownHol = new Set(data.holidays.map(h => h.date));
  const holidays = (raw.holidays ?? [])
    .filter(h => isDate(h.date))
    .map(h => ({ date: h.date!, name: h.name ?? 'No class', include: !knownHol.has(h.date!) }));

  return {
    cards, newClasses, holidays,
    coverage: raw.coverage_notes ?? [],
    detectedClassId: matchClass(raw.detected_class_code ?? '', data.classes)?.id ?? null,
  };
}
