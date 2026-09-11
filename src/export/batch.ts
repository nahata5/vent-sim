/**
 * Batch generator (Spec §10): a grid of scenarios × seeds × setting perturbations run headless, one CSV
 * and one JSON per run plus a manifest, zipped with fflate. Runs in Node (`scripts/batch.ts`) and in a
 * worker; `runBatch` yields between runs so a worker can report progress.
 */
import { strToU8, zipSync } from 'fflate';
import { runHeadless } from '../sim/headless';
import type { VentSettings } from '../sim/vent/settings';
import { resolveScenario, scenarioById, scenarioSchedule } from '../edu/scenarios';
import { csvFromHeadless } from './csv';
import { sessionJsonFromHeadless } from './json';

export interface BatchGrid {
  scenarios: string[];
  seeds: number[];
  /** Setting overrides applied on top of each scenario (an empty object is the unperturbed run). */
  perturbations?: Array<Partial<VentSettings>>;
  duration: number;
  truth: boolean;
}

export interface BatchFile {
  name: string;
  text: string;
}

export interface BatchRun {
  name: string;
  scenario: string;
  seed: number;
  settings: Partial<VentSettings>;
  duration: number;
  breaths: number;
  patterns: Record<string, number>;
}

export function batchRunCount(grid: BatchGrid): number {
  return grid.scenarios.length * grid.seeds.length * Math.max(1, grid.perturbations?.length ?? 1);
}

const yieldToLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export async function runBatch(grid: BatchGrid, onProgress?: (done: number, total: number) => void): Promise<BatchFile[]> {
  const perts = grid.perturbations && grid.perturbations.length > 0 ? grid.perturbations : [{}];
  const total = batchRunCount(grid);
  const files: BatchFile[] = [];
  const runs: BatchRun[] = [];
  let done = 0;
  for (const scenarioId of grid.scenarios) {
    const def = scenarioById(scenarioId);
    for (const seed of grid.seeds) {
      for (let pi = 0; pi < perts.length; pi++) {
        const pert = perts[pi] ?? {};
        const spec = resolveScenario(def);
        const res = runHeadless({ ...spec, settings: { ...spec.settings, ...pert }, seed, duration: grid.duration, schedule: scenarioSchedule(def) });
        const base = `${scenarioId}__seed${seed}${perts.length > 1 ? `__p${pi}` : ''}`;
        const doc = sessionJsonFromHeadless({ ...def, seed }, res);
        const patterns: Record<string, number> = {};
        for (const l of doc.truthLabels) for (const p of l.patterns) patterns[p] = (patterns[p] ?? 0) + 1;
        patterns['ineffective-effort'] = doc.efforts.filter((e) => e.ineffective).length;
        files.push({ name: `${base}.csv`, text: csvFromHeadless(res, { truth: grid.truth }) });
        files.push({ name: `${base}.json`, text: JSON.stringify(doc) });
        runs.push({ name: base, scenario: scenarioId, seed, settings: pert, duration: grid.duration, breaths: res.breaths.length, patterns });
        done += 1;
        onProgress?.(done, total);
        await yieldToLoop();
      }
    }
  }
  files.push({ name: 'manifest.json', text: JSON.stringify({ schema: 'ventsim-batch/1', generatedAt: new Date().toISOString(), grid, runs }, null, 2) });
  return files;
}

export function zipBatch(files: BatchFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = strToU8(f.text);
  return zipSync(entries, { level: 6 });
}
