/**
 * Spec §9.2 partition tests (Brief 2 §1–2, §5).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessResult } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { PRESETS, presetPatient, type PhenotypeId } from '@sim/patient/presets';
import { PatientModel } from '@sim/patient/patient';

function idx(res: HeadlessResult, t: number): number {
  return Math.min(res.t.length - 1, Math.max(0, Math.ceil(t * res.fs - 1e-6) - 1));
}

/** Static mechanics from an inspiratory and an expiratory hold at the end of the run (truth channels). */
function staticMechanics(id: PhenotypeId, peep: number, vt: number, opts: { ideal?: boolean } = {}) {
  const patient = presetPatient(id);
  const res = runHeadless({
    patient,
    settings: {
      ...defaultSettings('VC-AC'),
      peep,
      vt,
      peakFlow: 30,
      rr: 10,
      pause: 0,
      ideal: opts.ideal ?? true,
      // A clinician raises the high-pressure limit for a high-PEEP static measurement; an alarm-cycled
      // breath skips the hold (correct device behaviour).
      alarms: { ...defaultSettings('VC-AC').alarms, highPpeak: 60 },
    },
    seed: 1,
    duration: 46,
    schedule: [
      { t: 30, action: (e) => e.vent.requestHold('insp', 2.0) },
      { t: 38, action: (e) => e.vent.requestHold('exp', 3.0) },
    ],
  });
  const holds = res.maneuvers;
  const insp = holds.find((h) => h.kind === 'insp');
  const exp = holds.find((h) => h.kind === 'exp');
  if (!insp || !exp) throw new Error(`holds missing: ${JSON.stringify(holds)}`);
  const iEnd = idx(res, insp.tEnd);
  const eEnd = idx(res, exp.tEnd);
  const pawI = res.truth.paw[iEnd] ?? NaN;
  const pawE = res.truth.paw[eEnd] ?? NaN;
  const vI = res.truth.vlung[iEnd] ?? NaN;
  const vE = res.truth.vlung[eEnd] ?? NaN;
  // Under static conditions Palv is uniform and equals Paw; mean Ppl of a passive patient is Pcw,rec.
  const plI = pawI - (res.truth.pcwRec[iEnd] ?? NaN);
  const plE = pawE - (res.truth.pcwRec[eEnd] ?? NaN);
  return {
    res,
    patient,
    pplat: pawI,
    peepTot: pawE,
    dPaw: pawI - pawE,
    dPL: plI - plE,
    dV: vI - vE,
    plEE: plE,
    pplEE: res.truth.pcwRec[eEnd] ?? NaN,
    plEE_D: res.truth.plD[eEnd] ?? NaN,
    plEE_ND: res.truth.plND[eEnd] ?? NaN,
    ers: (pawI - pawE) / (vI - vE),
    p1: insp.p1 ?? NaN,
    p2: insp.p2 ?? NaN,
    eelv: patient.mechanics.frc + vE,
  };
}

describe('§9.2 partition', () => {
  it('passive presets: ΔPL/ΔPaw ≈ EL/Ers of Brief 2 Table 1 (static, within 15%)', () => {
    const ids: PhenotypeId[] = ['normal', 'ards-pulmonary', 'ards-extrapulmonary', 'obesity'];
    for (const id of ids) {
      const p = PRESETS[id];
      const m = staticMechanics(id, 5, Math.round(6 * p.pbw));
      const ratio = m.dPL / m.dPaw;
      const expected = p.el / (p.el + p.ecw);
      expect(Math.abs(ratio - expected) / expected, `${id} EL/Ers`).toBeLessThan(0.15);
      // and the static Ers is in the neighbourhood of the Table 1 value (Venegas curvature allowed)
      expect(Math.abs(m.ers - (p.el + p.ecw)) / (p.el + p.ecw), `${id} Ers`).toBeLessThan(0.25);
    }
  });

  it('obesity preset: high Ppl0 and negative end-expiratory PL at PEEP 5', () => {
    const m = staticMechanics('obesity', 5, 420);
    expect(m.pplEE).toBeGreaterThan(5);
    expect(m.plEE).toBeLessThan(0);
    expect(m.plEE_D).toBeLessThan(m.plEE_ND); // dependent region more negative
  });

  it('normal preset: end-expiratory PL is positive at PEEP 5', () => {
    const m = staticMechanics('normal', 5, 420);
    expect(m.plEE).toBeGreaterThan(0);
  });

  it('specific lung elastance ΔPL/strain ≈ 13.5 ± 2 across presets (Chiumello 2008)', () => {
    const ids: PhenotypeId[] = ['normal', 'ards-pulmonary', 'ards-extrapulmonary', 'obesity'];
    for (const id of ids) {
      const p = PRESETS[id];
      const m = staticMechanics(id, 5, Math.round(6 * p.pbw));
      const strain = m.dV / p.frc; // Chiumello: strain = Vt/FRC
      const espec = m.dPL / strain;
      expect(espec, `${id} specific elastance`).toBeGreaterThan(11.5);
      expect(espec, `${id} specific elastance`).toBeLessThan(15.5);
    }
  });

  it('Gattinoni 1998 direction: pulmonary ARDS Ers rises with PEEP 0→15, extrapulmonary falls', () => {
    const pulm0 = staticMechanics('ards-pulmonary', 0, 420).ers;
    const pulm15 = staticMechanics('ards-pulmonary', 15, 420).ers;
    const extra0 = staticMechanics('ards-extrapulmonary', 0, 420).ers;
    const extra15 = staticMechanics('ards-extrapulmonary', 15, 420).ers;
    expect(pulm15).toBeGreaterThan(pulm0 * 1.05);
    expect(extra15).toBeLessThan(extra0 * 0.95);
  });

  it('inspiratory hold shows a P1 → P2 drop from the viscoelastic element', () => {
    const m = staticMechanics('ards-pulmonary', 5, 420);
    expect(m.p1 - m.p2).toBeGreaterThan(0.5);
    expect(m.p1 - m.p2).toBeLessThan(6);
    // P2 is the plateau used for Pplat
    expect(Math.abs(m.p2 - m.pplat)).toBeLessThan(0.1);
  });

  it('static equilibrium at PEEP raises EELV by ≈ PEEP/Ers for a linear patient', () => {
    const p = presetPatient('normal');
    const model = new PatientModel({ mechanics: { ...p.mechanics, recoil: { kind: 'linear' } } });
    model.initAtStatic(0);
    const v0 = model.out.vtot;
    model.initAtStatic(10);
    const v10 = model.out.vtot;
    const ers = p.mechanics.el + p.mechanics.ecw;
    expect(Math.abs(v10 - v0 - 10 / ers)).toBeLessThan(0.002);
  });

  it('pendelluft channel: passive lungs show no counter-flow between compartments', () => {
    const res = runHeadless({
      patient: presetPatient('ards-pulmonary'),
      settings: { ...defaultSettings('PC-AC'), peep: 10, pinsp: 15, ti: 1, rr: 20 },
      seed: 2,
      duration: 20,
    });
    let counter = 0;
    for (let i = 0; i < res.t.length; i++) {
      const qnd = res.truth.qND[i] ?? 0;
      const qd = res.truth.qD[i] ?? 0;
      if (qnd < -0.005 && qd > 0.005) counter += 1;
    }
    expect(counter).toBe(0);
  });
});
