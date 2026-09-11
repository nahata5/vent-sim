/**
 * Session JSON (Spec §10): scenario, seed, settings timeline, per-breath monitored values, truth labels,
 * detector labels with evidence, efforts, maneuver results, CO2 log and the asynchrony index.
 */
import type { HeadlessResult } from '../sim/headless';
import type { BreathRecord, ManeuverResult, VentEvent } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import type { InjectorLogEntry } from '../sim/injectors';
import type { Co2Sample } from '../sim/patient/gas-exchange';
import { asynchronyIndex, labelRun, type AsynchronyIndex, type BreathLabel, type EffortLabel, type PatternId } from '../sim/truth/labeler';
import { detectRun, type IeEvent } from '../detector/detector';
import { Monitor, type BreathMetrics } from '../monitor/monitor';
import type { ScenarioDef } from '../edu/scenarios';

export interface DetectorLabelJson {
  breathIndex: number;
  tStart: number;
  tEnd: number;
  patterns: PatternId[];
  evidence: Partial<Record<PatternId, string>>;
}

export interface SessionJson {
  schema: 'ventsim-session/1';
  exportedAt: string;
  app: string;
  scenario: { id: string; title: string; phenotype: string; category: string };
  seed: number | string;
  fs: number;
  pbw: number;
  settingsLog: Array<{ t: number; settings: VentSettings }>;
  injectorLog: InjectorLogEntry[];
  breaths: BreathRecord[];
  monitor: BreathMetrics[];
  truthLabels: BreathLabel[];
  efforts: EffortLabel[];
  detectorLabels: DetectorLabelJson[];
  ieEvents: IeEvent[];
  maneuvers: ManeuverResult[];
  events: VentEvent[];
  co2: Co2Sample[];
  ai: AsynchronyIndex | null;
}

export interface SessionJsonInput {
  scenario: ScenarioDef;
  seed: number | string;
  fs: number;
  pbw: number;
  settingsLog: Array<{ t: number; settings: VentSettings }>;
  injectorLog: InjectorLogEntry[];
  breaths: BreathRecord[];
  monitor: BreathMetrics[];
  truthLabels: BreathLabel[];
  efforts: EffortLabel[];
  detectorLabels: DetectorLabelJson[];
  ieEvents: IeEvent[];
  maneuvers: ManeuverResult[];
  events: VentEvent[];
  co2: Co2Sample[];
  ai: AsynchronyIndex | null;
  app?: string;
}

export function sessionJson(inp: SessionJsonInput): SessionJson {
  return {
    schema: 'ventsim-session/1',
    exportedAt: new Date().toISOString(),
    app: inp.app ?? 'VentSim',
    scenario: { id: inp.scenario.id, title: inp.scenario.title, phenotype: inp.scenario.phenotype, category: inp.scenario.category },
    seed: inp.seed,
    fs: inp.fs,
    pbw: inp.pbw,
    settingsLog: inp.settingsLog,
    injectorLog: inp.injectorLog,
    breaths: inp.breaths,
    monitor: inp.monitor,
    truthLabels: inp.truthLabels,
    efforts: inp.efforts,
    detectorLabels: inp.detectorLabels,
    ieEvents: inp.ieEvents,
    maneuvers: inp.maneuvers,
    events: inp.events,
    co2: inp.co2,
    ai: inp.ai,
  };
}

/** Per-breath monitor values from a headless run (the same Monitor the live UI uses, fed in time order). */
export function monitorBreaths(res: HeadlessResult): BreathMetrics[] {
  const mon = new Monitor({ fs: res.fs, pbw: res.pbw });
  const out: BreathMetrics[] = [];
  let ei = 0;
  let last: BreathMetrics | null = null;
  for (let i = 0; i < res.t.length; i++) {
    const t = res.t[i] ?? 0;
    mon.onSample({ t, paw: res.paw[i] ?? 0, flow: res.flow[i] ?? 0, vol: res.vol[i] ?? 0, pes: res.pes[i] ?? 0 });
    while (ei < res.events.length && (res.events[ei]?.t ?? Infinity) <= t + 1e-6) {
      const e = res.events[ei];
      if (e) mon.onEvent(e);
      ei += 1;
    }
    if (mon.latest && mon.latest !== last) {
      last = mon.latest;
      out.push(last);
    }
  }
  return out;
}

export function sessionJsonFromHeadless(def: ScenarioDef, res: HeadlessResult): SessionJson {
  const truth = labelRun(res);
  const det = detectRun(res);
  const tEnd = res.t[res.t.length - 1] ?? 0;
  return sessionJson({
    scenario: def,
    seed: def.seed,
    fs: res.fs,
    pbw: res.pbw,
    settingsLog: res.settingsLog,
    injectorLog: res.injectorLog,
    breaths: res.breaths,
    monitor: monitorBreaths(res),
    truthLabels: truth.breaths,
    efforts: truth.efforts,
    detectorLabels: det.breaths.map((d) => ({ breathIndex: d.breathIndex, tStart: d.tStart, tEnd: d.tEnd, patterns: d.patterns, evidence: d.evidence })),
    ieEvents: det.ieEvents,
    maneuvers: res.maneuvers,
    events: res.events,
    co2: res.co2,
    ai: asynchronyIndex(truth, Math.max(0, tEnd - 120), tEnd),
  });
}
