/**
 * PRVC (Spec 2026-09-14 §3, D-023): a VC test breath with a pause estimates compliance; then pressure-controlled
 * breaths adapt ΔP toward the volume target within PRVC_STEP_MAX per breath, between PRVC_MIN_DP above PEEP and
 * highPpeak − PRVC_PMAX_MARGIN; a "volume not achieved" alarm at the ceiling; support withdrawn under a strong effort.
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

describe('PRVC', () => {
  it('starts with a VC test breath with a pause, then pressure-controlled breaths whose volume converges on the target', () => {
    // 70 s at rr 12: the first breath starts at 0.04 s and the period is 5.03 s (device tick + actuator
    // latency), so 60 s would close only five breaths of index >= 6.
    const res = runHeadless({ patient: presetPatient('normal'), settings: { ...defaultSettings('PRVC'), vt: 450, rr: 12, ti: 1.0, peep: 5 }, seed: 1, duration: 70 });
    const b = breathEvents(res.events);
    expect(b[0]?.kind).toBe('vc');
    expect(res.events.some((e) => e.type === 'pause-end' && e.t < 3)).toBe(true);
    for (const e of b.slice(1)) {
      expect(e.kind).toBe('pc');
      expect(e.mandatory).toBe(true);
      expect(e.pTarget).toBeGreaterThanOrEqual(5 + k('PRVC_MIN_DP'));
    }
    // Converged within six breaths: measured Vti within 5 % of the target from breath 6 on.
    const settled = res.breaths.filter((x) => x.index >= 6 && x.tEnd !== null);
    expect(settled.length).toBeGreaterThan(5);
    for (const x of settled) expect(Math.abs(x.vtiMeasured * 1000 - 450) / 450).toBeLessThan(0.05);
  });

  it('changes ΔP by at most PRVC_STEP_MAX per breath', () => {
    const res = runHeadless({ patient: presetPatient('ards-pulmonary'), settings: { ...defaultSettings('PRVC'), vt: 420, rr: 16, ti: 0.9, peep: 10 }, seed: 2, duration: 40 });
    const t = breathEvents(res.events).filter((e) => e.kind === 'pc').map((e) => e.pTarget);
    for (let i = 1; i < t.length; i++) expect(Math.abs((t[i] ?? NaN) - (t[i - 1] ?? NaN))).toBeLessThanOrEqual(k('PRVC_STEP_MAX') + 1e-9);
  });

  it('a stiff lung with a low pressure limit: ΔP climbs to the ceiling, volume falls short, the volume-not-achieved alarm sounds', () => {
    const res = runHeadless({ patient: presetPatient('ards-pulmonary'), settings: { ...defaultSettings('PRVC'), vt: 700, rr: 14, ti: 1.0, peep: 10, alarms: { ...defaultSettings().alarms, highPpeak: 25 } }, seed: 3, duration: 40 });
    const ceiling = 25 - k('PRVC_PMAX_MARGIN');
    const pc = breathEvents(res.events).filter((e) => e.kind === 'pc');
    expect(pc.at(-1)?.pTarget).toBeCloseTo(ceiling, 6);
    expect(res.events.some((e) => e.type === 'alarm' && e.alarm === 'prvc-limit' && e.active)).toBe(true);
    const last = res.breaths.filter((x) => x.tEnd !== null).at(-1);
    expect((last?.vtiMeasured ?? 1) * 1000).toBeLessThan(700 * k('PRVC_LIMIT_VT_FRACTION'));
  });

  it('a strong effort inflates the volume, so the regulator withdraws support down to the floor', () => {
    const patient = presetPatient('ards-pulmonary');
    patient.drive = { ...defaultDriveParams(), rate: 22, ti: 1.0, pmax: 16, cvRate: 0.05, cvTi: 0.05, cvPmax: 0.05 };
    const res = runHeadless({ patient, settings: { ...defaultSettings('PRVC'), vt: 360, rr: 18, ti: 0.9, peep: 10, flowTrigger: 2 }, seed: 4, duration: 60 });
    const pc = breathEvents(res.events).filter((e) => e.kind === 'pc' && e.t > 20);
    expect(pc.length).toBeGreaterThan(10);
    expect(pc.filter((e) => e.pTarget - 10 <= k('PRVC_MIN_DP') + 1e-9).length / pc.length).toBeGreaterThan(0.5);
  });

  it('a change of the target volume restarts with a test breath', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('PRVC'), vt: 450, rr: 12, ti: 1.0, peep: 5 },
      seed: 5,
      duration: 70,
      schedule: [{ t: 20, action: (e) => e.vent.applySettings({ vt: 550 }) }],
    });
    const b = breathEvents(res.events);
    const after = b.filter((e) => e.t > 20);
    expect(after[0]?.kind).toBe('vc');
    expect(after.slice(1).every((e) => e.kind === 'pc')).toBe(true);
    const last = res.breaths.filter((x) => x.tEnd !== null).at(-1);
    expect(Math.abs((last?.vtiMeasured ?? 0) * 1000 - 550) / 550).toBeLessThan(0.05);
  });
});
