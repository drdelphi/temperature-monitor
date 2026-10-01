import { describe, expect, it } from 'vitest';
import { DRAIN_POLL_MS, DRAIN_RETRY_MS } from './config';
import { drainRetryMs, flushAckFromIngest } from './drain';
import {
  parseDeviceLine,
  normalizeIngest,
  normalizeWifiScan,
  shouldDrain,
  wifiAuthNeedsPassword,
  liveSnapshotFromMsg,
} from './types';

describe('bridge drain policy', () => {
  it('drains unless Wi-Fi ingest is healthy', () => {
    expect(shouldDrain('ingesting')).toBe(false);
    expect(shouldDrain('failed')).toBe(true);
    expect(shouldDrain('down')).toBe(true);
    expect(shouldDrain('unset')).toBe(true);
    expect(shouldDrain(null)).toBe(true);
  });
});

describe('parseDeviceLine', () => {
  it('parses a clean hello line', () => {
    const msg = parseDeviceLine(
      '{"type":"hello","deviceId":"D405927B2730","wifiState":"unset","unackedCount":0,"claimed":false}\n',
    );
    expect(msg?.type).toBe('hello');
    expect(msg && 'deviceId' in msg ? msg.deviceId : '').toBe('D405927B2730');
  });

  it('extracts hello glued to ESP32-S3 ROM USB Serial/JTAG boot log', () => {
    const raw =
      'I (280) esp_image: segment 5: paddr=000ff50c vaddr=600fe000 size{"type":"hello","deviceId":"D405927B2730","wifiState":"unset","unackedCount":0,"claimed":false,"name":"Probe box","configRev":0}';
    const msg = parseDeviceLine(raw);
    expect(msg?.type).toBe('hello');
    expect(msg && 'deviceId' in msg ? msg.deviceId : '').toBe('D405927B2730');
  });

  it('ignores log lines with no JSON', () => {
    expect(parseDeviceLine('I (280) esp_image: segment 5: paddr=000ff50c')).toBeNull();
  });

  it('parses a live snapshot line', () => {
    const msg = parseDeviceLine(
      '{"type":"live","snapshot":{"ts":"2000-01-01T00:00:00Z","adc":[2048,2048,2048,2048,2048,2048,2048,2048]}}\n',
    );
    expect(msg?.type).toBe('live');
    const snap = liveSnapshotFromMsg(msg!);
    expect(snap?.adc).toHaveLength(8);
    expect(snap?.adc?.[0]).toBe(2048);
  });
});

describe('wifi scan parse', () => {
  it('normalizes networks and detects open auth', () => {
    const nets = normalizeWifiScan({
      type: 'wifi_scan',
      networks: [
        { ssid: 'lab', rssi: -51, auth: 'wpa2' },
        { ssid: 'guest', rssi: -70, auth: 'open' },
        { ssid: '', rssi: -20, auth: 'wpa2' },
      ],
    });
    expect(nets).toEqual([
      { ssid: 'lab', rssi: -51, auth: 'wpa2' },
      { ssid: 'guest', rssi: -70, auth: 'open' },
    ]);
    expect(wifiAuthNeedsPassword('open')).toBe(false);
    expect(wifiAuthNeedsPassword('wpa2')).toBe(true);
  });
});

describe('ingest ACK forwarding', () => {
  it('forwards flush_ack only when the API saved a timestamp', () => {
    expect(flushAckFromIngest({ ack: true, ackedTs: '2026-10-01T10:00:05.000Z', inserted: 8 })).toEqual({
      type: 'flush_ack',
      ts: '2026-10-01T10:00:05.000Z',
    });
  });

  it('does not tell the device to erase without an ACK timestamp', () => {
    expect(flushAckFromIngest(normalizeIngest({ inserted: 8 }))).toBeNull();
    expect(flushAckFromIngest({ ack: false, ackedTs: undefined, inserted: 0 })).toBeNull();
    expect(flushAckFromIngest(null)).toBeNull();
  });

  it('retries drain slower after a failed save', () => {
    expect(drainRetryMs(false)).toBe(DRAIN_POLL_MS);
    expect(drainRetryMs(true)).toBe(DRAIN_RETRY_MS);
  });
});
