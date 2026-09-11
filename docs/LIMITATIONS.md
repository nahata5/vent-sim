# Known limitations

What is schematic, what the bedside view cannot see, and where the model stops. Grouped by area; each
entry names the decision or milestone that introduced it. Newest additions last within a group.

## Physiology model

- **Hyperinflation-related muscle weakness is not modelled** (D-007): the force–velocity penalty acts on
  flow only, so a COPD patient at high lung volume generates the same isometric Pmus as at FRC.
- **In injured lungs a well-placed esophageal balloon reads an occlusion-test ratio above 1** by design
  (regional transmission α_D = 1.35, D-007); this is a teaching point, not a calibration error.
- **Cardiac oscillation is a single sinusoid at a fixed heart rate** (M6 injector); there is no heart-rate
  variability and no respiratory sinus arrhythmia.
- **SpO2 and CO2 are schematic** until M7 (CO2 loop) and remain a single-compartment gas exchange model
  afterwards; there is no shunt/dead-space heterogeneity by region.

## Ventilator model

- **Generic ICU ventilator.** Trigger, cycling, servo and alarm behaviour follow Brief 1's ranges, not any
  vendor's firmware; vendor-specific features (leak-adapted triggers, automatic tube compensation, NAVA/PAV)
  are absent.
- **Expiratory holds abort on the first effort** (D-009) and report the pre-effort plateau, so a patient with
  a very high rate may never yield a total-PEEP reading.

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
