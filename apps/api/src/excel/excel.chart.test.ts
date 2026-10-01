import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { collectBuffer, embedLineChart } from './excel.chart';
import { excelChannelColumns, excelChartAnchor, excelLineChartSource } from './excel.logic';

async function sampleWorkbook(): Promise<Buffer> {
  const { stream, done } = collectBuffer();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: false,
    useSharedStrings: false,
  });
  const samples = workbook.addWorksheet('Samples');
  samples.addRow(['Cold store A']).commit();
  samples.addRow([]).commit();
  samples.addRow(['Time (UTC)', 'Fridge', 'Freezer']).commit();
  samples.addRow(['2026-10-01 10:00:00', 4.1, -18]).commit();
  samples.addRow(['2026-10-01 10:01:00', 4.2, -17]).commit();
  await samples.commit();
  await workbook.commit();
  return done;
}

describe('embedLineChart', () => {
  it('adds a native line chart to the right of the Samples table', async () => {
    const columns = excelChannelColumns([
      { index: 0, name: 'Fridge' },
      { index: 1, name: 'Freezer' },
    ]);
    const source = excelLineChartSource({
      sheetName: 'Samples',
      headerRow: 3,
      firstDataRow: 4,
      lastDataRow: 5,
      columns,
    });
    const anchor = excelChartAnchor(columns.length);
    const xlsx = await embedLineChart(await sampleWorkbook(), {
      sheetName: 'Samples',
      title: 'Cold store A',
      catsRef: source.catsRef,
      series: source.series,
      anchor,
    });
    const zip = await JSZip.loadAsync(xlsx);
    const chartXml = await zip.file('xl/charts/chart1.xml')!.async('string');
    const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    const drawing = await zip.file('xl/drawings/drawing1.xml')!.async('string');
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(zip.file('xl/workbook.xml') && (await zip.file('xl/workbook.xml')!.async('string'))).not.toContain(
      'name="Chart"',
    );
    expect(chartXml).toContain('Cold store A');
    expect(chartXml).toContain('Samples!$A$4:$A$5');
    expect(chartXml).toContain('Samples!$B$4:$B$5');
    expect(chartXml).toContain('val="E07A3D"');
    expect(sheet1).toContain('<drawing r:id="rId1"/>');
    expect(sheet1).toContain('Fridge');
    expect(drawing).toContain(`<xdr:col>${anchor.fromCol}</xdr:col>`);
    expect(types).toContain('/xl/charts/chart1.xml');
  });
});
