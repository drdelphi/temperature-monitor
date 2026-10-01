import { describe, expect, it } from 'vitest';
import { devicePatchData, shouldConsumePendingTime } from './devices.logic';

describe('devicePatchData', () => {
  it('queues a clock update and bumps config rev', () => {
    expect(devicePatchData({ pendingUnixTime: 1_736_000_000 })).toEqual({
      pendingUnixTime: 1_736_000_000n,
      configRev: { increment: 1 },
    });
  });

  it('clears a queued clock without bumping config rev', () => {
    expect(devicePatchData({ pendingUnixTime: null })).toEqual({
      pendingUnixTime: null,
    });
  });

  it('leaves the clock queue alone when only the name changes', () => {
    expect(devicePatchData({ name: 'Freezer' })).toEqual({ name: 'Freezer' });
  });
});

describe('shouldConsumePendingTime', () => {
  it('consumes the queue only when the monitor itself fetches config', () => {
    expect(shouldConsumePendingTime('device')).toBe(true);
    expect(shouldConsumePendingTime('user')).toBe(false);
    expect(shouldConsumePendingTime(undefined)).toBe(false);
  });
});
