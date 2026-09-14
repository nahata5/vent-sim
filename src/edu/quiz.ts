/**
 * Quiz grading (Spec §8). Pure functions over the truth labels and the monitor values so the same code
 * grades a live session and a headless run.
 *
 *  1. Identification: the learner's pick list against the patterns present in the window (a pattern is
 *     present when ≥ QUIZ_PATTERN_MIN_FRACTION of the breaths carry it; ineffective effort is counted on
 *     the efforts). Score = |hits| / |truth ∪ picks| (Jaccard).
 *  2. Fix: AI < 10 % over 60 s and ΔP ≤ 15, Pplat ≤ 30, Vt 4–8 mL/kg PBW, no new severe alarm, plus any
 *     scenario extras (e.g. PL,ee ≥ 0). A limit that cannot be verified (no plateau without a hold) does
 *     not fail the fix but is reported as unverified.
 *  3. Score = 50 % identification + 50 % fix, the fix half made of pass (50 %), time (25 %) and setting
 *     changes (25 %).
 */
import { k } from '../config/constants';
import type { AlarmId } from '../sim/vent/ventilator';
import type { BreathLabel, EffortLabel, PatternId } from '../sim/truth/labeler';
import type { TruthBreathMetrics } from '../sim/truth/lung-stress';

/** Alarms that count as "new severe alarms" for the fix (Brief 1 §2.6: the ones that mean harm or no ventilation). */
export const SEVERE_ALARMS: readonly AlarmId[] = ['high-ppeak', 'apnea', 'disconnect', 'low-ve', 'high-peepi'];

export function truthPatternsInWindow(breaths: BreathLabel[], efforts: EffortLabel[], minFraction = k('QUIZ_PATTERN_MIN_FRACTION')): PatternId[] {
  const counts = new Map<PatternId, number>();
  for (const b of breaths) for (const p of b.patterns) counts.set(p, (counts.get(p) ?? 0) + 1);
  const out: PatternId[] = [];
  for (const [p, n] of counts) if (n / Math.max(1, breaths.length) >= minFraction) out.push(p);
  const ie = efforts.filter((e) => e.ineffective).length;
  if (efforts.length > 0 && ie / efforts.length >= minFraction && !out.includes('ineffective-effort')) out.push('ineffective-effort');
  return out.sort();
}

export interface IdentificationGrade {
  truth: PatternId[];
  hits: PatternId[];
  misses: PatternId[];
  falsePositives: PatternId[];
  /** Jaccard similarity of the pick list and the truth set, 0–1. */
  score: number;
}

export function gradeIdentification(picked: PatternId[], truth: PatternId[]): IdentificationGrade {
  const t = new Set(truth);
  const p = new Set(picked);
  const hits = [...t].filter((x) => p.has(x)).sort();
  const misses = [...t].filter((x) => !p.has(x)).sort();
  const falsePositives = [...p].filter((x) => !t.has(x)).sort();
  const union = new Set([...t, ...p]).size;
  return { truth: [...t].sort(), hits, misses, falsePositives, score: union === 0 ? 1 : hits.length / union };
}

export interface FixBreath {
  dp: number | null;
  pplat: number | null;
  vtPerKg: number;
}

export interface FixExtra {
  id: string;
  label: string;
  value: number | null;
  min?: number;
  max?: number;
}

/** Truth metrics a scenario may add to the fix criteria (Spec §8: "scenario-specific extras, e.g. PL,ee ≥ 0"). */
export const QUIZ_EXTRA_METRICS = ['plEE', 'plEI', 'dPL', 'dPes', 'pmusPeak'] as const;
export type QuizExtraMetric = (typeof QUIZ_EXTRA_METRICS)[number];

export interface QuizExtraDef {
  metric: QuizExtraMetric;
  min?: number;
  max?: number;
  /** Display label; a default names the metric and its limit. */
  label?: string;
}

const EXTRA_META: Record<QuizExtraMetric, { name: string; unit: string; read: (m: TruthBreathMetrics) => number }> = {
  plEE: { name: 'PL,ee (dependent lung)', unit: 'cmH2O', read: (m) => Math.min(m.plEE.nd, m.plEE.d) },
  plEI: { name: 'PL,ei (worst region)', unit: 'cmH2O', read: (m) => Math.max(m.plEI.nd, m.plEI.d) },
  dPL: { name: 'ΔPL', unit: 'cmH2O', read: (m) => m.dPL },
  dPes: { name: 'ΔPes', unit: 'cmH2O', read: (m) => m.dPes },
  pmusPeak: { name: 'Pmus peak', unit: 'cmH2O', read: (m) => m.pmusPeak },
};

/**
 * Scenario extras as fix checks: each metric is the worst compartment per breath, averaged over the
 * breaths of the fix window; no breath yet → null (unverified, does not fail the fix).
 */
export function extrasFromTruth(defs: QuizExtraDef[], window: TruthBreathMetrics[]): FixExtra[] {
  return defs.map((d) => {
    const meta = EXTRA_META[d.metric];
    const value = window.length === 0 ? null : window.reduce((a, m) => a + meta.read(m), 0) / window.length;
    const limit = d.min !== undefined ? `≥ ${d.min}` : `≤ ${d.max}`;
    const out: FixExtra = { id: d.metric, label: d.label ?? `${meta.name} ${limit} ${meta.unit}`, value };
    if (d.min !== undefined) out.min = d.min;
    if (d.max !== undefined) out.max = d.max;
    return out;
  });
}

export interface FixInput {
  /** Asynchrony index over the fix window, %. */
  ai: number;
  breaths: FixBreath[];
  newSevereAlarms: string[];
  extras: FixExtra[];
  /** Override the ΔP and plateau check labels (APRV: Phigh for the plateau; ΔP is Phigh − PEEPtot, which no hold can measure there, so it is passed as null and reported unverified). */
  labels?: { dp?: string; pplat?: string };
}

export interface FixCheck {
  id: string;
  label: string;
  value: number | null;
  limit: number;
  ok: boolean;
  /** False when the value could not be measured (no plateau); such a check does not fail the fix. */
  verified: boolean;
}

export interface FixGrade {
  pass: boolean;
  checks: FixCheck[];
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function gradeFix(inp: FixInput): FixGrade {
  const checks: FixCheck[] = [];
  const upper = (id: string, label: string, value: number | null, limit: number): void => {
    checks.push({ id, label, value, limit, ok: value === null ? true : value <= limit, verified: value !== null });
  };
  checks.push({ id: 'ai', label: `Asynchrony index < ${k('AI_SEVERE')} % over ${k('QUIZ_FIX_WINDOW')} s`, value: inp.ai, limit: k('AI_SEVERE'), ok: inp.ai < k('AI_SEVERE'), verified: true });
  const dps = inp.breaths.map((b) => b.dp).filter((x): x is number => x !== null && Number.isFinite(x));
  const pplats = inp.breaths.map((b) => b.pplat).filter((x): x is number => x !== null && Number.isFinite(x));
  upper('dp', `${inp.labels?.dp ?? 'Driving pressure'} ≤ ${k('DP_LIMIT')} cmH2O`, mean(dps), k('DP_LIMIT'));
  upper('pplat', `${inp.labels?.pplat ?? 'Plateau'} ≤ ${k('PPLAT_LIMIT')} cmH2O`, mean(pplats), k('PPLAT_LIMIT'));
  const vt = mean(inp.breaths.map((b) => b.vtPerKg).filter((x) => Number.isFinite(x)));
  checks.push({
    id: 'vt',
    label: `Vt ${k('VT_PBW_LOW')}–${k('VT_PBW_HIGH')} mL/kg PBW`,
    value: vt,
    limit: k('VT_PBW_HIGH'),
    ok: vt === null ? true : vt >= k('VT_PBW_LOW') && vt <= k('VT_PBW_HIGH'),
    verified: vt !== null,
  });
  checks.push({ id: 'alarms', label: 'No new severe alarm', value: inp.newSevereAlarms.length, limit: 0, ok: inp.newSevereAlarms.length === 0, verified: true });
  for (const x of inp.extras) {
    const v = x.value;
    const ok = v === null ? true : (x.min === undefined || v >= x.min) && (x.max === undefined || v <= x.max);
    checks.push({ id: x.id, label: x.label, value: v, limit: x.max ?? x.min ?? NaN, ok, verified: v !== null });
  }
  return { pass: checks.every((c) => c.ok), checks };
}

export interface ScoreInput {
  identification: number; // 0–1
  fixPassed: boolean;
  seconds: number;
  changes: number;
}

/** Composite 0–100 score (Spec §8: accuracy, time and number of setting changes). */
export function quizScore(s: ScoreInput): number {
  const floor = k('QUIZ_FACTOR_FLOOR');
  const fTime = Math.max(floor, Math.min(1, 1 - Math.max(0, s.seconds - k('QUIZ_TIME_FREE')) / k('QUIZ_TIME_SPAN')));
  const fChanges = Math.max(floor, Math.min(1, 1 - Math.max(0, s.changes - k('QUIZ_CHANGES_FREE')) * k('QUIZ_CHANGES_PENALTY')));
  const fix = s.fixPassed ? 0.5 + 0.25 * fTime + 0.25 * fChanges : 0;
  return Math.round(100 * (0.5 * Math.max(0, Math.min(1, s.identification)) + 0.5 * fix));
}
