import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { linearPatient } from '@sim/patient/params';
import { cardiacArtifact } from '@sim/patient/balloon';
import { breathEnergy, truthBreathMetrics, type TruthReader } from '@sim/truth/lung-stress';
import { bandFor, powerSurrogate } from '@/monitor/bands';

describe('lung-stress truth metrics', () => {
  it('integrates ∫Paw·dV over inspiration: linear lung, square flow → PEEP·Vt + R·Q·Vt + ½·E·Vt²', () => {
    // C 50 mL/cmH2O (E 20), R 10, Vt 500 mL at 30 L/min (Ti 1 s), PEEP 5: 2.5 + 2.5 + 2.5 = 7.5 cmH2O·L.
    const res = runHeadless({
      patient: linearPatient({ C: 0.05, R: 10 }),
      settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 500, peakFlow: 30, rr: 12, ideal: true },
      seed: 1,
      duration: 12,
    });
    const b = res.breaths.find((x) => x.tStart > 5 && x.tEnd !== null);
    if (!b) throw new Error('no breath');
    const i0 = Math.round(b.tStart * res.fs);
    const i1 = Math.round(b.tInspEnd * res.fs);
    const e = breathEnergy(res.truth.paw, res.truth.vlung, i0, i1);
    expect(e).toBeGreaterThan(7.5 * 0.95);
    expect(e).toBeLessThan(7.5 * 1.05);
  });

  it('derives PL, strain and power per breath from truth arrays', () => {
    // Synthetic breath: 100 Hz, 1 s insp + 1 s exp; volume triangle 0 → 0.5 L; PL rising 2 → 12.
    const n = 200;
    const cols: Record<string, Float32Array> = {};
    const t = new Float32Array(n);
    const vlung = new Float32Array(n);
    const plND = new Float32Array(n);
    const plD = new Float32Array(n);
    const paw = new Float32Array(n);
    const pmus = new Float32Array(n);
    const pes = new Float32Array(n);
    const qND = new Float32Array(n);
    const qD = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      t[i] = i / 100;
      const x = i < 100 ? i / 100 : (200 - i) / 100;
      vlung[i] = 0.5 * x;
      plND[i] = 2 + 10 * x;
      plD[i] = -1 + 9 * x;
      paw[i] = 5 + 15 * x;
      pmus[i] = i < 100 ? 6 * Math.sin(Math.PI * x) : 0;
      pes[i] = 8 - 4 * Math.sin(Math.PI * Math.min(1, i / 100));
      qND[i] = i < 5 ? -0.1 : 0.2; // brief pendelluft at the start
      qD[i] = 0.3;
    }
    Object.assign(cols, { t, 'truth.vlung': vlung, 'truth.plND': plND, 'truth.plD': plD, 'truth.paw': paw, 'truth.pmus': pmus, pes, 'truth.qND': qND, 'truth.qD': qD });
    const reader: TruthReader = { n, get: (ch, i) => cols[ch]?.[i] ?? 0 };
    const m = truthBreathMetrics(reader, { iStart: 0, iInspEnd: 100, iEnd: 199, frc: 1.5, rr: 15 });
    expect(m.plEI.nd).toBeCloseTo(12, 1);
    expect(m.plEI.d).toBeCloseTo(8, 1);
    expect(m.plEE.nd).toBeCloseTo(2, 1);
    expect(m.plEE.d).toBeCloseTo(-1, 1);
    expect(m.dPL).toBeCloseTo(10, 1); // max over compartments: ND 10, D 9
    expect(m.vt).toBeCloseTo(0.5, 2);
    expect(m.strain).toBeCloseTo(0.5 / 1.5, 2);
    expect(m.pmusPeak).toBeCloseTo(6, 1);
    expect(m.dPes).toBeCloseTo(4, 0);
    // ∫Paw dV over inspiration: 5·0.5 + ½·15·0.5 = 6.25 cmH2O·L → 0.098·15·6.25 = 9.19 J/min
    expect(m.powerTruth).toBeCloseTo(9.19, 1);
    expect(m.pendelluft).toBe(true);
  });

  it('reads ΔPes through the cardiac smoothing so a heart-rate ripple does not inflate the swing', () => {
    // 100 Hz, 1 s effort with a 4 cmH2O Pes swing, plus the model's cardiac artifact at 80/min.
    const n = 300;
    const fs = 100;
    const t = new Float32Array(n);
    const pes = new Float32Array(n);
    const zeros = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      t[i] = i / fs;
      pes[i] = 8 - 4 * Math.sin(Math.PI * Math.min(1, i / 100)) + cardiacArtifact(t[i] ?? 0, 80);
    }
    const cols: Record<string, Float32Array> = { t, pes };
    const reader: TruthReader = { n, get: (ch, i) => cols[ch]?.[i] ?? zeros[i] ?? 0 };
    const m = truthBreathMetrics(reader, { iStart: 0, iInspEnd: 100, iEnd: 299, frc: 1.5, rr: 15, fs });
    expect(Math.abs(m.dPes - 4)).toBeLessThan(0.7);
  });
});

describe('threshold bands (Brief 2 §6)', () => {
  it('classifies each metric against its cited limits', () => {
    expect(bandFor('dp', 12)).toBe('ok');
    expect(bandFor('dp', 16)).toBe('danger');
    expect(bandFor('dpl', 9)).toBe('ok');
    expect(bandFor('dpl', 13)).toBe('danger');
    expect(bandFor('plEI', 18)).toBe('ok');
    expect(bandFor('plEI', 22)).toBe('warn');
    expect(bandFor('plEI', 27)).toBe('danger');
    expect(bandFor('plEE', -1)).toBe('danger');
    expect(bandFor('plEE', 3)).toBe('ok');
    expect(bandFor('plEE', 8)).toBe('warn');
    expect(bandFor('strain', 1.2)).toBe('ok');
    expect(bandFor('strain', 1.8)).toBe('danger');
    expect(bandFor('power', 10)).toBe('ok');
    expect(bandFor('power', 20)).toBe('danger');
    expect(bandFor('pplat', 28)).toBe('ok');
    expect(bandFor('pplat', 32)).toBe('danger');
    expect(bandFor('p01', 2)).toBe('ok');
    expect(bandFor('p01', 0.5)).toBe('warn');
    expect(bandFor('p01', 5)).toBe('danger');
    expect(bandFor('pmus', 7)).toBe('ok');
    expect(bandFor('pmus', 3)).toBe('warn');
    expect(bandFor('pmus', 14)).toBe('danger');
    expect(bandFor('dpes', 5)).toBe('ok');
    expect(bandFor('dpes', 12)).toBe('danger');
    expect(bandFor('pocc', -10)).toBe('ok');
    expect(bandFor('pocc', -18)).toBe('danger');
    expect(bandFor('vtPbw', 6)).toBe('ok');
    expect(bandFor('vtPbw', 9)).toBe('danger');
    expect(bandFor('vtPbw', 3)).toBe('warn');
    expect(bandFor('dp', NaN)).toBe('none');
  });

  it('bedside power surrogates follow Gattinoni simplified (VC) and Becher (PC/PSV)', () => {
    // VC: 0.098·RR·Vt·(Ppeak − ½ΔP) with RR 15, Vt 0.5 L, Ppeak 25, ΔP 10 → 0.098·15·0.5·20 = 14.7
    expect(powerSurrogate({ mode: 'VC-AC', rr: 15, vtL: 0.5, ppeak: 25, peep: 5, dp: 10 })).toBeCloseTo(14.7, 1);
    // PC: 0.098·RR·Vt·(ΔPinsp + PEEP) with Ppeak 25, PEEP 5 → 0.098·15·0.5·25 = 18.4
    expect(powerSurrogate({ mode: 'PC-AC', rr: 15, vtL: 0.5, ppeak: 25, peep: 5, dp: null })).toBeCloseTo(18.4, 1);
    // VC without a plateau falls back to Giosa: VE·(Ppeak + PEEP + F/6)/20 with VE 7.5 L/min, F 30 L/min → 7.5·35/20 = 13.1
    expect(powerSurrogate({ mode: 'VC-AC', rr: 15, vtL: 0.5, ppeak: 25, peep: 5, dp: null, peakFlowLpm: 30 })).toBeCloseTo(13.1, 1);
  });
});
