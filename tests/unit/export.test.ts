/**
 * Export (Spec §10): session CSV (device-rate measured signals, breath id and phase, optional truth
 * channels), session JSON (scenario, seed, settings timeline, breaths, truth and detector labels with
 * evidence, maneuvers, CO2 log), and the headless batch generator that zips labeled datasets.
 */
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { runHeadless } from '@sim/headless';
import { resolveScenario, scenarioById } from '@/edu/scenarios';
import { csvFromHeadless, sessionCsv, CSV_MEASURED_COLUMNS, CSV_TRUTH_COLUMNS } from '@/export/csv';
import { sessionJsonFromHeadless } from '@/export/json';
import { runBatch, zipBatch } from '@/export/batch';

describe('session CSV', () => {
  it('measured-only export has the device-rate columns, breath ids and phases, one row per sample', () => {
    const res = runHeadless({ ...resolveScenario(scenarioById('normal-passive')), duration: 8 });
    const csv = csvFromHeadless(res, { truth: false });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(CSV_MEASURED_COLUMNS.join(','));
    expect(lines.length).toBe(res.t.length + 1);
    const cols = (lines[300] ?? '').split(',');
    expect(cols.length).toBe(CSV_MEASURED_COLUMNS.length);
    expect(Number(cols[0])).toBeCloseTo(res.t[299] ?? 0, 3);
    const ids = new Set(lines.slice(1).map((l) => l.split(',')[5]));
    expect(ids.size).toBeGreaterThan(1);
    const phases = new Set(lines.slice(1).map((l) => l.split(',')[6]));
    expect(phases.has('insp')).toBe(true);
    expect(phases.has('exp')).toBe(true);
  });

  it('with the truth channels the header grows by the truth columns and Pmus is finite', () => {
    const res = runHeadless({ ...resolveScenario(scenarioById('double-trigger')), duration: 6 });
    const csv = csvFromHeadless(res, { truth: true });
    const header = csv.split('\n')[0] ?? '';
    expect(header).toBe([...CSV_MEASURED_COLUMNS, ...CSV_TRUTH_COLUMNS].join(','));
    const row = (csv.split('\n')[200] ?? '').split(',');
    expect(row.length).toBe(CSV_MEASURED_COLUMNS.length + CSV_TRUTH_COLUMNS.length);
    expect(Number.isFinite(Number(row[CSV_MEASURED_COLUMNS.length]))).toBe(true);
  });

  it('the generic writer accepts a ring-buffer-style reader (n, get, breaths)', () => {
    const res = runHeadless({ ...resolveScenario(scenarioById('normal-passive')), duration: 3 });
    const csv = sessionCsv({ n: res.t.length, fs: res.fs, get: (ch, i) => (ch === 't' ? res.t[i] ?? 0 : ch === 'paw' ? res.paw[i] ?? 0 : ch === 'flow' ? res.flow[i] ?? 0 : ch === 'vol' ? res.vol[i] ?? 0 : ch === 'pes' ? res.pes[i] ?? 0 : res.truth[ch.slice(6) as never]?.[i] ?? 0), breaths: res.breaths, truth: false });
    expect(csv.split('\n').length).toBe(res.t.length + 2);
  });
});

describe('session JSON', () => {
  it('carries the scenario, seed, settings timeline, breaths, truth and detector labels with evidence, maneuvers and CO2', () => {
    const def = scenarioById('co2-under-assist');
    const res = runHeadless({ ...resolveScenario(def), duration: 30, schedule: [{ t: 10, action: (e) => e.vent.requestHold('insp') }] });
    const doc = sessionJsonFromHeadless(def, res);
    expect(doc.scenario.id).toBe('co2-under-assist');
    expect(doc.seed).toBe(def.seed);
    expect(doc.settingsLog.length).toBeGreaterThanOrEqual(1);
    expect(doc.breaths.length).toBeGreaterThan(3);
    expect(doc.truthLabels.length).toBe(doc.breaths.filter((b) => b.tEnd !== null).length);
    expect(doc.truthLabels.some((l) => l.patterns.length > 0)).toBe(true);
    expect(doc.detectorLabels.length).toBeGreaterThan(0);
    expect(doc.detectorLabels.every((d) => typeof d.evidence === 'object')).toBe(true);
    expect(doc.efforts.length).toBeGreaterThan(0);
    expect(doc.maneuvers.some((m) => m.kind === 'insp')).toBe(true);
    expect(doc.co2.length).toBeGreaterThan(10);
    expect(doc.exportedAt.length).toBeGreaterThan(10);
    const text = JSON.stringify(doc);
    expect(text.length).toBeGreaterThan(1000);
    expect((JSON.parse(text) as { schema: string }).schema).toBe('ventsim-session/1');
  });
});

describe('batch generator', () => {
  it('runs a grid headless, one CSV + JSON per run plus a manifest, and zips it', async () => {
    const progress: number[] = [];
    const files = await runBatch({ scenarios: ['normal-passive', 'double-trigger'], seeds: [1, 2], duration: 5, truth: true }, (done, total) => progress.push(done / total));
    expect(files.filter((f) => f.name.endsWith('.csv')).length).toBe(4);
    expect(files.filter((f) => f.name.endsWith('.json') && f.name !== 'manifest.json').length).toBe(4);
    expect(files.some((f) => f.name === 'manifest.json')).toBe(true);
    expect(progress.at(-1)).toBe(1);
    const zip = zipBatch(files);
    const back = unzipSync(zip);
    expect(Object.keys(back).sort()).toEqual(files.map((f) => f.name).sort());
    const manifest = JSON.parse(strFromU8(back['manifest.json'] as Uint8Array)) as { runs: Array<{ scenario: string; seed: number }> };
    expect(manifest.runs.length).toBe(4);
    expect(manifest.runs.some((r) => r.scenario === 'double-trigger' && r.seed === 2)).toBe(true);
  });

  it('setting perturbations multiply the grid and are recorded in the manifest', async () => {
    const files = await runBatch({ scenarios: ['normal-passive'], seeds: [1], perturbations: [{}, { peep: 8 }, { rr: 20 }], duration: 3, truth: false });
    expect(files.filter((f) => f.name.endsWith('.json') && f.name !== 'manifest.json').length).toBe(3);
    const manifest = JSON.parse(files.find((f) => f.name === 'manifest.json')?.text ?? '{}') as { runs: Array<{ settings: Record<string, unknown> }> };
    expect(manifest.runs.some((r) => r.settings.peep === 8)).toBe(true);
  });
});
