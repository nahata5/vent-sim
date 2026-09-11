import { SCENARIOS, type ScenarioDef } from '../edu/scenarios';

interface Props {
  current: ScenarioDef | null;
  onPick: (id: string) => void;
}

const CATEGORY_LABEL: Record<ScenarioDef['category'], string> = {
  preset: 'Phenotype presets',
  dyssynchrony: 'Dyssynchrony',
  injector: 'Circuit and airway problems',
  capstone: 'Capstone',
};

export function ScenarioPicker({ current, onPick }: Props) {
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
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
