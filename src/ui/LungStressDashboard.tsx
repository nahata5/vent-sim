import type { BreathMetrics } from '../monitor/monitor';
import type { TruthBreathMetrics } from '../sim/truth/lung-stress';
import { bandFor, METRICS, metricCitation, powerSurrogate, type StressMetricId } from '../monitor/bands';
import type { ManeuverReadouts } from '../app/controller';
import type { VentSettings } from '../sim/vent/settings';

interface Props {
  m: BreathMetrics | null;
  truth: TruthBreathMetrics | null;
  truthOn: boolean;
  maneuvers: ManeuverReadouts;
  settings: VentSettings;
  balloon: boolean;
  rrTotal: number;
}

interface RowValue {
  id: StressMetricId;
  value: number | null;
  detail?: string | undefined;
  needsTruth?: boolean;
  needsBalloon?: boolean;
}

function num(x: number | null | undefined): number | null {
  return x === null || x === undefined || !Number.isFinite(x) ? null : x;
}

export function LungStressDashboard({ m, truth, truthOn, maneuvers, settings, balloon, rrTotal }: Props) {
  const tOn = truthOn && truth;
  const surrogate =
    m && rrTotal > 0
      ? powerSurrogate({ mode: settings.mode, rr: rrTotal, vtL: m.vti / 1000, ppeak: m.ppeak, peep: m.peepMeasured, dp: num(m.drivingPressure), peakFlowLpm: m.peakInspFlow * 60 })
      : null;
  const rows: RowValue[] = [
    { id: 'pplat', value: num(m?.pplat) },
    { id: 'dp', value: num(m?.drivingPressure), detail: m?.pplat === null ? 'needs an inspiratory hold' : undefined },
    { id: 'vtPbw', value: num(m?.vtPerKg) },
    { id: 'power', value: surrogate, detail: tOn ? `truth ∫Paw·dV ${truth.powerTruth.toFixed(1)} · lung ${truth.lungPower.toFixed(1)} J/min` : 'bedside surrogate' },
    { id: 'dpl', value: tOn ? truth.dPL : null, needsTruth: true },
    { id: 'dplDyn', value: tOn ? truth.dPLdyn : null, needsTruth: true },
    { id: 'plEI', value: tOn ? Math.max(truth.plEI.nd, truth.plEI.d) : null, detail: tOn ? `ND ${truth.plEI.nd.toFixed(1)} · D ${truth.plEI.d.toFixed(1)}` : undefined, needsTruth: true },
    { id: 'plEE', value: tOn ? Math.min(truth.plEE.nd, truth.plEE.d) : null, detail: tOn ? `ND ${truth.plEE.nd.toFixed(1)} · D ${truth.plEE.d.toFixed(1)}` : undefined, needsTruth: true },
    { id: 'strain', value: tOn ? truth.strain : null, detail: tOn ? `EELV ${(truth.eelv * 1000).toFixed(0)} mL` : undefined, needsTruth: true },
    { id: 'pmus', value: tOn ? truth.pmusPeak : null, needsTruth: true },
    { id: 'dpes', value: balloon && truth ? truth.dPes : null, needsBalloon: true },
    { id: 'p01', value: num(maneuvers.p01?.values?.p01) },
    { id: 'pocc', value: num(maneuvers.pocc?.values?.dPocc) },
    { id: 'pmi', value: null, detail: 'M7: Pes during an inspiratory hold' },
    { id: 'stressIndex', value: null, detail: 'M7' },
    { id: 'ri', value: null, detail: 'M7: PEEP trial' },
  ];
  return (
    <section class="panel dashboard" aria-label="Lung-stress dashboard" data-testid="dashboard">
      <h2>
        Lung stress <span class="muted small">Brief 2 §6 bands</span>
      </h2>
      <table>
        <tbody>
          {rows.map((r) => {
            const def = METRICS[r.id];
            const band = bandFor(r.id, r.value);
            const placeholder = r.needsTruth && !truthOn ? 'truth layer off' : r.needsBalloon && !balloon ? 'needs balloon' : r.detail ?? '—';
            return (
              <tr key={r.id} class={`band-${band}`} title={metricCitation(r.id)} data-testid={`stress-${r.id}`}>
                <td class="metric-label">
                  {def.label}
                  {def.truthOnly && <span class="chip chip-truth" title="From truth channels">T</span>}
                </td>
                <td class="metric-value">
                  {r.value === null ? <span class="muted small">{placeholder}</span> : `${r.value.toFixed(r.id === 'strain' ? 2 : 1)} ${def.unit}`}
                </td>
                <td class="metric-band" aria-label={`band ${band}`}>
                  {band === 'ok' ? 'ok' : band === 'warn' ? 'watch' : band === 'danger' ? 'high' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((r) => r.value !== null && r.detail) && (
        <ul class="details small muted">
          {rows.filter((r) => r.value !== null && r.detail).map((r) => (
            <li key={r.id}>
              {METRICS[r.id].label}: {r.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
