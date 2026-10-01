import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAL,
  adcToC,
  adcToOhm,
  isDefaultCal,
  offsetFromReference,
  rawFromReading,
  twoPointCal,
  uncorrectedFromReading,
} from './cal';

describe('calibration', () => {
  it('uses the 10 kΩ NTC 103 factory curve as default', () => {
    expect(DEFAULT_CAL).toEqual({ offset: 0, gain: 1, bValue: 3950 });
    expect(isDefaultCal(DEFAULT_CAL)).toBe(true);
    expect(isDefaultCal({ offset: 0, gain: 1, bValue: 3435 })).toBe(true);
    expect(isDefaultCal({ offset: 0.1, gain: 1, bValue: 3950 })).toBe(false);
  });

  it('sets offset so current reading becomes the reference', () => {
    const tempC = 21.4;
    const offset = 0.4;
    const uncorrected = uncorrectedFromReading(tempC, offset);
    const next = offsetFromReference(20, uncorrected);
    expect(uncorrected + next).toBeCloseTo(20);
  });

  it('fits two-point gain and offset', () => {
    const { gain, offset } = twoPointCal(0, 0.5, 100, 100.5);
    expect(gain).toBeCloseTo(1);
    expect(offset).toBeCloseTo(0.5);
    const raw = rawFromReading(25.5, gain, offset);
    expect(raw).toBeCloseTo(25);
  });

  it('maps mid-scale ADC to about 25 °C on the default NTC curve', () => {
    expect(adcToC(2048)).toBeCloseTo(25, 0);
    expect(adcToOhm(2048)).toBeCloseTo(10000 * 2048 / (4095 - 2048), 3);
    expect(adcToC(0)).toBeNull();
    expect(adcToC(4095)).toBeNull();
  });
});
