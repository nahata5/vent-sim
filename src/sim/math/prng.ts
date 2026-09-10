/**
 * Seeded pseudo-random number generator.
 *
 * xoshiro128** (Blackman & Vigna 2018) seeded through splitmix32, so a 32-bit
 * seed expands to a well-mixed 128-bit state. Every stochastic element in the
 * simulator draws from a stream created here, and child streams are derived
 * from the parent's *seed* plus a label, never from the parent's draw count, so
 * adding a draw in one module cannot perturb another module's sequence.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Standard normal deviate (Box–Muller, cached pair). */
  gaussian(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Deterministic child stream keyed by label. */
  fork(label: string): Rng;
  /** The 32-bit seed this stream was created from. */
  readonly seed: number;
}

/** FNV-1a 32-bit hash of a string; used to turn labels and string seeds into ints. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export function createRng(seed: number | string): Rng {
  const seed32 = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  const sm = splitmix32(seed32);
  let s0 = sm();
  let s1 = sm();
  let s2 = sm();
  let s3 = sm();
  // Avoid the all-zero state (astronomically unlikely, but cheap to guard).
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const nextU32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };

  let spare: number | null = null;

  const rng: Rng = {
    seed: seed32,
    next(): number {
      // 32 random bits → [0,1) with 2^-32 resolution.
      return nextU32() / 4294967296;
    },
    gaussian(): number {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = 2 * rng.next() - 1;
        v = 2 * rng.next() - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const m = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * m;
      return u * m;
    },
    int(n: number): number {
      return Math.floor(rng.next() * n);
    },
    range(lo: number, hi: number): number {
      return lo + (hi - lo) * rng.next();
    },
    fork(label: string): Rng {
      return createRng((seed32 ^ Math.imul(hashSeed(label), 0x9e3779b1)) >>> 0);
    },
  };
  return rng;
}
