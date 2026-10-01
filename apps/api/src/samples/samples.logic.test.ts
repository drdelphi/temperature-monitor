import { describe, expect, it } from 'vitest';
import {
  autoBucketSec,
  clampBucketSec,
  MAX_BUCKET_SEC,
  MAX_BUCKETS,
  snapBucketSec,
} from './samples.logic';

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

describe('snapBucketSec', () => {
  it('rounds up to the next round bucket', () => {
    expect(snapBucketSec(0.2)).toBe(1);
    expect(snapBucketSec(18)).toBe(30);
    expect(snapBucketSec(61)).toBe(120);
  });

  it('stops at a day', () => {
    expect(snapBucketSec(10 * 86400)).toBe(MAX_BUCKET_SEC);
  });
});

describe('autoBucketSec', () => {
  it('keeps every range near the same point count', () => {
    for (const spanMs of [HOUR_MS, 4 * HOUR_MS, DAY_MS, 7 * DAY_MS, 30 * DAY_MS]) {
      const points = spanMs / 1000 / autoBucketSec(spanMs);
      expect(points).toBeLessThanOrEqual(800);
      expect(points).toBeGreaterThan(100);
    }
  });

  it('thins the four hours that used to come back raw', () => {
    expect(autoBucketSec(4 * HOUR_MS)).toBe(30);
  });

  it('leaves a short range at probe resolution', () => {
    expect(autoBucketSec(10 * 60_000)).toBe(1);
  });
});

describe('clampBucketSec', () => {
  it('honours a bucket the caller asked for', () => {
    expect(clampBucketSec(60, DAY_MS)).toBe(60);
  });

  it('widens a bucket that would return too many rows', () => {
    const bucket = clampBucketSec(1, 30 * DAY_MS);
    expect((30 * DAY_MS) / 1000 / bucket).toBeLessThanOrEqual(MAX_BUCKETS);
  });

  it('snaps an off-ladder request up', () => {
    expect(clampBucketSec(45, DAY_MS)).toBe(60);
  });
});
