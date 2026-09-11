import { describe, expect, it } from 'vitest';
import { k } from '@/config/constants';
import { balloonTransmission, balloonWallPressure, defaultBalloon, pesFromPleural } from '@sim/patient/balloon';

describe('esophageal balloon cardiac artifact', () => {
  const b = { ...defaultBalloon(), enabled: true };
  const hr = 80;
  const period = 60 / hr;
  const inputs = (t: number) => ({ pplAtBalloon: 5, pmusEff: 0, ecwV: 0, t, heartRate: hr });
  const beat = Array.from({ length: 1000 }, (_, i) => pesFromPleural(b, inputs((i / 1000) * period)));
  const model = balloonTransmission(b.fillVolume, b.position) * 5 + k('PES_OFFSET_SUPINE') + balloonWallPressure(b.fillVolume);

  it('is a pulse at the heart rate with the cited peak-to-peak amplitude, not a full-swing sinusoid', () => {
    const max = Math.max(...beat);
    const min = Math.min(...beat);
    expect(max - min).toBeCloseTo(k('PES_CARDIAC_PP'), 3);
    // A systolic bump spends most of the beat near baseline; a sinusoid is above its midpoint half the time.
    const mid = 0.5 * (max + min);
    const above = beat.filter((v) => v > mid).length / beat.length;
    expect(above).toBeLessThan(0.4);
    // One beat later the artifact repeats.
    expect(pesFromPleural(b, inputs(0.2))).toBeCloseTo(pesFromPleural(b, inputs(0.2 + period)), 6);
  });

  it('averages to the model Pes over a beat, so end-expiratory readings are unbiased', () => {
    const mean = beat.reduce((a, v) => a + v, 0) / beat.length;
    expect(mean).toBeCloseTo(model, 2);
  });
});
