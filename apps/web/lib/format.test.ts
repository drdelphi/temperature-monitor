import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import {
  alarmKindLabel,
  connectionKinds,
  connectionLabel,
  errorMessage,
  explainUsbOpenError,
  linkBarLabel,
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

  it('shows Wi-Fi, Bluetooth, and USB badges from live links and recent ingest', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(
      connectionKinds({ lastSeen: null, linked: true, transport: 'usb' }),
    ).toEqual(['usb']);
    expect(
      connectionKinds({ lastSeen: null, linked: true, transport: 'ble' }),
    ).toEqual(['bluetooth']);
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:59:50Z',
        linked: true,
        transport: 'usb',
        wifiInternet: true,
        now,
      }),
    ).toEqual(['wifi', 'usb']);
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:59:50Z',
        linked: false,
        now,
      }),
    ).toEqual(['wifi']);
    expect(
      connectionKinds({
        lastSeen: '2026-10-01T11:00:00Z',
        linked: false,
        now,
      }),
    ).toEqual([]);
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
