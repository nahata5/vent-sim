/**
 * Ground-truth labeler (Spec §7 truth rules): labels from neural timing vs ventilator timing plus true
 * physiology. Checked on the scenario library and on injector runs, never on the detector.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessResult } from '@sim/headless';
import { defaultSettings } from '@sim/vent/settings';
import { presetPatient, recruitableRecoil } from '@sim/patient/presets';
import { defaultDriveParams } from '@sim/patient/neural-drive';
import { resolveScenario, scenarioById } from '@/edu/scenarios';
import { asynchronyIndex, labelRun, PATTERN_IDS, type PatternId } from '@sim/truth/labeler';
import type { SimEngine } from '@sim/engine';

function run(id: string, duration: number): HeadlessResult {
  return runHeadless({ ...resolveScenario(scenarioById(id)), duration });
}

function fraction(res: HeadlessResult, pattern: PatternId, from = 10): number {
  const labels = labelRun(res).breaths.filter((b) => b.tStart > from);
  return labels.filter((b) => b.patterns.includes(pattern)).length / Math.max(1, labels.length);
}

describe('truth labeler', () => {
  it('passive baseline: no pattern on any breath and AI = 0', () => {
    const res = run('normal-passive', 60);
    const out = labelRun(res);
    expect(out.breaths.length).toBeGreaterThan(10);
    expect(out.breaths.every((b) => b.patterns.length === 0)).toBe(true);
    expect(out.efforts.length).toBe(0);
    expect(asynchronyIndex(out, 0, 60).ai).toBe(0);
  });

  it('double-trigger scenario: two cycles inside one effort, stacked volume evidence, flow starvation, AI > 10%', () => {
    const res = run('double-trigger', 90);
    const out = labelRun(res);
    expect(fraction(res, 'double-trigger')).toBeGreaterThan(0.2);
    const dt = out.breaths.find((b) => b.patterns.includes('double-trigger'));
    expect(dt?.evidence.stackedVt ?? 0).toBeGreaterThan(0.4); // L, more than one set Vt
    expect(fraction(res, 'flow-starvation')).toBeGreaterThan(0.2);
    expect(asynchronyIndex(out, 10, 90).ai).toBeGreaterThan(10);
  });

  it('ineffective-effort scenario: missed efforts, delayed cycling, auto-PEEP, low effort, cluster flag', () => {
    const res = run('ineffective-effort', 120);
    const out = labelRun(res);
    const efforts = out.efforts.filter((e) => e.tOnset > 10 && e.tOnset < 110);
    expect(efforts.filter((e) => e.ineffective).length / efforts.length).toBeGreaterThan(0.2);
    expect(fraction(res, 'delayed-cycling')).toBeGreaterThan(0.5);
    expect(fraction(res, 'auto-peep')).toBeGreaterThan(0.5);
    expect(fraction(res, 'low-effort')).toBeGreaterThan(0.5);
    const ai = asynchronyIndex(out, 10, 110);
    expect(ai.ai).toBeGreaterThan(10);
    expect(ai.ie).toBeGreaterThan(5);
  });

  it('reverse-trigger scenario: entrained efforts after machine breaths carry a stable delay', () => {
    const res = run('reverse-trigger', 60);
    const out = labelRun(res);
    const machine = out.breaths.filter((b) => b.tStart > 5 && b.triggerCause === 'time');
    const rt = machine.filter((b) => b.patterns.includes('reverse-trigger'));
    expect(rt.length / machine.length).toBeGreaterThan(0.5);
    const delays = rt.map((b) => b.evidence.reverseDelay ?? NaN);
    const mean = delays.reduce((s, x) => s + x, 0) / delays.length;
    expect(Math.abs(mean - 0.4)).toBeLessThan(0.1);
  });

  it('flow starvation needs an effort still rising after the insufflation starts (D-012)', () => {
    // Entrainment delay 0.5 s against a 0.5 s VC breath: each stacked breath entrains a new effort that
    // triggers late, so the breath begins while Pmus is already relaxing. That is a delayed trigger, not
    // flow starvation (the demand peaked before any gas was delivered).
    const spec = resolveScenario(scenarioById('reverse-trigger'));
    const patient = { ...spec.patient, drive: { ...(spec.patient.drive ?? defaultDriveParams()), entrainment: { ratio: 1 as const, delay: 0.5, jitter: 0.03 } } };
    const res = runHeadless({ patient, settings: { ...spec.settings, peakFlow: 50 }, seed: 101, duration: 60 });
    const out = labelRun(res);
    const late = out.breaths.filter((b) => b.tStart > 10 && b.triggerCause === 'patient' && (b.triggerDelay ?? 0) > 0.6 && !b.patterns.includes('double-trigger'));
    expect(late.length).toBeGreaterThan(3);
    expect(late.every((b) => b.patterns.includes('delayed-trigger'))).toBe(true);
    expect(late.some((b) => b.patterns.includes('flow-starvation'))).toBe(false);
    // The scenario's own stacked breaths (effort still rising) keep the label.
    expect(fraction(run('flow-starvation', 40), 'flow-starvation')).toBeGreaterThan(0.8);
  });

  it('auto-trigger: cardiac oscillation with a 1 L/min flow trigger and no neural drive', () => {
    const patient = presetPatient('normal');
    const res = runHeadless({
      patient,
      settings: { ...defaultSettings('CPAP'), peep: 5, flowTrigger: 1, apneaTime: 60 },
      seed: 2,
      duration: 30,
      schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('cardiac', { amp: 0.6 }) }],
    });
    const out = labelRun(res);
    const triggered = out.breaths.filter((b) => b.triggerCause === 'patient');
    expect(triggered.length).toBeGreaterThan(5);
    expect(triggered.every((b) => b.patterns.includes('auto-trigger'))).toBe(true);
  });

  it('premature cycling: fibrosis on PSV with high ETS cycles before the neural offset', () => {
    const patient = presetPatient('fibrosis');
    patient.drive = { ...defaultDriveParams(), rate: 20, ti: 1.1, pmax: 8 };
    const res = runHeadless({ patient, settings: { ...defaultSettings('PSV'), peep: 8, ps: 8, ets: 0.6 }, seed: 3, duration: 60 });
    expect(fraction(res, 'premature-cycling')).toBeGreaterThan(0.5);
    const b = labelRun(res).breaths.find((x) => x.patterns.includes('premature-cycling'));
    expect(b?.cycleDelay ?? 0).toBeLessThan(-0.1);
  });

  it('delayed trigger: weak COPD efforts against intrinsic PEEP take > 250 ms to trigger', () => {
    const patient = presetPatient('copd');
    patient.drive = { ...defaultDriveParams(), rate: 20, ti: 0.9, pmax: 6, cvPmax: 0.05 };
    const res = runHeadless({ patient, settings: { ...defaultSettings('PSV'), peep: 0, ps: 12, ets: 0.25, flowTrigger: 3 }, seed: 4, duration: 60 });
    const out = labelRun(res);
    const triggered = out.breaths.filter((b) => b.tStart > 10 && b.triggerCause === 'patient' && b.triggerDelay !== null);
    expect(triggered.length).toBeGreaterThan(5);
    expect(triggered.filter((b) => b.patterns.includes('delayed-trigger')).length / triggered.length).toBeGreaterThan(0.3);
  });

  it('an effort met by a coincident time-triggered breath is assisted, not ineffective (D-012)', () => {
    const res = run('fibrosis', 60);
    const out = labelRun(res);
    const trig = res.events.filter((e) => e.type === 'trigger');
    let coincident = 0;
    for (const e of out.efforts) {
      if (e.tOnset < 5) continue;
      const met = trig.some((t) => t.t >= e.tOnset - 0.05 && t.t <= e.tOnset + e.ti);
      if (met) {
        coincident += 1;
        expect(e.ineffective).toBe(false);
        expect(e.breathIndex).not.toBeNull();
      }
    }
    expect(coincident).toBeGreaterThan(0);
    expect(out.efforts.some((e) => e.assistedByMachine)).toBe(true);
  });

  it('injector findings: leak, cough, high resistance and low compliance are labeled from the truth', () => {
    const base = { patient: presetPatient('normal'), settings: { ...defaultSettings('VC-AC'), peep: 5, vt: 450, rr: 15, peakFlow: 50 }, seed: 5, duration: 30 };
    const leak = runHeadless({ ...base, schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('leak', { k: 0.03 }) }] });
    expect(fraction(leak, 'leak')).toBeGreaterThan(0.8);
    const cough = runHeadless({ ...base, schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('cough', { interval: 5 }) }] });
    expect(labelRun(cough).breaths.some((b) => b.patterns.includes('cough'))).toBe(true);
    const spasm = runHeadless({ ...base, schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('bronchospasm', { rScale: 2.5, rampSeconds: 0 }) }] });
    expect(fraction(spasm, 'high-resistance')).toBeGreaterThan(0.8);
    const ptx = runHeadless({ ...base, schedule: [{ t: 0, action: (e: SimEngine) => e.injectors.set('pneumothorax', {}) }] });
    expect(fraction(ptx, 'low-compliance')).toBeGreaterThan(0.8);
  });

  it('truth-only finding: tidal recruitment when units open and close within a breath (recruitable lung)', () => {
    // Consolidated ARDS driven to a plateau ≈ 50 (the stress-index test setting): units cycle every breath.
    const patient = presetPatient('ards-pulmonary', { recoil: recruitableRecoil('ards-pulmonary') });
    const res = runHeadless({ patient, settings: { ...defaultSettings('VC-AC'), peep: 16, vt: 840, rr: 12, peakFlow: 40, alarms: { ...defaultSettings().alarms, highPpeak: 70 } }, seed: 1, duration: 30 });
    const labels = labelRun(res).breaths.filter((b) => b.tStart > 10);
    const hits = labels.filter((b) => b.patterns.includes('tidal-recruitment'));
    expect(hits.length / Math.max(1, labels.length)).toBeGreaterThan(0.5);
    expect(hits[0]?.evidence.tidalRecruitUnits ?? 0).toBeGreaterThanOrEqual(2);
    // The same lung at PEEP 16 with 6 mL/kg keeps its units where they are: no finding.
    const quiet = runHeadless({ patient, settings: { ...defaultSettings('VC-AC'), peep: 16, vt: 420, rr: 15, peakFlow: 40 }, seed: 1, duration: 30 });
    expect(labelRun(quiet).breaths.filter((b) => b.tStart > 10).every((b) => !b.patterns.includes('tidal-recruitment'))).toBe(true);
    expect(PATTERN_IDS).toContain('tidal-recruitment');
  });

  it('truth-only findings: overdistension and high effort', () => {
    const over = runHeadless({ patient: presetPatient('ards-pulmonary'), settings: { ...defaultSettings('VC-AC'), peep: 16, vt: 700, rr: 20, peakFlow: 60, alarms: { ...defaultSettings().alarms, highPpeak: 60 } }, seed: 6, duration: 30 });
    expect(fraction(over, 'overdistension')).toBeGreaterThan(0.8);
    const patient = presetPatient('ards-pulmonary');
    patient.drive = { ...defaultDriveParams(), rate: 24, ti: 1.0, pmax: 18 };
    const strong = runHeadless({ patient, settings: { ...defaultSettings('PSV'), peep: 10, ps: 6 }, seed: 7, duration: 40 });
    expect(fraction(strong, 'high-effort')).toBeGreaterThan(0.5);
  });
});
