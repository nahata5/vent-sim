/**
 * Validation worker: recomputes the emergence matrix and the held-out confusion matrices in the browser,
 * streaming one message per finished row so the page can show progress. Same functions as the Vitest
 * suites and scripts/validation-snapshot.ts.
 */
import { SCENARIOS } from '../edu/scenarios';
import { HELD_OUT_GRID, runCase } from '../detector/grids';
import { ALL_SCORED_PATTERNS, scoreGrid, type ScoredCase } from '../detector/scorer';
import { runEmergence, summarizeScore, type EmergenceRow, type PatternScoreSummary } from '../detector/validation';

export type ValidationRequest = { type: 'run' };
export type ValidationMessage =
  | { type: 'emergence'; row: EmergenceRow; done: number; total: number }
  | { type: 'case'; id: string; done: number; total: number }
  | { type: 'scores'; heldOut: PatternScoreSummary[] }
  | { type: 'finished'; ms: number };

const ctx = self as unknown as { postMessage: (m: ValidationMessage) => void; onmessage: ((ev: MessageEvent<ValidationRequest>) => void) | null };

ctx.onmessage = (ev) => {
  if (ev.data.type !== 'run') return;
  const t0 = performance.now();
  const withTargets = SCENARIOS.filter((s) => s.targetPatterns.length > 0);
  withTargets.forEach((def, i) => {
    ctx.postMessage({ type: 'emergence', row: runEmergence(def), done: i + 1, total: withTargets.length });
  });
  const cases: ScoredCase[] = [];
  HELD_OUT_GRID.forEach((c, i) => {
    cases.push(runCase(c));
    ctx.postMessage({ type: 'case', id: c.id, done: i + 1, total: HELD_OUT_GRID.length });
  });
  const heldOut = Object.values(scoreGrid(cases, ALL_SCORED_PATTERNS)).map(summarizeScore);
  ctx.postMessage({ type: 'scores', heldOut });
  ctx.postMessage({ type: 'finished', ms: performance.now() - t0 });
};
