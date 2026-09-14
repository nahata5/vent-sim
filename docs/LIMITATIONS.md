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
