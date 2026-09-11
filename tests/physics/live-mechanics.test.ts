/**
 * Instructor live mechanics (post-M9): EL and Ecw can change on the running patient. The patient is rebuilt
 * at its current volume, so the volume state is continuous and the pressures jump as they would for a
 * lung or chest wall that suddenly stiffened.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessResult } from '@sim/headless';
import { resolveScenario, scenarioById, scenarioSchedule } from '@/edu/scenarios';

function swing(res: HeadlessResult, ch: 'pplD' | 'palv', t0: number, t1: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < res.t.length; i++) {
    const t = res.t[i] ?? 0;
    if (t < t0 || t > t1) continue;
    const v = res.truth[ch][i] ?? 0;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
}

function maxStep(res: HeadlessResult, t0: number, t1: number): number {
  let m = 0;
  for (let i = 1; i < res.t.length; i++) {
    const t = res.t[i] ?? 0;
    if (t < t0 || t > t1) continue;
    m = Math.max(m, Math.abs((res.truth.vlung[i] ?? 0) - (res.truth.vlung[i - 1] ?? 0)));
  }
  return m;
}

describe('live EL / Ecw (instructor)', () => {
  it('doubling Ecw on a passive VC patient doubles the pleural swing (Ecw·Vt) with a continuous volume', () => {
    const spec = resolveScenario(scenarioById('normal-passive'));
    const ecw0 = spec.patient.mechanics.ecw;
    const res = runHeadless({ ...spec, duration: 60, schedule: [{ t: 30, action: (e) => e.setMechanics({ ecw: 2 * ecw0 }) }] });
    const before = swing(res, 'pplD', 18, 30);
    const after = swing(res, 'pplD', 42, 54);
    expect(after / before).toBeGreaterThan(1.85);
    expect(after / before).toBeLessThan(2.15);
    // No volume discontinuity at the switch: the largest sample-to-sample volume step around t = 30 is no
    // larger than the largest step of ordinary breathing.
    expect(maxStep(res, 29.5, 30.5)).toBeLessThanOrEqual(1.05 * maxStep(res, 10, 29));
    expect(res.mechanics.ecw).toBeCloseTo(2 * ecw0, 6);
  });

  it('doubling EL rescales the alveolar driving pressure by (2·EL + Ecw)/(EL + Ecw)', () => {
    const spec = resolveScenario(scenarioById('normal-passive'));
    const { el, ecw } = spec.patient.mechanics;
    const res = runHeadless({ ...spec, duration: 60, schedule: [{ t: 30, action: (e) => e.setMechanics({ el: 2 * el }) }] });
    const before = swing(res, 'palv', 18, 30);
    const after = swing(res, 'palv', 42, 54);
    const expected = (2 * el + ecw) / (el + ecw);
    expect(after / before).toBeGreaterThan(0.9 * expected);
    expect(after / before).toBeLessThan(1.1 * expected);
  });

  it('a recruitable lung survives an EL change: finite signals, breaths continue, aerated fraction continuous', () => {
    const def = scenarioById('peep-trial-recruiter');
    const spec = resolveScenario(def);
    const el = spec.patient.mechanics.el;
    const res = runHeadless({ ...spec, duration: 60, schedule: [...scenarioSchedule(def), { t: 30, action: (e) => e.setMechanics({ el: 1.3 * el }) }] });
    expect(res.paw.every((v) => Number.isFinite(v))).toBe(true);
    const before = res.breaths.filter((b) => b.tStart > 20 && b.tStart < 30);
    const after = res.breaths.filter((b) => b.tStart > 40 && b.tStart < 55);
    expect(after.length).toBeGreaterThan(2);
    expect(after.every((b) => b.vtiTrue > 0.1)).toBe(true);
    const open = (bs: typeof before) => bs.reduce((s, b) => s + b.openFractionEE, 0) / bs.length;
    expect(Math.abs(open(after) - open(before))).toBeLessThan(0.25);
  });
});
