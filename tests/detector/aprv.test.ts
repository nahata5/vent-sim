/**
 * Detector on APRV (signal-only, reported not gated): trigger- and cycle-based rules are skipped for aprv breaths;
 * a release that starts inside an effort is reported from the expiratory flow shape at the start of the release.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import { defaultDriveParams } from '@sim/patient/neural-drive';
import { detectRun } from '@/detector/detector';
import { deviceContext } from '@/detector/features';
import { labelRun } from '@sim/truth/labeler';

const aprv = { ...defaultSettings('APRV'), phigh: 28, plow: 0, thigh: 4.0, tlow: 0.5, tlowMode: 'fixed' as const };
const SKIPPED = ['delayed-trigger', 'double-trigger', 'auto-trigger', 'reverse-trigger', 'premature-cycling', 'delayed-cycling', 'flow-starvation', 'ineffective-effort'];

describe('detector on APRV', () => {
  it('device context: Plow is the baseline and Phigh the target', () => {
    const ctx = deviceContext({ ...defaultSettings('APRV'), peep: 10, phigh: 30, plow: 2 });
    expect(ctx.peep).toBe(2);
    expect(ctx.pTarget).toBe(30);
    expect(ctx.breathKind).toBe('aprv');
  });

  it('passive and breathing APRV runs never get a trigger- or cycle-based label from the detector', () => {
    const passive = runHeadless({ patient: presetPatient('ards-pulmonary'), settings: aprv, seed: 1, duration: 60 });
    const patient = presetPatient('ards-pulmonary');
    patient.drive = { ...defaultDriveParams(), rate: 20, ti: 1.0, pmax: 8, cvRate: 0.05, cvTi: 0.05, cvPmax: 0.05 };
    const active = runHeadless({ patient, settings: aprv, seed: 2, duration: 90 });
    for (const res of [passive, active]) {
      const det = detectRun(res).breaths.filter((b) => b.tStart > 5);
      expect(det.length).toBeGreaterThan(8);
      expect(det.some((b) => b.patterns.some((p) => SKIPPED.includes(p)))).toBe(false);
    }
    expect(detectRun(passive).breaths.some((b) => b.patterns.includes('release-collision'))).toBe(false);
  });

  it('release collisions are reported with evidence and agree with the truth on most of them', () => {
    const patient = presetPatient('ards-pulmonary');
    patient.drive = { ...defaultDriveParams(), rate: 20, ti: 1.0, pmax: 8, cvRate: 0.05, cvTi: 0.05, cvPmax: 0.05 };
    const res = runHeadless({ patient, settings: aprv, seed: 2, duration: 90 });
    const truth = labelRun(res).breaths.filter((b) => b.tStart > 5);
    const det = detectRun(res).breaths.filter((b) => b.tStart > 5);
    const truthRc = new Set(truth.filter((b) => b.patterns.includes('release-collision')).map((b) => b.tStart.toFixed(3)));
    expect(truthRc.size).toBeGreaterThan(0);
    const detRc = det.filter((b) => b.patterns.includes('release-collision'));
    expect(detRc.length).toBeGreaterThan(0);
    for (const b of detRc) expect(b.evidence['release-collision']).toMatch(/^release: /);
    const hits = detRc.filter((b) => truthRc.has(b.tStart.toFixed(3))).length;
    // Report-only rule: it must find at least half of the truth collisions and be right at least half the time.
    expect(hits / truthRc.size).toBeGreaterThanOrEqual(0.5);
    expect(hits / detRc.length).toBeGreaterThanOrEqual(0.5);
  });
});
