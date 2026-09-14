/**
 * Detector on PRVC (signal-only): the support-withdrawal rule reports a regulated pressure sitting at its
 * floor on patient-triggered breaths that still over-deliver the volume target, and stays silent on a
 * passive lung — including one whose low volume target drives the regulator to the same floor.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import { defaultDriveParams } from '@sim/patient/neural-drive';
import { detectRun } from '@/detector/detector';
import { breathEventAt } from '@sim/vent/breath-kind';

const settings = { ...defaultSettings('PRVC'), vt: 360, rr: 18, ti: 0.9, peep: 10, flowTrigger: 2 };

function strongEffortPatient() {
  const patient = presetPatient('ards-pulmonary');
  patient.drive = { ...defaultDriveParams(), rate: 22, ti: 1.0, pmax: 16, cvRate: 0.05, cvTi: 0.05, cvPmax: 0.05 };
  return patient;
}

describe('detector on PRVC', () => {
  it('support withdrawal: the regulated pressure at its floor with the patient supplying the volume', () => {
    const res = runHeadless({ patient: strongEffortPatient(), settings, seed: 4, duration: 60 });
    const det = detectRun(res);
    const pc = det.breaths.filter((b) => b.tStart > 20 && breathEventAt(res.events, b.tStart)?.kind === 'pc');
    expect(pc.length).toBeGreaterThan(5);
    const sw = pc.filter((b) => b.patterns.includes('support-withdrawal'));
    expect(sw.length / pc.length).toBeGreaterThan(0.4);
    for (const b of sw) expect(b.evidence['support-withdrawal']).toMatch(/of the floor .*patient-triggered, Vti \d+ mL/);
  });

  it('no support withdrawal on a passive lung, including one whose low target sits the regulator at the floor', () => {
    const atFloor = runHeadless({ patient: presetPatient('normal'), settings: { ...settings, vt: 200 }, seed: 4, duration: 60 });
    const floorBreaths = detectRun(atFloor).breaths.filter((b) => b.tStart > 20);
    expect(floorBreaths.length).toBeGreaterThan(5);
    // The negative is only meaningful while this run really does sit at the floor: it is the trigger cause
    // and the volume excess, not the pressure gate, that must reject it.
    const dp = floorBreaths.map((b) => (breathEventAt(atFloor.events, b.tStart)?.pTarget ?? NaN) - settings.peep);
    expect(dp.every((x) => x <= defaultSettings('PRVC').prvcMinDp + 1)).toBe(true);
    expect(floorBreaths.some((b) => b.patterns.includes('support-withdrawal'))).toBe(false);

    const passive = runHeadless({ patient: presetPatient('ards-pulmonary'), settings, seed: 4, duration: 60 });
    expect(detectRun(passive).breaths.some((b) => b.patterns.includes('support-withdrawal'))).toBe(false);
  });
});
