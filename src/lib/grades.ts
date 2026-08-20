// ── Grade engine: standing, need-on-final solver, what-if ────────────────
import type { GradeBucket, Klass, Score } from './types';

export interface BucketStanding {
  bucket: GradeBucket;
  scores: Score[];
  avg: number | null;        // 0..100 after drops
  earnedWeight: number;      // weight already "banked" (weight × avg/100), using graded portion
}

export interface ClassStanding {
  buckets: BucketStanding[];
  gradedWeight: number;      // Σ weights of buckets with ≥1 score (proportional)
  currentPct: number | null; // grade on graded portion
  guaranteedPct: number;     // if you got 0 on everything remaining
  neededOnRemaining: number | null; // avg % needed on ungraded weight to hit target
  neededOnBucket: (bucketName: string) => number | null;
}

export function bucketAvg(b: GradeBucket, scores: Score[]): number | null {
  const s = scores.filter(x => x.bucket === b.name && x.possible > 0);
  if (s.length === 0) return null;
  const pcts = s.map(x => (100 * x.earned) / x.possible).sort((a, z) => a - z);
  const kept = b.drops && pcts.length > b.drops ? pcts.slice(b.drops) : pcts;
  return kept.reduce((a, x) => a + x, 0) / kept.length;
}

export function classStanding(k: Klass, scores: Score[]): ClassStanding {
  const mine = scores.filter(s => s.class_id === k.id);
  const buckets: BucketStanding[] = k.grading.map(b => {
    const avg = bucketAvg(b, mine);
    return {
      bucket: b, scores: mine.filter(s => s.bucket === b.name), avg,
      earnedWeight: avg == null ? 0 : (b.weight_pct * avg) / 100,
    };
  });
  const gradedWeight = buckets.filter(b => b.avg != null).reduce((a, b) => a + b.bucket.weight_pct, 0);
  const earned = buckets.reduce((a, b) => a + b.earnedWeight, 0);
  const currentPct = gradedWeight > 0 ? (100 * earned) / gradedWeight : null;
  const totalWeight = k.grading.reduce((a, b) => a + b.weight_pct, 0) || 100;
  const guaranteedPct = (100 * earned) / totalWeight;
  const remainingWeight = totalWeight - gradedWeight;
  const neededOnRemaining = remainingWeight > 0
    ? ((k.target_pct / 100) * totalWeight - earned) * (100 / remainingWeight)
    : null;
  const neededOnBucket = (bucketName: string): number | null => {
    // needed on THIS bucket if you keep current averages elsewhere & hit target
    const b = k.grading.find(x => x.name === bucketName);
    if (!b) return null;
    const others = buckets.filter(x => x.bucket.name !== bucketName);
    // assume ungraded other buckets score at current overall avg (or target if nothing graded)
    const assume = currentPct ?? k.target_pct;
    const othersEarned = others.reduce((a, x) =>
      a + (x.avg != null ? x.earnedWeight : (x.bucket.weight_pct * assume) / 100), 0);
    return (((k.target_pct / 100) * totalWeight - othersEarned) * 100) / b.weight_pct;
  };
  return { buckets, gradedWeight, currentPct, guaranteedPct, neededOnRemaining, neededOnBucket };
}

export function letterFor(pct: number): string {
  if (pct >= 97) return 'A+';
  if (pct >= 93) return 'A';
  if (pct >= 90) return 'A−';
  if (pct >= 87) return 'B+';
  if (pct >= 83) return 'B';
  if (pct >= 80) return 'B−';
  if (pct >= 77) return 'C+';
  if (pct >= 73) return 'C';
  if (pct >= 70) return 'C−';
  if (pct >= 67) return 'D+';
  if (pct >= 63) return 'D';
  if (pct >= 60) return 'D−';
  return 'F';
}
