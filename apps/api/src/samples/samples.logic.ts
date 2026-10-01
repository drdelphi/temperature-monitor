/* Bucket sizes that land on round clock boundaries, so the series does not shift
   sideways when the chosen range moves by a few seconds. */
export const BUCKET_LADDER_SEC = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 10800, 21600, 43200, 86400,
] as const;

export const MIN_BUCKET_SEC = BUCKET_LADDER_SEC[0];
export const MAX_BUCKET_SEC = BUCKET_LADDER_SEC[BUCKET_LADDER_SEC.length - 1];

/** Points per sensor a chart can draw before the line reads as noise. */
export const CHART_TARGET_POINTS = 800;

/** Ceiling for a hand-written downsample, so one request cannot ask for every row. */
export const MAX_BUCKETS = 5000;

export function snapBucketSec(sec: number): number {
  for (const step of BUCKET_LADDER_SEC) {
    if (sec <= step) return step;
  }
  return MAX_BUCKET_SEC;
}

export function autoBucketSec(spanMs: number, targetPoints = CHART_TARGET_POINTS): number {
  if (!(spanMs > 0) || targetPoints <= 0) return MIN_BUCKET_SEC;
  return snapBucketSec(spanMs / 1000 / targetPoints);
}

export function clampBucketSec(sec: number, spanMs: number): number {
  return Math.max(snapBucketSec(sec), autoBucketSec(spanMs, MAX_BUCKETS));
}
