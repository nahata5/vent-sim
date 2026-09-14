import { describe, expect, it } from 'vitest';
import { AUTHORING_PROMPT, EXAMPLE_SCENARIO, authoringDocument } from '@/edu/authoring';
import { CRITERIA_EXTRA_METRICS, validateScenario } from '@/edu/scenario-schema';
import { SCENARIOS, resolveScenario } from '@/edu/scenarios';
import { runHeadless } from '@sim/headless';
import { PHENOTYPE_IDS } from '@sim/patient/presets';
import { PATTERN_IDS } from '@sim/truth/labeler';
import { INJECTOR_KINDS } from '@sim/injectors';
import { IMPLEMENTED_MODES } from '@sim/types';

describe('authoring prompt', () => {
  it('the worked example validates cleanly, is not a shipped scenario and runs', () => {
    const r = validateScenario(JSON.parse(JSON.stringify(EXAMPLE_SCENARIO)));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(SCENARIOS.some((s) => s.id === EXAMPLE_SCENARIO.id)).toBe(false);
    const res = runHeadless({ ...resolveScenario(EXAMPLE_SCENARIO), duration: 8 });
    expect(res.breaths.length).toBeGreaterThan(2);
  });

  it('lists every enumeration and bound the validator enforces, and embeds the example verbatim', () => {
    for (const p of PHENOTYPE_IDS) expect(AUTHORING_PROMPT).toContain(`"${p}"`);
    for (const p of PATTERN_IDS) expect(AUTHORING_PROMPT).toContain(`"${p}"`);
    for (const k of INJECTOR_KINDS) expect(AUTHORING_PROMPT).toContain(`"${k}"`);
    for (const m of IMPLEMENTED_MODES) expect(AUTHORING_PROMPT).toContain(`"${m}"`);
    // criteria.extra is spelled out shape by shape (peepiTrue takes "max", recruitedGain takes "min"),
    // so the prompt must still name every metric the validator accepts.
    for (const m of CRITERIA_EXTRA_METRICS) expect(AUTHORING_PROMPT).toContain(`"${m}"`);
    expect(AUTHORING_PROMPT).toContain('{ "metric": "peepiTrue", "max": number } or { "metric": "recruitedGain", "min": number }');
    expect(AUTHORING_PROMPT).toContain('vt: 100–1200 mL');
    expect(AUTHORING_PROMPT).toContain(JSON.stringify(EXAMPLE_SCENARIO, null, 2));
    expect(AUTHORING_PROMPT).toMatch(/interview/i);
    expect(AUTHORING_PROMPT).toMatch(/output (only )?one JSON object/i);
  });

  it('the generated document contains the prompt inside a fenced block', () => {
    const doc = authoringDocument();
    expect(doc.startsWith('# Writing your own VentSim scenario')).toBe(true);
    expect(doc).toContain('```text\n' + AUTHORING_PROMPT + '\n```');
  });
});
