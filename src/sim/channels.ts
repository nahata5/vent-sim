/**
 * Device-rate channel layout for sample batches (Spec §3 messages, §6 truth layer).
 * Measured channels are what the ventilator, monitor and detector see. Truth channels are for
 * teaching displays, labels and scoring only.
 */

export const MEASURED_CHANNELS = ['t', 'paw', 'flow', 'vol', 'pes'] as const;
export type MeasuredChannel = (typeof MEASURED_CHANNELS)[number];

export const TRUTH_CHANNELS = [
  'paw', // true airway pressure at the Y-piece
  'flow', // true airway flow into the patient (past any leak)
  'qv', // true ventilator-side flow
  'vlung', // true lung volume above FRC (both compartments)
  'pmus', // effective muscle pressure
  'pmusIso', // isometric muscle pressure (neural command)
  'palv', // volume-weighted mean alveolar pressure
  'palvND',
  'palvD',
  'pplND',
  'pplD',
  'plND',
  'plD',
  'pesTrue', // esophageal pressure before sensor chain
  'qND',
  'qD',
  'pcwRec',
  'phase', // 0 exp, 1 insp, 2 pause, 3 exp-hold, 4 occlusion
] as const;
export type TruthChannel = (typeof TRUTH_CHANNELS)[number];

export const PHASE_CODE = { exp: 0, insp: 1, pause: 2, 'exp-hold': 3, occlusion: 4 } as const;
