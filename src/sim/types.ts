/**
 * Shared simulation types. Internal units: cmH2O, L, L/s, s.
 */

export type Mode = 'VC-AC' | 'PC-AC' | 'PSV' | 'CPAP' | 'SIMV' | 'PRVC';
export const IMPLEMENTED_MODES: readonly Mode[] = ['VC-AC', 'PC-AC', 'PSV', 'CPAP', 'SIMV'];

/** Breath plan actually delivered (Spec 2026-09-14 §1): flow-controlled, pressure-controlled time-cycled, flow-cycled spontaneous, or an APRV high phase. */
export type BreathKind = 'vc' | 'pc' | 'ps' | 'aprv';

export type Phase = 'insp' | 'pause' | 'exp' | 'exp-hold' | 'occlusion';

export type TriggerCause = 'time' | 'patient' | 'backup' | 'manual';
export type CycleCause = 'time' | 'volume' | 'flow' | 'ti-max' | 'pressure' | 'alarm' | 'manual';

/** Boundary condition the ventilator imposes at the Y-piece for one physics step. */
export type AirwayBC =
  | { kind: 'flow'; qv: number }
  /**
   * Thevenin pressure source with valve limits: the inspiratory valve cannot pull flow back (qMin = 0 during
   * inspiration) and the blower has a peak flow (qMax). Outside the limits the source behaves as a flow source.
   */
  | { kind: 'pressure'; psrc: number; rsrc: number; qMin?: number; qMax?: number }
  | { kind: 'occluded' };

/** Ventilator event markers (device clock). */
export type VentEvent =
  | { type: 'trigger'; t: number; cause: TriggerCause }
  | { type: 'cycle'; t: number; cause: CycleCause }
  /** Emitted at every inspiration start: what plan this breath runs, whether it was mandatory, and its absolute pressure target (NaN for flow-controlled breaths). */
  | { type: 'breath'; t: number; kind: BreathKind; mandatory: boolean; pTarget: number }
  | { type: 'pause-end'; t: number }
  | { type: 'hold-start'; t: number; kind: 'insp' | 'exp' | 'occlusion' }
  | { type: 'hold-end'; t: number; kind: 'insp' | 'exp' | 'occlusion' }
  | { type: 'alarm'; t: number; alarm: string; active: boolean }
  | { type: 'maneuver'; t: number; result: ManeuverResult };

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
  /** True leak volume over the whole cycle (∫ Q_leak dt), L. */
  leakTrue: number;
  /** Recruitable lung (truth): fraction of units open at the end of the breath, aerated FRC of the open
   *  units (L), and units that opened during the breath and closed again (tidal recruitment). */
  openFractionEE: number;
  frcAeratedEE: number;
  tidalRecruitUnits: number;
}

export type ManeuverKind = 'insp' | 'exp' | 'p01' | 'pocc' | 'occlusion-test' | 'ri' | 'peep-trial';

/** Result of a completed maneuver, from the ventilator's *measured* Paw (device view). */
export interface ManeuverResult {
  kind: ManeuverKind;
  tStart: number;
  tEnd: number;
  /** Inspiratory hold: Paw just after flow stops and at the end of the hold. */
  p1?: number;
  p2?: number;
  /** Expiratory hold: total PEEP at the end of the hold. */
  peepTotal?: number;
  /** Any extra key/value payload (P0.1, ΔPocc, ratios, R/I pieces, best PEEP). */
  values?: Record<string, number>;
  /** Per-step rows for multi-step maneuvers (decremental PEEP trial). */
  table?: Array<Record<string, number>>;
}

export interface MeasuredSample {
  t: number;
  paw: number;
  flow: number;
  vol: number;
  pes: number | null;
}
