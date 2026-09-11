import type { BreathMetrics } from '../monitor/monitor';
import type { SessionController, ManeuverReadouts } from '../app/controller';
import type { VentSettings } from '../sim/vent/settings';
import type { AsynchronyIndex } from '../sim/truth/labeler';
import { k } from '../config/constants';

interface Props {
  ctl: SessionController;
  m: BreathMetrics | null;
  maneuvers: ManeuverReadouts;
  settings: VentSettings;
  rrTotal: number;
  veMinute: number;
  busy: boolean;
  /** Asynchrony index over the last 2 min from the truth labels (null until the first breath closes). */
  ai: AsynchronyIndex | null;
}

function v(x: number | null | undefined, digits = 1): string {
  return x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(digits);
}

export function MonitorPanel({ ctl, m, maneuvers, settings, rrTotal, veMinute, busy, ai }: Props) {
  const p01 = maneuvers.p01?.values?.p01;
  const pocc = maneuvers.pocc?.values?.dPocc;
  const occ = maneuvers.occlusionTest?.values;
  const tiles: Array<[string, string, string]> = [
    ['Ppeak', v(m?.ppeak), 'cmH2O'],
    ['Pplat', v(m?.pplat), m?.pplatFromThisBreath ? 'cmH2O' : 'cmH2O (hold)'],
    ['Pmean', v(m?.pmean), 'cmH2O'],
    ['PEEP', v(m?.peepMeasured), 'cmH2O'],
    ['PEEPtot', v(m?.peepTotal), 'cmH2O (hold)'],
    ['PEEPi', v(m?.peepi), 'cmH2O'],
    ['ΔP', v(m?.drivingPressure), 'cmH2O'],
    ['Cstat', v(m?.cstat, 0), 'mL/cmH2O'],
    ['Cdyn', v(m?.cdyn, 0), 'mL/cmH2O'],
    ['Raw', v(m?.raw), 'cmH2O/L/s'],
    ['Vti', v(m?.vti, 0), 'mL'],
    ['Vte', v(m?.vte, 0), 'mL'],
    ['Vt/kg', v(m?.vtPerKg), 'mL/kg PBW'],
    ['RR', v(rrTotal, 0), '/min'],
    ['Ve', v(veMinute), 'L/min'],
    ['Ti', v(m?.ti, 2), 's'],
    ['I:E', m ? `1:${v(m.ie > 0 ? 1 / m.ie : NaN)}` : '—', ''],
    ['Leak', v(m?.leakPct, 0), '%'],
    ['RSBI', v(m?.rsbi, 0), '/min/L'],
    ['P0.1', v(p01), 'cmH2O'],
    ['ΔPocc', v(pocc), 'cmH2O'],
    ['ΔPes/ΔPaw', occ ? v(occ.ratio, 2) : '—', 'occlusion test'],
  ];
  return (
    <section class="panel monitor" aria-label="Monitored values" data-testid="monitor-panel">
      <h2>
        Monitor <span class="muted small">{settings.mode}</span>
      </h2>
      <div class="tiles">
        {tiles.map(([label, val, unit]) => (
          <div class="tile" key={label} data-testid={`mon-${label}`}>
            <div class="tile-label">{label}</div>
            <div class="tile-value">{val}</div>
            <div class="tile-unit">{unit}</div>
          </div>
        ))}
        <div
          class={`tile tile-ai ${ai?.severe ? 'tile-warn' : ''}`}
          data-testid="mon-AI"
          data-ai={ai ? ai.ai.toFixed(1) : ''}
          data-cluster={ai?.cluster ? '1' : '0'}
          title={`Asynchrony index (Thille 2006): asynchronous events ÷ (ventilator cycles + ineffective efforts) over the last 2 min. Severe above ${k('AI_SEVERE')}%. Cluster flag: > ${k('IE_CLUSTER_COUNT')} ineffective efforts in ${k('IE_CLUSTER_WINDOW') / 60} min (Vaporidi 2017).`}
        >
          <div class="tile-label">AI</div>
          <div class="tile-value">{ai ? `${ai.ai.toFixed(0)}%` : '—'}</div>
          <div class="tile-unit">
            {ai ? `${ai.events} / ${ai.cycles + ai.ie}` : 'events / cycles'}
            {ai?.cluster ? <span class="cluster-flag"> · IE cluster</span> : null}
          </div>
        </div>
      </div>
      <div class="maneuvers">
        <span class="muted small">Maneuvers</span>
        <button type="button" disabled={busy} onClick={() => ctl.maneuver('insp')} title="Inspiratory hold 1 s: Pplat (P2), P1">
          Insp hold
        </button>
        <button type="button" disabled={busy} onClick={() => ctl.maneuver('exp')} title="Expiratory hold 3 s: total PEEP">
          Exp hold
        </button>
        <button type="button" disabled={busy} onClick={() => ctl.maneuver('p01')} title="Occlude 100 ms at the next effort">
          P0.1
        </button>
        <button type="button" disabled={busy} onClick={() => ctl.maneuver('pocc')} title="Occlude one whole effort: ΔPocc">
          ΔPocc
        </button>
        <button type="button" disabled={busy || !settings.esophagealBalloon} onClick={() => ctl.maneuver('occlusion-test')} title="Baydur occlusion test (needs the balloon)">
          Occl. test
        </button>
      </div>
    </section>
  );
}
