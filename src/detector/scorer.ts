/**
 * Scorer (Spec §9.5): detector labels versus truth labels per breath, one confusion matrix per pattern.
 * Ineffective efforts are scored per breath window (any ineffective effort during the breath's cycle).
 */
import type { PatternId } from '../sim/truth/labeler';
import type { LabelOutput } from '../sim/truth/labeler';
import type { DetectorOutput } from './detector';

export const CORE_PATTERNS: readonly PatternId[] = [
  'ineffective-effort',
  'double-trigger',
  'auto-trigger',
  'premature-cycling',
  'delayed-cycling',
  'flow-starvation',
  'reverse-trigger',
];

export const ALL_SCORED_PATTERNS: readonly PatternId[] = [...CORE_PATTERNS, 'delayed-trigger', 'auto-peep', 'leak', 'secretions', 'high-resistance', 'low-compliance', 'overshoot', 'cough'];

export interface PatternScore {
  pattern: PatternId;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  sensitivity: number;
  specificity: number;
  /** Per-case false positives / negatives for tuning diagnostics. */
  byCase: Record<string, { tp: number; fp: number; tn: number; fn: number }>;
}

export interface ScoredCase {
  id: string;
  truth: LabelOutput;
  det: DetectorOutput;
  /** Breaths to score: skip the first seconds (settling) and anything after a fix. */
  tFrom: number;
  tTo: number;
}

/**
 * Per-breath truth positives for a pattern. Ineffective efforts are mapped onto the breath window they
 * fall in and scored for expiratory efforts (IEE, the Chen 2008 / BetterCare target); efforts that land
 * inside a machine insufflation are labeled by the detector when visible but are not part of the §9.5 score
 * (docs/DECISIONS.md D-011).
 */
export function truthPositives(truth: LabelOutput, pattern: PatternId): Set<number> {
  const s = new Set<number>();
  for (const b of truth.breaths) if (b.patterns.includes(pattern)) s.add(b.breathIndex);
  if (pattern === 'ineffective-effort') {
    for (const e of truth.efforts) {
      if (!e.ineffective || e.phase !== 'exp') continue;
      const b = truth.breaths.find((x) => x.tStart <= e.tOnset && (x.tEnd ?? Infinity) > e.tOnset);
      if (b) s.add(b.breathIndex);
    }
  }
  return s;
}

/**
 * Breaths outside a pattern's scoring domain (D-011, D-012): for ineffective effort, a breath holding an
 * effort that began inside the insufflation (its expiratory continuation is visible to the detector but
 * the effort is not an IEE); for flow starvation, both members of a truth double-trigger pair (the
 * stacked pair is scored as double trigger; a 0.3–0.4 s VC breath inside a rising effort has no bedside
 * signature without a passive reference).
 */
export function unscoredBreaths(truth: LabelOutput, pattern: PatternId): Set<number> {
  const s = new Set<number>();
  if (pattern === 'ineffective-effort') {
    const exp = truthPositives(truth, pattern);
    for (const e of truth.efforts) {
      if (!e.ineffective || e.phase !== 'insp') continue;
      const b = truth.breaths.find((x) => x.tStart <= e.tOnset && (x.tEnd ?? Infinity) > e.tOnset);
      if (b && !exp.has(b.breathIndex)) s.add(b.breathIndex);
    }
  }
  if (pattern === 'flow-starvation') {
    for (const b of truth.breaths) {
      if (!b.patterns.includes('double-trigger')) continue;
      s.add(b.breathIndex);
      if (b.evidence.firstBreath !== undefined) s.add(b.evidence.firstBreath);
    }
  }
  return s;
}

export function detectorPositives(det: DetectorOutput, pattern: PatternId): Set<number> {
  const s = new Set<number>();
  for (const b of det.breaths) if (b.patterns.includes(pattern)) s.add(b.breathIndex);
  return s;
}

export function scoreGrid(cases: ScoredCase[], patterns: readonly PatternId[] = ALL_SCORED_PATTERNS): Partial<Record<PatternId, PatternScore>> {
  const out: Partial<Record<PatternId, PatternScore>> = {};
  for (const p of patterns) {
    const sc: PatternScore = { pattern: p, tp: 0, fp: 0, tn: 0, fn: 0, sensitivity: 0, specificity: 0, byCase: {} };
    for (const c of cases) {
      const tPos = truthPositives(c.truth, p);
      const dPos = detectorPositives(c.det, p);
      const skip = unscoredBreaths(c.truth, p);
      const cell = { tp: 0, fp: 0, tn: 0, fn: 0 };
      for (const b of c.truth.breaths) {
        if (b.tStart < c.tFrom || b.tStart > c.tTo || skip.has(b.breathIndex)) continue;
        const t = tPos.has(b.breathIndex);
        const d = dPos.has(b.breathIndex);
        if (t && d) cell.tp += 1;
        else if (!t && d) cell.fp += 1;
        else if (t && !d) cell.fn += 1;
        else cell.tn += 1;
      }
      sc.byCase[c.id] = cell;
      sc.tp += cell.tp;
      sc.fp += cell.fp;
      sc.tn += cell.tn;
      sc.fn += cell.fn;
    }
    sc.sensitivity = sc.tp + sc.fn > 0 ? sc.tp / (sc.tp + sc.fn) : NaN;
    sc.specificity = sc.tn + sc.fp > 0 ? sc.tn / (sc.tn + sc.fp) : NaN;
    out[p] = sc;
  }
  return out;
}
