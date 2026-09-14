import { describe, expect, it } from 'vitest';
import { breathEventAt, breathKindFromMode, pTargetFromSettings } from '@sim/vent/breath-kind';
import { defaultSettings } from '@sim/vent/settings';
import type { VentEvent } from '@sim/types';

describe('breath kind', () => {
  it('maps every current mode to its breath kind', () => {
    expect(breathKindFromMode({ mode: 'VC-AC' })).toBe('vc');
    expect(breathKindFromMode({ mode: 'PC-AC' })).toBe('pc');
    expect(breathKindFromMode({ mode: 'PSV' })).toBe('ps');
    expect(breathKindFromMode({ mode: 'CPAP' })).toBe('ps');
  });

  it('pressure target per mode: PEEP + ΔP for pressure modes, NaN for VC', () => {
    expect(pTargetFromSettings({ ...defaultSettings('PC-AC'), peep: 8, pinsp: 12 })).toBe(20);
    expect(pTargetFromSettings({ ...defaultSettings('PSV'), peep: 5, ps: 10 })).toBe(15);
    expect(pTargetFromSettings({ ...defaultSettings('CPAP'), peep: 6 })).toBe(6);
    expect(pTargetFromSettings(defaultSettings('VC-AC'))).toBeNaN();
  });

  it('breathEventAt returns the latest breath event at or before t, else null', () => {
    const events: VentEvent[] = [
      { type: 'trigger', t: 1, cause: 'time' },
      { type: 'breath', t: 1.03, kind: 'vc', mandatory: true, pTarget: NaN },
      { type: 'cycle', t: 2, cause: 'volume' },
      { type: 'breath', t: 4.03, kind: 'ps', mandatory: false, pTarget: 15 },
    ];
    expect(breathEventAt(events, 0.5)).toBeNull();
    expect(breathEventAt(events, 1.03)?.kind).toBe('vc');
    expect(breathEventAt(events, 3)?.kind).toBe('vc');
    expect(breathEventAt(events, 4.03)?.kind).toBe('ps');
    expect(breathEventAt(events, 9)?.pTarget).toBe(15);
  });
});
