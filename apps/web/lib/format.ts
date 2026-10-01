export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatTemp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)} °C`;
}

export function formatOhm(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} kΩ`;
  return `${value.toFixed(1)} Ω`;
}

export function formatMac(id: string): string {
  const hex = id.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length !== 12) return id;
  return hex.match(/.{2}/g)?.join(':') ?? id;
}

export type ConnectionKind = 'wifi' | 'bluetooth' | 'usb';

/** Wi-Fi ingest heartbeat. Longer than the 5s poll, shorter than “seen recently”. */
export const WIFI_LIVE_MS = 20_000;

function ingestAgeMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return now - t;
}

export function connectionKinds(opts: {
  lastSeen?: string | null;
  lastSeenVia?: string | null;
  linked: boolean;
  transport?: string | null;
  wifiInternet?: boolean | null;
  wifiState?: string | null;
  now?: number;
}): ConnectionKind[] {
  const out: ConnectionKind[] = [];
  const linked = opts.linked && Boolean(opts.transport);
  const wifiHere =
    linked &&
    opts.wifiState !== 'unset' &&
    (opts.wifiState === 'ingesting' || opts.wifiInternet === true);
  const age = ingestAgeMs(opts.lastSeen, opts.now ?? Date.now());
  const wifiRemote =
    !linked && opts.lastSeenVia === 'wifi' && age != null && age >= 0 && age < WIFI_LIVE_MS;
  if (wifiHere || wifiRemote) out.push('wifi');
  if (linked && opts.transport === 'ble') out.push('bluetooth');
  if (linked && opts.transport === 'usb') out.push('usb');
  return out;
}

export function connectionLabel(kind: ConnectionKind): string {
  if (kind === 'wifi') return 'Wi-Fi';
  if (kind === 'bluetooth') return 'Bluetooth';
  return 'USB';
}

export function lastSeenAge(iso: string | null | undefined, now = Date.now()): {
  label: string;
  tone: 'ok' | 'warn' | 'off';
} {
  if (!iso) return { label: 'Never seen', tone: 'off' };
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return { label: 'Never seen', tone: 'off' };
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 30) return { label: 'Just now', tone: 'ok' };
  if (sec < 60) return { label: `${sec}s ago`, tone: 'ok' };
  const min = Math.floor(sec / 60);
  if (min < 2) return { label: `${min}m ${sec % 60}s ago`, tone: 'ok' };
  if (min < 15) return { label: `${min}m ago`, tone: 'warn' };
  const hr = Math.floor(min / 60);
  if (min < 60) return { label: `${min}m ago`, tone: 'off' };
  if (hr < 48) return { label: `${hr}h ago`, tone: 'off' };
  const days = Math.floor(hr / 24);
  return { label: `${days}d ago`, tone: 'off' };
}

export function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

export function localDayDomain(d = new Date()): [number, number] {
  const start = startOfLocalDay(d);
  return [start.getTime(), endOfLocalDay(start).getTime()];
}

export function liveDayDomain(firstTs: string | number | null | undefined, now = new Date()): [number, number] {
  const [dayStart, dayEnd] = localDayDomain(now);
  const first = typeof firstTs === 'number' ? firstTs : firstTs == null ? Number.NaN : Date.parse(String(firstTs));
  if (!Number.isFinite(first)) return [dayStart, dayEnd];
  return [Math.min(dayEnd, Math.max(dayStart, first)), dayEnd];
}

export function dayAxisTicks(from: number, to: number, sampleTimes: Array<string | number> = []): number[] {
  const ticks: number[] = [];
  const seen = new Set<number>();
  const add = (raw: string | number) => {
    const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
    if (!Number.isFinite(t) || t < from || t > to || seen.has(t)) return;
    seen.add(t);
    ticks.push(t);
  };
  add(from);
  for (const s of sampleTimes) add(s);
  add(to);
  ticks.sort((a, b) => a - b);
  return ticks;
}

export function formatDayAxisTick(ms: number, dayEnd: number): string {
  if (ms >= dayEnd) return '24:00';
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function fromLocalInput(value: string): Date {
  return new Date(value);
}

export function unixToLocalInput(unix: number): string {
  return toLocalInput(new Date(unix * 1000));
}

export function localInputToUnix(value: string): number {
  return Math.floor(fromLocalInput(value).getTime() / 1000);
}

export function isoFilenameStamp(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, 'Z').replace(/[:T]/g, '-').replace(/Z$/, '');
}

const GENERIC_ERROR = 'Something went wrong. Please try again.';

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Please check what you entered and try again.',
  401: 'Please sign in again.',
  403: 'You do not have permission to do that.',
  404: 'That item was not found.',
  409: 'This monitor is already added.',
  413: 'That request is too large. Try a shorter time range.',
  429: 'Too many attempts. Please wait a moment and try again.',
  500: GENERIC_ERROR,
  502: 'The service is temporarily unavailable. Please try again.',
  503: 'The service is temporarily unavailable. Please try again.',
};

const KNOWN_ERRORS: Array<[RegExp, string]> = [
  [/invalid credentials/i, 'Email or password is incorrect.'],
  [/current password is incorrect/i, 'Current password is incorrect.'],
  [/choose a different password/i, 'Choose a different password from the current one.'],
  [/must be longer than or equal to 8/i, 'Use at least 8 characters for the new password.'],
  [/unauthorized/i, 'Please sign in again.'],
  [/device not found/i, 'This monitor was not found.'],
  [/channel not found/i, 'This sensor was not found.'],
  [/user not found/i, 'Your account was not found.'],
  [/deviceid must be/i, 'This monitor could not be identified.'],
  [/channel must be/i, 'Please choose a valid sensor.'],
  [/the start time is not valid|invalid from/i, 'The start time is not valid.'],
  [/the end time is not valid|invalid to/i, 'The end time is not valid.'],
  [/is not valid/i, 'Please check what you entered and try again.'],
  [/deviceid is required|deviceid required/i, 'Please choose a monitor.'],
  [/downsample/i, 'That time range could not be loaded.'],
  [/web serial unavailable/i, 'USB is not available in this browser. Please use Chrome or Edge.'],
  [/web bluetooth unavailable/i, 'Bluetooth is not available in this browser. Please use Chrome or Edge.'],
  [/ble gatt|gatt connect/i, 'Could not connect over Bluetooth. Please try again.'],
  [/link is not open/i, 'The monitor is not connected.'],
  [/usb port not writable|the device has been lost/i, 'The USB connection was lost. Please connect again.'],
  [/failed to fetch|networkerror|load failed|failed to load/i, 'Could not reach the server. Check your connection and try again.'],
  [/notallowederror|permission denied/i, 'Access was denied. Please try again and allow the connection.'],
  [/already open/i, 'This USB connection is already in use. Disconnect first, then try again.'],
  [/failed to open serial port/i, 'Could not open the USB connection. Unplug the monitor, plug it back in, then try again.'],
  [/calibration points have the same/i, 'Use two different temperatures to finish this adjustment.'],
  [/invalid snapshot|short snapshot|snapshot needs/i, 'The temperature reading could not be saved.'],
  [/must be a |must be an |should not be empty/i, 'Please check what you entered and try again.'],
];

function extractRawMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'body' in err && typeof (err as { body?: unknown }).body === 'string') {
    const fromBody = parseApiBody((err as { body: string }).body);
    if (fromBody) return fromBody;
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

function parseApiBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
    if (Array.isArray(parsed.message) && typeof parsed.message[0] === 'string') return parsed.message[0];
  } catch {
    /* not JSON */
  }
  return trimmed;
}

function looksTechnical(msg: string): boolean {
  return /[{}$]|HTTPS?:|HTTP\s*\d|statusCode|deviceId|\/dev\/|ttyACM|GATT|Web Serial|idf\.py|dialout|Error:|ECONN|ENOTFOUND|stack|at\s+\S+\s+\(|internal server error|bad request|payload too large|service unavailable|^not found$|^forbidden$|^unauthorized$/i.test(
    msg,
  );
}

function isFriendlySentence(msg: string): boolean {
  const t = msg.trim();
  if (t.length < 8 || t.length > 220) return false;
  if (!/\s/.test(t)) return false;
  if (looksTechnical(t)) return false;
  return true;
}

export function errorMessage(err: unknown): string {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
  const raw = extractRawMessage(err);
  for (const [pattern, text] of KNOWN_ERRORS) {
    if (pattern.test(raw)) return text;
  }
  if (isFriendlySentence(raw)) return raw.trim();
  if (status != null && STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status != null && status >= 500) return GENERIC_ERROR;
  return GENERIC_ERROR;
}

export function explainUsbOpenError(err: unknown): string {
  const msg = extractRawMessage(err);
  const name =
    err instanceof DOMException
      ? err.name
      : typeof err === 'object' && err && 'name' in err
        ? String((err as { name?: unknown }).name ?? '')
        : '';
  if (name === 'NotFoundError') return msg;
  if (/already open/i.test(msg)) {
    return 'This USB connection is already in use. Disconnect first, then try again.';
  }
  if (name === 'NetworkError' || /Failed to open serial port/i.test(msg)) {
    return 'Could not open the USB connection. Unplug the monitor, plug it back in, then try again in Chrome or Edge.';
  }
  return errorMessage(err);
}

export function transportLabel(kind: string | null | undefined): string {
  if (kind === 'usb') return 'USB';
  if (kind === 'ble') return 'Bluetooth';
  return '';
}

export function linkBarLabel(opts: { open: boolean; deviceId: string | null }): string {
  if (opts.open && opts.deviceId) return 'Connected';
  if (opts.open) return 'Connecting…';
  return 'No monitor connected here';
}

export function wifiStateLabel(state: string | null | undefined, connecting = false): string {
  if (connecting) return 'Connecting';
  switch (state) {
    case 'ingesting':
      return 'Connected';
    case 'failed':
      return 'Could not connect';
    case 'down':
      return 'Offline';
    case 'unset':
      return 'Not set up';
    default:
      return '—';
  }
}

export function wifiSignalLabel(rssi: number | null | undefined): string {
  if (rssi == null || !Number.isFinite(rssi) || rssi === 0) return '—';
  if (rssi >= -50) return 'Excellent';
  if (rssi >= -60) return 'Good';
  if (rssi >= -70) return 'Fair';
  return 'Weak';
}

export function wifiAuthLabel(auth: string | undefined): string {
  return auth === 'open' ? 'No password' : 'Password needed';
}

export function alarmKindLabel(kind: string): string {
  if (kind === 'below') return 'Too cold';
  if (kind === 'above') return 'Too hot';
  return kind;
}

export function formatTs(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatTsMinute(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatTsFull(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatRtcDateTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  if (!Number.isFinite(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function liveRtcUnix(
  snapshotUnix: number | null | undefined,
  snapshotAtMs: number | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (snapshotUnix == null || snapshotUnix <= 0 || snapshotAtMs == null) return null;
  const elapsed = Math.max(0, Math.floor((nowMs - snapshotAtMs) / 1000));
  return snapshotUnix + elapsed;
}

export function unixFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const unix = Math.floor(t / 1000);
  return unix > 0 ? unix : null;
}

export function maxTs(samples: Array<{ ts: string }>): string | null {
  let best: string | null = null;
  for (const s of samples) {
    if (!best || s.ts > best) best = s.ts;
  }
  return best;
}
