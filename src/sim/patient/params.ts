/**
 * Patient mechanics parameters (Spec §4.2, Brief 2 §1–2).
 *
 * Internal units: cmH2O, L, L/s, s. Two compartments: index 0 = non-dependent (ND),
 * index 1 = dependent (D). Each compartment gets a fraction of lung compliance and FRC;
 * peripheral resistance scales inversely with that fraction so the parallel total is Rperiph.
 */

import type { DriveParams } from './neural-drive';
import type { BalloonParams } from './balloon';

export interface RohrerParams {
  k1: number; // cmH2O/(L/s)
  k2: number; // cmH2O/(L/s)²
}

export interface CompartmentParams {
  /** Fraction of total lung compliance and FRC in this compartment (fractions sum to 1). */
  fraction: number;
  /** Regional transmission of Pmus to this compartment's pleural pressure (Brief 2 §4, Yoshida 2013). */
  alpha: number;
}

export interface ViscoelasticParams {
  /** Maxwell-body dashpot, cmH2O/(L/s). Sets the P1−P2 drop ≈ R2·Q(1−e^(−Ti/τ)). */
  r2: number;
  /** Maxwell-body spring, cmH2O/L. τ_ve = R2/E2. */
  e2: number;
}

export interface EflParams {
  /** Expiratory flow limit slope, (L/s)/L: Qmax = k·max(0, V − vClose). */
  k: number;
  /** Volume (above FRC) below which expiratory flow limit collapses to zero. */
  vClose: number;
}

import type { RecruitableSpec } from './lung-recruitable';

export type RecoilSpec =
  | { kind: 'linear' }
  | { kind: 'venegas'; a: number; b: number; c: number; d: number }
  | RecruitableSpec;

export interface MechanicsParams {
  /** Lung elastance, cmH2O/L (total, both compartments). */
  el: number;
  /** Chest wall elastance, cmH2O/L. */
  ecw: number;
  /** Peripheral airway resistance (parallel total), inspiratory, cmH2O/(L/s). */
  rInsp: number;
  /** Peripheral airway resistance, expiratory (COPD: Rexp > Rinsp). */
  rExp: number;
  /** Central shared airway resistance (linear), cmH2O/(L/s). */
  rCentral: number;
  /** Endotracheal tube Rohrer constants, or null for no tube. */
  ett: RohrerParams | null;
  /** Relaxation volume at zero PEEP, L (Brief 2 §3). */
  frc: number;
  /** Mean pleural pressure at FRC (chest-wall recoil offset; +5..+10 for obesity/IAH), cmH2O. */
  pplOffset: number;
  /** Vertical pleural gradient, cmH2O/cm, and the lung's vertical height, cm. */
  gradient: number;
  height: number;
  /** Compartments [ND, D]. */
  compartments: [CompartmentParams, CompartmentParams];
  viscoelastic: ViscoelasticParams | null;
  efl: EflParams | null;
  recoil: RecoilSpec;
  /** Predicted body weight, kg, for mL/kg displays. */
  pbw: number;
}

export interface PatientParams {
  mechanics: MechanicsParams;
  /** Neural drive; omit for a passive (paralyzed / deeply sedated, apneic) patient. */
  drive?: DriveParams;
  /** Esophageal balloon; omit or disable for no Pes channel. */
  balloon?: BalloonParams;
  /** Heart rate for cardiac artifacts, /min. */
  heartRate?: number;
}

/** Derived per-compartment constants used by the solver. */
export interface CompartmentDerived {
  fraction: number;
  alpha: number;
  /** Pleural gradient offset for this compartment (mean zero across compartments). */
  g: number;
  /** Compartment lung elastance = EL / fraction. */
  el: number;
  /** Compartment resistances = R / fraction. */
  rInsp: number;
  rExp: number;
  frc: number;
  /** Recoil at V = 0 that makes Palv = 0 at zero PEEP: PL0 = −(pplOffset + g). */
  pl0: number;
}

export function deriveCompartments(m: MechanicsParams): [CompartmentDerived, CompartmentDerived] {
  const [nd, d] = m.compartments;
  const gSpan = m.gradient * m.height;
  const derive = (c: CompartmentParams, g: number): CompartmentDerived => ({
    fraction: c.fraction,
    alpha: c.alpha,
    g,
    el: m.el / c.fraction,
    rInsp: m.rInsp / c.fraction,
    rExp: m.rExp / c.fraction,
    frc: m.frc * c.fraction,
    pl0: -(m.pplOffset + g),
  });
  return [derive(nd, -gSpan / 2), derive(d, +gSpan / 2)];
}

/**
 * A single-compartment-equivalent linear patient for analytic tests: total compliance C (L/cmH2O)
 * and total linear resistance R (cmH2O/(L/s)), no tube nonlinearity, no chest wall split
 * (all elastance placed in the lung), no viscoelastic element, no gradient.
 */
export function linearPatient(opts: { C: number; R: number; frc?: number }): PatientParams {
  return {
    mechanics: {
      el: 1 / opts.C,
      ecw: 0,
      rInsp: opts.R,
      rExp: opts.R,
      rCentral: 0,
      ett: null,
      frc: opts.frc ?? 2.0,
      pplOffset: 0,
      gradient: 0,
      height: 0,
      compartments: [
        { fraction: 0.5, alpha: 1 },
        { fraction: 0.5, alpha: 1 },
      ],
      viscoelastic: null,
      efl: null,
      recoil: { kind: 'linear' },
      pbw: 70,
    },
  };
}
