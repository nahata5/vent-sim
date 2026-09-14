/**
 * Emergence matrix (Spec §9.4): for every scenario with target patterns, a headless run must show
 * (a) each target pattern in at least the scenario's minimum fraction of breaths (efforts for ineffective
 * effort) before the fix, (b) AI below the limit within 60 s after the scripted fix, and (c) no pattern at
 * all in the passive baseline. Truth labels only; the detector is scored separately (§9.5).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { asynchronyIndex, labelRun } from '@sim/truth/labeler';
import { SCENARIOS, resolveScenario } from '@/edu/scenarios';
import { runEmergence } from '@/detector/validation';

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
      for (const x of row.extra) {
        if (x.max !== undefined) expect(x.value, `${def.id} ${x.metric}`).toBeLessThanOrEqual(x.max);
        if (x.min !== undefined) expect(x.value, `${def.id} ${x.metric}`).toBeGreaterThanOrEqual(x.min);
      }
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
