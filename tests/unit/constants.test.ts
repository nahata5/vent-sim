import { describe, expect, it } from 'vitest';
import { CONSTANTS, listConstants } from '@config/constants';

describe('constants registry', () => {
  it('every constant carries value, unit, source and a confidence tag', () => {
    const all = listConstants();
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect(typeof c.value === 'number' || Array.isArray(c.value)).toBe(true);
      expect(c.unit.length).toBeGreaterThan(0);
      expect(c.source.length).toBeGreaterThan(3);
      expect(['V', 'L', 'M']).toContain(c.confidence);
    }
  });

  it('exposes named constants with the expected shape', () => {
    expect(CONSTANTS.PHYSICS_DT.value).toBe(0.001);
    expect(CONSTANTS.PHYSICS_DT.unit).toBe('s');
  });
});
