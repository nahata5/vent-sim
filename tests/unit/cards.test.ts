/**
 * Explain cards (Spec §8): one card per pattern with definition, mechanism, signature, causes, ranked fixes,
 * pitfalls and citations, plus templated case-specific evidence from the truth labels (no LLM).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { labelRun, PATTERN_IDS, type BreathLabel } from '@sim/truth/labeler';
import { resolveScenario, scenarioById } from '@/edu/scenarios';
import { CARDS, caseEvidence, effortEvidence, explainBreath } from '@/edu/cards';

function labelled(id: string, duration = 60) {
  const spec = resolveScenario(scenarioById(id));
  const res = runHeadless({ ...spec, duration });
  return { res, out: labelRun(res), settings: spec.settings, pbw: spec.patient.mechanics.pbw };
}

describe('explain cards', () => {
  it('every pattern has a complete card with at least one ranked fix and one citation', () => {
    for (const id of PATTERN_IDS) {
      const c = CARDS[id];
      expect(c, id).toBeDefined();
      expect(c.title.length, id).toBeGreaterThan(3);
      for (const f of ['definition', 'mechanism', 'signature'] as const) expect(c[f].length, `${id} ${f}`).toBeGreaterThan(20);
      expect(c.fixes.length, id).toBeGreaterThanOrEqual(1);
      expect(c.citations.length, id).toBeGreaterThanOrEqual(1);
      expect(c.citations.some((s) => /doi\.org|Brief|Spec/.test(s)), `${id} citation source`).toBe(true);
    }
  });

  it('delayed cycling: the evidence names the neural and ventilator Ti and the cycling delay from the label', () => {
    const { out, settings, res } = labelled('ineffective-effort');
    const b = out.breaths.find((x) => x.patterns.includes('delayed-cycling') && x.neuralIndex !== null) as BreathLabel;
    expect(b).toBeDefined();
    const lines = caseEvidence({ label: b, neural: res.neuralBreaths[b.neuralIndex ?? 0] ?? null, settings, pbw: 70 });
    const text = lines.join(' ');
    expect(text).toMatch(/neural Ti \d\.\d\d s/);
    expect(text).toMatch(/ventilator Ti \d\.\d\d s/);
    expect(text).toContain(`${(b.cycleDelay ?? 0).toFixed(2)} s`);
  });

  it('double trigger: the evidence reports the stacked volume in mL/kg against the set Vt', () => {
    const { out, settings } = labelled('double-trigger');
    const b = out.breaths.find((x) => x.patterns.includes('double-trigger') && x.evidence.stackedVt !== undefined) as BreathLabel;
    expect(b).toBeDefined();
    const text = caseEvidence({ label: b, neural: null, settings, pbw: 70 }).join(' ');
    expect(text).toMatch(/stacked/i);
    expect(text).toMatch(/\d+(\.\d)? mL\/kg/);
  });

  it('ineffective effort: effort-level evidence gives the effort time, its Ti and the ventilator phase', () => {
    const { out, settings } = labelled('ineffective-effort');
    const e = out.efforts.find((x) => x.ineffective);
    expect(e).toBeDefined();
    if (!e) return;
    const text = effortEvidence(e, settings).join(' ');
    expect(text).toMatch(/did not trigger/);
    expect(text).toContain(`${e.tOnset.toFixed(1)} s`);
    expect(text).toMatch(/expiration|inspiration/);
  });

  it('a synchronous breath yields no evidence lines and explainBreath returns no cards', () => {
    const { out, settings } = labelled('normal-passive', 20);
    const b = out.breaths.find((x) => x.tStart > 5) as BreathLabel;
    expect(caseEvidence({ label: b, neural: null, settings, pbw: 70 })).toEqual([]);
    expect(explainBreath({ label: b, neural: null, settings, pbw: 70 })).toEqual([]);
  });

  it('explainBreath pairs each pattern on the label with its card and evidence', () => {
    const { out, settings, res } = labelled('ineffective-effort');
    const b = out.breaths.find((x) => x.patterns.length > 0) as BreathLabel;
    const cards = explainBreath({ label: b, neural: res.neuralBreaths[b.neuralIndex ?? 0] ?? null, settings, pbw: 70 });
    expect(cards.length).toBe(b.patterns.length);
    for (const c of cards) {
      expect(b.patterns).toContain(c.card.id);
      expect(Array.isArray(c.evidence)).toBe(true);
    }
  });
});
