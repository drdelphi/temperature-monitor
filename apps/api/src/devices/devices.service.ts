import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CHANNEL_COUNT, DEFAULT_CAL } from '../common/pack';
import { generateDeviceToken, hashDeviceToken } from '../common/crypto';
import { normalizeDeviceId } from '../common/util';
import { publicDevice } from '../common/serialize';
import { PrismaService } from '../prisma/prisma.service';
import type { ClaimDeviceDto } from './dto/claim.dto';
import type { PatchDeviceDto } from './dto/patch-device.dto';
import type { PatchChannelDto } from './dto/patch-channel.dto';
import type { Device } from '@prisma/client';
import { Prisma } from '@prisma/client';

const channelInclude = { channels: { orderBy: { index: 'asc' as const } } };

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(dto: ClaimDeviceDto) {
    const id = normalizeDeviceId(dto.deviceId);
    const token = generateDeviceToken();
    const tokenHash = hashDeviceToken(token);
    const name = dto.name?.trim() || `TMP-${id.slice(-4)}`;

    const existing = await this.prisma.device.findUnique({
      where: { id },
      include: channelInclude,
    });

    if (existing) {
      const device = await this.prisma.device.update({
        where: { id },
        data: {
          tokenHash,
          ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
          configRev: { increment: 1 },
        },
        include: channelInclude,
      });
      return { token, device: await this.toPublic(device) };
    }

    const device = await this.prisma.device.create({
      data: {
        id,
        name,
        tokenHash,
        channels: {
          create: Array.from({ length: CHANNEL_COUNT }, (_, index) => ({
            index,
            name: `Sensor ${index + 1}`,
            enabled: true,
            intervalSec: 1,
            offset: DEFAULT_CAL.offset,
            gain: DEFAULT_CAL.gain,
            bValue: DEFAULT_CAL.bValue,
          })),
        },
      },
      include: channelInclude,
    });

    return { token, device: await this.toPublic(device) };
  }

  async list() {
    const devices = await this.prisma.device.findMany({
      include: channelInclude,
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(devices.map((d) => this.toPublic(d)));
  }

  async get(id: string) {
    const device = await this.require(id);
    return this.toPublic(device);
  }

  async require(id: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: normalizeDeviceId(id) },
      include: channelInclude,
    });
    if (!device) {
      throw new NotFoundException('This monitor was not found.');
    }
    return device;
  }

  async remove(id: string) {
    const device = await this.require(id);
    await this.prisma.device.delete({ where: { id: device.id } });
    return { ok: true };
  }

  async patch(id: string, dto: PatchDeviceDto) {
    await this.require(id);
    const data: {
      name?: string;
      pendingUnixTime?: bigint;
      configRev?: { increment: number };
    } = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.pendingUnixTime !== undefined) {
      data.pendingUnixTime = BigInt(dto.pendingUnixTime);
      data.configRev = { increment: 1 };
    }
    const device = await this.prisma.device.update({
      where: { id: normalizeDeviceId(id) },
      data,
      include: channelInclude,
    });
    return this.toPublic(device);
  }

  async getConfig(id: string, actor: { authKind?: string; device?: Device }) {
    const device = await this.require(id);
    if (actor.authKind === 'device' && actor.device && actor.device.id !== device.id) {
      throw new ForbiddenException('This monitor is not authorized.');
    }
    return {
      configRev: device.configRev,
      pendingUnixTime: device.pendingUnixTime != null ? Number(device.pendingUnixTime) : null,
      channels: (device.channels ?? []).map((ch) => ({
        index: ch.index,
        name: ch.name,
        enabled: ch.enabled,
        intervalSec: ch.intervalSec,
        offset: ch.offset,
        gain: ch.gain,
        bValue: ch.bValue,
      })),
    };
  }

  async patchChannel(id: string, index: number, dto: PatchChannelDto) {
    const deviceId = normalizeDeviceId(id);
    await this.require(deviceId);
    if (!Number.isInteger(index) || index < 0 || index > 7) {
      throw new NotFoundException('This sensor was not found.');
    }
    const channel = await this.prisma.channel.findUnique({
      where: { deviceId_index: { deviceId, index } },
    });
    if (!channel) {
      throw new NotFoundException('This sensor was not found.');
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.device.update({
        where: { id: deviceId },
        data: { configRev: { increment: 1 } },
      }),
      this.prisma.channel.update({
        where: { deviceId_index: { deviceId, index } },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...(dto.intervalSec !== undefined ? { intervalSec: dto.intervalSec } : {}),
          ...(dto.offset !== undefined ? { offset: dto.offset } : {}),
          ...(dto.gain !== undefined ? { gain: dto.gain } : {}),
          ...(dto.bValue !== undefined ? { bValue: dto.bValue } : {}),
        },
      }),
    ]);

    return {
      id: updated.id,
      deviceId: updated.deviceId,
      index: updated.index,
      name: updated.name,
      enabled: updated.enabled,
      intervalSec: updated.intervalSec,
      offset: updated.offset,
      gain: updated.gain,
      bValue: updated.bValue,
    };
  }

  private async toPublic(device: Device & { channels?: import('@prisma/client').Channel[] }) {
    const latest = await this.latestByChannel(device.id);
    return publicDevice(device, latest);
  }

  private async latestByChannel(deviceId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ channel: number; ts: Date; tempC: number | null; rOhm: number | null }>
    >(Prisma.sql`
      SELECT DISTINCT ON (channel) channel, ts, "tempC", "rOhm"
      FROM "Sample"
      WHERE "deviceId" = ${deviceId}
      ORDER BY channel, ts DESC
    `);
    const map = new Map<number, { tempC: number | null; rOhm: number | null; ts: Date }>();
    for (const row of rows) {
      map.set(row.channel, { tempC: row.tempC, rOhm: row.rOhm, ts: row.ts });
    }
    return map;
  }
}
