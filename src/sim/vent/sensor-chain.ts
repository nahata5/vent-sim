/**
 * Sensor chain (Spec §5): physics at 1 kHz → first-order low-pass → transport delay → band-limited
 * noise → quantization → resample at the device rate. Volume is integrated from the *measured* flow
 * at the device rate and reset at each inspiration start, as real ventilators do, so leak and drift
 * behave realistically (Vte ≠ Vti under leak).
 */
import { k } from '../../config/constants';
import type { Rng } from '../math/prng';
import { BandLimitedNoise, DelayLine, LowPass, quantize } from '../math/filters';

export interface SensorChainOptions {
  dt: number;
  deviceRate: number;
  ideal: boolean;
  rng: Rng;
}

class Channel {
  private readonly lpf: LowPass;
  private readonly delay: DelayLine;
  private readonly noise: BandLimitedNoise | null;
  private latest = 0;
  constructor(
    opts: SensorChainOptions,
    private readonly quantum: number,
    noiseRms: number,
    rng: Rng,
  ) {
    const tau = opts.ideal ? 0 : k('SENSOR_LPF_TAU');
    const delaySamples = opts.ideal ? 0 : Math.round(k('SENSOR_DELAY') / opts.dt);
    this.lpf = new LowPass(tau, opts.dt);
    this.delay = new DelayLine(delaySamples);
    this.noise = opts.ideal ? null : new BandLimitedNoise(rng, noiseRms, k('SENSOR_NOISE_BANDWIDTH'), opts.dt);
  }
  push(x: number): number {
    let y = this.lpf.push(x);
    y = this.delay.push(y);
    if (this.noise) y += this.noise.next();
    this.latest = y;
    return y;
  }
  sample(ideal: boolean): number {
    return ideal ? this.latest : quantize(this.latest, this.quantum);
  }
  reset(v: number): void {
    this.lpf.reset(v);
    this.delay.fill(v);
    this.latest = v;
  }
}

export class SensorChain {
  private readonly paw: Channel;
  private readonly flow: Channel;
  private readonly pes: Channel;
  private readonly ideal: boolean;
  private vol = 0;
  /** Inspired and expired volume integrated from the measured flow since the last reset. */
  vti = 0;
  vte = 0;
  peakInspFlow = 0;
  peakPaw = -Infinity;

  constructor(private readonly opts: SensorChainOptions) {
    this.ideal = opts.ideal;
    this.paw = new Channel(opts, k('SENSOR_PAW_QUANTUM'), k('SENSOR_PAW_NOISE_RMS'), opts.rng.fork('paw'));
    this.flow = new Channel(opts, k('SENSOR_FLOW_QUANTUM'), k('SENSOR_FLOW_NOISE_RMS'), opts.rng.fork('flow'));
    this.pes = new Channel(opts, k('SENSOR_PAW_QUANTUM'), k('SENSOR_PAW_NOISE_RMS') * 0.5, opts.rng.fork('pes'));
  }

  get deviceRate(): number {
    return this.opts.deviceRate;
  }

  /**
   * Called every physics step with the true airway pressure, ventilator-side flow and (optional) Pes.
   * Volume is integrated here at the physics rate from the *measured* flow, as a device integrates its
   * own flow sensor at its internal rate; `inInsp` tells the integrator which phase the device is in.
   */
  push(pawTrue: number, qvTrue: number, pesTrue: number, inInsp: boolean): void {
    const paw = this.paw.push(pawTrue);
    const flow = this.flow.push(qvTrue);
    this.pes.push(pesTrue);
    const dv = flow * this.opts.dt;
    this.vol += dv;
    if (inInsp) {
      if (dv > 0) this.vti += dv;
      if (flow > this.peakInspFlow) this.peakInspFlow = flow;
      if (paw > this.peakPaw) this.peakPaw = paw;
    } else if (dv < 0) {
      this.vte -= dv;
    }
  }

  /** Called at the device rate: returns the measured sample. */
  sample(): { paw: number; flow: number; vol: number; pes: number } {
    return {
      paw: this.paw.sample(this.ideal),
      flow: this.flow.sample(this.ideal),
      vol: this.vol,
      pes: this.pes.sample(this.ideal),
    };
  }

  /** Reset the displayed volume integrator and per-breath accumulators (at inspiration start). */
  resetVolume(): void {
    this.vol = 0;
    this.vti = 0;
    this.vte = 0;
    this.peakInspFlow = 0;
    this.peakPaw = -Infinity;
  }

  /** Prime filters so the first samples do not ring from zero. */
  prime(paw: number, pes: number): void {
    this.paw.reset(paw);
    this.pes.reset(pes);
  }
}
