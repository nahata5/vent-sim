/**
 * Esophageal balloon as an imperfect measurement of pleural pressure (Brief 2 §1.3, Spec §4.5):
 *
 *   Pes = k(fill)·Ppl(z_eso) + P_offset(+3 supine) + P_ew(fill) + Pcard_eso(t)
 *
 * Under-filling damps the swing (k < 1, Mojoli 2016: occlusion test passed in 22% at 0.5 mL vs 98% at the
 * best volume); over-filling adds esophageal wall pressure (1.1 cmH2O/mL). A balloon in the stomach reads
 * gastric pressure, which rises with diaphragm contraction, so the occlusion test fails naturally.
 */
import { k } from '../../config/constants';

export type BalloonPosition = 'esophagus' | 'high' | 'stomach';

export interface BalloonParams {
  enabled: boolean;
  fillVolume: number; // mL
  position: BalloonPosition;
  /** Height fraction sampled when in the esophagus (0 = non-dependent top, 1 = dependent bottom). */
  zFrac: number;
}

export function defaultBalloon(): BalloonParams {
  return { enabled: false, fillVolume: k('BALLOON_BEST_FILL'), position: 'esophagus', zFrac: k('PES_Z_DEFAULT') };
}

/** Swing transmission factor vs fill volume [M anchored to Mojoli 2016]. */
export function balloonTransmission(fillMl: number, position: BalloonPosition): number {
  const best = k('BALLOON_BEST_FILL');
  let kk: number;
  if (fillMl <= 0.5) kk = 0.55;
  else if (fillMl <= 2) kk = 0.55 + ((fillMl - 0.5) / 1.5) * 0.35; // → 0.9 at 2 mL
  else if (fillMl <= best) kk = 0.9 + ((fillMl - 2) / (best - 2)) * 0.06; // → 0.96 at best
  else kk = 0.96 - ((fillMl - best) / 2.5) * 0.06; // slow decline when over-filled
  if (position === 'high') kk *= k('BALLOON_HIGH_POSITION_FACTOR');
  return Math.max(0.2, Math.min(1, kk));
}

/** Esophageal wall pressure from balloon filling: 0 at 0.5 mL, ≈2 at the best volume, ≈3 at 4 mL. */
export function balloonWallPressure(fillMl: number): number {
  return k('ESO_WALL_ELASTANCE') * Math.max(0, fillMl - k('ESO_WALL_FREE_VOLUME'));
}

export interface PesInputs {
  /** True pleural pressure at the balloon height (cmH2O). */
  pplAtBalloon: number;
  /** Effective muscle pressure (for the gastric reading). */
  pmusEff: number;
  /** Chest-wall recoil pressure above FRC contribution Ecw·V (for the gastric reading). */
  ecwV: number;
  t: number;
  heartRate: number;
}

/** The displayed esophageal pressure before the sensor chain. */
export function pesFromPleural(b: BalloonParams, inp: PesInputs): number {
  const cardiac = k('PES_CARDIAC_AMP') * Math.sin((2 * Math.PI * inp.heartRate * inp.t) / 60);
  if (b.position === 'stomach') {
    // Gastric pressure: IAP + β·Pmus + γ·Ecw·V (Brief 2 §1.2 optional abdominal model [M]).
    return k('IAP_DEFAULT') + k('PGA_BETA') * inp.pmusEff + k('PGA_GAMMA') * inp.ecwV + balloonWallPressure(b.fillVolume) + cardiac;
  }
  const kk = balloonTransmission(b.fillVolume, b.position);
  return kk * inp.pplAtBalloon + k('PES_OFFSET_SUPINE') + balloonWallPressure(b.fillVolume) + cardiac;
}

export function balloonZ(b: BalloonParams): number {
  return b.position === 'high' ? k('PES_Z_HIGH') : b.zFrac;
}
