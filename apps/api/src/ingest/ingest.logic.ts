import {
  adcToC,
  adcToOhm,
  CHANNEL_COUNT,
  expandIngestSnapshot,
  isDisabledAdc,
  isMeasurableAdc,
  type IngestSnapshot,
} from '../common/pack';

export type ChannelCal = {
  index: number;
  bValue: number;
  gain: number;
  offset: number;
};

export type SampleRow = {
  deviceId: string;
  ts: Date;
  channel: number;
  adcRaw: number;
  rOhm: number | null;
  tempC: number | null;
};

export function sampleUniqueKey(row: Pick<SampleRow, 'deviceId' | 'ts' | 'channel'>): string {
  return `${row.deviceId}|${row.ts.toISOString()}|${row.channel}`;
}

export function collapseByUniqueKey(rows: SampleRow[]): SampleRow[] {
  const map = new Map<string, SampleRow>();
  for (const row of rows) {
    map.set(sampleUniqueKey(row), row);
  }
  return [...map.values()];
}

export function rowFromAdc(
  deviceId: string,
  ts: Date,
  channel: number,
  adc: number,
  cal: ChannelCal,
): SampleRow | null {
  if (isDisabledAdc(adc)) {
    return null;
  }
  if (!isMeasurableAdc(adc)) {
    return null;
  }
  return {
    deviceId,
    ts,
    channel,
    adcRaw: adc,
    rOhm: adcToOhm(adc),
    tempC: adcToC(adc, cal.bValue, cal.gain, cal.offset),
  };
}

export function snapshotsToRows(
  deviceId: string,
  snapshots: IngestSnapshot[],
  channels: ChannelCal[],
  now = new Date(),
): { rows: SampleRow[]; ackedTs: Date | null } {
  const byIndex = new Map(channels.map((c) => [c.index, c]));
  const raw: SampleRow[] = [];
  let ackedTs: Date | null = null;

  for (const snap of snapshots) {
    const { ts: deviceTs, adc } = expandIngestSnapshot(snap);
    if (Number.isNaN(deviceTs.getTime())) {
      throw new Error('invalid snapshot ts');
    }
    if (!ackedTs || deviceTs.getTime() > ackedTs.getTime()) {
      ackedTs = deviceTs;
    }
    /* Keep the device timestamp on the ACK so flash erase stays correct.
     * Store wall time when the RTC is still at factory 2000 so the live
     * websocket (last two minutes) can actually see the rows. */
    const ts = deviceTs.getUTCFullYear() < 2020 ? now : deviceTs;
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const cal = byIndex.get(i);
      if (!cal) {
        continue;
      }
      const row = rowFromAdc(deviceId, ts, i, adc[i] ?? 0, cal);
      if (row) {
        raw.push(row);
      }
    }
  }

  const rows = collapseByUniqueKey(raw);
  rows.sort((a, b) => a.ts.getTime() - b.ts.getTime() || a.channel - b.channel);
  return { rows, ackedTs };
}

/** ACK payload after the batch has been written. Device may erase flash up to ackedTs. */
export function ingestAckPayload(ackedTs: Date | null, inserted: number) {
  return {
    ack: ackedTs !== null,
    ackedTs: ackedTs ? ackedTs.toISOString() : null,
    inserted,
  };
}
