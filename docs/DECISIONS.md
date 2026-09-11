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
