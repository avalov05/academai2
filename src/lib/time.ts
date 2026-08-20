// ── Timezone-safe helpers. All wall times are America/New_York. ──────────
import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { addDays as dfAddDays } from 'date-fns';

export const TZ = 'America/New_York';

/** ET wall date+time → UTC instant. time "HH:MM"; date "YYYY-MM-DD". */
export function etToUtc(date: string, time: string): Date {
  return fromZonedTime(`${date}T${time.length === 5 ? time + ':00' : time}`, TZ);
}

/** End-of-day ET (23:59) for all-day dues. */
export function etEndOfDay(date: string): Date {
  return etToUtc(date, '23:59');
}

/** UTC instant → ET calendar date "YYYY-MM-DD". */
export function utcToEtDate(d: Date): string {
  return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
}

export function fmtEt(d: Date, fmt: string): string {
  return formatInTimeZone(d, TZ, fmt);
}

/** Today's ET date string. */
export function todayEt(now: Date = new Date()): string {
  return utcToEtDate(now);
}

/** ET weekday 0=Sun..6=Sat for a date string. */
export function etWeekday(date: string): number {
  // noon avoids DST edges
  const zoned = toZonedTime(etToUtc(date, '12:00'), TZ);
  return zoned.getDay();
}

/** date string + n days (calendar arithmetic, TZ-independent). */
export function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = dfAddDays(new Date(Date.UTC(y, m - 1, d, 12)), n);
  return dt.toISOString().slice(0, 10);
}

/** Whole days between two date strings (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

export function* dateRange(start: string, end: string): Generator<string> {
  let cur = start;
  while (cur <= end) { yield cur; cur = addDaysStr(cur, 1); }
}

/** Human "time until" for radar/table. Negative = overdue. */
export function humanDelta(ms: number): string {
  const neg = ms < 0; const abs = Math.abs(ms);
  const m = Math.floor(abs / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  let s: string;
  if (d >= 2) s = `${d}d`;
  else if (h >= 1) s = `${h}h ${m % 60}m`;
  else s = `${m}m`;
  return neg ? `${s} OVER` : s;
}

/** Monday-anchored ET week start for a date string. */
export function weekStart(date: string): string {
  const wd = etWeekday(date); // 0 Sun..6 Sat
  const back = wd === 0 ? 6 : wd - 1;
  return addDaysStr(date, -back);
}
