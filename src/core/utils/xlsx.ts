import { strToU8, zipSync } from 'fflate';

/**
 * A minimal .xlsx (Office Open XML) writer: one or more sheets with a bold header row,
 * text, number, money and date columns, and column widths. Opens in Excel, Google Sheets,
 * Numbers and LibreOffice. Pure code; only the small `fflate` library is used to zip the parts.
 */

export type XlsxColumn = { header: string; type: 'text' | 'number' | 'money' | 'date'; width?: number };
export type XlsxCell = string | number | null | undefined;
export type XlsxSheet = { name: string; columns: XlsxColumn[]; rows: XlsxCell[][] };

const STYLE = { header: 1, money: 2, date: 3, number: 4 } as const;

export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(sheets.length)),
    '_rels/.rels': strToU8(
      xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    ),
    'xl/workbook.xml': strToU8(workbook(sheets)),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels(sheets.length)),
    'xl/styles.xml': strToU8(styles()),
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(worksheet(sheet));
  });
  return zipSync(files, { level: 6 });
}

/** Excel stores dates as days since 30 December 1899. */
export function excelDate(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86_400_000);
}

export function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // not allowed in XML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

function sheetName(name: string, used: Set<string>): string {
  let clean = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let n = 2;
  while (used.has(clean.toLowerCase())) clean = `${clean.slice(0, 28)} ${n++}`;
  used.add(clean.toLowerCase());
  return clean;
}

function contentTypes(count: number): string {
  const sheets = Array.from(
    { length: count },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets}
</Types>`);
}

function workbook(sheets: XlsxSheet[]): string {
  const used = new Set<string>();
  const entries = sheets
    .map((s, i) => `<sheet name="${escapeXml(sheetName(s.name, used))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${entries}</sheets>
</workbook>`);
}

function workbookRels(count: number): string {
  const sheets = Array.from(
    { length: count },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('');
  return xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets}
<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
}

function styles(): string {
  return xml(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
</styleSheet>`);
}

function cellXml(ref: string, value: XlsxCell, column: XlsxColumn | undefined, header: boolean): string {
  if (value === null || value === undefined || value === '') return '';
  if (header) {
    return `<c r="${ref}" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
  }
  if (column?.type === 'date' && typeof value === 'string') {
    const serial = excelDate(value);
    if (serial !== null) return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const style = column?.type === 'money' ? STYLE.money : STYLE.number;
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function worksheet(sheet: XlsxSheet): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`)
    .join('');
  const allRows = [sheet.columns.map((c) => c.header), ...sheet.rows];
  const rowsXml = allRows
    .map((row, r) => {
      const cells = row.map((value, c) => cellXml(`${columnName(c)}${r + 1}`, value, sheet.columns[c], r === 0)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${rowsXml}</sheetData>
</worksheet>`);
}
