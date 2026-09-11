import { describe, expect, it } from 'vitest';
import { runHeadless } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient } from '@sim/patient/presets';
import { TRUTH_CHANNELS } from '@sim/channels';

describe('truth channels', () => {
  it('expose per-compartment volumes that sum to the total lung volume', () => {
    expect(TRUTH_CHANNELS).toContain('vND');
    expect(TRUTH_CHANNELS).toContain('vD');
    const res = runHeadless({ patient: presetPatient('ards-pulmonary'), settings: defaultSettings('VC-AC'), seed: 1, duration: 8 });
    const n = res.t.length;
    let maxErr = 0;
    let maxV = 0;
    for (let i = 0; i < n; i++) {
      const sum = (res.truth.vND[i] ?? 0) + (res.truth.vD[i] ?? 0);
      maxErr = Math.max(maxErr, Math.abs(sum - (res.truth.vlung[i] ?? 0)));
      maxV = Math.max(maxV, res.truth.vlung[i] ?? 0);
    }
    expect(maxV).toBeGreaterThan(0.3);
    expect(maxErr).toBeLessThan(1e-4);
  });
});
