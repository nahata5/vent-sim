/**
 * Injectors (Spec §2.1, §7; Brief 1 §3.2, §3.11, §3.12): every fault is a term in the equations, never
 * an overlay. Each test checks the physical consequence on measured signals and the truth bookkeeping.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessResult } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import type { SimEngine } from '@sim/engine';

const leakPct = (r: HeadlessResult, from = 10) => {
  const bs = r.breaths.filter((b) => b.tStart > from && b.tEnd !== null);
  const vti = bs.reduce((s, b) => s + b.vtiMeasured, 0);
  const vte = bs.reduce((s, b) => s + b.vteMeasured, 0);
  return (100 * (vti - vte)) / vti;
};

describe('injectors', () => {
  it('leak: an orifice at the Y-piece makes Vte < Vti (> 10%) and records the true leak volume per breath', () => {
    const base = { patient: presetPatient('normal'), settings: { ...defaultSettings('PC-AC'), peep: 5, pinsp: 15, rr: 15 }, seed: 1, duration: 30 };
    const dry = runHeadless(base);
    const wet = runHeadless({ ...base, schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('leak', { k: 0.03 }) }] });
    expect(leakPct(dry)).toBeLessThan(3);
    expect(leakPct(wet)).toBeGreaterThan(10);
    const b = wet.breaths.find((x) => x.tStart > 10 && x.tEnd !== null);
    expect(b?.leakTrue ?? 0).toBeGreaterThan(0.05);
    expect(dry.breaths.find((x) => x.tStart > 10)?.leakTrue ?? 1).toBeLessThan(1e-6);
  });

  it('cardiac oscillation: flow oscillates at the heart rate with amplitude ≈ A/R and auto-triggers a sensitive flow trigger', () => {
    const patient = presetPatient('normal');
    patient.heartRate = 80;
    const quiet = runHeadless({
      patient,
      settings: { ...defaultSettings('CPAP'), peep: 5, flowTrigger: 6, apneaTime: 60 },
      seed: 2,
      duration: 12,
      schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('cardiac', { amp: 0.6 }) }],
    });
    // Oscillation in the measured flow over 5–10 s: peak-to-peak ≥ 1.5 L/min, ≈ 1.33 Hz (zero crossings).
    const i0 = Math.round(5 * quiet.fs);
    const i1 = Math.round(10 * quiet.fs);
    // Crossings counted with ±0.3 L/min hysteresis so sensor noise near zero does not double-count.
    let lo = Infinity, hi = -Infinity, crossings = 0, side = 0;
    const band = 0.3 / 60;
    for (let i = i0; i < i1; i++) {
      const q = quiet.flow[i] ?? 0;
      lo = Math.min(lo, q);
      hi = Math.max(hi, q);
      const s = q > band ? 1 : q < -band ? -1 : 0;
      if (s !== 0 && side !== 0 && s !== side) crossings += 1;
      if (s !== 0) side = s;
    }
    expect((hi - lo) * 60).toBeGreaterThan(1.5);
    expect(crossings / 2 / 5).toBeGreaterThan(1.0);
    expect(crossings / 2 / 5).toBeLessThan(1.8);
    expect(quiet.breaths.length).toBe(0);
    // A 1 L/min flow trigger auto-triggers: breaths appear although there is no neural drive.
    const sensitive = runHeadless({
      patient,
      settings: { ...defaultSettings('CPAP'), peep: 5, flowTrigger: 1, apneaTime: 60 },
      seed: 2,
      duration: 20,
      schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('cardiac', { amp: 0.6 }) }],
    });
    expect(sensitive.breaths.filter((b) => b.triggerCause === 'patient').length).toBeGreaterThan(5);
  });

  it('mainstem intubation (elastance ×2, resistance ×1.5): PC tidal volume falls by a third to a half', () => {
    const base = { patient: presetPatient('normal'), settings: { ...defaultSettings('PC-AC'), peep: 5, pinsp: 12, rr: 15, ti: 1.0 }, seed: 3, duration: 30 };
    const a = runHeadless(base);
    const b = runHeadless({ ...base, schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('mainstem', { eScale: 2, rScale: 1.5 }) }] });
    const vt = (r: HeadlessResult) => r.breaths.filter((x) => x.tStart > 10 && x.tEnd !== null).map((x) => x.vteTrue);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const ratio = mean(vt(b)) / mean(vt(a));
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.72);
  });

  it('pneumothorax at t = 15 s: abrupt rise of Ppeak in VC and of pleural pressure in the truth channels', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 450, rr: 15, peakFlow: 50 },
      seed: 4,
      duration: 40,
      schedule: [{ t: 15, action: (e: SimEngine) => e.injectors.set('pneumothorax', { eScale: 1.8, ppl: 6 }) }],
    });
    const before = res.breaths.filter((b) => b.tStart > 5 && b.tStart < 14).map((b) => b.ppeakMeasured);
    const after = res.breaths.filter((b) => b.tStart > 25).map((b) => b.ppeakMeasured);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    // Analytic: ΔPpeak ≈ Vt·EL·(eScale − 1) = 0.45·9.4·0.8 ≈ 3.4 cmH2O (Venegas curvature aside).
    expect(mean(after) - mean(before)).toBeGreaterThan(2.5);
    expect(mean(after) - mean(before)).toBeLessThan(5);
    const pplBefore = res.truth.pplND[Math.round(10 * res.fs)] ?? 0;
    const pplAfter = res.truth.pplND[Math.round(30 * res.fs)] ?? 0;
    expect(pplAfter - pplBefore).toBeGreaterThan(3);
  });

  it('cough: brief large expiratory Pmus bursts spike Paw, raise the high-pressure alarm and abort the breath', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 450, rr: 15, peakFlow: 50 },
      seed: 5,
      duration: 40,
      schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('cough', { interval: 6, amp: 40, duration: 0.4 }) }],
    });
    const alarms = res.events.filter((e) => e.type === 'alarm' && e.alarm === 'high-ppeak' && e.active);
    expect(alarms.length).toBeGreaterThan(1);
    expect(res.breaths.some((b) => b.cycleCause === 'alarm')).toBe(true);
    expect(Math.max(...res.paw)).toBeGreaterThan(40);
  });

  it('secretions: band-limited resistance noise puts 5–20 Hz sawtooth energy on expiratory flow', () => {
    const base = { patient: presetPatient('normal'), settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 450, rr: 15, peakFlow: 50 }, seed: 6, duration: 30 };
    const clean = runHeadless(base);
    const dirty = runHeadless({ ...base, schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('secretions', { amp: 0.6 }) }] });
    // High-pass (first difference) RMS of measured flow during expiration, L/min.
    const hpRms = (r: HeadlessResult) => {
      let s = 0, n = 0;
      for (let i = Math.round(10 * r.fs) + 1; i < r.t.length; i++) {
        if ((r.flow[i] ?? 0) < -0.05) {
          const d = ((r.flow[i] ?? 0) - (r.flow[i - 1] ?? 0)) * 60;
          s += d * d;
          n += 1;
        }
      }
      return Math.sqrt(s / Math.max(1, n));
    };
    expect(hpRms(dirty)).toBeGreaterThan(2.5 * hpRms(clean));
  });

  it('bronchospasm: resistance ×2.5 raises Ppeak by > 8 cmH2O while the plateau barely moves', () => {
    // Peak flow 40 L/min keeps Ppeak under the alarm limit so the pause (plateau) is still delivered.
    const base = { patient: presetPatient('normal'), settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 450, rr: 15, peakFlow: 40, pause: 0.4 }, seed: 7, duration: 40 };
    const a = runHeadless(base);
    const b = runHeadless({ ...base, schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('bronchospasm', { rScale: 2.5, rampSeconds: 0 }) }] });
    const last = (r: HeadlessResult) => r.breaths.filter((x) => x.tStart > 20 && x.tEnd !== null).at(-1);
    const pa = last(a);
    const pb = last(b);
    expect((pb?.ppeakMeasured ?? 0) - (pa?.ppeakMeasured ?? 0)).toBeGreaterThan(8);
    // Plateau: truth Paw at the end of the pause.
    const plat = (r: HeadlessResult, br: { tPauseEnd: number }) => r.truth.paw[Math.round(br.tPauseEnd * r.fs) - 2] ?? 0;
    if (!pa || !pb) throw new Error('no breaths');
    expect(Math.abs(plat(b, pb) - plat(a, pa))).toBeLessThan(2.5);
  });

  it('is deterministic: the same seed with secretions gives identical streams', () => {
    const mk = () =>
      runHeadless({
        patient: presetPatient('copd'),
        settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 450, rr: 14, peakFlow: 50 },
        seed: 'inj',
        duration: 15,
        schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('secretions', { amp: 0.6 }) }],
      });
    const a = mk();
    const b = mk();
    expect(Array.from(b.flow)).toEqual(Array.from(a.flow));
  });
});
