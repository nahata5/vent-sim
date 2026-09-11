import { describe, expect, it } from 'vitest';
import { spo2Schematic } from '@/monitor/spo2';

/** Schematic SpO2 (Spec §4.6 stretch goal): alveolar gas equation → shunt equation → Severinghaus curve. */
describe('schematic SpO2', () => {
  const base = { fio2: 0.21, openFraction: 1, meanPaw: 8, paCO2: 40 };

  it('a normal lung on room air saturates 95–99 %, with PaO2 near 90–100 mmHg', () => {
    const r = spo2Schematic(base);
    expect(r.spo2).toBeGreaterThanOrEqual(95);
    expect(r.spo2).toBeLessThanOrEqual(99);
    expect(r.paO2).toBeGreaterThan(80);
    expect(r.paO2).toBeLessThan(110);
    expect(r.schematic).toBe(true);
  });

  it('is monotone: rises with FiO2 and mean Paw, falls as units close (shunt)', () => {
    const closed = { ...base, openFraction: 0.5, fio2: 0.4 };
    expect(spo2Schematic(closed).spo2).toBeLessThan(93);
    expect(spo2Schematic({ ...closed, fio2: 1 }).spo2).toBeGreaterThan(spo2Schematic(closed).spo2);
    expect(spo2Schematic({ ...closed, openFraction: 0.8 }).spo2).toBeGreaterThan(spo2Schematic(closed).spo2);
    expect(spo2Schematic({ ...closed, meanPaw: 20 }).spo2).toBeGreaterThan(spo2Schematic(closed).spo2);
    expect(spo2Schematic({ ...base, fio2: 1 }).spo2).toBeLessThanOrEqual(100);
  });

  it('a scenario base shunt lowers saturation even with every modelled unit open', () => {
    const ards = spo2Schematic({ ...base, fio2: 0.4, shunt: 0.3 });
    expect(ards.spo2).toBeLessThan(spo2Schematic({ ...base, fio2: 0.4 }).spo2);
    // 0.3 base attenuated by Pmean 8 (halved at 20): 0.3 / 1.4 ≈ 0.21, well above the normal 0.05.
    expect(ards.shunt).toBeGreaterThan(0.2);
  });
});
