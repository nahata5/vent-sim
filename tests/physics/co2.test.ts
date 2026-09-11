/**
 * CO2 → drive loop with time warp (Spec §4.4, Brief 1 §1.5). PaCO2 relaxes toward 0.863·VCO2/VA with a
 * minutes-scale time constant, a chemoreceptor delay maps the delayed PaCO2 to the neural drive (Pmax and
 * rate), an apneic threshold silences the drive, and the time warp scales only the CO2 clock.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessResult } from '@sim/headless';
import { defaultSettings, type VentSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import { defaultDriveParams } from '@sim/patient/neural-drive';
import { GasExchange, defaultGasParams, steadyStatePaCO2, type GasParams } from '@sim/patient/gas-exchange';
import type { PatientParams } from '@sim/patient/params';
import { k } from '@/config/constants';
import { resolveScenario, scenarioById, scenarioSchedule } from '@/edu/scenarios';

function passive(gas: Partial<GasParams>, settings: Partial<VentSettings>, duration: number): HeadlessResult {
  const patient: PatientParams = { ...presetPatient('normal'), gas: { ...defaultGasParams(), ...gas } };
  return runHeadless({ patient, settings: { ...defaultSettings('VC-AC'), ...settings }, seed: 1, duration });
}

function breathing(gas: Partial<GasParams>, settings: Partial<VentSettings>, duration: number, drive = {}): HeadlessResult {
  const patient: PatientParams = { ...presetPatient('normal'), drive: { ...defaultDriveParams(), rate: 14, ti: 0.9, pmax: 8, ...drive }, gas: { ...defaultGasParams(), ...gas } };
  return runHeadless({ patient, settings: { ...defaultSettings('PSV'), peep: 5, apneaTime: 20, ...settings }, seed: 1, duration });
}

describe('CO2 loop (§4.4): store, delay, drive mapping', () => {
  it('unit: first-order approach to 0.863·VCO2/VA with τ, and the delayed value lags by the chemoreceptor delay', () => {
    // Start hypocapnic (30) with the reference ventilation (the VA that holds the set point 40): the
    // mass-balance store then relaxes toward 40 with exactly τ (Brief 1 §1.5 τ_CO2), at lower VA more slowly.
    const p = { ...defaultGasParams(), tau: 180, delay: 10, warp: 1, paco2Init: 30 };
    const g = new GasExchange(p, 70);
    expect(steadyStatePaCO2(p.vco2, 3)).toBeCloseTo((0.863 * p.vco2) / 3, 6);
    const ss = p.paco2Set;
    expect(steadyStatePaCO2(p.vco2, g.referenceVA)).toBeCloseTo(ss, 9);
    g.setAlveolarVentilation(g.referenceVA);
    const dt = 0.01;
    for (let t = 0; t < 180; t += dt) g.advance(dt);
    const frac = (g.paCO2 - p.paco2Init) / (ss - p.paco2Init);
    expect(frac).toBeGreaterThan(0.6);
    expect(frac).toBeLessThan(0.66);
    // The delayed signal is what PaCO2 was `delay` seconds ago.
    const before = g.paCO2;
    for (let t = 0; t < 10; t += dt) g.advance(dt);
    expect(Math.abs(g.paCO2Delayed - before)).toBeLessThan(0.05);
    // Warp: the same simulated seconds move the CO2 clock w times faster.
    const g2 = new GasExchange({ ...p, warp: 60 }, 70);
    g2.setAlveolarVentilation(g2.referenceVA);
    for (let t = 0; t < 3; t += dt) g2.advance(dt); // 3 s × 60 = 180 s warped = 1 τ
    expect(Math.abs(g2.paCO2 - g.paCO2)).toBeLessThan(0.5 + Math.abs(g.paCO2 - (p.paco2Init + 0.632 * (ss - p.paco2Init))));
  });

  it('unit: drive mapping — 1 at the set point, rises with PaCO2, apnea below the apneic threshold', () => {
    const p = defaultGasParams();
    const g = new GasExchange(p, 70);
    expect(g.drive().pmaxScale).toBeCloseTo(1, 6);
    expect(g.drive().rateScale).toBeCloseTo(1, 6);
    g.forcePaCO2(p.paco2Set + 5);
    expect(g.drive().pmaxScale).toBeCloseTo(1 + 5 * p.gainPmax, 6);
    expect(g.drive().rateScale).toBeCloseTo(1 + 5 * p.gainRate, 6);
    g.forcePaCO2(p.paco2Set - p.apneicOffset - 0.5);
    expect(g.drive().apnea).toBe(true);
    expect(g.drive().pmaxScale).toBe(0);
  });

  it('unit: in apnea PaCO2 rises at a bounded rate (VCO2/K ≈ 13 mmHg/min for τ 3 min) and VA decays toward zero', () => {
    const p = { ...defaultGasParams(), warp: 1 };
    const g = new GasExchange(p, 70);
    for (let t = 0; t < 4; t += 0.01) g.advance(0.01);
    g.onBreath(0.5, 4); // one breath of 500 mL every 4 s → VA ≈ (0.5 − 0.229)·15 = 4.1 L/min
    expect(g.alveolarVentilation ?? 0).toBeGreaterThan(3.5);
    for (let t = 0; t < 30; t += 0.01) g.advance(0.01); // no more breaths: the period stretches
    expect(g.alveolarVentilation ?? 9).toBeLessThan(0.6);
    const before = g.paCO2;
    for (let t = 0; t < 60; t += 0.01) g.advance(0.01);
    const risePerMin = g.paCO2 - before;
    expect(risePerMin).toBeGreaterThan(8);
    expect(risePerMin).toBeLessThan(18);
  });

  it('integrated: a passive VC patient settles within 5 % of 0.863·VCO2/VA from the true Vt and RR', () => {
    // Warp 60: 60 s of simulation = 60 warped minutes ≫ 5 τ.
    const res = passive({ warp: 60 }, { vt: 500, rr: 12, peakFlow: 40 }, 60);
    const bs = res.breaths.filter((b) => b.tEnd !== null && b.tStart > 30);
    const vd = (k('CO2_DEAD_SPACE_ML_PER_KG') * res.pbw + k('CO2_APPARATUS_DEAD_SPACE')) / 1000;
    const va = bs.reduce((s, b) => s + Math.max(0, b.vtiTrue - vd), 0) / ((bs.at(-1)?.tEnd ?? 60) - (bs[0]?.tStart ?? 0)) * 60;
    const expected = steadyStatePaCO2(k('CO2_VCO2_DEFAULT'), va);
    const last = res.co2.at(-1);
    expect(last).toBeDefined();
    expect(Math.abs((last?.paCO2 ?? 0) - expected) / expected).toBeLessThan(0.05);
    expect(expected).toBeGreaterThan(45); // Vt 500 at RR 12 under-ventilates a 70 kg patient
  });

  it('integrated: the warp changes only the CO2 clock — with the loop gains at zero the streams are byte-identical', () => {
    // apneicOffset 100 → the apneic threshold sits at −60 mmHg, i.e. never reached.
    const a = breathing({ warp: 1, gainPmax: 0, gainRate: 0, apneicOffset: 100 }, { ps: 10 }, 30);
    const b = breathing({ warp: 60, gainPmax: 0, gainRate: 0, apneicOffset: 100 }, { ps: 10 }, 30);
    expect(Buffer.from(a.paw.buffer).equals(Buffer.from(b.paw.buffer))).toBe(true);
    expect(Buffer.from(a.flow.buffer).equals(Buffer.from(b.flow.buffer))).toBe(true);
    expect((a.co2.at(-1)?.paCO2 ?? 0) !== (b.co2.at(-1)?.paCO2 ?? 0)).toBe(true);
  });

  it('integrated: over-assist (PS 20) drives PaCO2 below the apneic threshold, the efforts stop and the backup takes over', () => {
    const res = breathing({ warp: 30 }, { ps: 20 }, 120);
    const p = defaultGasParams();
    const minPaCO2 = Math.min(...res.co2.map((c) => c.paCO2));
    expect(minPaCO2).toBeLessThan(p.paco2Set - p.apneicOffset);
    const apneaSamples = res.co2.filter((c) => c.apnea);
    expect(apneaSamples.length).toBeGreaterThan(0);
    expect(res.events.some((e) => e.type === 'trigger' && e.cause === 'backup')).toBe(true);
    // Once the backup has ventilated for a while PaCO2 climbs back and efforts resume (periodic).
    const tApnea = apneaSamples[0]?.t ?? 0;
    const later = res.neuralBreaths.filter((b) => b.tOnset > tApnea + 25 && b.pmax > 0);
    expect(later.length).toBeGreaterThan(0);
  });

  it('integrated: under-assist (PS 2) raises PaCO2 and the drive: Pmax and neural rate scale up', () => {
    // Warp 10: τ = 18 s of simulation, so the first 5 s are still near the baseline drive.
    const res = breathing({ warp: 10 }, { ps: 2 }, 120);
    const p = defaultGasParams();
    const last = res.co2.at(-1);
    expect(last?.paCO2 ?? 0).toBeGreaterThan(p.paco2Set + 3);
    expect(last?.pmaxScale ?? 0).toBeGreaterThan(1.3);
    expect(last?.rateScale ?? 0).toBeGreaterThan(1.1);
    const early = res.neuralBreaths.filter((b) => b.tOnset < 5);
    const late = res.neuralBreaths.filter((b) => b.tOnset > 90);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    expect(mean(late.map((b) => b.pmax))).toBeGreaterThan(8 * 1.5); // baseline Pmax 8
    expect(mean(late.map((b) => b.pmax))).toBeGreaterThan(mean(early.map((b) => b.pmax)) * 1.2);
  });
});

describe('CO2 scenarios (Spec §8 #15, #16)', () => {
  it('co2-over-assist: the scenario carries the loop with its warp; the patient goes apneic before the fix and breathes again after it', () => {
    const def = scenarioById('co2-over-assist');
    const spec = resolveScenario(def);
    expect(spec.patient.gas?.warp ?? 1).toBeGreaterThanOrEqual(10);
    const res = runHeadless({ ...spec, duration: 130, schedule: scenarioSchedule(def, { withFix: true, fixAt: 60 }) });
    const before = res.co2.filter((c) => c.t > 20 && c.t < 60);
    expect(before.some((c) => c.apnea)).toBe(true);
    expect(res.events.some((e) => e.type === 'trigger' && e.cause === 'backup' && e.t < 60)).toBe(true);
    const after = res.co2.filter((c) => c.t > 110);
    expect(after.every((c) => !c.apnea)).toBe(true);
    expect(res.events.some((e) => e.type === 'trigger' && e.cause === 'patient' && e.t > 110)).toBe(true);
  });

  it('co2-under-assist: the drive climbs above 1.5× before the fix and returns toward baseline after it', () => {
    const def = scenarioById('co2-under-assist');
    const res = runHeadless({ ...resolveScenario(def), duration: 130, schedule: scenarioSchedule(def, { withFix: true, fixAt: 60 }) });
    const at60 = res.co2.find((c) => c.t >= 59) ?? res.co2.at(-1);
    expect(at60?.pmaxScale ?? 0).toBeGreaterThan(1.5);
    const at130 = res.co2.at(-1);
    expect(at130?.pmaxScale ?? 9).toBeLessThan((at60?.pmaxScale ?? 0) * 0.8);
  });
});
