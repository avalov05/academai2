// ── Planning engine: forecasts, collisions, study blocks, panic, integrity ─
import type { AppData, Item, Occurrence } from './types';
import { DEFAULT_EFFORT, itemImpact } from './types';
import { addDaysStr, daysBetween, etEndOfDay, todayEt, utcToEtDate, weekStart, etWeekday, fmtEt } from './time';
import { expandAll } from './recurrence';

export function effortOf(it: Item): number {
  return it.effort_min > 0 ? it.effort_min : DEFAULT_EFFORT[it.type] ?? 60;
}

export function isActive(it: Item): boolean {
  return it.status === 'pending' && !it.ghost;
}
export function isOverdue(it: Item, now: Date): boolean {
  return isActive(it) && !!it.due_at && new Date(it.due_at).getTime() < now.getTime();
}

// ── Weekly load forecast ──────────────────────────────────────────────────
export interface WeekLoad {
  weekOf: string;            // Monday YYYY-MM-DD
  label: string;
  dueCount: number;
  effortMin: number;         // work due that week
  classMin: number;          // seat time that week
  capacityMin: number;       // free capacity estimate
  ratio: number;             // effort / capacity
  hell: boolean;
  exams: Item[];
}

export function weeklyForecast(data: AppData, now: Date, weeks = 8): WeekLoad[] {
  if (!data.semester) return [];
  const start = weekStart(todayEt(now));
  const out: WeekLoad[] = [];
  const occs = expandAll(data.components, data.semester, data.holidays,
    start, addDaysStr(start, weeks * 7));
  for (let w = 0; w < weeks; w++) {
    const ws = addDaysStr(start, w * 7);
    const we = addDaysStr(ws, 6);
    if (data.semester && ws > data.semester.end_date) break;
    const due = data.items.filter(it =>
      (isActive(it) || (it.ghost && it.status === 'pending')) && it.due_at
      && utcToEtDate(new Date(it.due_at)) >= ws && utcToEtDate(new Date(it.due_at)) <= we);
    const effortMin = due.reduce((a, it) => a + effortOf(it), 0);
    const classMin = occs.filter(o => o.date >= ws && o.date <= we)
      .reduce((a, o) => a + (o.end.getTime() - o.start.getTime()) / 60000, 0);
    let capacityMin = 0;
    for (let d = 0; d < 7; d++) {
      const wd = etWeekday(addDaysStr(ws, d));
      capacityMin += (wd === 0 || wd === 6) ? data.settings.free_min_weekend : data.settings.free_min_weekday;
    }
    capacityMin = Math.max(60, capacityMin - classMin * 0.0); // seat time already excluded from free estimate
    const ratio = effortMin / capacityMin;
    out.push({
      weekOf: ws,
      label: w === 0 ? 'THIS WK' : w === 1 ? 'NEXT WK' : fmtEt(etEndOfDay(ws), 'MMM d').toUpperCase(),
      dueCount: due.length, effortMin, classMin, capacityMin, ratio,
      hell: ratio > 0.65 || due.filter(i => i.type === 'exam').length >= 2,
      exams: due.filter(i => i.type === 'exam'),
    });
  }
  return out;
}

// ── Ghost proposals: study blocks + start dates ───────────────────────────
export interface Proposal {
  kind: 'study' | 'start';
  item: Partial<Item> & { title: string; type: Item['type'] };
  reason: string;
  forItem: Item;
}

export function proposeGhosts(data: AppData, now: Date): Proposal[] {
  const props: Proposal[] = [];
  const today = todayEt(now);
  const active = data.items.filter(isActive);
  // 1) Study blocks 5/3/1 days before exams & in-class quizzes worth studying
  const examLike = active.filter(it => (it.type === 'exam' || (it.type === 'quiz' && !it.at_home)) && it.due_at);
  for (const ex of examLike) {
    const dueDate = utcToEtDate(new Date(ex.due_at!));
    const existingChildren = data.items.filter(i => i.parent_id === ex.id && i.status !== 'dropped');
    const offsets = ex.type === 'exam' ? [5, 3, 1] : [2, 1];
    const minutes = ex.type === 'exam' ? Math.round(60 + 90 * itemImpact(ex)) : 45;
    for (const off of offsets) {
      const d = addDaysStr(dueDate, -off);
      if (d < today) continue;
      if (existingChildren.some(c => c.due_at && utcToEtDate(new Date(c.due_at)) === d)) continue;
      props.push({
        kind: 'study',
        forItem: ex,
        reason: `T−${off}d before ${ex.title}`,
        item: {
          class_id: ex.class_id, type: 'study',
          title: `Study: ${ex.title} (T−${off})`,
          details: ex.details ? `Covers: ${ex.details.slice(0, 140)}` : '',
          due_at: etEndOfDay(d).toISOString(), all_day: true, at_home: true,
          effort_min: minutes, parent_id: ex.id,
        },
      });
    }
  }
  // 2) Start dates for chunky work
  for (const it of active) {
    if (!it.due_at || it.type === 'exam' || it.type === 'study') continue;
    const eff = effortOf(it);
    if (eff < 90) continue;
    if (it.start_suggested_at) continue;
    const dueDate = utcToEtDate(new Date(it.due_at));
    const daysNeeded = Math.ceil(eff / 90) ; // ≈90 focused min/day on one thing
    const startDate = addDaysStr(dueDate, -Math.max(1, daysNeeded));
    if (startDate < today) continue;
    if (daysBetween(today, startDate) > 21) continue;
    props.push({
      kind: 'start', forItem: it,
      reason: `${Math.round(eff / 60 * 10) / 10}h of work → start ${daysNeeded}d early`,
      item: { title: it.title, type: it.type },
    });
  }
  return props;
}

// ── Panic button ──────────────────────────────────────────────────────────
export interface PanicPick { item: Item; minutes: number; score: number; why: string; }

export function panicPlan(data: AppData, now: Date, freeMinutes: number): PanicPick[] {
  const picks: PanicPick[] = [];
  let left = freeMinutes;
  const active = data.items.filter(it => isActive(it) && it.type !== 'social')
    .filter(it => it.due_at)
    // Sit-down events (in-class exams/quizzes) aren't work you can do in a free
    // window — their study blocks are. Zero-effort items also divided to
    // Infinity in the score below and monopolised the top slots.
    .filter(it => effortOf(it) > 0);
  const scored = active.map(it => {
    const ms = new Date(it.due_at!).getTime() - now.getTime();
    const days = Math.max(-1, ms / 86400000);
    const urgency = days < 0 ? 3 : 1 / Math.max(0.15, Math.min(days, 14) / 2 + 0.2);
    const impact = itemImpact(it);
    const eff = effortOf(it);
    const score = (urgency * impact * 100) / Math.sqrt(Math.max(15, eff));
    const why = days < 0 ? 'OVERDUE — stop the bleeding'
      : days < 1 ? 'due within 24h'
      : days < 3 ? `due in ${Math.ceil(days)}d, high value per minute`
      : 'best value for this window';
    return { it, score, eff, why };
  }).sort((a, b) => b.score - a.score);
  for (const s of scored) {
    if (left <= 10) break;
    const take = Math.min(s.eff, left);
    picks.push({ item: s.it, minutes: take, score: s.score, why: s.why });
    left -= take;
    if (picks.length >= 6) break;
  }
  return picks;
}

// ── Integrity meter ───────────────────────────────────────────────────────
export interface Integrity {
  onTime: number; late: number; missed: number; total: number;
  streakDays: number;         // days since last miss (or semester start)
  pct: number;                // on-time %
}

export function integrity(data: AppData, now: Date): Integrity {
  const done = data.items.filter(i => i.status === 'done' && !i.ghost && i.type !== 'study');
  const onTime = done.filter(i => !i.due_at || !i.completed_at
    || new Date(i.completed_at).getTime() <= new Date(i.due_at).getTime() + 5 * 60000).length;
  const late = done.length - onTime;
  const missedItems = data.items.filter(i => i.status === 'missed');
  const missed = missedItems.length;
  const total = done.length + missed;
  const semStart = data.semester?.start_date ?? todayEt(now);
  let lastMiss = semStart;
  for (const m of missedItems) {
    const d = m.due_at ? utcToEtDate(new Date(m.due_at)) : utcToEtDate(new Date(m.updated_at));
    if (d > lastMiss) lastMiss = d;
  }
  const streakDays = Math.max(0, daysBetween(lastMiss, todayEt(now)));
  return { onTime, late, missed, total, streakDays, pct: total ? Math.round(100 * onTime / total) : 100 };
}

// ── Today briefing helpers ────────────────────────────────────────────────
export interface Briefing {
  meetings: Occurrence[];
  dueToday: Item[];
  overdue: Item[];
  upcoming: Item[]; // next 72h after today
}

export function briefing(data: AppData, now: Date): Briefing {
  const today = todayEt(now);
  const meetings = data.semester
    ? expandAll(data.components, data.semester, data.holidays, today, today)
    : [];
  const act = data.items.filter(isActive);
  const dueToday = act.filter(i => i.due_at && utcToEtDate(new Date(i.due_at)) === today)
    .sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1));
  const overdue = act.filter(i => isOverdue(i, now) && utcToEtDate(new Date(i.due_at!)) !== today);
  const in3d = addDaysStr(today, 3);
  const upcoming = act.filter(i => i.due_at
    && utcToEtDate(new Date(i.due_at)) > today && utcToEtDate(new Date(i.due_at)) <= in3d)
    .sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1));
  return { meetings, dueToday, overdue, upcoming };
}
