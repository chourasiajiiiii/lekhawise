export type CsvCell = string | number | null | undefined;

/**
 * Builds RFC 4180 CSV text that opens cleanly in Excel, Google Sheets and Numbers.
 * Text cells that start with = + - @ are prefixed with ' so spreadsheet apps
 * do not run them as formulas (CSV injection). Numbers are written as-is.
 */
export function toCsv(rows: CsvCell[][]): string {
  const body = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  return `﻿${body}\r\n`; // BOM so Excel reads UTF-8 (₹, €, accents) correctly
}

function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return String(cell);
  let text = cell;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Picks the delimiter that splits the first lines into the most consistent number of columns. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best: ',' | ';' | '\t' = ',';
  let bestScore = -1;
  for (const delimiter of [',', ';', '\t'] as const) {
    const counts = lines.map((line) => parseCsv(line, delimiter)[0]?.length ?? 0);
    if (!counts.length || counts[0] < 2) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 100 + counts[0];
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Parses CSV text (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes).
 * Removes a leading BOM and skips completely empty lines.
 */
export function parseCsv(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
    field = '';
  };
  while (i < input.length) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}
