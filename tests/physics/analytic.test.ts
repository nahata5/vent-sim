/**
 * Spec §9.1 analytic physics tests (Brief 1 §5 built-in unit tests).
 *
 * These use an "ideal" ventilator (no servo lag, no source resistance, no sensor
 * noise) and a single-compartment linear patient so closed-form predictions apply.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { linearPatient } from '@sim/patient/params';
import type { HeadlessResult } from '@sim/headless';

function lastCompleteBreaths(res: HeadlessResult, n: number) {
  const done = res.breaths.filter((b) => b.tEnd !== null);
  return done.slice(-n);
}

function integrate(res: HeadlessResult, ch: Float32Array, t0: number, t1: number): number {
  const dt = 1 / res.fs;
  let s = 0;
  for (let i = 0; i < res.t.length; i++) {
    const t = res.t[i] ?? 0;
    if (t >= t0 && t < t1) s += (ch[i] ?? 0) * dt;
  }
  return s;
}

/** Value of the last device sample strictly before time t. */
function sampleBefore(res: HeadlessResult, ch: Float32Array, t: number): number {
  const i = Math.min(res.t.length - 1, Math.max(0, Math.ceil(t * res.fs - 1e-6) - 1));
  return ch[i] ?? NaN;
}

function maxBetween(res: HeadlessResult, ch: Float32Array, t0: number, t1: number): number {
  let m = -Infinity;
  for (let i = 0; i < res.t.length; i++) {
    const t = res.t[i] ?? 0;
    if (t > t0 && t <= t1) m = Math.max(m, ch[i] ?? -Infinity);
  }
  return m;
}

describe('§9.1 analytic physics', () => {
  it('passive PC: Vt = C·ΔP·(1 − e^(−Ti/τ)) within 2%', () => {
    const C = 0.05; // L/cmH2O
    const R = 10; // cmH2O/(L/s)
    const dP = 15;
    const ti = 1.0;
    const res = runHeadless({
      patient: linearPatient({ C, R }),
      settings: {
        ...defaultSettings('PC-AC'),
        peep: 5,
        pinsp: dP,
        ti,
        rr: 12,
        riseTime: 0,
        ideal: true,
      },
      seed: 1,
      duration: 30,
    });
    const tau = R * C;
    const expected = C * dP * (1 - Math.exp(-ti / tau));
    const breaths = lastCompleteBreaths(res, 3);
    expect(breaths.length).toBe(3);
    for (const b of breaths) {
      expect(b.triggerCause).toBe('time');
      expect(Math.abs(b.vtiTrue - expected) / expected).toBeLessThan(0.02);
      // measured (sensor-chain) volume also within 2%
      expect(Math.abs(b.vtiMeasured - expected) / expected).toBeLessThan(0.02);
    }
  });

  it('passive PC with a realistic ventilator still lands within 3%', () => {
    const C = 0.05;
    const R = 10;
    const dP = 15;
    const ti = 1.0;
    const res = runHeadless({
      patient: linearPatient({ C, R }),
      settings: { ...defaultSettings('PC-AC'), peep: 5, pinsp: dP, ti, rr: 12, riseTime: 0.05 },
      seed: 1,
      duration: 30,
    });
    const expected = C * dP * (1 - Math.exp(-ti / (R * C)));
    for (const b of lastCompleteBreaths(res, 3)) {
      expect(Math.abs(b.vtiTrue - expected) / expected).toBeLessThan(0.03);
    }
  });

  it('passive VC square flow: Ppeak − Pplat = R·Q', () => {
    const C = 0.05;
    const R = 12;
    const vt = 500; // mL
    const peakFlow = 30; // L/min → 0.5 L/s → Ti 1.0 s
    const res = runHeadless({
      patient: linearPatient({ C, R }),
      settings: {
        ...defaultSettings('VC-AC'),
        peep: 5,
        vt,
        peakFlow,
        flowPattern: 'square',
        pause: 0.5,
        rr: 12,
        ideal: true,
      },
      seed: 1,
      duration: 30,
    });
    const Q = peakFlow / 60;
    const [b] = lastCompleteBreaths(res, 1);
    if (!b) throw new Error('no breath');
    // Ppeak: highest Paw during flow delivery; Pplat: last sample of the pause.
    const ppeak = maxBetween(res, res.truth.paw, b.tStart, b.tInspEnd);
    const pplat = sampleBefore(res, res.truth.paw, b.tPauseEnd);
    expect(Math.abs(ppeak - pplat - R * Q)).toBeLessThan(0.02 * R * Q + 0.05);
    // and the plateau equals PEEP + Vt/C
    expect(Math.abs(pplat - (5 + vt / 1000 / C))).toBeLessThan(0.2);
  });

  it('mass balance per breath: ∫Q_insp − ∫Q_exp = ΔEELV (no leak)', () => {
    const res = runHeadless({
      patient: linearPatient({ C: 0.06, R: 20 }),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 500, peakFlow: 30, rr: 20, ideal: true },
      seed: 1,
      duration: 20,
    });
    // Use the first few breaths where EELV is still climbing so ΔEELV ≠ 0.
    const breaths = res.breaths.filter((b) => b.tEnd !== null).slice(0, 5);
    expect(breaths.length).toBe(5);
    for (const b of breaths) {
      const tEnd = b.tEnd ?? 0;
      const insp = integrate(res, res.truth.flow, b.tStart, b.tInspEnd);
      const exp = -integrate(res, res.truth.flow, b.tInspEnd, tEnd);
      const v0 = sampleBefore(res, res.truth.vlung, b.tStart);
      const v1 = sampleBefore(res, res.truth.vlung, tEnd);
      expect(Math.abs(insp - exp - (v1 - v0))).toBeLessThan(0.004); // 4 mL at 100 Hz sampling
    }
  });

  it('steady-state intrinsic PEEP matches the e^(−Te/τ) prediction', () => {
    const C = 0.06;
    const R = 20;
    const vt = 0.5;
    const rr = 20;
    const peakFlow = 30; // Ti = 1 s, Te = 2 s
    const res = runHeadless({
      patient: linearPatient({ C, R }),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: vt * 1000, peakFlow, rr, ideal: true },
      seed: 1,
      duration: 40,
    });
    const te = 60 / rr - vt / (peakFlow / 60);
    const tau = R * C;
    const x = Math.exp(-te / tau);
    const veePredicted = (vt * x) / (1 - x);
    const peepiPredicted = veePredicted / C;
    const [b] = lastCompleteBreaths(res, 1);
    if (!b) throw new Error('no breath');
    const tEnd = b.tEnd ?? 0;
    const palvEE = sampleBefore(res, res.truth.palv, tEnd);
    const peepi = palvEE - 5;
    expect(peepiPredicted).toBeGreaterThan(1);
    expect(Math.abs(peepi - peepiPredicted)).toBeLessThan(0.03 * peepiPredicted + 0.05);
  });

  it('with no Pmus and no noise, every breath is time-triggered', () => {
    const res = runHeadless({
      patient: linearPatient({ C: 0.05, R: 10 }),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 450, peakFlow: 40, rr: 14 },
      seed: 3,
      duration: 30,
    });
    const breaths = res.breaths.filter((b) => b.tEnd !== null);
    expect(breaths.length).toBeGreaterThan(5);
    expect(breaths.every((b) => b.triggerCause === 'time')).toBe(true);
  });

  it('the same seed and inputs give byte-identical streams', () => {
    const opts = {
      patient: linearPatient({ C: 0.05, R: 10 }),
      settings: { ...defaultSettings('PC-AC'), peep: 5, pinsp: 12, ti: 0.9, rr: 16 },
      seed: 11,
      duration: 10,
    };
    const a = runHeadless(opts);
    const b = runHeadless(opts);
    expect(Buffer.from(a.paw.buffer).equals(Buffer.from(b.paw.buffer))).toBe(true);
    expect(Buffer.from(a.flow.buffer).equals(Buffer.from(b.flow.buffer))).toBe(true);
    expect(Buffer.from(a.vol.buffer).equals(Buffer.from(b.vol.buffer))).toBe(true);
  });
});
