import { SCENARIOS, type ScenarioDef } from '../edu/scenarios';
import type { ScenarioProgress } from '../edu/progress';

interface Props {
  current: ScenarioDef | null;
  onPick: (id: string) => void;
  /** Learner progress per scenario id (best quiz score), shown in the option label. */
  progress?: Record<string, ScenarioProgress>;
  /** Locked quiz (D-019): the learner cannot switch cases. */
  disabled?: boolean;
  /** Scenario text hidden (D-019): the current case reads "Case" and the best scores are dropped; the other titles stay. */
  mask?: boolean;
}

const CATEGORY_LABEL: Record<ScenarioDef['category'], string> = {
  preset: 'Phenotype presets',
  dyssynchrony: 'Dyssynchrony',
  injector: 'Circuit and airway problems',
  capstone: 'Capstone',
};

export function ScenarioPicker({ current, onPick, progress, disabled = false, mask = false }: Props) {
  const groups = new Map<ScenarioDef['category'], ScenarioDef[]>();
  for (const s of SCENARIOS) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  return (
    <label class="scenario-picker">
      <span class="muted small">Scenario</span>
      <select value={current?.id ?? ''} onChange={(e) => onPick((e.currentTarget).value)} data-testid="scenario-select" disabled={disabled}>
        {!current && <option value="">Choose a scenario…</option>}
        {[...groups.entries()].map(([cat, list]) => (
          <optgroup label={CATEGORY_LABEL[cat]} key={cat}>
            {list.map((s) => (
              <option value={s.id} key={s.id}>
                {mask && s.id === current?.id ? 'Case' : s.title}
                {!mask && progress?.[s.id] ? ` · best ${progress[s.id]?.best}${progress[s.id]?.passed ? ' ✓' : ''}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
