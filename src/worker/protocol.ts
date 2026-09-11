/**
 * Main ↔ worker message protocol (Spec §3). Sample batches are channel-major Float32Arrays sent as
 * transferable buffers: `samples[channelIndex(ch) * n + i]` is sample i of channel ch.
 */
import { MEASURED_CHANNELS, TRUTH_CHANNELS, type MeasuredChannel, type TruthChannel } from '../sim/channels';
import type { BreathRecord, ManeuverKind, Phase, VentEvent } from '../sim/types';
import type { VentSettings } from '../sim/vent/settings';
import type { PatientParams } from '../sim/patient/params';
import type { BalloonParams } from '../sim/patient/balloon';
import type { NeuralBreath } from '../sim/patient/neural-drive';
import type { AlarmId } from '../sim/vent/ventilator';
import type { DriveParams } from '../sim/patient/neural-drive';
import type { InjectorKind, InjectorParamMap } from '../sim/injectors';

export type TruthKey = `truth.${TruthChannel}`;
export type ChannelKey = MeasuredChannel | TruthKey;

export const BATCH_CHANNELS: readonly ChannelKey[] = [
  ...MEASURED_CHANNELS,
  ...TRUTH_CHANNELS.map((c): TruthKey => `truth.${c}`),
];

const INDEX = new Map<ChannelKey, number>(BATCH_CHANNELS.map((c, i) => [c, i]));

export function channelIndex(ch: ChannelKey): number {
  const i = INDEX.get(ch);
  if (i === undefined) throw new Error(`unknown channel ${ch}`);
  return i;
}

export interface ScenarioSpec {
  patient: PatientParams;
  settings: VentSettings;
  seed: number | string;
}

export interface SessionStatus {
  t: number;
  injectors: InjectorKind[];
  /** Current injector resistance / elastance multipliers (for the main-thread truth labeler). */
  rScale: number;
  eScale: number;
  phase: Phase;
  alarms: AlarmId[];
  inBackup: boolean;
  settings: VentSettings;
  pending: Array<keyof VentSettings>;
  breathCount: number;
}

export interface PatientSummary {
  frc: number; // L
  pbw: number; // kg
  el: number;
  ecw: number;
  /** Preset total inspiratory resistance at the reference flow, cmH2O/(L/s) (truth labeler). */
  rTotal: number;
  hasDrive: boolean;
}

export type MainToWorker =
  | { type: 'init'; scenario: ScenarioSpec }
  | { type: 'applySettings'; partial: Partial<VentSettings> }
  | { type: 'setBalloon'; balloon: BalloonParams }
  | { type: 'maneuver'; kind: ManeuverKind }
  | { type: 'inject'; kind: InjectorKind; params: Partial<InjectorParamMap[InjectorKind]> | null }
  | { type: 'setPatient'; drive: Partial<DriveParams> }
  | { type: 'setSpeed'; speed: number }
  | { type: 'pause' }
  | { type: 'resume' };

export type WorkerToMain =
  | { type: 'ready'; fs: number; channels: readonly ChannelKey[]; patient: PatientSummary; status: SessionStatus }
  /** One worker tick: samples (transferable), the events emitted at those sample times, closed breaths. */
  | { type: 'tick'; n: number; t0: number; t1: number; samples: Float32Array; events: VentEvent[]; breaths: BreathRecord[]; neural: NeuralBreath[] }
  | { type: 'status'; status: SessionStatus; speed: number; paused: boolean };
