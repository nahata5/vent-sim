import { useEffect, useRef } from 'preact/hooks';

export const HELP_SEEN_KEY = 'ventsim.help.seen.v1';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** How-to-use overlay (Spec 2026-09-14 §6): static text, no truth data, so it is available in the locked quiz view. */
export function HelpDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class="help-dialog" aria-labelledby="help-title" data-testid="help-dialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div class="help-body">
        <h2 id="help-title">How to use VentSim</h2>
        <p>
          VentSim is a teaching ventilator. Every waveform comes from a physiologic model of the patient and the ventilator; nothing is drawn by
          hand, so dyssynchrony appears when the settings and the patient disagree. The screen shows what a bedside monitor would show; the
          <b> truth layer</b> adds what only the model knows (true muscle pressure, pleural and transpulmonary pressure, neural timing).
        </p>
        <h3>The screen</h3>
        <ul>
          <li><b>Waveforms</b> (centre): Paw, flow, volume, plus Pes with the esophageal balloon and truth rows with the truth toggle. Badges above the traces are the signal-only detector's labels; hover for evidence, click for the explain card. Below: loops and the drawer.</li>
          <li><b>Settings</b> (left): change a value, then <b>Confirm</b>; rate, volume and pressure changes take effect at the next breath. Injectors (leak, secretions, bronchospasm…) and the Instructor panel sit below.</li>
          <li><b>Monitor</b> (right): measured numbers, maneuver buttons (holds, P0.1, ΔPocc, occlusion test, R/I, PEEP trial), the lung-stress dashboard and the CO2 panel when a scenario has the CO2 loop.</li>
          <li><b>Drawer tabs</b>: Scenario (objectives and the suggested fix), Explain, Quiz, Export.</li>
          <li><b>Phones</b>: the waveforms stay pinned; the bottom tab bar switches Vent, Monitor, Loops and Learn.</li>
        </ul>
        <h3>A session</h3>
        <ol>
          <li>Pick a scenario. Watch 20–30 s of breathing.</li>
          <li>Take an inspiratory and an expiratory hold; try P0.1.</li>
          <li>Click a badge to open its explain card with the case evidence.</li>
          <li>Open <b>Quiz</b>: identify the patterns with badges hidden, then fix the settings within safety limits; the debrief compares your changes with the recommended fix.</li>
          <li><b>Export</b> the session as CSV or JSON with truth labels.</li>
        </ol>
        <h3>Modes</h3>
        <ul>
          <li><b>VC-AC</b>: set volume and flow; watch for flow starvation and double triggering when the drive is strong.</li>
          <li><b>PC-AC</b>: set pressure and Ti; volume follows compliance and effort.</li>
          <li><b>PSV</b>: the patient sets the rate and Ti; cycling by flow (ETS) — premature or delayed cycling, ineffective efforts with intrinsic PEEP.</li>
          <li><b>CPAP</b>: no support; work of breathing is the patient's.</li>
          <li><b>SIMV</b>: mandatory VC or PC breaths at a set rate, pressure-supported breaths in between; two breath types in one trace.</li>
          <li><b>PRVC</b>: pressure control that adapts breath by breath to a volume target; a strong effort makes it withdraw support.</li>
          <li><b>APRV</b>: long Phigh with short releases and unrestricted spontaneous breathing; the release timing sets the trapped PEEP and can collide with efforts.</li>
        </ul>
        <h3>Write your own scenario</h3>
        <p>
          Instructor panel → <b>Copy authoring prompt</b> → paste it into your own LLM and answer its questions → paste the JSON it returns
          into the editor → <b>Validate</b> → <b>Save to My scenarios</b>. The format is documented in <code>docs/SCENARIO_AUTHORING.md</code>.
        </p>
        <h3>More</h3>
        <p>
          <a href="https://github.com/nahata5/vent-sim#readme" target="_blank" rel="noreferrer">README</a> · <a href="https://github.com/nahata5/vent-sim/blob/main/docs/MODEL.md" target="_blank" rel="noreferrer">Model</a> ·{' '}
          <a href="#validation">Validation</a>. VentSim is for education only; it is not a medical device and not a clinical decision aid.
        </p>
        <button type="button" class="primary" onClick={onClose} data-testid="help-close">
          Close
        </button>
      </div>
    </dialog>
  );
}
