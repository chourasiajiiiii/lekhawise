import { addDays, type ISODate } from '@/core/utils/date';

import { type DateOrder, parseImportAmount, parseImportDate } from './csvImport';

/**
 * Turns the text lines of a receipt photo into a suggested amount, date and shop name.
 * Pure code, unit-tested with real-looking receipts. The user always checks the result.
 */

export type ReceiptGuess = { amount: number | null; date: ISODate | null; merchant: string | null };

/** Labels of the amount to pay, best first. */
const TOTAL_LABELS = [
  /grand\s*total/i,
  /(net|total)\s*(amount\s*)?(payable|due)/i,
  /amount\s*(payable|due|to\s*pay)/i,
  /balance\s*due/i,
  /total\s*amount/i,
  /net\s*(amount|total)/i,
  /bill\s*amount/i,
  /\btotal\b/i,
  /\bto\s*pay\b/i,
];

/** Lines that contain "total" but are not the amount paid. */
const NOT_TOTAL = /sub\s*-?\s*total|total\s*(items?|qty|quantity|savings?|discount|tax|gst|vat)|savings|discount|change|tendered|cash\s*paid|round(ed)?\s*off|tax(able)?\b|\bgst\b|\bvat\b|\bcgst\b|\bsgst\b/i;

/** "1,234.50", "1234.5", "1.234,50", "₹ 450", "Rs.450.00", "450.00 CR". */
const AMOUNT = /(?:(?:rs\.?|inr|₹|\$|€|£|aed|sar)\s*)?-?\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/gi;

function amountsIn(line: string, decimalSeparator: '.' | ',', currency?: string): number[] {
  const results: number[] = [];
  for (const match of line.matchAll(AMOUNT)) {
    const text = match[0];
    const digits = text.replace(/\D/g, '');
    if (digits.length > 9) continue; // phone and card numbers
    const hasSymbol = /rs|inr|₹|\$|€|£|aed|sar/i.test(text);
    const hasDecimals = /[.,]\d{1,2}$/.test(text.trim());
    if (!hasSymbol && !hasDecimals && digits.length >= 4 && /^(19|20)\d{2}$/.test(digits)) continue; // years
    const value = parseImportAmount(text.replace(/rs\.?|inr|aed|sar/gi, ''), decimalSeparator, currency);
    if (value !== null && value > 0) results.push(Math.abs(value));
  }
  return results;
}

function findTotal(lines: string[], decimalSeparator: '.' | ',', currency?: string): number | null {
  let best: { rank: number; index: number; amount: number } | null = null;
  lines.forEach((line, index) => {
    if (NOT_TOTAL.test(line)) return;
    const rank = TOTAL_LABELS.findIndex((label) => label.test(line));
    if (rank < 0) return;
    // The amount is usually on the same line, otherwise on the next one.
    const here = amountsIn(line, decimalSeparator, currency);
    const next = index + 1 < lines.length && !NOT_TOTAL.test(lines[index + 1]) ? amountsIn(lines[index + 1], decimalSeparator, currency) : [];
    const candidates = here.length ? here : next;
    if (!candidates.length) return;
    const amount = candidates[candidates.length - 1];
    // Prefer the strongest label; between equal labels prefer the later line (totals sit at the bottom).
    if (!best || rank < best.rank || (rank === best.rank && index > best.index)) best = { rank, index, amount };
  });
  if (best) return (best as { amount: number }).amount;
  // No label found: the largest amount with decimals is the most likely total.
  const all = lines.flatMap((line) => (/[.,]\d{2}\b/.test(line) ? amountsIn(line, decimalSeparator, currency) : []));
  return all.length ? Math.max(...all) : null;
}

const DATE_PATTERNS = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/,
  /\b\d{1,2}[\s-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,-]*\d{2,4}\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/i,
];

function findDate(lines: string[], order: DateOrder, today: ISODate): ISODate | null {
  const oldest = addDays(today, -400);
  for (const line of lines) {
    for (const pattern of DATE_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const date = parseImportDate(match[0], order) ?? parseImportDate(match[0], order === 'dmy' ? 'mdy' : 'dmy');
      if (date && date <= today && date >= oldest) return date;
    }
  }
  return null;
}

const NOT_MERCHANT = /invoice|receipt|bill\s*(no|#)|gstin|gst\s*no|tax|tel|phone|mob|www\.|@|cash\s*memo|order|table|date|time|cashier|counter|token|^\W*$/i;

function findMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    const text = line.trim();
    if (text.length < 3 || NOT_MERCHANT.test(text)) continue;
    if ((text.match(/[a-z]/gi) ?? []).length < 3) continue;
    if (DATE_PATTERNS.some((p) => p.test(text))) continue;
    return text.replace(/\s+/g, ' ').slice(0, 40);
  }
  return null;
}

export function parseReceipt(
  lines: string[],
  options: { today: ISODate; decimalSeparator?: '.' | ','; currency?: string; dateOrder?: DateOrder },
): ReceiptGuess {
  const clean = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const decimalSeparator = options.decimalSeparator ?? '.';
  return {
    amount: findTotal(clean, decimalSeparator, options.currency),
    date: findDate(clean, options.dateOrder ?? 'dmy', options.today),
    merchant: findMerchant(clean),
  };
}
