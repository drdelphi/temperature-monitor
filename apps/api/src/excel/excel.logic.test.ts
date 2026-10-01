import { describe, expect, it } from 'vitest';
import {
  excelA1Col,
  excelChannelColumns,
  excelChartAnchor,
  excelDataRow,
  excelLineChartSource,
  excelTitleRows,
  foldSamples,
  formatExcelTs,
  type ExcelSample,
} from './excel.logic';

const channels = [
  { index: 0, name: 'Fridge' },
  { index: 1, name: 'Freezer' },
  { index: 2, name: 'Ambient' },
];

describe('excelChannelColumns', () => {
  it('uses channel names in index order as headers', () => {
    expect(excelChannelColumns(channels)).toEqual([
      { index: 0, name: 'Fridge' },
      { index: 1, name: 'Freezer' },
      { index: 2, name: 'Ambient' },
    ]);
  });

  it('keeps only selected channels', () => {
    expect(excelChannelColumns(channels, [2, 0])).toEqual([
      { index: 0, name: 'Fridge' },
      { index: 2, name: 'Ambient' },
    ]);
  });

  it('falls back to Sensor N when a name is blank', () => {
    expect(excelChannelColumns([{ index: 3, name: '  ' }])).toEqual([
      { index: 3, name: 'Sensor 4' },
    ]);
  });
});

describe('excelTitleRows', () => {
  it('puts the monitor name above a time-and-channel table', () => {
    expect(excelTitleRows('Cold store A', excelChannelColumns(channels))).toEqual([
      ['Cold store A'],
      [],
      ['Time (UTC)', 'Fridge', 'Freezer', 'Ambient'],
    ]);
  });
});

describe('excelLineChartSource', () => {
  it('builds A1 ranges for time and each channel', () => {
    expect(
      excelLineChartSource({
        sheetName: 'Samples',
        headerRow: 3,
        firstDataRow: 4,
        lastDataRow: 10,
        columns: excelChannelColumns(channels),
      }),
    ).toEqual({
      catsRef: 'Samples!$A$4:$A$10',
      series: [
        { nameRef: 'Samples!$B$3', valuesRef: 'Samples!$B$4:$B$10', color: 'E07A3D' },
        { nameRef: 'Samples!$C$3', valuesRef: 'Samples!$C$4:$C$10', color: '3D9AD6' },
        { nameRef: 'Samples!$D$3', valuesRef: 'Samples!$D$4:$D$10', color: 'C9A227' },
      ],
    });
  });
});

describe('excelChartAnchor', () => {
  it('places the chart one column to the right of the table', () => {
    expect(excelChartAnchor(2)).toEqual({ fromCol: 4, fromRow: 0, toCol: 20, toRow: 22 });
  });
});

describe('excelA1Col', () => {
  it('converts 1-based indexes to column letters', () => {
    expect(excelA1Col(1)).toBe('A');
    expect(excelA1Col(26)).toBe('Z');
    expect(excelA1Col(27)).toBe('AA');
  });
});

describe('formatExcelTs', () => {
  it('writes UTC time as a readable date and clock', () => {
    expect(formatExcelTs(new Date('2026-10-01T10:05:09.123Z'))).toBe('2026-10-01 10:05:09');
  });
});

describe('foldSamples', () => {
  it('pivots temperatures onto one row per timestamp', () => {
    const t1 = new Date('2026-10-01T10:00:00.000Z');
    const t2 = new Date('2026-10-01T10:01:00.000Z');
    const samples: ExcelSample[] = [
      { ts: t1, channel: 0, tempC: 4.1 },
      { ts: t1, channel: 1, tempC: -18 },
      { ts: t2, channel: 0, tempC: 4.2 },
      { ts: t2, channel: 2, tempC: null },
    ];
    const cols = excelChannelColumns(channels);
    const { complete, pending } = foldSamples(null, samples);
    expect(complete).toHaveLength(1);
    expect(excelDataRow(complete[0].ts, complete[0].temps, cols)).toEqual([
      '2026-10-01 10:00:00',
      4.1,
      -18,
      null,
    ]);
    expect(pending).not.toBeNull();
    expect(excelDataRow(pending!.ts, pending!.temps, cols)).toEqual([
      '2026-10-01 10:01:00',
      4.2,
      null,
      null,
    ]);
  });

  it('carries a pending timestamp across batches', () => {
    const ts = new Date('2026-10-01T10:00:00.000Z');
    const first = foldSamples(null, [{ ts, channel: 0, tempC: 1 }]);
    const second = foldSamples(first.pending, [
      { ts, channel: 1, tempC: 2 },
      { ts: new Date('2026-10-01T10:00:01.000Z'), channel: 0, tempC: 3 },
    ]);
    expect(first.complete).toHaveLength(0);
    expect(second.complete).toHaveLength(1);
    expect(second.complete[0].temps.get(0)).toBe(1);
    expect(second.complete[0].temps.get(1)).toBe(2);
  });
});
