/**
 * Quiz debrief (design 2026-09-11 §5, D-019): the confirmed-change log, the recommended-fix marks and the
 * templated four-section debrief. Pure functions; the controller feeds them.
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@sim/vent/settings';
import { CARDS } from '@/edu/cards';
import { gradeFix } from '@/edu/quiz';
import { applyDriveSnapshot, buildDebrief, driveChangesFrom, driveSnapshot, fixMark, formatChange, injectorChange, settingChangesFrom, type DebriefInput, type DriveSnapshot } from '@/edu/debrief';

const psv = () => ({ ...defaultSettings('PSV'), ps: 16, ets: 0.1, peep: 0, flowTrigger: 3 });

describe('setting change log', () => {
  it('records only the keys whose value changed, with from and to', () => {
    const cur = psv();
    const changes = settingChangesFrom(84, cur, { ps: 6, ets: 0.1, peep: 5 });
    expect(changes).toEqual([
      { t: 84, key: 'ps', from: 16, to: 6 },
      { t: 84, key: 'peep', from: 0, to: 5 },
    ]);
  });

  it('records alarm limits per key and an injector toggle as on/off', () => {
    const cur = psv();
    const changes = settingChangesFrom(10, cur, { alarms: { ...cur.alarms, highPpeak: cur.alarms.highPpeak + 5 } });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.key).toBe('alarms.highPpeak');
    expect(injectorChange(12, 'leak', false)).toEqual({ t: 12, key: 'injector:leak', from: 'on', to: 'off' });
  });

  it('formats a change with the bedside label, display units and the time', () => {
    expect(formatChange({ t: 84.4, key: 'ps', from: 16, to: 6 })).toBe('PS 16 → 6 cmH2O at 84 s');
    expect(formatChange({ t: 90, key: 'ets', from: 0.1, to: 0.7 })).toBe('ETS 10 → 70 % at 90 s');
    expect(formatChange({ t: 91, key: 'injector:leak', from: 'on', to: 'off' })).toBe('Leak injector on → off at 91 s');
  });
});

describe('drive change log (D-019 follow-up)', () => {
  const start: DriveSnapshot = { rate: 12, ti: 0.9, pmax: 4, entrainment: 2 };
  it('records only the drive keys that changed, entrainment as off / 1:n', () => {
    const ch = driveChangesFrom(70, start, { rate: 16, pmax: 8, entrainment: null, ti: 0.9 });
    expect(ch).toEqual([
      { t: 70, key: 'drive.rate', from: 12, to: 16 },
      { t: 70, key: 'drive.pmax', from: 4, to: 8 },
      { t: 70, key: 'drive.entrainment', from: '1:2', to: 'off' },
    ]);
    expect(ch.map(formatChange)).toEqual(['Drive rate 12 → 16 /min at 70 s', 'Pmax 4 → 8 cmH2O at 70 s', 'Entrainment 1:2 → off at 70 s']);
  });
  it('applies a partial to the snapshot and builds one from a scenario drive with defaults', () => {
    expect(applyDriveSnapshot(start, { entrainment: { ratio: 3, delay: 0.4, jitter: 0.03 }, pmax: 6 })).toEqual({ rate: 12, ti: 0.9, pmax: 6, entrainment: 3 });
    const s = driveSnapshot({ rate: 20, entrainment: { ratio: 1, delay: 0.4, jitter: 0.03 } });
    expect(s.rate).toBe(20);
    expect(s.entrainment).toBe(1);
    expect(s.ti).toBeGreaterThan(0);
    expect(s.pmax).toBeGreaterThan(0);
  });
});

describe('recommended-fix marks', () => {
  it('matched, partial, not done and opposite for a numeric key', () => {
    expect(fixMark(16, 6, 6)).toBe('matched');
    expect(fixMark(16, 6, 4)).toBe('matched'); // within 25 % of the 10-step band
    expect(fixMark(16, 6, 12)).toBe('partial');
    expect(fixMark(16, 6, 16)).toBe('not-done');
    expect(fixMark(16, 6, 20)).toBe('opposite');
    expect(fixMark(0.1, 0.7, 0.7)).toBe('matched');
  });

  it('non-numeric keys: exact match, unchanged or changed elsewhere', () => {
    expect(fixMark('flow', 'pressure', 'pressure')).toBe('matched');
    expect(fixMark('flow', 'pressure', 'flow')).toBe('not-done');
    expect(fixMark('on', 'off', 'on')).toBe('not-done');
    expect(fixMark('on', 'off', 'off')).toBe('matched');
  });

  it('a recommended value equal to the start counts as matched only when left alone', () => {
    expect(fixMark(5, 5, 5)).toBe('matched');
    expect(fixMark(5, 5, 8)).toBe('opposite');
  });
});

describe('buildDebrief', () => {
  const start = psv();
  const final = { ...start, ps: 6, ets: 0.7, peep: 5 };
  const base = (): DebriefInput => ({
    changes: [
      { t: 90, key: 'ets', from: 0.1, to: 0.7 },
      { t: 84, key: 'ps', from: 16, to: 6 },
      { t: 92, key: 'peep', from: 0, to: 5 },
    ],
    truthPatterns: ['ineffective-effort', 'delayed-cycling'],
    picks: ['ineffective-effort', 'double-trigger'],
    fixGrade: gradeFix({ ai: 4, breaths: [{ dp: 10, pplat: 20, vtPerKg: 6 }], newSevereAlarms: [], extras: [] }),
    aiBefore: 45,
    fix: { at: 60, note: 'Tassaux-style: ETS 70 %, PS 6, PEEP 5, trigger 1.5 L/min.', settings: { ps: 6, ets: 0.7, peep: 5, flowTrigger: 1.5 } },
    settingsAtFixStart: start,
    finalSettings: final,
    injectorsAtFixStart: [],
    finalInjectors: [],
    evidence: { 'ineffective-effort': ['The effort at 70.2 s did not trigger a breath.'] },
  });

  it('lists the changes in time order with the bedside wording', () => {
    const d = buildDebrief(base());
    expect(d.changes).toEqual(['PS 16 → 6 cmH2O at 84 s', 'ETS 10 → 70 % at 90 s', 'PEEP 0 → 5 cmH2O at 92 s']);
    expect(buildDebrief({ ...base(), changes: [] }).changes).toEqual(['No setting changes.']);
  });

  it('names each truth pattern by its card title, carries the evidence and marks found / missed / extra', () => {
    const d = buildDebrief(base());
    expect(d.happening.map((h) => [h.id, h.mark])).toEqual([
      ['ineffective-effort', 'found'],
      ['delayed-cycling', 'missed'],
      ['double-trigger', 'extra'],
    ]);
    expect(d.happening[0]?.title).toBe(CARDS['ineffective-effort'].title);
    expect(d.happening[0]?.evidence).toEqual(['The effort at 70.2 s did not trigger a breath.']);
    expect(d.happening[1]?.evidence).toEqual([]); // missing evidence tolerated
  });

  it('marks the recommended fix key by key and reports the outcome', () => {
    const d = buildDebrief(base());
    expect(d.fix.note).toContain('Tassaux');
    expect(d.fix.keys.map((x) => [x.key, x.mark])).toEqual([
      ['ps', 'matched'],
      ['ets', 'matched'],
      ['peep', 'matched'],
      ['flowTrigger', 'not-done'],
    ]);
    expect(d.fix.keys[0]).toMatchObject({ label: 'PS', recommended: '6 cmH2O', learner: '6 cmH2O' });
    expect(d.fix.aiBefore).toBe(45);
    expect(d.fix.aiAfter).toBe(4);
    expect(d.fix.pass).toBe(true);
    expect(d.fix.failed).toEqual([]);
  });

  it('includes injector recommendations and a failing outcome', () => {
    const inp = base();
    inp.fix = { at: 60, note: 'Re-inflate the cuff.', injectors: { leak: null } };
    inp.injectorsAtFixStart = ['leak'];
    inp.finalInjectors = ['leak'];
    inp.fixGrade = gradeFix({ ai: 30, breaths: [{ dp: 10, pplat: 20, vtPerKg: 6 }], newSevereAlarms: [], extras: [] });
    const d = buildDebrief(inp);
    expect(d.fix.keys).toEqual([{ key: 'injector:leak', label: 'Leak injector', recommended: 'off', learner: 'on', mark: 'not-done' }]);
    expect(d.fix.pass).toBe(false);
    expect(d.fix.failed[0]).toMatch(/Asynchrony index/);
  });

  it('marks fix.drive recommendations (entrainment, rate, Pmax) against the drive at fix start', () => {
    const inp = base();
    inp.fix = { at: 60, note: 'Lighten sedation.', drive: { entrainment: null, rate: 16, pmax: 8 } };
    inp.driveAtFixStart = { rate: 12, ti: 0.9, pmax: 4, entrainment: 2 };
    inp.finalDrive = { rate: 16, ti: 0.9, pmax: 6, entrainment: 2 };
    const d = buildDebrief(inp);
    expect(d.fix.keys).toEqual([
      { key: 'drive.entrainment', label: 'Entrainment', recommended: 'off', learner: '1:2', mark: 'not-done' },
      { key: 'drive.rate', label: 'Drive rate', recommended: '16 /min', learner: '16 /min', mark: 'matched' },
      { key: 'drive.pmax', label: 'Pmax', recommended: '8 cmH2O', learner: '6 cmH2O', mark: 'partial' },
    ]);
    // Without drive snapshots (passive scenario) the drive recommendation is skipped, not thrown.
    expect(buildDebrief({ ...inp, driveAtFixStart: null, finalDrive: null }).fix.keys).toEqual([]);
  });

  it('physiology section carries the card text for the truth patterns only, and the summary is compact', () => {
    const d = buildDebrief(base());
    expect(d.physiology.map((c) => c.id)).toEqual(['ineffective-effort', 'delayed-cycling']);
    expect(d.physiology[0]?.mechanism).toBe(CARDS['ineffective-effort'].mechanism);
    expect(d.physiology[0]?.fixes).toEqual(CARDS['ineffective-effort'].fixes);
    expect(d.summary).toEqual({ changes: d.changes, patterns: ['ineffective-effort', 'delayed-cycling'], pass: true });
  });

  it('tolerates a scenario without a fix and no settings snapshots', () => {
    const d = buildDebrief({ ...base(), fix: null, settingsAtFixStart: null, finalSettings: null });
    expect(d.fix.note).toBeNull();
    expect(d.fix.keys).toEqual([]);
  });
});
