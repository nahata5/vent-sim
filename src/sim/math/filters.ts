import type { Rng } from './prng';

/** First-order low-pass filter, exact discretization for a fixed dt. */
export class LowPass {
  private y: number;
  private readonly a: number;
  constructor(tau: number, dt: number, initial = 0) {
    this.a = tau > 0 ? Math.exp(-dt / tau) : 0;
    this.y = initial;
  }
  push(x: number): number {
    this.y = this.a * this.y + (1 - this.a) * x;
    return this.y;
  }
  get value(): number {
    return this.y;
  }
  reset(v: number): void {
    this.y = v;
  }
}

/** Fixed transport delay implemented as a ring buffer of n samples. */
export class DelayLine {
  private readonly buf: Float64Array;
  private idx = 0;
  constructor(samples: number, initial = 0) {
    this.buf = new Float64Array(Math.max(1, samples)).fill(initial);
  }
  push(x: number): number {
    if (this.buf.length === 1) return x;
    const out = this.buf[this.idx] ?? 0;
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) % this.buf.length;
    return out;
  }
  fill(v: number): void {
    this.buf.fill(v);
  }
}

/**
 * Band-limited gaussian noise: white gaussian through a first-order low-pass with
 * cutoff fc, scaled so the output RMS equals `rms` (Brief 1 §4: van Diepen used
 * low-pass white noise with a 15 Hz bandwidth).
 */
export class BandLimitedNoise {
  private y = 0;
  private readonly a: number;
  private readonly gain: number;
  constructor(
    private readonly rng: Rng,
    rms: number,
    fc: number,
    dt: number,
  ) {
    this.a = Math.exp(-2 * Math.PI * fc * dt);
    // var_y = (1−a)²/(1−a²)·var_w = (1−a)/(1+a)·var_w  →  σ_w = σ_y·√((1+a)/(1−a))
    this.gain = rms * Math.sqrt((1 + this.a) / (1 - this.a));
  }
  next(): number {
    this.y = this.a * this.y + (1 - this.a) * this.gain * this.rng.gaussian();
    return this.y;
  }
}

export function quantize(x: number, q: number): number {
  return q > 0 ? Math.round(x / q) * q : x;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
