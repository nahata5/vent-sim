# Decisions

Deviations from the design spec and choices the spec leaves open, with reasoning. Newest last.

## D-001 · UI framework: Preact with TSX (2026-09-10)

The spec allows "vanilla TS or Preact". The settings panel, monitor, dashboard, cards, quiz and instructor
editor are a lot of stateful DOM. Preact (about 4 kB) keeps that manageable without a heavy framework.
Waveforms and loops stay on custom Canvas2D as required. No JSX plugin is needed: esbuild's automatic JSX
runtime with `jsxImportSource: preact` is configured in `vite.config.ts` and `tsconfig.json`.

## D-002 · Ventilator logic runs at the device rate, physics at 1 kHz (2026-09-10)

Spec §2.2 says the ventilator sees only device-rate measured signals. The controller therefore evaluates
trigger and cycle rules every `1/fs` s (default 100 Hz) on the sensor-chain output and holds its command
between evaluations. The flow source, pressure servo and exhalation valve are continuous physics at 1 kHz.
This reproduces the detection-latency component of trigger delay for free.

## D-003 · Lung recoil anchored to phenotype Ppl0; FRC is a phenotype parameter (2026-09-10)

Spec §4.2 says FRC should be solved at initialization. Brief 2 §3 keeps FRC as a parameter (needed for
strain), and Table 1 gives end-expiratory Pes per phenotype. We keep FRC as the phenotype's relaxation
volume, define compartment volume `V_i` relative to its share of FRC, and anchor the lung recoil so that
`PL_i(0) = −Ppl0_i` (static equilibrium at zero PEEP with no effort). What is solved at initialization is
the static equilibrium at the *set PEEP*, so the change in EELV with PEEP, Ppl at PEEP and PL at PEEP all
emerge from the model. The Venegas curve supplies the nonlinear shape around that anchor.

## D-004 · Normal-preset FRC 1.6 L rather than Table 1's 1.69 L (2026-09-10)

Spec §9.2 requires specific lung elastance (ΔPL/strain, strain = Vt/FRC) of about 13.5 ± 2 across presets
(Chiumello 2008). With Pelosi's EL 9.4 and FRC 1.69 the linear product is 15.9, just outside the band;
1.6 L gives 15.0. The value is tagged [M] in `presets.ts`. ARDS FRCs (0.7 pulmonary, 1.0 extrapulmonary)
are chosen inside Table 1's 0.7–1.3 range for the same reason.

## D-005 · Venegas parameters solved from the phenotype anchor (2026-09-10)

Brief 2 §2.1 gives illustrative Venegas parameters tagged [M] and says to tune b and d so the slope at the
operating point matches Table 1 EL. Rather than hand-tune, each preset fixes the lower asymptote a (L below
FRC) and span b (L) and the code solves d and c so that the elastance at FRC equals EL and the curve
passes through (V = 0, PL0). The Venegas shape then determines how Ers changes with PEEP, which is what
the Gattinoni 1998 direction test checks. The recruitable-population lung (M7) replaces this for
recruitment-specific behaviour.

## D-006 · Ventilator valve limits and cycling details (2026-09-10)

- **Pressure-safety cycling applies to spontaneous pressure-targeted breaths (PSV/CPAP).** Spec §5 lists
  "Paw above target + 3" among the cycle criteria. In PC-AC the breath stays time-cycled and the
  high-pressure alarm is the safety, which matches how active-exhalation-valve ventilators behave.
- **Inspiratory valve cannot take flow back (qMin = 0 during inspiration).** With a pure Thevenin source an
  ideal integral servo would "inhale" against an expiratory push and Paw could never rise above target,
  so pressure cycling could never occur. Real valves close; the pressure BC therefore degenerates to a
  flow source at 0 when the patient pushes.
- **Expiratory source flow capped at the bias flow.** During expiration the inspiratory valve supplies at
  most the bias flow (Brief 1 §2.1). A larger patient demand pulls Paw down, which is the mechanism of
  pressure triggering; without the cap the PEEP servo would supply any demand and the pressure trigger
  would never see a dip.
- **Blower peak flow 3 L/s [M].** Bounds the servo under large leaks and disconnects (`MAX_SERVO_FLOW`).
- **ETS confirmation window 30 ms [M].** The flow-cycle criterion is validated over a few device samples
  so that an abrupt expiratory push can pressure-cycle first (`ETS_CONFIRM_TIME`).
- **Disconnect alarm is not phase-limited.** A disconnected circuit auto-triggers through the leak, so
  expiration can be shorter than the sustain window; Paw < PEEP − 3 for 0.5 s in any phase raises it.
- **Ventilator vti/vte** are integrated from the measured flow at the physics rate by phase (device
  internal rate); the Monitor integrates positive and negative flow over the cycle so the sensor delay
  does not clip the last milliseconds of inspiration.

## D-007 · Effort model and occlusion measurements (2026-09-10)

- **Force–velocity penalty on |Q|.** `Pmus_eff = Pmus_iso·(1 − kFv·sat(|Q|/qRef))` with qRef = 0.15 L/s,
  so any flowing breath is penalized and only a true occlusion (Q = 0) is isometric. A first version
  penalized inspiratory flow only; after flow cycling the effort then became isometric while still near
  its peak and k1 came out at −0.85. A length–tension variant fixed that but made P0.1 depend on how much
  gas was trapped when the valve closed, so it was dropped. Hyperinflation-related weakness is therefore
  not modelled (listed in the limitations).
- **kFv calibrated to the measured ratio.** Spec §4.4 says to calibrate k_fv so simulated ΔPocc gives
  Bertoni's k1. The *measured* ΔPocc slightly under-reads Pmus_iso because Paw is still equilibrating
  toward alveolar pressure after the valve closes (viscoelastic recovery, residual flow), exactly as at the
  bedside, so kFv = 0.30 (spec range 0.25–0.3) gives k1 = −0.74 on the PSV grid (normal, both ARDS
  presets, obesity, Pmax 6–25) and k2 = 0.62–0.64.
- **Calibration grid excludes COPD.** With intrinsic PEEP the post-occlusion Paw rise is long and the
  occlusion catches efforts mid-way; ΔPocc under-reads there, a documented pitfall, so obstructive lungs
  are not used to set kFv.
- **Occlusion references are the pre-effort plateau,** read on a 0.3 s moving average for whole-effort
  maneuvers (ΔPocc, occlusion test) so the cardiac artifact on Pes does not inflate the swing, and on a
  0.1 s average for P0.1 with a 0.5 cmH2O onset threshold above sensor noise, back-extrapolated along the
  slope. Whole-effort occlusions start only once expiratory flow has settled below 0.04 L/s; P0.1 falls
  back to the vendor method (occlude for 100 ms from trigger detection, reads a little low) when an
  effort arrives first.
- **Pes height 0.7 of the vertical lung height** (Brief 2: mid-to-dependent), and the balloon occlusion
  test is validated on the normal preset; in injured lungs with α_D = 1.35 a well-placed balloon reads a
  ratio above 1 by design, which is a teaching point rather than a failure.

## D-008 · Hosting on Netlify instead of GitHub Pages (2026-09-11)

The goal prompt targets GitHub Pages. The account's user site (`nahata5.github.io`) still carries
`tomnahass.com` as its Pages custom domain, so GitHub redirects every project site of the account to that
domain, and the domain's DNS points at Netlify. Rather than touch the personal site's Pages configuration,
VentSim deploys to Netlify from `netlify.toml` (`npm run build`, publish `dist`, Node 22) and the personal
site proxies `/vent-sim/*` to it. GitHub Actions stays as the CI gate (lint, tests, Playwright, build) with
the Pages steps removed. Vite's relative `base: './'` makes both URLs work without a rebuild. The spec's
principle 6 allows Netlify explicitly.

## D-009 · Expiratory hold in a breathing patient reads the pre-effort plateau and releases early (2026-09-11)

Spec §5 describes an expiratory hold of 2–4 s reporting total PEEP. With a spontaneously breathing
patient a fixed 3 s occlusion almost always contains an effort, and a device that reads Paw at the end of
the hold would report the effort's negative deflection as "total PEEP" (the first session test read −0.9
with PEEP 6). Real ventilators track the relaxed plateau and abort the maneuver when the patient pulls.
The ventilator now tracks Paw during the hold on a 0.1 s moving average, reports the running maximum as
total PEEP when an effort drops the smoothed Paw more than `POCC_MIN_DIP` (1 cmH2O) below it, ends the
hold at that moment with `values.interrupted = 1`, and triggers the held breath as patient-triggered. In a
passive patient nothing changes: Paw rises monotonically toward alveolar pressure, so the end-of-hold value
is the plateau. Tested in `tests/unit/ventilator.test.ts` ("expiratory hold in a breathing patient").

## D-010 · Sweep display, ranges and M5 scope choices (2026-09-11)

- **Worker timing.** The worker ticks every 20 ms, advances the engine by wall-clock × speed capped at
  0.25 s per tick (a backgrounded tab does not spiral on wake), and sends one transferable channel-major
  Float32Array per tick. Determinism is a property of `SimSession` (`tests/unit/session.test.ts`): same
  seed and same commands at the same simulated times give byte-identical batches for any chunking.
- **Scroll back = freeze + sweep re-rendered at an earlier cursor time.** The display keeps the sweep
  semantics (cursor overwriting the previous sweep) at any `tView` inside the 120 s ring buffer, so the
  learner sees exactly what the screen showed at that moment; the cursor readout maps the mouse column to
  time through the same function.
- **Auto-ranging per row** expands immediately and shrinks after ~2 s of slack, with a minimum span per
  channel (Paw 20, flow 60 L/min, volume 500 mL) so a flat trace never zooms into sensor noise.
- **Breath badges show trigger · cycle cause** (e.g. `P·flow`, `T·vol`) until the M6 labeler and detector
  replace them with pattern labels.
- **Dashboard rows for PMI, stress index and R/I are present but empty** until M7 supplies the maneuvers.
  Truth-only rows show "truth layer off" when the toggle is off so the bedside ↔ truth distinction stays
  visible in the numbers, not only in the traces.
- **Scenarios are JSON now** (`src/edu/scenarios/*.json`, resolved by `resolveScenario`) so M8's library,
  instructor export and import build on the same shape. The three M5 dyssynchrony scenarios reuse the
  M4 emergence-test parameters and are re-checked as scenarios in `tests/unit/scenarios.test.ts`.
- **Mechanical power surrogate.** VC uses Gattinoni simplified when a plateau exists, Giosa 2019 when it
  does not; PC/PSV use Becher simplified (Brief 2 §3). The truth value ∫Paw·dV and the lung power ∫PL·dV
  are shown next to it when the truth layer is on.

## D-011 · M6 definitions settled between truth and detector (2026-09-11)

- **Ineffective efforts are scored on expiratory efforts.** The §9.5 target follows Chen 2008 and BetterCare,
  whose criteria are for ineffective efforts during expiration (IEE). Efforts that begin inside a machine
  insufflation are still labeled by the truth (`EffortLabel.phase = 'insp'`) and by the detector when a flow
  hump is visible, but they do not enter the confusion matrix (`scorer.ts`, `truthPositives`).
- **High resistance / low compliance are physiologic states, not injector flags.** Truth: total inspiratory
  resistance (preset × injector) ≥ 25 cmH2O/(L/s) (`LABEL_HIGH_R`; asthma and bronchospasm yes, COPD 22 no);
  static Crs < 30 mL/cmH2O (`LABEL_LOW_C`, fibrosis) or lung elastance ≥ 1.3× the scenario baseline
  (`LABEL_E_SCALE`, mainstem/pneumothorax). The detector estimates R from the inspiratory resistive step in VC
  (the whole-breath fit mixes inspiratory and expiratory R) and C from the equation-of-motion fit only in
  controlled modes on breaths without an asynchrony flag (effort corrupts the fit in PSV).
- **Mainstem intubation starts at 20 s** (like the pneumothorax) so both the truth (elastance step) and the
  detector (compliance drop vs its own baseline) see a change; a compliance of 41 mL/cmH2O from t = 0 in a
  normal preset is not "low" by any absolute rule.
- **Auto-PEEP truth uses the relaxed alveolar pressure**, Palv + Pmus_eff at the end of expiration, so a
  continuous effort across stacked breaths does not hide trapped gas or fake a negative reading.
- **Expiratory notches are measured against the extrapolated passive decay** (running-max τe), not against
  the local minimum, so an effort riding on a fast decay (fibrosis) counts for its deflection only and a
  monotonic decay toward zero never counts; a notch must fall back or reverse.
- **Scenario design choices for detectability:** the reverse-trigger scenario uses Pmax 8 (Brief 1 §3.5: Pmax
  3–15 selects the phenotype; 6 gave efforts that no bedside rule can see), the ineffective-effort scenario
  uses rate 22 / Pmax 5 so the Tassaux-style fix (ETS 70%, PS 6, PEEP 5) resolves it within 60 s, and the
  flow-starvation scenario's neural Ti (0.75 s) matches the machine Ti so it isolates flow starvation from
  premature cycling; its fix is pressure support (a higher VC flow shortens Ti below the neural Ti and trades
  starvation for premature cycling, which the emergence test caught).
- **Expiratory holds abort on effort** (D-009) and **the held-out detector suite is gated** by `RUN_HELDOUT=1`
  until §9.5 is met, so CI stays a truthful gate for what is finished.

## D-012 · Detector measurement basis and two truth refinements (2026-09-11)

Every change below was made after tracing the offending breaths with the `scripts/dev` dump tools on the
tuning grid only; the held-out grid was scored, never tuned on.

**Truth refinements (labeler).**

- **An effort met by a coincident time-triggered breath is assisted, not ineffective.** In the fibrosis PC
  scenario every "ineffective" expiratory effort began within 60 ms of a time-triggered breath. The patient
  received gas during the effort, so it is neither wasted nor a reverse trigger (an entrained effort begins
  *after* the machine breath). A time-triggered breath that starts inside `[onset − LABEL_EFFORT_LEAD,
  onset + Ti]` now assists the effort (`EffortLabel.assistedByMachine`), the breath carries `delayed-trigger`
  when it started more than `LABEL_TRIGGER_DELAY` after the onset, and cycling is judged against that
  effort's neural end. Test: "coincident time-triggered breath" in `tests/unit/labeler.test.ts`.
- **Flow starvation needs an effort still rising after the insufflation starts** (`LABEL_FLOW_STARVATION_RISE`
  0.5 cmH2O). With a 0.5 s entrainment delay against a 0.5 s VC breath (held-out reverse-trigger variant),
  each stacked breath entrains a new effort that triggers 0.6–0.8 s late, so the breath starts while Pmus is
  already relaxing. The PTP rule alone called that flow starvation; clinically it is a delayed trigger (the
  demand peaked before any gas was delivered) and, because the breath outlasts the relaxing effort, delayed
  cycling. Test: "still rising after the insufflation starts".

**Scoring domain (scorer, extends D-011).** A breath holding an effort that began inside the insufflation
and no expiratory ineffective effort is unscored for IE (its expiratory continuation is visible to the
detector but the effort is not an IEE). Both members of a truth double-trigger pair are unscored for flow
starvation: the pair is scored as double trigger, and a 0.3–0.4 s VC breath inside a rising effort has no
ramp signature (mid-ramp convexity ≈ 0.2 cmH2O against a threshold of 0.7) without a passive reference
breath, which the double-trigger scenario never provides. Recorded in `docs/LIMITATIONS.md` and
`docs/QUESTIONS.md`.

**Detector measurement basis.**

- **Expiratory notches are deviations from the passive decay on 0.1 s-smoothed flow**, with the prediction
  re-anchored every 0.5 s while no deflection is under way (`DET_NOTCH_ONSET`, `DET_NOTCH_REANCHOR`). A notch
  must fall back (flow more negative again after the crest); a deviation that merely fades is a two-
  compartment decay artifact and one still rising at the breath end is the next breath's trigger. The
  previous local-minimum search stalled on noise and reported 3–7 L/min for 7–13 L/min COPD efforts. The
  reported rise is trough-to-crest, as Chen 2008 measured Fdef.
- **The Paw deflection is not a criterion.** Through an active exhalation valve (R 1.5 cmH2O/(L/s)) a
  7 L/min flow deflection moves Paw ≈ 0.2 cmH2O, and the first 0.15 s after cycle-off carry the Ppeak → PEEP
  transient. Chen's Pdef 0.45 (`DET_IE_PDEF`) stays in the registry as documentation; the flow rule alone
  (Chen: sens 91.5 %, spec 96.2 %) is used, with the threshold raised by 3× the smoothed cardiac amplitude
  when a regular heart-rate oscillation is present (`DET_CARDIAC_NOTCH_FACTOR`), and suppressed under the
  secretion sawtooth. `DET_IE_FDEF_WITH_PDEF`, `DET_IE_PDEF_SMOOTH` and `DET_PREM_NOTCH_PDEF` were removed.
- **Cardiac regularity is the autocorrelation of the pre-trigger flow residual** at a heart-rate lag and at
  twice that lag (`DET_AT_CARDIAC_CORR`), or a train of similar notches at heart-rate spacing in the previous
  expiration; zero-crossing counting failed whenever phase masks broke the window.
- **Leak auto-trigger = leak evident (ΣVte/ΣVti over 8 breaths, every breath counted) and no effort ramp.**
  The net flow never settles at +leak before the trigger: it crosses the trigger threshold during its own
  decay once the lung outflow falls below the leak (traced in `leak-psv`), so the earlier "flow floor > 0"
  rule was physically wrong. The volume sums previously dropped breaths with Vti < 50 mL, i.e. every stacked
  breath, which faked a leak in the premature-cycling scenario.
- **An auto-triggered breath does not stack.** A patient trigger with its own effort ramp
  (`DET_AT_FLOW_RISE`) after an auto-trigger candidate is that effort's breath; the auto-trigger stands and
  the double-trigger label is dropped. Cycling labels are stripped from breaths that remain stacked, as in
  the truth rule.
- **Expiratory τ is fitted on the longest notch-free stretch with flow ≥ 4 L/min** and the reference across
  breaths is the median, not the running maximum (one bad fit no longer distorts every prediction). The
  early-return prediction uses that reference: in the premature-cycling scenario the breath's own fit spanned
  the effort and gave τ 0.08–0.11 s for a 0.4 s lung.
- **Delayed cycling in PSV/PC** is read from the flow-decay knee (local τ over 0.2 s ≥ 1.5× the smallest
  earlier value and ≥ 0.6 s: the effort has relaxed and the ventilator runs on the passive tail;
  `DET_DC_KNEE_*`), the shoulder (`DET_DC_SHOULDER_TAIL` 0.4 → 0.3 s, the truth margin), the inspiratory-tail τ
  instead of the effort-corrupted whole-breath fit, and the end-inspiratory Paw rise on a 0.1 s average
  (`DET_DC_PAW_RISE` 2.0 raw → 1.0 smoothed; passive breaths ≤ 0.5). In VC a patient-triggered breath with a
  concave-down ramp (`DET_DC_VC_CONCAVITY`) outlasted a relaxing effort.
- **Flow starvation in VC** adds the least-squares ramp convexity (`DET_FS_CONVEXITY` 0.7; passive ramps
  −0.2…+0.2, efforts ≥ 0.9) and the end-of-ramp steepening when Pmus relaxes before cycle-off
  (`DET_FS_END_STEEPENING`), both gated to breaths without the secretion sawtooth.
- **High resistance** trusts the resistive step when end-expiratory flow is above −5 L/min
  (`DET_HIGH_R_EEF`); the bronchospasm scenario sits at exactly −3 to −4.

**Held-out result and the one target not met.** On the held-out grid (seeds 101–104, perturbed settings and
drive, never used for tuning): ineffective effort 0.93/0.99, double trigger 0.99/1.00, auto-trigger
0.97/0.99, premature cycling 0.95/0.99, flow starvation 0.91/0.98, reverse trigger 0.85/1.00
(sensitivity/specificity). **Delayed cycling reaches 0.84/0.98 against a 0.85 target.** The residual misses
are late-triggered VC breaths in the reverse-trigger variant with a 0.5 s entrainment delay: each breath
starts 0.6–0.8 s into a 0.9 s effort, so by the truth margin it outlasts the effort, but its ramp shape
depends on where the Pmus peak falls relative to the insufflation (convexity −0.8 to +1.1 across those
breaths) and no signal-only rule separates them from a breath inside a still-rising effort. The held-out
test records 0.80 as the accepted floor for delayed cycling (comment in `tests/detector/heldout.test.ts`)
so CI guards against regression without hiding the gap; the question of whether the trigger delay should
count toward the cycling delay is Q-2 in `docs/QUESTIONS.md`.

## D-013 · Recruitable-population lung parametrization and the stress index (2026-09-11, M7)

- **Opening pressures live on the recoil axis** (pressure above the compartment's FRC anchor, D-003), not on
  the airway or absolute transpulmonary axis. In extrapulmonary ARDS the stiff chest wall keeps the dependent
  transpulmonary pressure below zero even at PEEP 15, so absolute-PL thresholds of 20–25 cmH2O (Pelosi 2001,
  airway pressures in oleic-acid dogs) would never open anything. The recoil-axis pressure equals
  `Paw − Ecw·V` in static conditions, i.e. what a P–V curve at the bedside sweeps.
- **A fraction of the units is recruitable, the rest always open**, and the Table 1 elastance is what the
  always-open fraction f0 measures at zero PEEP: the fully recruited compartment has `E_all = E_comp·f0`, one
  unit's aerated FRC is `FRC_comp/(N·f0)`. Recruiting units therefore lowers elastance and adds aerated volume
  in proportion, which is what makes Gattinoni 1998's extrapulmonary numbers reproducible (Ers 25.9 → 21.4
  with 0.293 L recruited) from one parameter pair (`RECRUIT_EXTRAPULMONARY_FRACTION` 0.25,
  `RECRUIT_EXTRAPULMONARY_TOP` 8): the model gives Ers 25.0 → 23.7 and 0.15–0.2 L at PEEP 14–15.
- **Consolidated units open above ≈ 30 cmH2O** (`RECRUIT_PULMONARY_TOP`), so pulmonary ARDS recruits nothing
  at protective pressures and its Ers rise with PEEP comes from the strain cap of its small baby lung
  (FRC 0.7 L, unit strain 1.3–1.4 at PEEP 15). That baby lung needs its own cap
  (`RECRUIT_PULMONARY_STRAIN_CAP` 1.25 vs 0.85 elsewhere) or Ers doubles instead of rising 25 → 31.
- **Tidal recruitment is emergent but small at protective volumes in the recruiter**: the lung's tidal PL
  swing must exceed the opening–closing hysteresis (`RECRUIT_CLOSE_DELTA` 6), and the chest wall takes most of
  ΔP in extrapulmonary ARDS. The tests demonstrate it at 10 mL/kg / PEEP 2 (recruiter) and at 12 mL/kg /
  PEEP 16 (consolidated units cycling at a plateau ≈ 50), which is also where the measured stress index falls
  below 0.9; the truth count of cycling units is what the explain card should show next to the index.
- **Trajectory rates** `RECRUIT_K_OPEN/CLOSE` 5 /(cmH2O·s): a unit 1 cmH2O above its TOP opens in 0.2 s so
  units passed during a 1 s inflation open within the breath; a unit within 0.2 cmH2O of its TOP still needs
  seconds (slow recruitment during holds). Lower rates (0.4–2) suppressed all tidal recruitment.
- **Stress index eligibility is read from the signals**: machine-triggered breath, cycled by volume, flow
  plateau with a coefficient of variation below 10 % over the fit window (0.15 s after onset to cycle-off,
  ≥ 0.3 s), fitted by a grid search on the offset c with closed-form log–log regression for a and b. Patient-
  triggered and decelerating-flow breaths report no index (Brief 2 §2.3: invalid with effort).
- **The Venegas anchor stays the default recoil**; the recruitable recoil is selected per scenario
  (`presetPatient(id, { recoil: recruitableRecoil(id, overrides) })`), so M0–M6 physics and the detector grids
  are unchanged.

## D-014 · R/I, PEEP trial, recruited gas, and the warped CO2 loop (2026-09-11, M7)

**Recruited units hold their aerated FRC as real gas.** In D-013 a unit that opened only lowered the elastance
of the open set; its "aerated FRC" was bookkeeping, so a unit that closed on a PEEP release expelled only its
inflation above the anchor and the one-breath R/I release (Chen 2020) read 0.06 in the recruiter. The
compartment volume above the anchor is now `V = recruited·frcUnit + V_infl` (`lung-recruitable.ts`): opening a
unit lowers the recoil at the current volume and the airway ODE fills it, closing expels the unit's whole
content. Consequences: the truth EELV and strain include the recruited gas, unit strain is the honest
`V_infl/(n·frcUnit)` (so the strain caps were re-set: 0.85 → 0.72, pulmonary 1.25 → 1.38), and the recoil-axis
pressure falls as recruitment inflates the chest wall (`Ppl = Ppl0 + Ecw·V`), which makes recruitment
self-limiting in extrapulmonary ARDS.

**Why the measured R/I stays below Chen's 0.5 even in the recruiter.** Chen's `Vrec = ΔVrelease − Crs,low·ΔPEEP`
assumes the compliance-predicted part is unaffected by the recruited gas. With a stiff chest wall the gas that
leaves the collapsing units also deflates the chest wall, so the passive part shrinks by `Ecw/Ers` of it and the
measured Vrec is only `EL/Ers ≈ 0.5–0.65` of the true collapsing volume; and the low-PEEP tidal breath re-opens
some of the units that closed, which inflates Crs,low. Both are real limitations of the single-breath method.
The model's ceiling for Gattinoni 1998's average extrapulmonary patient (Ecw 12.1, Ppl0 12, 0.22–0.3 L recruited
0 → 15) is R/I ≈ 0.15–0.3; the **recruiter scenario** therefore uses a larger recruitable population (0.4) with a
less stiff chest wall (Ecw 8, Ppl0 8) and reads R/I ≈ 0.35–0.4 (Chen's cohort median 0.5, range 0–2); the
consolidated lung reads ≈ 0. Tests assert this ordering (`tests/physics/ri.test.ts`): recruiter ≥ 0.3,
extrapulmonary preset intermediate (> 0.1 and > pulmonary + 0.1), pulmonary < 0.1, normal |R/I| < 0.25. The
0.5 cutoff stays in the registry (`RI_THRESHOLD`) as the cited teaching threshold. Q-4 asks whether the
recruiter phenotype should be re-anchored so the measured R/I reads ≥ 0.5.

**Opening band and hysteresis re-set for the release window.** Units opened by a PEEP-15 plateau (recoil ≈ 10–12
in this phenotype) and closed at PEEP 5 (recoil ≈ 2) need `TOP < p_plateau` and `TOP − closeDelta > p_5`, a
window whose width shrinks by the hysteresis. `RECRUIT_CLOSE_DELTA` 6 → 4 (Brief 2 §2.2 gives 5–10 [M] on the
airway axis; 4 on the recoil axis is ≈ 6–8 through the chest wall), extrapulmonary TOP N(8, 4) → N(9.5, 1.5)
(centred on the window), pulmonary TOP N(30, 4) → N(34, 3) so that no consolidated unit cycles at a protective
plateau (the earlier Gattinoni pulmonary rise 25 → 31 was partly tidal recruitment at Pplat 30; now it comes from
the strain cap alone: 26 → 35). Gattinoni extrapulmonary: Ers 25.1 → 22.7 with 0.22 L recruited; decremental
steady steps (Vt 500, 60 s each) Crs 40.5 / 46.6 / 45.3 / 44.3 / 42.9 / 39.7 at PEEP 20…0, best 16.

**Maneuvers on measured signals (`src/sim/vent/peep-maneuvers.ts`).** R/I: at the next cycle-off PEEP drops from the
set value to `RI_PEEP_LOW` 5, `ΔVrelease = Vte(release) − mean Vte(previous 3)`, four breaths at low PEEP, an
inspiratory hold gives `Pplat,low`, `Crs,low = Vt/(Pplat,low − 5)`, PEEP restored; airway opening pressure is not
modelled (LIMITATIONS), so `Vpred = Crs,low·(PEEP_high − 5)`. Decremental trial: PEEP set to max(set, 20)
immediately, −2 every 6 breaths down to 4, a 1 s inspiratory hold closes each step (Pplat, ΔP against the set
PEEP, Crs, PL,ei = Pplat − Pes when the balloon is on, Gattinoni-simplified power), best PEEP = argmax Crs,
original PEEP restored. Both are driven by the ventilator's own breath-start, cycle and hold events.

**Settings-log aliasing bug (M3–M6, fixed).** `Ventilator.applySettings` mutated the live settings object for
immediate keys (PEEP, trigger, alarms) and that object was referenced by the earlier `settingsLog` entries, so a
later PEEP change rewrote the labeler's context for breaths before the change. The object is now copied before
mutation. Emergence matrix, held-out detector scores and the snapshot were re-run unchanged in outcome.

**CO2 loop (`src/sim/patient/gas-exchange.ts`).** The store is a CO2 mass balance
`dPaCO2/dt = (VCO2 − VA·PaCO2/0.863)/K` with `K = τ·VA_ref/0.863` (τ 3 min at the eupneic ventilation), which
gives the brief's first-order approach at the set point, a slower approach at low VA, and a bounded rise in
apnea (VCO2/K ≈ 13 mmHg/min) instead of chasing `0.863·VCO2/VA → ∞`. VA is the last breath's `(Vt_true − VD)·60`
over `max(period, time since that breath)` so it lags one breath and decays during an apnea. Drive:
`Pmax scale = clamp(1 + 0.06·(PaCO2_d − 40), 0, 3)`, `rate scale = clamp(1 + 0.03·(…), 0.5, 2)`, apnea below
36. **Gains are at the low end of the brief's 1–3 L/min/mmHg** (≈ 0.5 here) because the warp multiplies every
real-time lag in the loop (the breath-by-breath ventilatory response cannot be warped): with 0.15/mmHg or a 20 s
VA window the warped loop oscillated between apnea and hyperpnoea in the under-assist scenario. The over-assist
scenario still cycles apnea → backup → recovery, which is the phenomenon it teaches. Scenarios use warp ×10;
above ≈ ×20 the loop shows lag-driven periodic breathing (LIMITATIONS). Determinism holds per warp value; the
warp changes only the CO2 clock (test: byte-identical streams at warp 1 and 60 with the gains at zero).

**PMI** is Foti 1997's `Pplat(hold) − (PEEP + PS)` in pressure support (PEEP + Pinsp in PC), from the last
inspiratory hold; the dashboard's earlier placeholder mentioned Pes, which is not how PMI is defined.

## D-015 · Education layer and export choices (2026-09-11, M8)

- **Explain cards are static text plus templates** (`src/edu/cards/index.ts`): one card per `PatternId` written
  from Brief 1 §3 and Brief 2, and `caseEvidence()` that turns `BreathLabel.evidence` (neural Ti, ventilator
  Ti, cycling/trigger delay, stacked volume, Pmus, PTP, PL,ei, leak fraction…) into one sentence per pattern.
  Ineffective efforts are effort-level labels, so their evidence comes from `effortEvidence(EffortLabel)`
  and the card lists every ineffective effort inside the breath's window. No LLM, no free text.
- **Quiz identification is graded by the Jaccard similarity** of the pick list and the truth set of the last
  60 s (a pattern counts when ≥ 10 % of the breaths carry it, `QUIZ_PATTERN_MIN_FRACTION`; ineffective
  effort by the efforts). Spec §8 says "graded against truth" without a formula; Jaccard punishes both misses
  and false positives symmetrically and gives 1 only for an exact match.
- **Fix grading follows Spec §8 literally**: AI < 10 % over 60 s of simulated time from the moment the learner
  starts the window, mean ΔP ≤ 15 and Pplat ≤ 30 over the breaths that have a plateau (a breath without a
  hold does not fail the check but is reported as unverified), mean Vt 4–8 mL/kg PBW, and no *new* severe
  alarm (`SEVERE_ALARMS`: high Ppeak, apnea, disconnect, low Ve, high PEEPi) since the window started.
  Scenario-specific extras (e.g. PL,ee ≥ 0) are `ScenarioDef.quizExtras` (post-M9): a truth metric
  (`plEE`, `plEI`, `dPL`, `dPes`, `pmusPeak`) with a `min` or `max`, read as the worst compartment per
  breath and averaged over the fix window (`extrasFromTruth`); the obesity, abdominal-hypertension and
  extrapulmonary-ARDS scenarios require PL,ee ≥ 0 (obesity also PL,ei ≤ 20).
- **Score = 50 % identification + 50 % fix** (fix = 50 % pass + 25 % time factor + 25 % changes factor; time
  is simulated seconds, free below 60 s and decaying linearly to a 0.5 floor over 30 min; changes are
  confirmed setting commits, free up to 3 then −5 % each to a 0.5 floor). A failed fix scores zero for its
  half. Constants `QUIZ_*` [M].
- **Progress is one JSON document** under `ventsim.progress.v1` with attempts, best score, pass flag and the
  last 10 attempts per scenario; every storage call is wrapped and a throwing storage degrades to memory.
- **Instructor mechanics are live multipliers** (`setPatientScale`: base `rScale`/`eScale` on top of the
  injectors), because the patient model is built once per session; FRC and the drive baseline are changed
  through the scenario editor (edit the JSON, run it), which restarts the simulation. The drive, entrainment
  and CO2 gains change live; EL and Ecw change live since D-018. Injectors already had their panel.
- **Session exports cover what the main thread holds**: the signals of the last 120 s (`StreamStore`), and
  the labels, monitor values, maneuvers, alarms and CO2 samples since the scenario started. A full-length
  signal export is what the batch generator is for. The batch runs in its own worker (`batch.worker.ts`) and
  produces one CSV and one JSON per scenario × seed (× setting perturbation) plus a manifest, zipped with
  fflate; `scripts/batch.ts` does the same in Node.
- **The drawer became tabbed** (Scenario · Explain · Quiz · Export) so the loops keep their space; the
  instructor panel lives under the injectors on the left. A badge click opens its explain card.

## D-016 · Cardiac artifact on Pes is a systolic pulse, and ΔPes is read cardiac-smoothed (2026-09-11)

- **Problem.** The balloon added a pure sinusoid of amplitude 1.5 cmH2O (3 cmH2O peak-to-peak) at the heart
  rate to Pes in every balloon scenario. In a passive VC breath the respiratory Pes swing is Ecw·Vt ≈ 3 cmH2O,
  so the ripple was as large as the breath and the trace read as a continuous wobble; during expiration it
  was a bare sine wave. Brief 2 §1.3 gives the artifact as ≈ 1–3 cmH2O, which in the source tracings is
  peak-to-peak, so the constant was at the top of the range and mis-applied as an amplitude.
- **Waveform.** `cardiacArtifact(t, HR)`: a raised-cosine bump over `PES_CARDIAC_WIDTH` = 0.3 of the cardiac
  cycle with peak-to-peak `PES_CARDIAC_PP` = 1.5 cmH2O (mid-range), baseline for the rest of the beat, with
  the beat-mean subtracted so Pes averaged over a beat equals the model Pes (PL,ee and the occlusion test are
  unbiased). The fundamental stays at the heart rate, inside the 0.8–4 Hz band the detector's cardiac
  features assume; the detector does not read Pes, so its held-out numbers are unchanged. [M]
- **ΔPes readout.** `truthBreathMetrics` now takes the reader's `fs` and reads the Pes swing on a moving
  average over `OCCLUSION_SMOOTHING` (0.3 s), the same window the occlusion test uses. The raw max − min had
  added up to the full ripple to ΔPes, which meant the over-assist band (ΔPes < `DPES_LOW` = 3) could never
  fire. Residual error under the modelled artifact is < 0.7 cmH2O (`lung-stress.test.ts`); a 1 s half-sine
  effort loses ≈ 4 % of its swing to the window.
- **Not done.** No amplitude dependence on balloon position (larger behind the heart), no heart-rate
  variability; recorded in LIMITATIONS.

## D-017 · Schematic SpO2 readout (2026-09-11, Spec §4.6 stretch goal)

- **Display only, labelled schematic.** `src/monitor/spo2.ts` runs on the main thread per closed breath; the
  physics, the drive and the detector never read it. The Monitor tile reads "SpO2 … % schematic" with the
  estimated PaO2 and effective shunt underneath.
- **Mapping.** Alveolar gas equation PAO2 = FiO2·(760 − 47) − PaCO2/0.8 (PaCO2 from the CO2 loop when
  present, else the 40 mmHg set point); effective shunt = base/(1 + Pmean/20) + 0.5·(1 − open fraction),
  clamped to 0.6; CaO2 = CcO2 − s·5/(1 − s) (shunt equation with a fixed a–v difference, Hb 12); PaO2 by
  bisection on the Severinghaus 1979 curve, SpO2 = SaO2. Base shunt is `ScenarioDef.shunt` (pulmonary ARDS
  0.3, extrapulmonary 0.2) or `SPO2_SHUNT_BASE` 0.05. The open fraction comes from the recruitable lung's
  end-expiratory aerated fraction (1 for a lung without recruitable units), so the PEEP-trial scenarios
  desaturate as units close and re-saturate as they open; the Pmean term is a schematic stand-in for
  recruitment of atelectasis the linear-lung phenotypes do not model [M].
- **Why so simple.** The spec asks for "a simple monotone mapping, clearly labelled schematic"; anything with
  dynamics or a validated shunt model is out of scope and would invite reading the number as a prediction.
  Tests: `tests/unit/spo2.test.ts` (normal lung 95–99 % on room air with PaO2 80–110; monotone in FiO2,
  open fraction and Pmean; base shunt lowers it), `tests/e2e/m7.spec.ts` (tile labelled, ARDS < normal).

## D-018 · Live EL / Ecw for the instructor (2026-09-11)

- **Ecw is a parameter of the running model** (`Ppl = pplOffset + Ecw·V`), so `PatientModel.setMechanics`
  writes it and it acts on the next step: the pleural pressure jumps at the current volume, as it would for
  a chest wall that stiffened, and the volume state is continuous (`live-mechanics.test.ts`: doubling Ecw
  doubles the passive pleural swing Ecw·Vt; the largest volume step around the switch is no larger than
  ordinary breathing).
- **EL is a live multiplier on the recoil curves**, `elScale = EL/EL0`, applied with the injector `eScale`
  in `outputs`, in `lungElastance` and in the static inversion. This is exact for a linear lung
  (`el·V → el'·V`), and a chord-elastance scaling for the Venegas and recruitable curves, whose shapes are
  anchored to the phenotype rather than to `el` (so rebuilding the recoil elements from a new `el` would
  have changed nothing for a Venegas lung and would have reset a recruitable lung's gas state). The
  recruitable units already see the scaled pressure through `advance(dt, PL − PL0)`, so their opening and
  closing follow the new stiffness without any reset.
- **Plumbing**: `MainToWorker setMechanics`, `SimSession.setMechanics` (EL ≥ 1, Ecw ≥ 0),
  `SessionStatus.mechanics` (the controller updates its `PatientSummary` from it so the main-thread truth
  labeler's compliance rules follow the change), `InstructorPanel` inputs `instr-el`, `instr-ecw`,
  button `instr-apply-el`. The `EL ×` multiplier stays as it was (it composes with the absolute value).

## D-019 · Quiz bedside view, locked link and templated debrief (2026-09-11)

- **What is hidden and why.** Six keys (`src/edu/quiz-view.ts`): `truth` (layer, toggle, truth badges,
  truth-only readouts), `pes` (the Pes row and the tiles that need the balloon), `scenario` (title →
  "Case", summary, objectives, targets, suggested fix, best score), `derived` (lung-stress dashboard,
  Validation link, balloon-only tiles), `explain` (tab, badge click, badge hover evidence), `co2` (panel
  and warp). The preset `bedside` is all six: what a resident sees at the bedside is the ventilator screen
  and the monitor, nothing that names the case or exposes the model. The set is stored in
  `ctl.view.quizHide` and acts only while a quiz is in `identify`/`identified`/`fix` or the session is
  locked (`ctl.quizHides(key)`), so the instructor previews the case normally.
- **Badges** were already hidden during identification (M8); with `truth` hidden they stay hidden through
  the fix phase and return with the debrief, because the truth badge row would otherwise name the pattern.
- **Locking is not security.** `#<id>?quiz=<keys|bedside>` sets `ctl.view.quizLocked`: the Instructor
  panel is not rendered, the picker and the truth toggle are disabled, truth exports are hidden. The lock
  lifts on `evaluateQuiz` and `endQuiz`. The URL is editable; a learner who edits it has opted out of the
  exercise, which is acceptable in a classroom.
- **Debrief is templated** (`src/edu/debrief.ts`, no LLM, D-015): the confirmed setting changes since the
  fix window started (`settingsChangeLog`, appended in `applySettings`, `applyFix` and `setInjector`, one
  entry per changed key, alarm limits per limit, injectors as on/off), the truth patterns by card title
  with the latest case-evidence sentence and found / missed / extra marks, the scenario `fix.note` and
  its settings key by key with a mark — **matched** (same direction, within `QUIZ_FIX_BAND` = 25 % of the
  recommended step of the recommended value), **partial** (same direction), **not done**, **opposite** —
  plus the AI before and after and the failed checks, then mechanism, signature, causes, pitfalls and the
  ranked fixes from the cards. Grading is unchanged. A compact summary (changes, patterns, pass) is stored
  with the attempt (`QuizAttempt.debrief`) and shown in the Quiz tab's idle state.
- **Not done.** No per-learner identity, no server.
- **Follow-ups (2026-09-11, later the same day).** (1) With `scenario` hidden and the session not locked,
  the picker now reads "Case n" for every case (n = position in the library list, stable across sessions)
  with the category groups labelled "Cases", so the learner can still switch cases without reading a
  title. (2) Drive changes enter the confirmed-change log like settings: `driveChangesFrom` /
  `applyDriveSnapshot` / `driveSnapshot` in `src/edu/debrief.ts` keep a `DriveSnapshot` (rate, neural Ti,
  Pmax, entrainment ratio or off) that the controller starts from the scenario drive and updates on every
  instructor apply and scripted `fix.drive`; the debrief marks `fix.drive` keys with the same
  matched / partial / not-done / opposite rule (`debrief-key-drive.<key>`). A passive scenario has no
  snapshot and no drive marks. (3) The Instructor panel lists the stored quiz attempts across scenarios
  (newest first, 20 at most: case, time, score, fix, patterns, changes) as the promised review of the
  `QuizAttempt.debrief` summaries; still browser-local, no export.

## D-020 · Mobile-responsive layout: pinned waveforms and a bottom tab bar on phones, two columns on tablets (2026-09-11)

Design `docs/superpowers/specs/2026-09-11-mobile-layout-design.md`; the three layout choices were put to the
owner as options with mockups and the recommended one was taken each time.

- **Breakpoints.** Phone `(max-width: 699px)`, tablet `(min-width: 700px) and (max-width: 1099px)`, desktop
  ≥ 1100 px unchanged. The phone threshold lives in `PHONE_MAX_WIDTH` (`src/ui/breakpoints.ts`, used by the
  `usePhoneLayout()` hook) and in `theme.css`; `tests/unit/breakpoints.test.ts` reads the stylesheet and
  fails if they drift. The earlier `(max-width: 1100px)` two-column fallback (unused by any test) is gone.
- **Phone: what stays visible.** The waveform screen is pinned at the top, full width, `min(55vh,
  rows × 74 px + 22 px)` tall (`--wave-rows` set by `WaveformCanvas`: 3 bedside, 4 with the balloon, 8 with the
  truth layer), then the time controls, then **one** panel filling the rest, chosen from a 48 px bottom tab
  bar: Vent (truth and balloon toggles, Settings with a sticky Confirm row, Injectors, Instructor), Monitor
  (tiles, maneuvers, dashboard, CO2), Loops (2-column grid), Learn (the drawer's Scenario · Explain · Quiz ·
  Export, with the Validation link under Export). All four panels stay mounted; the inactive three are
  `display: none`, so the settings draft and the instructor's state survive a tab change. When the
  controller opens a drawer tab on its own (badge tap → Explain, quiz start → Quiz) the phone switches to
  Learn.
- **Why a tab bar rather than a long scroll.** The learner's phone task is "watch the traces while
  changing a setting"; a long scroll takes the waveforms off screen the moment the settings are reached,
  and a sticky header of eight truth rows leaves no room for anything else. One panel at a time keeps the
  screen and the control in view together.
- **DOM unchanged.** `.col-center` and `.drawer` become `display: contents` below 1100 px so the time
  controls, waveform wrap, loops and drawer pane are laid out directly by `.app-main` (flex column with
  `order` on the phone, a two-column grid with explicit rows on the tablet). The only JavaScript layout
  state is the `phone` boolean: it moves the header toggles into the Vent tab and the CO2 panel into the
  Monitor column, renders the tab bar and stamps `data-mtab` on `.app-main`. Each control renders once, so
  the test ids stay unique and the desktop suite is untouched.
- **Tablet.** Time controls, waveforms (`max(300px, min(50vh, rows × 80 px + 22 px))`) and the drawer
  (loops left, tabbed pane right, 260 px) span both columns; Settings/Injectors/CO2/Instructor sit left and
  Monitor/Dashboard right, and the page scrolls (`.app-main` `overflow-y: auto`; the columns no longer
  scroll independently). The desktop `grid-template-rows: minmax(0, 1fr)` had to be reset (`none`) or the
  first auto row collapsed to zero height.
- **Touch.** Under the phone query and `(pointer: coarse)`: buttons, selects and inputs ≥ 40 px, inputs at
  16 px text (no iOS focus zoom), 22 px checkboxes, quiz picks one per row, explain/debrief two-column
  blocks one column, the debrief keys and PEEP-trial tables inside a horizontally scrolling `.table-wrap`.
  A tap within `BADGE_TAP_HEIGHT` = 32 px of the top of the waveform screen counts as a badge tap on a
  coarse pointer (the drawn strip stays 18 px). `isCoarsePointer()` also accepts `navigator.maxTouchPoints`
  so emulators without the media feature behave like phones.
- **Canvases.** Both canvases already re-measure their container every frame with the device-pixel ratio
  capped at 2, so a viewport or tab change resizes them without a `ResizeObserver`; the phone test asserts
  the backing store equals `round(clientWidth × dpr)` after a viewport change, and the tablet test the same.
- **Tests.** Playwright projects `mobile` (`devices['Pixel 7']`, `tests/e2e/mobile.spec.ts`: no horizontal
  overflow, canvas follows its wrap, tab bar, toggles in the Vent tab, settings confirm in the viewport and
  applied, Monitor/Loops/Learn tabs, badge tap at 26 px opens Explain and switches to Learn, resize; quiz
  start → identify → fix through the Vent tab → debrief readable inside its pane) and `tablet`
  (`devices['Nexus 10']`, `tests/e2e/tablet.spec.ts`: no tab bar, full-width waveforms, Settings and Monitor
  side by side, confirm reachable by scrolling, canvas follows). The `chromium` project ignores both files,
  so the 31 desktop tests run as before. Screenshots `docs/screenshots/mobile-phone-{vent,learn,monitor}.png`,
  `mobile-tablet.png`.
- **Accepted limitations.** Landscape phones (≈ 840 × 400) fall into the tablet rule and are cramped; no
  swipe between tabs; the chosen tab is not persisted; the cursor readout appears at a tap and stays until
  the next tap (no mouseleave on touch); the Instructor JSON editor is usable but small on a phone.

## D-021 · Cloudflare Pages at `vent.nahass.ai` as the primary home (2026-09-12)

The `tomnahass.com/vent-sim/` alias (D-008) never shipped: the proxy rules are correct and on the personal
site's `main`, but that site's Netlify build cannot clone its repo (deploy key removed from GitHub), so
tomnahass.com serves a stale deploy and the rules are never applied. Rather than keep VentSim's public URL
hostage to another site's build, it gets its own subdomain on a domain already in Cloudflare: `nahass.ai`.

Cloudflare builds the same artifact as Netlify — `npm run build` → `dist`, Node 22 — so this is
configuration, not a port: `wrangler.toml`, `.node-version` (22), and `public/_headers` carrying the
cache/security rules that live in `netlify.toml`'s `[[headers]]` blocks (Cloudflare and Netlify both read
`_headers` from the output dir, so one file serves both). Vite's relative `base: './'` (D-008) already works
at a domain root, so no rebuild semantics change.

**Workers Static Assets, not Pages.** The first attempt used a Pages-shaped `wrangler.toml`
(`pages_build_output_dir`), but the Cloudflare project is a Workers project whose deploy command is
`npx wrangler deploy`. Wrangler found no valid *Workers* config, fell back to its interactive setup wizard,
and that wizard failed in CI: `Cannot modify Vite config: could not find a valid plugins array` — it wanted to
add `@cloudflare/vite-plugin` to a `vite.config.ts` that declares no `plugins`. The fix is to give wrangler a
real Workers config instead: `[assets] directory = "./dist"` with no `main`, which serves the build straight
from the edge — no Worker script, no Vite plugin, no change to `vite.config.ts`. `not_found_handling` is
`single-page-application` so a typed path lands on the hash-routed app rather than a bare 404.

**Two deploys failed before this was understood; the log looks the same both times but the causes differ.**
Wrangler skips its autoconfig wizard only when it finds a Workers config *and* that config has no
`pages_build_output_dir`. The first attempt had the Pages field, so it was disqualified. The second attempt
had the right `[assets]` config, but on a feature branch — Workers Builds builds `main`, where there was no
config at all, so wrangler autoconfigured from scratch (it reported `Worker Name: vent-sim` from
`package.json` and `Output Directory: dist` from Vite's own default, neither read from any file). In both
cases the wizard then tried to add `@cloudflare/vite-plugin` to a `vite.config.ts` with no `plugins` array
and aborted the deploy. Verified by running `wrangler deploy` against the tree with and without the config:
with it, wrangler goes straight to the API call; without it, it reproduces the CI log verbatim.

Consequences kept in the repo: `wrangler` is an **exact** devDependency, since this behaviour is
version-sensitive and `npx` would otherwise resolve a floating version; and the config has to live on the
branch Workers Builds builds, not just on a feature branch.

A hand-uploaded `dist/` is a valid fallback but deploys nothing on push; uploading the **repo root** instead
of `dist/` serves the unbuilt `index.html`, whose `/src/main.tsx` 404s and leaves a blank dark page.

Netlify stays configured and live as a fallback; nothing is deleted. Fixing the personal site's deploy key
remains worthwhile on its own (the whole of tomnahass.com is stale), but it is no longer on VentSim's path.

## D-025 · Scenario authoring through the reader's LLM, a validator as the gate, "My scenarios" in localStorage, help overlay (2026-09-14)

The instructor editor accepted any JSON with four keys and reported one error at a time. Authors now get a
prompt (`src/edu/authoring.ts`) generated from the same enumerations and bounds the validator
(`src/edu/scenario-schema.ts`) enforces, so the prompt, the validator and `docs/SCENARIO_AUTHORING.md`
cannot drift; the validator reports every problem by field and ignores unknown keys with a warning. No LLM
runs inside VentSim (spec §1 out-of-scope stands): the reader's own model writes the JSON, the validator
decides. Saved scenarios live in `ventsim.custom.v1` (guarded storage as the progress store); ids that
collide with shipped scenarios are refused; the controller resolves ids through the library first and the
store second so hash links and quiz links work for both. Settings bounds moved into `SETTING_BOUNDS`
(`src/sim/vent/settings.ts`) so the clamp, the UI and the validator share one table. The help dialog is a
native `<dialog>`; it holds no truth data, so it stays available in the locked quiz view; the first-visit
auto-open is remembered in `ventsim.help.seen.v1`.

## D-022 · SIMV: end-of-period synchronization window, clock reset on the mandatory breath, the `breath` event, stacked mandatory breaths as double triggers (2026-09-14)

The ventilator now emits a `breath` event at every inspiration start (`kind` vc | pc | ps, `mandatory`,
`pTarget`). The truth labeler and the signal-only detector judge each breath by that kind instead of by
`settings.mode`, which is what mixed-breath modes need (SIMV here, PRVC and APRV next). For the four
existing modes the kind is a pure function of the mode, so the held-out detector grid reproduces its
counts exactly (recorded in VALIDATION.md); the detector still reads only measured channels, events and
settings. SIMV follows Brief 1 §2.5: mandatory VC or PC breaths at the set rate; a patient trigger inside
the last `SIMV_SYNC_WINDOW` (0.25) of the period delivers the mandatory breath early; efforts earlier in
the period get PS breaths (the PSV plan). The period clock resets on each mandatory breath (PB-840
style; Dräger keeps a fixed clock), so the achieved mandatory rate can run a little above the set rate
when the patient triggers inside the window — a modelling choice, vendor-specific, exposed as the
advanced `simvWindow` setting. Apnea backup stays a PSV/CPAP feature (SIMV has a mandatory rate).

Truth definition extended: a machine-triggered breath is a **double trigger** (evidence `mandatoryStack`)
when it starts *while the neural inspiration is still active* — `tStart ≤ onset + neural Ti`, with **no**
`LABEL_EFFORT_TAIL` allowance — of the same effort that already triggered the previous breath, which is
the spec's "two ventilator cycles within one neural effort" regardless of the second cycle's trigger
cause; previously only a patient-triggered second breath qualified. A time trigger that lands in the
relaxation phase after neural Ti is a coincidence of the clock, not a second cycle of the effort, and
counting it made every SIMV lesson unpassable (an early implementation with the `LABEL_EFFORT_TAIL`
allowance flagged the mandatory clock landing shortly after relaxation began as a double trigger on
nearly every cycle). `ScenarioCriteria.over: 'mandatory'` lets a scenario's emergence fraction count
mandatory breaths only.

The two "stay in SIMV" fixes tried for the low-support and stacking scenarios could not bring the
after-fix asynchrony index under the 10 % scenario gate: a fixed-Ti mandatory breath running against a
variable-duration neural effort always leaves a residual population of premature or delayed mandatory
cycles (lengthening or shortening the mandatory Ti only trades which tail of the effort-duration
distribution it misses), and a mandatory rate that sits at an exact submultiple of the neural drive rate
phase-locks into reverse-trigger labels on a fixed fraction of cycles. So `simv-low-support` and
`simv-stacking` fix by **leaving SIMV for PSV** (every breath supported the same way, no mandatory clock
to miscycle), and `simv-mixed-breaths` fixes by **switching the mandatory base to PC** with `rr 13` and
drive `rate 22` (breaking the harmonic lock without leaving SIMV, since the target pattern here is
mandatory-breath flow starvation and needs a mandatory clock to demonstrate). This is a pedagogic finding
in its own right, not just an implementation detail: SIMV's fixed mandatory clock racing a patient's own
variable respiratory timing is inherently asynchrony-prone, and the bedside fix clinicians actually reach
for is to leave the mode, which the scenario library now teaches directly.

**Stacked-mandatory rule coverage (post-review, 2026-09-14).** The stacked-mandatory truth rule above (a
machine-triggered breath starting while the neural inspiration that already triggered the previous breath
is still active) is exercised only by the synthetic `labelBreaths` test in `tests/unit/labeler.test.ts`; no
shipped scenario produces a time-triggered stack. A time trigger can only land inside a still-active neural
inspiration once the previous supported breath has already cycled early against that same effort — and a
breath that cycles early and gets re-triggered by the continuing effort is a *patient* re-trigger, not a
time trigger, so it satisfies the rule through `triggerCause === 'patient'` first. `simv-stacking`'s stacks
are exactly this: PS breaths cycle early at ETS 60 %, the effort continues and re-triggers before the
mandatory clock ever fires. For this reason the scenario's assertion (`tests/unit/labeler.test.ts`, "SIMV
stacking") checks `evidence.firstBreath` — evidence that the truth rule matched a stacked pair at all —
rather than the plan's original `triggerCause === 'time' && mandatory && mandatoryStack`, which would
assert a code path the library never exercises. Also from tuning during this review: `simv-low-support`
ships `peakFlow` 35 (the original plan called for 50) — the lower flow was needed to keep the after-fix
asynchrony index under the scenario gate.

## D-023 · PRVC: VC test breath, breath-by-breath regulation with a 3 cmH2O step, a ceiling of limit − 5 and a floor of PEEP + 5; "volume not achieved"; the support-withdrawal truth pattern (2026-09-14)

Brief 1 §2.5 gives the regulator as `Pinsp_next = Pinsp + clamp(k·(Vt_target − Vte)/C_est, ±ΔPmax)` with
ΔPmax ≈ 3 and a ceiling of Pmax_alarm − 5, all vendor-specific. Built as: the first breath after entering
PRVC or changing the volume target is a square-flow VC breath over the set Ti with a `PRVC_TEST_PAUSE`
(0.3 s) pause; compliance is C = Vti/(Pplat − PEEP) measured at the end of that pause (with the divisor
floored at `PRVC_MIN_DP_FOR_C`, 0.5 cmH2O), and the initial ΔP is Vt/C. That initial ΔP is itself clamped to
the [floor, ceiling] band before the first PC breath, so a test breath on a very stiff or very compliant
lung cannot start the regulator outside the band it is then held in. Every later breath is PC at PEEP + ΔP,
time-cycled; at each breath start the regulator corrects
ΔP from the previous breath's measured inspired volume — `step = clamp(PRVC_GAIN·(Vt − Vti_prev)/C_eff,
±PRVC_STEP_MAX)` with `C_eff = Vti_prev/ΔP_prev` (gain 1.0, step clamped to ±3) — then clamps the result to
[`prvcMinDp` (5), highPpeak − `PRVC_PMAX_MARGIN` (5) − PEEP]. The floor is the Servo-i convention (PEEP +
5); it is a setting (`prvcMinDp`) because vendors differ. "Volume not achieved" (`prvc-limit`) fires after
two consecutive breaths at the ceiling delivering under `PRVC_LIMIT_VT_FRACTION` (0.9) of the target. The
regulator reads the ventilator's own Vti, so a leak fools it as at the bedside; entering PRVC or changing
`vt` forces a new test breath, but a PEEP change does not. The reset (`prvcResetIfRetargeted`) runs when the
pending settings commit, at the next breath start — `mode` and `vt` are not immediate keys, so the identical
call on the `applySettings` path is defensive only (it would matter only if either key were ever made
immediate), and is commented as such in the code.

Two deviations from the plan. First, a ruling on the VC test breath itself: when it alarm-cycles (high
Ppeak on a stiff lung, so there is no pause and no plateau), the regulator seeds ΔP from the
end-inspiratory pressure instead of never leaving the test breath — `prvcSeedFromTestBreath` runs at
every inspiratory exit, not only after a completed pause. This is not in the spec; record it as a
modelling choice. Second, a fix-round finding: `PRVC_DP_EPSILON` (0.5 cmH2O). Below that regulated ΔP the
delivered volume is effort, not pressure, so `Vti/ΔP` is no longer a compliance; below the epsilon the
stored test-breath compliance (`prvcCompliance`) is used as the denominator instead. Without it, a
regulator driven to ΔP ≈ 0 by a strong effort against a floor setting of 0 could never step back up
(measured: 2 mL/breath for the rest of the run — the volume the effort alone produces, with no pressure
left for the step formula to divide by). The same fallback is taken when the previous breath's measured Vti
is at or below `PRVC_MIN_VTI_FOR_C` (0.02 L): 20 mL is under any adult tidal volume, so such a breath (a
disconnect, an alarm cycle, a breath cut off in its first moments) would put noise in the numerator of
Vti/ΔP. A third fix-round change is bookkeeping, not physics: `prvcRegulate` now runs at every breath start
in every mode and clears `prvc-limit` when the mode is not PRVC, since the alarm previously survived a mode
change.

Three further changes came out of the whole-branch review. (a) **The apnea backup now ends at the first
breath start in a mode with a mandatory rate.** `backupActive` was cleared only by a patient trigger, so
switching from PSV-in-backup to any of VC-AC/PC-AC/SIMV/PRVC left every later breath on the backup PC plan
at PEEP + `backupPinsp` with the apnea alarm latched (in PRVC the VC test breath never ran, and
`regulatedDp` would have been seeded from a backup breath). `startInsp` now calls `exitBackup` when the
committed mode `hasMandatoryRate`; the trigger that starts that first breath still reads `backup`, because
it was scheduled during expiration while the old mode was still in effect. `prvcRegulate` and
`prvcSeedFromTestBreath` additionally treat a preceding backup breath as "no previous breath" — its volume
came from the backup plan, not the regulator. This was pre-existing behaviour (VC-AC showed the identical
stuck sequence), not new in M12. (b) **`prvc-limit` counts what the rule says it counts.** `atCeiling` was
read on the post-step ΔP while `short` referred to the previous breath, and an alarm-cycled VC test breath
counted as an at-ceiling short breath, so the alarm could fire one breath early (measured on the stiff-lung
test: at the start of the third breath, after one PC breath at the ceiling). Both terms are now read on the
breath that just ended and only `kind === 'pc'` breaths count, so the alarm fires after two consecutive PC
breaths at the ceiling under `PRVC_LIMIT_VT_FRACTION` of the target (measured on the same test: t = 13.0,
after the ceiling-bound PC breaths at 4.4 and 8.7). (c) The two inline guards became tagged constants:
`PRVC_MIN_VTI_FOR_C` (0.02 L) and `PRVC_MIN_DP_FOR_C` (0.5 cmH2O).

Truth pattern `support-withdrawal`: a PRVC breath (`kind === 'pc'`) whose ΔP is within
`LABEL_SUPPORT_WITHDRAWAL_MARGIN` (1 cmH2O) of the floor while the peak Pmus is ≥ `PMUS_HIGH` — the "PRVC
paradox" the brief names, where a low driving pressure and a volume at target look reassuring on the
screen while the patient is doing the work.

The report-only detector rule supersedes the brief's draft (`earlySag ≥ DET_SW_SAG`), which never fired
during tuning: **floor test AND `triggerCause === 'patient'` AND measured Vti ≥ `DET_SW_VT_EXCESS` (1.05)
× set Vt**. `earlySag` is sampled after the pressure ramp, where the servo is already holding its (lowered)
target — measured 0.8–1.2 cmH2O against the drafted 2 cmH2O threshold — because PRVC withdraws support by
lowering the *target* pressure, not by letting Paw sag under a fixed one; `inspHump`/`midInspDip` do not
separate the case either, since in support withdrawal the effort itself is what triggers the breath, so
there is no second flow rise to detect. The measured separators on the tuning runs: patient trigger 15/15
of support-withdrawal breaths vs 0/11 of the passive comparison, Vti/Vt 1.10–1.18 vs 0.99–1.01 (a passive,
compliant lung sitting at the floor still delivers close to the set target, never over it). `DET_SW_SAG`
does not exist in the constants table; `earlySag` appears only in the evidence string, for the clinician
reading it, not as a detector conjunct. By construction the detector misses time- or reverse-triggered
support-withdrawal breaths (truth still labels them, since the regulator's math does not care why the
breath started) — a limitation, not a bug, recorded in `docs/LIMITATIONS.md`.

Review-round correction to the reported gap: that construction is **not** what the 0.20 sensitivity on
`prvc-pressure-withdrawal` measures. Re-measured on the shipped scenario, all 15 truth support-withdrawal
breaths after 10 s are patient-triggered; the 12 misses fail the volume conjunct (Vti/Vt 0.96–1.05, full
range 0.96–1.22, only 3 at or above `DET_SW_VT_EXCESS`). The volume-excess threshold was tuned at a drive
Pmax of 16 and does not transfer to the shipped Pmax of 12, where a regulator pinned at its floor delivers
about the target rather than over it (re-run: 9/14 breaths ≥ 1.05 at Pmax 16, 7/16 at Pmax 14, 3/15 at Pmax
12). `DET_SW_VT_EXCESS` is deliberately left at 1.05: the reported scenario is not a tuning set, and the
value that would catch these breaths (≈ 0.96) is inside the passive floor-pinned band (0.99–1.01) the
conjunct exists to exclude. The honest statement of the limit is that a volume-excess test is weak once the
regulator reaches its floor, because the excess is what drove the pressure down. `docs/VALIDATION.md` and
`docs/LIMITATIONS.md` carry the measured numbers.

`prvc-pressure-withdrawal`'s scripted fix needed two rulings to clear the 10 % after-fix asynchrony gate.
The brief's fix (PC-AC, Pinsp 14, Ti 0.9) left AI at 31.8 % after the fix; a full sweep of PC-AC (Ti
1.0–1.3 × Pinsp 12–16, best 38.5 %) and PSV (PS 12–16, best 42.1 %) at the scenario's unmodified drive
could not clear the gate either, because the post-fix events were ineffective efforts and auto-PEEP labels
driven by a 24/min neural rate that no mode or support level absorbs on its own. The fix was therefore
widened to treat the drive as well as the ventilator (`ScenarioFix.drive`, which the spec's APRV table
already uses and which the explain card already lists as a fix), landing on **PSV, PS 12, with the drive
also treated (rate 16, Pmax 8)**. Result: AI 0 % → 0 % after the fix (support-withdrawal 0.73,
high-effort 0.77 before it), ΔPes after the fix 4.75 cmH2O (the scenario's quiz extra, ≤ 10, is met with
margin). No PC-AC-plus-treated-drive combination cleared the gate before PSV was chosen. This is the M12
counterpart of D-022's "leave the mode" finding, recorded the same way: not a workaround, but the
pedagogic point that the bedside fix for a regulator racing a rising drive is a fixed, patient-cycled
pressure *and* treating the drive, not either alone. `pendelluft` was dropped from
`prvc-pressure-withdrawal`'s `targetPatterns` (brief-authorized): the pattern needs the two-compartment
recruitable-recoil lung's regional recoil difference, which this phenotype does not use, so it stays out
of the scenario's summary.

Tuned drive values, both inside the plan's authorized ranges: `prvc-double-trigger`'s drive `ti` is 1.2 s
(plan draft 1.3, range 1.2–1.5) so the double-trigger fraction clears the 0.2 target;
`prvc-pressure-withdrawal`'s drive `pmax` is 12 (plan draft 14, range 12–18). Constants as built: `PRVC_STEP_MAX` 3,
`PRVC_PMAX_MARGIN` 5, `PRVC_MIN_DP` 5, `PRVC_TEST_PAUSE` 0.3, `PRVC_GAIN` 1.0, `PRVC_DP_EPSILON` 0.5,
`PRVC_LIMIT_VT_FRACTION` 0.9 (all `M`).

## D-024 · APRV: no synchronization (TCAV), a bidirectional servo at Phigh, one breath record per Phigh + release, the labeler skips trigger and cycle rules, auto-PEEP kept, `release-collision`, maneuvers disabled, quiz substitutes (2026-09-14)

APRV is built as Habashi's TCAV (Crit Care Med 33:S228, 2005): a high phase at `phigh` for `thigh`, a
release to `plow` for `tlow` (fixed) or until expiratory flow has decayed to `tlowPefr` (0.75) of this
release's own peak, no synchronization of either transition to the patient, and no pressure support at
Phigh. The high phase is `aprvPlan` — the state machine's `insp` with plan kind `'aprv'` (`ti = thigh`,
`pTarget = phigh`, `peep = plow`, not spontaneous), time-cycled by Thigh; the release is `exp` with the
servo already targeting Plow. `controlExp` hands APRV to the new `controlRelease` right after the
leak-baseline update: fixed mode schedules the next time trigger at `tlow`; `pefr` mode schedules it once
elapsed time is ≥ `APRV_TLOW_MIN` (0.2 s, the shortest release the flow rule may end) and the measured
flow has decayed to `tlowPefr` of `pefrThisRelease` (this release's own peak expiratory flow, reset in
`enterExp`, gated on that peak exceeding `PSV_CYCLE_MIN_PEAK_FLOW` — 0.05 L/s, reused from PSV's cycling
guard so a vanishing peak cannot arm the rule), capped at `tlow` either way; the achieved `tlowUsed` and
`pefrFraction` are published as `aprvStatus` before the next `scheduleInsp(t, 'time', events)`. Because the
pefr rule reads inspiratory flow during the release as fraction 0, a spontaneous inspiratory effort ends a
`pefr` release at once — a modelling consequence of the flow rule, not a design goal, and the model's only
de-facto synchronization anywhere in APRV. The servo at Phigh is bidirectional
(`servoTo(target, EXH_VALVE_R, −∞, MAX_SERVO_FLOW)`, with the usual rise-time ramp from Plow): an
inspiratory effort draws gas from the source and an expiratory effort pushes gas out through the
exhalation valve, so the patient breathes at Phigh without any triggered event. Holds, occlusions, R/I and
the PEEP trial (`requestHold`/`requestOcclusion`/`requestPeepManeuver`) return at once in APRV and their UI
buttons are disabled; a switch into APRV clears pending hold/occlusion requests and abandons a running
PEEP maneuver (see below). The disconnect alarm judges Paw against Plow rather than the set PEEP; with the shipped defaults (Plow 0, `lowPeep` 3) that makes the
disconnect alarm unreachable in APRV (Paw would have to read below −3). One breath record spans a Phigh
plus its release (`tStart` = Phigh start, `tInspEnd` = release start, `tEnd` = next Phigh start); its
inspired volume includes whatever spontaneous breaths the patient took at Phigh.

Truth: every trigger- and cycle-based rule is skipped for `aprv` breaths — `kindOf`/`isAprv`/
`aprvBreathAt` gate the trigger-side chain and the cycling block with `if (kind !== 'aprv')`, and the
reverse-trigger and assisted-breath maps skip `aprv` breaths outright — because there is no patient
trigger and no flow cycle to judge; an effort inside an APRV breath (or anywhere in APRV mode) is an
expected unsupported breath, never ineffective, never assisted. `contextFromSettings` reads `peep = plow`
and `pTarget = phigh` in APRV, so `auto-peep` is unchanged and fires on nearly every release (a fix-round
correction made its evidence cite Plow rather than the unused PEEP setting): in TCAV the trapped
end-release pressure *is* the PEEP, and the card says so as its first pitfall. The new pattern
`release-collision` (evidence `releaseLead`) fires when a release begins ≥ `LABEL_RELEASE_COLLISION`
(0.1 s) before the neural offset — mirrors `LABEL_EARLY_CYCLING` — and counts as an asynchronous event:
`release-collision` is in `AI_EVENT_PATTERNS`, so the asynchrony-index denominator in a breathing APRV run
is release cycles, not patient breaths, and a non-zero AI there is expected by design, not a defect.

The detector skips the identical rules for `aprv` breaths (`deviceContext` mirrors the truth-side
`peep`/`pTarget`), and reports `release-collision` from a rule that supersedes the plan's draft. The plan
called for an expiratory-flow notch within a window, or a PEFR delay past a threshold; neither separates a
collision from a normal release in this build. A 0.5 s TCAV release from Phigh 28 is a single monotone
decay toward Plow — a notch requires the deflection to *fall back* after a crest, and nothing ever falls
back inside a monotone release, so zero notches formed over the 42 tuning breaths in every class (truth
collisions, non-collisions, passive). The peak-expiratory-flow delay is set by the exhalation-valve/
driving-pressure transient, not by the patient: 0.12–0.14 s identically in truth collisions, non-collisions
and passive releases. The separator that does exist, measured on the same runs, is the **mean measured
flow over the first 30 ms after cycle-off** (`BreathFeatures.releaseStartFlow`, L/min) — positive means the
patient is still inhaling when the release opens. Truth collisions read +5.4…+8.0 L/min, other releases on
the same run ≤ −2.7, and the passive run −3.0…−2.5 — an 8 L/min gap. The shipped rule is `aprv &&
releaseStartFlow ≥ DET_RC_FLOW` (2 L/min, read over `DET_RC_FLOW_WINDOW` 0.03 s), both constants set on
the tuning runs, never the held-out grid: 3/3 found on the test pair, precision 1.00, zero passive
positives; across nine breathing runs varying seed, drive, Tlow mode and Thigh, recall 0.67–1.00 and
precision 0.67–1.00, with zero positives on both passive runs and the one weak point an honest miss (a
4 cmH2O effort against a 28 cmH2O release leaves almost no flow signature — 1/4 found). `DET_RC_WINDOW` and
`DET_RC_PEFR_DELAY` do not exist in the constants table; the notch-timing feature (`peakExpFlowTime`) was
removed as dead code under this ruling. As with the SIMV and PRVC detector rules (D-022, D-023), this is
report-only — `docs/VALIDATION.md`'s mode table, not the held-out grid in §9.5, is the target, and the
scenario library is never tuned against it.

The quiz substitutes Phigh for the plateau, labelled "Phigh" so the reader is not misled into thinking a
hold was taken, because no inspiratory hold exists in APRV. **ΔP is reported unverified rather than graded**
(amending spec §4.5, on the M13 whole-branch review): the driving pressure that matters in APRV is
Phigh − PEEPtot, the trapped pressure the 75 % release rule sets, and no bedside hold can measure PEEPtot
in APRV either. The controller therefore passes `dp: null` with the label "Phigh − PEEPtot (needs an
expiratory hold; not available in APRV)", which goes through `FixInput.labels.dp` and renders through the
existing unverified-plateau path (`ok: true, verified: false`) — a check the reader can see was not taken,
not one they silently failed. The first M13 build graded Phigh − Plow against `DP_LIMIT` 15; that is the
release amplitude rather than a driving pressure, and with the shipped Phigh 28–30 / Plow 0 it read 28–30
on every APRV scenario, so the fix half of the score (50 % of the total) could never be earned.
`tests/unit/quiz-aprv.test.ts` locks this down: each APRV scenario is run headless with its scripted fix
and `gradeFix` must pass over the post-fix window. `recruitedGain` — mean end-expiratory aerated FRC after
the scripted fix minus before, in L — is a new `ScenarioCriteria.extra` metric with `min` semantics,
alongside the existing `peepiTrue` `max`.

A switch into APRV clears pending hold/occlusion requests and abandons a running PEEP maneuver
(`commitPending`, where the mode change takes effect; `mode` is not an immediate key in `applySettings`,
so that is the only path into APRV). `requestHold`/`requestOcclusion`/`requestPeepManeuver` refuse *new*
requests in APRV, but without the clear a hold latched just before the switch was consumed by the first
APRV cycle as a pause inside the high phase, an occlusion request sat latched (`controlRelease` never
consults it) until APRV was left, and a running R/I or PEEP trial kept asking for holds APRV refuses and
completed with an invalid result (`valid: 0`, `ri: null`).

Three scenario findings round out D-024, each a pedagogic result rather than a bug, the APRV counterpart of
D-022's and D-023's. `aprv-tlow-too-long` teaches derecruitment on an over-long release, but
`ards-pulmonary`'s phenotype cannot show it at a protective Phigh: its recruitable population opens on the
recoil axis at `RECRUIT_PULMONARY_TOP` (34 ± 3 cmH2O), while instrumenting the truth channels directly
across the whole authorized `tlow`/`thigh` range put the non-dependent compartment's plateau at ≈ 24.6
cmH2O and the dependent compartment's at ≈ 26.7 — 2–4 cmH2O short of the ≈ 28.8 cmH2O even the
lowest-quantile recruitable unit needs, at every authorized setting; `tidal-recruitment` measured 0
everywhere in that space. The scenario ships on `ards-extrapulmonary` instead (recoil kept `recruitable`,
shunt 0.2 per its own preset): its recruitable top (`RECRUIT_EXTRAPULMONARY_TOP` ≈ 9.5 cmH2O) is reachable
at a protective Phigh, which is also the clinical teaching — extrapulmonary ARDS, not consolidated
pulmonary ARDS, is the recruitable form. At Phigh 28 / Tlow 1.2 / Thigh 4.5 / a passive patient the
scenario now measures `tidal-recruitment` 1.0/0.5, `auto-peep` 1.0/0.5 and `recruitedGain` +0.191 L
(min 0) — all pass.

`aprv-release-collision` and `aprv-high-effort` both hit the same structural wall: in an unsynchronized
mode, a release beginning while the patient is still inspiring is not a tuning failure to be tuned away but
close to a law of the mode — the collision probability per release is ≈ (Ti − 0.1)/period regardless of
how Thigh is set, since nothing links the release clock to the neural clock. `aprv-release-collision`'s
brief fix (Thigh 8.0, Tlow cap 0.6, both range maxima, drive unchanged) left the after-fix AI at 33 %,
confirming Thigh alone cannot clear it; adding the drive to the fix (rate 14, Pmax 6 — both authorized
maxima) cleared it to 0 % on 6 post-fix release cycles, none colliding. This is the APRV counterpart of
D-023's "treat the drive too" finding for `prvc-pressure-withdrawal`: fewer, gentler efforts mean fewer
collisions, and no ventilator-only combination substitutes for slowing the drive. `aprv-high-effort`'s own
scripted fix (Pmax 8, rate 16, Thigh 5.0 unchanged, from the brief) produced the identical mechanism in
reverse — a 20–30 % post-fix AI from the fix's own release cadence colliding with its own drive, immune to
every pre-fix parameter the brief authorized (drive rate 20–26, Phigh 26–32, drive Pmax 12–20 all swept,
none clearing 10 %). Authorized to sweep the fix's own drive and Thigh and to prefer the mildest
combination, the shipped fix is rate 14 / Pmax 8 / Thigh 8.0 s: 0 % AI on 5/5 post-fix cycles, mean ΔPL
14.12 cmH2O and mean ΔPes 7.89 cmH2O — both inside the scenario's own quiz extras (≤ 15, ≤ 10). An earlier
candidate (rate 14 / Pmax 8 / Thigh 6.0) cleared the AI gate at 0 % but left mean ΔPL 15.90, 0.9 over its
own ceiling; the ruling that a scripted fix must clear its own quiz extras, not just the AI gate, picked
the milder Thigh 8.0 alternative instead. `pendelluft` and `high-effort` both stayed in
`aprv-high-effort`'s targets at 1.0/0.3 throughout; neither needed dropping.
