import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AlarmAction, AlarmKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../notify/notify.service';
import { DevicesService } from '../devices/devices.service';
import type { SampleRow } from '../ingest/ingest.logic';
import type { UpsertAlarmDto } from './dto/upsert-alarm.dto';
import {
  applyAlarmDecision,
  evaluateAlarmSample,
  formatAlarmMessage,
  type AlarmSnapshot,
} from './alarm-logic';
import { normalizeDeviceId } from '../common/util';

@Injectable()
export class AlarmsService {
  private readonly logger = new Logger(AlarmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
    private readonly devices: DevicesService,
  ) {}

  async list(deviceId: string) {
    await this.devices.require(deviceId);
    return this.prisma.alarm.findMany({
      where: { deviceId: normalizeDeviceId(deviceId) },
      orderBy: [{ channel: 'asc' }, { kind: 'asc' }],
    });
  }

  async replaceOrUpsert(deviceId: string, items: UpsertAlarmDto[]) {
    const device = await this.devices.require(deviceId);
    const id = device.id;
    const results = [];
    for (const item of items) {
      const existing = await this.prisma.alarm.findFirst({
        where: { deviceId: id, channel: item.channel, kind: item.kind },
      });
      const data = {
        thresholdC: item.thresholdC,
        enabled: item.enabled,
        hysteresis: item.hysteresis,
        cooldownSec: item.cooldownSec,
        notifySms: item.notifySms,
        notifyTelegram: item.notifyTelegram,
      };
      if (existing) {
        results.push(
          await this.prisma.alarm.update({
            where: { id: existing.id },
            data,
          }),
        );
      } else {
        results.push(
          await this.prisma.alarm.create({
            data: {
              deviceId: id,
              channel: item.channel,
              kind: item.kind,
              ...data,
            },
          }),
        );
      }
    }
    return results;
  }

  async processSamples(deviceId: string, rows: SampleRow[]) {
    const alarms = await this.prisma.alarm.findMany({
      where: { deviceId, enabled: true },
    });
    if (alarms.length === 0) {
      return;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { channels: true },
    });
    if (!device) {
      throw new NotFoundException('This monitor was not found.');
    }
    const channelNames = new Map(device.channels.map((c) => [c.index, c.name]));
    const operator = await this.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });

    const state = new Map<string, (typeof alarms)[number] & AlarmSnapshot>();
    for (const alarm of alarms) {
      state.set(alarm.id, {
        ...alarm,
        lastFiredAt: alarm.lastFiredAt,
      });
    }

    const events: Array<{
      alarmId: string;
      deviceId: string;
      channel: number;
      kind: AlarmKind;
      thresholdC: number;
      ts: Date;
      action: AlarmAction;
      notifySms: boolean;
      notifyTelegram: boolean;
      tempC: number;
    }> = [];

    const ordered = [...rows].sort(
      (a, b) => a.ts.getTime() - b.ts.getTime() || a.channel - b.channel,
    );

    for (const row of ordered) {
      if (row.tempC == null) {
        continue;
      }
      for (const alarm of state.values()) {
        if (alarm.channel !== row.channel) {
          continue;
        }
        const decision = evaluateAlarmSample(alarm, row.tempC, row.ts);
        if (!decision) {
          continue;
        }
        applyAlarmDecision(alarm, decision, row.ts);
        events.push({
          alarmId: alarm.id,
          deviceId,
          channel: alarm.channel,
          kind: alarm.kind,
          thresholdC: alarm.thresholdC,
          ts: row.ts,
          action: decision === 'fired' ? AlarmAction.fired : AlarmAction.cleared,
          notifySms: decision === 'fired' && alarm.notifySms,
          notifyTelegram: decision === 'fired' && alarm.notifyTelegram,
          tempC: row.tempC,
        });
      }
    }

    if (events.length === 0) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const alarm of state.values()) {
        await tx.alarm.update({
          where: { id: alarm.id },
          data: {
            active: alarm.active,
            lastFiredAt: alarm.lastFiredAt,
          },
        });
      }
      await tx.alarmEvent.createMany({
        data: events.map(({ tempC: _tempC, ...rest }) => rest),
      });
    });

    for (const event of events) {
      if (event.action !== AlarmAction.fired) {
        continue;
      }
      const message = formatAlarmMessage({
        deviceName: device.name,
        channelName: channelNames.get(event.channel) ?? `Sensor ${event.channel + 1}`,
        kind: event.kind,
        thresholdC: event.thresholdC,
        tempC: event.tempC,
        ts: event.ts,
      });
      try {
        if (event.notifySms && operator?.phoneE164) {
          await this.notify.sendSms(operator.phoneE164, message);
        }
        if (event.notifyTelegram && operator?.telegramChatId) {
          await this.notify.sendTelegram(operator.telegramChatId, message);
        }
      } catch (err) {
        this.logger.warn(`notify failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
