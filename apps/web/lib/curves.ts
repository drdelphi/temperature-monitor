/** Common 10 kΩ @ 25 °C NTC curves. The board divider is 10 kΩ. */

export const CUSTOM_CURVE_ID = 'custom';

export const B_VALUE_MIN = 1000;
export const B_VALUE_MAX = 8000;

export type NtcCurve = {
  id: string;
  label: string;
  bValue: number;
};

export const NTC_CURVES: readonly NtcCurve[] = [
  { id: 'type-ii', label: 'Type II (B3950)', bValue: 3950 },
  { id: '103at', label: 'Semitec 103AT (B3435)', bValue: 3435 },
  { id: 'b3470', label: 'B3470', bValue: 3470 },
  { id: 'type-iii', label: 'Type III (B3977)', bValue: 3977 },
  { id: 'b4100', label: 'B4100', bValue: 4100 },
  { id: 'b4250', label: 'B4250', bValue: 4250 },
];

export function namedCurveForBValue(bValue: number): NtcCurve | undefined {
  if (!Number.isFinite(bValue)) return undefined;
  return NTC_CURVES.find((c) => c.bValue === bValue);
}

export function curveIdForBValue(bValue: number, custom = false): string {
  if (custom) return CUSTOM_CURVE_ID;
  return namedCurveForBValue(bValue)?.id ?? CUSTOM_CURVE_ID;
}

export function bValueForCurveId(id: string): number | undefined {
  return NTC_CURVES.find((c) => c.id === id)?.bValue;
}

export function isValidBValue(bValue: number): boolean {
  return Number.isFinite(bValue) && bValue >= B_VALUE_MIN && bValue <= B_VALUE_MAX;
}
