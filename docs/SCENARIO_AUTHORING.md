# Writing your own VentSim scenario

Generated from `src/edu/authoring.ts` by `npm run docs:authoring`; do not edit by hand.

VentSim scenarios are JSON. You do not have to write the JSON yourself: copy the prompt below into your own LLM
(the **Copy authoring prompt** button in the Instructor panel does the same), answer its questions about the case
you want, paste the JSON it returns into the Instructor panel's scenario editor, press **Validate**, then **Save**.
Saved scenarios live in your browser under "My scenarios" in the scenario picker and work with quiz links.

## The prompt

```text
You are helping a clinician write a teaching scenario for VentSim, a browser ventilator simulator in which
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

FORMAT (top-level keys, all others are ignored): "id", "order", "category", "title", "summary", "phenotype", "mechanics", "drive", "balloon", "gas", "injectors", "settings", "seed", "objectives", "targetPatterns", "fix", "criteria", "quizExtras", "shunt"
  id: slug, 2–64 lowercase letters/digits/dashes, must be unique
  title: short string; summary: one paragraph shown to the learner
  category: one of "preset", "dyssynchrony", "injector", "capstone", "mode" (default "dyssynchrony"); order: number for sorting (default 999)
  phenotype (required): one of
  "normal": Normal (anesthetized)
  "ards-pulmonary": ARDS, pulmonary (consolidated)
  "ards-extrapulmonary": ARDS, extrapulmonary (recruitable)
  "obesity": Morbid obesity
  "abdominal-hypertension": Intra-abdominal hypertension
  "copd": COPD
  "asthma": Status asthmaticus
  "fibrosis": Pulmonary fibrosis
  mechanics (optional): numeric overrides of the phenotype (el, ecw, rInsp, rExp, rCentral, frc, pplOffset, pbw, …), and
    recoil: "recruitable" for a recruitable-population lung (ARDS PEEP-response teaching) or { "kind": "recruitable", …overrides }
  drive (required; null = passive patient): { rate, ti, pmax, cvRate, cvTi, cvPmax, entrainment }
    rate: 4–60 /min
    ti: 0.3–3 s
    pmax: 0–40 cmH2O
    cvRate: 0–0.5 fraction
    cvTi: 0–0.5 fraction
    cvPmax: 0–0.5 fraction
    entrainment: null or { "ratio": 1|2|3, "delay": s, "jitter": s } (reverse triggering in deep sedation)
  balloon (optional): { "enabled": true } to turn on the esophageal balloon (Pes, transpulmonary pressure)
  gas (optional): CO2 → drive loop, e.g. { "warp": 10, "gainPmax": 0.06, "vco2": 200 }; omit for a fixed drive
  shunt (optional): base venous admixture 0–1 for the schematic SpO2 (default ≈ 0.05)
  injectors (optional): object keyed by injector kind; each value is a parameter object, optionally with "at": seconds of onset
  "leak": defaults {"k":0.03}
  "cardiac": defaults {"amp":0.6}
  "secretions": defaults {"amp":0.6}
  "water": defaults {"amp":0.4,"freq":4}
  "cough": defaults {"interval":8,"amp":40,"duration":0.4}
  "pneumothorax": defaults {"eScale":1.8,"ppl":6}
  "mainstem": defaults {"eScale":2,"rScale":1.5}
  "bronchospasm": defaults {"rScale":3,"rampSeconds":20}
  settings (required): { "mode": one of "VC-AC", "PC-AC", "PSV", "CPAP", "SIMV", "PRVC", …numbers }. Unspecified settings take the mode defaults. Alarms merge into defaults.
    "VC-AC": volume control, assist-control: vt, rr, peakFlow or ti (vcTiming), flowPattern, pause
    "PC-AC": pressure control, assist-control: pinsp (above PEEP), ti, rr, riseTime
    "PSV": pressure support: ps (above PEEP), ets (cycle-off fraction), tiMax, riseTime
    "CPAP": CPAP: peep only (ps 0)
    "SIMV": SIMV: simvBase "VC" or "PC" for the mandatory breaths (their VC/PC settings and rr) plus ps/ets for spontaneous breaths
    "PRVC": pressure-regulated volume control: vt (target), rr, ti, riseTime; the pressure adapts breath by breath
    numeric settings and bounds:
  peep: 0–25 cmH2O (default 5)
  fio2: 0.21–1 fraction (default 0.4)
  flowTrigger: 0.5–10 L/min (default 2)
  pressureTrigger: 0.5–5 cmH2O (default 1)
  biasFlow: 2–10 L/min (default 3)
  vt: 100–1200 mL (default 450)
  rr: 4–60 /min (default 16)
  peakFlow: 10–120 L/min (default 50)
  rampEndFraction: 0–0.9 fraction of peak (default 0)
  pause: 0–2 s (default 0)
  pinsp: 0–40 cmH2O above PEEP (default 15)
  ti: 0.2–3 s (default 1)
  riseTime: 0–0.4 s (default 0.15)
  ps: 0–40 cmH2O above PEEP (default 10)
  ets: 0.05–0.8 fraction of peak flow (default 0.25)
  tiMax: 0.5–4 s (default 2)
  apneaTime: 5–60 s (default 20)
  refractory: 0–0.5 s (default 0.2)
  simvWindow: 0.05–1 fraction of the period (default 0.25)
  prvcMinDp: 0–15 cmH2O above PEEP (default 5)
    other: triggerType "flow"|"pressure", vcTiming "peakFlow"|"ti", flowPattern "square"|"ramp", leakCompensation true|false,
      alarms { highPpeak, lowVte, highVe, lowVe, highRR, lowPeep, highLeak, highPeepi }
  seed: integer or string (reproducible variability)
  objectives: array of strings
  targetPatterns: array of pattern ids the learner must find, from
    "ineffective-effort", "auto-trigger", "delayed-trigger", "double-trigger", "reverse-trigger", "premature-cycling", "delayed-cycling", "flow-starvation", "overshoot", "auto-peep", "leak", "secretions", "water", "high-resistance", "low-compliance", "cough", "pendelluft", "overdistension", "tidal-recruitment", "high-effort", "low-effort"
  fix: { "at": seconds, "note": string, "settings": {…partial settings}, "drive": {…partial drive}, "injectors": { "<kind>": {…} or null to remove } }
  criteria: { "minFraction": 0–1, "aiAfter": 0–100, "extra": [ { "metric": "peepiTrue", "max": number } ], "over": "all" | "mandatory" (which breaths the fractions count; "mandatory" for lessons about SIMV's mandatory breaths) }
  quizExtras: array of { "metric": one of "plEE", "plEI", "dPL", "dPes", "pmusPeak", "min"?: number, "max"?: number, "label"?: string }

UNITS: pressures cmH2O, volumes mL (settings) or L (mechanics), flows L/min (settings), times s, rates /min.

EXAMPLE (a complete, valid scenario):
{
  "id": "example-obesity-pc-short-ti",
  "order": 999,
  "category": "dyssynchrony",
  "title": "Example: obese patient on PC-AC with a short Ti",
  "summary": "An obese post-operative patient with a strong drive is on PC-AC with Ti 0.6 s. The neural inspiration lasts twice as long, so the effort continues after cycle-off and re-triggers a second breath: double triggering with stacked volumes.",
  "phenotype": "obesity",
  "drive": {
    "rate": 20,
    "ti": 1.2,
    "pmax": 10,
    "cvRate": 0.08,
    "cvTi": 0.08,
    "cvPmax": 0.1
  },
  "balloon": {
    "enabled": true
  },
  "settings": {
    "mode": "PC-AC",
    "peep": 8,
    "pinsp": 12,
    "ti": 0.6,
    "rr": 14,
    "riseTime": 0.1,
    "flowTrigger": 2
  },
  "seed": 7,
  "objectives": [
    "Recognize double triggering: two machine breaths inside one effort, with the second starting from an incomplete exhalation.",
    "Fix by matching the set Ti to the neural Ti; confirm the stacking stops without raising the driving pressure."
  ],
  "targetPatterns": [
    "double-trigger"
  ],
  "fix": {
    "at": 60,
    "note": "Ti 1.1 s: the breath now spans the effort.",
    "settings": {
      "ti": 1.1
    }
  },
  "criteria": {
    "minFraction": 0.2,
    "aiAfter": 10
  },
  "quizExtras": [
    {
      "metric": "plEE",
      "min": 0,
      "label": "End-expiratory PL ≥ 0 (obesity)"
    }
  ]
}

RULES: output only one JSON object; do not invent keys; keep every number inside its bounds; make the problem emerge
from the physiology and settings (do not describe waveforms in the JSON); the fix must be something a learner can do at
the bedside in this simulator.
```

## Validation

The editor checks ids, enumerations (phenotype, mode, injector kinds, pattern ids, quiz metrics) and every numeric
bound listed in the prompt, and reports each problem by field name. Unknown keys are ignored with a warning.
