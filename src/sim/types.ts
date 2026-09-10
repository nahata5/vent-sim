/**
 * Shared simulation types. Internal units: cmH2O, L, L/s, s.
 */

export type Mode = 'VC-AC' | 'PC-AC' | 'PSV' | 'CPAP' | 'SIMV' | 'PRVC';
export const IMPLEMENTED_MODES: readonly Mode[] = ['VC-AC', 'PC-AC', 'PSV', 'CPAP'];

export type Phase = 'insp' | 'pause' | 'exp' | 'exp-hold' | 'occlusion';

export type TriggerCause = 'time' | 'patient' | 'backup' | 'manual';
export type CycleCause = 'time' | 'volume' | 'flow' | 'ti-max' | 'pressure' | 'alarm' | 'manual';

/** Boundary condition the ventilator imposes at the Y-piece for one physics step. */
export type AirwayBC =
  | { kind: 'flow'; qv: number }
  | { kind: 'pressure'; psrc: number; rsrc: number }
  | { kind: 'occluded' };

/** Ventilator event markers (device clock). */
export type VentEvent =
  | { type: 'trigger'; t: number; cause: TriggerCause }
  | { type: 'cycle'; t: number; cause: CycleCause }
  | { type: 'pause-end'; t: number }
  | { type: 'hold-start'; t: number; kind: 'insp' | 'exp' | 'occlusion' }
  | { type: 'hold-end'; t: number; kind: 'insp' | 'exp' | 'occlusion' }
  | { type: 'alarm'; t: number; alarm: string; active: boolean };

/** Per-breath record kept by the engine (ventilator timing + true volumes). */
export interface BreathRecord {
  index: number;
  tStart: number;
  triggerCause: TriggerCause;
  tInspEnd: number;
  tPauseEnd: number;
  cycleCause: CycleCause;
  tEnd: number | null;
  vtiTrue: number;
  vteTrue: number;
  vtiMeasured: number;
  vteMeasured: number;
  peakFlowMeasured: number;
  ppeakMeasured: number;
}

export interface MeasuredSample {
  t: number;
  paw: number;
  flow: number;
  vol: number;
  pes: number | null;
}
