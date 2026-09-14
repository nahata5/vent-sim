/**
 * Scenario authoring through the reader's own LLM (Spec 2026-09-14 §5.2). The prompt is generated from the
 * same enumerations and bounds the validator uses, so it cannot drift from what the app accepts; the
 * worked example is validated by a test and is not in the shipped library.
 */
import { PHENOTYPE_IDS, PRESETS } from '../sim/patient/presets';
import { IMPLEMENTED_MODES } from '../sim/types';
import { INJECTOR_KINDS, defaultInjectorParams } from '../sim/injectors';
import { PATTERN_IDS } from '../sim/truth/labeler';
import { SETTING_BOUNDS, defaultSettings, type NumericSettingKey } from '../sim/vent/settings';
import { QUIZ_EXTRA_METRICS } from './quiz';
import { CRITERIA_EXTRA_METRICS, DRIVE_BOUNDS, SCENARIO_TOP_KEYS } from './scenario-schema';
import { SCENARIO_CATEGORIES, type ScenarioDef } from './scenarios';

export const EXAMPLE_SCENARIO: ScenarioDef = {
  id: 'example-obesity-pc-short-ti',
  order: 999,
  category: 'dyssynchrony',
  title: 'Example: obese patient on PC-AC with a short Ti',
  summary: 'An obese post-operative patient with a strong drive is on PC-AC with Ti 0.6 s. The neural inspiration lasts twice as long, so the effort continues after cycle-off and re-triggers a second breath: double triggering with stacked volumes.',
  phenotype: 'obesity',
  drive: { rate: 20, ti: 1.2, pmax: 10, cvRate: 0.08, cvTi: 0.08, cvPmax: 0.1 },
  balloon: { enabled: true },
  settings: { mode: 'PC-AC', peep: 8, pinsp: 12, ti: 0.6, rr: 14, riseTime: 0.1, flowTrigger: 2 },
  seed: 7,
  objectives: [
    'Recognize double triggering: two machine breaths inside one effort, with the second starting from an incomplete exhalation.',
    'Fix by matching the set Ti to the neural Ti; confirm the stacking stops without raising the driving pressure.',
  ],
  targetPatterns: ['double-trigger'],
  fix: { at: 60, note: 'Ti 1.1 s: the breath now spans the effort.', settings: { ti: 1.1 } },
  criteria: { minFraction: 0.2, aiAfter: 10 },
  quizExtras: [{ metric: 'plEE', min: 0, label: 'End-expiratory PL ≥ 0 (obesity)' }],
};

const MODE_NOTES: Record<string, string> = {
  'VC-AC': 'volume control, assist-control: vt, rr, peakFlow or ti (vcTiming), flowPattern, pause',
  'PC-AC': 'pressure control, assist-control: pinsp (above PEEP), ti, rr, riseTime',
  PSV: 'pressure support: ps (above PEEP), ets (cycle-off fraction), tiMax, riseTime',
  CPAP: 'CPAP: peep only (ps 0)',
  SIMV: 'SIMV: simvBase "VC" or "PC" for the mandatory breaths (their VC/PC settings and rr) plus ps/ets for spontaneous breaths',
  PRVC: 'pressure-regulated volume control: vt (target), rr, ti, riseTime; the pressure adapts breath by breath',
  APRV: 'airway pressure release: phigh, plow, thigh, tlow, tlowMode "fixed" or "pefr", tlowPefr',
};

const quote = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join(', ');

function settingsLines(): string {
  const d = defaultSettings();
  return (Object.keys(SETTING_BOUNDS) as NumericSettingKey[])
    .map((key) => `  ${key}: ${SETTING_BOUNDS[key].min}–${SETTING_BOUNDS[key].max} ${SETTING_BOUNDS[key].unit} (default ${d[key]})`)
    .join('\n');
}

function injectorLines(): string {
  return INJECTOR_KINDS.map((k) => `  "${k}": defaults ${JSON.stringify(defaultInjectorParams(k))}`).join('\n');
}

function phenotypeLines(): string {
  return PHENOTYPE_IDS.map((p) => `  "${p}": ${PRESETS[p].label}`).join('\n');
}

export const AUTHORING_PROMPT = `You are helping a clinician write a teaching scenario for VentSim, a browser ventilator simulator in which
patient–ventilator dyssynchrony emerges from a physiologic model. Your job: interview the author about the case they
want, then output ONE JSON object in the format below and nothing else (no comments, no prose, no code fence).

INTERVIEW FIRST. Ask one question at a time and only for what is still missing:
1. The patient: which phenotype (list below), and any mechanics tweak (e.g. stiffer chest wall).
2. The respiratory drive: passive (null) or active — neural rate, neural Ti, Pmax (effort strength), variability.
3. The ventilator mode and settings that create the problem.
4. What should go wrong: which patterns from the list should appear, and roughly how often.
5. What the learner should notice on the waveforms and what they should do.
6. The fix, as concrete setting/drive/injector changes applied at a given simulated second.
7. Success criteria: the minimum fraction of breaths (or efforts) carrying each target pattern before the fix, and the asynchrony-index limit (%) after it (10 is the usual "severe" threshold).
8. One or two learning objectives; optional quiz extras (truth-metric checks the fix must satisfy).
Summarize the case back in two sentences, get a yes, then output the JSON.

FORMAT (top-level keys, all others are ignored): ${quote(SCENARIO_TOP_KEYS)}
  id: slug, 2–64 lowercase letters/digits/dashes, must be unique
  title: short string; summary: one paragraph shown to the learner
  category: one of ${quote(SCENARIO_CATEGORIES)} (default "dyssynchrony"); order: number for sorting (default 999)
  phenotype (required): one of
${phenotypeLines()}
  mechanics (optional): numeric overrides of the phenotype (el, ecw, rInsp, rExp, rCentral, frc, pplOffset, pbw, …), and
    recoil: "recruitable" for a recruitable-population lung (ARDS PEEP-response teaching) or { "kind": "recruitable", …overrides }
  drive (required; null = passive patient): { rate, ti, pmax, cvRate, cvTi, cvPmax, entrainment }
${Object.entries(DRIVE_BOUNDS).map(([k, b]) => `    ${k}: ${b.min}–${b.max} ${b.unit}`).join('\n')}
    entrainment: null or { "ratio": 1|2|3, "delay": s, "jitter": s } (reverse triggering in deep sedation)
  balloon (optional): { "enabled": true } to turn on the esophageal balloon (Pes, transpulmonary pressure)
  gas (optional): CO2 → drive loop, e.g. { "warp": 10, "gainPmax": 0.06, "vco2": 200 }; omit for a fixed drive
  shunt (optional): base venous admixture 0–1 for the schematic SpO2 (default ≈ 0.05)
  injectors (optional): object keyed by injector kind; each value is a parameter object, optionally with "at": seconds of onset
${injectorLines()}
  settings (required): { "mode": one of ${quote(IMPLEMENTED_MODES)}, …numbers }. Unspecified settings take the mode defaults. Alarms merge into defaults.
${IMPLEMENTED_MODES.map((m) => `    "${m}": ${MODE_NOTES[m] ?? ''}`).join('\n')}
    numeric settings and bounds:
${settingsLines()}
    other: triggerType "flow"|"pressure", vcTiming "peakFlow"|"ti", flowPattern "square"|"ramp", leakCompensation true|false,
      alarms { highPpeak, lowVte, highVe, lowVe, highRR, lowPeep, highLeak, highPeepi }
  seed: integer or string (reproducible variability)
  objectives: array of strings
  targetPatterns: array of pattern ids the learner must find, from
    ${quote(PATTERN_IDS)}
  fix: { "at": seconds, "note": string, "settings": {…partial settings}, "drive": {…partial drive}, "injectors": { "<kind>": {…} or null to remove } }
  criteria: { "minFraction": 0–1, "aiAfter": 0–100, "extra": [ { "metric": ${quote(CRITERIA_EXTRA_METRICS)}, "max": number } ], "over": "all" | "mandatory" (which breaths the fractions count; "mandatory" for lessons about SIMV's mandatory breaths) }
  quizExtras: array of { "metric": one of ${quote(QUIZ_EXTRA_METRICS)}, "min"?: number, "max"?: number, "label"?: string }

UNITS: pressures cmH2O, volumes mL (settings) or L (mechanics), flows L/min (settings), times s, rates /min.

EXAMPLE (a complete, valid scenario):
${JSON.stringify(EXAMPLE_SCENARIO, null, 2)}

RULES: output only one JSON object; do not invent keys; keep every number inside its bounds; make the problem emerge
from the physiology and settings (do not describe waveforms in the JSON); the fix must be something a learner can do at
the bedside in this simulator.`;

/** docs/SCENARIO_AUTHORING.md, generated by scripts/authoring-doc.ts. */
export function authoringDocument(): string {
  return [
    '# Writing your own VentSim scenario',
    '',
    'Generated from `src/edu/authoring.ts` by `npm run docs:authoring`; do not edit by hand.',
    '',
    'VentSim scenarios are JSON. You do not have to write the JSON yourself: copy the prompt below into your own LLM',
    '(the **Copy authoring prompt** button in the Instructor panel does the same), answer its questions about the case',
    'you want, paste the JSON it returns into the Instructor panel\'s scenario editor, press **Validate**, then **Save**.',
    'Saved scenarios live in your browser under "My scenarios" in the scenario picker and work with quiz links.',
    '',
    '## The prompt',
    '',
    '```text',
    AUTHORING_PROMPT,
    '```',
    '',
    '## Validation',
    '',
    'The editor checks ids, enumerations (phenotype, mode, injector kinds, pattern ids, quiz metrics) and every numeric',
    'bound listed in the prompt, and reports each problem by field name. Unknown keys are ignored with a warning.',
    '',
  ].join('\n');
}
