import { SCENARIOS, type ScenarioDef } from '../edu/scenarios';
import type { ScenarioProgress } from '../edu/progress';

interface Props {
  current: ScenarioDef | null;
  onPick: (id: string) => void;
  /** Learner progress per scenario id (best quiz score), shown in the option label. */
  progress?: Record<string, ScenarioProgress>;
}

const CATEGORY_LABEL: Record<ScenarioDef['category'], string> = {
  preset: 'Phenotype presets',
  dyssynchrony: 'Dyssynchrony',
  injector: 'Circuit and airway problems',
  capstone: 'Capstone',
};

export function ScenarioPicker({ current, onPick, progress }: Props) {
  const groups = new Map<ScenarioDef['category'], ScenarioDef[]>();
  for (const s of SCENARIOS) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  return (
    <label class="scenario-picker">
      <span class="muted small">Scenario</span>
      <select value={current?.id ?? ''} onChange={(e) => onPick((e.currentTarget).value)} data-testid="scenario-select">
        {!current && <option value="">Choose a scenario…</option>}
        {[...groups.entries()].map(([cat, list]) => (
          <optgroup label={CATEGORY_LABEL[cat]} key={cat}>
            {list.map((s) => (
              <option value={s.id} key={s.id}>
                {s.title}
                {progress?.[s.id] ? ` · best ${progress[s.id]?.best}${progress[s.id]?.passed ? ' ✓' : ''}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
