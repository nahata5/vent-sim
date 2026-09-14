# VentSim — SIMV, PRVC and APRV, scenario authoring, help overlay (design)

Date 2026-09-14. Owner-approved in chat (design presented and accepted as written). Extends the main spec
`2026-09-10-vent-sim-design.md`; §1 of that spec listed SIMV and PRVC as "designed for in the interfaces
but not built" and did not mention APRV. This document adds all three, a scenario-authoring path that
goes through the reader's own LLM, persisted custom scenarios, and a help overlay.

Build order (each piece ends green, committed, deployed, with a PROGRESS entry):

1. **M10 — Authoring + help**: scenario schema validator, authoring prompt, worked example, "My scenarios"
   store and picker group, help dialog.
2. **M11 — SIMV** (with the shared `breath` event that M12 and M13 also use).
3. **M12 — PRVC**.
4. **M13 — APRV**.
5. Docs refresh: MODEL.md sections + constants table, VALIDATION.md new-mode detector table (report only),
   README, HANDOFF, DECISIONS D-022…D-025, snapshot regeneration.

Owner decisions (2026-09-14): SIMV supports VC and PC base breaths; APRV is Phigh/Plow/Thigh/Tlow with an
optional flow-terminated Tlow (TCAV) and no PS at Phigh; the detector gets mode-aware guards and its
new-mode scores are reported without gating; pasted scenarios persist in a "My scenarios" list.

---

## 1. Shared mechanism: the `breath` event

Mixed-breath modes break the current assumption that one settings record describes every breath. The
ventilator therefore emits, at every inspiration start (inside `startInsp`, after `makePlan`):

```ts
{ type: 'breath'; t: number; kind: 'vc' | 'pc' | 'ps' | 'aprv'; mandatory: boolean; pTarget: number }
```

- `kind` is the breath plan actually delivered (`vc` = flow-controlled, `pc` = pressure-controlled time-cycled
  including PRVC breaths, `ps` = flow-cycled spontaneous, `aprv` = a Phigh phase).
- `pTarget` is the absolute inspiratory pressure target for pressure-targeted breaths (PEEP + ΔP; PRVC's
  current regulated ΔP; Phigh for APRV); for `vc` it is `NaN`.
- Existing modes emit it too (VC-AC → `vc`, PC-AC → `pc`, PSV → `ps`, CPAP → `ps` with `pTarget = PEEP`),
  so one code path serves all modes.

Consumers:
- **Truth labeler** (`src/sim/truth/labeler.ts`): `LabelContext` gains `breathKind` and keeps `pTarget`;
  `ctxFromLogs` takes the latest `breath` event at or before `t` and overrides `mode`-derived defaults.
  The flow-starvation rule tests `breathKind === 'vc'` instead of `mode === 'VC-AC'`; the overshoot rule
  tests `breathKind !== 'vc'`.
- **Detector** (`src/detector/features.ts`, `detector.ts`): `DeviceContext` gains `breathKind`; the
  per-breath context reads the same event. The detector reads only ventilator events and settings, so the
  "never read truth" rule (goal prompt principle 2) holds; `readChannels` is unchanged.
- **Exports**: the event is in the events log like any other.

The `VentEvent` union in `src/sim/types.ts` grows by this member. Existing tests that count events by type
are unaffected (they filter by type).

---

## 2. SIMV (M11)

### 2.1 Settings

`Mode` gains nothing new (`'SIMV'` exists). `VentSettings` gains:

| Key | Type | Default | Range | Meaning |
|---|---|---|---|---|
| `simvBase` | `'VC' \| 'PC'` | `'VC'` | — | Mandatory breath type. VC uses `vt`, `peakFlow`/`ti` (`vcTiming`), `flowPattern`, `pause`; PC uses `pinsp`, `ti`, `riseTime`. |
| `simvWindow` | number (fraction of the period) | `SIMV_SYNC_WINDOW` = 0.25 | 0.05–1 | Synchronization window at the end of each SIMV period. Advanced setting. |

`rr` is the mandatory rate. Spontaneous breaths use `ps`, `ets`, `tiMax`, `riseTime` (a `ps` of 0 gives
CPAP-style spontaneous breaths). Apnea backup is not used in SIMV (mandatory breaths guarantee a minimum
rate).

### 2.2 Behaviour (`Ventilator`)

- Period `T = 60 / rr`, measured from the last **mandatory** breath start (`tLastMandatory`). The clock resets on
  every mandatory breath (PB-840 style; the achieved mandatory rate can therefore run slightly above the set
  rate when the patient triggers inside the window — recorded as a modelling assumption, D-022).
- In `controlExp`: let `elapsed = t − tLastMandatory`.
  - `elapsed ≥ T` → mandatory breath, cause `time`.
  - patient trigger and `elapsed ≥ T·(1 − simvWindow)` → mandatory breath, cause `patient`, `mandatory: true`.
  - patient trigger earlier in the period → spontaneous PS breath (`kind 'ps'`, `mandatory: false`), the
    existing PSV plan (flow-cycled, Ti max, pressure safety).
- `makePlan(settings, backup, kind)` takes the breath kind; the mandatory plan is the existing VC or PC plan
  chosen by `simvBase`; the spontaneous plan is the existing PSV plan.
- Expiratory hold and occlusions: taken at the moment a mandatory time trigger would fire (as in AC), so
  the hold blocks the mandatory breath, not a PS breath.
- Alarms unchanged. `isAC` becomes "has a mandatory rate" (VC-AC, PC-AC, SIMV, PRVC) for the time-due logic;
  the spontaneous-mode checks (`isSpontMode`) stay PSV/CPAP.

### 2.3 UI

- `SettingsPanel`: mode select lists SIMV; a `simvBase` select (`simv-base-select`); fields shown by
  base (`vt`, `rr`, `peakFlow`, `pause`, or `pinsp`, `ti`), plus `ps`, `ets`, `tiMax`, `riseTime`; `simvWindow`
  in the advanced group.
- `MonitorPanel`: tiles `mon-RRmand` and `mon-RRspont` (mandatory and spontaneous breaths per minute
  from the last 60 s of `breath` events) shown in SIMV only.
- Explain cards: no new card; the existing cards' "causes" lists gain SIMV bullets where relevant
  (ineffective effort: "SIMV with a low mandatory rate and low PS"; double trigger: "SIMV mandatory breath
  landing on a spontaneous breath"; flow starvation: "mandatory VC breaths in SIMV with a high drive").

### 2.4 Scenarios (category `mode`, order 400–402)

| id | Patient / settings | What emerges | targetPatterns | fix | criteria |
|---|---|---|---|---|---|
| `simv-low-support` | COPD, drive rate 18, Pmax 5, SIMV-VC rr 8, Vt 450, PS 5, PEEP 0 | high work on spontaneous breaths, ineffective efforts from PEEPi | `high-effort`, `ineffective-effort` | PS 14, PEEP 5, trigger 1.5 | minFraction 0.2, aiAfter 10 |
| `simv-mixed-breaths` | ARDS pulmonary, drive rate 24, Pmax 14, SIMV-VC rr 12, Vt 360, peak flow 40, PS 12 | flow starvation on mandatory breaths only; PS breaths comfortable | `flow-starvation` | peak flow 75 (or `simvBase` PC, Pinsp 14) | minFraction 0.3 (of mandatory breaths), aiAfter 10 |
| `simv-stacking` | normal mechanics, drive rate 26, Ti 0.9, SIMV-PC rr 14, Pinsp 12, PS 8, window 0.25 | mandatory breath lands on the tail of a PS breath: stacking, double trigger, short Te | `double-trigger` | mode PSV, PS 10 | minFraction 0.15, aiAfter 10 |

Emergence tests run each scenario headless (`scenarioSchedule` with and without fix) exactly as the
existing `emergence-first.test.ts` does; `minFraction` for `simv-mixed-breaths` is measured over
mandatory breaths only (the test filters on the `breath` event).

---

## 3. PRVC (M12)

### 3.1 Settings

`'PRVC'` exists in `Mode`. Uses `vt` (target), `rr`, `ti`, `riseTime`, `alarms.highPpeak`. New:

| Key | Default | Range | Meaning |
|---|---|---|---|
| `prvcMinDp` | `PRVC_MIN_DP` = 5 cmH2O | 0–15 | Floor of the regulated ΔP above PEEP. Advanced. |

### 3.2 Constants (`constants.ts`, all tagged; sources Brief 1 §2.5 "vendor-specific, uncertain" = `M`)

| Name | Value | Note |
|---|---|---|
| `PRVC_STEP_MAX` | 3 cmH2O/breath | Brief 1 §2.5 |
| `PRVC_PMAX_MARGIN` | 5 cmH2O below `alarms.highPpeak` | Brief 1 §2.5 |
| `PRVC_MIN_DP` | 5 cmH2O above PEEP | vendor floor, `M` |
| `PRVC_TEST_PAUSE` | 0.3 s | test-breath pause for the compliance estimate, `M` |
| `PRVC_GAIN` | 1.0 | fraction of the computed correction applied per breath, `M` |
| `LABEL_SUPPORT_WITHDRAWAL_MARGIN` | 1 cmH2O | ΔP within this of the floor counts as "at the floor" |

### 3.3 Behaviour

- First breath after entering PRVC (or after a `vt` change): a VC test breath (square flow, `vcTiming` from
  the settings' Ti, pause `PRVC_TEST_PAUSE`). `C_est = Vti_meas / (Pplat_meas − PEEP)` from the pause;
  initial `ΔP = clamp(Vt / C_est, prvcMinDp, highPpeak − PRVC_PMAX_MARGIN − PEEP)`.
- Every following breath is a PC plan (`kind 'pc'`) with `pTarget = PEEP + ΔP`. At each breath start:
  `C_eff = Vti_meas(prev) / ΔP(prev)`, `ΔP_next = ΔP + clamp(PRVC_GAIN · (Vt − Vti_meas(prev)) / C_eff, ±PRVC_STEP_MAX)`,
  then clamped to `[prvcMinDp, highPpeak − PRVC_PMAX_MARGIN − PEEP]`. Vti is the ventilator's own measured
  inspired volume (leak therefore fools it, as at the bedside).
- Alarm `prvc-limit` ("volume not achieved"): ΔP at the ceiling and `Vti_meas < 0.9·Vt` for two consecutive
  breaths; clears when either condition ends. Added to `AlarmId` and the alarm bar; not a `SEVERE_ALARM`.
- Patient-triggered breaths use the same plan (PRVC is an AC mode). Apnea backup not used.
- `Ventilator.prvcDp` getter for the status (`SessionStatus.prvcDp`), so the monitor can show it.

### 3.4 Truth pattern `support-withdrawal`

New `PatternId`. Rule (labeler, per breath): `breathKind === 'pc'` in mode PRVC, `ΔP ≤ prvcMinDp +
LABEL_SUPPORT_WITHDRAWAL_MARGIN` (from the `breath` event's `pTarget − PEEP`), and `pmusPeak ≥ PMUS_HIGH`.
Not in `AI_EVENT_PATTERNS`. Explain card (new): definition, mechanism (the regulator sees the effort's
volume as excess and removes pressure; drive rises further; Brief 1 §2.5), signature (Pinsp stepping down
breath by breath while flow demand and the Pes swing grow), causes, fixes (fixed-pressure PC or PSV,
raise the target Vt if ΔP allows, treat the drive), pitfalls (the "low ΔP" reassurance is false when the
patient is doing the work). Detector counterpart (report only): PRVC breath with `pTarget − PEEP` within
the margin of the floor and an inspiratory Paw sag against target ≥ `DET_OVERSHOOT`-style threshold is
reported as `support-withdrawal` with evidence; not gated.

### 3.5 UI

`SettingsPanel`: mode PRVC shows `vt`, `rr`, `ti`, `riseTime`, `prvcMinDp` (advanced), and the high-pressure
alarm with a note "PRVC ceiling = limit − 5". `MonitorPanel` tile `mon-Pinsp` ("PRVC ΔP") in PRVC.

### 3.6 Scenarios (order 410–412)

| id | Patient / settings | What emerges | targetPatterns | fix | criteria |
|---|---|---|---|---|---|
| `prvc-pressure-withdrawal` | ARDS pulmonary, balloon on, drive rate 24 Pmax 14 rising (gas loop, warp 10) , PRVC Vt 360 rr 20 Ti 0.9 | ΔP walks down to the floor, effort and ΔPL,dyn rise, pendelluft | `support-withdrawal`, `high-effort`, `pendelluft` | mode PC-AC, Pinsp 14, Ti 0.9 | minFraction 0.3, aiAfter 10, quizExtras `dPes ≤ 10` |
| `prvc-volume-not-achieved` | COPD passive, bronchospasm injector at 30 s, PRVC Vt 500 rr 14 Ti 1.0, highPpeak 30 | ΔP climbs to the ceiling, Vt falls short, `prvc-limit` alarm | `high-resistance` | remove bronchospasm, Ti 1.3 | minFraction 0.5, aiAfter 10 |
| `prvc-double-trigger` | ARDS, drive rate 22 Ti 1.3, PRVC Vt 380 Ti 0.7 | double trigger; the stacked breath's volume over target makes the regulator cut ΔP | `double-trigger` | Ti 1.1 | minFraction 0.2, aiAfter 10 |

---

## 4. APRV (M13)

### 4.1 Settings

`Mode` gains `'APRV'`. New settings (absolute pressures, cmH2O):

| Key | Default | Range | Meaning |
|---|---|---|---|
| `phigh` | 28 | 5–45 | pressure of the high phase |
| `plow` | 0 | 0–20 | pressure of the release phase |
| `thigh` | 4.5 s | 0.5–15 | duration of the high phase |
| `tlow` | 0.5 s | 0.2–3 | duration of the release (fixed mode) or its cap (flow mode) |
| `tlowMode` | `'fixed'` | `'fixed' \| 'pefr'` | release termination rule |
| `tlowPefr` | `APRV_TLOW_PEFR_DEFAULT` = 0.75 | 0.25–0.9 | flow mode: end the release when expiratory flow has decayed to this fraction of its peak |

`peep` is not used in APRV (the alarm bar's low-PEEP check uses `plow`; `LabelContext.peep = plow`).
Constants: `APRV_TLOW_PEFR_DEFAULT` 0.75 (Habashi 2005, Crit Care Med 33:S228, TCAV: 75 % of PEFR; `L`),
`APRV_TLOW_MIN` 0.2 s (`M`), `APRV_PHIGH_DEFAULT` 28, `APRV_THIGH_DEFAULT` 4.5 (`M`, typical adult ranges in
Habashi 2005), `LABEL_RELEASE_COLLISION` 0.1 s (a release starting ≥ 100 ms before neural offset, mirroring
`LABEL_EARLY_CYCLING`).

### 4.2 Behaviour

- Phases map onto the existing FSM: the high phase is `insp` with plan `kind 'aprv'`, `ti = thigh`,
  `pTarget = phigh`, time-cycled; the release is `exp` with the servo target `plow`. The next high phase is a
  `time` trigger at the end of the release. No patient synchronization of either transition (TCAV; D-024).
- **Bidirectional servo at Phigh**: `actuate` in `insp` for an `aprv` plan calls `servoTo(phigh, rsrcExp,
  −Infinity, qMax)` — the exhalation valve is active, so a patient inspiratory effort draws flow from the
  source and an expiratory effort pushes flow out through the valve at Phigh. This is the only change to
  `actuate`.
- **Release termination**: `controlInsp` cycles at `thigh` (cause `time`). In `controlExp` for APRV:
  fixed mode → time trigger at `tlow`; `pefr` mode → track the measured peak expiratory flow since the
  release began, and trigger when `t − tRelease ≥ APRV_TLOW_MIN` and `|flow| ≤ tlowPefr · |PEFR|`, or at
  `tlow` as the cap. The achieved Tlow and the end-release flow as a fraction of PEFR are ventilator
  status (`SessionStatus.aprv = { tlowUsed, pefrFraction }`) for the monitor tiles.
- Patient triggering: `patientTrigger` is never consulted in APRV. Spontaneous efforts at either level
  produce flow without any event. `refractory`, `apneaTime` and backup are unused.
- Holds, occlusions, R/I, PEEP trial, stress index: disabled in APRV (`requestHold`, `requestOcclusion`,
  `requestPeepManeuver` return without effect; UI buttons disabled with a tooltip "not available in APRV").
- Breath records: one per Phigh + release (start = Phigh start, `tInspEnd` = release start, `tEnd` = next
  Phigh start). `vtiTrue`/`vteTrue` accumulate as today (inspired volume during the high phase includes
  spontaneous breaths at Phigh; documented in MODEL.md and LIMITATIONS).

### 4.3 Truth labeler in APRV

- `ineffective-effort`, `delayed-trigger`, `auto-trigger`, `double-trigger`, `reverse-trigger`,
  `premature-cycling`, `delayed-cycling`, `flow-starvation`: skipped when `breathKind === 'aprv'` (there are
  no patient triggers and no flow cycling). Each neural effort inside a Phigh or release is an expected
  unsupported breath.
- New `PatternId` `release-collision`: a breath whose release begins at least `LABEL_RELEASE_COLLISION`
  before the offset of an active inspiratory effort (`neural.tOnset < tRelease < neural.tOnset + neural.ti −
  LABEL_RELEASE_COLLISION`). Counted in `AI_EVENT_PATTERNS` (it is an asynchronous event in APRV; the AI
  denominator counts release cycles). Explain card (new): definition, mechanism (no synchronization in
  TCAV; the patient inhales into a falling pressure), signature (Paw drops while the Pes/Pmus swing is still
  rising; a spike of inspiratory flow through the release), fixes (lengthen Thigh so fewer releases fall on
  efforts, shorten Tlow, lighten the drive, or a mode with synchronization), pitfalls.
- `auto-peep`: unchanged rule against `plow` — it fires on nearly every APRV breath. Kept because it is
  true; the auto-PEEP card gains an APRV note ("in APRV the trapped end-release pressure *is* the PEEP; the
  75 % rule sets it deliberately"). Not an AI event, so the quiz's AI criterion is unaffected.
- `tidal-recruitment`, `overdistension`, `pendelluft`, `high-effort`, `low-effort`: unchanged (they are
  the point of two APRV scenarios).

### 4.4 Detector in APRV

`detect()` skips the trigger-based and cycle-based rules for `aprv` breaths (same list as §4.3) and
reports `release-collision` as a signal-only rule: a release (`cycle` event) during which measured Paw
falls while inspiratory flow is still rising or positive for ≥ `DET_RELEASE_COLLISION_FLOW` (report only,
constant `M`). Leak, secretions, water, resistance, compliance and auto-PEEP rules run as today. Scores on
an APRV grid are reported in VALIDATION.md; no gating test.

### 4.5 Quiz in APRV

`gradeFix` reads Pplat from the breath's plateau (none in APRV — no hold) and ΔP: for `aprv` breaths the
quiz uses `phigh` as the plateau and `phigh − plow` as ΔP (from the settings at fix time; the check labels
say "Phigh" and "Phigh − Plow"). Vt per kg is the release Vte. AI as in §4.3.

### 4.6 UI

`SettingsPanel` APRV group: `phigh`, `plow`, `thigh`, `tlow`, `tlowMode` select (`aprv-tlow-mode`),
`tlowPefr`. `MonitorPanel` tiles in APRV: `mon-Tlow` (achieved Tlow), `mon-PEFR` (end-release flow as a
percentage of PEFR), `mon-VtRel` (release Vte). The waveform screen's phase shading treats the high phase
as inspiration (already the case for `insp`).

### 4.7 Scenarios (order 420–422)

| id | Patient / settings | What emerges | targetPatterns | fix | criteria |
|---|---|---|---|---|---|
| `aprv-tlow-too-long` | ARDS pulmonary, `recoil: 'recruitable'`, shunt 0.3, passive drive (rate 10 Pmax 3), APRV Phigh 28 Plow 0 Thigh 4.5 Tlow 1.2 fixed | derecruitment every release: tidal recruitment, open fraction falls, schematic SpO2 drops | `tidal-recruitment`, `auto-peep` | `tlowMode 'pefr'`, `tlow` 1.0 (cap) | minFraction 0.5 (tidal-recruitment), aiAfter 10, extra: `recruited` after ≥ before |
| `aprv-release-collision` | ARDS, drive rate 20 Ti 1.0 Pmax 8, cvRate 0.05, APRV Thigh 4.0 Tlow 0.5 pefr | releases land on efforts | `release-collision` | Thigh 6.0, Tlow cap 0.6 | minFraction 0.15, aiAfter 10 |
| `aprv-high-effort` | ARDS, balloon on, drive rate 24 Pmax 16, APRV Phigh 30 Thigh 5 pefr | high effort at Phigh, high ΔPL,dyn, pendelluft | `high-effort`, `pendelluft` | drive Pmax 8 (sedation), rate 16 | minFraction 0.3, aiAfter 10, quizExtras `dPL ≤ 15`, `dPes ≤ 10` |

`ScenarioCriteria.extra` gains `{ metric: 'recruitedGain'; min: number }` (recruited volume after the fix
minus before, L) for the first scenario; the emergence test reads `recruitedVolume()` truth.

---

## 5. Scenario authoring (M10)

### 5.1 Validator — `src/edu/scenario-schema.ts`

`validateScenario(raw: unknown): { def: ScenarioDef | null; errors: string[]; warnings: string[] }`:

- required: `id` (slug `^[a-z0-9][a-z0-9-]{1,63}$`), `title`, `phenotype` ∈ `PHENOTYPE_IDS`, `settings.mode`
  ∈ `IMPLEMENTED_MODES` (extended to all seven).
- enumerations: `category` ∈ `preset|dyssynchrony|injector|capstone|mode`; injector keys ∈ `INJECTOR_KINDS`;
  `targetPatterns` ⊆ `PATTERN_IDS`; `quizExtras[].metric` ∈ `QUIZ_EXTRA_METRICS`; `criteria.extra[].metric`
  ∈ the known list; `mechanics.recoil` `'recruitable'` or `{kind:'recruitable', …}`.
- ranges: every numeric setting against the bounds `clampSettings` uses (exposed as a `SETTING_BOUNDS`
  table so the UI, the clamp and the validator share one source); drive `rate` 4–60, `ti` 0.3–3, `pmax`
  0–40; `seed` number or string; `fix.at` ≥ 0; `criteria.minFraction` 0–1, `aiAfter` 0–100.
- unknown top-level or settings keys → warnings (not errors), listed by name.
- defaults: `order` 999, `summary` '', `drive` null, `seed` 1, `objectives` [], `targetPatterns` [],
  `category` `'dyssynchrony'`. A custom scenario keeps the category it declares; the picker groups every
  custom scenario under "My scenarios" regardless of category.
- `parseScenarioJson` in `InstructorPanel` becomes a thin wrapper (JSON.parse → validateScenario).

### 5.2 Authoring prompt — `src/edu/authoring.ts`

`AUTHORING_PROMPT: string` built at module load from the enumerations and `SETTING_BOUNDS` (so it cannot
drift), and `EXAMPLE_SCENARIO: ScenarioDef` (validated by a test). The prompt:

1. Role and task: "You are helping a clinician write a VentSim teaching scenario. Interview them, then
   output one JSON object and nothing else."
2. Interview checklist (ask, one at a time, only what is missing): the patient (phenotype and any mechanics
   tweaks), drive (passive or rate/Ti/Pmax/variability), the mode and settings, what should go wrong (which
   patterns, from the list), what the learner should notice and do, the fix as concrete settings/injector
   changes, success criteria, one or two objectives, optional quiz extras.
3. Format section: every field with type, unit, range, allowed values, and the merge/default rules
   (settings merge over mode defaults; alarms merge; `recoil`; `at` on injectors; `fix.injectors: null`).
4. The worked example (verbatim JSON) with a two-line explanation.
5. Output rules: JSON only, no comments, ids as slugs, cmH2O/mL/L/min/s units, do not invent fields.

`EXAMPLE_SCENARIO`: `example-obesity-pc-short-ti` — an obese post-operative patient on PC-AC with Ti 0.6 s
against a neural Ti of 1.2 s: double triggering, with stacked volumes; fix Ti 1.1 s; objectives, criteria,
one quiz extra. Not in the shipped library.

`docs/SCENARIO_AUTHORING.md` is generated from the same module by `scripts/authoring-doc.ts` (tracked;
run like `scripts/model-constants.ts`, the constants-table generator), so the document and the in-app prompt match.

### 5.3 Custom store — `src/edu/custom-scenarios.ts`

`CustomScenarioStore` (localStorage `ventsim.custom.v1`, same guarded storage helper as `progress.ts`):
`all()`, `get(id)`, `save(def)` (overwrites by id; an id that collides with a shipped scenario is rejected
with an error naming it), `remove(id)`, `exportJson(id)`. The controller resolves ids through
`scenarioById` first and the store second; `SCENARIOS` stays the shipped list. `ScenarioPicker` gets a
`custom` prop and renders the group "My scenarios" last; masked mode numbers them after the shipped
cases. Quiz links (`#<id>?quiz=`) and progress keys work unchanged because they are id-based.

### 5.4 Instructor panel

Editor block gains: buttons `author-copy-prompt` (copies `AUTHORING_PROMPT`; falls back to selecting a
read-only textarea when the clipboard API is unavailable), `author-load-example`, `author-validate`
(shows the error/warning list `author-errors`), `author-save` (validate → store → picker refresh → load),
and the existing "load into session" behaviour. A "My scenarios" list `custom-list` with load, export
and delete per row.

---

## 6. Help overlay (M10)

`src/ui/HelpDialog.tsx`: a native `<dialog>` (`help-dialog`), opened by a header button `help-open` ("?",
`aria-label="How to use VentSim"`) and automatically once (`ventsim.help.seen.v1`, guarded storage).
Close button `help-close`, Escape, and backdrop click. Sections (static text, no truth data, so it stays
available in the locked quiz view and on phones):

1. What VentSim is (two sentences; physics-generated waveforms; bedside view vs truth).
2. Screen tour: waveforms and badges, loops, monitor tiles, alarm bar, truth and balloon toggles, drawer
   tabs (Scenario, Explain, Quiz, Export), Instructor panel, phone tab bar.
3. Workflow: pick a scenario → watch 30 s → holds and occlusions → open Explain on a badge → Quiz
   (identify → fix → debrief) → Export.
4. Modes primer: one line each for VC-AC, PC-AC, PSV, CPAP, SIMV, PRVC, APRV and where their pitfalls live.
   Until M11–M13 land, the SIMV, PRVC and APRV lines carry the qualifier "(not in this version yet)".
5. Author your own: Instructor panel → copy the authoring prompt → paste into your LLM → paste the JSON
   back → validate → save.
6. Links: README, MODEL.md, VALIDATION page, and the disclaimer.

Focus is trapped inside the dialog while open (native `showModal`); the axe test covers it.

---

## 7. Cross-cutting

- `IMPLEMENTED_MODES` = all seven. `Mode` type adds `'APRV'`.
- `docs/DECISIONS.md`: D-022 SIMV (window at the end of the period, clock reset on mandatory breath),
  D-023 PRVC (test breath, step, ceiling, floor, `prvc-limit`, `support-withdrawal`), D-024 APRV (no
  synchronization, bidirectional servo, breath = Phigh + release, labeler skips, auto-PEEP kept,
  `release-collision`, maneuvers disabled, quiz ΔP/Pplat substitutes), D-025 authoring path, custom store,
  help overlay.
- `docs/MODEL.md`: §5c SIMV, §5d PRVC, §5e APRV; constants table regenerated.
- `docs/VALIDATION.md`: new table "Detector in SIMV, PRVC, APRV (reported, not gated)" from a new
  `scripts/validation-snapshot.ts` section; `src/validation/snapshot.json` regenerated (34 scenarios).
- `docs/LIMITATIONS.md`: vendor-specific SIMV/PRVC/APRV behaviours, no APRV synchronization, no PS in APRV,
  detector not validated in the new modes.
- README: modes list, scenario count, authoring section, help button.
- Tests (written first): `tests/physics/simv.test.ts`, `prvc.test.ts`, `aprv.test.ts`;
  `tests/unit/labeler.test.ts` additions (skips in APRV, `release-collision`, `support-withdrawal`);
  `tests/unit/{scenario-schema,authoring,custom-scenarios}.test.ts`; `tests/unit/scenarios.test.ts` (all
  34 validate; example validates); `tests/physics/emergence-modes.test.ts` (nine scenarios, before/after
  fix); `tests/e2e/modes.spec.ts` (mode select, SIMV base select, APRV tiles), `tests/e2e/help.spec.ts`,
  `tests/e2e/authoring.spec.ts` (load example → validate → save → appears in picker → reload persists).
  `a11y.spec.ts` opens the help dialog.
- Held-out detector grid: untouched; `tests/detector` held-out suite must report identical numbers.

## 8. Out of scope

PS on APRV spontaneous breaths; APRV synchronization windows; PRVC inside SIMV; volume-guarantee PSV
(VS); NAVA/PAV; detector gating targets for the new modes; server-side sharing of custom scenarios.
