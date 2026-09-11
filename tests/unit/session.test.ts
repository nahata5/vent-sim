/**
 * SimSession is the worker's pure core: one SimEngine advanced by simulated seconds, emitting
 * channel-major Float32Array batches plus events and breaths. It must be deterministic regardless of
 * how the wall clock chunks the advance calls.
 */
import { describe, expect, it } from 'vitest';
import { SimSession, type SessionOutput } from '@/worker/session';
import { BATCH_CHANNELS, channelIndex } from '@/worker/protocol';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import { defaultDriveParams } from '@sim/patient/neural-drive';
import { defaultBalloon } from '@sim/patient/balloon';
import { createRng } from '@sim/math/prng';

function makeSession(seed = 3): SimSession {
  const patient = presetPatient('normal');
  patient.drive = { ...defaultDriveParams(), rate: 14, pmax: 6 };
  return new SimSession({ patient, settings: { ...defaultSettings('PSV'), ps: 8 }, seed });
}

function collect(outputs: SessionOutput[]): { channels: Map<string, number[]>; events: unknown[]; breaths: unknown[] } {
  const channels = new Map<string, number[]>();
  for (const ch of BATCH_CHANNELS) channels.set(ch, []);
  const events: unknown[] = [];
  const breaths: unknown[] = [];
  for (const o of outputs) {
    for (const ch of BATCH_CHANNELS) {
      const off = channelIndex(ch) * o.n;
      const arr = channels.get(ch);
      for (let i = 0; i < o.n; i++) arr?.push(o.samples[off + i] ?? NaN);
    }
    events.push(...o.events);
    breaths.push(...o.breaths);
  }
  return { channels, events, breaths };
}

describe('SimSession', () => {
  it('emits channel-major batches at the device rate with a monotonic time channel', () => {
    const s = makeSession();
    const out = s.advance(1.0);
    expect(s.fs).toBe(100);
    expect(out.n).toBe(100);
    expect(out.samples.length).toBe(100 * BATCH_CHANNELS.length);
    const tOff = channelIndex('t') * out.n;
    for (let i = 1; i < out.n; i++) {
      expect((out.samples[tOff + i] ?? 0) - (out.samples[tOff + i - 1] ?? 0)).toBeCloseTo(0.01, 6);
    }
    expect(out.t1).toBeCloseTo(1.0, 6);
    // Truth and measured channels are both present.
    expect(BATCH_CHANNELS).toContain('paw');
    expect(BATCH_CHANNELS).toContain('truth.pmus');
    expect(BATCH_CHANNELS).toContain('truth.plD');
  });

  it('carries fractional steps across advance calls (no lost or duplicated samples)', () => {
    const s = makeSession();
    let n = 0;
    for (let i = 0; i < 100; i++) n += s.advance(0.0137).n;
    expect(n).toBe(Math.floor(1.37 * 100 + 1e-6));
    expect(s.t).toBeCloseTo(1.37, 3);
  });

  it('is byte-identical for the same seed and commands regardless of how the advance is chunked', () => {
    const a = makeSession(7);
    const b = makeSession(7);
    const outA: SessionOutput[] = [];
    const outB: SessionOutput[] = [];
    const T = 12;
    let appliedA = false;
    while (a.t < T - 1e-9) {
      if (!appliedA && a.t >= 5 - 1e-9) {
        a.applySettings({ ps: 14, peep: 8 });
        a.requestManeuver('exp');
        appliedA = true;
      }
      outA.push(a.advance(Math.min(0.02, T - a.t)));
    }
    const rng = createRng('chunks');
    let appliedB = false;
    while (b.t < T - 1e-9) {
      if (!appliedB && b.t >= 5 - 1e-9) {
        b.applySettings({ ps: 14, peep: 8 });
        b.requestManeuver('exp');
        appliedB = true;
      }
      const pick = [0.01, 0.03, 0.07][Math.floor(rng.next() * 3)] ?? 0.01;
      const cap = b.t < 5 ? 5 - b.t : T - b.t;
      outB.push(b.advance(Math.min(pick, cap)));
    }
    const A = collect(outA);
    const B = collect(outB);
    for (const ch of BATCH_CHANNELS) {
      const x = A.channels.get(ch) ?? [];
      const y = B.channels.get(ch) ?? [];
      expect(y.length, ch).toBe(x.length);
      expect(y, ch).toEqual(x);
    }
    expect(JSON.stringify(B.events)).toBe(JSON.stringify(A.events));
    expect(JSON.stringify(B.breaths)).toBe(JSON.stringify(A.breaths));
    expect(A.events.some((e) => (e as { type: string }).type === 'maneuver')).toBe(true);
  });

  it('reports pending settings until the ventilator commits them at the next breath', () => {
    const s = makeSession();
    s.advance(0.5);
    s.applySettings({ ps: 12 });
    expect(s.status().pending).toContain('ps');
    expect(s.status().settings.ps).toBe(8);
    s.advance(10);
    expect(s.status().pending).toEqual([]);
    expect(s.status().settings.ps).toBe(12);
  });

  it('returns maneuver results through the event stream', () => {
    const s = makeSession();
    s.advance(2);
    s.requestManeuver('exp');
    const out = collect([s.advance(15)]);
    const m = out.events.find((e) => (e as { type: string }).type === 'maneuver') as { result: { kind: string; peepTotal?: number } } | undefined;
    expect(m?.result.kind).toBe('exp');
    expect(m?.result.peepTotal).toBeGreaterThan(3);
  });

  it('enabling the esophageal balloon adds the supine offset and wall pressure to the measured Pes', () => {
    const s = makeSession();
    const before = collect([s.advance(6)]);
    s.setBalloon({ ...defaultBalloon(), enabled: true });
    s.advance(1);
    const after = collect([s.advance(6)]);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const dPes = mean(after.channels.get('pes') ?? []) - mean(before.channels.get('pes') ?? []);
    expect(dPes).toBeGreaterThan(3.5);
    expect(dPes).toBeLessThan(6.5);
    expect(s.status().settings.esophagealBalloon).toBe(true);
  });

  it('collects neural breaths for the labeler and truth display', () => {
    const s = makeSession();
    const out = collect([s.advance(20)]);
    expect(out.breaths.length).toBeGreaterThan(2);
    expect(s.neuralBreaths().length).toBeGreaterThan(3);
  });
});
