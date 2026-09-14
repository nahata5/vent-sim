/**
 * The quiz fix in APRV (M13 review): each APRV scenario's scripted fix must be able to pass `gradeFix`.
 * APRV has no hold, so the clinically meaningful driving pressure (Phigh − PEEPtot) cannot be measured:
 * the controller passes `dp: null`, which grades as unverified rather than as a failure. The plateau
 * substitute stays Phigh. This test reproduces `Controller.quizFixInput` headlessly for the post-fix
 * window and asserts the fix passes.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessResult } from '@sim/headless';
import { labelRun, asynchronyIndex } from '@sim/truth/labeler';
import { truthBreathMetrics, type TruthBreathMetrics } from '@sim/truth/lung-stress';
import type { ChannelKey } from '@/worker/protocol';
import { resolveScenario, scenarioById, scenarioSchedule } from '@/edu/scenarios';
import { defaultSettings } from '@sim/vent/settings';
import { extrasFromTruth, gradeFix, type FixInput } from '@/edu/quiz';
import { EMERGENCE_DURATION, EMERGENCE_FIX_AT, EMERGENCE_SETTLE } from '@/detector/validation';

const APRV_SCENARIOS = ['aprv-tlow-too-long', 'aprv-release-collision', 'aprv-high-effort'] as const;

/** The reader `truthBreathMetrics` expects, over a headless run's device-rate streams. */
function reader(res: HeadlessResult) {
  return {
    n: res.t.length,
    get: (ch: ChannelKey, i: number) => {
      if (ch === 'pes') return res.pes[i] ?? 0;
      if (ch.startsWith('truth.')) return res.truth[ch.slice(6) as keyof typeof res.truth]?.[i] ?? 0;
      return 0;
    },
  };
}

/** Truth metrics for every closed breath starting in [t0, t1) — the headless twin of `Controller.truthLog`. */
function truthWindow(res: HeadlessResult, t0: number, t1: number): TruthBreathMetrics[] {
  const r = reader(res);
  const at = (t: number) => Math.round(t * res.fs);
  const out: TruthBreathMetrics[] = [];
  for (const b of res.breaths) {
    if (b.tEnd === null || b.tStart < t0 || b.tStart >= t1) continue;
    const iStart = at(b.tStart);
    const iEnd = at(b.tEnd);
    const iInspEnd = Math.max(iStart, at(Number.isNaN(b.tPauseEnd) ? b.tInspEnd : b.tPauseEnd));
    const period = b.tEnd - b.tStart;
    out.push(truthBreathMetrics(r, { iStart, iInspEnd, iEnd, frc: res.frc, rr: period > 0 ? 60 / period : 0, fs: res.fs }));
  }
  return out;
}

function fixInput(id: string): { input: FixInput; vtPerKg: number; breaths: number } {
  const def = scenarioById(id);
  const res = runHeadless({ ...resolveScenario(def), duration: EMERGENCE_DURATION, schedule: scenarioSchedule(def, { withFix: true, fixAt: EMERGENCE_FIX_AT }) });
  const t0 = EMERGENCE_FIX_AT + EMERGENCE_SETTLE;
  const t1 = EMERGENCE_DURATION;
  const ai = asynchronyIndex(labelRun(res), t0, t1).ai;
  // Vt per kg exactly as the monitor computes it: exhaled (measured) volume in mL over PBW in kg.
  const closed = res.breaths.filter((b) => b.tEnd !== null && b.tStart >= t0 && b.tStart < t1);
  const vtPerKg = closed.reduce((a, b) => a + (b.vteMeasured * 1000) / res.pbw, 0) / Math.max(1, closed.length);
  const phigh = def.settings.phigh ?? defaultSettings('APRV').phigh;
  const extras = extrasFromTruth(def.quizExtras ?? [], truthWindow(res, t0, t1));
  return {
    input: {
      ai,
      breaths: [{ dp: null, pplat: phigh, vtPerKg }],
      newSevereAlarms: [],
      extras,
      labels: { dp: 'Phigh − PEEPtot (needs an expiratory hold; not available in APRV)', pplat: 'Phigh' },
    },
    vtPerKg,
    breaths: closed.length,
  };
}

describe('quiz fix in APRV: the scripted fix of every APRV scenario passes', () => {
  for (const id of APRV_SCENARIOS) {
    it(`${id}: gradeFix passes after the scripted fix, with ΔP unverified`, () => {
      const { input } = fixInput(id);
      const g = gradeFix(input);
      const failing = g.checks.filter((c) => !c.ok).map((c) => `${c.id}=${c.value?.toFixed(2)} (${c.label})`);
      expect(failing, failing.join('; ')).toEqual([]);
      expect(g.pass).toBe(true);
      const dp = g.checks.find((c) => c.id === 'dp');
      expect(dp?.verified).toBe(false);
      expect(dp?.ok).toBe(true);
      expect(g.checks.find((c) => c.id === 'pplat')?.verified).toBe(true);
    });
  }
});
