interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
}

/** "What the bedside sees ↔ what's really happening" (Spec §6). */
export function TruthToggle({ on, onChange }: Props) {
  return (
    <button type="button" class={`truth-toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} data-testid="truth-toggle" title="Toggle the truth layer: Pmus, Palv, Ppl, Pes, PL and compartment flows">
      <span class={on ? 'muted' : ''}>What the bedside sees</span>
      <span class="arrow">↔</span>
      <span class={on ? '' : 'muted'}>what's really happening</span>
    </button>
  );
}
