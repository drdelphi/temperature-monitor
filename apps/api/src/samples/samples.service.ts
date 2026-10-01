import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { normalizeDeviceId, parseIsoDate, parseOptionalChannels } from '../common/util';
import { autoBucketSec, clampBucketSec, MAX_BUCKET_SEC, MIN_BUCKET_SEC } from './samples.logic';

export type Downsample = 'none' | number;

export type SampleQuery = {
  deviceId: string;
  from?: string;
  to?: string;
  channel?: string | number;
  downsample?: string;
};

@Injectable()
export class SamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  parseQuery(q: SampleQuery) {
    if (!q.deviceId) {
      throw new BadRequestException('Please choose a monitor.');
    }
    const deviceId = normalizeDeviceId(q.deviceId);
    const from = parseIsoDate(q.from, 'start time');
    const to = parseIsoDate(q.to, 'end time');
    const channels = parseOptionalChannels(q.channel);
    const downsample = this.parseDownsample(q.downsample, from, to);
    return { deviceId, from, to, channels, downsample };
  }

  private parseDownsample(raw: string | undefined, from?: Date, to?: Date): Downsample {
    const spanMs = from && to ? to.getTime() - from.getTime() : 0;
    /* A one-second bucket is what the probes already record, so group by nothing. */
    const forSpan = (sec: number): Downsample => (sec <= MIN_BUCKET_SEC ? 'none' : sec);
    if (!raw || raw === 'auto') {
      return spanMs > 0 ? forSpan(autoBucketSec(spanMs)) : 'none';
    }
    if (raw === 'none') {
      return 'none';
    }
    const sec = Number(raw);
    if (!Number.isInteger(sec) || sec < MIN_BUCKET_SEC || sec > MAX_BUCKET_SEC) {
      throw new BadRequestException('That time range could not be loaded.');
    }
    return forSpan(clampBucketSec(sec, spanMs));
  }

  private where(deviceId: string, from?: Date, to?: Date, channels?: number[]): Prisma.SampleWhereInput {
    return {
      deviceId,
      ...(channels && channels.length > 0 ? { channel: { in: channels } } : {}),
      ...(from || to
        ? {
            ts: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
  }

  async list(q: SampleQuery) {
    const { deviceId, from, to, channels, downsample } = this.parseQuery(q);
    await this.devices.require(deviceId);
    if (downsample === 'none') {
      return this.prisma.sample.findMany({
        where: this.where(deviceId, from, to, channels),
        orderBy: [{ ts: 'asc' }, { channel: 'asc' }],
        take: 100000,
      });
    }
    return this.bucketed(deviceId, from, to, channels, downsample);
  }

  async latest(deviceId: string) {
    const id = normalizeDeviceId(deviceId);
    await this.devices.require(id);
    return this.prisma.$queryRaw<
      Array<{
        deviceId: string;
        channel: number;
        ts: Date;
        tempC: number | null;
        rOhm: number | null;
        adcRaw: number | null;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (channel) "deviceId", channel, ts, "tempC", "rOhm", "adcRaw"
      FROM "Sample"
      WHERE "deviceId" = ${id}
      ORDER BY channel, ts DESC
    `);
  }

  async count(q: SampleQuery) {
    const { deviceId, from, to, channels } = this.parseQuery(q);
    await this.devices.require(deviceId);
    return {
      count: await this.prisma.sample.count({
        where: this.where(deviceId, from, to, channels),
      }),
    };
  }

  private async bucketed(
    deviceId: string,
    from: Date | undefined,
    to: Date | undefined,
    channels: number[] | undefined,
    bucketSec: number,
  ) {
    const fromClause = from ? Prisma.sql`AND ts >= ${from}` : Prisma.empty;
    const toClause = to ? Prisma.sql`AND ts <= ${to}` : Prisma.empty;
    const channelClause =
      channels && channels.length > 0
        ? Prisma.sql`AND channel IN (${Prisma.join(channels)})`
        : Prisma.empty;
    return this.prisma.$queryRaw<
      Array<{ ts: Date; channel: number; tempC: number | null; rOhm: number | null; adcRaw: number | null }>
    >(Prisma.sql`
      SELECT
        to_timestamp(floor(extract(epoch FROM (ts AT TIME ZONE 'UTC')) / ${bucketSec}) * ${bucketSec}) AS ts,
        channel,
        AVG("tempC") AS "tempC",
        AVG("rOhm") AS "rOhm",
        CAST(AVG("adcRaw") AS INTEGER) AS "adcRaw"
      FROM "Sample"
      WHERE "deviceId" = ${deviceId}
        ${fromClause}
        ${toClause}
        ${channelClause}
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `);
  }
}
