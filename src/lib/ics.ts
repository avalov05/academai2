// ── ICS calendar feed (RFC 5545), America/New_York ───────────────────────
//
// Notes that matter for how this behaves in real calendar apps:
//
// • DTSTAMP must be UTC with a trailing Z. A TZID on DTSTAMP is invalid and
//   is exactly the kind of thing Google quietly drops events over.
// • Repeating meetings are emitted as ONE event with an RRULE, with holidays
//   as EXDATEs. That is what makes "every other Wednesday" show up in Apple
//   and Google as a real repeating event instead of forty loose copies.
// • Deadlines are TRANSP:TRANSPARENT so they do not paint the whole day busy;
//   meetings and study blocks are OPAQUE because they are real occupied time.
// • SEQUENCE comes from updated_at, so editing an item updates the event in
//   place on the next refresh instead of leaving a stale duplicate.
// • Google Calendar does not fire notifications for *subscribed* calendars,
//   whatever alarms the feed carries. Apple Calendar does. The Settings view
//   says so, and offers a downloadable copy to import into Google instead.
import type { AppData, ClassComponent, Item, Semester } from './types';
import { expandAll } from './recurrence';
import { fmtEt, addDaysStr, etToUtc } from './time';
import { isDateList } from './types';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const KIND_WORD: Record<string, string> = {
  LEC: 'Lecture', REC: 'Recitation', LAB: 'Lab', SEM: 'Seminar', STU: 'Studio', OTH: 'Meeting',
};
const TYPE_WORD: Record<string, string> = {
  assignment: 'Due', quiz: 'Quiz', exam: 'EXAM', project: 'Project due', reading: 'Read',
  study: 'Study', task: 'To do', social: '', admin: 'Admin',
};

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 folding: 75 *octets* per line, and never split a code point. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 74) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 74;
  for (const ch of line) {           // iterates code points, not UTF-16 units
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 74; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

const dtEt = (d: Date) => fmtEt(d, "yyyyMMdd'T'HHmmss");
const dtUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dtDate = (s: string) => s.replace(/-/g, '');

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'X-LIC-LOCATION:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'TZNAME:EDT',
  'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'TZNAME:EST',
  'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

/** that wall-clock time on that ET date, as a real instant */
const atTime = (date: string, hhmm: string): Date => etToUtc(date, hhmm);

/** a small, stable integer so calendars notice edits */
function seq(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 60000) % 2147483647 : 0;
}

export function buildIcs(data: AppData, opts: { appUrl?: string } = {}): string {
  const lines: string[] = [];
  const push = (l: string) => lines.push(fold(l));
  const stamp = dtUtc(new Date());
  const classById = new Map(data.classes.map(c => [c.id, c]));

  push('BEGIN:VCALENDAR');
  push('VERSION:2.0');
  push('PRODID:-//AcademAI//Mission Control//EN');
  push('CALSCALE:GREGORIAN');
  push('METHOD:PUBLISH');
  push(`X-WR-CALNAME:AcademAI${data.semester ? ` — ${data.semester.name}` : ''}`);
  push('X-WR-CALDESC:Every class meeting and every deadline AcademAI is tracking.');
  push('X-WR-TIMEZONE:America/New_York');
  push('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
  push('X-PUBLISHED-TTL:PT1H');
  lines.push(VTIMEZONE);

  // ── 1. class meetings ──
  if (data.semester) {
    for (const comp of data.components) {
      const k = classById.get(comp.class_id);
      if (!k || comp.is_async || !comp.start_time || !comp.end_time) continue;
      emitMeetings(push, comp, k.code, k.name, data, stamp, opts.appUrl);
    }
  }

  // ── 2. deadlines and accepted study blocks ──
  for (const it of data.items) {
    if (it.ghost || it.status === 'dropped' || it.status === 'done' || !it.due_at) continue;
    const k = it.class_id ? classById.get(it.class_id) : null;
    const due = new Date(it.due_at);
    const isStudy = it.type === 'study';
    const inClass = it.at_home === false;

    push('BEGIN:VEVENT');
    push(`UID:item-${it.id}@academai`);
    push(`DTSTAMP:${stamp}`);
    push(`SEQUENCE:${seq(it.updated_at)}`);
    if (it.created_at) push(`CREATED:${dtUtc(new Date(it.created_at))}`);
    if (it.updated_at) push(`LAST-MODIFIED:${dtUtc(new Date(it.updated_at))}`);

    if (it.all_day && !isStudy) {
      const d = fmtEt(due, 'yyyy-MM-dd');
      push(`DTSTART;VALUE=DATE:${dtDate(d)}`);
      push(`DTEND;VALUE=DATE:${dtDate(addDaysStr(d, 1))}`);
      push('TRANSP:TRANSPARENT');
    } else {
      // study blocks and in-class events occupy real time; a timed deadline
      // gets a short block so it is visible in the day view at the right hour
      const mins = isStudy ? Math.max(30, it.effort_min || 60) : inClass ? 60 : 30;
      push(`DTSTART;TZID=America/New_York:${dtEt(due)}`);
      push(`DTEND;TZID=America/New_York:${dtEt(new Date(due.getTime() + mins * 60000))}`);
      push(`TRANSP:${isStudy || inClass ? 'OPAQUE' : 'TRANSPARENT'}`);
    }

    // class code first: in a month cell you see "CH 221 · Problem…", not "⬖ ASSI…"
    const word = TYPE_WORD[it.type] ?? '';
    const head = k ? `${k.code} · ` : '';
    const tail = word && !inClass ? ` (${word.toLowerCase()})` : '';
    push(`SUMMARY:${esc(inClass ? `${head}${it.title}` : `${head}${it.title}${tail}`)}`);

    const desc: string[] = [];
    if (k) desc.push(k.name);
    if (it.details) desc.push(it.details);
    if (inClass) desc.push('Happens in class — you sit for this one.');
    if (it.bucket) desc.push(`Counts toward: ${it.bucket}${it.weight_pct ? ` (${it.weight_pct}% of the final grade)` : ''}`);
    if (it.effort_min > 0 && !isStudy) desc.push(`Estimated work: ${fmtMin(it.effort_min)}`);
    if (it.start_suggested_at) desc.push(`Start by: ${fmtEt(new Date(it.start_suggested_at), 'EEE MMM d')}`);
    desc.push('— AcademAI');
    push(`DESCRIPTION:${esc(desc.join('\n'))}`);
    if (opts.appUrl) push(`URL:${opts.appUrl}`);
    push(`CATEGORIES:${esc(k ? k.code : 'LIFE')},${esc(it.type.toUpperCase())}`);
    if (it.type === 'exam' || inClass) push('PRIORITY:1');

    for (const [trig, note] of alarmsFor(it)) {
      push('BEGIN:VALARM');
      push('ACTION:DISPLAY');
      push(`DESCRIPTION:${esc(`${k ? k.code + ' · ' : ''}${it.title} — ${note}`)}`);
      push(`TRIGGER:${trig}`);
      push('END:VALARM');
    }
    push('END:VEVENT');
  }

  push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function fmtMin(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Alarms that fire when they are useful, not at 3am the night something is due. */
function alarmsFor(it: Item): Array<[string, string]> {
  if (it.type === 'study') return [['-PT10M', 'study block starts']];
  if (it.all_day) {
    // DTSTART is midnight, so these land at 3pm the day before and 9am that day
    return [['-PT9H', 'due tomorrow'], ['PT9H', 'due tonight']];
  }
  if (it.type === 'exam' || it.at_home === false) {
    return [['-P2D', 'in two days'], ['-PT12H', 'tomorrow'], ['-PT45M', 'starts in 45 minutes']];
  }
  return [['-P1D', 'due tomorrow'], ['-PT3H', 'due in three hours']];
}

/** One VEVENT with an RRULE where the pattern allows, individual events where it does not. */
function emitMeetings(
  push: (l: string) => void,
  comp: ClassComponent,
  code: string, name: string,
  data: AppData, stamp: string, appUrl?: string,
) {
  const sem = data.semester as Semester;
  const title = `${code} ${KIND_WORD[comp.kind] ?? comp.kind}${comp.title ? ` · ${comp.title}` : ''}`;
  const alarm = (uidNote: string) => {
    push('BEGIN:VALARM');
    push('ACTION:DISPLAY');
    push(`DESCRIPTION:${esc(uidNote)}`);
    push(`TRIGGER:-PT${Math.max(1, comp.leave_by_min || 10)}M`);
    push('END:VALARM');
  };
  const common = () => {
    push(`SUMMARY:${esc(title)}`);
    if (comp.location) push(`LOCATION:${esc(comp.location)}`);
    const desc = [name];
    if (comp.location) desc.push(`Leave ${comp.leave_by_min || 10} minutes early for ${comp.location}.`);
    desc.push('— AcademAI');
    push(`DESCRIPTION:${esc(desc.join('\n'))}`);
    push(`CATEGORIES:${esc(code)},${esc(comp.kind)}`);
    push('TRANSP:OPAQUE');
    if (appUrl) push(`URL:${appUrl}`);
    alarm(`Leave for ${title} now`);
  };

  // explicit date list → one event per date, which is the honest shape
  if (isDateList(comp) || comp.days.length === 0) {
    const holidays = new Set(data.holidays.map(h => h.date));
    for (const date of comp.extra_dates) {
      if (holidays.has(date) || comp.skip_dates.includes(date)) continue;
      if (date < sem.start_date || date > sem.end_date) continue;
      push('BEGIN:VEVENT');
      push(`UID:${comp.id}-${date}@academai`);
      push(`DTSTAMP:${stamp}`);
      push('SEQUENCE:0');
      push(`DTSTART;TZID=America/New_York:${dtEt(atTime(date, comp.start_time))}`);
      push(`DTEND;TZID=America/New_York:${dtEt(atTime(date, comp.end_time))}`);
      common();
      push('END:VEVENT');
    }
    return;
  }

  // patterned → one recurring event, holidays and cancellations as EXDATEs
  const occs = expandAll([comp], sem, [], sem.start_date, sem.end_date);
  if (occs.length === 0) return;
  const first = occs[0];
  const last = occs[occs.length - 1];
  const cancelled = [
    ...data.holidays.map(h => h.date),
    ...comp.skip_dates,
  ].filter(d => occs.some(o => o.date === d));

  push('BEGIN:VEVENT');
  push(`UID:${comp.id}@academai`);
  push(`DTSTAMP:${stamp}`);
  push('SEQUENCE:0');
  push(`DTSTART;TZID=America/New_York:${dtEt(first.start)}`);
  push(`DTEND;TZID=America/New_York:${dtEt(first.end)}`);
  const days = [...comp.days].sort((a, b) => a - b).map(d => BYDAY[d]).join(',');
  const until = dtUtc(new Date(atTime(last.date, comp.end_time).getTime() + 86400000));
  const step = Math.max(1, Math.round(comp.interval || 1));
  push(`RRULE:FREQ=WEEKLY;INTERVAL=${step};BYDAY=${days};WKST=MO;UNTIL=${until}`);
  for (const d of cancelled) {
    push(`EXDATE;TZID=America/New_York:${dtEt(atTime(d, comp.start_time))}`);
  }
  common();
  push('END:VEVENT');
}

/** Every meeting AcademAI thinks exists, for the "does this look right?" check. */
export function meetingSummary(data: AppData): Array<{ label: string; count: number; first: string; last: string }> {
  if (!data.semester) return [];
  const classById = new Map(data.classes.map(c => [c.id, c]));
  const out: Array<{ label: string; count: number; first: string; last: string }> = [];
  for (const comp of data.components) {
    const k = classById.get(comp.class_id);
    if (!k || comp.is_async) continue;
    const occs = expandAll([comp], data.semester, data.holidays, data.semester.start_date, data.semester.end_date);
    out.push({
      label: `${k.code} ${comp.kind}${comp.title ? ` · ${comp.title}` : ''}`,
      count: occs.length,
      first: occs[0]?.date ?? '—',
      last: occs[occs.length - 1]?.date ?? '—',
    });
  }
  return out;
}
