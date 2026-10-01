import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SampleStreamService } from '../events/sample-stream.service';
import { AlarmsService } from '../alarms/alarms.service';
import { ingestAckPayload, lastSeenViaForAuth, snapshotsToRows } from './ingest.logic';
import { chunk, normalizeDeviceId } from '../common/util';
import type { AuthRequest } from '../common/auth-request';
import type { IngestDto } from './dto/ingest.dto';

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: SampleStreamService,
    private readonly alarms: AlarmsService,
  ) {}

  async ingest(req: AuthRequest, body: IngestDto) {
    const deviceId = this.resolveDeviceId(req, body.deviceId);
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { channels: { orderBy: { index: 'asc' } } },
    });
    if (!device) {
      throw new NotFoundException('This monitor was not found.');
    }

    let rows;
    let ackedTs: Date | null;
    try {
      ({ rows, ackedTs } = snapshotsToRows(deviceId, body.snapshots, device.channels));
    } catch (err) {
      throw new BadRequestException('The temperature reading could not be saved.');
    }

    for (const group of chunk(rows, 50)) {
      await this.prisma.$transaction(
        group.map((row) =>
          this.prisma.sample.upsert({
            where: {
              deviceId_ts_channel: {
                deviceId: row.deviceId,
                ts: row.ts,
                channel: row.channel,
              },
            },
            create: {
              deviceId: row.deviceId,
              ts: row.ts,
              channel: row.channel,
              adcRaw: row.adcRaw,
              rOhm: row.rOhm,
              tempC: row.tempC,
            },
            update: {
              adcRaw: row.adcRaw,
              rOhm: row.rOhm,
              tempC: row.tempC,
            },
          }),
        ),
      );
    }

    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        lastSeen: new Date(),
        lastSeenVia: lastSeenViaForAuth(req.authKind),
      },
    });

    for (const row of rows) {
      this.stream.emit({
        deviceId: row.deviceId,
        channel: row.channel,
        ts: row.ts.toISOString(),
        tempC: row.tempC,
        rOhm: row.rOhm,
        adcRaw: row.adcRaw,
      });
    }

    if (rows.length > 0) {
      await this.alarms.processSamples(deviceId, rows);
    }

    return ingestAckPayload(ackedTs, rows.length);
  }

  private resolveDeviceId(req: AuthRequest, bodyDeviceId?: string) {
    if (req.authKind === 'device') {
      if (!req.device) {
        throw new ForbiddenException('This monitor is not authorized.');
      }
      if (bodyDeviceId) {
        const normalized = normalizeDeviceId(bodyDeviceId);
        if (normalized !== req.device.id) {
          throw new ForbiddenException('This monitor is not authorized.');
        }
      }
      return req.device.id;
    }
    if (!bodyDeviceId) {
      throw new BadRequestException('Please choose a monitor.');
    }
    return normalizeDeviceId(bodyDeviceId);
  }
}
