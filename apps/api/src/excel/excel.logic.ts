export const EXCEL_SAMPLES_SHEET = 'Samples';
export const EXCEL_HEADER_ROW = 3;
export const EXCEL_DATA_START_ROW = 4;

export type ExcelChartAnchor = {
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
};

/** Same palette as the web charts, without the leading #. */
export const CHANNEL_COLORS = [
  'E07A3D',
  '3D9AD6',
  'C9A227',
  '5AAA78',
  'C45C5C',
  '6B7FC4',
  'C4844A',
  '4AA8A8',
] as const;

export type ExcelChannelCol = {
  index: number;
  name: string;
};

export type ExcelChartSeriesRef = {
  nameRef: string;
  valuesRef: string;
  color: string;
};

export type ExcelSample = {
  ts: Date;
  channel: number;
  tempC: number | null;
};

export type TimestampTemps = {
  ts: Date;
  temps: Map<number, number | null>;
};

export function excelChannelColumns(
  channels: Array<{ index: number; name: string }>,
  filter?: number[],
): ExcelChannelCol[] {
  const selected = filter && filter.length > 0 ? new Set(filter) : null;
  return [...channels]
    .filter((c) => !selected || selected.has(c.index))
    .sort((a, b) => a.index - b.index)
    .map((c) => ({
      index: c.index,
      name: c.name.trim() ? c.name : `Sensor ${c.index + 1}`,
    }));
}

export function excelTitleRows(monitorName: string, columns: ExcelChannelCol[]): (string | number | null)[][] {
  return [[monitorName], [], excelHeaderRow(columns)];
}

export function excelHeaderRow(columns: ExcelChannelCol[]): (string | number | null)[] {
  return ['Time (UTC)', ...columns.map((c) => c.name)];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatExcelTs(ts: Date): string {
  return `${ts.getUTCFullYear()}-${pad2(ts.getUTCMonth() + 1)}-${pad2(ts.getUTCDate())} ${pad2(ts.getUTCHours())}:${pad2(ts.getUTCMinutes())}:${pad2(ts.getUTCSeconds())}`;
}

export function excelDataRow(
  ts: Date,
  temps: Map<number, number | null>,
  columns: ExcelChannelCol[],
): (string | number | null)[] {
  return [
    formatExcelTs(ts),
    ...columns.map((c) => (temps.has(c.index) ? temps.get(c.index)! : null)),
  ];
}

export function foldSamples(
  pending: TimestampTemps | null,
  samples: ExcelSample[],
): { complete: TimestampTemps[]; pending: TimestampTemps | null } {
  let current = pending;
  const complete: TimestampTemps[] = [];
  for (const sample of samples) {
    if (current && sample.ts.getTime() !== current.ts.getTime()) {
      complete.push(current);
      current = null;
    }
    if (!current) {
      current = { ts: sample.ts, temps: new Map() };
    }
    current.temps.set(sample.channel, sample.tempC);
  }
  return { complete, pending: current };
}

export function excelA1Col(col1: number): string {
  if (!Number.isInteger(col1) || col1 < 1) {
    throw new Error('Column must be a positive integer.');
  }
  let n = col1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function excelSheetFormulaName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9._]*$/.test(name)) {
    return name;
  }
  return `'${name.replace(/'/g, "''")}'`;
}

export function excelLineChartSource(opts: {
  sheetName: string;
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  columns: ExcelChannelCol[];
}): { catsRef: string; series: ExcelChartSeriesRef[] } {
  const sheet = excelSheetFormulaName(opts.sheetName);
  const catsRef = `${sheet}!$A$${opts.firstDataRow}:$A$${opts.lastDataRow}`;
  const series = opts.columns.map((col, i) => {
    const letter = excelA1Col(i + 2);
    return {
      nameRef: `${sheet}!$${letter}$${opts.headerRow}`,
      valuesRef: `${sheet}!$${letter}$${opts.firstDataRow}:$${letter}$${opts.lastDataRow}`,
      color: CHANNEL_COLORS[col.index % CHANNEL_COLORS.length] ?? CHANNEL_COLORS[0],
    };
  });
  return { catsRef, series };
}

export function excelChartAnchor(channelCount: number): ExcelChartAnchor {
  const tableCols = 1 + channelCount;
  const fromCol = tableCols + 1;
  const fromRow = 0;
  return {
    fromCol,
    fromRow,
    toCol: fromCol + 16,
    toRow: fromRow + 22,
  };
}
