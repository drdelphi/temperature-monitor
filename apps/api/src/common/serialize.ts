import type { Channel, Device, User } from '@prisma/client';

export type PublicChannel = {
  id: string;
  deviceId: string;
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

export type PublicDevice = {
  id: string;
  name: string;
  lastSeen: Date | null;
  lastSeenVia: 'wifi' | 'local' | null;
  apiBaseUrl: string | null;
  pendingUnixTime: number | null;
  configRev: number;
  createdAt: Date;
  updatedAt: Date;
  channels?: PublicChannel[];
};

export function publicChannel(
  ch: Channel,
  last?: { tempC: number | null; rOhm: number | null; ts: Date } | null,
): PublicChannel {
  return {
    id: ch.id,
    deviceId: ch.deviceId,
    index: ch.index,
    name: ch.name,
    enabled: ch.enabled,
    intervalSec: ch.intervalSec,
    offset: ch.offset,
    gain: ch.gain,
    bValue: ch.bValue,
    lastTempC: last?.tempC ?? null,
    lastROhm: last?.rOhm ?? null,
    lastTs: last?.ts ? last.ts.toISOString() : null,
  };
}

export function publicDevice(
  device: Device & { channels?: Channel[] },
  latest?: Map<number, { tempC: number | null; rOhm: number | null; ts: Date }>,
): PublicDevice {
  return {
    id: device.id,
    name: device.name,
    lastSeen: device.lastSeen,
    lastSeenVia: device.lastSeenVia,
    apiBaseUrl: device.apiBaseUrl,
    pendingUnixTime: device.pendingUnixTime != null ? Number(device.pendingUnixTime) : null,
    configRev: device.configRev,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    channels: device.channels
      ? [...device.channels]
          .sort((a, b) => a.index - b.index)
          .map((ch) => publicChannel(ch, latest?.get(ch.index)))
      : undefined,
  };
}

export function publicUser(user: User) {
  return {
    email: user.email,
    phoneE164: user.phoneE164,
    telegramChatId: user.telegramChatId,
    telegramBotTokenSet: Boolean(user.telegramBotToken),
  };
}
