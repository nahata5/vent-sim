/**
 * Explain cards (Spec §8): one card per pattern — definition, mechanism, signature, causes, ranked fixes,
 * pitfalls, citations — from Brief 1 §3 and Brief 2, plus templated case-specific evidence built from the
 * truth labels (`BreathLabel.evidence`, neural timing, settings). Plain string templates, no LLM.
 */
import { k } from '../../config/constants';
import type { BreathLabel, EffortLabel, PatternId } from '../../sim/truth/labeler';
import type { NeuralBreath } from '../../sim/patient/neural-drive';
import type { VentSettings } from '../../sim/vent/settings';

export interface ExplainCard {
  id: PatternId;
  title: string;
  definition: string;
  mechanism: string;
  signature: string;
  causes: string[];
  /** Ranked, first is the usual first move. */
  fixes: string[];
  pitfalls: string[];
  citations: string[];
}

const B1 = 'Brief 1 §3';
const CHEN = 'Chen 2008, doi.org/10.1097/01.CCM.0000299734.34469.D9';
const THILLE = 'Thille 2006, doi.org/10.1007/s00134-006-0301-8';
const TASSAUX = 'Tassaux 2005, doi.org/10.1164/rccm.200407-880OC';
const MOJOLI = 'Mojoli 2022, doi.org/10.1186/s13054-022-03895-4';
const IMANAKA = 'Imanaka 2000, doi.org/10.1097/00003246-200002000-00019';
const POHLMAN = 'Pohlman 2008, doi.org/10.1097/CCM.0b013e31818b308b';
const BEITLER = 'Beitler 2016 (BREATHE), doi.org/10.1007/s00134-016-4423-3';
const AKOUMIANAKI = 'Akoumianaki 2013, doi.org/10.1378/chest.12-1817';
const BAEDORF = 'Baedorf-Kassis 2023, doi.org/10.1016/j.jcrc.2023.154256';
const GHOLAMI = 'Gholami 2018, doi.org/10.1016/j.compbiomed.2018.04.016';
const SOTTILE = 'Sottile 2018, doi.org/10.1097/CCM.0000000000002849';
const YOSHIDA = 'Yoshida 2013 (pendelluft), Brief 2 §4';
const GOLIGHER = 'Goligher 2020 (effort targets), Brief 2 §3/§6';
const GRASSO = 'Grasso 2004 (stress index), Brief 2 §2.3';

export const CARDS: Record<PatternId, ExplainCard> = {
  'ineffective-effort': {
    id: 'ineffective-effort',
    title: 'Ineffective effort',
    definition: 'An inspiratory effort that does not trigger a breath. Most happen during expiration (ineffective expiratory efforts); some fall inside a machine insufflation.',
    mechanism: 'With intrinsic PEEP the muscles must first cancel E·V_ee − PEEP before airway flow can reverse, so a weak effort never reaches the trigger; a low drive, an insensitive trigger, an effort inside the refractory period or over-assist (high PS or Vt, long Ti) do the rest.',
    signature: 'Expiratory flow bends toward zero (a bump) with a small Paw dip and no breath follows; during inspiration a hump on the decaying PSV flow; a small inflection on the volume trace.',
    causes: ['Intrinsic PEEP (COPD, short Te)', 'Over-assist: high PS, high Vt, long Ti', 'Weak effort, low drive, deep sedation, hypocapnia', 'Insensitive trigger or effort inside the refractory period', 'SIMV with a low mandatory rate and low PS: the spontaneous breaths carry the work against intrinsic PEEP'],
    fixes: ['Reduce PS or Vt', 'Shorten Ti: raise ETS in PSV (Tassaux: 70 % vs 10 % cut non-triggered breaths from 9 to 2/min)', 'Add external PEEP up to 70–85 % of PEEPi in flow-limited COPD', 'Increase trigger sensitivity', 'Lower RR or Vt to shorten the trapped volume; reduce sedation'],
    pitfalls: ['The Paw dip through an active exhalation valve is tiny (≈ 0.2 cmH2O); read the flow trace', 'Clinicians see only ≈ 22 % of asynchronies by eye (Colombo 2011)', 'More than 30 ineffective efforts in 3 min (Vaporidi) is a cluster that predicts mortality'],
    citations: [`${B1}.1`, CHEN, TASSAUX, THILLE],
  },
  'auto-trigger': {
    id: 'auto-trigger',
    title: 'Auto-trigger',
    definition: 'A triggered breath with no patient effort.',
    mechanism: 'Something other than the muscles pushes the measured flow past the trigger threshold: a leak makes the baseline flow look like demand, cardiac oscillations transmit through a low-resistance lung, water sloshes in the tubing, or the threshold is simply too sensitive.',
    signature: 'A breath with no preceding Paw dip or flow reversal; timing locked to the heart rate or occurring when expiratory flow reaches zero; a rate above the set rate; respiratory alkalosis through the CO2 loop.',
    causes: ['Circuit or cuff leak', 'Cardiogenic oscillation (large heart, low resistance)', 'Water in the circuit', 'Trigger set at 0.5–1 L/min'],
    fixes: ['Raise the flow-trigger threshold or switch to pressure triggering', 'Fix the leak or enable leak compensation', 'Drain the circuit'],
    pitfalls: ['A weak effort can look like an auto-trigger from the airway signals alone; Pes or Pmus settles it', 'Imanaka: auto-triggering patients had a cardiogenic flow fluctuation of 4.7 ± 1.3 L/min'],
    citations: [`${B1}.2`, IMANAKA],
  },
  'delayed-trigger': {
    id: 'delayed-trigger',
    title: 'Delayed trigger',
    definition: 'Trigger delay (neural onset to pressurization) longer than 250 ms; the bench norm is 40–90 ms.',
    mechanism: 'Intrinsic PEEP, a weak effort or an insensitive trigger keep the effort below threshold for a while; the patient works in isometric conditions until the valve opens.',
    signature: 'A deeper and longer negative Paw dip before the rise (a larger trigger pressure–time product) and a slow initial flow; a Pes or Pmus overlay shows the effort starting much earlier.',
    causes: ['Intrinsic PEEP', 'Weak effort', 'Insensitive trigger', 'Slow valve response'],
    fixes: ['Same as ineffective effort: external PEEP against PEEPi, more sensitive trigger, less assist', 'Shorten Te (lower RR, shorter Ti) to reduce trapping'],
    pitfalls: ['The onset visible on Paw and flow is later than the neural onset, so the bedside always under-reads the delay'],
    citations: [`${B1}.3`, MOJOLI],
  },
  'double-trigger': {
    id: 'double-trigger',
    title: 'Double trigger / breath stacking',
    definition: 'Two cycles separated by an expiratory time shorter than half the mean inspiratory time, the first one patient-triggered (Thille). When the second breath arrives before the first is exhaled the volumes add: breath stacking.',
    mechanism: 'Neural Ti outlasts the ventilator Ti. Pmus is still active after cycling and pulls flow or Paw past the trigger threshold again; a short set Ti, a high flow, a low Vt with a high drive, or premature cycling in PSV set it up.',
    signature: 'Two back-to-back inspirations; the first expiration truncated before baseline; a staircase volume trace; Vte of the first breath much smaller than its Vti; a higher Ppeak on the second breath.',
    causes: ['VC with a short Ti or a high flow', 'Low set Vt with a high drive (ARDS, 6 mL/kg)', 'Premature cycling in PSV (high ETS, low τ)', 'SIMV: a supported breath cycles early and the continuing effort re-triggers; the mandatory clock can add a breath on top of it'],
    fixes: ['Lengthen the ventilator Ti (lower flow, add a pause)', 'Raise Vt if Pplat and ΔP allow', 'Switch to PC or PSV; lower ETS in PSV', 'Treat the drive (analgesia, sedation); neuromuscular blockade in severe ARDS'],
    pitfalls: ['Stacked breaths reach 10–11 mL/kg PBW (1.6× the set Vt) even under deep sedation (Pohlman, BREATHE)', 'A reverse-triggered breath can also stack; check whether the first breath was machine-triggered'],
    citations: [`${B1}.4`, THILLE, POHLMAN, BEITLER, SOTTILE],
  },
  'reverse-trigger': {
    id: 'reverse-trigger',
    title: 'Reverse trigger (entrainment)',
    definition: 'A ventilator-initiated insufflation that elicits a diaphragm contraction with a stable phase relationship (ratios 1:1, 1:2, 1:3; frequency CV < 5 %).',
    mechanism: 'Under deep sedation in a controlled mode the respiratory oscillator phase-locks to the lung inflation; the effort starts 0.2–0.8 s after the machine breath.',
    signature: 'VC: a Paw dip in mid-to-late inspiration or during the pause (a falsely low plateau and ΔP), blunted or reversed early-expiratory flow, sometimes a second breath (stacking). PC: a mid-to-late inspiratory flow hump and a Vt above the passive value.',
    causes: ['Deep sedation with a controlled mode', 'Set rate close to the intrinsic rate'],
    fixes: ['Change the set rate up or down to break the lock', 'Lighten sedation so efforts trigger', 'Switch to PSV', 'Neuromuscular blockade as a last resort'],
    pitfalls: ['The effort hides the real plateau; a hold during a reverse trigger under-reads Pplat', 'Baedorf-Kassis phenotypes: early with early or delayed relaxation, mid-cycle, late, with stacking'],
    citations: [`${B1}.5`, AKOUMIANAKI, BAEDORF],
  },
  'premature-cycling': {
    id: 'premature-cycling',
    title: 'Premature (short) cycling',
    definition: 'The ventilator cycles off before neural inspiration ends (cycling delay < −100 ms, van Diepen).',
    mechanism: 'In PSV a low τ (ARDS, fibrosis) makes the flow decay to the cycle-off fraction quickly, or the ETS is set too high; in VC or PC the set Ti is shorter than the neural Ti.',
    signature: 'Early-expiratory flow abruptly attenuated or notched, sometimes returning toward zero or positive (the effort goes on); Paw dips below PEEP just after cycling; often followed by a double trigger; a short Ti and a small Vt.',
    causes: ['High ETS with a fast lung', 'Set Ti below the neural Ti', 'Strong, long efforts'],
    fixes: ['Lower ETS (25 % → 10–15 %)', 'Increase PS or Ti', 'Lengthen the rise time in some cases'],
    pitfalls: ['Premature cycling and double triggering usually come together; fixing the cycling fixes the stacking'],
    citations: [`${B1}.6`, GHOLAMI, MOJOLI],
  },
  'delayed-cycling': {
    id: 'delayed-cycling',
    title: 'Delayed (prolonged) cycling',
    definition: 'Ventilator inspiration continues more than 300 ms after neural inspiration ends (van Diepen); Thille calls a Ti above twice the mean prolonged.',
    mechanism: 'A high τ (COPD) makes the flow decay slowly to the cycle-off fraction, a high PS or a low ETS delays it further, a leak keeps the flow above ETS until Ti max. The patient relaxes or pushes against a closed circuit, gas is trapped and the next efforts fail.',
    signature: 'End-inspiratory Paw rise above the set level as the patient pushes; a flow shoulder (an abrupt change of slope) before cycling; a prolonged Ti; rising PEEPi followed by ineffective efforts.',
    causes: ['COPD (long τ)', 'High PS', 'Low ETS', 'Leak', 'Long set Ti'],
    fixes: ['Raise ETS to 40–70 % in obstructive disease (Tassaux: cycling delay 1.26 → 0.25 s, PEEPi 6.5 → 4.8)', 'Lower PS', 'Shorter Ti or Ti max', 'Fix the leak'],
    pitfalls: ['The trigger delay adds to the cycling delay in COPD, so breaths whose machine Ti equals the neural Ti still qualify (Q-2)'],
    citations: [`${B1}.7`, TASSAUX, GHOLAMI],
  },
  'flow-starvation': {
    id: 'flow-starvation',
    title: 'Flow starvation',
    definition: 'In volume control the fixed inspiratory flow is lower than the patient\'s demand.',
    mechanism: 'Paw = E·V + R·Q − Pmus with Q fixed, so every cmH2O of effort comes straight out of the airway pressure while the lung sees the same flow.',
    signature: 'A concave, scooped Paw ramp instead of the passive linear or convex rise; Paw may fall below PEEP; Ppeak falls and the displayed dynamic compliance looks falsely good.',
    causes: ['VC with a peak flow of 30–45 L/min', 'High drive (Pmax 10–20)', 'SIMV: mandatory VC breaths at a fixed flow while the PS breaths get what the patient asks for'],
    fixes: ['Raise the peak flow (60–80 L/min or more)', 'Shorten Ti', 'Switch to PC, PSV or a variable-flow VC', 'Treat the drive'],
    pitfalls: ['A higher flow shortens Ti and can trade flow starvation for premature cycling and double triggering', 'The Pmus-time product during the insufflation is what the truth measures; the bedside sees only the scooped ramp'],
    citations: [`${B1}.8`, SOTTILE],
  },
  'support-withdrawal': {
    id: 'support-withdrawal',
    title: 'Support withdrawal (PRVC)',
    definition: 'In pressure-regulated volume control the ventilator lowers its pressure breath by breath because the delivered volume exceeded the target — while the patient, not the ventilator, is producing that volume.',
    mechanism: 'The regulator only sees volume. A strong effort adds volume, the regulator reads "too much" and cuts pressure by up to 3 cmH2O a breath down to its floor; the patient now does most of the work, drive rises further, and the numbers on the screen (low pressure, target volume) look reassuring.',
    signature: 'Inspiratory pressure stepping down breath by breath toward PEEP + floor while the volume stays at target; a growing Paw sag below the set pressure early in inspiration; with a balloon, a growing ΔPes and ΔPL,dyn.',
    causes: ['Strong drive in PRVC (pain, hypercapnia, acidosis, agitation)', 'A volume target set low for the demand'],
    fixes: ['Switch to a fixed-pressure mode (PC-AC or PSV) and set the pressure to the demand', 'Raise the volume target if the driving pressure allows', 'Treat the drive: analgesia, sedation, correct the acidosis'],
    pitfalls: ['A low driving pressure in PRVC is not reassurance when the patient is doing the work', 'The alarm you get is none: the ventilator is meeting its target'],
    citations: ['Brief 1 §2.5', 'Spec 2026-09-14 §3.4'],
  },
  overshoot: {
    id: 'overshoot',
    title: 'Pressure overshoot / excess flow',
    definition: 'Paw exceeds the pressure target by more than 3 cmH2O in the first 200 ms of a pressure-targeted breath.',
    mechanism: 'A too-short rise time drives the servo into the lung faster than the resistance lets the gas move, so the pressure rings above target and the flow spikes.',
    signature: 'An initial Paw spike or ringing above the plateau and a flow spike; in VC an excessive flow shortens Ti and invites double triggering.',
    causes: ['Rise time too short', 'Excessive peak flow'],
    fixes: ['Lengthen the rise time', 'Reduce the peak flow'],
    pitfalls: ['A pressure overshoot can also cycle a PSV breath off through the pressure-safety rule'],
    citations: [`${B1}.9`],
  },
  'auto-peep': {
    id: 'auto-peep',
    title: 'Auto-PEEP / dynamic hyperinflation',
    definition: 'True end-expiratory alveolar pressure above the set PEEP by more than 1 cmH2O: the lung does not return to its relaxation volume before the next breath.',
    mechanism: 'Te shorter than 3–5 expiratory time constants (high resistance, high rate, long Ti) traps volume; the trapped gas holds an elastic pressure that every effort must first overcome.',
    signature: 'Expiratory flow does not reach zero before the next breath; Vte transiently below Vti while EELV climbs; rising Ppeak and Pplat; ineffective efforts in a breathing patient; an expiratory hold shows PEEPtot above PEEP.',
    causes: ['COPD or asthma (long τ, flow limitation)', 'High RR or long Ti', 'High Vt'],
    fixes: ['Lower RR', 'Lower Vt', 'Raise the inspiratory flow to shorten Ti', 'Bronchodilator; external PEEP to counterbalance in flow-limited COPD'],
    pitfalls: ['Only an expiratory hold measures it; the end-expiratory flow tells you it is there', 'Expiratory muscle activity across the hold under-reads it'],
    citations: [`${B1}.10`],
  },
  leak: {
    id: 'leak',
    title: 'Leak',
    definition: 'More than 10 % of the inspired volume escapes before it is exhaled through the ventilator.',
    mechanism: 'An orifice at the cuff or circuit lets flow out in proportion to the square root of the airway pressure, in both phases.',
    signature: 'Vte below Vti; the volume trace never returns to zero and steps down; open P–V and F–V loops; in PSV a prolonged inspiration (flow never reaches ETS); an expiratory baseline offset that auto-triggers.',
    causes: ['Cuff leak', 'Circuit disconnection or a cracked connector', 'Non-invasive interface'],
    fixes: ['Fix the leak (cuff pressure, connectors)', 'Enable leak compensation', 'Cycle by time (Ti max) meanwhile'],
    pitfalls: ['An incompletely exhaled breath (hyperinflation) also gives Vte < Vti without any leak'],
    citations: [`${B1}.11`],
  },
  secretions: {
    id: 'secretions',
    title: 'Secretions',
    definition: 'Airway secretions modulate the resistance at 5–20 Hz.',
    mechanism: 'Mucus oscillating in the airway lumen makes the resistance flutter, which appears as a sawtooth on the expiratory flow.',
    signature: 'Irregular sawtooth oscillations on expiratory flow and on the F–V loop.',
    causes: ['Retained secretions'],
    fixes: ['Suction'],
    pitfalls: ['The sawtooth can hide small ineffective-effort notches; the detector suppresses the effort rule under it'],
    citations: [`${B1}.12`],
  },
  water: {
    id: 'water',
    title: 'Water in the circuit',
    definition: 'Condensate sloshing in the tubing.',
    mechanism: 'A regular oscillation of the circuit resistance at a few hertz.',
    signature: 'A regular oscillation on flow, more regular than secretions; can auto-trigger.',
    causes: ['Condensate in the tubing'],
    fixes: ['Drain the circuit'],
    pitfalls: ['Looks like a cardiac oscillation at a similar frequency'],
    citations: [`${B1}.12`],
  },
  'high-resistance': {
    id: 'high-resistance',
    title: 'High resistance',
    definition: 'Total inspiratory resistance at or above 25 cmH2O/(L/s): bronchospasm, a kinked or bitten tube, asthma.',
    mechanism: 'The resistive pressure drop R·Q grows while the elastic pressure is unchanged.',
    signature: 'Ppeak rises with an unchanged plateau (Ppeak − Pplat > 10 cmH2O at 60 L/min square flow); a prolonged expiratory flow; rising PEEPi.',
    causes: ['Bronchospasm', 'Tube kink or biting', 'Secretions'],
    fixes: ['Bronchodilator', 'Check the tube', 'Lower the flow to reduce Ppeak while the cause is treated'],
    pitfalls: ['In PC the plateau is reached later, so Vt falls at the same ΔP'],
    citations: [`${B1}.12`],
  },
  'low-compliance': {
    id: 'low-compliance',
    title: 'Low compliance',
    definition: 'Static respiratory-system compliance below 30 mL/cmH2O, or a lung elastance step of 30 % or more above the scenario baseline (pneumothorax, mainstem intubation).',
    mechanism: 'A stiffer lung or chest wall needs more pressure per millilitre; a one-lung ventilation halves the compliance abruptly.',
    signature: 'Ppeak and Pplat both rise, ΔP rises, Cstat falls; in PC the Vt falls at the same ΔP.',
    causes: ['Pneumothorax (abrupt)', 'Mainstem intubation', 'Abdominal hypertension', 'Fibrosis, ARDS'],
    fixes: ['Treat the cause (drain, pull the tube back)', 'Reduce Vt to keep ΔP ≤ 15'],
    pitfalls: ['A stiff chest wall raises Pplat without raising the transpulmonary pressure; Pes tells the two apart'],
    citations: [`${B1}.12`, 'Brief 2 §1'],
  },
  cough: {
    id: 'cough',
    title: 'Cough',
    definition: 'A brief, large expiratory muscle burst during an insufflation.',
    mechanism: 'The expiratory muscles drive alveolar pressure far above the airway target; the pressure alarm cycles the breath.',
    signature: 'A Paw spike with a high-pressure alarm and an aborted breath.',
    causes: ['Airway irritation, secretions, light sedation'],
    fixes: ['None needed for the cough itself; suction if secretions are the cause'],
    pitfalls: ['Cough artefacts corrupt breath metrics; detection code should skip them'],
    citations: [`${B1}.12`],
  },
  pendelluft: {
    id: 'pendelluft',
    title: 'Pendelluft',
    definition: 'Gas moving from one lung region to another within a breath (≥ 10 mL), typically from the non-dependent to the dependent region during a strong effort.',
    mechanism: 'The diaphragm lowers the dependent pleural pressure more than the non-dependent (regional transmission), so the dependent region inflates at the expense of the non-dependent even before the ventilator delivers flow.',
    signature: 'Truth only: opposite compartment flows at the same instant; the dependent PL swing exceeds the airway ΔP.',
    causes: ['Strong effort in injured lungs (ARDS on PSV)'],
    fixes: ['Reduce the effort: more assist, sedation, or PEEP to homogenise the lung', 'Neuromuscular blockade in severe ARDS'],
    pitfalls: ['The airway pressure and volume look normal; only Pes or imaging show it'],
    citations: [YOSHIDA],
  },
  overdistension: {
    id: 'overdistension',
    title: 'Overdistension',
    definition: 'End-inspiratory transpulmonary pressure above 20 cmH2O in at least one region.',
    mechanism: 'The open units are stretched beyond their linear range; the elastance rises within the breath.',
    signature: 'Truth only for the regional value; at the bedside a stress index above 1.1 on constant-flow breaths and a rising Pplat.',
    causes: ['High Vt or PEEP', 'A small baby lung (consolidated ARDS)'],
    fixes: ['Lower Vt or PEEP', 'Accept a lower PaO2 or a higher PaCO2'],
    pitfalls: ['A high Pplat with a stiff chest wall is not overdistension: check PL'],
    citations: ['Brief 2 §3/§6 (EPVent, Protti 2011)', GRASSO],
  },
  'tidal-recruitment': {
    id: 'tidal-recruitment',
    title: 'Tidal recruitment',
    definition: 'Lung units that open during the insufflation and close again by the end of the breath.',
    mechanism: 'With PEEP below their closing pressure and a plateau above their opening pressure, recruitable units cycle every breath (atelectrauma).',
    signature: 'Truth only for the count; at the bedside a stress index below 0.9 on constant-flow breaths, a lower inflection on the P–V loop, and a compliance that improves with PEEP in a decremental trial.',
    causes: ['PEEP below the closing pressures', 'Large tidal swings in a recruitable lung'],
    fixes: ['Raise PEEP (decremental trial to the best-compliance PEEP)', 'Lower Vt'],
    pitfalls: ['The stress index needs a passive constant-flow breath; effort invalidates it'],
    citations: [GRASSO, 'Brief 2 §2.2/§2.4 (Chen 2020)'],
  },
  'high-effort': {
    id: 'high-effort',
    title: 'High effort',
    definition: 'Peak muscle pressure above 10 cmH2O on an assisted breath.',
    mechanism: 'A high drive (hypercapnia, pain, anxiety, under-assist) makes each breath a large pleural swing: a high dynamic transpulmonary pressure and a risk of self-inflicted lung injury.',
    signature: 'Truth only for Pmus; at the bedside ΔPes > 8–12, P0.1 > 3.5, ΔPocc more negative than −15, PMI > 6.',
    causes: ['Under-assist', 'Hypercapnia', 'Pain, agitation'],
    fixes: ['Raise the assist (PS, Vt)', 'Treat the cause of the drive', 'Sedation'],
    pitfalls: ['A normal ΔP with a high ΔPL,dyn is the signature: airway numbers alone miss it'],
    citations: [GOLIGHER, 'Brief 2 §4 (Bertoni 2019, Telias 2020)'],
  },
  'low-effort': {
    id: 'low-effort',
    title: 'Low effort',
    definition: 'Peak muscle pressure below 5 cmH2O on an assisted breath.',
    mechanism: 'Over-assist, hypocapnia or sedation lowers the drive; the diaphragm does little work and atrophies.',
    signature: 'Truth only for Pmus; at the bedside ΔPes < 2–3, P0.1 ≤ 1, PMI near zero, and ineffective efforts when PEEPi is present.',
    causes: ['Over-assist', 'Hypocapnia (CO2 loop)', 'Sedation'],
    fixes: ['Lower the assist (PS, Vt)', 'Reduce sedation'],
    pitfalls: ['Weak efforts look like auto-triggers on the airway signals'],
    citations: [GOLIGHER],
  },
};

export interface EvidenceContext {
  label: BreathLabel;
  neural: NeuralBreath | null;
  settings: VentSettings;
  pbw: number;
}

const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);

function timing(ctx: EvidenceContext): string {
  const ev = ctx.label.evidence;
  const parts: string[] = [];
  if (ev.neuralTi !== undefined && ev.ventTi !== undefined) parts.push(`neural Ti ${f2(ev.neuralTi)} s vs ventilator Ti ${f2(ev.ventTi)} s`);
  if (ctx.label.cycleDelay !== null && ctx.label.cycleDelay !== undefined) parts.push(`cycling ${ctx.label.cycleDelay >= 0 ? 'delay' : 'lead'} ${f2(Math.abs(ctx.label.cycleDelay))} s`);
  if (ctx.label.triggerDelay !== null && ctx.label.triggerDelay !== undefined) parts.push(`trigger delay ${(ctx.label.triggerDelay * 1000).toFixed(0)} ms`);
  return parts.join(', ');
}

/** Case-specific sentences for each pattern on a breath label (empty for a synchronous breath). */
export function caseEvidence(ctx: EvidenceContext): string[] {
  const { label, settings, pbw } = ctx;
  const ev = label.evidence;
  const out: string[] = [];
  const t = timing(ctx);
  for (const p of label.patterns) {
    switch (p) {
      case 'delayed-cycling':
      case 'premature-cycling':
        out.push(`${t}${ev.pmusPeak !== undefined ? `; peak Pmus ${f1(ev.pmusPeak)} cmH2O` : ''} (limit ${p === 'delayed-cycling' ? `+${k('LABEL_LATE_CYCLING')}` : k('LABEL_EARLY_CYCLING')} s).`);
        break;
      case 'delayed-trigger':
        out.push(`The effort began ${((label.triggerDelay ?? 0) * 1000).toFixed(0)} ms before the trigger (limit ${k('LABEL_TRIGGER_DELAY') * 1000} ms)${ev.palvEE !== undefined ? `; end-expiratory alveolar pressure ${f1(ev.palvEE)} vs PEEP ${settings.peep}` : ''}.`);
        break;
      case 'double-trigger': {
        const stacked = ev.stackedVt !== undefined ? (ev.stackedVt * 1000) / pbw : null;
        const setVt = settings.mode === 'VC-AC' ? settings.vt / pbw : null;
        out.push(`Second breath on the same effort${ev.firstBreath !== undefined ? ` (first breath #${ev.firstBreath})` : ''}${stacked !== null ? `; stacked volume ${f1(stacked)} mL/kg${setVt !== null ? ` vs set ${f1(setVt)} mL/kg` : ''}` : ''}${t ? `; ${t}` : ''}.`);
        break;
      }
      case 'reverse-trigger':
        out.push(`Machine breath at ${f1(label.tStart)} s, effort ${ev.reverseDelay !== undefined ? `${f2(ev.reverseDelay)} s later` : 'after it'}, phase-locked${ev.pmusPeak !== undefined ? `; peak Pmus ${f1(ev.pmusPeak)} cmH2O` : ''}.`);
        break;
      case 'flow-starvation':
        out.push(`Effort during the insufflation: Pmus–time product ${f2(ev.ptpInsp ?? 0)} cmH2O·s (limit ${k('LABEL_FLOW_STARVATION_PTP')}), peak Pmus ${f1(ev.pmusPeak ?? 0)} cmH2O${ev.pmusRiseInsp !== undefined ? `, still rising by ${f1(ev.pmusRiseInsp)} cmH2O after the breath began` : ''}; set flow ${settings.peakFlow} L/min.`);
        break;
      case 'support-withdrawal':
        out.push(`Regulated pressure ${f1(settings.peep + (ev.dpAboveFloor ?? 0) + settings.prvcMinDp)} cmH2O, ΔP ${f1((ev.dpAboveFloor ?? 0) + settings.prvcMinDp)} above PEEP — ${f1(ev.dpAboveFloor ?? 0)} above the floor of ${settings.prvcMinDp} (within ${k('LABEL_SUPPORT_WITHDRAWAL_MARGIN')}), while peak Pmus is ${f1(ev.pmusPeak ?? 0)} cmH2O (≥ ${k('PMUS_HIGH')}).`);
        break;
      case 'overshoot':
        out.push(`Paw ${f1(ev.overshoot ?? 0)} cmH2O above the target in the first ${k('LABEL_OVERSHOOT_WINDOW') * 1000} ms (limit ${k('LABEL_OVERSHOOT_MARGIN')}); rise time ${settings.riseTime} s.`);
        break;
      case 'auto-peep':
        out.push(`End-expiratory alveolar pressure ${f1(ev.palvEE ?? 0)} cmH2O vs set PEEP ${settings.peep} (auto-PEEP ${f1((ev.palvEE ?? 0) - settings.peep)}).`);
        break;
      case 'leak':
        out.push(`Leak ${((ev.leakFraction ?? 0) * 100).toFixed(0)} % of the inspired volume (limit ${k('LABEL_LEAK_FRACTION') * 100} %).`);
        break;
      case 'high-resistance':
        out.push(`Total inspiratory resistance ${f1(ev.rTotal ?? 0)} cmH2O/(L/s) (limit ${k('LABEL_HIGH_R')}).`);
        break;
      case 'low-compliance':
        out.push(`Static compliance ${f1(ev.crs ?? 0)} mL/cmH2O (limit ${k('LABEL_LOW_C')}) or a lung elastance step of ≥ ${k('LABEL_E_SCALE')}×.`);
        break;
      case 'cough':
        out.push(`Expiratory muscle burst of ${f1(-(ev.coughPmus ?? 0))} cmH2O during the breath.`);
        break;
      case 'pendelluft':
        out.push(`${((ev.pendelluftVol ?? 0) * 1000).toFixed(0)} mL moved between the regions within the breath (limit ${k('LABEL_PENDELLUFT_VOL') * 1000} mL).`);
        break;
      case 'overdistension':
        out.push(`End-inspiratory transpulmonary pressure ${f1(ev.plEI ?? 0)} cmH2O (limit ${k('PL_EI_WARN')}).`);
        break;
      case 'tidal-recruitment':
        out.push(`${ev.tidalRecruitUnits ?? 0} unit${(ev.tidalRecruitUnits ?? 0) === 1 ? '' : 's'} opened during the breath and closed again by its end.`);
        break;
      case 'high-effort':
        out.push(`Peak Pmus ${f1(ev.pmusPeak ?? 0)} cmH2O (target ${k('PMUS_LOW')}–${k('PMUS_HIGH')}).`);
        break;
      case 'low-effort':
        out.push(`Peak Pmus ${f1(ev.pmusPeak ?? 0)} cmH2O (target ${k('PMUS_LOW')}–${k('PMUS_HIGH')}).`);
        break;
      case 'auto-trigger':
        out.push(`Triggered at ${f1(label.tStart)} s with no neural effort in the trigger window.`);
        break;
      case 'ineffective-effort':
        out.push('An effort inside this breath did not trigger.');
        break;
      case 'secretions':
        out.push('Secretions injector active: resistance fluttering at 5–20 Hz.');
        break;
      case 'water':
        out.push('Water injector active: a regular resistance oscillation.');
        break;
    }
  }
  return out;
}

/** Effort-level evidence for an ineffective effort. */
export function effortEvidence(e: EffortLabel, settings: VentSettings): string[] {
  const phase = e.phase === 'exp' ? 'expiration' : 'inspiration';
  const out = [`The effort at ${e.tOnset.toFixed(1)} s (neural Ti ${e.ti.toFixed(2)} s) did not trigger a breath; it began during ${phase}.`];
  if (settings.triggerType === 'flow') out.push(`Flow trigger ${settings.flowTrigger} L/min.`);
  else out.push(`Pressure trigger ${settings.pressureTrigger} cmH2O.`);
  if (e.assistedByMachine) out.push('A time-triggered breath met the effort, so it was assisted although it did not trigger.');
  return out;
}

export interface BreathExplanation {
  card: ExplainCard;
  evidence: string[];
}

/** One card per pattern on the breath, each with its own evidence lines. */
export function explainBreath(ctx: EvidenceContext): BreathExplanation[] {
  const all = caseEvidence(ctx);
  return ctx.label.patterns.map((p, i) => {
    const line = all[i];
    return { card: CARDS[p], evidence: line === undefined ? [] : [line] };
  });
}
