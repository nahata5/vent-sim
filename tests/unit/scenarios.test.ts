import { describe, expect, it } from 'vitest';
import { SCENARIOS, resolveScenario, scenarioById } from '@/edu/scenarios';
import { QUIZ_EXTRA_METRICS } from '@/edu/quiz';
import { runHeadless } from '@sim/headless';
import { PHENOTYPE_IDS } from '@sim/patient/presets';

describe('scenario library', () => {
  it('seeds one scenario per phenotype preset plus the three M5 dyssynchrony scenarios', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PHENOTYPE_IDS) expect(SCENARIOS.some((s) => s.phenotype === p && s.category === 'preset'), p).toBe(true);
    for (const id of ['double-trigger', 'ineffective-effort', 'reverse-trigger']) expect(ids).toContain(id);
    for (const s of SCENARIOS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.objectives.length).toBeGreaterThan(0);
    }
  });

  it('every scenario resolves to a runnable spec that produces finite waveforms', () => {
    for (const s of SCENARIOS) {
      const spec = resolveScenario(s);
      const res = runHeadless({ ...spec, duration: 6 });
      expect(res.paw.every((x) => Number.isFinite(x)), s.id).toBe(true);
      expect(res.breaths.length, s.id).toBeGreaterThan(0);
    }
  });

  it('double-trigger: ≥ 20% of efforts receive two triggers', () => {
    const res = runHeadless({ ...resolveScenario(scenarioById('double-trigger')), duration: 90 });
    const triggers = res.events.filter((e) => e.type === 'trigger').map((e) => e.t);
    const efforts = res.neuralBreaths.filter((b) => b.tOnset > 10);
    const doubles = efforts.filter((b) => triggers.filter((t) => t >= b.tOnset - 0.1 && t <= b.tOnset + b.ti + 0.4).length >= 2);
    expect(doubles.length / efforts.length).toBeGreaterThan(0.2);
  });

  it('ineffective-effort: ≥ 20% of efforts fail to trigger', () => {
    const res = runHeadless({ ...resolveScenario(scenarioById('ineffective-effort')), duration: 120 });
    const triggers = res.events.filter((e) => e.type === 'trigger' && e.cause === 'patient').map((e) => e.t);
    const efforts = res.neuralBreaths.filter((b) => b.tOnset > 10 && b.tOnset < 110);
    const ineffective = efforts.filter((b) => !triggers.some((t) => t >= b.tOnset && t <= b.tOnset + b.ti + 0.3));
    expect(ineffective.length / efforts.length).toBeGreaterThan(0.2);
  });

  it('reverse-trigger: efforts follow machine breaths with a stable ~0.4 s delay', () => {
    const res = runHeadless({ ...resolveScenario(scenarioById('reverse-trigger')), duration: 60 });
    const starts = res.breaths.map((x) => x.tStart);
    const efforts = res.neuralBreaths.filter((b) => b.tOnset > 5);
    const delays = efforts.map((e) => e.tOnset - (starts.filter((m) => m <= e.tOnset).at(-1) ?? 0));
    const mean = delays.reduce((s, x) => s + x, 0) / delays.length;
    expect(Math.abs(mean - 0.4)).toBeLessThan(0.08);
  });
});

describe('scenario quiz extras', () => {
  it('the balloon teaching scenarios grade PL,ee ≥ 0 in the quiz fix, and every extra names a known metric with a limit', () => {
    for (const id of ['obesity', 'abdominal-hypertension', 'ards-extrapulmonary']) {
      const def = scenarioById(id);
      expect(def.quizExtras?.some((x) => x.metric === 'plEE' && x.min === 0), id).toBe(true);
    }
    for (const def of SCENARIOS) {
      for (const x of def.quizExtras ?? []) {
        expect(QUIZ_EXTRA_METRICS.includes(x.metric), `${def.id} ${x.metric}`).toBe(true);
        expect(x.min !== undefined || x.max !== undefined, `${def.id} ${x.metric}`).toBe(true);
      }
    }
  });
});
