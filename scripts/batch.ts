/**
 * Headless batch generator (Spec §10): npm run batch -- --scenarios a,b --seeds 1,2,3 --duration 60 --out batch.zip
 * Options: --scenarios (default: all), --seeds (default 1), --duration s (default 60), --no-truth,
 *          --perturb '[{"peep":8},{"rr":20}]', --out file (default batch.zip)
 */
import { writeFileSync } from 'node:fs';
import { runBatch, zipBatch, batchRunCount, type BatchGrid } from '../src/export/batch';
import { SCENARIOS } from '../src/edu/scenarios';
import type { VentSettings } from '../src/sim/vent/settings';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const grid: BatchGrid = {
  scenarios: arg('scenarios', SCENARIOS.map((s) => s.id).join(',')).split(',').filter(Boolean),
  seeds: arg('seeds', '1').split(',').map(Number),
  perturbations: JSON.parse(arg('perturb', '[{}]')) as Array<Partial<VentSettings>>,
  duration: Number(arg('duration', '60')),
  truth: !process.argv.includes('--no-truth'),
};
const out = arg('out', 'batch.zip');
const t0 = Date.now();
console.log(`batch: ${batchRunCount(grid)} runs × ${grid.duration} s → ${out}`);
runBatch(grid, (done, total) => process.stdout.write(`\r  ${done}/${total}`))
  .then((files) => {
    const zip = zipBatch(files);
    writeFileSync(out, zip);
    console.log(`\nwrote ${out}: ${files.length} files, ${(zip.length / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  })
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
