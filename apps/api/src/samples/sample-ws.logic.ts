export const STREAM_PATH = '/v1/stream';
export const LIVE_WINDOW_MS = 120_000;

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function originAllowed(origin: string | string[] | undefined, allowed: string[]): boolean {
  if (!origin) return false;
  const value = Array.isArray(origin) ? origin[0] : origin;
  if (allowed.includes(value)) return true;
  try {
    const url = new URL(value);
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    else if (url.hostname === '127.0.0.1') url.hostname = 'localhost';
    else return false;
    return allowed.includes(url.origin);
  } catch {
    return false;
  }
}

export type StreamUpgrade =
  | { match: false }
  | { match: true; deviceId: string }
  | { match: true; deviceId: null };

const HEX12 = /^[0-9A-F]{12}$/;

export function parseStreamUpgrade(url: string | undefined): StreamUpgrade {
  if (!url) return { match: false };
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://localhost');
  } catch {
    return { match: false };
  }
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (path !== STREAM_PATH) return { match: false };
  const hex = (parsed.searchParams.get('deviceId') ?? '').replace(/[:\-]/g, '').toUpperCase();
  if (!HEX12.test(hex)) return { match: true, deviceId: null };
  return { match: true, deviceId: hex };
}

export function publicLiveSample(row: {
  deviceId?: string;
  channel: number;
  ts: Date | string;
  tempC: number | null;
  rOhm: number | null;
  adcRaw: number | null;
}) {
  return {
    ...(row.deviceId ? { deviceId: row.deviceId } : {}),
    channel: row.channel,
    ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
    tempC: row.tempC,
    rOhm: row.rOhm,
    adcRaw: row.adcRaw,
  };
}
