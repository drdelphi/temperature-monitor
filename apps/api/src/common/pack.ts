export const RECORD_SIZE = 17;
export const CHANNEL_COUNT = 8;
export const ADC_DISABLED = 0xffe;
export const ADC_FULL_SCALE = 4095;
export const R25_OHM = 10000;
export const T25_K = 298.15;
export const DEFAULT_OFFSET = 0;
export const DEFAULT_GAIN = 1;
export const DEFAULT_B_VALUE = 3950;

export const DEFAULT_CAL = {
  offset: DEFAULT_OFFSET,
  gain: DEFAULT_GAIN,
  bValue: DEFAULT_B_VALUE,
} as const;

export type Snapshot = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  adc: number[];
};

function putBits(buf: Uint8Array, bitOff: number, width: number, value: number) {
  const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
  let v = value & mask;
  while (width > 0) {
    const byte = Math.floor(bitOff / 8);
    const shift = bitOff % 8;
    const space = 8 - shift;
    const take = Math.min(width, space);
    const m = ((1 << take) - 1) << shift;
    buf[byte] = (buf[byte] & ~m) | ((v << shift) & m);
    v >>>= take;
    bitOff += take;
    width -= take;
  }
}

function getBits(buf: Uint8Array, bitOff: number, width: number): number {
  let value = 0;
  let shift = 0;
  while (width > 0) {
    const byte = Math.floor(bitOff / 8);
    const bshift = bitOff % 8;
    const space = 8 - bshift;
    const take = Math.min(width, space);
    const chunk = (buf[byte] >> bshift) & ((1 << take) - 1);
    value |= chunk << shift;
    shift += take;
    bitOff += take;
    width -= take;
  }
  return value >>> 0;
}

export function packSnapshot(snap: Snapshot): Uint8Array {
  const out = new Uint8Array(RECORD_SIZE);
  const time = out.subarray(0, 5);
  putBits(time, 0, 7, snap.year - 2000);
  putBits(time, 7, 4, snap.month);
  putBits(time, 11, 5, snap.day);
  putBits(time, 16, 5, snap.hour);
  putBits(time, 21, 6, snap.minute);
  putBits(time, 27, 6, snap.second);
  const adc = out.subarray(5, 17);
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    putBits(adc, i * 12, 12, (snap.adc[i] ?? 0) & 0xfff);
  }
  return out;
}

export function unpackSnapshot(buf: Uint8Array): Snapshot {
  if (buf.length < RECORD_SIZE) {
    throw new Error('short snapshot');
  }
  const time = buf.subarray(0, 5);
  const adcBytes = buf.subarray(5, 17);
  const adc: number[] = [];
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    adc.push(getBits(adcBytes, i * 12, 12));
  }
  return {
    year: getBits(time, 0, 7) + 2000,
    month: getBits(time, 7, 4),
    day: getBits(time, 11, 5),
    hour: getBits(time, 16, 5),
    minute: getBits(time, 21, 6),
    second: getBits(time, 27, 6),
    adc,
  };
}

export function snapshotToDate(snap: Snapshot): Date {
  return new Date(Date.UTC(snap.year, snap.month - 1, snap.day, snap.hour, snap.minute, snap.second));
}

export function snapshotFromDate(date: Date, adc: number[]): Snapshot {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    adc: adc.slice(0, CHANNEL_COUNT),
  };
}

export function adcToOhm(adc: number): number | null {
  if (adc <= 0 || adc >= ADC_FULL_SCALE) {
    return null;
  }
  return (R25_OHM * adc) / (ADC_FULL_SCALE - adc);
}

export function ohmToC(rOhm: number, bValue: number): number | null {
  if (!(rOhm > 0) || !(bValue > 0)) {
    return null;
  }
  const inv = 1 / T25_K + Math.log(rOhm / R25_OHM) / bValue;
  return 1 / inv - 273.15;
}

export function adcToC(
  adc: number,
  bValue: number = DEFAULT_B_VALUE,
  gain: number = DEFAULT_GAIN,
  offset: number = DEFAULT_OFFSET,
): number | null {
  const r = adcToOhm(adc);
  if (r == null) {
    return null;
  }
  const t = ohmToC(r, bValue);
  if (t == null) {
    return null;
  }
  return gain * t + offset;
}

export function isDisabledAdc(adc: number): boolean {
  return adc === ADC_DISABLED;
}

export function isMeasurableAdc(adc: number): boolean {
  return adc > 0 && adc < ADC_FULL_SCALE && adc !== ADC_DISABLED;
}

export function decodePackedBase64(b64: string): Snapshot {
  const buf = Buffer.from(b64, 'base64');
  return unpackSnapshot(Uint8Array.from(buf));
}

export type IngestSnapshot = {
  ts?: string;
  adc?: number[];
  packed?: string;
};

export function expandIngestSnapshot(input: IngestSnapshot): { ts: Date; adc: number[] } {
  if (input.packed) {
    const snap = decodePackedBase64(input.packed);
    return { ts: snapshotToDate(snap), adc: snap.adc };
  }
  if (!input.ts || !input.adc || input.adc.length !== CHANNEL_COUNT) {
    throw new Error('snapshot needs packed or ts+adc[8]');
  }
  return { ts: new Date(input.ts), adc: input.adc.map((n) => n & 0xfff) };
}
