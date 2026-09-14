/**
 * M3 ventilator logic: triggers, refractory, PSV/CPAP cycling, servo, apnea backup, alarms.
 * Efforts are scripted Pmus pulses (the neural generator arrives in M4).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import { linearPatient } from '@sim/patient/params';
import type { VentEvent } from '@sim/types';

/** Parabolic-rise effort pulse (Albanese shape) with exponential relaxation. */
function pulse(t: number, t0: number, ti: number, pmax: number, tauRelax = 0.15): number {
  const x = t - t0;
  if (x < 0) return 0;
  if (x <= ti) return pmax * ((2 * x) / ti - (x / ti) ** 2);
  return pmax * Math.exp(-(x - ti) / tauRelax);
}

function effortsAt(times: number[], ti = 0.9, pmax = 8) {
  return (t: number) => {
    let p = 0;
    for (const t0 of times) p += pulse(t, t0, ti, pmax);
    return { pmusIso: p };
  };
}

function triggers(events: VentEvent[]) {
  return events.filter((e): e is Extract<VentEvent, { type: 'trigger' }> => e.type === 'trigger');
}
function cycles(events: VentEvent[]) {
  return events.filter((e): e is Extract<VentEvent, { type: 'cycle' }> => e.type === 'cycle');
}
function alarms(events: VentEvent[]) {
  return events.filter((e): e is Extract<VentEvent, { type: 'alarm' }> => e.type === 'alarm');
}

describe('patient triggering', () => {
  it('flow trigger fires within 150 ms of effort onset in PSV and the breath is patient-triggered', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('PSV'), peep: 5, ps: 10, flowTrigger: 2, triggerType: 'flow', apneaTime: 30 },
      seed: 1,
      duration: 12,
      drive: effortsAt([3, 6, 9]),
    });
    const trig = triggers(res.events).filter((e) => e.cause === 'patient');
    expect(trig.length).toBe(3);
    for (const [i, t0] of [3, 6, 9].entries()) {
      const delay = (trig[i]?.t ?? 0) - t0;
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(0.15);
    }
  });

  it('pressure trigger fires and needs a deeper Paw dip than the flow trigger', () => {
    const base = { ...defaultSettings('PSV'), peep: 5, ps: 10, apneaTime: 30 };
    const flow = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...base, triggerType: 'flow', flowTrigger: 2 },
      seed: 1,
      duration: 8,
      drive: effortsAt([3, 6]),
    });
    const press = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...base, triggerType: 'pressure', pressureTrigger: 2 },
      seed: 1,
      duration: 8,
      drive: effortsAt([3, 6]),
    });
    const tf = triggers(flow.events).filter((e) => e.cause === 'patient');
    const tp = triggers(press.events).filter((e) => e.cause === 'patient');
    // One breath per effort at least (a longer trigger delay can leave enough residual effort after
    // cycling to re-trigger; that is the emergent double trigger, not a fault).
    expect(tf.length).toBeGreaterThanOrEqual(2);
    expect(tp.length).toBeGreaterThanOrEqual(2);
    expect((tp[0]?.t ?? 0) - 3).toBeGreaterThan((tf[0]?.t ?? 0) - 3);
  });

  it('an effort inside the refractory period does not trigger; the same effort after it does', () => {
    const settings = {
      ...defaultSettings('PSV'),
      peep: 5,
      ps: 8,
      apneaTime: 30,
      refractory: 0.3,
      flowTrigger: 2,
    };
    // First effort at 3 s triggers a breath. In a fibrosis lung PSV cycles fast (< 0.8 s), so a short
    // second effort placed 0.1 s after the cycle lands in the refractory window.
    const probe = runHeadless({
      patient: presetPatient('fibrosis'),
      settings,
      seed: 1,
      duration: 6,
      drive: effortsAt([3], 0.6, 8),
    });
    const tCycle = cycles(probe.events)[0]?.t ?? 0;
    expect(tCycle).toBeGreaterThan(3);
    const inside = runHeadless({
      patient: presetPatient('fibrosis'),
      settings,
      seed: 1,
      duration: 6,
      drive: (t) => ({ pmusIso: pulse(t, 3, 0.6, 8) + pulse(t, tCycle + 0.05, 0.15, 6, 0.05) }),
    });
    const outside = runHeadless({
      patient: presetPatient('fibrosis'),
      settings,
      seed: 1,
      duration: 6,
      drive: (t) => ({ pmusIso: pulse(t, 3, 0.6, 8) + pulse(t, tCycle + 0.5, 0.15, 6, 0.05) }),
    });
    expect(triggers(inside.events).filter((e) => e.cause === 'patient').length).toBe(1);
    expect(triggers(outside.events).filter((e) => e.cause === 'patient').length).toBe(2);
  });

  it('with no effort and no noise there are no patient triggers in PSV until the apnea backup', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('PSV'), peep: 5, ps: 10, apneaTime: 10, ideal: true },
      seed: 1,
      duration: 25,
    });
    expect(triggers(res.events).filter((e) => e.cause === 'patient').length).toBe(0);
    const backup = triggers(res.events).filter((e) => e.cause === 'backup');
    expect(backup.length).toBeGreaterThan(0);
    expect(backup[0]?.t).toBeGreaterThanOrEqual(10);
    expect(alarms(res.events).some((a) => a.alarm === 'apnea' && a.active)).toBe(true);
  });
});

describe('cycling', () => {
  it('PSV cycles on flow at ETS and a higher ETS shortens Ti', () => {
    const run = (ets: number) =>
      runHeadless({
        patient: presetPatient('normal'),
        settings: { ...defaultSettings('PSV'), peep: 5, ps: 12, ets, tiMax: 3, apneaTime: 30 },
        seed: 1,
        duration: 8,
        drive: effortsAt([3], 1.0, 8),
      });
    const lo = run(0.2);
    const hi = run(0.6);
    const cLo = cycles(lo.events)[0];
    const cHi = cycles(hi.events)[0];
    expect(cLo?.cause).toBe('flow');
    expect(cHi?.cause).toBe('flow');
    const tiLo = (cLo?.t ?? 0) - (triggers(lo.events)[0]?.t ?? 0);
    const tiHi = (cHi?.t ?? 0) - (triggers(hi.events)[0]?.t ?? 0);
    expect(tiHi).toBeLessThan(tiLo - 0.15);
  });

  it('PSV with a large leak never reaches ETS and cycles on Ti_max', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('PSV'), peep: 5, ps: 10, ets: 0.25, tiMax: 1.5, apneaTime: 30 },
      seed: 1,
      duration: 8,
      drive: (t) => ({ pmusIso: pulse(t, 3, 1.0, 8), leak: (paw: number) => 0.12 * Math.sqrt(Math.max(paw, 0)) }),
    });
    const c = cycles(res.events)[0];
    expect(c?.cause).toBe('ti-max');
    expect((c?.t ?? 0) - (triggers(res.events)[0]?.t ?? 0)).toBeCloseTo(1.5, 1);
  });

  it('a strong expiratory push during PSV inspiration pressure-cycles the breath', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('PSV'), peep: 5, ps: 10, ets: 0.1, tiMax: 3, apneaTime: 30 },
      seed: 1,
      duration: 8,
      // inspiratory effort then an abrupt, strong expiratory push 0.3 s later (cough-like)
      drive: (t) => ({ pmusIso: pulse(t, 3, 0.5, 8) - pulse(t, 3.3, 0.15, 25, 0.1) }),
    });
    expect(cycles(res.events)[0]?.cause).toBe('pressure');
  });

  it('CPAP delivers PEEP only: peak Paw stays within 2 cmH2O of PEEP during a triggered breath', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('CPAP'), peep: 8, apneaTime: 30 },
      seed: 1,
      duration: 8,
      drive: effortsAt([3, 5.5], 0.9, 8),
    });
    const b = res.breaths.filter((x) => x.triggerCause === 'patient');
    // At least one breath per effort; a persisting effort may re-trigger after flow cycling (emergent).
    expect(b.length).toBeGreaterThanOrEqual(2);
    for (const x of b) expect(Math.abs(x.ppeakMeasured - 8)).toBeLessThan(2);
  });
});

describe('pressure servo and rise time', () => {
  it('a longer rise time slows the approach to target in PC', () => {
    const run = (riseTime: number) =>
      runHeadless({
        patient: presetPatient('normal'),
        settings: { ...defaultSettings('PC-AC'), peep: 5, pinsp: 15, ti: 1, rr: 12, riseTime },
        seed: 1,
        duration: 8,
      });
    const t90 = (r: ReturnType<typeof run>) => {
      const b = r.breaths[1];
      if (!b) throw new Error('breath');
      const i0 = Math.round(b.tStart * r.fs);
      for (let i = i0; i < i0 + r.fs; i++) if ((r.truth.paw[i] ?? 0) >= 5 + 0.9 * 15) return (i - i0) / r.fs;
      return Infinity;
    };
    expect(t90(run(0.3))).toBeGreaterThan(t90(run(0.05)) + 0.15);
  });

  it('Paw sags below target under high demand with a realistic servo but not with an ideal one', () => {
    const run = (ideal: boolean) =>
      runHeadless({
        patient: presetPatient('normal'),
        settings: { ...defaultSettings('PSV'), peep: 5, ps: 10, riseTime: 0.05, apneaTime: 30, ideal },
        seed: 1,
        duration: 6,
        drive: effortsAt([3], 0.8, 20),
      });
    const minDuringInsp = (r: ReturnType<typeof run>) => {
      const b = r.breaths[0];
      if (!b) throw new Error('breath');
      let m = Infinity;
      for (let i = Math.round((b.tStart + 0.1) * r.fs); i < Math.round(b.tInspEnd * r.fs); i++) m = Math.min(m, r.truth.paw[i] ?? Infinity);
      return m;
    };
    expect(minDuringInsp(run(false))).toBeLessThan(15 - 0.5);
    expect(minDuringInsp(run(true))).toBeGreaterThan(15 - 0.2);
  });
});

describe('alarms', () => {
  it('high Ppeak cycles the breath off and raises the alarm', () => {
    const res = runHeadless({
      patient: linearPatient({ C: 0.015, R: 15 }),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 600, peakFlow: 60, rr: 12, alarms: { ...defaultSettings('VC-AC').alarms, highPpeak: 30 } },
      seed: 1,
      duration: 10,
    });
    expect(cycles(res.events).some((c) => c.cause === 'alarm')).toBe(true);
    expect(alarms(res.events).some((a) => a.alarm === 'high-ppeak' && a.active)).toBe(true);
    expect(res.breaths.every((b) => b.ppeakMeasured < 33)).toBe(true);
  });

  it('a leak raises the leak alarm and the low-Vte alarm', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 450, peakFlow: 40, rr: 12 },
      seed: 1,
      duration: 15,
      drive: () => ({ leak: (paw: number) => 0.08 * Math.sqrt(Math.max(paw, 0)) }),
    });
    const a = alarms(res.events);
    expect(a.some((x) => x.alarm === 'high-leak' && x.active)).toBe(true);
    expect(a.some((x) => x.alarm === 'low-vte' && x.active)).toBe(true);
  });

  it('a disconnect (Paw falls to zero) raises the disconnect alarm', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('VC-AC'), peep: 8, vt: 450, peakFlow: 40, rr: 12 },
      seed: 1,
      duration: 12,
      drive: (t) => ({ leak: t > 6 ? (paw: number) => 3 * Math.sqrt(Math.max(paw, 0)) : null }),
    });
    const a = alarms(res.events).find((x) => x.alarm === 'disconnect' && x.active);
    expect(a).toBeDefined();
    expect(a?.t ?? 0).toBeGreaterThan(6);
  });

  it('high respiratory rate alarm fires when triggered breaths exceed the limit', () => {
    const times = Array.from({ length: 40 }, (_, i) => 2 + i * 1.4); // ≈ 43/min
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('PSV'), peep: 5, ps: 8, apneaTime: 30, alarms: { ...defaultSettings('PSV').alarms, highRR: 35 } },
      seed: 1,
      duration: 40,
      drive: effortsAt(times, 0.6, 8),
    });
    expect(alarms(res.events).some((x) => x.alarm === 'high-rr' && x.active)).toBe(true);
  });
});

describe('expiratory hold in a breathing patient', () => {
  it('reports the pre-effort plateau as total PEEP and ends the hold when the effort begins', () => {
    // Normal lungs on PSV with a strong effort 1 s after the hold would start. A hold that read Paw at
    // the end of 3 s would report the effort's negative dip; the device must instead report the plateau
    // reached before the effort and release the occlusion once the patient pulls (Brief 2 §5).
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('PSV'), peep: 6, ps: 8 },
      seed: 1,
      duration: 20,
      drive: effortsAt([2, 6, 10.5, 15], 0.9, 10),
      schedule: [{ t: 8.5, action: (e) => e.vent.requestHold('exp') }],
    });
    const m = res.maneuvers.find((x) => x.kind === 'exp');
    expect(m).toBeDefined();
    expect(m?.peepTotal ?? -99).toBeGreaterThan(5.5);
    expect(m?.peepTotal ?? 99).toBeLessThan(7.5);
    // Released early: the hold does not run its full 3 s once the patient pulls at 10.5 s.
    expect((m?.tEnd ?? 0) - (m?.tStart ?? 0)).toBeLessThan(2.9);
    expect(m?.tEnd ?? 0).toBeGreaterThan(10.5);
    expect(m?.values?.interrupted).toBe(1);
  });
});

describe('setting bounds table', () => {
  it('clampSettings clamps every numeric key to SETTING_BOUNDS', async () => {
    const { SETTING_BOUNDS, clampSettings, defaultSettings } = await import('@sim/vent/settings');
    const s = defaultSettings();
    for (const key of Object.keys(SETTING_BOUNDS) as Array<keyof typeof SETTING_BOUNDS>) {
      const b = SETTING_BOUNDS[key];
      expect(clampSettings({ ...s, [key]: b.max + 1000 })[key], key).toBe(b.max);
      expect(clampSettings({ ...s, [key]: b.min - 1000 })[key], key).toBe(b.min);
    }
    expect(SETTING_BOUNDS.vt).toEqual({ min: 100, max: 1200, unit: 'mL' });
  });
});
