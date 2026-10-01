import { describe, expect, it } from 'vitest';
import { alarmKey, alarmToDraft, draftsFromAlarms, emptyAlarmDraft, isAlarmsDirty } from './alarm-drafts';
import type { Alarm } from './types';

const below: Alarm = {
  channel: 0,
  kind: 'below',
  enabled: true,
  thresholdC: 2,
  hysteresis: 0.5,
  cooldownSec: 300,
  notifyTelegram: true,
  notifySms: false,
};

describe('alarm drafts', () => {
  it('treats matching drafts as clean', () => {
    const saved = draftsFromAlarms([below]);
    expect(isAlarmsDirty(saved, saved)).toBe(false);
  });

  it('marks enable, limit, and notify edits as dirty', () => {
    const saved = draftsFromAlarms([below]);
    const k = alarmKey(0, 'below');
    expect(isAlarmsDirty({ ...saved, [k]: { ...saved[k], enabled: false } }, saved)).toBe(true);
    expect(isAlarmsDirty({ ...saved, [k]: { ...saved[k], thresholdC: '4' } }, saved)).toBe(true);
    expect(isAlarmsDirty({ ...saved, [k]: { ...saved[k], notifySms: true } }, saved)).toBe(true);
  });

  it('uses empty defaults when an alarm is missing', () => {
    expect(alarmToDraft()).toEqual(emptyAlarmDraft());
    const drafts = draftsFromAlarms([]);
    expect(drafts[alarmKey(0, 'above')]).toEqual(emptyAlarmDraft());
  });
});
