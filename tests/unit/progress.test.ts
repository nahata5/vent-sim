/**
 * Learner progress (Spec §8): attempts and best scores per scenario in localStorage, wrapped in try/catch so
 * a blocked or full storage never breaks the app.
 */
import { describe, expect, it } from 'vitest';
import { ProgressStore, type KeyValueStorage } from '@/edu/progress';

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('progress store', () => {
  it('records attempts, keeps the best score and the count per scenario, and persists as JSON', () => {
    const s = memoryStorage();
    const p = new ProgressStore(s);
    p.record('double-trigger', { score: 62, identification: 0.5, fixPassed: true, seconds: 120, changes: 3, at: 1000 });
    p.record('double-trigger', { score: 88, identification: 1, fixPassed: true, seconds: 60, changes: 2, at: 2000 });
    p.record('leak-psv', { score: 40, identification: 0.5, fixPassed: false, seconds: 200, changes: 6, at: 3000 });
    const dt = p.get('double-trigger');
    expect(dt?.attempts).toBe(2);
    expect(dt?.best).toBe(88);
    expect(dt?.lastAt).toBe(2000);
    expect(p.get('leak-psv')?.best).toBe(40);
    expect(p.get('unknown')).toBeNull();
    // A fresh store over the same storage sees the same data.
    const again = new ProgressStore(s);
    expect(again.get('double-trigger')?.best).toBe(88);
    expect(again.summary().scenarios).toBe(2);
    expect(again.summary().passed).toBe(1);
  });

  it('survives a storage that throws (falls back to memory) and corrupt JSON', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const p = new ProgressStore(throwing);
    expect(() => p.record('x', { score: 10, identification: 0, fixPassed: false, seconds: 1, changes: 0, at: 1 })).not.toThrow();
    expect(p.get('x')?.attempts).toBe(1);
    const s = memoryStorage();
    s.map.set('ventsim.progress.v1', '{not json');
    const q = new ProgressStore(s);
    expect(q.summary().scenarios).toBe(0);
    q.record('y', { score: 5, identification: 0, fixPassed: false, seconds: 1, changes: 0, at: 1 });
    expect((JSON.parse(s.map.get('ventsim.progress.v1') ?? '{}') as { scenarios: Record<string, { attempts: number }> }).scenarios.y?.attempts).toBe(1);
  });

  it('keeps a compact debrief summary with the attempt', () => {
    const s = memoryStorage();
    const p = new ProgressStore(s);
    p.record('copd', { score: 70, identification: 1, fixPassed: true, seconds: 80, changes: 2, at: 5, debrief: { changes: ['PS 16 → 6 cmH2O at 84 s'], patterns: ['ineffective-effort'], pass: true } });
    const again = new ProgressStore(s);
    expect(again.get('copd')?.history[0]?.debrief?.changes).toEqual(['PS 16 → 6 cmH2O at 84 s']);
  });

  it('reset clears everything', () => {
    const s = memoryStorage();
    const p = new ProgressStore(s);
    p.record('a', { score: 1, identification: 0, fixPassed: false, seconds: 1, changes: 0, at: 1 });
    p.reset();
    expect(p.get('a')).toBeNull();
    expect(s.map.has('ventsim.progress.v1')).toBe(false);
  });
});
