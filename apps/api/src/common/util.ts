import { BadRequestException } from '@nestjs/common';

const HEX12 = /^[0-9A-F]{12}$/;

export function normalizeDeviceId(raw: string): string {
  const hex = raw.replace(/[:\-]/g, '').toUpperCase();
  if (!HEX12.test(hex)) {
    throw new BadRequestException('This monitor could not be identified.');
  }
  return hex;
}

/** One channel, a comma list (`0,2,5`), or omit for all. */
export function parseOptionalChannels(value?: string | number): number[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 7) {
      throw new BadRequestException('Please choose a valid sensor.');
    }
    return [value];
  }
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  const out: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 7) {
      throw new BadRequestException('Please choose valid sensors.');
    }
    if (!out.includes(n)) {
      out.push(n);
    }
  }
  return out.length ? out : undefined;
}

export function parseOptionalChannel(value?: string | number): number | undefined {
  const list = parseOptionalChannels(value);
  if (!list || list.length === 0) {
    return undefined;
  }
  if (list.length !== 1) {
    throw new BadRequestException('Please choose one sensor.');
  }
  return list[0];
}

export function parseIsoDate(value: string | undefined, label: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`The ${label} is not valid.`);
  }
  return d;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
