/**
 * SIMV (Spec 2026-09-14 §2, D-022): mandatory VC or PC breaths at the set rate, delivered early for a patient
 * effort inside the synchronization window at the end of each period, pressure-supported breaths for
 * efforts earlier in the period. Judged from the breath events and the ventilator timing.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import { defaultDriveParams } from '@sim/patient/neural-drive';
import { k } from '@config/constants';
import type { VentEvent } from '@sim/types';

type BreathEvent = Extract<VentEvent, { type: 'breath' }>;
const breathEvents = (events: VentEvent[]) => events.filter((e): e is BreathEvent => e.type === 'breath');
const patientTriggered = (events: VentEvent[], e: BreathEvent) =>
  events.some((t) => t.type === 'trigger' && t.cause === 'patient' && Math.abs(t.t + k('ACTUATOR_LATENCY') - e.t) < 1e-3);

function activeSimv(simvWindow = k('SIMV_SYNC_WINDOW')) {
  const patient = presetPatient('normal');
  patient.drive = { ...defaultDriveParams(), rate: 20, ti: 0.9, pmax: 8, cvRate: 0.05, cvTi: 0.05, cvPmax: 0.05 };
  return runHeadless({ patient, settings: { ...defaultSettings('SIMV'), simvBase: 'VC', rr: 8, vt: 450, peep: 5, ps: 8, flowTrigger: 2, simvWindow }, seed: 3, duration: 121 });
}

describe('SIMV', () => {
  it('passive patient: mandatory VC breaths at the set rate, one per period, no spontaneous breaths', () => {
    const res = runHeadless({ patient: presetPatient('normal'), settings: { ...defaultSettings('SIMV'), simvBase: 'VC', rr: 10, vt: 450, ps: 8 }, seed: 1, duration: 61 });
    const b = breathEvents(res.events).filter((e) => e.t > 1);
    expect(b.every((e) => e.kind === 'vc' && e.mandatory)).toBe(true);
    expect(b.length).toBeGreaterThanOrEqual(9);
    expect(b.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < b.length; i++) expect(Math.abs((b[i]?.t ?? NaN) - (b[i - 1]?.t ?? NaN) - 6)).toBeLessThan(0.05);
  });

  it('active patient: mandatory breaths keep the set rate, efforts between them get PS breaths with the PS target', () => {
    const res = activeSimv();
    const b = breathEvents(res.events).filter((e) => e.t > 1 && e.t <= 121);
    const mandatory = b.filter((e) => e.mandatory);
    const spont = b.filter((e) => !e.mandatory);
    expect(mandatory.every((e) => e.kind === 'vc')).toBe(true);
    expect(spont.every((e) => e.kind === 'ps' && e.pTarget === 13)).toBe(true);
    // Set rate 8/min over 2 min: 16 mandatory breaths, plus a few when a patient trigger inside the window delivers early.
    expect(mandatory.length).toBeGreaterThanOrEqual(16);
    expect(mandatory.length).toBeLessThanOrEqual(24);
    expect(spont.length).toBeGreaterThan(15);
    // The period clock resets on each mandatory breath: intervals never exceed one period.
    for (let i = 1; i < mandatory.length; i++) expect((mandatory[i]?.t ?? NaN) - (mandatory[i - 1]?.t ?? NaN)).toBeLessThanOrEqual(7.5 + 0.05);
  });

  it('a patient effort inside the synchronization window delivers the mandatory breath early (patient-triggered, mandatory)', () => {
    const res = activeSimv();
    const early = breathEvents(res.events).filter((e) => e.mandatory && patientTriggered(res.events, e));
    expect(early.length).toBeGreaterThan(3);
  });

  it('a narrower window yields fewer patient-triggered mandatory breaths', () => {
    const count = (w: number) => {
      const res = activeSimv(w);
      return breathEvents(res.events).filter((e) => e.mandatory && patientTriggered(res.events, e)).length;
    };
    expect(count(0.05)).toBeLessThan(count(0.5));
  });

  it('SIMV-PC: mandatory breaths are pressure-controlled at PEEP + Pinsp and time-cycled at Ti; spontaneous at PEEP + PS', () => {
    const patient = presetPatient('normal');
    patient.drive = { ...defaultDriveParams(), rate: 18, ti: 0.9, pmax: 8 };
    const res = runHeadless({ patient, settings: { ...defaultSettings('SIMV'), simvBase: 'PC', rr: 10, pinsp: 12, ti: 1.0, peep: 5, ps: 6, flowTrigger: 2 }, seed: 4, duration: 61 });
    const b = breathEvents(res.events).filter((e) => e.t > 1);
    const mand = b.filter((e) => e.mandatory);
    expect(mand.every((e) => e.kind === 'pc' && e.pTarget === 17)).toBe(true);
    expect(b.filter((e) => !e.mandatory).every((e) => e.kind === 'ps' && e.pTarget === 11)).toBe(true);
    expect(mand.length).toBeGreaterThanOrEqual(10);
    const cyc = res.events.filter((e): e is Extract<VentEvent, { type: 'cycle' }> => e.type === 'cycle');
    const first = mand[0];
    if (!first) throw new Error('no mandatory SIMV-PC breath');
    const c = cyc.find((x) => x.t > first.t);
    if (!c) throw new Error('no cycle after the first mandatory breath');
    expect(c.cause).toBe('time');
    expect(Math.abs(c.t - first.t - 1.0)).toBeLessThan(0.02);
  });

  it('the apnea backup never engages in SIMV', () => {
    const res = runHeadless({ patient: presetPatient('normal'), settings: { ...defaultSettings('SIMV'), simvBase: 'VC', rr: 10, vt: 450, apneaTime: 5 }, seed: 1, duration: 40 });
    expect(res.events.some((e) => e.type === 'alarm' && e.alarm === 'apnea')).toBe(false);
    expect(res.events.some((e) => e.type === 'trigger' && e.cause === 'backup')).toBe(false);
  });
});
