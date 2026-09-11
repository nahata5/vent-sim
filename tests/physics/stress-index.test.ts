/**
 * Stress index (Brief 2 §2.3, Grasso 2004 / Ranieri 2000): on passive constant-flow VC breaths the monitor
 * fits Paw = a·t^b + c after the resistive step. b ≈ 1 for a linear lung, b < 0.9 with tidal recruitment
 * (compliance improving during the insufflation), b > 1.1 with overdistension.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient, recruitableRecoil } from '@sim/patient/presets';
import { linearPatient } from '@sim/patient/params';
import { Monitor } from '@/monitor/monitor';
import { stressIndexFit } from '@/monitor/stress-index';

function monitorFor(res: ReturnType<typeof runHeadless>): Monitor {
  const mon = new Monitor({ fs: res.fs, pbw: 70 });
  let ei = 0;
  for (let i = 0; i < res.t.length; i++) {
    const t = res.t[i] ?? 0;
    mon.onSample({ t, paw: res.paw[i] ?? 0, flow: res.flow[i] ?? 0, vol: res.vol[i] ?? 0, pes: res.pes[i] ?? 0 });
    while (ei < res.events.length && (res.events[ei]?.t ?? Infinity) <= t + 1e-6) {
      const e = res.events[ei];
      if (e) mon.onEvent(e);
      ei += 1;
    }
  }
  return mon;
}

describe('stress index (§5 maneuvers, Brief 2 §2.3)', () => {
  it('fit: recovers b from synthetic power-law ramps with noise', () => {
    const fs = 100;
    for (const b of [0.8, 1.0, 1.25]) {
      const t: number[] = [];
      const p: number[] = [];
      for (let i = 0; i <= 80; i++) {
        const tt = 0.15 + i / fs;
        t.push(tt);
        p.push(12 + 6 * Math.pow(tt, b) + 0.15 * Math.sin(i * 1.7)); // deterministic "noise"
      }
      const fit = stressIndexFit(t, p);
      expect(fit).not.toBeNull();
      expect(Math.abs((fit?.b ?? 0) - b)).toBeLessThan(0.06);
    }
  });

  it('linear passive lung on square-flow VC: b within 0.9–1.1', () => {
    const res = runHeadless({ patient: linearPatient({ C: 0.05, R: 10 }), settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 500, rr: 15, peakFlow: 40, flowPattern: 'square' }, seed: 1, duration: 30 });
    const mon = monitorFor(res);
    const b = mon.latest?.stressIndex ?? null;
    expect(b).not.toBeNull();
    expect(b ?? 0).toBeGreaterThan(0.9);
    expect(b ?? 0).toBeLessThan(1.1);
  });

  it('tidal recruitment (consolidated ARDS driven to a plateau that opens units during inflation): b < 0.9 with units cycling; overdistension (normal lung, PEEP 15, 13 mL/kg): b > 1.1', () => {
    // Consolidated units open only above ≈ 30 cmH2O of transpulmonary pressure, so an injurious setting
    // (12 mL/kg at PEEP 16, plateau ≈ 50) is what makes them cycle; the stress index drops below 0.9
    // exactly when the truth counts many units opening and closing within the breath.
    const low = runHeadless({ patient: presetPatient('ards-pulmonary', { recoil: recruitableRecoil('ards-pulmonary') }), settings: { ...defaultSettings('VC-AC'), peep: 16, vt: 840, rr: 12, peakFlow: 40, flowPattern: 'square', alarms: { ...defaultSettings().alarms, highPpeak: 70 } }, seed: 1, duration: 30 });
    const bLow = monitorFor(low).latest?.stressIndex ?? NaN;
    expect(bLow).toBeLessThan(0.9);
    const lastLow = low.breaths.filter((b) => b.tEnd !== null).at(-1);
    expect(lastLow?.tidalRecruitUnits ?? 0).toBeGreaterThanOrEqual(2); // the hidden truth behind b < 0.9
    const high = runHeadless({ patient: presetPatient('normal', { recoil: recruitableRecoil('normal') }), settings: { ...defaultSettings('VC-AC'), peep: 15, vt: 900, rr: 12, peakFlow: 40, flowPattern: 'square', alarms: { ...defaultSettings().alarms, highPpeak: 70 } }, seed: 1, duration: 30 });
    const bHigh = monitorFor(high).latest?.stressIndex ?? NaN;
    expect(bHigh).toBeGreaterThan(1.1);
    expect(high.breaths.filter((b) => b.tEnd !== null).at(-1)?.tidalRecruitUnits ?? 1).toBe(0);
  });

  it('not reported on patient-triggered or decelerating-flow breaths', () => {
    const res = runHeadless({ patient: linearPatient({ C: 0.05, R: 10 }), settings: { ...defaultSettings('PC-AC'), peep: 5, pinsp: 12, rr: 15 }, seed: 1, duration: 20 });
    expect(monitorFor(res).latest?.stressIndex ?? null).toBeNull();
  });
});
