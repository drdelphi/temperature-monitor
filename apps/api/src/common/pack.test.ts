import { describe, expect, it } from 'vitest';
import {
  ADC_DISABLED,
  CHANNEL_COUNT,
  DEFAULT_CAL,
  RECORD_SIZE,
  adcToC,
  adcToOhm,
  decodePackedBase64,
  expandIngestSnapshot,
  isDisabledAdc,
  isMeasurableAdc,
  packSnapshot,
  snapshotFromDate,
  snapshotToDate,
  unpackSnapshot,
  type Snapshot,
} from './pack';

const snap: Snapshot = {
  year: 2026,
  month: 10,
  day: 1,
  hour: 13,
  minute: 30,
  second: 45,
  adc: [0, 1, 2048, 4095, ADC_DISABLED, 12, 100, 4000],
};

describe('pack', () => {
  it('roundtrips 17-byte snapshots', () => {
    const buf = packSnapshot(snap);
    expect(buf.length).toBe(RECORD_SIZE);
    expect(RECORD_SIZE).toBe(17);
    expect(unpackSnapshot(buf)).toEqual(snap);
  });

  it('maps adc 2048 to about 25C', () => {
    expect(adcToOhm(2048)).toBeCloseTo((10000 * 2048) / (4095 - 2048), 5);
    const t = adcToC(2048, DEFAULT_CAL.bValue, DEFAULT_CAL.gain, DEFAULT_CAL.offset);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(25, 1);
    expect(adcToC(2048)).toBeCloseTo(t!, 6);
    expect(adcToC(2048, DEFAULT_CAL.bValue, 1.1, -0.5)).toBeCloseTo(1.1 * t! - 0.5, 6);
  });

  it('treats 0xFFE as disabled', () => {
    expect(ADC_DISABLED).toBe(0xffe);
    expect(isDisabledAdc(0xffe)).toBe(true);
    expect(isMeasurableAdc(0xffe)).toBe(false);
    expect(isMeasurableAdc(2048)).toBe(true);
  });

  it('expandIngestSnapshot accepts packed base64', () => {
    const packed = Buffer.from(packSnapshot(snap)).toString('base64');
    const { ts, adc } = expandIngestSnapshot({ packed });
    expect(adc).toEqual(snap.adc);
    expect(adc).toHaveLength(CHANNEL_COUNT);
    expect(ts.toISOString()).toBe(snapshotToDate(snap).toISOString());
    expect(decodePackedBase64(packed).adc[4]).toBe(ADC_DISABLED);
  });

  it('expandIngestSnapshot accepts ts+adc json', () => {
    const { ts, adc } = expandIngestSnapshot({
      ts: '2026-10-01T10:00:05Z',
      adc: [2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048],
    });
    expect(ts.toISOString()).toBe('2026-10-01T10:00:05.000Z');
    expect(adc).toEqual([2048, 2048, 2048, 2048, 2048, 2048, 2048, 2048]);
  });

  it('snapshotFromDate uses UTC fields', () => {
    const date = new Date('2026-10-01T13:30:45.000Z');
    const s = snapshotFromDate(date, snap.adc);
    expect(s.year).toBe(2026);
    expect(s.hour).toBe(13);
    expect(s.second).toBe(45);
  });
});
