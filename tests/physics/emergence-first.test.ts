/**
 * M4 exit: first emergent patterns seen in headless runs, judged from neural timing vs ventilator timing
 * (the ground-truth labeler proper arrives in M6).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import { defaultDriveParams } from '@sim/patient/neural-drive';

describe('first emergent patterns', () => {
  it('COPD on PSV with weak efforts and short Te: ineffective efforts appear (no trigger within the effort)', () => {
    const patient = presetPatient('copd');
    patient.drive = { ...defaultDriveParams(), rate: 26, ti: 0.8, pmax: 4, cvRate: 0.1, cvTi: 0.1, cvPmax: 0.15 };
    const res = runHeadless({
      patient,
      settings: { ...defaultSettings('PSV'), peep: 0, ps: 16, ets: 0.1, tiMax: 2.5, flowTrigger: 3, apneaTime: 30 },
      seed: 11,
      duration: 120,
    });
    const triggers = res.events.filter((e) => e.type === 'trigger' && e.cause === 'patient').map((e) => e.t);
    const efforts = res.neuralBreaths.filter((b) => b.tOnset > 10 && b.tOnset < 110);
    const ineffective = efforts.filter((b) => !triggers.some((t) => t >= b.tOnset && t <= b.tOnset + b.ti + 0.3));
    expect(efforts.length).toBeGreaterThan(20);
    expect(ineffective.length / efforts.length).toBeGreaterThan(0.2);
  });

  it('ARDS on VC with short Ti and high drive: double triggers appear (two triggers in one effort)', () => {
    const patient = presetPatient('ards-pulmonary');
    patient.drive = { ...defaultDriveParams(), rate: 22, ti: 1.3, pmax: 14, cvRate: 0.1, cvTi: 0.1, cvPmax: 0.1 };
    const res = runHeadless({
      patient,
      settings: { ...defaultSettings('VC-AC'), peep: 10, vt: 380, peakFlow: 60, rr: 16, refractory: 0.2 },
      seed: 5,
      duration: 90,
    });
    const triggers = res.events.filter((e) => e.type === 'trigger').map((e) => e.t);
    const efforts = res.neuralBreaths.filter((b) => b.tOnset > 10);
    const doubles = efforts.filter((b) => triggers.filter((t) => t >= b.tOnset - 0.1 && t <= b.tOnset + b.ti + 0.4).length >= 2);
    expect(efforts.length).toBeGreaterThan(20);
    expect(doubles.length / efforts.length).toBeGreaterThan(0.2);
  });

  it('VC with low flow and strong effort: Paw is scooped (flow starvation), the truth Pmus explains it', () => {
    const patient = presetPatient('normal');
    patient.drive = { ...defaultDriveParams(), rate: 14, ti: 0.9, pmax: 15, cvRate: 0, cvTi: 0, cvPmax: 0 };
    const res = runHeadless({
      patient,
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 500, peakFlow: 35, rr: 12 },
      seed: 2,
      duration: 40,
    });
    // Concavity: mid-inspiration Paw below the chord between the start and end of the ramp. Use a
    // patient-triggered breath that is not the second of a stacked pair.
    const all = res.breaths;
    const b = all
      .filter((x, i) => x.triggerCause === 'patient' && x.tEnd !== null && i > 0 && x.tStart - (all[i - 1]?.tStart ?? 0) > 2)
      .at(-1);
    if (!b) throw new Error('no patient-triggered breath');
    const i0 = Math.round((b.tStart + 0.1) * res.fs);
    const i1 = Math.round((b.tInspEnd - 0.05) * res.fs);
    const im = Math.round((i0 + i1) / 2);
    const chord = 0.5 * ((res.paw[i0] ?? 0) + (res.paw[i1] ?? 0));
    expect(res.paw[im] ?? 0).toBeLessThan(chord - 1);
  });

  it('reverse triggering: entrained efforts follow machine breaths with a stable delay', () => {
    const patient = presetPatient('ards-pulmonary');
    patient.drive = {
      ...defaultDriveParams(),
      rate: 10,
      ti: 0.9,
      pmax: 6,
      entrainment: { ratio: 1, delay: 0.4, jitter: 0.03 },
    };
    const res = runHeadless({
      patient,
      settings: { ...defaultSettings('VC-AC'), peep: 10, vt: 420, peakFlow: 45, rr: 18 },
      seed: 9,
      duration: 60,
    });
    // Every insufflation entrains (a stacked, patient-triggered breath included); most are machine breaths.
    const machine = res.breaths.filter((x) => x.triggerCause === 'time').map((x) => x.tStart);
    const starts = res.breaths.map((x) => x.tStart);
    expect(machine.length).toBeGreaterThan(10);
    expect(machine.length / starts.length).toBeGreaterThan(0.5);
    const efforts = res.neuralBreaths.filter((b) => b.tOnset > 5);
    const delays = efforts.map((e) => e.tOnset - (starts.filter((m) => m <= e.tOnset).at(-1) ?? 0));
    const mean = delays.reduce((s, x) => s + x, 0) / delays.length;
    expect(Math.abs(mean - 0.4)).toBeLessThan(0.08);
  });
});
