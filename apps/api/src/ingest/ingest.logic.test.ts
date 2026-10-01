import { describe, expect, it } from 'vitest';
import { ADC_DISABLED, DEFAULT_CAL, packSnapshot } from '../common/pack';
import {
  collapseByUniqueKey,
  ingestAckPayload,
  lastSeenViaForAuth,
  sampleUniqueKey,
  snapshotsToRows,
  type SampleRow,
} from './ingest.logic';

const cal = Array.from({ length: 8 }, (_, index) => ({
  index,
  ...DEFAULT_CAL,
}));

describe('ingest uniqueness', () => {
  it('collapses duplicate (deviceId, ts, channel) with last write wins', () => {
    const ts = new Date('2026-10-01T10:00:05.000Z');
    const rows: SampleRow[] = [
      { deviceId: 'AABBCCDDEEFF', ts, channel: 0, adcRaw: 100, rOhm: 1, tempC: 1 },
      { deviceId: 'AABBCCDDEEFF', ts, channel: 1, adcRaw: 200, rOhm: 2, tempC: 2 },
      { deviceId: 'AABBCCDDEEFF', ts, channel: 0, adcRaw: 300, rOhm: 3, tempC: 3 },
    ];
    const collapsed = collapseByUniqueKey(rows);
    expect(collapsed).toHaveLength(2);
    const ch0 = collapsed.find((r) => r.channel === 0)!;
    expect(ch0.adcRaw).toBe(300);
    expect(new Set(collapsed.map(sampleUniqueKey)).size).toBe(collapsed.length);
  });

  it('skips disabled 0xFFE and non-measurable adc, unique per channel', () => {
    const packed = Buffer.from(
      packSnapshot({
        year: 2026,
        month: 10,
        day: 1,
        hour: 10,
        minute: 0,
        second: 5,
        adc: [2048, ADC_DISABLED, 0, 4095, 2048, 2048, 2048, 2048],
      }),
    ).toString('base64');

    const duplicateJson = {
      ts: '2026-10-01T10:00:05.000Z',
      adc: [2048, ADC_DISABLED, 0, 4095, 2048, 2048, 2048, 2048],
    };

    const { rows, ackedTs } = snapshotsToRows(
      'AABBCCDDEEFF',
      [{ packed }, duplicateJson],
      cal,
    );

    expect(ackedTs?.toISOString()).toBe('2026-10-01T10:00:05.000Z');
    expect(rows.every((r) => r.adcRaw !== ADC_DISABLED)).toBe(true);
    expect(rows.some((r) => r.channel === 1 || r.channel === 2 || r.channel === 3)).toBe(false);
    expect(new Set(rows.map(sampleUniqueKey)).size).toBe(rows.length);
    expect(rows.map((r) => r.channel).sort()).toEqual([0, 4, 5, 6, 7]);
  });

  it('does not ACK an empty batch', () => {
    const { rows, ackedTs } = snapshotsToRows('AABBCCDDEEFF', [], cal);
    expect(rows).toEqual([]);
    expect(ackedTs).toBeNull();
    expect(ingestAckPayload(ackedTs, rows.length)).toEqual({
      ack: false,
      ackedTs: null,
      inserted: 0,
    });
  });

  it('ACKs the newest snapshot timestamp after rows are produced', () => {
    const disabled = Array.from({ length: 8 }, () => ADC_DISABLED);
    const { rows, ackedTs } = snapshotsToRows(
      'AABBCCDDEEFF',
      [
        {
          ts: '2026-10-01T10:00:05.000Z',
          adc: [2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048],
        },
        { ts: '2026-10-01T10:00:09.000Z', adc: disabled },
      ],
      cal,
    );
    expect(ackedTs?.toISOString()).toBe('2026-10-01T10:00:09.000Z');
    expect(rows.length).toBeGreaterThan(0);
    expect(ingestAckPayload(ackedTs, rows.length)).toEqual({
      ack: true,
      ackedTs: '2026-10-01T10:00:09.000Z',
      inserted: rows.length,
    });
  });

  it('stores unset RTC snapshots at ingest time so the live websocket can see them', () => {
    const now = new Date('2026-10-01T14:00:00.000Z');
    const { rows, ackedTs } = snapshotsToRows(
      'AABBCCDDEEFF',
      [
        {
          ts: '2000-01-01T00:00:05.000Z',
          adc: [2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048],
        },
      ],
      cal,
      now,
    );
    expect(ackedTs?.toISOString()).toBe('2000-01-01T00:00:05.000Z');
    expect(rows).toHaveLength(8);
    expect(rows[0].ts.toISOString()).toBe('2026-10-01T14:00:00.000Z');
    expect(rows[0].tempC).toBeCloseTo(25, 0);
  });
});

describe('lastSeen via', () => {
  it('marks device-token ingest as Wi-Fi and operator drain as local', () => {
    expect(lastSeenViaForAuth('device')).toBe('wifi');
    expect(lastSeenViaForAuth('operator')).toBe('local');
    expect(lastSeenViaForAuth(undefined)).toBe('local');
  });
});
