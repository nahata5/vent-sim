/**
 * Recruitable-population lung (Spec §4.3, Brief 2 §2.2 model B). Units open above a transpulmonary opening
 * pressure with a Bates–Irvin delay and close with hysteresis; what must emerge: the Gattinoni 1998 direction
 * with recruited volume, tidal recruitment at low PEEP, and a best-compliance PEEP in a decremental trial.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessResult } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient, recruitableRecoil, type PhenotypeId } from '@sim/patient/presets';
import { RecruitableRecoil } from '@sim/patient/lung-recruitable';

function run(id: PhenotypeId, peep: number, vt: number, duration = 40): HeadlessResult {
  const patient = presetPatient(id, { recoil: recruitableRecoil(id) });
  return runHeadless({ patient, settings: { ...defaultSettings('VC-AC'), peep, vt, rr: 15, peakFlow: 40, pause: 0.5, alarms: { ...defaultSettings().alarms, highPpeak: 60 } }, seed: 1, duration });
}

/** Static mechanics from the last breaths: plateau and relaxed end-expiratory alveolar pressure (truth). */
function mech(res: HeadlessResult, after = 20) {
  const bs = res.breaths.filter((b) => b.tEnd !== null && b.tStart > after).slice(-3);
  const at = (t: number) => Math.round((t - (res.t[0] ?? 0)) * res.fs);
  let ers = 0;
  for (const b of bs) {
    const pplat = res.truth.palv[at(b.tPauseEnd - 0.01)] ?? 0;
    const peepTot = res.truth.palv[at((b.tEnd ?? 0) - 0.01)] ?? 0;
    ers += (pplat - peepTot) / b.vtiTrue;
  }
  const last = bs[bs.length - 1];
  return { ers: ers / bs.length, crs: 1000 / (ers / bs.length), frcAerated: last?.frcAeratedEE ?? NaN, tidal: last?.tidalRecruitUnits ?? NaN, openFraction: last?.openFractionEE ?? NaN };
}

describe('recruitable-population lung (§4.3)', () => {
  it('unit population: opens above the opening pressure after a delay and closes with hysteresis', () => {
    // Half the units are recruitable (f0 = 0.5): the compartment elastance 40 is what Table 1 measured with
    // the always-open half, so the fully recruited compartment has E_all = 40·0.5 = 20 cmH2O/L.
    const spec = { kind: 'recruitable' as const, n: 20, recruitableFraction: 0.5, topMean: 10, topSd: 3, closeDelta: 6, kOpen: 0.5, kClose: 0.5, strainCap: 1.0, odGain: 1 };
    const r = new RecruitableRecoil(spec, 40, 0.5, new Array<number>(20).fill(0));
    r.settle(-5);
    expect(r.openFraction()).toBeCloseTo(0.5, 6);
    expect(r.pressure(0.2)).toBeCloseTo(8, 3); // Table 1 elastance with the zero-PEEP open set
    r.settle(30);
    expect(r.openFraction()).toBe(1);
    expect(r.pressure(0.2)).toBeCloseTo(4, 3); // fully recruited: E_all·V
    // Partial recruitment from the collapsed state → in between (baby lung stiffer than the recruited lung).
    r.settle(-20);
    r.settle(9); // ≈ 37% of the recruitable N(10, 3) population has TOP < 9
    const nOpen = Math.round(r.openFraction() * 20);
    expect(nOpen).toBeGreaterThan(11);
    expect(nOpen).toBeLessThan(16);
    expect(r.pressure(0.2)).toBeGreaterThan(4 * 1.25);
    expect(r.pressure(0.2)).toBeLessThan(8);
    // Hysteresis: units stay open until the pressure falls below TOP − closeDelta (max TCP ≈ 9.9).
    r.settle(30);
    for (let i = 0; i < 20; i++) r.advance(0.1, 11);
    expect(r.openFraction()).toBe(1);
    for (let i = 0; i < 200; i++) r.advance(0.1, -10);
    expect(r.openFraction()).toBeCloseTo(0.5, 6);
    // Time dependence: at kOpen 0.5 a unit 2 cmH2O above its TOP needs ≈ 1 s to open.
    const before = r.openFraction();
    for (let i = 0; i < 3; i++) r.advance(0.1, 12);
    const early = r.openFraction();
    for (let i = 0; i < 40; i++) r.advance(0.1, 12);
    const late = r.openFraction();
    expect(early).toBeLessThan(late);
    expect(late).toBeGreaterThan(before + 0.25);
  });

  it('Gattinoni 1998 with the recruitable lung: extrapulmonary ARDS recruits 0.15–0.45 L from PEEP 0 to 15 and Ers falls; pulmonary ARDS recruits little and Ers rises', () => {
    const e0 = mech(run('ards-extrapulmonary', 0, 420));
    const e15 = mech(run('ards-extrapulmonary', 15, 420));
    expect(e15.ers).toBeLessThan(e0.ers * 0.95);
    const recruited = e15.frcAerated - e0.frcAerated;
    expect(recruited).toBeGreaterThan(0.15);
    expect(recruited).toBeLessThan(0.45);
    const p0 = mech(run('ards-pulmonary', 0, 420));
    const p15 = mech(run('ards-pulmonary', 15, 420));
    expect(p15.ers).toBeGreaterThan(p0.ers * 1.05);
    expect(Math.abs(p15.frcAerated - p0.frcAerated)).toBeLessThan(0.1);
  });

  it('tidal recruitment: a large Vt at PEEP 2 opens and closes units within each breath; PEEP 16 keeps them open', () => {
    // The lung's tidal PL swing must exceed the opening–closing hysteresis; in extrapulmonary ARDS the stiff
    // chest wall takes most of ΔP, so 10 mL/kg is needed to show it (an injurious setting, on purpose).
    const low = mech(run('ards-extrapulmonary', 2, 700));
    const high = mech(run('ards-extrapulmonary', 16, 700));
    expect(low.tidal).toBeGreaterThanOrEqual(2);
    expect(high.tidal).toBeLessThanOrEqual(low.tidal);
    expect(high.openFraction).toBeGreaterThan(low.openFraction);
  });

  it('decremental PEEP steps: Crs traces an inverted U with the best compliance between 8 and 16 cmH2O', () => {
    // Recruitment near a unit's opening pressure is slow (Bates–Irvin), so each step settles for 60 s.
    const peeps = [20, 16, 12, 8, 4, 0];
    const crs = peeps.map((p) => mech(run('ards-extrapulmonary', p, 500, 60), 45).crs);
    const best = crs.indexOf(Math.max(...crs));
    const bestPeep = peeps[best] ?? -1;
    expect(bestPeep).toBeGreaterThanOrEqual(8);
    expect(bestPeep).toBeLessThanOrEqual(16);
    // Measured sweep (Vt 500): 20: 33.8, 16: 40.7, 12: 41.6, 8: 41.1, 4: 40.5, 0: 40.0 mL/cmH2O. The
    // overdistension side is steep; the derecruitment side is shallow because the stiff chest wall
    // (Ecw 12.1) takes half of the driving pressure and tidal ventilation at PEEP 0 already keeps the
    // low-TOP units open (hysteresis), as in Gattinoni's zero-PEEP baseline.
    expect(crs[0] ?? 0).toBeLessThan((crs[best] ?? 0) * 0.9);
    expect(crs[crs.length - 1] ?? 0).toBeLessThan((crs[best] ?? 0) * 0.98);
  });
});
