/**
 * M4 neural drive and Pmus generator (Brief 1 §1.3, Spec §4.4).
 */
import { describe, expect, it } from 'vitest';
import { NeuralDrive, defaultDriveParams, pmusWaveform } from '@sim/patient/neural-drive';
import { createRng } from '@sim/math/prng';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';

describe('Pmus waveform', () => {
  it('rises parabolically to Pmax at the end of neural Ti and relaxes exponentially', () => {
    const p = { pmax: 10, ti: 1.0, holdFrac: 0, relaxTau: 0.2 };
    expect(pmusWaveform(0, p)).toBeCloseTo(0, 6);
    expect(pmusWaveform(0.5, p)).toBeCloseTo(7.5, 6); // 2x − x² at x = 0.5
    expect(pmusWaveform(1.0, p)).toBeCloseTo(10, 6);
    expect(pmusWaveform(1.2, p)).toBeCloseTo(10 * Math.exp(-1), 6);
    // P0.1 of this effort is Pmus at 100 ms
    expect(pmusWaveform(0.1, p)).toBeCloseTo(10 * (0.2 - 0.01), 6);
  });

  it('holds at Pmax for the hold fraction (ASL-style)', () => {
    const p = { pmax: 10, ti: 1.0, holdFrac: 0.3, relaxTau: 0.2 };
    expect(pmusWaveform(0.7, p)).toBeCloseTo(10, 6);
    expect(pmusWaveform(0.85, p)).toBeCloseTo(10, 6);
    expect(pmusWaveform(1.0, p)).toBeCloseTo(10, 6);
  });
});

describe('NeuralDrive clock', () => {
  it('runs at the neural rate with the configured jitter and is deterministic', () => {
    const params = { ...defaultDriveParams(), rate: 20, ti: 1.0, pmax: 8, cvRate: 0.15, cvTi: 0.15, cvPmax: 0.15 };
    const run = (seed: number) => {
      const d = new NeuralDrive(params, createRng(seed));
      const dt = 0.001;
      for (let t = 0; t < 120; t += dt) d.advance(t, dt);
      return d.breaths;
    };
    const a = run(1);
    const b = run(1);
    expect(a.map((x) => x.tOnset)).toEqual(b.map((x) => x.tOnset));
    const periods = a.slice(1).map((x, i) => x.tOnset - (a[i]?.tOnset ?? 0));
    const mean = periods.reduce((s, x) => s + x, 0) / periods.length;
    const sd = Math.sqrt(periods.reduce((s, x) => s + (x - mean) ** 2, 0) / periods.length);
    expect(Math.abs(mean - 3.0)).toBeLessThan(0.25);
    expect(sd / mean).toBeGreaterThan(0.05);
    expect(sd / mean).toBeLessThan(0.3);
    const pmaxes = a.map((x) => x.pmax);
    const pm = pmaxes.reduce((s, x) => s + x, 0) / pmaxes.length;
    expect(Math.abs(pm - 8)).toBeLessThan(1);
  });

  it('with zero jitter the onsets are exactly periodic and Pmus sums cleanly', () => {
    const params = { ...defaultDriveParams(), rate: 15, ti: 0.8, pmax: 10, cvRate: 0, cvTi: 0, cvPmax: 0 };
    const d = new NeuralDrive(params, createRng(3));
    const dt = 0.001;
    let peak = 0;
    for (let t = 0; t < 20; t += dt) {
      d.advance(t, dt);
      peak = Math.max(peak, d.pmusIso);
    }
    const onsets = d.breaths.map((x) => x.tOnset);
    for (let i = 1; i < onsets.length; i++) expect((onsets[i] ?? 0) - (onsets[i - 1] ?? 0)).toBeCloseTo(4, 3);
    expect(peak).toBeCloseTo(10, 1);
  });

  it('entrainment locks onsets to machine breaths at the set ratio and delay with < 5% jitter', () => {
    const params = {
      ...defaultDriveParams(),
      rate: 12,
      ti: 0.8,
      pmax: 6,
      entrainment: { ratio: 2 as const, delay: 0.4, jitter: 0.03 },
    };
    const d = new NeuralDrive(params, createRng(5));
    const dt = 0.001;
    const machine: number[] = [];
    for (let i = 0; i < 30; i++) machine.push(2 + i * 4); // 15/min
    let mi = 0;
    for (let t = 0; t < 125; t += dt) {
      if (mi < machine.length && t >= (machine[mi] ?? Infinity)) {
        d.onVentBreath(t);
        mi += 1;
      }
      d.advance(t, dt);
    }
    const onsets = d.breaths.map((x) => x.tOnset);
    expect(onsets.length).toBeGreaterThanOrEqual(14);
    expect(onsets.length).toBeLessThanOrEqual(15);
    const delays = onsets.map((o) => o - (machine.filter((m) => m <= o).at(-1) ?? 0));
    const mean = delays.reduce((s, x) => s + x, 0) / delays.length;
    const sd = Math.sqrt(delays.reduce((s, x) => s + (x - mean) ** 2, 0) / delays.length);
    expect(Math.abs(mean - 0.4)).toBeLessThan(0.05);
    expect(sd / mean).toBeLessThan(0.05);
    expect(d.breaths.every((b) => b.entrained)).toBe(true);
  });

  it('expiratory muscle activity gives a negative Pmus late in expiration', () => {
    const params = {
      ...defaultDriveParams(),
      rate: 12,
      ti: 1.0,
      pmax: 8,
      cvRate: 0,
      cvTi: 0,
      cvPmax: 0,
      expiratory: { amp: 4, onsetFrac: 0.5, duration: 0.8 },
    };
    const d = new NeuralDrive(params, createRng(1));
    const dt = 0.001;
    let min = 0;
    for (let t = 0; t < 20; t += dt) {
      d.advance(t, dt);
      min = Math.min(min, d.pmusIso);
    }
    expect(min).toBeLessThan(-3);
  });
});

describe('live drive changes (sedation / instructor controls)', () => {
  it('setParams changes rate, Pmax and entrainment without restarting the clock', () => {
    const patient = presetPatient('ards-pulmonary');
    patient.drive = { ...defaultDriveParams(), rate: 10, ti: 0.9, pmax: 6, entrainment: { ratio: 1, delay: 0.4, jitter: 0.03 } };
    const res = runHeadless({
      patient,
      settings: { ...defaultSettings('VC-AC'), peep: 10, vt: 420, peakFlow: 45, rr: 18 },
      seed: 9,
      duration: 90,
      schedule: [{ t: 45, action: (e) => e.setDriveParams({ entrainment: null, rate: 20, pmax: 10 }) }],
    });
    const before = res.neuralBreaths.filter((b) => b.tOnset > 5 && b.tOnset < 45);
    const after = res.neuralBreaths.filter((b) => b.tOnset > 50 && b.tOnset < 90);
    expect(before.every((b) => b.entrained)).toBe(true);
    expect(after.some((b) => b.entrained)).toBe(false);
    expect(after.length / 40).toBeGreaterThan(16 / 60); // ≈ 20/min free-running
    const pmaxAfter = after.reduce((s, b) => s + b.pmax, 0) / after.length;
    expect(pmaxAfter).toBeGreaterThan(8.5);
    // No neural breath is lost or duplicated around the change.
    const onsets = res.neuralBreaths.map((b) => b.tOnset);
    for (let i = 1; i < onsets.length; i++) expect((onsets[i] ?? 0) - (onsets[i - 1] ?? 0)).toBeGreaterThan(0.3);
  });
});
