import { describe, expect, it } from 'vitest';
import { replayAlarmSamples, type AlarmSnapshot } from './alarm-logic';

function alarm(overrides: Partial<AlarmSnapshot> = {}): AlarmSnapshot {
  return {
    enabled: true,
    kind: 'above',
    thresholdC: 8,
    hysteresis: 0.5,
    cooldownSec: 300,
    active: false,
    lastFiredAt: null,
    ...overrides,
  };
}

function samples(values: Array<[number, string]>) {
  return values.map(([tempC, iso]) => ({ tempC, ts: new Date(iso) }));
}

describe('alarm hysteresis', () => {
  it('fires once for many samples above threshold', () => {
    const a = alarm();
    const xs = Array.from({ length: 40 }, (_, i) => ({
      tempC: 9,
      ts: new Date(Date.UTC(2026, 9, 1, 0, 0, i)),
    }));
    const actions = replayAlarmSamples(a, xs);
    expect(actions.filter((x) => x === 'fired')).toHaveLength(1);
    expect(actions.filter((x) => x === 'cleared')).toHaveLength(0);
    expect(a.active).toBe(true);
  });

  it('clears only after dropping below hysteresis and fires again on re-entry', () => {
    const a = alarm();
    const actions = replayAlarmSamples(
      a,
      samples([
        [9, '2026-10-01T00:00:00Z'],
        [8.2, '2026-10-01T00:00:01Z'],
        [7.6, '2026-10-01T00:00:02Z'],
        [7.4, '2026-10-01T00:00:03Z'],
        [9, '2026-10-01T00:05:01Z'],
      ]),
    );
    expect(actions).toEqual(['fired', 'cleared', 'fired']);
    expect(a.active).toBe(true);
  });

  it('respects cooldown after a clear', () => {
    const a = alarm({ cooldownSec: 300 });
    const actions = replayAlarmSamples(
      a,
      samples([
        [10, '2026-10-01T00:00:00Z'],
        [7, '2026-10-01T00:00:10Z'],
        [10, '2026-10-01T00:01:00Z'],
        [7, '2026-10-01T00:01:10Z'],
        [10, '2026-10-01T00:05:00Z'],
      ]),
    );
    expect(actions).toEqual(['fired', 'cleared', 'fired']);
    expect(a.active).toBe(true);
  });

  it('below alarms fire once until hysteresis clear', () => {
    const a = alarm({ kind: 'below', thresholdC: -18, hysteresis: 1 });
    const actions = replayAlarmSamples(
      a,
      samples([
        [-20, '2026-10-01T00:00:00Z'],
        [-19, '2026-10-01T00:00:01Z'],
        [-17.5, '2026-10-01T00:00:02Z'],
        [-16.5, '2026-10-01T00:00:03Z'],
        [-20, '2026-10-01T00:06:00Z'],
      ]),
    );
    expect(actions).toEqual(['fired', 'cleared', 'fired']);
  });
});
