import { daysInMonth, type ISODate } from '@/core/utils/date';
import { parseAmount } from '@/core/utils/money';

import type { TxType } from './types';

/**
 * Bank-statement and spreadsheet import. Pure functions: column guessing, date and amount
 * parsing, and turning rows into transactions. Unit-tested without a database.
 */

export type ColumnMapping = {
  date: number | null;
  description: number | null;
  /** One signed amount column (negative = money out)... */
  amount: number | null;
  /** ...or separate money-out and money-in columns. */
  debit: number | null;
  credit: number | null;
  /** Optional: "expense"/"income"/"transfer" or "Dr"/"Cr". */
  type: number | null;
  category: number | null;
  account: number | null;
  toAccount: number | null;
};

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

const HEADER_PATTERNS: [keyof ColumnMapping, RegExp][] = [
  ['date', /^(txn |transaction |value |posting |booking )?date$|^date\b/i],
  ['toAccount', /^to account$/i],
  ['account', /^account( name)?$/i],
  ['debit', /debit|withdrawal|money out|paid out|^dr\.?$|^out$/i],
  ['credit', /credit|deposit|money in|paid in|^cr\.?$|^in$/i],
  ['amount', /^amount|amount( \(.*\))?$|^value$/i],
  ['type', /^(type|dr\s*\/\s*cr|cr\s*\/\s*dr)$/i],
  ['category', /^category$/i],
  ['description', /narration|description|details|particulars|note|remarks|memo|payee|merchant/i],
];

/** Guesses columns from the header row. */
export function guessMapping(header: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    date: null, description: null, amount: null, debit: null, credit: null, type: null, category: null,
    account: null, toAccount: null,
  };
  header.forEach((raw, index) => {
    const name = raw.trim();
    for (const [field, pattern] of HEADER_PATTERNS) {
      if (mapping[field] === null && pattern.test(name)) {
        mapping[field] = index;
        return;
      }
    }
  });
  if (mapping.debit !== null && mapping.credit !== null) mapping.amount = null;
  return mapping;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Reads a date such as "21/11/2026", "11/21/26", "2026-11-21", "21-Nov-2026" or "21 November 2026".
 * `order` says which way round numeric day and month are. Returns null when it is not a valid date.
 */
export function parseImportDate(text: string, order: DateOrder): ISODate | null {
  const cleaned = text.trim().replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?.*$/, ''); // drop a time part
  const parts = cleaned.split(/[\s/.,-]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  let day: number;
  let month: number;
  let year: number;
  const monthIndex = parts.findIndex((p) => /^[a-z]{3,}/i.test(p));
  if (monthIndex >= 0) {
    month = MONTHS.indexOf(parts[monthIndex].slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    const rest = parts.filter((_, i) => i !== monthIndex).map(Number);
    // "Nov 21 2026", "21 Nov 2026" or "2026 Nov 21"
    if (String(parts[0]).length === 4 && monthIndex === 1) [year, day] = rest;
    else if (monthIndex === 0) [day, year] = rest;
    else [day, year] = rest;
  } else {
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isInteger(n))) return null;
    if (parts[0].length === 4) [year, month, day] = nums;
    else if (order === 'mdy') [month, day, year] = nums;
    else if (order === 'ymd') [year, month, day] = nums;
    else [day, month, year] = nums;
  }
  if (year < 100) year += 2000;
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (month < 1 || month > 12 || year < 1900 || year > 2200) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Picks the day/month order that reads every sample; day-first wins a tie, as most banks use it. */
export function detectDateOrder(samples: string[]): DateOrder {
  const values = samples.filter((s) => s.trim()).slice(0, 200);
  for (const order of ['dmy', 'mdy', 'ymd'] as const) {
    if (values.every((v) => parseImportDate(v, order) !== null)) return order;
  }
  return 'dmy';
}

/**
 * Reads a statement amount: "1,234.50", "-1,234.50", "(1,234.50)", "1,234.50 Dr", "₹ 500", "500 CR".
 * Returns signed minor units (negative = money out), or null for an empty or unreadable cell.
 */
export function parseImportAmount(text: string, decimalSeparator: '.' | ',', currency?: string): number | null {
  let raw = text.trim();
  if (!raw || raw === '-') return null;
  let sign = 1;
  if (/\bdr\.?$/i.test(raw)) {
    sign = -1;
    raw = raw.replace(/\bdr\.?$/i, '');
  } else if (/\bcr\.?$/i.test(raw)) {
    raw = raw.replace(/\bcr\.?$/i, '');
  }
  if (/^\(.*\)$/.test(raw.trim())) {
    sign = -sign;
    raw = raw.trim().slice(1, -1);
  }
  raw = raw.replace(/[^\d.,\-+]/g, ''); // currency symbols and letters
  if (raw.startsWith('-')) {
    sign = -sign;
    raw = raw.slice(1);
  } else if (raw.startsWith('+')) {
    raw = raw.slice(1);
  }
  const minor = parseAmount(raw, { decimalSeparator, currency });
  return minor === null ? null : sign * minor;
}

export type ImportRow = {
  line: number;
  date: ISODate | null;
  type: TxType;
  amount: number; // positive minor units
  description: string;
  categoryName: string;
  accountName: string;
  toAccountName: string;
  error: string | null;
};

/** Turns CSV rows (header excluded) into transactions to import, with a reason for any row that cannot be used. */
export function buildImportRows(
  rows: string[][],
  mapping: ColumnMapping,
  options: { dateOrder: DateOrder; decimalSeparator: '.' | ','; currency?: string; firstLine?: number },
): ImportRow[] {
  const cell = (row: string[], index: number | null) => (index === null ? '' : (row[index] ?? '').trim());
  return rows.map((row, i) => {
    const line = (options.firstLine ?? 2) + i;
    const date = parseImportDate(cell(row, mapping.date), options.dateOrder);
    let signed: number | null = null;
    if (mapping.amount !== null) {
      signed = parseImportAmount(cell(row, mapping.amount), options.decimalSeparator, options.currency);
    } else {
      const out = parseImportAmount(cell(row, mapping.debit), options.decimalSeparator, options.currency);
      const inn = parseImportAmount(cell(row, mapping.credit), options.decimalSeparator, options.currency);
      if (out && !inn) signed = -Math.abs(out);
      else if (inn && !out) signed = Math.abs(inn);
      else if (out && inn) signed = Math.abs(inn) - Math.abs(out);
    }
    const typeText = cell(row, mapping.type).toLowerCase();
    let type: TxType;
    if (/^transfer/.test(typeText)) type = 'transfer';
    else if (/^(expense|debit|dr|withdrawal)/.test(typeText)) type = 'expense';
    else if (/^(income|credit|cr|deposit)/.test(typeText)) type = 'income';
    else type = (signed ?? 0) < 0 ? 'expense' : 'income';
    const amount = Math.abs(signed ?? 0);

    let error: string | null = null;
    if (!date) error = 'Date not recognised';
    else if (signed === null || amount === 0) error = 'No amount';

    return {
      line,
      date,
      type,
      amount,
      description: cell(row, mapping.description),
      categoryName: cell(row, mapping.category),
      accountName: cell(row, mapping.account),
      toAccountName: cell(row, mapping.toAccount),
      error,
    };
  });
}
