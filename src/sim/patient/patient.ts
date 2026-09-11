/**
 * Two-compartment patient model with shared chest wall (Spec §4.2, Brief 2 §1.2/§4).
 *
 *   Ppl_i  = pplOffset + Ecw·Vtot + G_i − α_i·Pmus_eff + Pcard (+ injector pleural offsets)
 *   PL_i   = PL0_i + recoil_i(V_i) + Pve_i
 *   Palv_i = Ppl_i + PL_i
 *   V̇_i    = (P_int − Palv_i)/R_i         (R by flow direction; EFL caps expiratory flow)
 *   Ṗve_i  = E2·(V̇_i − Pve_i/R2)          (Maxwell body in parallel with the elastic element)
 *
 * State is integrated with RK4 at the physics step. Nothing here touches the DOM.
 */
import type { AirwayBC } from '../types';
import type { PatientParams, CompartmentDerived } from './params';
import { deriveCompartments } from './params';
import { makeRecoil, type LungRecoil } from './recoil';
import { solveNode, type NodeInputs, type NodeSolution } from './airway-node';

export interface PatientDrive {
  /** Isometric muscle pressure, cmH2O (≥ 0 inspiratory, < 0 expiratory). */
  pmusIso: number;
  /** Cardiac pleural oscillation, cmH2O. */
  pcard: number;
  /** Leak flow model at the Y-piece, or null. */
  leak: ((paw: number) => number) | null;
  /** Multiplicative resistance modifier from injectors (1 = none). */
  rScale: number;
  /** Additive pleural offsets per compartment from injectors (e.g. pneumothorax), cmH2O. */
  pplExtra: [number, number];
  /** Force–velocity coefficient and reference flow for Pmus_eff (Spec §4.4). */
  kFv: number;
  qRef: number;
}

export interface PatientOutputs {
  paw: number;
  pint: number;
  q: number; // airway flow into the patient (L/s)
  qv: number; // ventilator-side flow
  qLeak: number;
  qComp: [number, number];
  v: [number, number]; // volumes above compartment FRC share
  vtot: number;
  palv: [number, number];
  ppl: [number, number];
  pl: [number, number];
  pve: [number, number];
  pmusEff: number;
  pcwRec: number; // chest wall recoil pressure (relaxed-chest-wall pleural pressure)
  eelvTotal: number; // absolute lung volume = FRC + vtot
}

const N = 2;

export class PatientModel {
  readonly comp: [CompartmentDerived, CompartmentDerived];
  private readonly recoil: [LungRecoil, LungRecoil];
  /** State: [V_ND, V_D, Pve_ND, Pve_D]. */
  private readonly x = new Float64Array(2 * N);
  private lastOut: PatientOutputs;
  private lastQ = 0;
  private readonly k1Base: number;
  private readonly k2: number;

  constructor(readonly params: PatientParams) {
    const m = params.mechanics;
    this.comp = deriveCompartments(m);
    this.recoil = [
      makeRecoil(m.recoil, this.comp[0].el, this.comp[0].fraction),
      makeRecoil(m.recoil, this.comp[1].el, this.comp[1].fraction),
    ];
    this.k1Base = (m.ett?.k1 ?? 0) + m.rCentral;
    this.k2 = m.ett?.k2 ?? 0;
    this.lastOut = this.outputs({ kind: 'occluded' }, this.x, PatientModel.passiveDrive());
  }

  static passiveDrive(): PatientDrive {
    return { pmusIso: 0, pcard: 0, leak: null, rScale: 1, pplExtra: [0, 0], kFv: 0, qRef: 1 };
  }

  get state(): Float64Array {
    return this.x;
  }

  get out(): PatientOutputs {
    return this.lastOut;
  }

  /** Total lung recoil elastance at the current operating point (for monitoring/tests). */
  lungElastance(): number {
    const c0 = 1 / this.recoil[0].elastance(this.x[0] ?? 0);
    const c1 = 1 / this.recoil[1].elastance(this.x[1] ?? 0);
    return 1 / (c0 + c1);
  }

  /**
   * Initialize at the static passive equilibrium for a given airway pressure (set PEEP): every
   * compartment satisfies Palv_i = Paw with zero flow and relaxed viscoelastic elements.
   */
  initAtStatic(paw: number): void {
    const m = this.params.mechanics;
    // Palv_i = Ppl_i + PL_i = (pplOffset + Ecw·Vtot + G_i) + (−(pplOffset + G_i) + recoil_i(V_i))
    //        = Ecw·Vtot + recoil_i(V_i), so Palv = 0 at V = 0 (FRC) by construction.
    // Solve recoil_i(V_i) = paw − Ecw·Vtot for both i, by damped fixed-point on Vtot.
    let vtot = 0;
    for (let iter = 0; iter < 500; iter++) {
      let sum = 0;
      for (let i = 0; i < N; i++) sum += this.invertRecoil(i, paw - m.ecw * vtot);
      if (Math.abs(sum - vtot) < 1e-10) {
        vtot = sum;
        break;
      }
      vtot = 0.5 * vtot + 0.5 * sum; // damped fixed point (chest wall couples the compartments)
    }
    for (let i = 0; i < N; i++) {
      this.x[i] = this.invertRecoil(i, paw - m.ecw * vtot);
      this.x[N + i] = 0;
    }
    this.lastQ = 0;
    this.lastOut = this.outputs({ kind: 'pressure', psrc: paw, rsrc: 0 }, this.x, PatientModel.passiveDrive());
  }

  private invertRecoil(i: number, p: number): number {
    return (this.recoil[i] as LungRecoil).volumeAt(p);
  }

  /** Effective Pmus after the force–velocity penalty (uses last step's inspiratory airway flow). */
  private pmusEff(drive: PatientDrive): number {
    if (drive.pmusIso <= 0 || drive.kFv <= 0) return drive.pmusIso;
    const ratio = Math.min(Math.max(this.lastQ / drive.qRef, 0), 1);
    return drive.pmusIso * (1 - drive.kFv * ratio);
  }

  /** Evaluate all pressures and flows for a state vector (pure, no state mutation). */
  private outputs(bc: AirwayBC, x: Float64Array, drive: PatientDrive): PatientOutputs {
    const m = this.params.mechanics;
    const v0 = x[0] ?? 0;
    const v1 = x[1] ?? 0;
    const vtot = v0 + v1;
    const pmus = this.pmusEff(drive);
    const pcwRec = m.pplOffset + m.ecw * vtot;
    const ppl: [number, number] = [0, 0];
    const pl: [number, number] = [0, 0];
    const palv: [number, number] = [0, 0];
    const pve: [number, number] = [x[N] ?? 0, x[N + 1] ?? 0];
    const vs: [number, number] = [v0, v1];
    for (let i = 0; i < N; i++) {
      const c = this.comp[i] as CompartmentDerived;
      ppl[i] = pcwRec + c.g - c.alpha * pmus + drive.pcard + (drive.pplExtra[i] ?? 0);
      pl[i] = c.pl0 + (this.recoil[i] as LungRecoil).pressure(vs[i] ?? 0) + (pve[i] ?? 0);
      palv[i] = (ppl[i] ?? 0) + (pl[i] ?? 0);
    }

    // Resistance by flow direction, iterated for consistency (at most 3 passes).
    const rScale = drive.rScale;
    const signs: [number, number] = [this.lastQ >= 0 ? 1 : -1, this.lastQ >= 0 ? 1 : -1];
    let sol: NodeSolution | null = null;
    const qComp: [number, number] = [0, 0];
    for (let pass = 0; pass < 3; pass++) {
      const rs: [number, number] = [0, 0];
      let s = 0;
      let a = 0;
      let qFixed = 0;
      const pinned: [boolean, boolean] = [false, false];
      for (let i = 0; i < N; i++) {
        const c = this.comp[i] as CompartmentDerived;
        rs[i] = ((signs[i] ?? 1) >= 0 ? c.rInsp : c.rExp) * rScale;
        // Expiratory flow limitation: pin the compartment at −Qmax if the unconstrained flow exceeds it.
        if (m.efl && (signs[i] ?? 1) < 0) {
          const qmax = m.efl.k * Math.max(0, (vs[i] ?? 0) - m.efl.vClose * c.fraction);
          if (qComp[i] !== 0 && -(qComp[i] ?? 0) > qmax) {
            pinned[i] = true;
            qFixed += -qmax;
            continue;
          }
        }
        s += 1 / (rs[i] ?? 1);
        a += (palv[i] ?? 0) / (rs[i] ?? 1);
      }
      const inputs: NodeInputs = { s, a, qFixed, k1: this.k1Base * rScale, k2: this.k2, leak: drive.leak };
      sol = solveNode(bc, inputs);
      let consistent = true;
      for (let i = 0; i < N; i++) {
        if (pinned[i]) {
          const c = this.comp[i] as CompartmentDerived;
          qComp[i] = -(m.efl?.k ?? 0) * Math.max(0, (vs[i] ?? 0) - (m.efl?.vClose ?? 0) * c.fraction);
          continue;
        }
        const qi = (sol.pint - (palv[i] ?? 0)) / (rs[i] ?? 1);
        qComp[i] = qi;
        const sgn = qi >= 0 ? 1 : -1;
        if (sgn !== (signs[i] ?? 1) && Math.abs(qi) > 1e-6) {
          signs[i] = sgn;
          consistent = false;
        }
        // Detect EFL violation on this pass so the next pass pins the compartment.
        if (m.efl && qi < 0) {
          const cd = this.comp[i] as CompartmentDerived;
          const qmax = m.efl.k * Math.max(0, (vs[i] ?? 0) - m.efl.vClose * cd.fraction);
          if (-qi > qmax + 1e-9) consistent = false;
        }
      }
      if (consistent) break;
    }
    if (!sol) throw new Error('node solve failed');
    return {
      paw: sol.paw,
      pint: sol.pint,
      q: sol.q,
      qv: sol.qv,
      qLeak: sol.qLeak,
      qComp,
      v: vs,
      vtot,
      palv,
      ppl,
      pl,
      pve,
      pmusEff: pmus,
      pcwRec,
      eelvTotal: m.frc + vtot,
    };
  }

  private derivs(bc: AirwayBC, x: Float64Array, drive: PatientDrive, out: Float64Array): PatientOutputs {
    const o = this.outputs(bc, x, drive);
    const ve = this.params.mechanics.viscoelastic;
    for (let i = 0; i < N; i++) {
      out[i] = o.qComp[i] ?? 0;
      out[N + i] = ve ? ve.e2 * ((o.qComp[i] ?? 0) - (x[N + i] ?? 0) / ve.r2) : 0;
    }
    return o;
  }

  /** Advance one physics step (RK4). The boundary condition and drive are held constant over the step. */
  step(dt: number, bc: AirwayBC, drive: PatientDrive): PatientOutputs {
    const n = 2 * N;
    const x0 = this.x;
    const k1 = new Float64Array(n);
    const k2 = new Float64Array(n);
    const k3 = new Float64Array(n);
    const k4 = new Float64Array(n);
    const tmp = new Float64Array(n);

    this.derivs(bc, x0, drive, k1);
    for (let i = 0; i < n; i++) tmp[i] = (x0[i] ?? 0) + 0.5 * dt * (k1[i] ?? 0);
    this.derivs(bc, tmp, drive, k2);
    for (let i = 0; i < n; i++) tmp[i] = (x0[i] ?? 0) + 0.5 * dt * (k2[i] ?? 0);
    this.derivs(bc, tmp, drive, k3);
    for (let i = 0; i < n; i++) tmp[i] = (x0[i] ?? 0) + dt * (k3[i] ?? 0);
    this.derivs(bc, tmp, drive, k4);
    for (let i = 0; i < n; i++) {
      x0[i] = (x0[i] ?? 0) + (dt / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0));
    }
    // Volumes cannot go below the compartment's collapse floor (−FRC share).
    for (let i = 0; i < N; i++) {
      const floor = -(this.comp[i] as CompartmentDerived).frc * 0.95;
      if ((x0[i] ?? 0) < floor) x0[i] = floor;
    }
    const o = this.outputs(bc, x0, drive);
    this.lastQ = o.q;
    this.lastOut = o;
    return o;
  }
}
