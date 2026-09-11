/**
 * Recruitment-to-inflation ratio (Spec §5, Brief 2 §2.4, Chen 2020) and the decremental PEEP trial.
 * Both are ventilator maneuvers on measured signals: one-breath PEEP release 15 → 5 with Crs,low from a
 * hold at low PEEP; automated PEEP steps with a hold per step. What must emerge (D-014): the recruiter
 * scenario reads a high R/I and the Gattinoni-anchored extrapulmonary preset an intermediate one, a
 * consolidated lung reads ≈ 0, a normal lung ≈ 0, and the recruiter's compliance traces an inverted U
 * with the best PEEP between 8 and 18 cmH2O while the non-recruiter's best PEEP is low.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessResult } from '@sim/headless';
import { defaultSettings, type VentSettings } from '@sim/vent/settings';
import { presetPatient, recruitableRecoil, type PhenotypeId } from '@sim/patient/presets';
import type { ManeuverKind, ManeuverResult } from '@sim/types';
import { defaultBalloon } from '@sim/patient/balloon';
import { resolveScenario, scenarioById } from '@/edu/scenarios';
import { k } from '@/config/constants';

const VC = (peep: number, extra: Partial<VentSettings> = {}): VentSettings => ({ ...defaultSettings('VC-AC'), peep, vt: 420, rr: 15, peakFlow: 40, alarms: { ...defaultSettings().alarms, highPpeak: 60 }, ...extra });

function run(id: PhenotypeId, kind: ManeuverKind, opts: { recruitable: boolean; peep: number; at: number; duration: number; settings?: Partial<VentSettings> }): HeadlessResult {
  const patient = presetPatient(id, opts.recruitable ? { recoil: recruitableRecoil(id) } : {});
  if (opts.settings?.esophagealBalloon) patient.balloon = { ...defaultBalloon(), enabled: true };
  return runHeadless({ patient, settings: VC(opts.peep, opts.settings), seed: 1, duration: opts.duration, schedule: [{ t: opts.at, action: (e) => e.vent.requestPeepManeuver(kind as 'ri' | 'peep-trial') }] });
}

function runScenario(id: string, kind: ManeuverKind, at: number, duration: number, settings: Partial<VentSettings> = {}): HeadlessResult {
  const spec = resolveScenario(scenarioById(id));
  return runHeadless({ ...spec, settings: { ...spec.settings, ...settings }, duration, schedule: [{ t: at, action: (e) => e.vent.requestPeepManeuver(kind as 'ri' | 'peep-trial') }] });
}

function result(res: HeadlessResult, kind: ManeuverKind): ManeuverResult {
  const r = res.maneuvers.find((m) => m.kind === kind);
  if (!r) throw new Error(`no ${kind} result`);
  return r;
}

describe('R/I maneuver (Chen 2020, one-breath PEEP release 15 → 5)', () => {
  it('recruiter scenario at PEEP 15: R/I ≥ 0.3 with the pieces reported, PEEP restored, release breath visible', () => {
    const res = runScenario('peep-trial-recruiter', 'ri', 30, 70);
    const r = result(res, 'ri');
    const v = r.values ?? {};
    expect(v.peepHigh).toBe(15);
    expect(v.peepLow).toBe(k('RI_PEEP_LOW'));
    expect(v.crsLow ?? 0).toBeGreaterThan(20); // mL/cmH2O at PEEP 5
    expect(v.crsLow ?? 0).toBeLessThan(80);
    expect(v.dVrelease ?? 0).toBeGreaterThan(v.vrec ?? 0); // Vpred > 0
    expect(v.vrec ?? 0).toBeGreaterThan(150); // mL that compliance alone cannot explain
    expect(v.ri ?? 0).toBeGreaterThanOrEqual(0.3);
    // PEEP is restored after the maneuver and the whole thing takes a handful of breaths.
    expect(res.settingsLog.at(-1)?.settings.peep).toBe(15);
    expect(r.tEnd - r.tStart).toBeLessThan(40);
    // The release breath itself carries the extra expired volume (truth agrees with the measurement).
    const rel = res.breaths.find((b) => b.tStart >= r.tStart && b.vteTrue > 0.6);
    expect(rel).toBeDefined();
    expect((rel?.frcAeratedEE ?? 0)).toBeLessThan(res.breaths.find((b) => b.tStart > 20 && b.tStart < r.tStart)?.frcAeratedEE ?? 0);
  });

  it('phenotype ordering: extrapulmonary preset (Gattinoni average, stiff chest wall) reads intermediate; consolidated ARDS < 0.1; normal Venegas lung ≈ 0', () => {
    const e = result(run('ards-extrapulmonary', 'ri', { recruitable: true, peep: 15, at: 30, duration: 70 }), 'ri').values ?? {};
    const p = result(run('ards-pulmonary', 'ri', { recruitable: true, peep: 15, at: 30, duration: 70 }), 'ri').values ?? {};
    const n = result(run('normal', 'ri', { recruitable: false, peep: 15, at: 30, duration: 70 }), 'ri').values ?? {};
    expect(e.ri ?? 0).toBeGreaterThan(0.1);
    expect(e.ri ?? 0).toBeGreaterThan((p.ri ?? 0) + 0.1);
    expect(e.vrec ?? 0).toBeGreaterThan(50);
    expect(p.ri ?? 1).toBeLessThan(0.1);
    expect(Math.abs(n.ri ?? 1)).toBeLessThan(0.25);
  });

  it('works in pressure control too (Crs,low from the low-PEEP breath\'s own Vt)', () => {
    const v = result(runScenario('peep-trial-recruiter', 'ri', 30, 70, { mode: 'PC-AC', pinsp: 12, ti: 1.0 }), 'ri').values ?? {};
    expect(v.crsLow ?? 0).toBeGreaterThan(20);
    expect(v.ri ?? 0).toBeGreaterThanOrEqual(0.3);
  });
});

describe('decremental PEEP trial (Spec §5)', () => {
  it('recruiter: steps from 20 down by 2 with a hold per step; Crs peaks between PEEP 8 and 18; PEEP restored', () => {
    const res = runScenario('peep-trial-recruiter', 'peep-trial', 20, 260, { peep: 12 });
    const r = result(res, 'peep-trial');
    const table = r.table ?? [];
    const peeps = table.map((s) => s.peep);
    expect(peeps[0]).toBe(k('PEEP_TRIAL_START'));
    expect(peeps.at(-1)).toBe(k('PEEP_TRIAL_END'));
    for (let i = 1; i < peeps.length; i++) expect((peeps[i - 1] ?? 0) - (peeps[i] ?? 0)).toBe(k('PEEP_TRIAL_STEP'));
    for (const s of table) {
      expect(s.crs ?? 0).toBeGreaterThan(15);
      expect(s.pplat ?? 0).toBeGreaterThan(s.peep ?? 0);
      expect(s.dp ?? 0).toBeGreaterThan(3);
      expect(Number.isFinite(s.power ?? NaN)).toBe(true);
      expect(Number.isFinite(s.plEI ?? NaN)).toBe(true); // balloon on → Pplat − Pes at the hold
    }
    const crs = table.map((s) => s.crs ?? 0);
    const best = r.values?.bestPeep ?? -1;
    expect(best).toBe(peeps[crs.indexOf(Math.max(...crs))]);
    expect(best).toBeGreaterThanOrEqual(8);
    expect(best).toBeLessThanOrEqual(18);
    // Both ends are worse than the best: overdistension at 20, derecruitment at 4.
    expect(crs[0] ?? 0).toBeLessThan(Math.max(...crs) * 0.95);
    expect(crs.at(-1) ?? 0).toBeLessThan(Math.max(...crs) * 0.95);
    expect(res.settingsLog.at(-1)?.settings.peep).toBe(12);
  });

  it('extrapulmonary preset (Vt 500): PEEP 20 clearly overdistends, best PEEP 8–16', () => {
    const res = run('ards-extrapulmonary', 'peep-trial', { recruitable: true, peep: 12, at: 20, duration: 260, settings: { vt: 500 } });
    const r = result(res, 'peep-trial');
    const crs = (r.table ?? []).map((s) => s.crs ?? 0);
    expect(r.values?.bestPeep ?? -1).toBeGreaterThanOrEqual(8);
    expect(r.values?.bestPeep ?? -1).toBeLessThanOrEqual(16);
    expect(crs[0] ?? 0).toBeLessThan(Math.max(...crs) * 0.92);
  });

  it('a high-Ppeak alarm at the top steps does not stall the trial: those steps are recorded as invalid and the trial goes on', () => {
    // Alarm limit 36: at PEEP 20 and 18 every breath is alarm-cycled, so no inspiratory hold can be taken.
    const res = run('ards-pulmonary', 'peep-trial', { recruitable: true, peep: 10, at: 20, duration: 300, settings: { alarms: { ...defaultSettings().alarms, highPpeak: 36 } } });
    const r = result(res, 'peep-trial');
    const table = r.table ?? [];
    expect(table.length).toBe(9);
    expect(Number.isNaN(table[0]?.pplat ?? 0)).toBe(true);
    expect(table.filter((s) => Number.isFinite(s.crs ?? NaN)).length).toBeGreaterThanOrEqual(5);
    expect(Number.isFinite(r.values?.bestPeep ?? NaN)).toBe(true);
    expect(res.settingsLog.at(-1)?.settings.peep).toBe(10);
    expect(r.tEnd - r.tStart).toBeLessThan(260);
  });

  it('non-recruiter (consolidated): best compliance at a low PEEP, no PL,ei without the balloon', () => {
    const res = run('ards-pulmonary', 'peep-trial', { recruitable: true, peep: 10, at: 20, duration: 260 });
    const r = result(res, 'peep-trial');
    expect(r.values?.bestPeep ?? 99).toBeLessThanOrEqual(10);
    expect(Number.isNaN(r.table?.[0]?.plEI ?? 0)).toBe(true);
  });
});
