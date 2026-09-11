import { describe, expect, it } from 'vitest';
import { StreamStore } from '@/app/StreamStore';
import { BATCH_CHANNELS, channelIndex } from '@/worker/protocol';

/** Build a channel-major batch where channel c sample i has value base + 1000·c + i and t = i/fs. */
function batch(fs: number, i0: number, n: number): Float32Array {
  const out = new Float32Array(n * BATCH_CHANNELS.length);
  BATCH_CHANNELS.forEach((ch, c) => {
    for (let i = 0; i < n; i++) out[c * n + i] = ch === 't' ? (i0 + i) / fs : 1000 * c + i0 + i;
  });
  return out;
}

describe('StreamStore ring buffers', () => {
  it('keeps the newest window when more samples arrive than the capacity', () => {
    const s = new StreamStore({ fs: 100, seconds: 1 });
    s.append(batch(100, 0, 60), 60);
    s.append(batch(100, 60, 90), 90);
    expect(s.length).toBe(100);
    expect(s.tOldest).toBeCloseTo(0.5, 5);
    expect(s.tLatest).toBeCloseTo(1.49, 5);
    // Logical index 0 is the oldest retained sample (global index 50).
    expect(s.read('paw', 0)).toBe(1000 * channelIndex('paw') + 50);
    expect(s.read('paw', 99)).toBe(1000 * channelIndex('paw') + 149);
  });

  it('looks up the sample nearest to a time and returns NaN outside the window', () => {
    const s = new StreamStore({ fs: 100, seconds: 2 });
    s.append(batch(100, 0, 150), 150);
    expect(s.valueAt('flow', 0.734)).toBe(1000 * channelIndex('flow') + 73);
    expect(s.valueAt('flow', 1.49)).toBe(1000 * channelIndex('flow') + 149);
    expect(Number.isNaN(s.valueAt('flow', 1.6))).toBe(true);
    expect(Number.isNaN(s.valueAt('flow', -0.1))).toBe(true);
  });

  it('accepts truth channels and a batch larger than the whole capacity', () => {
    const s = new StreamStore({ fs: 100, seconds: 1 });
    s.append(batch(100, 0, 250), 250);
    expect(s.length).toBe(100);
    expect(s.read('truth.pmus', 99)).toBe(1000 * channelIndex('truth.pmus') + 249);
    expect(s.tOldest).toBeCloseTo(1.5, 5);
  });

  it('trims events and breaths older than the window', () => {
    const s = new StreamStore({ fs: 100, seconds: 1 });
    s.addEvents([{ type: 'trigger', t: 0.1, cause: 'time' }]);
    s.addBreaths([{ index: 0, tStart: 0.1, triggerCause: 'time', tInspEnd: 0.6, tPauseEnd: 0.6, cycleCause: 'time', tEnd: 2.0, vtiTrue: 0.4, vteTrue: 0.4, vtiMeasured: 0.4, vteMeasured: 0.4, peakFlowMeasured: 0.5, ppeakMeasured: 20, leakTrue: 0 }], []);
    s.append(batch(100, 0, 100), 100);
    expect(s.events.length).toBe(1);
    s.append(batch(100, 100, 100), 100);
    expect(s.events.length).toBe(0);
    // A breath is kept while any part of it is inside the window.
    expect(s.breaths.length).toBe(1);
    s.append(batch(100, 200, 150), 150);
    expect(s.breaths.length).toBe(0);
  });
});
