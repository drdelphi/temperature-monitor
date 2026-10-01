import { describe, expect, it } from 'vitest';
import { mergeSamples, coerceLiveTs } from './samples';
import { liveStreamUrl } from './ws';

describe('liveStreamUrl', () => {
  it('converts the API origin to a websocket stream URL', () => {
    expect(liveStreamUrl('http://localhost:4000', 'AABBCCDDEEFF')).toBe(
      'ws://localhost:4000/v1/stream?deviceId=AABBCCDDEEFF',
    );
    expect(liveStreamUrl('https://api.example/path/', 'aa:bb:cc:dd:ee:ff')).toBe(
      'wss://api.example/v1/stream?deviceId=aa%3Abb%3Acc%3Add%3Aee%3Aff',
    );
  });
});

describe('live websocket samples', () => {
  it('keeps API stream points in the live window', () => {
    const now = Date.parse('2026-10-01T14:00:00.000Z');
    const merged = mergeSamples(
      [],
      [
        {
          ts: '2026-10-01T13:59:50.000Z',
          channel: 0,
          tempC: 21.5,
          adcRaw: 2048,
          rOhm: 10000,
        },
      ],
      120_000,
      now,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].tempC).toBe(21.5);
  });

  it('keeps API points whose probe clock is still unset', () => {
    const now = Date.parse('2026-10-01T14:00:00.000Z');
    const merged = mergeSamples(
      [],
      [
        {
          ts: coerceLiveTs('2000-01-01T00:00:00.000Z', now),
          channel: 0,
          tempC: 21.5,
          adcRaw: 2048,
          rOhm: 10000,
        },
      ],
      120_000,
      now,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].ts).toBe('2026-10-01T14:00:00.000Z');
  });
});
