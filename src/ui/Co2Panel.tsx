import type { Co2Sample } from '../sim/patient/gas-exchange';
import { k } from '../config/constants';

interface Props {
  co2: Co2Sample;
  onWarp: (w: number) => void;
}

const WARPS = [1, 5, 10, 20, 30, 60];

/** CO2 → drive loop readout (Spec §4.4): PaCO2, the delayed chemoreceptor signal, alveolar ventilation, drive scales and the time warp. */
export function Co2Panel({ co2, onWarp }: Props) {
  const set = k('CO2_SET_POINT');
  const apneic = set - k('CO2_APNEIC_OFFSET');
  return (
    <section class="panel co2" aria-label="CO2 loop" data-testid="co2-panel">
      <h2>
        CO2 loop <span class="muted small">time warp ×{co2.warp}</span>
      </h2>
      <div class="tiles">
        <div class={`tile ${co2.apnea ? 'tile-warn' : ''}`} data-testid="co2-paco2" data-paco2={co2.paCO2.toFixed(1)}>
          <div class="tile-label">PaCO2</div>
          <div class="tile-value">{co2.paCO2.toFixed(0)}</div>
          <div class="tile-unit">mmHg · set {set}</div>
        </div>
        <div class="tile" data-testid="co2-delayed">
          <div class="tile-label">Chemoreceptor</div>
          <div class="tile-value">{co2.paCO2Delayed.toFixed(0)}</div>
          <div class="tile-unit">mmHg (delayed {k('CO2_CHEMO_DELAY')} s)</div>
        </div>
        <div class="tile" data-testid="co2-va">
          <div class="tile-label">VA</div>
          <div class="tile-value">{co2.va === null ? '—' : co2.va.toFixed(1)}</div>
          <div class="tile-unit">L/min alveolar</div>
        </div>
        <div class={`tile ${co2.apnea ? 'tile-warn' : ''}`} data-testid="co2-drive" data-apnea={co2.apnea ? '1' : '0'}>
          <div class="tile-label">Drive</div>
          <div class="tile-value">{co2.apnea ? 'apnea' : `×${co2.pmaxScale.toFixed(2)}`}</div>
          <div class="tile-unit">{co2.apnea ? `PaCO2 < ${apneic}` : `rate ×${co2.rateScale.toFixed(2)}`}</div>
        </div>
      </div>
      <label class="inline">
        <span class="muted small">warp</span>
        <select value={co2.warp} onChange={(e) => onWarp(Number(e.currentTarget.value))} data-testid="co2-warp" aria-label="CO2 time warp">
          {WARPS.map((w) => (
            <option key={w} value={w}>
              ×{w}
            </option>
          ))}
        </select>
        <span class="muted small">1 s of simulation = {co2.warp} s of CO2 dynamics; breathing is not warped</span>
      </label>
    </section>
  );
}
