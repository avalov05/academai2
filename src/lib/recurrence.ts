// ── Recurrence engine: components → concrete meetings ────────────────────
import type { ClassComponent, Holiday, Occurrence, Semester } from './types';
import { addDaysStr, dateRange, daysBetween, etToUtc, etWeekday } from './time';

/**
 * Expand a component into concrete occurrences between clamp dates.
 * Handles: weekly / biweekly (parity vs anchor week), per-component date
 * windows, holiday + skip cancellations, extra one-off dates, async (none).
 */
export function expandComponent(
  c: ClassComponent,
  semester: Semester,
  holidays: Holiday[],
  clampStart?: string,
  clampEnd?: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  if (!c.start_time || !c.end_time) return outWithExtras(c, out); // async → only extras (rare)
  const holidaySet = new Set(holidays.map(h => h.date));
  const skip = new Set(c.skip_dates);
  const from = max3(c.start_date || semester.start_date, semester.start_date, clampStart);
  const to = min3(c.end_date || semester.end_date, semester.end_date, clampEnd);
  if (from > to) return out;

  const anchor = c.anchor_date || c.start_date || semester.start_date;
  const anchorWeekIndex = weekIndexOf(anchor);

  // days empty + explicit dates = "meets only on these dates" (handled by
  // outWithExtras below). Never fabricate a weekly pattern to fill that in.
  const step = Math.max(1, Math.min(6, Math.round(c.interval || 1)));
  if (!c.is_async && c.days.length > 0) {
    for (const date of dateRange(from, to)) {
      if (!c.days.includes(etWeekday(date))) continue;
      if (step > 1 && mod(weekIndexOf(date) - anchorWeekIndex, step) !== 0) continue;
      if (holidaySet.has(date) || skip.has(date)) continue;
      out.push(makeOcc(c, date));
    }
  }
  return outWithExtras(c, out, from, to, holidaySet, skip);
}

function outWithExtras(
  c: ClassComponent, out: Occurrence[],
  from?: string, to?: string,
  holidaySet?: Set<string>, skip?: Set<string>,
): Occurrence[] {
  for (const date of c.extra_dates) {
    if (from && date < from) continue;
    if (to && date > to) continue;
    if (skip?.has(date)) continue;
    if (holidaySet?.has(date)) continue;
    if (out.some(o => o.date === date)) continue;
    if (c.start_time && c.end_time) out.push(makeOcc(c, date));
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

function makeOcc(c: ClassComponent, date: string): Occurrence {
  const start = etToUtc(date, c.start_time);
  const end = etToUtc(date, c.end_time);
  return {
    component_id: c.id,
    class_id: c.class_id,
    date, start, end,
    leaveBy: new Date(start.getTime() - (c.leave_by_min || 10) * 60000),
  };
}

/** true modulo — JS % keeps the sign of the dividend, which breaks parity
 * for any date before the anchor. */
function mod(a: number, n: number): number { return ((a % n) + n) % n; }

/** Monday-anchored absolute week index (for every-Nth-week parity). */
function weekIndexOf(date: string): number {
  const wd = etWeekday(date);
  const mondayOffset = wd === 0 ? 6 : wd - 1;
  const monday = addDaysStr(date, -mondayOffset);
  return Math.floor(daysBetween('2020-01-06', monday) / 7); // 2020-01-06 is a Monday
}

function max3(a: string, b: string, c?: string): string {
  let m = a > b ? a : b;
  if (c && c > m) m = c;
  return m;
}
function min3(a: string, b: string, c?: string): string {
  let m = a < b ? a : b;
  if (c && c < m) m = c;
  return m;
}

/** All occurrences for all components, sorted. */
export function expandAll(
  components: ClassComponent[],
  semester: Semester,
  holidays: Holiday[],
  clampStart?: string,
  clampEnd?: string,
): Occurrence[] {
  const all = components.flatMap(c => expandComponent(c, semester, holidays, clampStart, clampEnd));
  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  return all;
}
