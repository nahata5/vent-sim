/**
 * Quiz "bedside view" link (design 2026-09-11 §2, D-019): `#<scenario-id>?quiz=<keys|bedside>` round-trips
 * through parseQuizHash / quizLink; unknown keys are ignored; only a `?quiz=` hash locks the session.
 */
import { describe, expect, it } from 'vitest';
import { QUIZ_HIDE_KEYS, bedsideHide, parseQuizHash, quizLink } from '@/edu/quiz-view';

describe('quiz view link', () => {
  it('round-trips a hide set through quizLink and parseQuizHash', () => {
    const link = quizLink('ineffective-effort', ['pes', 'truth'], 'https://x.test/');
    expect(link).toBe('https://x.test/#ineffective-effort?quiz=truth,pes');
    const info = parseQuizHash(link.slice('https://x.test/'.length));
    expect(info).not.toBeNull();
    expect(info?.scenarioId).toBe('ineffective-effort');
    expect([...(info?.hide ?? [])].sort()).toEqual(['pes', 'truth']);
    expect(info?.locked).toBe(true);
  });

  it('accepts the bedside preset and emits it for the full set', () => {
    const info = parseQuizHash('#copd?quiz=bedside');
    expect(info?.hide.size).toBe(QUIZ_HIDE_KEYS.length);
    expect(info?.locked).toBe(true);
    expect(quizLink('copd', bedsideHide())).toBe('#copd?quiz=bedside');
  });

  it('ignores unknown keys and keeps the known ones', () => {
    const info = parseQuizHash('#copd?quiz=truth,bogus,co2');
    expect([...(info?.hide ?? [])].sort()).toEqual(['co2', 'truth']);
  });

  it('returns locked: false for a plain scenario hash and null for an empty hash', () => {
    const plain = parseQuizHash('#copd');
    expect(plain).toEqual({ scenarioId: 'copd', hide: new Set(), locked: false });
    expect(parseQuizHash('#/copd')?.scenarioId).toBe('copd');
    expect(parseQuizHash('')).toBeNull();
    expect(parseQuizHash('#')).toBeNull();
    // A quiz query with no keys still locks (instructor panel hidden, nothing else).
    expect(parseQuizHash('#copd?quiz=')?.locked).toBe(true);
    expect(parseQuizHash('#copd?quiz=')?.hide.size).toBe(0);
  });
});
