import type { Channel, Sample } from './types';
import { adcToC, adcToOhm } from './cal';
import { CHANNEL_COUNT } from './config';
import { startOfLocalDay } from './format';

const LIVE_TS_SLACK_MS = 5 * 60_000;
const AUTO_MINUTE_SPAN_MS = 6 * 3600_000;
const AUTO_FIVE_MINUTE_SPAN_MS = 7 * 24 * 3600_000;

/** Match API auto-downsample so live points use the same buckets as the day history. */
export function autoDownsampleSec(fromMs: number, toMs: number): 60 | 300 | null {
  const span = toMs - fromMs;
  if (span > AUTO_FIVE_MINUTE_SPAN_MS) return 300;
  if (span > AUTO_MINUTE_SPAN_MS) return 60;
  return null;
}

export function downsampleSamples(samples: Sample[], bucketSec: number): Sample[] {
  if (bucketSec <= 0) return samples;
  const bucketMs = bucketSec * 1000;
  type Acc = {
    ts: string;
    channel: number;
    tempSum: number;
    tempN: number;
    rSum: number;
    rN: number;
    adcSum: number;
    adcN: number;
  };
  const map = new Map<string, Acc>();
  for (const s of samples) {
    const t = Date.parse(s.ts);
    if (!Number.isFinite(t)) continue;
    const bucket = Math.floor(t / bucketMs) * bucketMs;
    const key = `${bucket}|${s.channel}`;
    let acc = map.get(key);
    if (!acc) {
      acc = {
        ts: new Date(bucket).toISOString(),
        channel: s.channel,
        tempSum: 0,
        tempN: 0,
        rSum: 0,
        rN: 0,
        adcSum: 0,
        adcN: 0,
      };
      map.set(key, acc);
    }
    if (s.tempC != null) {
      acc.tempSum += s.tempC;
      acc.tempN += 1;
    }
    if (s.rOhm != null) {
      acc.rSum += s.rOhm;
      acc.rN += 1;
    }
    if (s.adcRaw != null) {
      acc.adcSum += s.adcRaw;
      acc.adcN += 1;
    }
  }
  return [...map.values()]
    .map((acc) => ({
      ts: acc.ts,
      channel: acc.channel,
      tempC: acc.tempN ? acc.tempSum / acc.tempN : null,
      rOhm: acc.rN ? acc.rSum / acc.rN : null,
      adcRaw: acc.adcN ? Math.round(acc.adcSum / acc.adcN) : null,
    }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.channel - b.channel));
}

export function liveChartSamples(samples: Sample[], now = Date.now()): Sample[] {
  const from = startOfLocalDay(new Date(now)).getTime();
  const bucketSec = autoDownsampleSec(from, now);
  return bucketSec ? downsampleSamples(samples, bucketSec) : samples;
}

/** If the probe clock is unset, use arrival time so live points stay in the window. */
export function coerceLiveTs(ts: string, now = Date.now()): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t) || Math.abs(now - t) > LIVE_TS_SLACK_MS) {
    return new Date(now).toISOString();
  }
  return new Date(t).toISOString();
}

export function samplesFromAdc(
  ts: string,
  adc: number[],
  channels?: Channel[],
  now = Date.now(),
): Sample[] {
  const when = coerceLiveTs(ts, now);
  const n = Math.min(CHANNEL_COUNT, adc.length);
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const ch = channels?.find((c) => c.index === i);
    const raw = adc[i];
    out.push({
      ts: when,
      channel: i,
      adcRaw: raw,
      rOhm: adcToOhm(raw),
      tempC: adcToC(raw, ch?.bValue, ch?.gain, ch?.offset),
    });
  }
  return out;
}

export function mergeSamples(prev: Sample[], incoming: Sample[], windowMs = 120_000, now = Date.now()): Sample[] {
  const cutoff = new Date(now - windowMs).toISOString();
  const map = new Map<string, Sample>();
  for (const s of prev.concat(incoming)) {
    if (s.ts < cutoff) continue;
    map.set(`${s.ts}|${s.channel}`, s);
  }
  return [...map.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.channel - b.channel));
}

export function latestByChannel(samples: Sample[]): Map<number, Sample> {
  const map = new Map<number, Sample>();
  for (const s of samples) {
    const cur = map.get(s.channel);
    if (!cur || s.ts >= cur.ts) map.set(s.channel, s);
  }
  return map;
}

export function mergeDaySamples(base: Sample[], extra: Sample[], now = Date.now()): Sample[] {
  const from = startOfLocalDay(new Date(now));
  return mergeSamples(base, extra, now - from.getTime() + 60_000, now);
}

export function historyRows(
  samples: Sample[],
  channels: number[],
): Array<Record<string, string | number>> {
  const byTs = new Map<string, Record<string, string | number>>();
  for (const s of samples) {
    if (!channels.includes(s.channel) || s.tempC == null) continue;
    const row = byTs.get(s.ts) ?? { t: s.ts };
    row[`c${s.channel}`] = s.tempC;
    byTs.set(s.ts, row);
  }
  return [...byTs.values()].sort((a, b) => String(a.t).localeCompare(String(b.t)));
}
