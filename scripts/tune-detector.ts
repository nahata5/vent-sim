/**
 * Detector tuning report on the TUNING grid (never the held-out grid). Prints sensitivity/specificity per
 * pattern and the per-case false positives/negatives so thresholds in constants.ts can be adjusted.
 *   npx tsx scripts/tune-detector.ts [pattern]
 */
import { TUNING_GRID, HELD_OUT_GRID, runGrid } from '../src/detector/grids';
import { ALL_SCORED_PATTERNS, scoreGrid } from '../src/detector/scorer';

const which = process.argv[2] === 'heldout' ? HELD_OUT_GRID : TUNING_GRID;
const only = process.argv[3];
const t0 = performance.now();
const results = runGrid(which);
const scores = scoreGrid(results, ALL_SCORED_PATTERNS);
console.log(`${which === TUNING_GRID ? 'TUNING' : 'HELD-OUT'} grid: ${which.length} cases in ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
console.log('pattern'.padEnd(20), 'sens'.padStart(6), 'spec'.padStart(6), '  tp   fp   tn   fn');
for (const p of ALL_SCORED_PATTERNS) {
  const s = scores[p];
  if (!s) continue;
  console.log(p.padEnd(20), s.sensitivity.toFixed(3).padStart(6), s.specificity.toFixed(3).padStart(6), String(s.tp).padStart(4), String(s.fp).padStart(4), String(s.tn).padStart(4), String(s.fn).padStart(4));
}
console.log('\nPer-case FP/FN (cases with any error):');
for (const p of ALL_SCORED_PATTERNS) {
  if (only && p !== only) continue;
  const s = scores[p];
  if (!s) continue;
  const bad = Object.entries(s.byCase).filter(([, c]) => c.fp + c.fn > 0);
  if (!bad.length) continue;
  console.log(`  ${p}: ` + bad.map(([id, c]) => `${id} fp${c.fp}/fn${c.fn}(tp${c.tp},tn${c.tn})`).join('  '));
}
