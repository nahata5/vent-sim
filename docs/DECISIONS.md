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
