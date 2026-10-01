import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import {
  alarmKindLabel,
  connectionKinds,
  connectionLabel,
  errorMessage,
  explainUsbOpenError,
  dayAxisTicks,
  formatDayAxisTick,
  formatRtcDateTime,
  formatTsMinute,
  liveRtcUnix,
  unixFromIso,
  linkBarLabel,
  localDayDomain,
  liveDayDomain,
  startOfLocalDay,
  transportLabel,
  wifiAuthLabel,
  wifiSignalLabel,
  wifiStateLabel,
} from './format';

describe('explainUsbOpenError', () => {
  it('maps a failed USB open to a plain retry hint', () => {
    const err = new DOMException('Failed to open serial port.', 'NetworkError');
    expect(explainUsbOpenError(err)).toMatch(/USB connection/i);
    expect(explainUsbOpenError(err)).not.toMatch(/dialout|ttyACM|idf\.py|JTAG/i);
  });

  it('maps already-open to disconnect first', () => {
    const err = new DOMException('The port is already open.', 'InvalidStateError');
    expect(explainUsbOpenError(err)).toMatch(/already in use/i);
    expect(explainUsbOpenError(err)).toMatch(/Disconnect/i);
    expect(explainUsbOpenError(err)).not.toMatch(/idf\.py/i);
  });

  it('does not pass technical details through', () => {
    expect(explainUsbOpenError(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});

describe('errorMessage', () => {
  it('maps API JSON bodies to plain language', () => {
    const err = new ApiError(404, JSON.stringify({ statusCode: 404, message: 'Device not found' }));
    expect(errorMessage(err)).toBe('This monitor was not found.');
  });

  it('hides HTTP status text', () => {
    expect(errorMessage(new ApiError(500, 'Internal Server Error'))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('maps network failures', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(
      'Could not reach the server. Check your connection and try again.',
    );
  });

  it('maps a dropped USB device without keeping Chrome’s wording', () => {
    expect(errorMessage(new DOMException('The device has been lost.', 'NetworkError'))).toBe(
      'The USB connection was lost. Please connect again.',
    );
  });

  it('keeps already-friendly sentences', () => {
    expect(errorMessage(new Error('The monitor is not connected.'))).toBe(
      'The monitor is not connected.',
    );
  });

  it('maps password-change failures', () => {
    expect(errorMessage(new ApiError(401, JSON.stringify({ message: 'Current password is incorrect.' })))).toBe(
      'Current password is incorrect.',
    );
    expect(errorMessage(new ApiError(400, JSON.stringify({ message: 'newPassword must be longer than or equal to 8 characters' })))).toBe(
      'Use at least 8 characters for the new password.',
    );
    expect(errorMessage(new ApiError(400, JSON.stringify({ message: 'bValue must not be less than 1000' })))).toBe(
      'Enter a B value between 1000 and 8000.',
    );
  });
});

describe('user-facing labels', () => {
  it('names transports plainly', () => {
    expect(transportLabel('usb')).toBe('USB');
    expect(transportLabel('ble')).toBe('Bluetooth');
    expect(linkBarLabel({ open: false, deviceId: null })).toBe('No monitor connected here');
    expect(linkBarLabel({ open: true, deviceId: null })).toBe('Connecting…');
    expect(linkBarLabel({ open: true, deviceId: 'AABBCCDDEEFF' })).toBe('Connected');
    expect(connectionLabel('wifi')).toBe('Wi-Fi');
    expect(connectionLabel('bluetooth')).toBe('Bluetooth');
    expect(connectionLabel('usb')).toBe('USB');
  });

  it('shows USB and Bluetooth from the live local link only', () => {
    expect(connectionKinds({ linked: true, transport: 'usb' })).toEqual(['usb']);
    expect(connectionKinds({ linked: true, transport: 'ble' })).toEqual(['bluetooth']);
  });

  it('shows Wi-Fi only while the monitor is actually on Wi-Fi', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(
      connectionKinds({
        linked: true,
        transport: 'usb',
        wifiInternet: true,
        wifiState: 'ingesting',
      }),
    ).toEqual(['wifi', 'usb']);
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:59:55Z',
        lastSeenVia: 'wifi',
        linked: false,
        now,
      }),
    ).toEqual(['wifi']);
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:59:00Z',
        lastSeenVia: 'wifi',
        linked: false,
        now,
      }),
    ).toEqual([]);
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:00:00Z',
        lastSeenVia: 'wifi',
        linked: false,
        now,
      }),
    ).toEqual([]);
  });

  it('does not treat USB drain as Wi-Fi', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:59:55Z',
        lastSeenVia: 'local',
        linked: false,
        now,
      }),
    ).toEqual([]);
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:59:55Z',
        linked: false,
        now,
      }),
    ).toEqual([]);
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:59:55Z',
        lastSeenVia: 'wifi',
        linked: true,
        transport: 'usb',
        wifiState: 'unset',
        wifiInternet: false,
        now,
      }),
    ).toEqual(['usb']);
  });

  it('names Wi-Fi states without jargon', () => {
    expect(wifiStateLabel('ingesting')).toBe('Connected');
    expect(wifiStateLabel('failed')).toBe('Could not connect');
    expect(wifiStateLabel('down')).toBe('Offline');
    expect(wifiStateLabel('unset')).toBe('Not set up');
    expect(wifiStateLabel('ingesting', true)).toBe('Connecting');
  });

  it('describes signal and security without protocol names', () => {
    expect(wifiSignalLabel(-45)).toBe('Excellent');
    expect(wifiSignalLabel(-65)).toBe('Fair');
    expect(wifiAuthLabel('open')).toBe('No password');
    expect(wifiAuthLabel('wpa2')).toBe('Password needed');
  });

  it('names alert kinds in everyday words', () => {
    expect(alarmKindLabel('below')).toBe('Too cold');
    expect(alarmKindLabel('above')).toBe('Too hot');
  });
});

describe('local day helpers', () => {
  it('returns midnight on the local calendar day', () => {
    const d = new Date(2026, 9, 1, 15, 30, 45);
    expect(startOfLocalDay(d)).toEqual(new Date(2026, 9, 1));
  });

  it('formats hour and minute in local time', () => {
    expect(formatTsMinute(new Date(2026, 9, 1, 9, 5, 30).toISOString())).toBe('09:05');
  });

  it('spans midnight to the next midnight', () => {
    const [from, to] = localDayDomain(new Date(2026, 9, 1, 15, 30, 45));
    expect(from).toBe(new Date(2026, 9, 1).getTime());
    expect(to).toBe(new Date(2026, 9, 2).getTime());
  });

  it('starts the live day at the first sample', () => {
    const now = new Date(2026, 9, 1, 15, 30, 45);
    const first = new Date(2026, 9, 1, 8, 37, 12).getTime();
    const [from, to] = liveDayDomain(first, now);
    expect(from).toBe(first);
    expect(to).toBe(new Date(2026, 9, 2).getTime());
  });

  it('keeps midnight when there is no sample yet', () => {
    const now = new Date(2026, 9, 1, 15, 30, 45);
    expect(liveDayDomain(null, now)).toEqual(localDayDomain(now));
  });

  it('labels the end of the day as 24:00', () => {
    const [from, to] = localDayDomain(new Date(2026, 9, 1));
    expect(formatDayAxisTick(from, to)).toBe('00:00');
    expect(formatDayAxisTick(to, to)).toBe('24:00');
  });

  it('uses sample times as live-day ticks, plus the day end', () => {
    const first = new Date(2026, 9, 1, 8, 37).getTime();
    const mid = new Date(2026, 9, 1, 10, 4, 12).getTime();
    const end = new Date(2026, 9, 2).getTime();
    const ticks = dayAxisTicks(first, end, [first, mid]);
    expect(ticks).toEqual([first, mid, end]);
  });
});

describe('device RTC clock', () => {
  it('formats date and time without seconds', () => {
    const unix = Math.floor(new Date(2026, 9, 1, 18, 53, 41).getTime() / 1000);
    expect(formatRtcDateTime(unix)).toBe('2026-10-01 18:53');
  });

  it('advances a stored RTC snapshot by elapsed seconds', () => {
    expect(liveRtcUnix(1_000, 5_000, 8_000)).toBe(1_003);
    expect(liveRtcUnix(null, 5_000, 8_000)).toBeNull();
    expect(liveRtcUnix(0, 5_000, 8_000)).toBeNull();
  });

  it('parses unix seconds from an ISO timestamp', () => {
    expect(unixFromIso('2026-10-01T12:00:00.000Z')).toBe(Date.parse('2026-10-01T12:00:00.000Z') / 1000);
    expect(unixFromIso('nope')).toBeNull();
  });
});
