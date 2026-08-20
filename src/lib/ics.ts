// ── ICS calendar feed generation (RFC 5545), America/New_York ────────────
import type { AppData } from './types';
import { expandAll } from './recurrence';
import { fmtEt, todayEt, addDaysStr } from './time';

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function fold(line: string): string {
  // RFC 5545: max 75 octets/line; simple char-based fold is fine for ASCII-ish content
  const out: string[] = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); }
  out.push(s);
  return out.join('\r\n');
}
/** UTC instant → local ET DTSTART string with TZID semantics */
function dtEt(d: Date): string {
  return fmtEt(d, "yyyyMMdd'T'HHmmss");
}
function dtDate(dateStr: string): string { return dateStr.replace(/-/g, ''); }

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
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

export function buildIcs(data: AppData): string {
  const lines: string[] = [];
  const push = (l: string) => lines.push(fold(l));
  push('BEGIN:VCALENDAR');
  push('VERSION:2.0');
  push('PRODID:-//AcademAI//Mission Control//EN');
  push('CALSCALE:GREGORIAN');
  push('METHOD:PUBLISH');
  push('X-WR-CALNAME:AcademAI');
  push('X-WR-TIMEZONE:America/New_York');
  lines.push(VTIMEZONE);
  const stamp = fmtEt(new Date(), "yyyyMMdd'T'HHmmss");
  const classById = new Map(data.classes.map(c => [c.id, c]));
  const compById = new Map(data.components.map(c => [c.id, c]));

  // 1) Class meetings — from a bit in the past to semester end
  if (data.semester) {
    const from = addDaysStr(todayEt(), -7);
    const occs = expandAll(data.components, data.semester, data.holidays, from, data.semester.end_date);
    for (const o of occs) {
      const comp = compById.get(o.component_id);
      const k = classById.get(o.class_id);
      if (!comp || !k) continue;
      push('BEGIN:VEVENT');
      push(`UID:${o.component_id}-${o.date}@academai`);
      push(`DTSTAMP;TZID=America/New_York:${stamp}`);
      push(`DTSTART;TZID=America/New_York:${dtEt(o.start)}`);
      push(`DTEND;TZID=America/New_York:${dtEt(o.end)}`);
      push(`SUMMARY:${esc(`${k.code} ${comp.kind}${comp.title ? ' · ' + comp.title : ''}`)}`);
      if (comp.location) push(`LOCATION:${esc(comp.location)}`);
      push(`DESCRIPTION:${esc(k.name)}`);
      // leave-by alarm
      push('BEGIN:VALARM');
      push('ACTION:DISPLAY');
      push(`DESCRIPTION:${esc(`Leave for ${k.code} ${comp.kind} now`)}`);
      push(`TRIGGER:-PT${Math.max(1, comp.leave_by_min || 10)}M`);
      push('END:VALARM');
      push('END:VEVENT');
    }
  }

  // 2) Due items (incl. accepted study blocks) — events with alarms
  for (const it of data.items) {
    if (it.ghost || it.status === 'dropped' || it.status === 'done' || !it.due_at) continue;
    const k = it.class_id ? classById.get(it.class_id) : null;
    const due = new Date(it.due_at);
    push('BEGIN:VEVENT');
    push(`UID:item-${it.id}@academai`);
    push(`DTSTAMP;TZID=America/New_York:${stamp}`);
    if (it.all_day) {
      const d = fmtEt(due, 'yyyy-MM-dd');
      push(`DTSTART;VALUE=DATE:${dtDate(d)}`);
      push(`DTEND;VALUE=DATE:${dtDate(addDaysStr(d, 1))}`);
    } else {
      push(`DTSTART;TZID=America/New_York:${dtEt(due)}`);
      push(`DTEND;TZID=America/New_York:${dtEt(new Date(due.getTime() + 30 * 60000))}`);
    }
    const tag = it.type.toUpperCase();
    push(`SUMMARY:${esc(`⬖ ${tag}: ${it.title}${k ? ` [${k.code}]` : ''}`)}`);
    if (it.details) push(`DESCRIPTION:${esc(it.details)}`);
    for (const trig of it.type === 'exam' ? ['-P1D', '-PT3H'] : ['-P1D', '-PT2H']) {
      push('BEGIN:VALARM');
      push('ACTION:DISPLAY');
      push(`DESCRIPTION:${esc(`${tag} due: ${it.title}`)}`);
      push(`TRIGGER:${trig}`);
      push('END:VALARM');
    }
    push('END:VEVENT');
  }
  push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
