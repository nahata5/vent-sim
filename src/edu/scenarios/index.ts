/**
 * Scenario library (Spec §8). Each scenario is a JSON file in this folder: phenotype, optional
 * mechanics overrides, drive (null = passive), balloon, ventilator settings, seed, objectives and target
 * patterns. `resolveScenario` turns one into a runnable ScenarioSpec.
 */
import type { PhenotypeId } from '../../sim/patient/presets';
import { presetPatient } from '../../sim/patient/presets';
import type { MechanicsParams } from '../../sim/patient/params';
import { defaultDriveParams, type DriveParams } from '../../sim/patient/neural-drive';
import { defaultBalloon, type BalloonParams } from '../../sim/patient/balloon';
import { defaultSettings, type VentSettings } from '../../sim/vent/settings';
import type { Mode } from '../../sim/types';
import type { ScenarioSpec } from '../../worker/protocol';

export type ScenarioCategory = 'preset' | 'dyssynchrony' | 'injector' | 'capstone';

export interface ScenarioDef {
  id: string;
  order: number;
  category: ScenarioCategory;
  title: string;
  summary: string;
  phenotype: PhenotypeId;
  mechanics?: Partial<MechanicsParams>;
  drive: Partial<DriveParams> | null;
  balloon?: Partial<BalloonParams>;
  settings: Partial<VentSettings> & { mode: Mode };
  seed: number | string;
  objectives: string[];
  targetPatterns: string[];
}

const modules = import.meta.glob<{ default: ScenarioDef }>('./*.json', { eager: true });

export const SCENARIOS: readonly ScenarioDef[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.order - b.order);

export function scenarioById(id: string): ScenarioDef {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

export function resolveScenario(def: ScenarioDef): ScenarioSpec {
  const patient = presetPatient(def.phenotype, def.mechanics ?? {});
  if (def.drive) patient.drive = { ...defaultDriveParams(), ...def.drive };
  if (def.balloon) patient.balloon = { ...defaultBalloon(), ...def.balloon };
  const settings: VentSettings = { ...defaultSettings(def.settings.mode), ...def.settings };
  if (patient.balloon?.enabled) settings.esophagealBalloon = true;
  return { patient, settings, seed: def.seed };
}
