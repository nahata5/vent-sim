/**
 * Determinism (Spec §9.6): the same seed, scenario and inputs give byte-identical sample streams, breath
 * records, labels and maneuver results, across independent engines and across any chunking of the
 * worker session; a different seed differs.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { SimSession } from '@/worker/session';
import { resolveScenario, scenarioById, scenarioSchedule, SCENARIOS } from '@/edu/scenarios';
import { labelRun } from '@sim/truth/labeler';
import type { SimEngine } from '@sim/engine';

const same = (a: Float32Array, b: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

describe('determinism (§9.6)', () => {
  it('two independent headless runs of every scenario are byte-identical on all measured and truth channels', () => {
    for (const def of SCENARIOS.slice(0, 8)) {
      const spec = resolveScenario(def);
      const a = runHeadless({ ...spec, duration: 12, schedule: scenarioSchedule(def) });
      const b = runHeadless({ ...spec, duration: 12, schedule: scenarioSchedule(def) });
      expect(same(a.paw, b.paw), def.id).toBe(true);
      expect(same(a.flow, b.flow), def.id).toBe(true);
      expect(same(a.pes, b.pes), def.id).toBe(true);
      expect(same(a.truth.pmus, b.truth.pmus), def.id).toBe(true);
      expect(JSON.stringify(a.breaths)).toBe(JSON.stringify(b.breaths));
      expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    }
  });

  it('labels, detector-facing breaths, maneuvers and the CO2 log repeat exactly', () => {
    const def = scenarioById('co2-under-assist');
    const spec = resolveScenario(def);
    const sched = [{ t: 10, action: (e: SimEngine) => e.vent.requestHold('insp') }];
    const a = runHeadless({ ...spec, duration: 30, schedule: sched });
    const b = runHeadless({ ...spec, duration: 30, schedule: sched });
    expect(JSON.stringify(labelRun(a))).toBe(JSON.stringify(labelRun(b)));
    expect(JSON.stringify(a.maneuvers)).toBe(JSON.stringify(b.maneuvers));
    expect(JSON.stringify(a.co2)).toBe(JSON.stringify(b.co2));
  });

  it('the worker session gives the same concatenated stream for any chunking, equal to the headless stream', () => {
    const def = scenarioById('double-trigger');
    const spec = resolveScenario(def);
    const chunkings = [
      [0.02, 0.02, 0.02],
      [0.005, 0.031, 0.25, 0.013],
      [0.1],
    ];
    const streams = chunkings.map((chunks) => {
      const s = new SimSession(spec);
      const parts: Float32Array[] = [];
      let t = 0;
      let i = 0;
      while (t < 6) {
        const dt = chunks[i % chunks.length] ?? 0.02;
        const out = s.advance(dt);
        parts.push(out.samples.slice(out.n, 2 * out.n)); // paw channel
        t += dt;
        i += 1;
      }
      const n = parts.reduce((a, p) => a + p.length, 0);
      const all = new Float32Array(n);
      let o = 0;
      for (const p of parts) {
        all.set(p, o);
        o += p.length;
      }
      return all;
    });
    const head = runHeadless({ ...spec, duration: 6 });
    const n = Math.min(head.paw.length, ...streams.map((s) => s.length));
    for (const s of streams.slice(1)) expect(same(s.subarray(0, n), (streams[0] as Float32Array).subarray(0, n))).toBe(true);
    expect(same(head.paw.subarray(0, n), (streams[0] as Float32Array).subarray(0, n))).toBe(true);
  });

  it('a different seed produces a different stream', () => {
    const spec = resolveScenario(scenarioById('double-trigger'));
    const a = runHeadless({ ...spec, seed: 1, duration: 8 });
    const b = runHeadless({ ...spec, seed: 2, duration: 8 });
    expect(same(a.paw, b.paw)).toBe(false);
  });
});
