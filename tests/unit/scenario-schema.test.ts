import { describe, expect, it } from 'vitest';
import { parseScenarioText, validateScenario } from '@/edu/scenario-schema';
import { SCENARIOS } from '@/edu/scenarios';

const good = {
  id: 'my-case',
  title: 'My case',
  phenotype: 'copd',
  drive: { rate: 20, ti: 0.9, pmax: 6 },
  settings: { mode: 'PSV', ps: 14, ets: 0.1 },
  targetPatterns: ['ineffective-effort'],
  fix: { at: 60, note: 'ETS up', settings: { ets: 0.5 } },
  criteria: { minFraction: 0.2, aiAfter: 10 },
};

describe('validateScenario', () => {
  it('accepts a minimal scenario and fills the defaults', () => {
    const r = validateScenario(good);
    expect(r.errors).toEqual([]);
    expect(r.def?.order).toBe(999);
    expect(r.def?.category).toBe('dyssynchrony');
    expect(r.def?.objectives).toEqual([]);
    expect(r.def?.seed).toBe(1);
  });

  it('accepts every shipped scenario without errors or warnings', () => {
    for (const s of SCENARIOS) {
      const r = validateScenario(JSON.parse(JSON.stringify(s)));
      expect(r.errors, s.id).toEqual([]);
      expect(r.warnings, s.id).toEqual([]);
    }
  });

  it('reports each problem by field name', () => {
    const r = validateScenario({
      ...good,
      id: 'Bad Id!',
      phenotype: 'martian',
      settings: { mode: 'NAVA', vt: 5000 },
      targetPatterns: ['ineffective-effort', 'nonsense'],
      injectors: { leak: { k: 0.02 }, magic: {} },
      quizExtras: [{ metric: 'pao2', max: 1 }],
      criteria: { minFraction: 3, aiAfter: 10 },
    });
    expect(r.def).toBeNull();
    expect(r.errors.join('\n')).toMatch(/"id"/);
    expect(r.errors.join('\n')).toMatch(/"phenotype".*martian/);
    expect(r.errors.join('\n')).toMatch(/settings\.mode/);
    expect(r.errors.join('\n')).toMatch(/settings\.vt.*1200/);
    expect(r.errors.join('\n')).toMatch(/targetPatterns.*nonsense/);
    expect(r.errors.join('\n')).toMatch(/injectors\.magic/);
    expect(r.errors.join('\n')).toMatch(/quizExtras\[0\]\.metric/);
    expect(r.errors.join('\n')).toMatch(/criteria\.minFraction/);
  });

  it('warns about unknown keys but still returns a definition', () => {
    const r = validateScenario({ ...good, colour: 'blue', settings: { mode: 'PSV', psv: 10 } });
    expect(r.def).not.toBeNull();
    expect(r.warnings).toEqual(['unknown key "colour" (ignored)', 'unknown key settings.psv (ignored)']);
  });

  it('validates the fix block, drive ranges and the recoil spec', () => {
    const r = validateScenario({
      ...good,
      drive: { rate: 200 },
      mechanics: { recoil: 'linear' },
      fix: { at: -1, note: 3, settings: { peep: 99 }, injectors: { leak: null, foo: {} } },
    });
    const text = r.errors.join('\n');
    expect(text).toMatch(/drive\.rate/);
    expect(text).toMatch(/mechanics\.recoil/);
    expect(text).toMatch(/fix\.at/);
    expect(text).toMatch(/fix\.note/);
    expect(text).toMatch(/fix\.settings\.peep/);
    expect(text).toMatch(/fix\.injectors\.foo/);
  });

  it('parseScenarioText reports JSON syntax errors as the only error', () => {
    const r = parseScenarioText('{ not json');
    expect(r.def).toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/JSON/);
  });

  it('warns about drive keys that are not in DRIVE_BOUNDS or the known DriveParams extras', () => {
    const r = validateScenario({ ...good, drive: { rate: 20, pMax: 30, Ti: 1.2 } });
    expect(r.warnings.join('\n')).toMatch(/drive\.pMax/);
    expect(r.warnings.join('\n')).toMatch(/drive\.Ti/);
  });

  it('checks gas is an object of finite numbers and warns on unknown gas keys', () => {
    const r = validateScenario({ ...good, gas: { warp: 'x', nonsense: true } });
    expect(r.errors.join('\n')).toMatch(/gas\.warp/);
    expect(r.warnings.join('\n')).toMatch(/gas\.nonsense/);
  });

  it('warns on injector parameter keys that are not "at" or a known param of that kind', () => {
    const r = validateScenario({ ...good, injectors: { leak: { kk: 0.02 } } });
    expect(r.warnings.join('\n')).toMatch(/injectors\.leak\.kk/);
  });

  it('rejects a non-positive mechanics.el', () => {
    const r = validateScenario({ ...good, mechanics: { el: 0 } });
    expect(r.errors.join('\n')).toMatch(/mechanics\.el/);
  });

  it('accepts SIMV settings and rejects a bad simvBase', () => {
    const ok = validateScenario({ ...good, settings: { mode: 'SIMV', simvBase: 'PC', pinsp: 12, ps: 8, simvWindow: 0.3 } });
    expect(ok.errors).toEqual([]);
    const bad = validateScenario({ ...good, settings: { mode: 'SIMV', simvBase: 'VS' } });
    expect(bad.errors.join('\n')).toMatch(/settings\.simvBase/);
  });

  it('accepts APRV settings, rejects a bad tlowMode, and accepts a recruitedGain criterion with min', () => {
    const ok = validateScenario({ ...good, settings: { mode: 'APRV', phigh: 28, plow: 0, thigh: 4.5, tlow: 0.5, tlowMode: 'pefr', tlowPefr: 0.75 }, criteria: { minFraction: 0.3, aiAfter: 10, extra: [{ metric: 'recruitedGain', min: 0 }] } });
    expect(ok.errors).toEqual([]);
    const bad = validateScenario({ ...good, settings: { mode: 'APRV', tlowMode: 'auto' } });
    expect(bad.errors.join('\n')).toMatch(/settings\.tlowMode/);
    const badExtra = validateScenario({ ...good, criteria: { minFraction: 0.3, aiAfter: 10, extra: [{ metric: 'recruitedGain', max: 1 }] } });
    expect(badExtra.errors.join('\n')).toMatch(/criteria\.extra/);
  });
});
