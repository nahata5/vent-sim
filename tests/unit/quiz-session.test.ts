/**
 * Quiz session state machine (Spec §8): identify → fix → done, with simulated-time bookkeeping, the
 * 60 s fix window and the composite score; the controller drives it, the UI renders it.
 */
import { describe, expect, it } from 'vitest';
import { QuizSession } from '@/edu/quiz-session';
import { k } from '@/config/constants';

describe('quiz session', () => {
  it('walks identify → fix → done and scores the attempt', () => {
    const q = new QuizSession();
    expect(q.phase).toBe('idle');
    q.start(10);
    expect(q.phase).toBe('identify');
    const g = q.submitIdentification(['double-trigger'], ['double-trigger', 'flow-starvation']);
    expect(g.score).toBeCloseTo(0.5, 6);
    expect(q.phase).toBe('identified');
    q.startFix(20, 2);
    expect(q.phase).toBe('fix');
    expect(q.fixWindowReady(20 + k('QUIZ_FIX_WINDOW') - 1)).toBe(false);
    expect(q.fixWindowReady(20 + k('QUIZ_FIX_WINDOW'))).toBe(true);
    expect(q.fixWindowStart).toBe(20);
    const r = q.evaluate(85, { ai: 3, breaths: [{ dp: 10, pplat: 22, vtPerKg: 6 }], newSevereAlarms: [], extras: [] }, 4);
    expect(q.phase).toBe('done');
    expect(r.fix.pass).toBe(true);
    expect(r.changes).toBe(2); // 4 − 2 changes during the fix
    expect(r.seconds).toBe(65); // 85 − 20
    expect(r.score).toBeGreaterThan(50);
    expect(r.attempt.identification).toBeCloseTo(0.5, 6);
  });

  it('reset returns to idle; skipping identification is allowed (score 0 for that half)', () => {
    const q = new QuizSession();
    q.start(0);
    q.startFix(5, 0);
    const r = q.evaluate(70, { ai: 2, breaths: [{ dp: 8, pplat: 20, vtPerKg: 6 }], newSevereAlarms: [], extras: [] }, 1);
    expect(r.attempt.identification).toBe(0);
    expect(r.score).toBeLessThanOrEqual(50);
    q.reset();
    expect(q.phase).toBe('idle');
  });
});
