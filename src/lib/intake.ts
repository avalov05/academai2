// ── Intake processing: Gemini JSON → reviewable, committable payload ──────
import type { AppData, ClassComponent, ComponentKind, GradeBucket, Item, ItemType, Klass } from './types';
import { classifyIncoming, dice, findDuplicates, sameIdentity, type Classified, type IncomingItem, type Verdict } from './dedupe';
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
      every_n_weeks?: number; first_date?: string; meeting_dates?: string[];
      skip_dates?: string[]; start_date?: string; end_date?: string;
      meeting_count_stated?: number; notes?: string;
    }>;
    grading?: Array<{ name?: string; weight_pct?: number; drops?: number }>;
  }>;
  items?: Array<{
    class_code?: string; type?: string; title?: string; due_date?: string; due_time?: string;
    at_home?: boolean; bucket?: string; weight_pct?: number; effort_min_guess?: number;
    details?: string; confidence?: string;
    recurrence?: {
      freq?: string; day?: string; first_date?: string; until?: string;
      dates?: string[]; skip_dates?: string[];
    };
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
  verdict: Verdict;
  include: boolean;
  incoming: IncomingItem;
  existingId?: string;
  changes?: string[];
  assumption?: string;   // e.g. "assumed 23:59", "expanded from weekly pattern"
  classCode: string;     // display
  confidence: string;
  /** MOVE only: where the existing copy is filed today */
  fromClassId?: string | null;
  /** why this row landed on this class, shown when it was not obvious */
  classNote?: string;
  /** the extractor's raw code, so the picker can explain itself */
  rawCode?: string;
}

export interface CorrectionCard {
  key: string;
  kind: 'REASSIGN' | 'DUPLICATE' | 'ORPHAN';
  include: boolean;
  item: Item;
  toClassId?: string | null;
  otherId?: string;
  reason: string;
  detail: string;
}

export interface ReviewPayload {
  cards: ReviewCard[];
  newClasses: NewClassDraft[];
  holidays: Array<{ date: string; name: string; include: boolean }>;
  coverage: string[];
  detectedClassId: string | null;
  /** proposed fixes to things already tracked */
  corrections: CorrectionCard[];
}

const VALID_TYPES = new Set(['assignment', 'quiz', 'exam', 'project', 'reading', 'task', 'social', 'admin']);
const VALID_KINDS = new Set(['LEC', 'REC', 'LAB', 'SEM', 'STU', 'OTH']);

export function normCode(s: string): string { return s.toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/** "CH 221" → {CH, 221}; "242" → {"", 242}; "BIOCHEM" → {BIOCHEM, ""} */
function splitCode(s: string): { dept: string; num: string } {
  const t = s.toUpperCase().trim();
  const m = t.match(/^([A-Z]{1,6})\s*[-_ ]?\s*(\d{2,4})\b/);
  if (m) return { dept: m[1], num: m[2] };
  const numOnly = t.match(/^(\d{2,4})$/);
  if (numOnly) return { dept: '', num: numOnly[1] };
  return { dept: normCode(s), num: '' };
}

export interface ClassMatch {
  klass: Klass | null;
  /** 0..1 — how sure. Below CONFIDENT the caller should not file anything here. */
  score: number;
  /** two classes were equally plausible; guessing would be worse than asking */
  ambiguous: boolean;
  why: string;
}

const CONFIDENT = 0.72;

/** How well does one code/name refer to this class? 0 = not at all. */
function scoreClass(raw: string, k: Klass): { score: number; why: string } {
  const n = normCode(raw);
  if (!n) return { score: 0, why: '' };
  const kn = normCode(k.code);
  if (n === kn) return { score: 1, why: 'exact code match' };

  const a = splitCode(raw), b = splitCode(k.code);
  if (a.num && b.num) {
    // Different course numbers are different courses, full stop. This is the
    // guard that used to be missing: the old both-ways substring test was happy
    // to conflate "CH 221" with anything else containing "CH".
    if (a.num !== b.num) return { score: 0, why: '' };
    // number alone; unique-ness is enforced by the margin rule in resolveClass
    if (!a.dept) return { score: 0.75, why: 'course number matches' };
    if (a.dept === b.dept) return { score: 0.98, why: 'department and number match' };
    if (a.dept.startsWith(b.dept) || b.dept.startsWith(a.dept)) {
      return { score: 0.88, why: `number matches and "${a.dept}" abbreviates "${b.dept}"` };
    }
    return { score: 0.34, why: 'number matches but the department does not' };
  }

  // Only letters came through ("CHEM"). Again, ambiguity is caught by margin.
  if (a.dept && !a.num && b.dept
    && (a.dept === b.dept || a.dept.startsWith(b.dept) || b.dept.startsWith(a.dept))) {
    return { score: 0.76, why: 'department matches' };
  }

  // Fall back to the course *name* — models often return "Organic Chemistry"
  const nameScore = dice(raw.toLowerCase().trim(), k.name.toLowerCase().trim());
  if (nameScore >= 0.7) return { score: 0.6 + nameScore * 0.3, why: 'course name matches' };
  return { score: 0, why: '' };
}

/**
 * Which class does this code refer to? Returns *why*, and refuses to answer when
 * two classes are equally plausible.
 *
 * The old version fell back to a substring test in both directions, so a stray
 * "CH" matched PSYCH 101 and the first class in array order won ties silently.
 * Filing a deadline under the wrong course is worse than admitting uncertainty.
 */
export function resolveClass(raw: string, classes: Klass[]): ClassMatch {
  if (!raw || !raw.trim()) return { klass: null, score: 0, ambiguous: false, why: 'no code given' };
  const scored = classes
    .map(k => ({ k, ...scoreClass(raw, k) }))
    .filter(x => x.score > 0)
    .sort((x, y) => y.score - x.score);
  if (!scored.length) return { klass: null, score: 0, ambiguous: false, why: `no class matches "${raw}"` };
  const best = scored[0];
  const runnerUp = scored[1];
  if (runnerUp && best.score - runnerUp.score < 0.1) {
    return {
      klass: null, score: best.score, ambiguous: true,
      why: `"${raw}" could be ${best.k.code} or ${runnerUp.k.code}`,
    };
  }
  if (best.score < CONFIDENT) {
    return { klass: null, score: best.score, ambiguous: true, why: `"${raw}" is only a weak match for ${best.k.code}` };
  }
  return { klass: best.k, score: best.score, ambiguous: false, why: best.why };
}

/** Back-compat shim for callers that only want the class. */
export function matchClass(code: string, classes: Klass[]): Klass | null {
  return resolveClass(code, classes).klass;
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
      const listed = (c.meeting_dates ?? []).filter(isDate).sort();
      // an explicit date list wins outright: it is what the syllabus said, and
      // a weekday pattern alongside it would re-create the every-week bug
      const days = listed.length ? [] : (c.days ?? []).map(d => DAY_NUM[d ?? '']).filter(n => n != null);
      const every = Math.max(1, Math.min(6, Math.round(c.every_n_weeks ?? (c.biweekly ? 2 : 1))));
      comps.push({
        kind, title: c.title ?? '', location: c.location ?? '',
        is_async: !!c.is_async || (days.length === 0 && listed.length === 0 && !c.start_time),
        days,
        start_time: isTime(c.start_time) ? c.start_time : '',
        end_time: isTime(c.end_time) ? c.end_time : '',
        interval: listed.length ? 1 : every,
        anchor_date: isDate(c.first_date) ? c.first_date : (listed[0] ?? semStart),
        // a stated first meeting is also a start bound: "recitation begins the
        // second week" must not put a recitation in the first week
        start_date: isDate(c.start_date) ? c.start_date : (isDate(c.first_date) ? c.first_date : ''),
        end_date: isDate(c.end_date) ? c.end_date : '',
        skip_dates: (c.skip_dates ?? []).filter(isDate).sort(),
        extra_dates: listed,
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

  // A syllabus is about one course. When an item's own code is missing, wrong,
  // or ambiguous, that is the course it almost certainly belongs to — far
  // better than the old behaviour of quietly filing it under LIFE.
  const docClass = resolveClass(raw.detected_class_code ?? '', data.classes);
  const docNewClass = newClasses.length === 1 ? newClasses[0] : null;

  for (const ri of raw.items ?? []) {
    if (!ri.title) continue;
    const type = (VALID_TYPES.has(ri.type ?? '') ? ri.type : 'task') as ItemType;
    const rawCode = (ri.class_code ?? '').trim();
    const m = resolveClass(rawCode, data.classes);
    let cls = m.klass;
    let classNote = '';

    const newMatch = newClasses.find(n => normCode(n.code) === normCode(rawCode));
    let isNewClass = !cls && !!newMatch;

    if (!cls && !isNewClass) {
      // fall back to the document's own class
      if (docClass.klass) {
        cls = docClass.klass;
        classNote = rawCode
          ? `"${rawCode}" did not match a class — filed under ${cls.code} because that is what this document is about`
          : `no course code on this item — filed under ${cls.code} because that is what this document is about`;
      } else if (docNewClass) {
        isNewClass = true;
        classNote = rawCode
          ? `"${rawCode}" did not match a class — filed under the new ${docNewClass.code}`
          : `no course code on this item — filed under the new ${docNewClass.code}`;
      } else if (rawCode) {
        classNote = m.ambiguous
          ? `${m.why} — left unassigned so you can pick`
          : `"${rawCode}" does not match any class you have`;
      }
    } else if (m.ambiguous) {
      classNote = m.why;
    } else if (cls && m.score < 1) {
      classNote = `matched ${cls.code} — ${m.why}`;
    }

    const effectiveNewCode = isNewClass ? (newMatch?.code ?? docNewClass?.code ?? rawCode) : '';
    const classId = cls?.id ?? null;
    const classCode = cls?.code ?? (isNewClass ? effectiveNewCode : (rawCode || 'LIFE'));

    const instances: Array<{ date: string; assumption?: string; suffix?: string }> = [];
    const listedDates = (ri.recurrence?.dates ?? []).filter(isDate).sort();
    const recSkip = new Set((ri.recurrence?.skip_dates ?? []).filter(isDate));
    if (listedDates.length) {
      for (const d of listedDates) {
        if (recSkip.has(d)) continue;
        instances.push({ date: d, suffix: ` — ${d.slice(5).replace('-', '/')}`, assumption: 'date listed in the source' });
      }
    } else if (ri.recurrence?.freq && ri.recurrence.day && DAY_NUM[ri.recurrence.day] != null) {
      const wd = DAY_NUM[ri.recurrence.day];
      const first = isDate(ri.recurrence.first_date) ? ri.recurrence.first_date : nextWeekday(semStart, wd);
      const until = isDate(ri.recurrence.until) ? ri.recurrence.until : semEnd;
      const step = ri.recurrence.freq === 'BIWEEKLY' ? 14 : 7;
      let d = nextWeekday(first, wd);
      let guard = 0;
      while (d <= until && guard++ < 60) {
        if (!recSkip.has(d)) {
          instances.push({ date: d, suffix: ` — ${d.slice(5).replace('-', '/')}`, assumption: `expanded from ${ri.recurrence.freq?.toLowerCase()} pattern` });
        }
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
        fromClassId: cls2.fromClassId,
        assumption: assumption || undefined,
        classNote: classNote || undefined,
        rawCode: rawCode || undefined,
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

  // 4) corrections — what this document says about things already tracked
  const corrections = buildCorrections(cards, data, docClass.klass?.id ?? null);

  return {
    cards, newClasses, holidays, corrections,
    coverage: raw.coverage_notes ?? [],
    detectedClassId: docClass.klass?.id ?? null,
  };
}

/**
 * The cross-check. A syllabus is the authority on its own course, so an upload
 * is the right moment to ask: is anything already tracked filed wrongly, listed
 * twice, or sitting on this course without appearing in the document at all?
 */
function buildCorrections(cards: ReviewCard[], data: AppData, docClassId: string | null): CorrectionCard[] {
  const out: CorrectionCard[] = [];
  const byId = new Map(data.classes.map(c => [c.id, c]));
  const nameOf = (id: string | null | undefined) => (id ? byId.get(id)?.code ?? 'a deleted class' : 'LIFE');
  let k = 0;

  // (a) things this document proves are on the wrong course
  for (const c of cards) {
    if (c.verdict !== 'MOVE' || !c.existingId) continue;
    const ex = data.items.find(i => i.id === c.existingId);
    if (!ex) continue;
    out.push({
      key: `mv${k++}`, kind: 'REASSIGN', include: true, item: ex,
      toClassId: c.incoming.class_id,
      reason: `filed under ${nameOf(ex.class_id)}, but this document lists it under ${nameOf(c.incoming.class_id)}`,
      detail: (c.changes ?? []).join(' · '),
    });
  }

  // (b) standing duplicates across courses — visible without the document
  const seen = new Set(out.map(o => o.item.id));
  for (const d of findDuplicates(data.items)) {
    if (seen.has(d.item.id) || seen.has(d.other?.id ?? '')) continue;
    seen.add(d.item.id);
    out.push({
      key: `dup${k++}`, kind: 'DUPLICATE', include: false, item: d.item,
      otherId: d.other?.id,
      reason: `also tracked under ${nameOf(d.other?.class_id)} — probably one thing, not two`,
      detail: d.other ? `keep the ${nameOf(d.other.class_id)} copy, drop this one` : '',
    });
  }

  // (c) items on this course that the document never mentions. Not necessarily
  // wrong — plenty comes from Moodle — so this is informational and off by
  // default. It is still the thing that catches a deadline that got renamed.
  if (docClassId) {
    const mentioned = cards.filter(c => c.existingId).map(c => c.existingId);
    const incoming = cards.map(c => c.incoming);
    for (const ex of data.items) {
      if (ex.class_id !== docClassId || ex.ghost || ex.status !== 'pending') continue;
      if (mentioned.includes(ex.id)) continue;
      if (ex.type === 'study') continue;              // the planner made those
      if (incoming.some(inc => sameIdentity(inc, ex, true))) continue;
      if (seen.has(ex.id)) continue;
      out.push({
        key: `orp${k++}`, kind: 'ORPHAN', include: false, item: ex,
        reason: `on ${nameOf(docClassId)} but not in this syllabus`,
        detail: 'fine if it came from Moodle or an email — worth a look if you do not recognise it',
      });
    }
  }
  return out;
}
