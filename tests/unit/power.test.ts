/**
 * Mechanical power surrogates (Brief 2 §3): the Gattinoni 2016 full volume-control formula next to the
 * simplified/Giosa/Becher forms already in `bands.ts`. The full formula is the exact energy of a linear
 * single-compartment lung under square-flow VC, so it must match the truth ∫Paw·dV there.
 */
import { describe, expect, it } from 'vitest';
import { gattinoniFullPower, powerSurrogate } from '@/monitor/bands';
import { runHeadless } from '@sim/headless';
import { linearPatient } from '@sim/patient/params';
import { defaultSettings } from '@sim/vent/settings';
import { truthBreathMetrics } from '@sim/truth/lung-stress';
import type { ChannelKey } from '@/worker/protocol';

describe('Gattinoni 2016 full-formula mechanical power', () => {
  it('evaluates MP = 0.098·RR·{Vt²·[½Ers + RR(1+I:E)/(60·I:E)·Raw] + Vt·PEEP}', () => {
    // RR 15, Vt 0.5 L, Ers 25, Raw 10, I:E 1:2 (0.5), PEEP 5 → flow term 15·1.5/30·10 = 7.5;
    // {0.25·(12.5 + 7.5) + 2.5} = 7.5 → ×15×0.098 = 11.025 J/min
    expect(gattinoniFullPower({ rr: 15, vtL: 0.5, ers: 25, raw: 10, ie: 0.5, peep: 5 })).toBeCloseTo(11.025, 3);
  });

  it('matches the truth ∫Paw·dV power of a linear passive lung on square-flow VC within 8 %', () => {
    const C = 0.05;
    const R = 10;
    const settings = { ...defaultSettings('VC-AC'), peep: 5, vt: 500, rr: 15, peakFlow: 30, flowPattern: 'square' as const, ideal: true };
    const res = runHeadless({ patient: linearPatient({ C, R }), settings, seed: 1, duration: 30 });
    const b = res.breaths.filter((x) => x.tEnd !== null).at(-1);
    if (!b) throw new Error('no breath');
    const at = (t: number) => Math.round(t * res.fs);
    const reader = {
      n: res.t.length,
      get: (ch: ChannelKey, i: number) => {
        if (ch === 'pes') return res.pes[i] ?? 0;
        if (ch.startsWith('truth.')) return res.truth[ch.slice(6) as keyof typeof res.truth][i] ?? 0;
        return 0;
      },
    };
    const truth = truthBreathMetrics(reader, { iStart: at(b.tStart), iInspEnd: at(b.tInspEnd), iEnd: at(b.tEnd ?? 0), frc: 2, rr: 15 });
    const ti = b.tInspEnd - b.tStart;
    const te = (b.tEnd ?? 0) - b.tInspEnd;
    const full = gattinoniFullPower({ rr: 15, vtL: 0.5, ers: 1 / C, raw: R, ie: ti / te, peep: 5 });
    expect(Math.abs(full - truth.powerTruth) / truth.powerTruth).toBeLessThan(0.08);
  });

  it('powerSurrogate uses the full formula in VC when Ers, Raw and I:E are available, else the simplified form', () => {
    const base = { mode: 'VC-AC' as const, rr: 15, vtL: 0.5, ppeak: 25, peep: 5, dp: 10 };
    const simplified = powerSurrogate(base);
    expect(simplified).toBeCloseTo(0.098 * 15 * 0.5 * (25 - 5), 6);
    const full = powerSurrogate({ ...base, ers: 25, raw: 10, ie: 0.5 });
    expect(full).toBeCloseTo(11.025, 3);
    // Pressure-targeted modes keep Becher's form regardless.
    expect(powerSurrogate({ ...base, mode: 'PC-AC', ers: 25, raw: 10, ie: 0.5 })).toBeCloseTo(0.098 * 15 * 0.5 * 25, 6);
  });
});
