/**
 * Validation runners shared by the test suites and the in-app Validation page (Spec §9.4, §9.5).
 * Emergence matrix: for every scenario with target patterns, a headless run must show each target pattern
 * in at least the scenario's minimum fraction of breaths (efforts for ineffective effort) before the fix
 * and AI below the limit within 60 s after the scripted fix. Truth labels only; the detector is scored by
 * `scoreGrid(runGrid(HELD_OUT_GRID))`.
 */
import { runHeadless } from '../sim/headless';
import { asynchronyIndex, labelRun, type PatternId } from '../sim/truth/labeler';
import { resolveScenario, scenarioSchedule, type ScenarioDef } from '../edu/scenarios';
import type { PatternScore } from './scorer';

export const EMERGENCE_FIX_AT = 60;
export const EMERGENCE_DURATION = 130;
export const EMERGENCE_SETTLE = 15;

export interface EmergenceRow {
  id: string;
  targets: Array<{ pattern: string; fraction: number; required: number }>;
  aiBefore: number;
  aiAfter: number;
  aiLimit: number;
  extra: Array<{ metric: string; value: number; max: number }>;
  pass: boolean;
}

export function runEmergence(def: ScenarioDef): EmergenceRow {
  const res = runHeadless({ ...resolveScenario(def), duration: EMERGENCE_DURATION, schedule: scenarioSchedule(def, { withFix: true, fixAt: EMERGENCE_FIX_AT }) });
  const out = labelRun(res);
  const crit = def.criteria ?? { minFraction: 0.2, aiAfter: 10 };
  const injectorOnset = Math.max(0, ...Object.values(def.injectors ?? {}).map((v) => v.at ?? 0));
  const from = Math.max(10, injectorOnset + 8);
  const before = out.breaths.filter((b) => b.tStart > from && b.tStart < EMERGENCE_FIX_AT);
  const effortsBefore = out.efforts.filter((e) => e.tOnset > from && e.tOnset < EMERGENCE_FIX_AT);
  const targets = def.targetPatterns.map((p) => {
    const fraction =
      p === 'ineffective-effort'
        ? effortsBefore.filter((e) => e.ineffective).length / Math.max(1, effortsBefore.length)
        : before.filter((b) => b.patterns.includes(p as PatternId)).length / Math.max(1, before.length);
    return { pattern: p, fraction, required: crit.minFraction };
  });
  const aiBefore = asynchronyIndex(out, from, EMERGENCE_FIX_AT).ai;
  const aiAfter = asynchronyIndex(out, EMERGENCE_FIX_AT + EMERGENCE_SETTLE, EMERGENCE_DURATION).ai;
  const extra = (crit.extra ?? []).map((x) => {
    const after = out.breaths.filter((b) => b.tStart > EMERGENCE_FIX_AT + EMERGENCE_SETTLE);
    const peep = res.settingsLog.at(-1)?.settings.peep ?? 0;
    const value = after.reduce((s, b) => s + ((b.evidence.palvEE ?? peep) - peep), 0) / Math.max(1, after.length);
    return { metric: x.metric, value, max: x.max };
  });
  const pass = targets.every((t) => t.fraction >= t.required) && (def.fix ? aiAfter < crit.aiAfter : true) && extra.every((x) => x.value <= x.max);
  return { id: def.id, targets, aiBefore, aiAfter, aiLimit: crit.aiAfter, extra, pass };
}

/** Confusion-matrix summary without the per-case detail (Validation page, snapshot JSON). */
export type PatternScoreSummary = Omit<PatternScore, 'byCase'>;

export function summarizeScore(s: PatternScore): PatternScoreSummary {
  const { byCase: _drop, ...rest } = s;
  void _drop;
  return rest;
}

/** §9.5 targets (sensitivity / specificity); delayed cycling's accepted floor is documented in D-012. */
export const DETECTOR_TARGETS: Record<string, { sens: number; spec: number }> = {
  'ineffective-effort': { sens: 0.85, spec: 0.9 },
  'double-trigger': { sens: 0.85, spec: 0.9 },
  'auto-trigger': { sens: 0.85, spec: 0.9 },
  'premature-cycling': { sens: 0.85, spec: 0.9 },
  'delayed-cycling': { sens: 0.85, spec: 0.9 },
  'flow-starvation': { sens: 0.85, spec: 0.9 },
  'reverse-trigger': { sens: 0.75, spec: 0.9 },
};
