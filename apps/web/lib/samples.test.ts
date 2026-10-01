import { describe, expect, it } from 'vitest';
import {
  chartBucketSec,
  coerceLiveTs,
  downsampleSamples,
  historyRows,
  liveChartSamples,
  mergeDaySamples,
  samplesFromAdc,
} from './samples';
import { startOfLocalDay } from './format';

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

describe('historyRows', () => {
  it('pivots samples onto a timestamp row per channel', () => {
    expect(
      historyRows(
        [
          { ts: '2026-10-01T10:00:00.000Z', channel: 0, tempC: 21, adcRaw: null, rOhm: null },
          { ts: '2026-10-01T10:00:00.000Z', channel: 1, tempC: 22, adcRaw: null, rOhm: null },
          { ts: '2026-10-01T10:01:00.000Z', channel: 0, tempC: 21.5, adcRaw: null, rOhm: null },
        ],
        [0, 1],
      ),
    ).toEqual([
      { t: '2026-10-01T10:00:00.000Z', c0: 21, c1: 22 },
      { t: '2026-10-01T10:01:00.000Z', c0: 21.5 },
    ]);
  });
});

describe('chartBucketSec', () => {
  it('uses raw points for a short range', () => {
    expect(chartBucketSec(0, 10 * 60_000)).toBe(1);
  });

  it('thins four hours instead of drawing every second', () => {
    expect(chartBucketSec(0, 4 * 3600_000)).toBe(30);
  });

  it('holds the point count steady across wildly different ranges', () => {
    for (const span of [3600_000, 4 * 3600_000, 24 * 3600_000, 7 * 24 * 3600_000, 30 * 24 * 3600_000]) {
      const points = span / 1000 / chartBucketSec(0, span);
      expect(points).toBeLessThanOrEqual(800);
      expect(points).toBeGreaterThan(100);
    }
  });

  it('matches the bucket the API picks for the same span', () => {
    expect(chartBucketSec(0, 7 * 24 * 3600_000)).toBe(900);
    expect(chartBucketSec(0, 30 * 24 * 3600_000)).toBe(3600);
  });
});

describe('downsampleSamples', () => {
  it('averages points that share a 1-minute bucket', () => {
    const out = downsampleSamples(
      [
        { ts: '2026-10-01T16:00:00.000Z', channel: 0, tempC: 20, adcRaw: 10, rOhm: 100 },
        { ts: '2026-10-01T16:00:30.000Z', channel: 0, tempC: 22, adcRaw: 20, rOhm: 200 },
        { ts: '2026-10-01T16:01:00.000Z', channel: 0, tempC: 24, adcRaw: 30, rOhm: 300 },
      ],
      60,
    );
    expect(out).toEqual([
      { ts: '2026-10-01T16:00:00.000Z', channel: 0, tempC: 21, adcRaw: 15, rOhm: 150 },
      { ts: '2026-10-01T16:01:00.000Z', channel: 0, tempC: 24, adcRaw: 30, rOhm: 300 },
    ]);
  });
});

describe('liveChartSamples', () => {
  it('folds 1-second live points into the same minute as downsampled history', () => {
    const now = new Date(2026, 9, 1, 19, 0, 40).getTime();
    const minute = new Date(Math.floor(now / 60_000) * 60_000).toISOString();
    const out = liveChartSamples(
      [
        { ts: minute, channel: 0, tempC: 20, adcRaw: 1, rOhm: 1 },
        { ts: new Date(now - 10_000).toISOString(), channel: 0, tempC: 22, adcRaw: 1, rOhm: 1 },
        { ts: new Date(now).toISOString(), channel: 0, tempC: 24, adcRaw: 1, rOhm: 1 },
      ],
      60,
    );
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe(minute);
    expect(out[0].tempC).toBe(22);
  });

  it('leaves raw points when the day query asked for probe resolution', () => {
    const now = new Date(2026, 9, 1, 5, 0, 0).getTime();
    const samples = [
      { ts: new Date(now - 1000).toISOString(), channel: 0, tempC: 20, adcRaw: 1, rOhm: 1 },
      { ts: new Date(now).toISOString(), channel: 0, tempC: 21, adcRaw: 1, rOhm: 1 },
    ];
    expect(liveChartSamples(samples, 1)).toEqual(samples);
  });
});

describe('mergeDaySamples', () => {
  it('keeps samples from the start of the local day', () => {
    const now = new Date(2026, 9, 1, 14, 0, 0).getTime();
    const today = startOfLocalDay(new Date(now)).toISOString();
    const yesterday = new Date(now - 24 * 3600_000).toISOString();
    const merged = mergeDaySamples(
      [{ ts: yesterday, channel: 0, tempC: 10, adcRaw: 1, rOhm: 1 }],
      [{ ts: today, channel: 0, tempC: 20, adcRaw: 1, rOhm: 1 }],
      now,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].tempC).toBe(20);
  });
});
