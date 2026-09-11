interface Props {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Disabled while a bedside quiz hides the truth layer or the session is locked (D-019). */
  disabled?: boolean;
}

/** "What the bedside sees ↔ what's really happening" (Spec §6). */
export function TruthToggle({ on, onChange, disabled = false }: Props) {
  return (
    <button
      type="button"
      class={`truth-toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      disabled={disabled}
      data-testid="truth-toggle"
      title={disabled ? 'The truth layer is hidden for this quiz' : 'Toggle the truth layer: Pmus, Palv, Ppl, Pes, PL and compartment flows'}
    >
      <span class={on ? 'muted' : ''}>What the bedside sees</span>
      <span class="arrow">↔</span>
      <span class={on ? '' : 'muted'}>what's really happening</span>
    </button>
  );
}
