# Questions for the clinical owner

Genuinely clinical decisions the briefs do not settle. Each has the default we built around, so nothing
blocks on an answer. Newest last.

## Q-1 · Should flow starvation on very short VC breaths count as bedside-detectable? (2026-09-11, D-012)

In the double-trigger scenario every 0.38 s VC breath begins while the effort is still accelerating. The
truth labels it flow starvation (Pmus PTP ≥ 1 cmH2O·s during the insufflation), but the Paw ramp is nearly
linear (mid-ramp convexity ≈ 0.2 cmH2O versus ≥ 0.9 for the flow-starvation scenario) and no passive breath
exists for comparison. **Default:** the truth keeps the PTP rule (it is what the explain card should teach),
the detector labels the pair as double trigger, and the §9.5 flow-starvation score excludes both members of a
double-trigger pair. Alternative: define flow starvation only where the scooped ramp is visible (drop the
truth label on breaths shorter than 0.5 s).

## Q-2 · Is COPD on PSV with ETS 35 % "delayed cycling" when the neural Ti happens to be long? (2026-09-11)

The truth uses van Diepen's margin (cycle delay > 0.3 s after the neural end). In the COPD scenario every
breath qualifies once the trigger delay (≈ 0.3 s) is added to the slow inspiratory tail, including breaths
whose machine Ti (0.9 s) is about equal to the neural Ti. **Default:** keep the margin; the detector reads the
relaxation knee of the flow decay and the trigger delay. Alternative: judge delayed cycling on machine Ti
minus neural Ti only (ignore the trigger delay), which would relabel about a third of those breaths.

## Q-3 · Is an effort met by a coincident time-triggered breath "assisted"? (2026-09-11, D-012)

In PC-AC at a set rate close to the patient's, an effort sometimes begins within 60 ms of a time-triggered
breath. **Default:** the effort is assisted (not ineffective, not a reverse trigger), and the breath is a
delayed trigger when it started more than 0.25 s after the effort onset. Alternative: count it as
ineffective (the patient did not trigger) and as a synchrony failure in the asynchrony index.

## Owner decisions (2026-09-11)

Q-1, Q-2 and Q-3: **keep the defaults** (owner decision). The truth rules, the detector, the scoring domain
and the test floors stay as documented in D-011, D-012 and LIMITATIONS.md; do not reopen these without a
new clinical reason.

## Q-4 · Should the "recruiter" read R/I ≥ 0.5 even if that means leaving Gattinoni's extrapulmonary numbers? (2026-09-11, D-014)

With the extrapulmonary preset anchored to Gattinoni 1998 (Ecw 12.1, Ppl0 12, 0.22–0.3 L recruited from PEEP 0
to 15) the single-breath R/I reads 0.15–0.3, and the recruiter scenario (recruitable fraction 0.4, Ecw 8, Ppl0 8)
reads 0.35–0.4. The model's reasons are physical (the recruited gas deflates the chest wall on release, and the
low-PEEP tidal breath re-recruits part of it), and Chen's cohort median was 0.5 with a wide range. **Default:**
keep the anchors; the dashboard labels ≥ 0.5 "recruiter" (Chen's cutoff) and the scenario text explains why the
number is smaller than the recruited volume the truth layer shows. Alternative: give the recruiter scenario a
larger recruitable population (0.5–0.6, i.e. > 0.7 L of collapsed lung) or a normal chest wall (Ecw 5) so the
bedside number crosses 0.5.

## Q-5 · How strong should the CO2 → drive response be at the bedside? (2026-09-11, D-014)

The brief gives a normal ventilatory response of 1–3 L/min/mmHg. The loop uses ≈ 0.5 (Pmax +6 %/mmHg, rate
+3 %/mmHg) because the warp multiplies the breath-by-breath lag of the response and larger gains make the
warped loop oscillate between apnea and hyperpnoea in the under-assist scenario. **Default:** the low gain
with warp ×10 in the two CO2 scenarios. Alternative: a gain in the brief's range with the warp capped at ×5, or
a gain that the instructor sets per scenario (the `gas` block already accepts `gainPmax`/`gainRate`).
