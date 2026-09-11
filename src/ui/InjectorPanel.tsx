import type { SessionController } from '../app/controller';
import { INJECTOR_KINDS, type InjectorKind } from '../sim/injectors';

const LABELS: Record<InjectorKind, { label: string; hint: string }> = {
  leak: { label: 'Leak', hint: 'Orifice leak at the Y-piece (≈ 8 L/min at 20 cmH2O): Vte < Vti, auto-triggering' },
  cardiac: { label: 'Cardiac', hint: 'Pleural oscillation at the heart rate: flow ripple that can auto-trigger a sensitive flow trigger' },
  secretions: { label: 'Secretions', hint: 'Random 5–20 Hz resistance modulation: sawtooth on expiratory flow' },
  water: { label: 'Water', hint: 'Regular oscillation from water in the tubing' },
  cough: { label: 'Cough', hint: 'Expiratory Pmus bursts provoked by inflation: Paw spikes, alarm cycling' },
  pneumothorax: { label: 'Pneumothorax', hint: 'Abrupt compliance fall with a pleural pressure offset' },
  mainstem: { label: 'Mainstem', hint: 'Single-lung ventilation: compliance halves, resistance rises' },
  bronchospasm: { label: 'Bronchospasm', hint: 'Resistance ×3 ramped over 20 s: high Ppeak − Pplat, auto-PEEP' },
};

interface Props {
  ctl: SessionController;
  active: InjectorKind[];
}

/** Live fault injectors (Spec §1 principle 1): every one acts as a term in the equations, never as an overlay. */
export function InjectorPanel({ ctl, active }: Props) {
  return (
    <section class="panel injectors" aria-label="Fault injectors" data-testid="injector-panel">
      <h2>
        Injectors <span class="muted small">physics terms, not overlays</span>
      </h2>
      <div class="injector-grid">
        {INJECTOR_KINDS.map((kind) => {
          const on = active.includes(kind);
          return (
            <label class={`inline injector ${on ? 'on' : ''}`} key={kind} title={LABELS[kind].hint}>
              <input type="checkbox" checked={on} data-testid={`inj-${kind}`} onChange={(e) => ctl.setInjector(kind, e.currentTarget.checked ? {} : null)} />
              <span class="small">{LABELS[kind].label}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
