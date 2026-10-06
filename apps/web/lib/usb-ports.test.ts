import { describe, expect, it } from 'vitest';
import { isMonitorUsbPort } from './usb-ports';

const port = (usbVendorId?: number, usbProductId?: number) => ({
  getInfo: () => ({ usbVendorId, usbProductId }),
});

describe('USB automatic reconnection', () => {
  it.each([
    [0x303a, 0x1001], // S3 native USB
    [0x10c4, 0xea60], // CP210x
    [0x1a86, 0x7523], // CH340
    [0x1a86, 0x55d4], // CH9102
    [0x0403, 0x6001], // FT232
  ])('recognizes %i:%i', (vid, pid) => {
    expect(isMonitorUsbPort(port(vid, pid))).toBe(true);
  });

  it('does not automatically open unrelated devices from a supported vendor', () => {
    expect(isMonitorUsbPort(port(0x303a, 0x9999))).toBe(false);
    expect(isMonitorUsbPort(port(0x10c4, 0x9999))).toBe(false);
    expect(isMonitorUsbPort(port(0xabcd, 0x1234))).toBe(false);
  });

  it('preserves reconnection when product ID is unavailable', () => {
    expect(isMonitorUsbPort(port(0x303a))).toBe(true);
    expect(isMonitorUsbPort(port(0x10c4))).toBe(true);
  });

  it('ignores ports without USB metadata or with unreadable metadata', () => {
    expect(isMonitorUsbPort(port())).toBe(false);
    expect(isMonitorUsbPort({ getInfo: () => { throw new Error('Port unavailable'); } })).toBe(false);
  });
});
