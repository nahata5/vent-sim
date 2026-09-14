/**
 * APRV (Spec 2026-09-14 §4, D-024): a long high phase at Phigh with unrestricted spontaneous breathing through a
 * bidirectional servo, releases to Plow ended by time (fixed) or by a fraction of the peak expiratory flow (pefr,
 * TCAV), no patient synchronization; holds, occlusions and PEEP maneuvers refused.
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
const cycles = (events: VentEvent[]) => events.filter((e): e is Extract<VentEvent, { type: 'cycle' }> => e.type === 'cycle');
const triggers = (events: VentEvent[]) => events.filter((e): e is Extract<VentEvent, { type: 'trigger' }> => e.type === 'trigger');

const aprv = { ...defaultSettings('APRV'), phigh: 28, plow: 0, thigh: 4.5, tlow: 0.5, tlowMode: 'fixed' as const };

function breathingPatient(pmax = 8, rate = 20) {
  const patient = presetPatient('ards-pulmonary');
  patient.drive = { ...defaultDriveParams(), rate, ti: 1.0, pmax, cvRate: 0.05, cvTi: 0.05, cvPmax: 0.05 };
  return patient;
}

describe('APRV', () => {
  it('passive patient, fixed release: every breath is an aprv high phase at Phigh, cycled by time at Thigh, released for Tlow, no patient triggers', () => {
    const res = runHeadless({ patient: presetPatient('normal'), settings: aprv, seed: 1, duration: 61 });
    const b = breathEvents(res.events);
    expect(b.length).toBeGreaterThanOrEqual(11);
    expect(b.length).toBeLessThanOrEqual(13);
    for (const e of b) {
      expect(e.kind).toBe('aprv');
      expect(e.mandatory).toBe(true);
      expect(e.pTarget).toBe(28);
    }
    expect(triggers(res.events).every((t) => t.cause === 'time')).toBe(true);
    const cy = cycles(res.events);
    expect(cy.every((c) => c.cause === 'time')).toBe(true);
    // High phase = Thigh; release = Tlow (+ the actuator latency before the next high phase).
    for (const [i, c] of cy.entries()) {
      const start = b[i]?.t ?? NaN;
      expect(Math.abs(c.t - start - 4.5)).toBeLessThan(0.02);
      const next = b[i + 1]?.t;
      if (next !== undefined) expect(Math.abs(next - c.t - 0.5 - k('ACTUATOR_LATENCY'))).toBeLessThan(0.02);
    }
    // Breath records: one per high phase + release.
    const closed = res.breaths.filter((x) => x.tEnd !== null);
    expect(closed.length).toBeGreaterThanOrEqual(10);
    for (const x of closed) {
      expect(Math.abs(x.tInspEnd - x.tStart - 4.5)).toBeLessThan(0.02);
      expect(Math.abs((x.tEnd ?? NaN) - x.tInspEnd - 0.5 - k('ACTUATOR_LATENCY'))).toBeLessThan(0.02);
    }
  });

  it('the servo holds Phigh in both directions: a breathing patient draws and pushes flow at Phigh without a trigger or a cycle', () => {
    const res = runHeadless({ patient: breathingPatient(), settings: aprv, seed: 2, duration: 40 });
    expect(triggers(res.events).every((t) => t.cause === 'time')).toBe(true);
    expect(breathEvents(res.events).every((e) => e.kind === 'aprv')).toBe(true);
    // Inside the high phases (0.5 s after the start, before the cycle): Paw within 3 cmH2O of Phigh and true
    // flow of both signs (the patient breathes at Phigh).
    let pos = 0;
    let neg = 0;
    let worst = 0;
    const b = breathEvents(res.events);
    const cy = cycles(res.events);
    for (const [i, e] of b.entries()) {
      const c = cy[i];
      if (!c) break;
      for (let idx = 0; idx < res.t.length; idx++) {
        const t = res.t[idx] ?? 0;
        if (t < e.t + 0.5 || t > c.t - 0.05) continue;
        worst = Math.max(worst, Math.abs((res.paw[idx] ?? 0) - 28));
        const q = res.truth.flow[idx] ?? 0;
        if (q > 0.05) pos += 1;
        if (q < -0.05) neg += 1;
      }
    }
    expect(worst).toBeLessThan(3);
    expect(pos).toBeGreaterThan(50);
    expect(neg).toBeGreaterThan(50);
  });

  it('pefr mode ends the release when expiratory flow has decayed to the set fraction of its peak, never before APRV_TLOW_MIN and never after the cap', () => {
    const base = { ...aprv, tlowMode: 'pefr' as const, tlow: 1.5 };
    const at75 = runHeadless({ patient: presetPatient('ards-pulmonary'), settings: { ...base, tlowPefr: 0.75 }, seed: 3, duration: 40 });
    const at50 = runHeadless({ patient: presetPatient('ards-pulmonary'), settings: { ...base, tlowPefr: 0.5 }, seed: 3, duration: 40 });
    const releases = (events: VentEvent[]) => {
      const cy = cycles(events);
      const tr = triggers(events);
      return cy.map((c) => (tr.find((t) => t.t > c.t)?.t ?? NaN) - c.t).filter((x) => Number.isFinite(x));
    };
    const r75 = releases(at75.events);
    const r50 = releases(at50.events);
    expect(r75.length).toBeGreaterThan(5);
    for (const r of r75) {
      expect(r).toBeGreaterThanOrEqual(k('APRV_TLOW_MIN') - 1e-6);
      expect(r).toBeLessThan(1.5);
    }
    // A lower fraction waits longer for the flow to decay.
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    expect(mean(r50)).toBeGreaterThan(mean(r75) + 0.05);
    // Fixed mode with the same settings releases for exactly tlow.
    const fixed = runHeadless({ patient: presetPatient('ards-pulmonary'), settings: { ...base, tlowMode: 'fixed', tlow: 0.8 }, seed: 3, duration: 40 });
    for (const r of releases(fixed.events)) expect(Math.abs(r - 0.8)).toBeLessThan(0.02);
  });

  it('holds, occlusions and PEEP maneuvers are refused in APRV; nothing interrupts the high/release cycle', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: aprv,
      seed: 4,
      duration: 40,
      schedule: [
        { t: 8, action: (e) => e.vent.requestHold('exp') },
        { t: 12, action: (e) => e.vent.requestHold('insp') },
        { t: 16, action: (e) => e.vent.requestOcclusion('p01') },
        { t: 20, action: (e) => e.vent.requestPeepManeuver('ri') },
      ],
    });
    expect(res.events.some((e) => e.type === 'hold-start')).toBe(false);
    expect(res.events.some((e) => e.type === 'maneuver')).toBe(false);
    expect(res.maneuvers.length).toBe(0);
    const b = breathEvents(res.events);
    for (let i = 1; i < b.length; i++) expect(Math.abs((b[i]?.t ?? NaN) - (b[i - 1]?.t ?? NaN) - 5 - k('ACTUATOR_LATENCY'))).toBeLessThan(0.02);
  });

  it('the low-PEEP (disconnect) alarm judges Paw against Plow, not the unused PEEP setting', () => {
    // PEEP 10 left in the settings object while Plow is 0: a release to 0 must not read as a disconnect.
    const res = runHeadless({ patient: presetPatient('normal'), settings: { ...aprv, peep: 10 }, seed: 5, duration: 30 });
    expect(res.events.some((e) => e.type === 'alarm' && e.alarm === 'disconnect' && e.active)).toBe(false);
  });

  it('breath kind and target helpers know APRV', async () => {
    const { breathKindFromMode, pTargetFromSettings } = await import('@sim/vent/breath-kind');
    expect(breathKindFromMode({ mode: 'APRV' })).toBe('aprv');
    expect(pTargetFromSettings({ ...defaultSettings('APRV'), phigh: 30 })).toBe(30);
  });

  it('switching into APRV from an apnea backup delivers APRV breaths and clears the apnea alarm', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('PSV'), apneaTime: 8 },
      seed: 6,
      duration: 50,
      schedule: [{ t: 25, action: (e) => e.vent.applySettings({ mode: 'APRV', phigh: 28, plow: 0, thigh: 4.5, tlow: 0.5, tlowMode: 'fixed' }) }],
    });
    expect(res.events.some((e) => e.type === 'alarm' && e.alarm === 'apnea' && e.active && e.t < 25)).toBe(true);
    const after = breathEvents(res.events).filter((e) => e.t > 26);
    expect(after.length).toBeGreaterThan(3);
    expect(after.every((e) => e.kind === 'aprv' && e.pTarget === 28)).toBe(true);
    const apnea = res.events.filter((e): e is Extract<VentEvent, { type: 'alarm' }> => e.type === 'alarm' && e.alarm === 'apnea');
    expect(apnea.at(-1)?.active).toBe(false);
  });
});
