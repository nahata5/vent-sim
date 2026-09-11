/**
 * M3 monitor values from measured signals match analytic expectations (Brief 1 §2.7).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { linearPatient } from '@sim/patient/params';
import { presetPatient } from '@sim/patient/presets';
import { Monitor } from '@/monitor/monitor';

function monitorFor(res: ReturnType<typeof runHeadless>) {
  const mon = new Monitor({ fs: res.fs, pbw: 70 });
  // Replay the device-rate stream and events in time order, as the main thread would.
  let ev = 0;
  for (let i = 0; i < res.t.length; i++) {
    const t = res.t[i] ?? 0;
    while (ev < res.events.length && (res.events[ev]?.t ?? Infinity) <= t) {
      const e = res.events[ev];
      if (e) mon.onEvent(e);
      ev += 1;
    }
    mon.onSample({ t, paw: res.paw[i] ?? 0, flow: res.flow[i] ?? 0, vol: res.vol[i] ?? 0, pes: null });
  }
  return mon;
}

describe('monitor', () => {
  it('passive VC with pause: Ppeak, Pplat, ΔP, Cstat, Raw, Vt, RR, I:E, mean Paw match the physics', () => {
    const C = 0.05;
    const R = 12;
    const vt = 500;
    const peakFlow = 30; // 0.5 L/s, Ti 1 s
    const rr = 12;
    const pause = 0.5;
    const res = runHeadless({
      patient: linearPatient({ C, R }),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt, peakFlow, rr, pause },
      seed: 1,
      duration: 40,
      schedule: [{ t: 25, action: (e) => e.vent.requestHold('exp', 3) }],
    });
    const mon = monitorFor(res);
    const m = mon.latest;
    if (!m) throw new Error('no breath metrics');
    const Q = peakFlow / 60;
    const expectedPplat = 5 + vt / 1000 / C;
    expect(m.pplat).not.toBeNull();
    expect(Math.abs((m.pplat ?? 0) - expectedPplat)).toBeLessThan(0.5);
    expect(Math.abs(m.ppeak - (expectedPplat + R * Q))).toBeLessThan(0.7);
    expect(m.peepTotal).not.toBeNull();
    expect(Math.abs((m.peepTotal ?? 0) - 5)).toBeLessThan(0.3);
    expect(Math.abs((m.drivingPressure ?? 0) - vt / 1000 / C)).toBeLessThan(0.6);
    expect(Math.abs((m.cstat ?? 0) - C * 1000) / (C * 1000)).toBeLessThan(0.06);
    expect(Math.abs((m.raw ?? 0) - R) / R).toBeLessThan(0.1);
    expect(Math.abs(m.vti - vt) / vt).toBeLessThan(0.03);
    expect(Math.abs(m.vte - vt) / vt).toBeLessThan(0.03);
    expect(m.pmean).toBeGreaterThan(5);
    expect(m.pmean).toBeLessThan(expectedPplat);
    expect(m.leakPct).toBeLessThan(3);
    // Rate-type values: read a breath before the expiratory hold, which legitimately delays one breath.
    const pre = mon.breaths.find((b) => b.index >= 3 && b.tEnd < 25);
    if (!pre) throw new Error('no pre-hold breath');
    expect(Math.abs(pre.rrTotal - rr)).toBeLessThan(0.6);
    expect(Math.abs(pre.ti - 1.5)).toBeLessThan(0.03); // includes the pause
    expect(Math.abs(pre.ie - 1.5 / 3.5)).toBeLessThan(0.02);
    expect(Math.abs(pre.veMinute - (rr * vt) / 1000) / ((rr * vt) / 1000)).toBeLessThan(0.05);
  });

  it('least-squares R and C on passive breaths recover the true mechanics within 10%', () => {
    const C = 0.04;
    const R = 15;
    const res = runHeadless({
      patient: linearPatient({ C, R }),
      settings: { ...defaultSettings('PC-AC'), peep: 6, pinsp: 12, ti: 1, rr: 14 },
      seed: 2,
      duration: 20,
    });
    const m = monitorFor(res).latest;
    if (!m) throw new Error('no breath metrics');
    expect(Math.abs(m.lsqC - C * 1000) / (C * 1000)).toBeLessThan(0.1);
    expect(Math.abs(m.lsqR - R) / R).toBeLessThan(0.1);
  });

  it('intrinsic PEEP from an expiratory hold appears when Te is short in COPD', () => {
    const res = runHeadless({
      patient: presetPatient('copd'),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 500, peakFlow: 40, rr: 24 },
      seed: 1,
      duration: 40,
      schedule: [{ t: 30, action: (e) => e.vent.requestHold('exp', 3) }],
    });
    const m = monitorFor(res).latest;
    if (!m) throw new Error('no breath metrics');
    expect(m.peepi ?? 0).toBeGreaterThan(1.5);
    // end-expiratory flow is still non-zero at the trigger point
    expect(m.endExpFlow).toBeLessThan(-2 / 60);
  });

  it('RSBI and Vt per kg PBW are reported', () => {
    const res = runHeadless({
      patient: presetPatient('normal'),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 420, peakFlow: 40, rr: 15 },
      seed: 1,
      duration: 20,
    });
    const m = monitorFor(res).latest;
    if (!m) throw new Error('no breath metrics');
    expect(Math.abs(m.vtPerKg - 6)).toBeLessThan(0.3);
    expect(Math.abs(m.rsbi - 15 / 0.42)).toBeLessThan(4);
  });
});
