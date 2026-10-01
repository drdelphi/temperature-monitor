import { Injectable, NotFoundException } from '@nestjs/common';
import type { AlarmEvent, Sample } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeDeviceId, parseIsoDate, parseOptionalChannels } from '../common/util';

const SAMPLE_CAP = 100000;
const CHUNK = 1000;

@Injectable()
export class ExcelService {
  constructor(private readonly prisma: PrismaService) {}

  async writeDeviceWorkbook(
    res: Response,
    opts: { deviceId: string; from?: Date; to?: Date; channels?: number[] },
  ) {
    const deviceId = normalizeDeviceId(opts.deviceId);
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { channels: { orderBy: { index: 'asc' } } },
    });
    if (!device) {
      throw new NotFoundException('This monitor was not found.');
    }
    const from = opts.from ?? new Date(0);
    const to = opts.to ?? new Date();
    const channelNames = new Map(device.channels.map((c) => [c.index, c.name]));

    const fromLabel = from.toISOString().replace(/[:.]/g, '-');
    const toLabel = to.toISOString().replace(/[:.]/g, '-');
    const filename = `temp-${deviceId}-${fromLabel}-${toLabel}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: false,
      useSharedStrings: false,
    });

    const samplesSheet = workbook.addWorksheet('Samples');
    samplesSheet
      .addRow([
        'Time (UTC)',
        'Time',
        'Monitor',
        'Sensor number',
        'Sensor',
        'Temperature (°C)',
        'Resistance (Ω)',
        'Raw reading',
      ])
      .commit();

    const where = {
      deviceId,
      ts: { gte: from, lte: to },
      ...(opts.channels && opts.channels.length > 0 ? { channel: { in: opts.channels } } : {}),
    };

    const total = await this.prisma.sample.count({ where });
    let written = 0;
    let lastTs: Date | null = null;
    let lastChannel = -1;

    while (written < SAMPLE_CAP) {
      const batch: Sample[] = await this.prisma.sample.findMany({
        where: {
          ...where,
          ...(lastTs
            ? {
                OR: [{ ts: { gt: lastTs } }, { ts: lastTs, channel: { gt: lastChannel } }],
              }
            : {}),
        },
        orderBy: [{ ts: 'asc' }, { channel: 'asc' }],
        take: CHUNK,
      });
      if (batch.length === 0) {
        break;
      }
      for (const sample of batch) {
        const iso = sample.ts.toISOString();
        const local = `${iso} ${sample.ts.toLocaleString('en-GB', { timeZone: 'UTC' })}`;
        samplesSheet
          .addRow([
            iso,
            local,
            device.name,
            sample.channel,
            channelNames.get(sample.channel) ?? `Sensor ${sample.channel + 1}`,
            sample.tempC,
            sample.rOhm,
            sample.adcRaw,
          ])
          .commit();
        written += 1;
        lastTs = sample.ts;
        lastChannel = sample.channel;
        if (written >= SAMPLE_CAP) {
          break;
        }
      }
      if (batch.length < CHUNK) {
        break;
      }
    }

    if (total > SAMPLE_CAP) {
      samplesSheet
        .addRow([
          `This file includes the first ${SAMPLE_CAP} of ${total} readings. Choose a shorter time range.`,
        ])
        .commit();
    }
    await samplesSheet.commit();

    const alarmsSheet = workbook.addWorksheet('Alarms');
    alarmsSheet
      .addRow(['Sensor', 'When', 'Limit (°C)', 'Event', 'SMS', 'Telegram', 'Time'])
      .commit();

    let lastEventTs: Date | null = null;
    let lastEventId: string | null = null;
    for (;;) {
      const events: AlarmEvent[] = await this.prisma.alarmEvent.findMany({
        where: {
          deviceId,
          ts: { gte: from, lte: to },
          ...(opts.channels && opts.channels.length > 0 ? { channel: { in: opts.channels } } : {}),
          ...(lastEventTs && lastEventId
            ? {
                OR: [{ ts: { gt: lastEventTs } }, { ts: lastEventTs, id: { gt: lastEventId } }],
              }
            : {}),
        },
        orderBy: [{ ts: 'asc' }, { id: 'asc' }],
        take: CHUNK,
      });
      if (events.length === 0) {
        break;
      }
      for (const event of events) {
        alarmsSheet
          .addRow([
            channelNames.get(event.channel) ?? `Sensor ${event.channel + 1}`,
            event.kind === 'below' ? 'Too cold' : event.kind === 'above' ? 'Too hot' : event.kind,
            event.thresholdC,
            event.action === 'fired' ? 'Alert' : 'Cleared',
            event.notifySms ? 'Yes' : 'No',
            event.notifyTelegram ? 'Yes' : 'No',
            event.ts.toISOString(),
          ])
          .commit();
        lastEventTs = event.ts;
        lastEventId = event.id;
      }
      if (events.length < CHUNK) {
        break;
      }
    }
    await alarmsSheet.commit();
    await workbook.commit();
  }
}
