import { describe, expect, it } from 'vitest';
import { DEFAULT_CAL } from './cal';
import {
  B_VALUE_MAX,
  B_VALUE_MIN,
  CUSTOM_CURVE_ID,
  NTC_CURVES,
  bValueForCurveId,
  curveIdForBValue,
  isValidBValue,
  namedCurveForBValue,
} from './curves';

describe('NTC curves', () => {
  it('lists distinct 10 kΩ curves and includes the factory Type II', () => {
    const ids = NTC_CURVES.map((c) => c.id);
    const bValues = NTC_CURVES.map((c) => c.bValue);
    expect(new Set(ids).size).toBe(NTC_CURVES.length);
    expect(new Set(bValues).size).toBe(NTC_CURVES.length);
    expect(namedCurveForBValue(DEFAULT_CAL.bValue)?.id).toBe('type-ii');
  });

  it('maps known B values to named curves and unknown to custom', () => {
    expect(curveIdForBValue(3435)).toBe('103at');
    expect(bValueForCurveId('103at')).toBe(3435);
    expect(curveIdForBValue(4123)).toBe(CUSTOM_CURVE_ID);
    expect(curveIdForBValue(3950, true)).toBe(CUSTOM_CURVE_ID);
    expect(namedCurveForBValue(Number.NaN)).toBeUndefined();
  });

  it('accepts B in a typical NTC range', () => {
    expect(isValidBValue(B_VALUE_MIN)).toBe(true);
    expect(isValidBValue(B_VALUE_MAX)).toBe(true);
    expect(isValidBValue(B_VALUE_MIN - 1)).toBe(false);
    expect(isValidBValue(B_VALUE_MAX + 1)).toBe(false);
    expect(isValidBValue(Number.NaN)).toBe(false);
  });
});
