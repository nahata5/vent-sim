/**
 * Writes src/validation/snapshot.json for the Validation page's first paint: the emergence matrix (§9.4),
 * the detector confusion matrices on the tuning and held-out grids (§9.5) and the analytic test list.
 *   npx tsx scripts/validation-snapshot.ts
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SCENARIOS } from '../src/edu/scenarios';
import { HELD_OUT_GRID, TUNING_GRID, runGrid } from '../src/detector/grids';
import { ALL_SCORED_PATTERNS, scoreGrid } from '../src/detector/scorer';
import { DETECTOR_TARGETS, runEmergence, summarizeScore, type EmergenceRow, type PatternScoreSummary } from '../src/detector/validation';

export interface ValidationSnapshot {
  generatedAt: string;
  commit: string;
  emergence: EmergenceRow[];
  heldOut: PatternScoreSummary[];
  tuning: PatternScoreSummary[];
  targets: Record<string, { sens: number; spec: number }>;
  gridSizes: { tuning: number; heldOut: number };
  /** Vitest suites that make up the analytic / partition / calibration checks (names only; results run in CI). */
  suites: Array<{ file: string; what: string }>;
}

const t0 = performance.now();
const emergence = SCENARIOS.filter((s) => s.targetPatterns.length > 0).map(runEmergence);
const tuning = Object.values(scoreGrid(runGrid(TUNING_GRID), ALL_SCORED_PATTERNS)).map(summarizeScore);
const heldOut = Object.values(scoreGrid(runGrid(HELD_OUT_GRID), ALL_SCORED_PATTERNS)).map(summarizeScore);
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout */
}
const snap: ValidationSnapshot = {
  generatedAt: new Date().toISOString(),
  commit,
  emergence,
  heldOut,
  tuning,
  targets: DETECTOR_TARGETS,
  gridSizes: { tuning: TUNING_GRID.length, heldOut: HELD_OUT_GRID.length },
  suites: [
    { file: 'tests/physics/analytic.test.ts', what: '§9.1 analytic: PC Vt, VC Ppeak − Pplat = R·Q, mass balance, PEEPi vs e^(−Te/τ), determinism' },
    { file: 'tests/physics/partition.test.ts', what: '§9.2 partition: ΔPL/ΔPaw = EL/Ers, obesity PL,ee < 0, specific elastance, Gattinoni direction, P1/P2' },
    { file: 'tests/physics/effort-calibration.test.ts', what: '§9.3 effort: Bertoni k1/k2, P0.1, balloon occlusion test, PMI' },
    { file: 'tests/physics/emergence-first.test.ts', what: 'first emergence: IE, double trigger, scooped Paw, reverse trigger' },
    { file: 'tests/scenarios/emergence.test.ts', what: '§9.4 emergence matrix (every scenario, fix brings AI < 10 % in 60 s)' },
    { file: 'tests/detector/heldout.test.ts', what: '§9.5 detector on the held-out grid' },
    { file: 'tests/unit/session.test.ts', what: 'determinism: byte-identical batches under random chunking' },
    { file: 'tests/e2e/load.spec.ts', what: 'performance budget: 7 rows + 4 loops < 8 ms per frame' },
  ],
};
mkdirSync('src/validation', { recursive: true });
writeFileSync('src/validation/snapshot.json', JSON.stringify(snap, null, 1) + '\n');
console.log(`snapshot written: ${emergence.length} emergence rows, ${heldOut.length} patterns, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
