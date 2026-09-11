/**
 * StreamStore: main-thread ring buffers for every batch channel (measured + truth) over a fixed
 * scrollback window, plus the breath table, ventilator events and neural breaths inside that window.
 * Rendering reads it directly every frame; nothing here allocates per sample.
 */
import type { BreathRecord, VentEvent } from '../sim/types';
import type { NeuralBreath } from '../sim/patient/neural-drive';
import { BATCH_CHANNELS, channelIndex, type ChannelKey } from '../worker/protocol';

export interface StreamStoreOptions {
  fs: number;
  seconds: number;
}

export class StreamStore {
  readonly fs: number;
  readonly capacity: number;
  private readonly buf: Float32Array[];
  private head = 0; // next write position
  private count = 0;
  events: VentEvent[] = [];
  breaths: BreathRecord[] = [];
  neural: NeuralBreath[] = [];
  /** Total samples ever appended (for change detection). */
  appended = 0;

  constructor(opts: StreamStoreOptions) {
    this.fs = opts.fs;
    this.capacity = Math.max(1, Math.round(opts.fs * opts.seconds));
    this.buf = BATCH_CHANNELS.map(() => new Float32Array(this.capacity));
  }

  get length(): number {
    return this.count;
  }

  get tLatest(): number {
    return this.count === 0 ? NaN : this.read('t', this.count - 1);
  }

  get tOldest(): number {
    return this.count === 0 ? NaN : this.read('t', 0);
  }

  /** Append a channel-major batch of n samples. */
  append(samples: Float32Array, n: number): void {
    if (n <= 0) return;
    // Only the last `capacity` samples of an oversized batch can be kept.
    const skip = Math.max(0, n - this.capacity);
    const m = n - skip;
    for (let c = 0; c < this.buf.length; c++) {
      const dst = this.buf[c];
      if (!dst) continue;
      const src = samples.subarray(c * n + skip, c * n + n);
      const first = Math.min(m, this.capacity - this.head);
      dst.set(src.subarray(0, first), this.head);
      if (first < m) dst.set(src.subarray(first), 0);
    }
    this.head = (this.head + m) % this.capacity;
    this.count = Math.min(this.capacity, this.count + m);
    this.appended += n;
    this.trim();
  }

  /** Read logical index i (0 = oldest retained). */
  read(ch: ChannelKey, i: number): number {
    const arr = this.buf[channelIndex(ch)];
    if (!arr || i < 0 || i >= this.count) return NaN;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    return arr[(start + i) % this.capacity] ?? NaN;
  }

  /** Logical index of the sample nearest to t, or −1 outside the window (±½ sample). */
  indexAt(t: number): number {
    if (this.count === 0) return -1;
    const t0 = this.tOldest;
    const i = Math.round((t - t0) * this.fs);
    if (i < 0 || i >= this.count) return -1;
    return i;
  }

  valueAt(ch: ChannelKey, t: number): number {
    const i = this.indexAt(t);
    return i < 0 ? NaN : this.read(ch, i);
  }

  addEvents(events: VentEvent[]): void {
    if (events.length) this.events.push(...events);
  }

  addBreaths(breaths: BreathRecord[], neural: NeuralBreath[]): void {
    if (breaths.length) this.breaths.push(...breaths);
    if (neural.length) this.neural.push(...neural);
  }

  private trim(): void {
    const tMin = this.tOldest;
    if (Number.isNaN(tMin)) return;
    if (this.events.length && (this.events[0]?.t ?? Infinity) < tMin) this.events = this.events.filter((e) => e.t >= tMin);
    if (this.breaths.length && (this.breaths[0]?.tEnd ?? Infinity) < tMin) {
      this.breaths = this.breaths.filter((b) => b.tEnd === null || b.tEnd >= tMin);
    }
    if (this.neural.length && (this.neural[0]?.tEnd ?? Infinity) < tMin) this.neural = this.neural.filter((b) => b.tEnd >= tMin);
  }
}
