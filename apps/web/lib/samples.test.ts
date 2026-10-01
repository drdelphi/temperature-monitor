import { describe, expect, it } from 'vitest';
import { coerceLiveTs, samplesFromAdc } from './samples';

describe('live sample timestamps', () => {
  it('keeps a recent probe timestamp', () => {
    const now = Date.parse('2026-10-01T14:00:00.000Z');
    expect(coerceLiveTs('2026-10-01T13:59:50Z', now)).toBe('2026-10-01T13:59:50.000Z');
  });

  it('replaces an unset RTC clock with arrival time', () => {
    const now = Date.parse('2026-10-01T14:00:00.000Z');
    expect(coerceLiveTs('2000-01-01T00:00:00Z', now)).toBe('2026-10-01T14:00:00.000Z');
  });
});

describe('samplesFromAdc', () => {
  it('converts a mid-scale snapshot to ~25 °C', () => {
    const rows = samplesFromAdc(
      '2026-10-01T14:00:00Z',
      [2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048],
      undefined,
      Date.parse('2026-10-01T14:00:00.000Z'),
    );
    expect(rows).toHaveLength(8);
    expect(rows[0].tempC).toBeCloseTo(25, 0);
  });
});
