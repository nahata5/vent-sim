/**
 * Emergence matrix (Spec §9.4): for every scenario with target patterns, a headless run must show
 * (a) each target pattern in at least the scenario's minimum fraction of breaths (efforts for ineffective
 * effort) before the fix, (b) AI below the limit within 60 s after the scripted fix, and (c) no pattern at
 * all in the passive baseline. Truth labels only; the detector is scored separately (§9.5).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { asynchronyIndex, labelRun, type PatternId } from '@sim/truth/labeler';
import { SCENARIOS, resolveScenario, scenarioSchedule, type ScenarioDef } from '@/edu/scenarios';

const FIX_AT = 60;
const DURATION = 130;
const SETTLE = 15;

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
  const res = runHeadless({ ...resolveScenario(def), duration: DURATION, schedule: scenarioSchedule(def, { withFix: true, fixAt: FIX_AT }) });
  const out = labelRun(res);
  const crit = def.criteria ?? { minFraction: 0.2, aiAfter: 10 };
  const injectorOnset = Math.max(0, ...Object.values(def.injectors ?? {}).map((v) => v.at ?? 0));
  const from = Math.max(10, injectorOnset + 8);
  const before = out.breaths.filter((b) => b.tStart > from && b.tStart < FIX_AT);
  const effortsBefore = out.efforts.filter((e) => e.tOnset > from && e.tOnset < FIX_AT);
  const targets = def.targetPatterns.map((p) => {
    const fraction =
      p === 'ineffective-effort'
        ? effortsBefore.filter((e) => e.ineffective).length / Math.max(1, effortsBefore.length)
        : before.filter((b) => b.patterns.includes(p as PatternId)).length / Math.max(1, before.length);
    return { pattern: p, fraction, required: crit.minFraction };
  });
  const aiBefore = asynchronyIndex(out, from, FIX_AT).ai;
  const aiAfter = asynchronyIndex(out, FIX_AT + SETTLE, DURATION).ai;
  const extra = (crit.extra ?? []).map((x) => {
    const after = out.breaths.filter((b) => b.tStart > FIX_AT + SETTLE);
    const peep = res.settingsLog.at(-1)?.settings.peep ?? 0;
    const value = after.reduce((s, b) => s + ((b.evidence.palvEE ?? peep) - peep), 0) / Math.max(1, after.length);
    return { metric: x.metric, value, max: x.max };
  });
  const pass = targets.every((t) => t.fraction >= t.required) && (def.fix ? aiAfter < crit.aiAfter : true) && extra.every((x) => x.value <= x.max);
  return { id: def.id, targets, aiBefore, aiAfter, aiLimit: crit.aiAfter, extra, pass };
}

describe('emergence matrix (§9.4)', () => {
  const withTargets = SCENARIOS.filter((s) => s.targetPatterns.length > 0);
  it('covers the spec patterns across the library', () => {
    const all = new Set(withTargets.flatMap((s) => s.targetPatterns));
    for (const p of ['ineffective-effort', 'double-trigger', 'reverse-trigger', 'auto-trigger', 'premature-cycling', 'delayed-cycling', 'flow-starvation', 'auto-peep', 'leak', 'secretions', 'high-resistance', 'low-compliance']) {
      expect(all.has(p), p).toBe(true);
    }
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(18);
  });

  for (const def of withTargets) {
    it(`${def.id}: target pattern present, then AI < ${def.criteria?.aiAfter ?? 10}% after the fix`, () => {
      const row = runEmergence(def);
      for (const t of row.targets) expect(t.fraction, `${def.id} ${t.pattern}`).toBeGreaterThanOrEqual(t.required);
      if (def.fix) expect(row.aiAfter, `${def.id} AI after fix`).toBeLessThan(row.aiLimit);
      for (const x of row.extra) expect(x.value, `${def.id} ${x.metric}`).toBeLessThanOrEqual(x.max);
    });
  }

  it('passive baseline: no pattern on any breath (§9.4c)', () => {
    const def = SCENARIOS.find((s) => s.id === 'normal-passive');
    if (!def) throw new Error('missing baseline');
    const res = runHeadless({ ...resolveScenario(def), duration: 60 });
    const out = labelRun(res);
    expect(out.breaths.every((b) => b.patterns.length === 0)).toBe(true);
    expect(asynchronyIndex(out, 0, 60).ai).toBe(0);
  });
});
