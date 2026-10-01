import { CHANNEL_COUNT } from './config';
import type { Alarm, AlarmKind } from './types';

export type AlarmDraft = {
  enabled: boolean;
  thresholdC: string;
  hysteresis: string;
  cooldownSec: string;
  notifyTelegram: boolean;
  notifySms: boolean;
};

export function alarmKey(channel: number, kind: AlarmKind): string {
  return `${channel}-${kind}`;
}

export function emptyAlarmDraft(): AlarmDraft {
  return {
    enabled: false,
    thresholdC: '',
    hysteresis: '0.5',
    cooldownSec: '300',
    notifyTelegram: false,
    notifySms: false,
  };
}

export function alarmToDraft(a?: Alarm): AlarmDraft {
  if (!a) return emptyAlarmDraft();
  return {
    enabled: a.enabled,
    thresholdC: String(a.thresholdC),
    hysteresis: String(a.hysteresis),
    cooldownSec: String(a.cooldownSec),
    notifyTelegram: a.notifyTelegram,
    notifySms: a.notifySms,
  };
}

export function findAlarm(alarms: Alarm[], channel: number, kind: AlarmKind): Alarm | undefined {
  return alarms.find((a) => a.channel === channel && a.kind === kind);
}

export function draftsFromAlarms(alarms: Alarm[]): Record<string, AlarmDraft> {
  const next: Record<string, AlarmDraft> = {};
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    next[alarmKey(i, 'below')] = alarmToDraft(findAlarm(alarms, i, 'below'));
    next[alarmKey(i, 'above')] = alarmToDraft(findAlarm(alarms, i, 'above'));
  }
  return next;
}

export function isAlarmDirty(draft: AlarmDraft, saved: AlarmDraft): boolean {
  return (
    draft.enabled !== saved.enabled ||
    draft.thresholdC !== saved.thresholdC ||
    draft.hysteresis !== saved.hysteresis ||
    draft.cooldownSec !== saved.cooldownSec ||
    draft.notifyTelegram !== saved.notifyTelegram ||
    draft.notifySms !== saved.notifySms
  );
}

export function isAlarmsDirty(
  drafts: Record<string, AlarmDraft>,
  saved: Record<string, AlarmDraft>,
): boolean {
  const keys = new Set([...Object.keys(drafts), ...Object.keys(saved)]);
  for (const key of keys) {
    const draft = drafts[key];
    const keep = saved[key];
    if (!draft || !keep || isAlarmDirty(draft, keep)) return true;
  }
  return false;
}
