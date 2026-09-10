/**
 * Headless runner: run a scenario for N seconds and return device-rate streams plus breath records.
 * Used by the physics tests, the emergence matrix and the batch generator.
 */
import { SimEngine, type EngineOptions } from './engine';
import { TRUTH_CHANNELS, type TruthChannel } from './channels';
import type { BreathRecord, VentEvent } from './types';

export interface HeadlessOptions extends EngineOptions {
  duration: number; // s
  /** Optional callback to change inputs mid-run (e.g. apply a fix at t = 60 s). */
  schedule?: Array<{ t: number; action: (engine: SimEngine) => void }>;
}

export interface HeadlessResult {
  fs: number;
  t: Float32Array;
  paw: Float32Array;
  flow: Float32Array;
  vol: Float32Array;
  pes: Float32Array;
  truth: Record<TruthChannel, Float32Array>;
  breaths: BreathRecord[];
  events: VentEvent[];
}

export function runHeadless(opts: HeadlessOptions): HeadlessResult {
  const engine = new SimEngine(opts);
  const fs = opts.settings.deviceRate;
  const n = Math.round(opts.duration * fs);
  const t = new Float32Array(n);
  const paw = new Float32Array(n);
  const flow = new Float32Array(n);
  const vol = new Float32Array(n);
  const pes = new Float32Array(n);
  const truth = {} as Record<TruthChannel, Float32Array>;
  for (const ch of TRUTH_CHANNELS) truth[ch] = new Float32Array(n);
  let i = 0;
  engine.onSample = (s) => {
    if (i >= n) return;
    t[i] = s.t;
    paw[i] = s.paw;
    flow[i] = s.flow;
    vol[i] = s.vol;
    pes[i] = s.pes;
    for (const ch of TRUTH_CHANNELS) truth[ch][i] = s.truth[ch];
    i += 1;
  };
  const schedule = [...(opts.schedule ?? [])].sort((a, b) => a.t - b.t);
  let next = 0;
  const totalSteps = Math.round(opts.duration / engine.dt);
  for (let s = 0; s < totalSteps; s++) {
    while (next < schedule.length && (schedule[next]?.t ?? Infinity) <= engine.t) {
      schedule[next]?.action(engine);
      next += 1;
    }
    engine.step();
  }
  return { fs, t, paw, flow, vol, pes, truth, breaths: engine.breaths, events: engine.events };
}
