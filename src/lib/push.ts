// ── What to send to the phone, and when ──────────────────────────────────
//
// Pure scheduling: given the student's data and a time window, return every
// notification whose moment falls inside it. No network, no database, no
// clock of its own — which is what makes it testable, and what makes the
// worker idempotent (it can run every minute or once an hour and the same
// notifications come out exactly once).
import type { AppData, Item, Klass } from './types';
import { fmtEt, utcToEtDate, etToUtc } from './time';
import { urgencyFromHours } from './types';

export interface PlannedPush {
  /** stable per (item, stage) — the worker refuses to send a key twice */
  key: string;
  at: Date;
  title: string;
  body: string;
  /** collapses older notifications for the same thing on the phone */
  tag: string;
  url: string;
  urgent: boolean;
}

/** Nothing wakes him between these hours; it waits for the morning instead. */
export const QUIET_START = 23;   // 23:00 ET
export const QUIET_END = 7;      // 07:00 ET
export const DIGEST_HOUR = 8;    // morning brief
export const SWEEP_HOUR = 20;    // evening "still open" check

const ET_HOUR = (d: Date) => Number(fmtEt(d, 'H'));

/**
 * Push a moment out of quiet hours to the next 07:00 ET. A reminder that fires
 * at 3am is worse than useless — it trains you to ignore the phone.
 */
export function respectQuietHours(at: Date): Date {
  const h = ET_HOUR(at);
  if (h >= QUIET_END && h < QUIET_START) return at;
  const day = utcToEtDate(at);
  // after 23:00 → next morning; before 07:00 → this morning
  const target = h >= QUIET_START ? nextDay(day) : day;
  return etToUtc(target, `${String(QUIET_END).padStart(2, '0')}:00`);
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

const fmtLeft = (ms: number) => {
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `${Math.round(h)} hours`;
  return `${Math.round(h / 24)} days`;
};

const label = (it: Item, k?: Klass) => `${k ? `${k.code} · ` : ''}${it.title}`;

/** Stages, in hours before due, per kind of thing. */
function stagesFor(it: Item): Array<{ id: string; hoursBefore: number; line: (left: string) => string }> {
  const sitDown = it.type === 'exam' || it.at_home === false;
  if (it.type === 'study') return [{ id: 'start', hoursBefore: 0.25, line: () => 'Study block starts in 15 minutes.' }];
  if (sitDown) return [
    { id: 'h48', hoursBefore: 48, line: l => `In ${l}. Two days out — this is when studying still works.` },
    { id: 'h24', hoursBefore: 24, line: l => `Tomorrow, in ${l}.` },
    { id: 'h2', hoursBefore: 2, line: l => `Starts in ${l}. Leave now if you have not.` },
  ];
  return [
    { id: 'h24', hoursBefore: 24, line: l => `Due in ${l}.` },
    { id: 'h3', hoursBefore: 3, line: l => `Due in ${l}. Last window.` },
  ];
}

function activeItems(data: AppData): Item[] {
  return data.items.filter(i => !i.ghost && i.status === 'pending' && i.due_at);
}

export function planPushes(data: AppData, from: Date, to: Date, appUrl = ''): PlannedPush[] {
  const out: PlannedPush[] = [];
  const classById = new Map(data.classes.map(c => [c.id, c]));
  const items = activeItems(data);
  const within = (at: Date) => at.getTime() > from.getTime() && at.getTime() <= to.getTime();
  const add = (p: PlannedPush) => { if (within(p.at)) out.push(p); };

  // ── per-item stages ──
  for (const it of items) {
    const due = new Date(it.due_at!);
    const k = it.class_id ? classById.get(it.class_id) : undefined;
    const sitDown = it.type === 'exam' || it.at_home === false;

    for (const st of stagesFor(it)) {
      const raw = new Date(due.getTime() - st.hoursBefore * 3600000);
      // a study block reminder is useless once the block has started
      const at = it.type === 'study' ? raw : respectQuietHours(raw);
      if (at.getTime() > due.getTime()) continue;    // quiet hours pushed it past the deadline
      add({
        key: `${it.id}:${st.id}`,
        at,
        title: sitDown ? `${label(it, k)} — ${fmtEt(due, 'EEE HH:mm')}` : label(it, k),
        body: st.line(fmtLeft(due.getTime() - at.getTime())),
        tag: `item-${it.id}`,
        url: appUrl,
        urgent: sitDown || st.hoursBefore <= 3,
      });
    }

    // ── it is now late ──
    const lateAt = respectQuietHours(new Date(due.getTime() + 15 * 60000));
    add({
      key: `${it.id}:late`,
      at: lateAt,
      title: `Overdue — ${label(it, k)}`,
      body: sitDown
        ? 'This has already happened. Mark it and talk to the professor today.'
        : 'Past due. Submit it late or mark it — do not leave it silent.',
      tag: `item-${it.id}`,
      url: appUrl,
      urgent: true,
    });
  }

  // ── daily digest and evening sweep ──
  for (const day of daysBetween(from, to)) {
    add(digest(data, items, classById, etToUtc(day, `${String(DIGEST_HOUR).padStart(2, '0')}:00`), appUrl));
    const sweepAt = etToUtc(day, `${String(SWEEP_HOUR).padStart(2, '0')}:00`);
    const s = sweep(data, items, classById, sweepAt, appUrl);
    if (s) add(s);
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

/** every ET date touched by the window, inclusive */
function daysBetween(from: Date, to: Date): string[] {
  const days: string[] = [];
  let d = utcToEtDate(from);
  const end = utcToEtDate(to);
  for (let i = 0; i < 40 && d <= end; i++) { days.push(d); d = nextDay(d); }
  return days;
}

function digest(
  data: AppData, items: Item[], classById: Map<string, Klass>, at: Date, appUrl: string,
): PlannedPush {
  const day = utcToEtDate(at);
  const dueToday = items.filter(i => utcToEtDate(new Date(i.due_at!)) === day);
  const overdue = items.filter(i => new Date(i.due_at!).getTime() < at.getTime());
  const exams = items.filter(i => {
    const h = (new Date(i.due_at!).getTime() - at.getTime()) / 3600000;
    return (i.type === 'exam' || i.at_home === false) && h > 0 && h <= 24 * 7;
  }).sort((a, b) => a.due_at!.localeCompare(b.due_at!));

  const parts: string[] = [];
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  parts.push(dueToday.length ? `${dueToday.length} due today` : 'nothing due today');
  if (exams.length) {
    const e = exams[0];
    const k = e.class_id ? classById.get(e.class_id) : undefined;
    parts.push(`${k ? k.code + ' ' : ''}${e.title} ${fmtEt(new Date(e.due_at!), 'EEE')}`);
  }
  const first = dueToday.sort((a, b) => a.due_at!.localeCompare(b.due_at!))[0];
  return {
    key: `digest:${day}`,
    at,
    title: overdue.length ? `${fmtEt(at, 'EEEE')} — ${overdue.length} overdue` : `${fmtEt(at, 'EEEE')}`,
    body: parts.join(' · ') + (first ? `\nFirst up: ${label(first, first.class_id ? classById.get(first.class_id) : undefined)}` : ''),
    tag: 'digest',
    url: appUrl,
    urgent: overdue.length > 0,
  };
}

function sweep(
  data: AppData, items: Item[], classById: Map<string, Klass>, at: Date, appUrl: string,
): PlannedPush | null {
  const soon = items.filter(i => {
    const h = (new Date(i.due_at!).getTime() - at.getTime()) / 3600000;
    return h > 0 && h <= 24;
  }).sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  const late = items.filter(i => new Date(i.due_at!).getTime() < at.getTime());
  if (!soon.length && !late.length) return null;

  const names = soon.slice(0, 3)
    .map(i => label(i, i.class_id ? classById.get(i.class_id) : undefined))
    .join('\n');
  return {
    key: `sweep:${utcToEtDate(at)}`,
    at,
    title: late.length
      ? `${late.length} overdue · ${soon.length} due within 24h`
      : `${soon.length} due within 24 hours`,
    body: names + (soon.length > 3 ? `\n+${soon.length - 3} more` : ''),
    tag: 'sweep',
    url: appUrl,
    urgent: late.length > 0 || soon.some(i => urgencyFromHours((new Date(i.due_at!).getTime() - at.getTime()) / 3600000) === 'critical'),
  };
}
