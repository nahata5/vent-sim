/**
 * Performance (Spec §9.7): headless batch runs at least 50× real time (so the worker at 1× uses a small
 * share of one core and the batch generator is practical). The 60 fps render budget is asserted in
 * Playwright (`tests/e2e/load.spec.ts`, < 8 ms per frame).
 */
import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { resolveScenario, scenarioById } from '@/edu/scenarios';

describe('performance (§9.7)', () => {
  it('a 60 s spontaneous-breathing scenario with the CO2 loop and the recruitable lung runs ≥ 50× real time', () => {
    for (const id of ['co2-under-assist', 'peep-trial-recruiter', 'ineffective-effort']) {
      const spec = resolveScenario(scenarioById(id));
      runHeadless({ ...spec, duration: 2 }); // warm up the JIT
      const t0 = performance.now();
      runHeadless({ ...spec, duration: 60 });
      const wall = (performance.now() - t0) / 1000;
      expect(60 / wall, `${id}: ${(60 / wall).toFixed(0)}× real time`).toBeGreaterThanOrEqual(50);
    }
  });
});
