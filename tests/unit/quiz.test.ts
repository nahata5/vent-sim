/**
 * Quiz grading (Spec §8): identification against the truth labels of a window, then the fix judged by
 * AI < 10 % over 60 s and the safety limits (ΔP ≤ 15, Pplat ≤ 30, Vt 4–8 mL/kg PBW, no new severe alarm),
 * with scenario extras; a composite score from accuracy, time and the number of setting changes.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { labelRun } from '@sim/truth/labeler';
import { resolveScenario, scenarioById } from '@/edu/scenarios';
import { extrasFromTruth, gradeFix, gradeIdentification, quizScore, truthPatternsInWindow, type FixExtra, type FixInput } from '@/edu/quiz';
import type { TruthBreathMetrics } from '@sim/truth/lung-stress';
import { k } from '@/config/constants';

function window(id: string, t0: number, t1: number) {
  const res = runHeadless({ ...resolveScenario(scenarioById(id)), duration: t1 });
  const out = labelRun(res);
  return { res, breaths: out.breaths.filter((b) => b.tStart >= t0 && b.tStart < t1), efforts: out.efforts.filter((e) => e.tOnset >= t0 && e.tOnset < t1), out };
}

describe('quiz: identification', () => {
  it('the truth set of the double-trigger window contains double-trigger and no passive-only findings', () => {
    const w = window('double-trigger', 10, 60);
    const truth = truthPatternsInWindow(w.breaths, w.efforts);
    expect(truth).toContain('double-trigger');
    expect(truth).not.toContain('leak');
  });

  it('grades a pick list: exact match 1, a false positive lowers the score, an empty pick scores 0', () => {
    const w = window('double-trigger', 10, 60);
    const truth = truthPatternsInWindow(w.breaths, w.efforts);
    const exact = gradeIdentification([...truth], truth);
    expect(exact.score).toBe(1);
    expect(exact.misses).toEqual([]);
    expect(exact.falsePositives).toEqual([]);
    const fp = gradeIdentification([...truth, 'leak'], truth);
    expect(fp.falsePositives).toEqual(['leak']);
    expect(fp.score).toBeLessThan(1);
    expect(fp.score).toBeGreaterThan(0.4);
    const none = gradeIdentification([], truth);
    expect(none.score).toBe(0);
    expect(none.misses).toEqual([...truth]);
  });

  it('ineffective efforts count through the efforts, not the breaths', () => {
    const w = window('ineffective-effort', 10, 60);
    expect(truthPatternsInWindow(w.breaths, w.efforts)).toContain('ineffective-effort');
    expect(truthPatternsInWindow(w.breaths, [])).not.toContain('ineffective-effort');
  });
});

describe('quiz: fix grading and score', () => {
  const baseFix = (over: Partial<FixInput> = {}): FixInput => ({
    ai: 4,
    breaths: [
      { dp: 12, pplat: 24, vtPerKg: 6.2 },
      { dp: 13, pplat: 25, vtPerKg: 6.4 },
    ],
    newSevereAlarms: [],
    extras: [],
    ...over,
  });

  it('passes when AI and every safety limit are met, fails with the reason otherwise', () => {
    const ok = gradeFix(baseFix());
    expect(ok.pass).toBe(true);
    expect(ok.checks.every((c) => c.ok)).toBe(true);
    const highAi = gradeFix(baseFix({ ai: 12 }));
    expect(highAi.pass).toBe(false);
    expect(highAi.checks.find((c) => c.id === 'ai')?.ok).toBe(false);
    const bigVt = gradeFix(baseFix({ breaths: [{ dp: 12, pplat: 24, vtPerKg: 9 }] }));
    expect(bigVt.checks.find((c) => c.id === 'vt')?.ok).toBe(false);
    expect(bigVt.pass).toBe(false);
    const alarm = gradeFix(baseFix({ newSevereAlarms: ['high-ppeak'] }));
    expect(alarm.pass).toBe(false);
    const dp = gradeFix(baseFix({ breaths: [{ dp: 16, pplat: 26, vtPerKg: 6 }] }));
    expect(dp.checks.find((c) => c.id === 'dp')?.limit).toBe(k('DP_LIMIT'));
    expect(dp.pass).toBe(false);
  });

  it('a missing plateau (no hold) does not fail the ΔP and Pplat checks but marks them unverified', () => {
    const r = gradeFix(baseFix({ breaths: [{ dp: null, pplat: null, vtPerKg: 6 }] }));
    expect(r.pass).toBe(true);
    expect(r.checks.find((c) => c.id === 'dp')?.verified).toBe(false);
  });

  it('scenario extras are graded like the built-in limits', () => {
    const r = gradeFix(baseFix({ extras: [{ id: 'plEE', label: 'End-expiratory PL ≥ 0', value: -2, min: 0 }] }));
    expect(r.pass).toBe(false);
    expect(r.checks.find((c) => c.id === 'plEE')?.ok).toBe(false);
  });

  it('custom check labels (APRV): Phigh stands in for the plateau, ΔP (Phigh − PEEPtot) is unverified', () => {
    const dpLabel = 'Phigh − PEEPtot (needs an expiratory hold; not available in APRV)';
    const r = gradeFix({ ...baseFix({ breaths: [{ dp: null, pplat: 30, vtPerKg: 6 }] }), labels: { dp: dpLabel, pplat: 'Phigh' } });
    expect(r.checks.find((c) => c.id === 'dp')?.label).toMatch(/^Phigh − PEEPtot/);
    expect(r.checks.find((c) => c.id === 'pplat')?.label).toMatch(/^Phigh/);
    // No hold in APRV: the ΔP check reports as unverified instead of failing, and Phigh ≤ 30 passes.
    expect(r.checks.find((c) => c.id === 'dp')?.ok).toBe(true);
    expect(r.checks.find((c) => c.id === 'dp')?.verified).toBe(false);
    expect(r.checks.find((c) => c.id === 'pplat')?.ok).toBe(true);
    expect(r.pass).toBe(true);
  });

  it('composite score: full marks for a perfect fast fix with one change; decays with time and changes; zero without a pass', () => {
    const perfect = quizScore({ identification: 1, fixPassed: true, seconds: 30, changes: 1 });
    expect(perfect).toBe(100);
    const slow = quizScore({ identification: 1, fixPassed: true, seconds: 600, changes: 1 });
    expect(slow).toBeLessThan(perfect);
    expect(slow).toBeGreaterThan(50);
    const fiddly = quizScore({ identification: 1, fixPassed: true, seconds: 30, changes: 12 });
    expect(fiddly).toBeLessThan(perfect);
    const wrong = quizScore({ identification: 0.5, fixPassed: false, seconds: 30, changes: 1 });
    expect(wrong).toBeLessThan(40);
    expect(wrong).toBeGreaterThan(0);
  });
});

describe('quiz: scenario-specific extras from the truth metrics (Spec §8 "e.g. PL,ee ≥ 0")', () => {
  const m = (plEE: [number, number], plEI: [number, number], dPes = 5): TruthBreathMetrics =>
    ({
      plEE: { nd: plEE[0], d: plEE[1] },
      plEI: { nd: plEI[0], d: plEI[1] },
      dPL: 8,
      dPLdyn: 9,
      vt: 0.4,
      eelv: 2,
      strain: 0.2,
      energy: 5,
      lungEnergy: 3,
      powerTruth: 10,
      lungPower: 6,
      pmusPeak: 4,
      dPes,
      pendelluft: false,
    });

  it('PL,ee reads the worst (dependent) compartment averaged over the window breaths, with a default label', () => {
    const [x] = extrasFromTruth([{ metric: 'plEE', min: 0 }], [m([3, -2], [15, 10]), m([4, 0], [16, 11])]);
    expect(x?.id).toBe('plEE');
    expect(x?.value).toBeCloseTo(-1, 6);
    expect(x?.min).toBe(0);
    expect(x?.label).toContain('PL,ee');
  });

  it('PL,ei reads the worst (highest) compartment; an empty window gives null so the check is unverified', () => {
    const [x] = extrasFromTruth([{ metric: 'plEI', max: 20 }], [m([1, 0], [18, 22])]);
    expect(x?.value).toBeCloseTo(22, 6);
    const [y] = extrasFromTruth([{ metric: 'dPes', max: 8, label: 'ΔPes ≤ 8' }], []);
    expect(y?.value).toBeNull();
    expect(y?.label).toBe('ΔPes ≤ 8');
    expect(gradeFix(baseFixFor([y as FixExtra])).checks.find((c) => c.id === 'dPes')?.verified).toBe(false);
  });

  function baseFixFor(extras: FixExtra[]): FixInput {
    return { ai: 4, breaths: [{ dp: 12, pplat: 24, vtPerKg: 6.2 }], newSevereAlarms: [], extras };
  }
});
