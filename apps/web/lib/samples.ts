import type { Channel, Sample } from './types';
import { adcToC, adcToOhm } from './cal';
import { CHANNEL_COUNT } from './config';

const LIVE_TS_SLACK_MS = 5 * 60_000;

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

export function sparkPoints(samples: Sample[], channel: number): Array<{ t: string; v: number }> {
  return samples
    .filter((s) => s.channel === channel && s.tempC != null && Number.isFinite(s.tempC))
    .map((s) => ({ t: s.ts, v: s.tempC as number }));
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
