/** Typical 10 kΩ NTC 103 (B3950) probe: identity gain/offset on the β curve. */
export const DEFAULT_CAL = {
  offset: 0,
  gain: 1,
  bValue: 3950,
} as const;

export function isDefaultCal(c: { offset: number; gain: number; bValue?: number }): boolean {
  return c.offset === DEFAULT_CAL.offset && c.gain === DEFAULT_CAL.gain;
}

/** Uncorrected = reading with gain applied, offset removed. */
export function uncorrectedFromReading(tempC: number, offset: number): number {
  return tempC - offset;
}

/** One-point: current uncorrected reading should become refC. */
export function offsetFromReference(refC: number, uncorrected: number): number {
  return refC - uncorrected;
}

export function twoPointCal(
  raw1: number,
  ref1: number,
  raw2: number,
  ref2: number,
): { gain: number; offset: number } {
  const den = raw2 - raw1;
  if (den === 0) {
    throw new Error('Use two different temperatures to finish this adjustment.');
  }
  const gain = (ref2 - ref1) / den;
  const offset = ref1 - gain * raw1;
  return { gain, offset };
}

export function rawFromReading(tempC: number, gain: number, offset: number): number {
  if (gain === 0) return tempC - offset;
  return (tempC - offset) / gain;
}

const ADC_FULL_SCALE = 4095;
const R25_OHM = 10000;
const T25_K = 298.15;

export function adcToOhm(adc: number): number | null {
  if (!(adc > 0) || adc >= ADC_FULL_SCALE) return null;
  return (R25_OHM * adc) / (ADC_FULL_SCALE - adc);
}

export function adcToC(
  adc: number,
  bValue: number = DEFAULT_CAL.bValue,
  gain: number = DEFAULT_CAL.gain,
  offset: number = DEFAULT_CAL.offset,
): number | null {
  const r = adcToOhm(adc);
  if (r == null || !(bValue > 0)) return null;
  const inv = 1 / T25_K + Math.log(r / R25_OHM) / bValue;
  const t = 1 / inv - 273.15;
  if (!Number.isFinite(t)) return null;
  return gain * t + offset;
}

