import { describe, expect, it } from 'vitest';
import { cookieValue, originAllowed, parseStreamUpgrade, publicLiveSample } from './sample-ws.logic';

describe('sample-ws.logic', () => {
  it('reads a named cookie', () => {
    expect(cookieValue('tm_session=abc; other=1', 'tm_session')).toBe('abc');
    expect(cookieValue('other=1', 'tm_session')).toBeNull();
    expect(cookieValue(undefined, 'tm_session')).toBeNull();
  });

  it('allows listed origins only', () => {
    const allowed = ['http://localhost:3000'];
    expect(originAllowed('http://localhost:3000', allowed)).toBe(true);
    expect(originAllowed('http://127.0.0.1:3000', allowed)).toBe(true);
    expect(originAllowed('http://evil.example', allowed)).toBe(false);
    expect(originAllowed(undefined, allowed)).toBe(false);
  });

  it('parses the live stream upgrade path', () => {
    expect(parseStreamUpgrade('/v1/stream?deviceId=aa:bb:cc:dd:ee:ff')).toEqual({
      match: true,
      deviceId: 'AABBCCDDEEFF',
    });
    expect(parseStreamUpgrade('/v1/samples')).toEqual({ match: false });
    expect(parseStreamUpgrade('/v1/stream')).toEqual({ match: true, deviceId: null });
  });

  it('serializes sample timestamps', () => {
    expect(
      publicLiveSample({
        deviceId: 'AABBCCDDEEFF',
        channel: 1,
        ts: new Date('2026-10-01T12:00:00.000Z'),
        tempC: 21.5,
        rOhm: 10000,
        adcRaw: 2048,
      }),
    ).toEqual({
      deviceId: 'AABBCCDDEEFF',
      channel: 1,
      ts: '2026-10-01T12:00:00.000Z',
      tempC: 21.5,
      rOhm: 10000,
      adcRaw: 2048,
    });
  });
});
