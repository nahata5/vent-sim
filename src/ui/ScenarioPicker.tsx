import { SCENARIOS, type ScenarioDef } from '../edu/scenarios';
import type { ScenarioProgress } from '../edu/progress';

interface Props {
  current: ScenarioDef | null;
  onPick: (id: string) => void;
  /** Learner progress per scenario id (best quiz score), shown in the option label. */
  progress?: Record<string, ScenarioProgress>;
  /** Locked quiz (D-019): the learner cannot switch cases. */
  disabled?: boolean;
  /** Scenario text hidden (D-019): every case reads "Case n" (the current one included), categories read "Cases", no best scores. */
  mask?: boolean;
  /** The learner's saved scenarios (M10 §5.3), rendered in their own "My scenarios" group after the shipped ones. */
  custom?: ScenarioDef[];
}

const CATEGORY_LABEL: Record<ScenarioDef['category'], string> = {
  preset: 'Phenotype presets',
  dyssynchrony: 'Dyssynchrony',
  injector: 'Circuit and airway problems',
  capstone: 'Capstone',
  mode: 'SIMV, PRVC and APRV',
};

export function ScenarioPicker({ current, onPick, progress, disabled = false, mask = false, custom = [] }: Props) {
  const groups = new Map<ScenarioDef['category'], ScenarioDef[]>();
  for (const s of SCENARIOS) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  // Masked: a stable number per case in list order, so the learner can still switch without reading a title.
  const caseNumber = new Map([...SCENARIOS, ...custom].map((s, i) => [s.id, i + 1]));
  return (
    <label class="scenario-picker">
      <span class="muted small">Scenario</span>
      <select value={current?.id ?? ''} onChange={(e) => onPick((e.currentTarget).value)} data-testid="scenario-select" disabled={disabled}>
        {!current && <option value="">Choose a scenario…</option>}
        {[...groups.entries()].map(([cat, list]) => (
          <optgroup label={mask ? 'Cases' : CATEGORY_LABEL[cat]} key={cat}>
            {list.map((s) => (
              <option value={s.id} key={s.id}>
                {mask ? `Case ${caseNumber.get(s.id) ?? ''}` : s.title}
                {!mask && progress?.[s.id] ? ` · best ${progress[s.id]?.best}${progress[s.id]?.passed ? ' ✓' : ''}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
        {custom.length > 0 && (
          <optgroup label={mask ? 'Cases' : 'My scenarios'} data-testid="picker-custom-group">
            {custom.map((s) => (
              <option value={s.id} key={s.id}>
                {mask ? `Case ${caseNumber.get(s.id) ?? ''}` : s.title}
                {!mask && progress?.[s.id] ? ` · best ${progress[s.id]?.best}${progress[s.id]?.passed ? ' ✓' : ''}` : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}
