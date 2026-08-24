// ── Dedupe/merge brain: classify extracted items vs. what's known ────────
import type { Item, ItemType } from './types';
import { fmtEt } from './time';

function fmtDue(iso: string | null): string {
  return iso ? fmtEt(new Date(iso), 'MMM d HH:mm') : '—';
}

export type Verdict = 'NEW' | 'UPDATE' | 'KNOWN' | 'MOVE';

export interface Classified<T> {
  verdict: Verdict;
  incoming: T;
  existing?: Item;        // for UPDATE/KNOWN/MOVE
  changes?: string[];     // human-readable diffs for UPDATE/MOVE
  /** MOVE only: the class the existing copy is filed under today */
  fromClassId?: string | null;
}

const SYNONYMS: Array<[RegExp, string]> = [
  [/\bhw\b/g, 'homework'],
  [/\bhomework\s*#?\s*(\d+)/g, 'homework $1'],
  [/\bassignment\s*#?\s*(\d+)/g, 'homework $1'],
  [/\bproblem\s*set\s*#?\s*(\d+)/g, 'pset $1'],
  [/\bps\s*#?\s*(\d+)/g, 'pset $1'],
  [/\blab\s*report\s*#?\s*(\d+)/g, 'labreport $1'],
  [/\bmidterm\s*#?\s*(\d+)?/g, 'midterm $1'],
  [/\bquiz\s*#?\s*(\d+)/g, 'quiz $1'],
  [/\bexam\s*#?\s*(\d+)/g, 'exam $1'],
  [/\bweek\s*#?\s*(\d+)/g, 'week $1'],
  [/\bch(?:apter)?\.?\s*(\d+)/g, 'chapter $1'],
];

export function normTitle(t: string): string {
  let s = t.toLowerCase().replace(/[^\w\s#]/g, ' ');
  for (const [re, sub] of SYNONYMS) s = s.replace(re, sub);
  return s.replace(/#/g, ' ').replace(/\s+/g, ' ').trim();
}

function numbers(s: string): string[] {
  return (s.match(/\d+/g) ?? []);
}

/** Sørensen–Dice bigram similarity 0..1 */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  const big = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = big(a), B = big(b);
  let inter = 0, sizeA = 0, sizeB = 0;
  for (const v of A.values()) sizeA += v;
  for (const v of B.values()) sizeB += v;
  if (sizeA === 0 || sizeB === 0) return 0;
  for (const [g, v] of A) inter += Math.min(v, B.get(g) ?? 0);
  return (2 * inter) / (sizeA + sizeB);
}

const TYPE_FAMILY: Record<ItemType, string> = {
  assignment: 'work', project: 'work', quiz: 'assess', exam: 'assess',
  reading: 'read', study: 'study', task: 'life', social: 'life', admin: 'life',
};

export interface IncomingItem {
  class_id: string | null;
  type: ItemType;
  title: string;
  due_at: string | null;
  all_day: boolean;
  details: string;
  at_home: boolean;
  bucket: string | null;
  weight_pct: number | null;
  effort_min: number;
}

/**
 * Same real-world thing? Type family + number tokens + fuzzy title + date.
 *
 * `ignoreClass` is the whole point of the cross-check: when the extractor files
 * something under the wrong course, the copy that already exists is invisible
 * to a same-class-only comparison, so the mistake becomes a duplicate on the
 * wrong course instead of being recognised and corrected.
 */
export function sameIdentity(inc: IncomingItem, ex: Item, ignoreClass = false): boolean {
  if (!ignoreClass && (inc.class_id ?? null) !== (ex.class_id ?? null)) return false;
  if (TYPE_FAMILY[inc.type] !== TYPE_FAMILY[ex.type]) return false;
  const a = normTitle(inc.title), b = normTitle(ex.title);
  const na = numbers(a), nb = numbers(b);
  // Numbered items: "homework 4" vs "homework 6" must NOT match
  if (na.length && nb.length) {
    const sharePrefixWord = a.split(' ')[0] === b.split(' ')[0];
    if (sharePrefixWord || dice(a, b) >= 0.55) return na.join(',') === nb.join(',');
  }
  if (dice(a, b) >= (ignoreClass ? 0.86 : 0.8)) return true;
  // Same due date + same type + moderately similar title. Across classes this
  // is too weak on its own — half the courses on campus have something due at
  // 23:59 on the same Friday — so it needs a much closer title.
  if (inc.due_at && ex.due_at && inc.due_at.slice(0, 10) === ex.due_at.slice(0, 10)
      && inc.type === ex.type && dice(a, b) >= (ignoreClass ? 0.72 : 0.45)) return true;
  return false;
}

export function classifyIncoming(inc: IncomingItem, existing: Item[]): Classified<IncomingItem> {
  const live = existing.filter(e => e.status !== 'dropped' && !e.ghost);
  const candidates = live.filter(e => sameIdentity(inc, e));
  if (candidates.length === 0) {
    // Nothing matches inside this class — is the same thing already filed under
    // a different one? That is a misfiling to correct, not a new item to add.
    if (inc.class_id) {
      const strays = live.filter(e => e.class_id !== inc.class_id && sameIdentity(inc, e, true));
      if (strays.length === 1) {
        const ex = strays[0];
        return {
          verdict: 'MOVE', incoming: inc, existing: ex, fromClassId: ex.class_id,
          changes: diffAgainst(inc, ex),
        };
      }
    }
    return { verdict: 'NEW', incoming: inc };
  }
  // choose best by title similarity
  candidates.sort((x, y) =>
    dice(normTitle(inc.title), normTitle(y.title)) - dice(normTitle(inc.title), normTitle(x.title)));
  const ex = candidates[0];
  const changes = diffAgainst(inc, ex);
  if (changes.length === 0) return { verdict: 'KNOWN', incoming: inc, existing: ex };
  return { verdict: 'UPDATE', incoming: inc, existing: ex, changes };
}

/** Human-readable diffs between what arrived and what is already stored. */
export function diffAgainst(inc: IncomingItem, ex: Item): string[] {
  const changes: string[] = [];
  const incDue = inc.due_at ? inc.due_at : null;
  if (incDue !== null && (incDue ?? '') !== (ex.due_at ?? '')
      && !(ex.due_at && Math.abs(new Date(incDue).getTime() - new Date(ex.due_at).getTime()) < 61000)) {
    changes.push(`due: ${fmtDue(ex.due_at)} → ${fmtDue(incDue)}`);
  }
  if (inc.at_home !== ex.at_home) changes.push(`take-home: ${ex.at_home} → ${inc.at_home}`);
  if (inc.weight_pct != null && inc.weight_pct !== ex.weight_pct) changes.push(`weight: ${ex.weight_pct ?? '—'}% → ${inc.weight_pct}%`);
  if (inc.details && inc.details.trim() && !ex.details.includes(inc.details.trim())) changes.push('details updated');
  return changes;
}

/**
 * Everything already tracked that this document has something to say about.
 * Run after the incoming items are classified, so it can see what was matched.
 */
export interface Correction {
  kind: 'REASSIGN' | 'DUPLICATE' | 'ORPHAN';
  item: Item;
  /** REASSIGN: where it should go. DUPLICATE: the copy it duplicates. */
  toClassId?: string | null;
  other?: Item;
  reason: string;
}

/**
 * Two existing items that are plainly the same thing filed under different
 * classes. Nothing in the incoming document is needed to see this — it is a
 * standing inconsistency, and a syllabus upload is a good moment to surface it.
 */
export function findDuplicates(items: Item[]): Correction[] {
  const live = items.filter(i => i.status === 'pending' && !i.ghost);
  const out: Correction[] = [];
  const paired = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (a.class_id === b.class_id) continue;
      if (paired.has(a.id) || paired.has(b.id)) continue;
      const inc: IncomingItem = {
        class_id: a.class_id, type: a.type, title: a.title, due_at: a.due_at,
        all_day: a.all_day, details: a.details, at_home: a.at_home,
        bucket: a.bucket, weight_pct: a.weight_pct, effort_min: a.effort_min,
      };
      if (!sameIdentity(inc, b, true)) continue;
      // Require real, equal dates. Two undated items sharing a title across two
      // courses is a coincidence ("Essay", "Reading response"), not evidence.
      if (!a.due_at || !b.due_at) continue;
      if (a.due_at.slice(0, 10) !== b.due_at.slice(0, 10)) continue;
      paired.add(a.id); paired.add(b.id);
      out.push({
        kind: 'DUPLICATE', item: b, other: a,
        reason: 'the same thing appears under two courses',
      });
    }
  }
  return out;
}
