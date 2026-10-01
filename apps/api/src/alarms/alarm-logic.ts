import { AlarmKind } from '@prisma/client';

export type AlarmSnapshot = {
  enabled: boolean;
  kind: AlarmKind | 'above' | 'below';
  thresholdC: number;
  hysteresis: number;
  cooldownSec: number;
  active: boolean;
  lastFiredAt: Date | null;
};

export type AlarmDecision = 'fired' | 'cleared' | null;

export function inAlarmZone(alarm: AlarmSnapshot, tempC: number): boolean {
  if (alarm.kind === 'above') {
    return tempC >= alarm.thresholdC;
  }
  return tempC <= alarm.thresholdC;
}

export function inClearZone(alarm: AlarmSnapshot, tempC: number): boolean {
  if (alarm.kind === 'above') {
    return tempC <= alarm.thresholdC - alarm.hysteresis;
  }
  return tempC >= alarm.thresholdC + alarm.hysteresis;
}

export function canFire(alarm: AlarmSnapshot, sampleTs: Date): boolean {
  if (!alarm.lastFiredAt) {
    return true;
  }
  return sampleTs.getTime() - alarm.lastFiredAt.getTime() >= alarm.cooldownSec * 1000;
}

export function evaluateAlarmSample(
  alarm: AlarmSnapshot,
  tempC: number,
  sampleTs: Date,
): AlarmDecision {
  if (!alarm.enabled || !Number.isFinite(tempC)) {
    return null;
  }
  if (alarm.active) {
    if (inClearZone(alarm, tempC)) {
      return 'cleared';
    }
    return null;
  }
  if (inAlarmZone(alarm, tempC) && canFire(alarm, sampleTs)) {
    return 'fired';
  }
  return null;
}

export function applyAlarmDecision(
  alarm: AlarmSnapshot,
  decision: AlarmDecision,
  sampleTs: Date,
): void {
  if (decision === 'fired') {
    alarm.active = true;
    alarm.lastFiredAt = sampleTs;
  } else if (decision === 'cleared') {
    alarm.active = false;
  }
}

export function replayAlarmSamples(
  alarm: AlarmSnapshot,
  samples: Array<{ tempC: number; ts: Date }>,
): AlarmDecision[] {
  const out: AlarmDecision[] = [];
  for (const sample of samples) {
    const decision = evaluateAlarmSample(alarm, sample.tempC, sample.ts);
    if (decision) {
      applyAlarmDecision(alarm, decision, sample.ts);
      out.push(decision);
    }
  }
  return out;
}

export function formatAlarmMessage(opts: {
  deviceName: string;
  channelName: string;
  kind: string;
  thresholdC: number;
  tempC: number;
  ts: Date;
}): string {
  const when = opts.kind === 'below' ? 'too cold' : opts.kind === 'above' ? 'too hot' : opts.kind;
  const time = opts.ts.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  return [
    `Temperature alert: ${when}`,
    `Monitor: ${opts.deviceName}`,
    `Sensor: ${opts.channelName}`,
    `Limit: ${opts.thresholdC.toFixed(2)} °C`,
    `Now: ${opts.tempC.toFixed(2)} °C`,
    `Time: ${time}`,
  ].join('\n');
}
