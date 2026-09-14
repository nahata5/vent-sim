# Known limitations

What is schematic, what the bedside view cannot see, and where the model stops. Grouped by area; each
entry names the decision or milestone that introduced it. Newest additions last within a group.

## Physiology model

- **Hyperinflation-related muscle weakness is not modelled** (D-007): the force–velocity penalty acts on
  flow only, so a COPD patient at high lung volume generates the same isometric Pmus as at FRC.
- **In injured lungs a well-placed esophageal balloon reads an occlusion-test ratio above 1** by design
  (regional transmission α_D = 1.35, D-007); this is a teaching point, not a calibration error.
- **Cardiac oscillation is a single sinusoid at a fixed heart rate** (M6 injector); there is no heart-rate
  variability and no respiratory sinus arrhythmia. The cardiac artifact on Pes is a fixed-shape systolic
  bump at the same fixed rate (D-016), the same on every patient; it does not grow when the balloon sits
  low behind the heart, and it is not present on the true pleural channels unless the cardiac injector is on.
- **CO2 is a single lumped store** (M7, D-014): one mass balance with a 3 min time constant, one chemoreceptor
  delay, no separate lung/tissue/brain compartments, no O2 or peripheral chemoreceptor term, fixed VCO2 and
  dead space.
- **SpO2 is schematic** (Spec §4.6 stretch goal, D-017): a display-only sketch from FiO2, PaCO2, the aerated
  fraction of units, mean airway pressure and a per-scenario base shunt, through the alveolar gas equation,
  the shunt equation with a fixed a–v difference and the Severinghaus curve. It has no dynamics (no
  desaturation time course, no lung O2 store), no effect on drive, and the shunt mapping [M] is uncalibrated;
  the tile says "schematic" and the value must not be read as a prediction.
- **The time warp scales the CO2 clock only; breathing cannot be warped** (D-014). Every real-time lag in the
  loop (one breath for the VA estimate, the neural response) is multiplied by the warp, so above ≈ ×20 the loop
  shows lag-driven periodic breathing that a real patient would not. The drive gains are set at the low end of
  the brief's range to keep ×10 stable; the over-assist apnea → backup → recovery cycle is genuine.
- **Airway opening pressure is not modelled** (D-014), so the R/I release uses `Vpred = Crs,low·(PEEP_high −
  PEEP_low)` without the `max(PEEP_low, AOP)` correction, and a scenario cannot show complete airway closure.
- **The single-breath R/I under-reads recruitment through a stiff chest wall** (D-014): the measured Vrec is
  about `EL/Ers` of the true collapsing volume and the low-PEEP tidal breath re-recruits part of it, so the
  Gattinoni-average extrapulmonary preset reads R/I ≈ 0.15–0.3 and the recruiter scenario ≈ 0.35–0.4 against
  Chen's 0.5 cutoff (Q-4). The truth layer shows the recruited volume directly.
- **Recruitable units are identical in size and open along a narrow band** (D-013/D-014): the extrapulmonary
  opening pressures span ≈ ±3 cmH2O on the recoil axis (≈ ±4–6 on the airway axis with the pleural gradient),
  narrower than Crotti 2001's distributions, so the P–V curve has a sharper lower inflection than a real one.

## Ventilator model

- **Generic ICU ventilator.** Trigger, cycling, servo and alarm behaviour follow Brief 1's ranges, not any
  vendor's firmware; vendor-specific features (leak-adapted triggers, automatic tube compensation, NAVA/PAV)
  are absent.
- **Expiratory holds abort on the first effort** (D-009) and report the pre-effort plateau, so a patient with
  a very high rate may never yield a total-PEEP reading.
- **R/I and the decremental PEEP trial assume a passive patient** (M7): the release volume and the per-step
  holds are read as on a real ventilator, so an effort during the release or the hold corrupts ΔVrelease or
  Pplat; the maneuvers do not abort on effort the way the expiratory hold does.
- **The decremental trial's ΔP uses the set PEEP**, not total PEEP; in a patient with intrinsic PEEP the
  per-step Crs is under-estimated (an expiratory hold per step is not part of the maneuver).
- **SIMV's synchronization window and period clock are vendor-specific** (D-022): `SIMV_SYNC_WINDOW`
  (0.25 of the period) and the clock-resets-on-mandatory-breath behaviour follow one vendor family
  (PB-840 style); another (Dräger) keeps a fixed clock instead, which would change the achieved mandatory
  rate when the patient triggers inside the window. Both are exposed as settings (`simvWindow`) rather
  than fixed in the physics, but the default follows one convention, not a vendor-neutral standard.
- **The detector is reported but not validated in SIMV** (D-022): `docs/VALIDATION.md`'s SIMV table comes
  from `scripts/mode-detector-report.ts` against the three SIMV scenarios' own truth labels, not the
  held-out grid (which has no SIMV breaths and is never tuned against); the numbers are informative, not
  a gated target.
- **PRVC's step, ceiling, floor, test breath and epsilon are all vendor-specific** (D-023):
  `PRVC_STEP_MAX` (3 cmH2O/breath), `PRVC_PMAX_MARGIN` (the 5 cmH2O ceiling margin below the high-pressure
  alarm), `prvcMinDp` (the floor, Servo-i convention PEEP + 5, exposed as a setting because vendors
  differ), the VC test breath used to seed compliance, and `PRVC_DP_EPSILON` (0.5 cmH2O, below which the
  regulator falls back to the test-breath compliance because a small ΔP's delivered volume is effort, not
  pressure) all follow one vendor family's ranges from Brief 1 §2.5, not any specific ventilator's firmware.
- **The PRVC regulator reads the ventilator's own measured Vti**, so a leak fools it exactly as it would
  fool a real PRVC controller: a leaking breath looks under-delivered and the regulator steps its pressure
  up to compensate, the same failure mode as the trigger and cycling logic elsewhere in the model.
- **The PRVC detector rule (D-023) is reported only and is blind to non-patient-triggered support
  withdrawal**: `support-withdrawal` requires `triggerCause === 'patient'` (the floor test and the volume
  excess alone do not separate the pattern from a passive breath sitting at the floor), so a time- or
  reverse-triggered support-withdrawal breath is missed by the detector even though the truth labeler still
  scores it.
- **The volume-excess conjunct of that rule does not transfer across drive strengths**, which is why its
  measured sensitivity on `prvc-pressure-withdrawal` is 0.20. Measured on the shipped scenario: all 15 truth
  support-withdrawal breaths after 10 s are patient-triggered, and the 12 misses fail `DET_SW_VT_EXCESS`
  (1.05) with Vti/Vt 0.96–1.05 (full range 0.96–1.22). The threshold was tuned at a drive Pmax of 16
  (Vti/Vt 1.10–1.18 there; 9 of 14 breaths at or above 1.05 on a re-run), while the shipped scenario runs
  at Pmax 12, where a regulator pinned at its floor delivers about the target rather than over it. The
  threshold is deliberately not retuned against the reported scenario; see `docs/VALIDATION.md`'s
  "Detector in SIMV and PRVC" section for the numbers.
- **A PRVC floor set above the ceiling is accepted without a warning**: `prvcCeiling` is
  `max(prvcMinDp, highPpeak − PRVC_PMAX_MARGIN − PEEP)`, so with, say, PEEP 25 and a high-pressure alarm of
  30 the floor wins and the regulated target sits at the alarm limit, alarm-cycling every breath. Real
  ventilators refuse or warn on the combination; a settings-level warning is UI scope beyond M12 and is not
  built.
- **`src/sim/vent/ventilator.ts` is ≈ 1040 lines** (D-024): SIMV, PRVC and APRV each added their own
  mode-specific branches (`controlExp`/`controlRelease`, `checkDisconnect`, `applySettings`, the maneuver
  request methods) beside their shared FSM instead of behind a per-mode regulator abstraction; extracting
  the mode regulators (PRVC's step/ceiling/floor, APRV's servo/release) out of the file is the structural
  follow-up noted since Task 1 of M13, not yet done.

## Education layer and export

- **Quiz extras are not defined per scenario yet** (D-015): `gradeFix` accepts scenario-specific limits such as
  PL,ee ≥ 0, but the library's scenarios grade on the spec's four limits only.
- **The quiz's truth set is the last 60 s of labels held on the main thread**; a pattern that appeared only
  earlier in the session is not part of the key.
- **Session CSV covers the retained 120 s of signals** (D-015); use the batch generator for full-length runs.
- **Instructor changes to EL, Ecw or FRC restart the scenario** (through the JSON editor) rather than acting
  live; resistance and lung elastance can be scaled live.
- **Explain cards are the same text for every instance of a pattern**; only the evidence line is
  case-specific.
- **"My scenarios" is per-browser** (D-025): saved scenarios live in `localStorage` under
  `ventsim.custom.v1`, so they do not sync across devices or browsers, are lost if site data is cleared,
  and are not included in the batch generator or session exports the way shipped scenarios are. A saved
  scenario's quiz and hash links work only in the browser that saved it.
- **The authoring prompt is advisory, not authoritative** (D-025): `AUTHORING_PROMPT` is generated from the
  validator's own enumerations and bounds so the two cannot drift in content, but the reader's own LLM can
  still return JSON that violates them (wrong types, out-of-range numbers, invented keys); `validateScenario`
  in `src/edu/scenario-schema.ts` is the actual gate — nothing is saved or run until it reports no errors.
- **The SIMV lessons end by leaving SIMV, not by tuning it** (D-022): `simv-low-support` and
  `simv-stacking`'s scripted fixes switch the patient to PSV; no combination of SIMV settings within the
  authorized tuning ranges brought either scenario's after-fix asynchrony index under the 10 % gate (a
  finding recorded in D-022, not a bug). `simv-mixed-breaths` stays in SIMV (base switched to PC) because
  its target pattern needs a mandatory clock to demonstrate.
- **`prvc-pressure-withdrawal`'s fix treats the drive, not just the ventilator** (D-023): a full sweep of
  PC-AC and PSV settings at the scenario's unmodified drive could not clear the 10 % after-fix asynchrony
  gate (best 38.5 % and 42.1 % respectively), because the residual events were ineffective efforts and
  auto-PEEP driven by a 24/min neural rate that no mode or support level absorbs on its own. The scripted
  fix is PSV, PS 12, with the drive also treated (rate 16, Pmax 8; `ScenarioFix.drive`) — the M12
  counterpart of D-022's "leave the mode" finding: the bedside fix for a regulator racing a rising drive is
  a fixed, patient-cycled pressure *and* treating the drive, not either alone.
- **APRV has no synchronization and no pressure support at Phigh, by design** (D-024): it is built as
  Habashi's TCAV — a fixed high phase and release, neither transition timed to the patient — not a
  synchronized biphasic mode; a patient effort at Phigh is answered only by the bidirectional servo (gas in
  or out on demand), never by a supported breath. Release termination and its defaults (`phigh`/`plow`/
  `thigh`/`tlow`/`tlowPefr`) follow one vendor family's ranges (Habashi 2005), not any specific
  ventilator's firmware.
- **The `pefr` release-termination rule is a de-facto synchronization, as a side effect of the flow rule,
  not a design goal** (D-024): because it reads inspiratory flow during the release as fraction 0, a
  spontaneous inspiratory effort ends a `pefr` release immediately, which a `fixed`-duration release does
  not do.
- **The engine primes the lung and sensors at `settings.peep`**, so every APRV run starts with a t = 0
  transient from that pressure up to Phigh (or down to Plow), not with the patient already equilibrated at
  the TCAV baseline (D-024, carried from Task 1).
- **The disconnect alarm is unreachable in APRV at the shipped defaults** (D-024): it judges Paw against
  Plow rather than the set PEEP, and with Plow 0 and `lowPeep` 3 that requires Paw below −3 cmH2O, which
  never occurs.
- **A hold/occlusion request latched immediately before a switch into APRV is still consumed at the first
  APRV cycle, or survives to fire only after APRV is left; a PEEP maneuver already running when APRV starts
  is left stranded and cannot complete** (D-024, deferred from Task 1) — none of the seven maneuver buttons
  can be pressed once in APRV, so this only matters for a request in flight at the moment of the mode
  switch.
- **The APRV detector rule (`release-collision`, D-024) is reported only**, like the SIMV and PRVC rules
  above: it is not part of the held-out grid in §9.5 and the scenario library is never tuned against it.
  Measured on the tuning runs, recall ran 0.67–1.00 and precision 0.67–1.00 across nine runs (seed, drive,
  Tlow mode and Thigh varied), with one honest miss at a very weak (4 cmH2O) effort against a 28 cmH2O
  release, where the flow signature nearly vanishes.
- **`auto-peep` fires on almost every APRV release by construction** (D-024): the trapped end-release
  pressure *is* the PEEP in TCAV, so the badge is expected on nearly every breath, not a sign something is
  wrong; the card's first pitfall says so.
- **The quiz substitutes Phigh for the plateau and Phigh − Plow for ΔP in APRV** (D-024, labelled "Phigh"
  and "Phigh − Plow" so the reader is not misled into thinking a hold was taken), because no inspiratory
  hold exists in the mode.
- **`aprv-tlow-too-long` teaches derecruitment on `ards-extrapulmonary`, not `ards-pulmonary`** (D-024):
  `ards-pulmonary`'s recruitable population opens on the recoil axis at `RECRUIT_PULMONARY_TOP` (34 ± 3
  cmH2O), 2–4 cmH2O above what a protective Phigh 28 reaches anywhere in the authorized `tlow`/`thigh`
  range (measured non-dependent/dependent plateaus ≈ 24.6/26.7 cmH2O on the recoil axis, against a ≈ 28.8
  cmH2O requirement for even the lowest-quantile recruitable unit), so `tidal-recruitment` measured 0
  throughout that phenotype's authorized space; extrapulmonary ARDS is the recruitable form at a protective
  pressure, which is also the clinical teaching.
- **`aprv-release-collision` and `aprv-high-effort` both need the drive treated, not just Thigh/Tlow**
  (D-024): in an unsynchronized mode the collision probability per release is ≈ (Ti − 0.1)/period
  regardless of Thigh, so lengthening Thigh alone left `aprv-release-collision` at 33 % after-fix AI; only
  adding a gentler drive (rate 14, Pmax 6) cleared it to 0 %. `aprv-high-effort`'s own scripted fix produces
  the same mechanism against itself and ships as rate 14 / Pmax 8 / Thigh 8.0 s — the mildest combination
  that clears both the AI gate and the scenario's own quiz extras (ΔPL ≤ 15, ΔPes ≤ 10) together.

## Detector (what the bedside signals cannot show)

- **Flow starvation on very short VC breaths inside a rising effort is invisible** (D-012). A 0.3–0.4 s
  insufflation that starts when Pmus is still accelerating produces a nearly linear Paw ramp (mid-ramp
  convexity ≈ 0.2 cmH2O) that is indistinguishable from a stiff passive lung without a passive reference
  breath. The truth still labels it (PTP rule); the score excludes both members of a double-trigger pair and
  the limitation is listed in `docs/QUESTIONS.md`.
- **The ramp-shape rules cannot separate flow starvation from overdistension, nor a relaxing effort from
  tidal recruitment.** A convex VC ramp is read as flow starvation only on patient-triggered breaths, and a
  concave-down ramp as delayed cycling only on patient-triggered breaths; a passive stress index (M7) is
  computed on machine-triggered breaths. A triggering patient with an overdistended or recruitable lung will
  be over-called.
- **The Paw deflection of an expiratory ineffective effort is ≈ 0.2 cmH2O** through the modelled active
  exhalation valve, so Chen 2008's Pdef 0.45 criterion is not usable; the detector relies on the flow
  deflection (D-012).
- **Delayed cycling in COPD on PSV is read from the flow-decay knee**, which needs the effort to relax at
  least 0.1 s before cycle-off; breaths whose cycle-off coincides with the end of relaxation are missed.
- **Delayed cycling of a late-triggered VC breath** (the breath begins 0.6–0.8 s into a 0.9 s effort and
  outlasts it) is read from a concave-down Paw ramp; when the Pmus peak falls inside the insufflation the
  ramp is convex instead and the breath is called flow starvation. Held-out sensitivity for delayed
  cycling is 0.84 against the 0.85 target for this reason (D-012).
- **Delayed trigger** (non-core) is under-detected: the effort onset is inferred from the Paw dip or the
  expiratory flow deflection that becomes the trigger, both of which start later than the neural onset.
- **Auto-PEEP, low compliance and delayed trigger** are outside the §9.5 targets and are reported with their
  measured scores on the Validation page only.
