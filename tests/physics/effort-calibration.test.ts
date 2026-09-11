/**
 * Spec §9.3 effort calibration: Bertoni 2019 ΔPocc conversion factors, P0.1 against true Pmus,
 * and the esophageal balloon occlusion test (Baydur 1982 / Mojoli 2016).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient, type PhenotypeId } from '@sim/patient/presets';
import { defaultDriveParams, pmusWaveform } from '@sim/patient/neural-drive';
import { defaultBalloon } from '@sim/patient/balloon';

/**
 * Time to request an end-expiratory occlusion so that it starts in the quiet part of expiration and
 * catches a whole effort: run the (deterministic) neural clock once and aim `lead` seconds before the
 * first neural onset after `tAfter`. A clinician does the same by watching the trace.
 */
function occlusionRequestTime(opts: Parameters<typeof runHeadless>[0], tAfter: number, lead = 1.0): number {
  const probe = runHeadless({ ...opts, duration: tAfter + 12 });
  const nb = probe.neuralBreaths.find((b) => b.tOnset > tAfter + 1);
  if (!nb) throw new Error('no neural breath after tAfter');
  return nb.tOnset - lead;
}

/** Slope through the origin of y on x (Bertoni fitted Pmus and ΔPes against ΔPocc). */
function slopeThroughOrigin(xs: number[], ys: number[]): number {
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] ?? 0) * (ys[i] ?? 0);
    sxx += (xs[i] ?? 0) ** 2;
  }
  return sxy / sxx;
}

describe('§9.3 effort calibration', () => {
  it('ΔPocc → Pmus and ΔPes give Bertoni k1 = −0.74 ± 0.05 and k2 = 0.66 ± 0.05', () => {
    const grid: Array<{ id: PhenotypeId; pmax: number }> = [];
    // Bertoni's cohort: mixed ICU patients with acute respiratory failure; obstructive lungs with PEEPi
    // are a documented ΔPocc pitfall and are left out of the calibration grid.
    for (const id of ['normal', 'ards-pulmonary', 'ards-extrapulmonary', 'obesity'] as PhenotypeId[]) {
      for (const pmax of [6, 10, 15, 20, 25]) grid.push({ id, pmax });
    }
    const dPocc: number[] = [];
    const pmusPeak: number[] = [];
    const dPes: number[] = [];
    for (const g of grid) {
      const patient = presetPatient(g.id);
      patient.drive = { ...defaultDriveParams(), rate: 18, ti: 0.7, pmax: g.pmax, cvRate: 0, cvTi: 0, cvPmax: 0 };
      patient.balloon = { ...defaultBalloon(), enabled: true };
      const base = {
        patient,
        settings: { ...defaultSettings('PSV'), peep: 5, ps: 8, apneaTime: 30, esophagealBalloon: true },
        seed: 7,
        duration: 40,
      };
      const tReq = occlusionRequestTime(base, 20);
      const res = runHeadless({ ...base, schedule: [{ t: tReq, action: (e) => e.vent.requestOcclusion('pocc') }] });
      const occ = res.maneuvers.find((m) => m.kind === 'pocc');
      if (!occ?.values) throw new Error(`no ΔPocc for ${g.id}/${g.pmax}`);
      dPocc.push(occ.values.dPocc ?? NaN);
      // Unoccluded breaths: peak true (effective) Pmus and Pes swing over the breaths before the occlusion.
      const win = res.breaths.filter((b) => b.tEnd !== null && b.tStart > 8 && (b.tEnd ?? 0) < 20 && b.triggerCause === 'patient');
      expect(win.length, `${g.id}/${g.pmax} breaths`).toBeGreaterThan(2);
      let pk = 0;
      let swing = 0;
      // Pes swing read on a 0.3 s moving average, as a clinician reads past the cardiac artifact.
      const w = Math.round(0.3 * res.fs);
      const pesS = (i: number) => {
        let sum = 0;
        for (let j = i - w + 1; j <= i; j++) sum += res.pes[Math.max(0, j)] ?? 0;
        return sum / w;
      };
      for (const b of win) {
        const i0 = Math.round(b.tStart * res.fs) - Math.round(0.3 * res.fs);
        const i1 = Math.round((b.tEnd ?? 0) * res.fs);
        let pmax = 0;
        let pesMin = Infinity;
        for (let i = Math.max(w, i0); i < i1; i++) {
          pmax = Math.max(pmax, res.truth.pmus[i] ?? 0);
          pesMin = Math.min(pesMin, pesS(i));
        }
        pk += pmax;
        // ΔPes = end-expiratory Pes (just before the effort) − Pes at the trough.
        swing += pesS(Math.max(w, i0)) - pesMin;
      }
      pmusPeak.push(pk / win.length);
      dPes.push(swing / win.length);
    }
    // Bertoni: k1 = Pmus/ΔPocc = −0.74 (Pmus positive, ΔPocc negative); k2 = ΔPes/ΔPocc = 0.66 (both negative).
    const k1 = slopeThroughOrigin(dPocc, pmusPeak);
    const k2 = slopeThroughOrigin(dPocc, dPes.map((x) => -x));
    const msg = `k1 = ${k1.toFixed(3)} (target −0.74 ± 0.05), k2 = ${k2.toFixed(3)} (target 0.66 ± 0.05)`;
    expect(Math.abs(k1 - -0.74), msg).toBeLessThan(0.05);
    expect(Math.abs(k2 - 0.66), msg).toBeLessThan(0.05);
  });

  it('P0.1 from an occlusion equals the true isometric Pmus at 100 ms within 0.3 cmH2O', () => {
    for (const pmax of [6, 12, 20]) {
      const patient = presetPatient('normal');
      // A slow rate leaves a settled end-expiration for the classic occlusion (the at-trigger fallback
      // used when expiration has not settled reads low by design, as vendor P0.1 does).
      patient.drive = { ...defaultDriveParams(), rate: 12, ti: 1.0, pmax, cvRate: 0, cvTi: 0, cvPmax: 0 };
      const base = { patient, settings: { ...defaultSettings('PSV'), peep: 5, ps: 8, apneaTime: 30 }, seed: 3, duration: 30 };
      const tReq = occlusionRequestTime(base, 15);
      const res = runHeadless({ ...base, schedule: [{ t: tReq, action: (e) => e.vent.requestOcclusion('p01') }] });
      const m = res.maneuvers.find((x) => x.kind === 'p01');
      if (!m?.values) throw new Error('no P0.1');
      // True Pmus 100 ms after the neural onset of the occluded effort.
      const nb = res.neuralBreaths.find((b) => b.tOnset >= m.tStart - 0.15 && b.tOnset <= m.tEnd);
      if (!nb) throw new Error('no neural breath in occlusion');
      const truePmus01 = pmusWaveform(0.1, nb);
      expect(m.values.method).toBe(0);
      expect(Math.abs((m.values.p01 ?? NaN) - truePmus01)).toBeLessThan(0.3 + 0.05 * truePmus01);
    }
  });

  it('a well-placed balloon passes the occlusion test (0.8–1.2); under-filled or misplaced fails', () => {
    const run = (balloon: Partial<ReturnType<typeof defaultBalloon>>) => {
      // Normal lungs: uniform Pmus transmission, so a good balloon should read the mean pleural swing.
      const patient = presetPatient('normal');
      patient.drive = { ...defaultDriveParams(), rate: 16, ti: 0.9, pmax: 10, cvRate: 0, cvTi: 0, cvPmax: 0 };
      patient.balloon = { ...defaultBalloon(), enabled: true, ...balloon };
      const base = {
        patient,
        settings: { ...defaultSettings('PSV'), peep: 8, ps: 8, apneaTime: 30, esophagealBalloon: true },
        seed: 4,
        duration: 30,
      };
      const tReq = occlusionRequestTime(base, 15);
      const res = runHeadless({ ...base, schedule: [{ t: tReq, action: (e) => e.vent.requestOcclusion('occlusion-test') }] });
      const m = res.maneuvers.find((x) => x.kind === 'occlusion-test');
      if (!m?.values) throw new Error('no occlusion test');
      return m.values.ratio ?? NaN;
    };
    const good = run({});
    expect(good).toBeGreaterThan(0.8);
    expect(good).toBeLessThan(1.2);
    const underfilled = run({ fillVolume: 0.5 });
    expect(underfilled).toBeLessThan(0.8);
    const stomach = run({ position: 'stomach' });
    expect(stomach < 0.8 || stomach > 1.2).toBe(true);
  });

  it('PMI from an end-inspiratory hold in PSV rises with effort (Foti 1997)', () => {
    const run = (pmax: number) => {
      const patient = presetPatient('normal');
      patient.drive = { ...defaultDriveParams(), rate: 16, ti: 1.2, pmax, cvRate: 0, cvTi: 0, cvPmax: 0 };
      const res = runHeadless({
        patient,
        settings: { ...defaultSettings('PSV'), peep: 5, ps: 8, ets: 0.3, apneaTime: 30 },
        seed: 2,
        duration: 30,
        schedule: [{ t: 15, action: (e) => e.vent.requestHold('insp', 1.0) }],
      });
      const m = res.maneuvers.find((x) => x.kind === 'insp');
      if (!m?.p2) throw new Error('no hold');
      return m.p2 - (5 + 8);
    };
    const weak = run(4);
    const strong = run(16);
    expect(strong).toBeGreaterThan(weak + 2);
    expect(strong).toBeGreaterThan(3);
  });
});
