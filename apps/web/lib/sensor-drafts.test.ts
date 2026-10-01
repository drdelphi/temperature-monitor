import { describe, expect, it } from 'vitest';
import {
  channelPatchBody,
  channelToDraft,
  draftsFromChannels,
  isSensorsDirty,
  normalizeDraft,
  validateDrafts,
} from './sensor-drafts';

const ch0 = {
  index: 0,
  name: 'Probe A',
  enabled: true,
  intervalSec: 10,
  offset: 0,
  gain: 1,
  bValue: 3950,
};

describe('sensor drafts', () => {
  it('treats matching drafts as clean', () => {
    const saved = draftsFromChannels([ch0]);
    expect(isSensorsDirty(saved, saved)).toBe(false);
  });

  it('marks name, interval, enable, and cal edits as dirty', () => {
    const saved = draftsFromChannels([ch0]);
    expect(isSensorsDirty({ 0: { ...saved[0], name: 'Oven' } }, saved)).toBe(true);
    expect(isSensorsDirty({ 0: { ...saved[0], intervalSec: '15' } }, saved)).toBe(true);
    expect(isSensorsDirty({ 0: { ...saved[0], enabled: false } }, saved)).toBe(true);
    expect(isSensorsDirty({ 0: { ...saved[0], offset: 0.4 } }, saved)).toBe(true);
  });

  it('builds a patch with only changed fields', () => {
    const saved = channelToDraft(ch0);
    expect(channelPatchBody({ ...saved, name: ' Oven ' }, saved)).toEqual({ name: 'Oven' });
    expect(channelPatchBody({ ...saved, intervalSec: '15' }, saved)).toEqual({ intervalSec: 15 });
    expect(channelPatchBody({ ...saved, enabled: false, offset: 0.2 }, saved)).toEqual({
      enabled: false,
      offset: 0.2,
    });
    expect(channelPatchBody({ ...saved, name: ' Probe A ' }, saved)).toBeNull();
  });

  it('rejects blank names and intervals below 1 second', () => {
    const saved = channelToDraft(ch0);
    expect(validateDrafts({ 0: { ...saved, name: '  ' } })).toMatch(/name/);
    expect(validateDrafts({ 0: { ...saved, intervalSec: '0' } })).toMatch(/1 second/);
    expect(validateDrafts({ 0: saved })).toBeNull();
  });

  it('normalizes trimmed names and whole-second intervals', () => {
    expect(normalizeDraft(channelToDraft({ ...ch0, name: '  A  ', intervalSec: 12 })).name).toBe('A');
    expect(normalizeDraft({ ...channelToDraft(ch0), intervalSec: '7.9' }).intervalSec).toBe('7');
  });
});
