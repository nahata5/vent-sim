/**
 * Breath kind resolution (Spec 2026-09-14 §1). The ventilator emits a `breath` event at every inspiration
 * start; the labeler and the detector read it so that mixed-breath modes (SIMV, later PRVC and APRV)
 * are judged per breath. Before the first event, or for logs that predate it, the kind follows the mode.
 */
import type { BreathKind, VentEvent } from '../types';
import type { VentSettings } from './settings';

export type { BreathKind };

export type BreathEvent = Extract<VentEvent, { type: 'breath' }>;

export function breathKindFromMode(s: Pick<VentSettings, 'mode'> & Partial<Pick<VentSettings, 'simvBase'>>): BreathKind {
  switch (s.mode) {
    case 'VC-AC':
      return 'vc';
    case 'PC-AC':
    case 'PRVC':
      return 'pc';
    case 'PSV':
    case 'CPAP':
      return 'ps';
    case 'SIMV':
      return s.simvBase === 'PC' ? 'pc' : 'vc';
  }
}

/** Absolute inspiratory pressure target implied by the settings (the mandatory breath in SIMV); NaN when flow-controlled. */
export function pTargetFromSettings(s: VentSettings): number {
  switch (s.mode) {
    case 'PC-AC':
      return s.peep + s.pinsp;
    case 'PSV':
      return s.peep + s.ps;
    case 'CPAP':
      return s.peep;
    case 'SIMV':
      return s.simvBase === 'PC' ? s.peep + s.pinsp : NaN;
    case 'VC-AC':
    case 'PRVC':
      return NaN;
  }
}

/** Latest breath event at or before t (the breath in progress at t), or null. */
export function breathEventAt(events: readonly VentEvent[], t: number): BreathEvent | null {
  let out: BreathEvent | null = null;
  for (const e of events) {
    if (e.t > t + 1e-6) break;
    if (e.type === 'breath') out = e;
  }
  return out;
}
