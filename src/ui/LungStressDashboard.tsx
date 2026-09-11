import type { BreathMetrics } from '../monitor/monitor';
import type { TruthBreathMetrics } from '../sim/truth/lung-stress';
import { bandFor, METRICS, metricCitation, powerSurrogate, type StressMetricId } from '../monitor/bands';
import type { ManeuverReadouts, RecruitReadout } from '../app/controller';
import type { VentSettings } from '../sim/vent/settings';
import { k } from '../config/constants';

interface Props {
  m: BreathMetrics | null;
  truth: TruthBreathMetrics | null;
  recruit: RecruitReadout | null;
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

/**
 * Pressure muscle index (Foti 1997, Brief 2 §4): Pplat of an end-inspiratory hold minus the airway target
 * (PEEP + PS in pressure support; PEEP + Pinsp in PC). Positive when the relaxing muscles were still
 * pulling at end-inspiration; not defined for volume control.
 */
export function pmiFromHold(hold: { p2?: number } | null, s: VentSettings): number | null {
  const p2 = num(hold?.p2);
  if (p2 === null) return null;
  if (s.mode === 'PSV') return p2 - (s.peep + s.ps);
  if (s.mode === 'PC-AC') return p2 - (s.peep + s.pinsp);
  return null;
}

export function LungStressDashboard({ m, truth, recruit, truthOn, maneuvers, settings, balloon, rrTotal }: Props) {
  const tOn = truthOn && truth;
  const surrogate =
    m && rrTotal > 0
      ? powerSurrogate({
          mode: settings.mode,
          rr: rrTotal,
          vtL: m.vti / 1000,
          ppeak: m.ppeak,
          peep: m.peepMeasured,
          dp: num(m.drivingPressure),
          peakFlowLpm: m.peakInspFlow * 60,
          ...(num(m.drivingPressure) !== null && m.vti > 0 && num(m.raw) !== null && m.ie > 0
            ? { ers: ((m.drivingPressure as number) * 1000) / m.vti, raw: m.raw as number, ie: m.ie }
            : {}),
        })
      : null;
  const ri = maneuvers.ri?.values;
  const trial = maneuvers.peepTrial;
  const pmi = pmiFromHold(maneuvers.inspHold, settings);
  const rows: RowValue[] = [
    { id: 'pplat', value: num(m?.pplat) },
    { id: 'dp', value: num(m?.drivingPressure), detail: m?.pplat === null ? 'needs an inspiratory hold' : undefined },
    { id: 'vtPbw', value: num(m?.vtPerKg) },
    {
      id: 'power',
      value: surrogate,
      detail: tOn ? `truth ∫Paw·dV ${truth.powerTruth.toFixed(1)} · lung ${truth.lungPower.toFixed(1)} J/min` : settings.mode === 'VC-AC' && m?.drivingPressure != null ? 'Gattinoni 2016 full formula' : 'bedside surrogate',
    },
    { id: 'dpl', value: tOn ? truth.dPL : null, needsTruth: true },
    { id: 'dplDyn', value: tOn ? truth.dPLdyn : null, needsTruth: true },
    { id: 'plEI', value: tOn ? Math.max(truth.plEI.nd, truth.plEI.d) : null, detail: tOn ? `ND ${truth.plEI.nd.toFixed(1)} · D ${truth.plEI.d.toFixed(1)}` : undefined, needsTruth: true },
    { id: 'plEE', value: tOn ? Math.min(truth.plEE.nd, truth.plEE.d) : null, detail: tOn ? `ND ${truth.plEE.nd.toFixed(1)} · D ${truth.plEE.d.toFixed(1)}` : undefined, needsTruth: true },
    { id: 'strain', value: tOn ? truth.strain : null, detail: tOn ? `EELV ${(truth.eelv * 1000).toFixed(0)} mL` : undefined, needsTruth: true },
    {
      id: 'recruited',
      value: truthOn && recruit ? recruit.recruitedVolume * 1000 : null,
      detail: truthOn && recruit ? `${(recruit.openFraction * 100).toFixed(0)} % of units open · tidal recruitment ${recruit.tidalRecruitUnits} unit${recruit.tidalRecruitUnits === 1 ? '' : 's'}` : undefined,
      needsTruth: true,
    },
    { id: 'pmus', value: tOn ? truth.pmusPeak : null, needsTruth: true },
    { id: 'dpes', value: balloon && truth ? truth.dPes : null, needsBalloon: true },
    { id: 'p01', value: num(maneuvers.p01?.values?.p01) },
    { id: 'pocc', value: num(maneuvers.pocc?.values?.dPocc) },
    { id: 'pmi', value: pmi, detail: pmi === null ? (settings.mode === 'VC-AC' ? 'pressure-targeted modes only' : 'needs an inspiratory hold') : 'Pplat(hold) − (PEEP + PS), Foti 1997' },
    { id: 'stressIndex', value: m?.stressIndex ?? null, detail: m?.stressIndex != null ? 'Paw = a·t^b + c on this constant-flow breath' : 'needs a machine-triggered constant-flow VC breath' },
    {
      id: 'ri',
      value: ri && ri.valid ? num(ri.ri) : null,
      detail: ri && ri.valid ? `ΔVrelease ${ri.dVrelease?.toFixed(0)} mL · Crs,low ${ri.crsLow?.toFixed(0)} · Vrec ${ri.vrec?.toFixed(0)} mL (${ri.peepHigh} → ${ri.peepLow})` : 'run the R/I maneuver (set PEEP 15 first)',
    },
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
                  {r.value === null ? <span class="muted small">{placeholder}</span> : `${r.value.toFixed(r.id === 'strain' || r.id === 'ri' ? 2 : r.id === 'recruited' ? 0 : 1)} ${def.unit}`}
                </td>
                <td class="metric-band" aria-label={`band ${band}`}>
                  {r.id === 'ri' && r.value !== null ? (r.value >= k('RI_THRESHOLD') ? 'recruiter' : 'low') : band === 'ok' ? 'ok' : band === 'warn' ? 'watch' : band === 'danger' ? 'high' : ''}
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
      {trial?.table && trial.table.length > 0 && (
        <div class="peep-trial" data-testid="peep-trial-table">
          <div class="small">
            Decremental PEEP trial · best compliance at PEEP <strong>{trial.values?.bestPeep}</strong> ({trial.values?.bestCrs?.toFixed(0)} mL/cmH2O)
            {trial.values?.peepOriginal !== undefined ? ` · PEEP restored to ${trial.values.peepOriginal}` : ''}
          </div>
          <table class="small">
            <thead>
              <tr>
                <th>PEEP</th>
                <th>Pplat</th>
                <th>ΔP</th>
                <th>Crs</th>
                <th>PL,ei</th>
                <th>MP</th>
              </tr>
            </thead>
            <tbody>
              {trial.table.map((s) => (
                <tr key={s.peep} data-testid="peep-trial-step" class={s.peep === trial.values?.bestPeep ? 'best' : ''}>
                  <td>{s.peep}</td>
                  <td>{s.pplat?.toFixed(1)}</td>
                  <td>{s.dp?.toFixed(1)}</td>
                  <td>{s.crs?.toFixed(0)}</td>
                  <td>{Number.isFinite(s.plEI ?? NaN) ? s.plEI?.toFixed(1) : '—'}</td>
                  <td>{s.power?.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
