import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '@sim/math/prng';

describe('seeded PRNG', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const xs = Array.from({ length: 1000 }, () => a.next());
    const ys = Array.from({ length: 1000 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  it('differs between seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const xs = Array.from({ length: 100 }, () => a.next());
    const ys = Array.from({ length: 100 }, () => b.next());
    expect(xs).not.toEqual(ys);
  });

  it('produces uniform [0,1) with the right mean and variance', () => {
    const r = createRng(42);
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = r.next();
      if (x < min) min = x;
      if (x > max) max = x;
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(mean).toBeCloseTo(0.5, 2);
    expect(variance).toBeCloseTo(1 / 12, 2);
  });

  it('gaussian has mean 0 and sd 1', () => {
    const r = createRng(7);
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = r.gaussian();
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(sd).toBeCloseTo(1, 1);
  });

  it('forks independent, deterministic child streams', () => {
    const parent1 = createRng(99);
    const parent2 = createRng(99);
    const c1 = parent1.fork('patient');
    const c2 = parent2.fork('patient');
    const d1 = parent1.fork('vent');
    expect(Array.from({ length: 10 }, () => c1.next())).toEqual(Array.from({ length: 10 }, () => c2.next()));
    expect(Array.from({ length: 10 }, () => c1.next())).not.toEqual(Array.from({ length: 10 }, () => d1.next()));
  });

  it('forking does not depend on how many draws the parent made', () => {
    const p1 = createRng(5);
    const p2 = createRng(5);
    p2.next();
    p2.next();
    expect(p1.fork('x').next()).toEqual(p2.fork('x').next());
  });

  it('accepts string seeds via a stable hash', () => {
    expect(hashSeed('scenario-1')).toEqual(hashSeed('scenario-1'));
    expect(hashSeed('scenario-1')).not.toEqual(hashSeed('scenario-2'));
    expect(createRng('abc').next()).toEqual(createRng('abc').next());
  });

  it('int(n) covers [0, n)', () => {
    const r = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = r.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });
});
