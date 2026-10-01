import { Injectable, NotFoundException } from '@nestjs/common';
import type { AlarmEvent, Sample } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeDeviceId } from '../common/util';
import { collectBuffer, embedLineChart } from './excel.chart';
import {
  EXCEL_DATA_START_ROW,
  EXCEL_HEADER_ROW,
  EXCEL_SAMPLES_SHEET,
  excelChannelColumns,
  excelChartAnchor,
  excelDataRow,
  excelLineChartSource,
  excelTitleRows,
  foldSamples,
  formatExcelTs,
  type TimestampTemps,
} from './excel.logic';

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
    const columns = excelChannelColumns(device.channels, opts.channels);

    const fromLabel = from.toISOString().replace(/[:.]/g, '-');
    const toLabel = to.toISOString().replace(/[:.]/g, '-');
    const filename = `temp-${deviceId}-${fromLabel}-${toLabel}.xlsx`;

    const where = {
      deviceId,
      ts: { gte: from, lte: to },
      ...(opts.channels && opts.channels.length > 0 ? { channel: { in: opts.channels } } : {}),
    };
    const total = await this.prisma.sample.count({ where });
    const includeChart = columns.length > 0 && total > 0;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const { stream, done } = collectBuffer();
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: false,
      useSharedStrings: false,
    });

    const samplesSheet = workbook.addWorksheet(EXCEL_SAMPLES_SHEET);
    for (const row of excelTitleRows(device.name, columns)) {
      samplesSheet.addRow(row).commit();
    }

    let written = 0;
    let dataRows = 0;
    let lastTs: Date | null = null;
    let lastChannel = -1;
    let pending: TimestampTemps | null = null;

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
        take: Math.min(CHUNK, SAMPLE_CAP - written),
      });
      if (batch.length === 0) {
        break;
      }
      const folded = foldSamples(pending, batch);
      for (const group of folded.complete) {
        samplesSheet.addRow(excelDataRow(group.ts, group.temps, columns)).commit();
        dataRows += 1;
      }
      pending = folded.pending;
      written += batch.length;
      lastTs = batch[batch.length - 1].ts;
      lastChannel = batch[batch.length - 1].channel;
      if (batch.length < CHUNK) {
        break;
      }
    }

    if (pending) {
      samplesSheet.addRow(excelDataRow(pending.ts, pending.temps, columns)).commit();
      dataRows += 1;
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
            formatExcelTs(event.ts),
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

    let xlsx = await done;
    if (includeChart && dataRows > 0) {
      const source = excelLineChartSource({
        sheetName: EXCEL_SAMPLES_SHEET,
        headerRow: EXCEL_HEADER_ROW,
        firstDataRow: EXCEL_DATA_START_ROW,
        lastDataRow: EXCEL_DATA_START_ROW + dataRows - 1,
        columns,
      });
      xlsx = await embedLineChart(xlsx, {
        sheetName: EXCEL_SAMPLES_SHEET,
        title: device.name,
        catsRef: source.catsRef,
        series: source.series,
        anchor: excelChartAnchor(columns.length),
      });
    }
    res.end(xlsx);
  }
}
