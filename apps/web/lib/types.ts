import { DEFAULT_CAL } from './cal';
import { CHANNEL_COUNT } from './config';

export type WifiState = 'ingesting' | 'failed' | 'down' | 'unset';

export type AuthUser = {
  id: string;
  email: string;
};

export type Channel = {
  index: number;
  name: string;
  enabled: boolean;
  intervalSec: number;
  offset: number;
  gain: number;
  bValue: number;
  lastTempC: number | null;
  lastROhm: number | null;
  lastTs: string | null;
};

export type LastSeenVia = 'wifi' | 'local';

export type Device = {
  id: string;
  name: string;
  lastSeen: string | null;
  lastSeenVia: LastSeenVia | null;
  pendingUnixTime: number | null;
  configRev: number;
  channels: Channel[];
};

export type DeviceConfig = {
  configRev: number;
  pendingUnixTime: number | null;
  channels: Channel[];
};

export type Sample = {
  ts: string;
  channel: number;
  tempC: number | null;
  adcRaw: number | null;
  rOhm: number | null;
};

export type AlarmKind = 'below' | 'above';

export type Alarm = {
  id?: string;
  channel: number;
  kind: AlarmKind;
  thresholdC: number;
  enabled: boolean;
  hysteresis: number;
  cooldownSec: number;
  notifySms: boolean;
  notifyTelegram: boolean;
  active?: boolean;
};

export type OperatorSettings = {
  phoneE164: string;
  telegramChatId: string;
  telegramBotTokenSet: boolean;
};

export type IngestSnapshot = {
  ts?: string;
  adc?: number[];
  packed?: string;
};

export type IngestResponse = {
  ack?: boolean;
  ackedTs?: string;
  inserted?: number;
};

export type ClaimResponse = {
  token: string;
  deviceId: string;
  device?: Device;
};

export type HostToDevice =
  | { type: 'drain'; limit: number }
  | { type: 'flush_ack'; ts: string }
  | {
      type: 'set_config';
      configRev: number;
      channels: Array<{
        index: number;
        name: string;
        enabled: boolean;
        intervalSec: number;
        offset: number;
        gain: number;
        bValue: number;
      }>;
    }
  | { type: 'set_time'; unixTime: number }
  | {
      type: 'claim';
      token: string;
      apiBaseUrl: string;
      wifiSsid?: string;
      wifiPass?: string;
    }
  | { type: 'set_wifi'; ssid: string; password: string }
  | { type: 'scan_wifi' }
  | { type: 'get_status' }
  | { type: 'hello' };

export type HelloMsg = {
  type: 'hello';
  deviceId: string;
  wifiState: WifiState;
  unackedCount: number;
  claimed: boolean;
  name?: string;
  configRev?: number;
  ssid?: string;
  ip?: string;
  gateway?: string;
  netmask?: string;
  dns?: string;
  rssi?: number;
  internet?: boolean;
  wifiConnecting?: boolean;
};

export type SamplesMsg = {
  type: 'samples';
  snapshots: IngestSnapshot[];
};

export type StatusMsg = {
  type: 'status';
  wifiState: WifiState;
  unackedCount: number;
  rssi?: number;
  rtcUnix?: number;
  configRev?: number;
  claimed?: boolean;
  deviceId?: string;
  ssid?: string;
  ip?: string;
  gateway?: string;
  netmask?: string;
  dns?: string;
  internet?: boolean;
  wifiConnecting?: boolean;
};

export type WifiNetwork = {
  ssid: string;
  rssi: number;
  auth: string;
};

export type WifiScanMsg = {
  type: 'wifi_scan';
  networks: WifiNetwork[];
};

export type LiveMsg = {
  type: 'live';
  snapshot?: IngestSnapshot;
  ts?: string;
  adc?: number[];
};

export type DeviceMsg = HelloMsg | SamplesMsg | StatusMsg | WifiScanMsg | LiveMsg | { type: string; [k: string]: unknown };

export function liveSnapshotFromMsg(msg: DeviceMsg): IngestSnapshot | null {
  if (msg.type !== 'live') return null;
  const rec = asRecord(msg);
  const inner = rec.snapshot && typeof rec.snapshot === 'object' ? asRecord(rec.snapshot) : rec;
  const adc = asArray(inner.adc).map((n) => Number(n));
  const ts = typeof inner.ts === 'string' ? inner.ts : '';
  const packed = typeof inner.packed === 'string' ? inner.packed : undefined;
  if (packed) {
    return { ts: ts || undefined, adc: adc.length === CHANNEL_COUNT ? adc : undefined, packed };
  }
  if (ts && adc.length === CHANNEL_COUNT) return { ts, adc };
  return null;
}

/** First JSON object in a USB/BLE line. ROM USB Serial/JTAG boot logs often prefix hello. */
export function parseDeviceLine(line: string): DeviceMsg | null {
  const s = line.trim();
  let start = s.indexOf('{');
  while (start >= 0) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(s.slice(start, i + 1)) as DeviceMsg;
            if (obj && typeof obj === 'object' && typeof obj.type === 'string') return obj;
          } catch {
            break;
          }
          break;
        }
      }
    }
    start = s.indexOf('{', start + 1);
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  for (const key of ['items', 'devices', 'samples', 'alarms', 'channels', 'data']) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return [];
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = num(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function emptyChannel(index: number): Channel {
  return {
    index,
    name: `Sensor ${index + 1}`,
    enabled: true,
    intervalSec: 1,
    offset: DEFAULT_CAL.offset,
    gain: DEFAULT_CAL.gain,
    bValue: DEFAULT_CAL.bValue,
    lastTempC: null,
    lastROhm: null,
    lastTs: null,
  };
}

export function normalizeChannel(raw: unknown, fallbackIndex = 0): Channel {
  const r = asRecord(raw);
  const index = num(r.index ?? r.channel, fallbackIndex);
  const base = emptyChannel(index);
  return {
    ...base,
    name: str(r.name, base.name),
    enabled: r.enabled !== false && r.enabled !== 0,
    intervalSec: Math.max(1, Math.floor(num(r.intervalSec, 1))),
    offset: num(r.offset, DEFAULT_CAL.offset),
    gain: num(r.gain, DEFAULT_CAL.gain),
    bValue: num(r.bValue, DEFAULT_CAL.bValue),
    lastTempC: numOrNull(r.lastTempC ?? r.tempC),
    lastROhm: numOrNull(r.lastROhm ?? r.rOhm),
    lastTs: typeof r.lastTs === 'string' ? r.lastTs : typeof r.ts === 'string' ? r.ts : null,
  };
}

export function normalizeDevice(raw: unknown): Device {
  const r = asRecord(raw);
  const inner = r.device && typeof r.device === 'object' ? asRecord(r.device) : r;
  const id = str(inner.id ?? inner.deviceId).toUpperCase();
  const listed = asArray(inner.channels).map((ch, i) => normalizeChannel(ch, i));
  const channels = Array.from({ length: CHANNEL_COUNT }, (_, i) => {
    return listed.find((c) => c.index === i) ?? emptyChannel(i);
  });
  return {
    id,
    name: str(inner.name, id || 'Device'),
    lastSeen: typeof inner.lastSeen === 'string' ? inner.lastSeen : null,
    lastSeenVia: inner.lastSeenVia === 'wifi' || inner.lastSeenVia === 'local' ? inner.lastSeenVia : null,
    pendingUnixTime: numOrNull(inner.pendingUnixTime),
    configRev: Math.max(1, Math.floor(num(inner.configRev, 1))),
    channels,
  };
}

export function normalizeDevices(raw: unknown): Device[] {
  if (Array.isArray(raw)) return raw.map(normalizeDevice);
  const r = asRecord(raw);
  return asArray(r.devices ?? r.items ?? r.data).map(normalizeDevice);
}

export function normalizeSample(raw: unknown): Sample | null {
  const r = asRecord(raw);
  const ts = str(r.ts ?? r.timestamp);
  const channel = num(r.channel ?? r.index, Number.NaN);
  if (!ts || !Number.isFinite(channel)) return null;
  return {
    ts,
    channel: Math.floor(channel),
    tempC: numOrNull(r.tempC ?? r.tC),
    adcRaw: numOrNull(r.adcRaw ?? r.adc),
    rOhm: numOrNull(r.rOhm ?? r.ohm),
  };
}

export function normalizeSamples(raw: unknown): Sample[] {
  const single = normalizeSample(raw);
  if (single) return [single];
  if (Array.isArray(raw)) {
    return raw.map(normalizeSample).filter((s): s is Sample => s !== null);
  }
  const r = asRecord(raw);
  const nested = r.sample && typeof r.sample === 'object' ? [r.sample] : [];
  return asArray(r.samples ?? r.items ?? r.data ?? nested)
    .map(normalizeSample)
    .filter((s): s is Sample => s !== null);
}

export function normalizeAlarms(raw: unknown): Alarm[] {
  return asArray(raw).map((item) => {
    const r = asRecord(item);
    return {
      id: typeof r.id === 'string' ? r.id : undefined,
      channel: Math.floor(num(r.channel, 0)),
      kind: r.kind === 'above' ? 'above' : 'below',
      thresholdC: num(r.thresholdC ?? r.threshold, 0),
      enabled: r.enabled !== false && r.enabled !== 0,
      hysteresis: num(r.hysteresis, 0.5),
      cooldownSec: Math.max(0, Math.floor(num(r.cooldownSec, 300))),
      notifySms: Boolean(r.notifySms),
      notifyTelegram: Boolean(r.notifyTelegram),
      active: typeof r.active === 'boolean' ? r.active : undefined,
    };
  });
}

export function normalizeConfig(raw: unknown): DeviceConfig {
  const r = asRecord(raw);
  const inner = r.config && typeof r.config === 'object' ? asRecord(r.config) : r;
  const listed = asArray(inner.channels).map((ch, i) => normalizeChannel(ch, i));
  const channels = Array.from({ length: CHANNEL_COUNT }, (_, i) => {
    return listed.find((c) => c.index === i) ?? emptyChannel(i);
  });
  return {
    configRev: Math.max(1, Math.floor(num(inner.configRev, 1))),
    pendingUnixTime: numOrNull(inner.pendingUnixTime),
    channels,
  };
}

export function normalizeUser(raw: unknown): AuthUser {
  const r = asRecord(raw);
  const inner = r.user && typeof r.user === 'object' ? asRecord(r.user) : r;
  return {
    id: str(inner.id),
    email: str(inner.email),
  };
}

export function normalizeSettings(raw: unknown): OperatorSettings {
  const r = asRecord(raw);
  const inner = r.settings && typeof r.settings === 'object' ? asRecord(r.settings) : r;
  return {
    phoneE164: str(inner.phoneE164 ?? inner.phone),
    telegramChatId: str(inner.telegramChatId ?? inner.chatId),
    telegramBotTokenSet: Boolean(inner.telegramBotTokenSet ?? inner.telegramBotToken),
  };
}

export function normalizeClaim(raw: unknown): ClaimResponse {
  const r = asRecord(raw);
  const token = str(r.token ?? r.deviceToken);
  const device = r.device ? normalizeDevice(r.device) : undefined;
  const deviceId = str(r.deviceId ?? device?.id).toUpperCase();
  return { token, deviceId, device };
}

export function normalizeIngest(raw: unknown): IngestResponse {
  const r = asRecord(raw);
  const ackedTs = typeof r.ackedTs === 'string' ? r.ackedTs : undefined;
  return {
    ack: r.ack === true || Boolean(ackedTs),
    ackedTs,
    inserted: numOrNull(r.inserted) ?? undefined,
  };
}

export function protocolChannels(channels: Channel[]) {
  return channels.map((c) => ({
    index: c.index,
    name: c.name,
    enabled: c.enabled,
    intervalSec: c.intervalSec,
    offset: c.offset,
    gain: c.gain,
    bValue: c.bValue,
  }));
}

export function normalizeWifiScan(raw: unknown): WifiNetwork[] {
  const rec = asRecord(raw);
  const list = asArray(rec.networks);
  const out: WifiNetwork[] = [];
  for (const item of list) {
    const n = asRecord(item);
    const ssid = str(n.ssid).trim();
    if (!ssid) continue;
    out.push({
      ssid,
      rssi: num(n.rssi, 0),
      auth: str(n.auth, 'other') || 'other',
    });
  }
  return out;
}

export function wifiAuthNeedsPassword(auth: string | undefined): boolean {
  return auth !== 'open';
}

export function shouldDrain(wifiState: WifiState | string | null | undefined): boolean {
  return wifiState !== 'ingesting';
}
