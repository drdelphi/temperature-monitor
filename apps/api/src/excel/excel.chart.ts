import { PassThrough } from 'node:stream';
import JSZip from 'jszip';
import type { ExcelChartAnchor, ExcelChartSeriesRef } from './excel.logic';

const DRAWING_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const CHART_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const DRAWING_CT = 'application/vnd.openxmlformats-officedocument.drawing+xml';
const CHART_CT = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

export type EmbedLineChartOpts = {
  sheetName: string;
  title: string;
  catsRef: string;
  series: ExcelChartSeriesRef[];
  anchor: ExcelChartAnchor;
};

export function collectBuffer(): { stream: PassThrough; done: Promise<Buffer> } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  return { stream, done };
}

export async function embedLineChart(xlsx: Buffer, opts: EmbedLineChartOpts): Promise<Buffer> {
  if (opts.series.length === 0) {
    return xlsx;
  }
  const zip = await JSZip.loadAsync(xlsx);
  const workbookXml = await readZip(zip, 'xl/workbook.xml');
  const relsXml = await readZip(zip, 'xl/_rels/workbook.xml.rels');
  const sheetPath = worksheetPath(workbookXml, relsXml, opts.sheetName);
  const sheetXml = await readZip(zip, sheetPath);
  const sheetRelsPath = relsPathFor(sheetPath);
  const existingRels = zip.file(sheetRelsPath) ? await readZip(zip, sheetRelsPath) : emptyRels();
  const drawingRid = nextRid(existingRels);

  zip.file(sheetRelsPath, insertBefore(existingRels, '</Relationships>', drawingRel(drawingRid)));
  zip.file(sheetPath, insertBefore(sheetXml, '</worksheet>', `<drawing r:id="${drawingRid}"/>`));
  zip.file('xl/drawings/drawing1.xml', drawingXml(opts.anchor));
  zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRels());
  zip.file('xl/charts/chart1.xml', chartXml(opts));
  zip.file('[Content_Types].xml', withChartContentTypes(await readZip(zip, '[Content_Types].xml')));

  return Buffer.from(
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    }),
  );
}

async function readZip(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (!file) {
    throw new Error(`Workbook is missing ${name}.`);
  }
  return file.async('string');
}

function xmlAttr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m?.[1] ?? null;
}

function worksheetPath(workbookXml: string, relsXml: string, sheetName: string): string {
  const sheets = workbookXml.match(/<sheet\b[^>]*>/g) ?? [];
  const sheet = sheets.find((tag) => xmlAttr(tag, 'name') === sheetName);
  const rid = sheet ? xmlAttr(sheet, 'r:id') : null;
  if (!rid) {
    throw new Error(`Workbook is missing sheet ${sheetName}.`);
  }
  const rels = relsXml.match(/<Relationship\b[^>]*>/g) ?? [];
  const rel = rels.find((tag) => xmlAttr(tag, 'Id') === rid);
  const target = rel ? xmlAttr(rel, 'Target') : null;
  if (!target) {
    throw new Error(`Workbook is missing the ${sheetName} sheet file.`);
  }
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function relsPathFor(sheetPath: string): string {
  const i = sheetPath.lastIndexOf('/');
  const dir = sheetPath.slice(0, i);
  const file = sheetPath.slice(i + 1);
  return `${dir}/_rels/${file}.rels`;
}

function emptyRels(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
}

function nextRid(relsXml: string): string {
  const nums = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return `rId${nums.length ? Math.max(...nums) + 1 : 1}`;
}

function insertBefore(haystack: string, needle: string, insert: string): string {
  const i = haystack.lastIndexOf(needle);
  if (i < 0) {
    throw new Error(`Workbook XML is missing ${needle}.`);
  }
  return `${haystack.slice(0, i)}${insert}${haystack.slice(i)}`;
}

function drawingRel(rid: string): string {
  return `<Relationship Id="${rid}" Type="${DRAWING_TYPE}" Target="../drawings/drawing1.xml"/>`;
}

function drawingRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${CHART_TYPE}" Target="../charts/chart1.xml"/>
</Relationships>`;
}

function drawingXml(anchor: ExcelChartAnchor): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>${anchor.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${anchor.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="Chart 1"/>
        <xdr:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></xdr:cNvGraphicFramePr>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
}

function withChartContentTypes(xml: string): string {
  let out = xml;
  if (!out.includes('PartName="/xl/drawings/drawing1.xml"')) {
    out = insertBefore(
      out,
      '</Types>',
      `<Override PartName="/xl/drawings/drawing1.xml" ContentType="${DRAWING_CT}"/>`,
    );
  }
  if (!out.includes('PartName="/xl/charts/chart1.xml"')) {
    out = insertBefore(
      out,
      '</Types>',
      `<Override PartName="/xl/charts/chart1.xml" ContentType="${CHART_CT}"/>`,
    );
  }
  return out;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function seriesXml(series: ExcelChartSeriesRef, idx: number, catsRef: string): string {
  return `<c:ser>
      <c:idx val="${idx}"/>
      <c:order val="${idx}"/>
      <c:tx><c:strRef><c:f>${xmlEscape(series.nameRef)}</c:f></c:strRef></c:tx>
      <c:spPr><a:ln w="25400"><a:solidFill><a:srgbClr val="${series.color}"/></a:solidFill></a:ln></c:spPr>
      <c:marker><c:symbol val="none"/></c:marker>
      <c:cat><c:strRef><c:f>${xmlEscape(catsRef)}</c:f></c:strRef></c:cat>
      <c:val><c:numRef><c:f>${xmlEscape(series.valuesRef)}</c:f></c:numRef></c:val>
      <c:smooth val="0"/>
    </c:ser>`;
}

function chartXml(opts: EmbedLineChartOpts): string {
  const series = opts.series.map((s, i) => seriesXml(s, i, opts.catsRef)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr><a:defRPr sz="1400"/></a:pPr>
            <a:r><a:rPr lang="en-US" sz="1400"/><a:t>${xmlEscape(opts.title)}</a:t></a:r>
          </a:p>
        </c:rich>
      </c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${series}
        <c:marker val="0"/>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="2"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:numFmt formatCode="0.0" sourceLinked="0"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="1"/>
        <c:crosses val="autoZero"/>
        <c:crossBetween val="between"/>
        <c:title>
          <c:tx>
            <c:rich>
              <a:bodyPr rot="-5400000" vert="horz"/>
              <a:lstStyle/>
              <a:p>
                <a:pPr><a:defRPr/></a:pPr>
                <a:r><a:t>°C</a:t></a:r>
              </a:p>
            </c:rich>
          </c:tx>
          <c:overlay val="0"/>
        </c:title>
      </c:valAx>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="b"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="span"/>
  </c:chart>
</c:chartSpace>`;
}
