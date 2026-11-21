import { dateLocale, getLocalePrefs, t } from '../i18n/locale';

/**
 * Date helpers.
 *
 * Calendar dates are stored as local "YYYY-MM-DD" strings. They sort correctly
 * as text, compare with < and >, and never shift with time zones.
 */

export type ISODate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(date: Date): ISODate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of the given date. */
export function parseISODate(value: ISODate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toISODate(parseISODate(value)) === value;
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

export function monthKeyOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

export function currentMonthKey(): MonthKey {
  return monthKeyOf(todayISO());
}

/** First and last day (inclusive) of a month. */
export function monthBounds(month: MonthKey): { start: ISODate; end: ISODate } {
  const [y, m] = month.split('-').map(Number);
  return { start: `${month}-01`, end: `${month}-${pad(daysInMonth(y, m))}` };
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** The last `count` month keys ending with `month`, oldest first. */
export function lastMonths(month: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, i - count + 1));
}

/** Month keys from `from` to `to`, inclusive, oldest first. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const months: MonthKey[] = [];
  for (let m = from; m <= to && months.length < 1200; m = shiftMonth(m, 1)) months.push(m);
  return months;
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/**
 * The date `n` periods after `start`. Monthly and yearly schedules keep the
 * start day and clamp to the month end, so a rule starting Jan 31 runs on
 * Feb 28/29, Mar 31, Apr 30 and so on, without drifting.
 */
export function addPeriods(start: ISODate, frequency: Frequency, n: number): ISODate {
  const [y, m, d] = start.split('-').map(Number);
  switch (frequency) {
    case 'daily':
      return toISODate(new Date(y, m - 1, d + n));
    case 'weekly':
      return toISODate(new Date(y, m - 1, d + n * 7));
    case 'monthly': {
      const target = new Date(y, m - 1 + n, 1);
      const day = Math.min(d, daysInMonth(target.getFullYear(), target.getMonth() + 1));
      return toISODate(new Date(target.getFullYear(), target.getMonth(), day));
    }
    case 'yearly': {
      const day = Math.min(d, daysInMonth(y + n, m));
      return toISODate(new Date(y + n, m - 1, day));
    }
  }
}

// ---------------------------------------------------------------- weeks

/** 0 = Sunday, 1 = Monday, 6 = Saturday. */
export type WeekStart = 0 | 1 | 6;

/** The first day of the week containing `date`. */
export function weekStartOf(date: ISODate, weekStart: WeekStart): ISODate {
  const day = parseISODate(date).getDay();
  return addDays(date, -((day - weekStart + 7) % 7));
}

export function weekBounds(start: ISODate): { start: ISODate; end: ISODate } {
  return { start, end: addDays(start, 6) };
}

// ---------------------------------------------------------------- financial years

/**
 * A financial year starting in `startMonth` (1 = January, 4 = April) is named by the calendar
 * year it starts in: with April, FY 2026 runs from 1 April 2026 to 31 March 2027.
 */
export function financialYearOf(date: ISODate, startMonth: number): number {
  const [y, m] = date.split('-').map(Number);
  return m >= startMonth ? y : y - 1;
}

export function financialYearBounds(year: number, startMonth: number): { start: ISODate; end: ISODate } {
  const first: MonthKey = `${year}-${pad(startMonth)}`;
  return { start: `${first}-01`, end: monthBounds(shiftMonth(first, 11)).end };
}

/** The twelve months of a financial year, in order. */
export function financialYearMonths(year: number, startMonth: number): MonthKey[] {
  const first: MonthKey = `${year}-${pad(startMonth)}`;
  return Array.from({ length: 12 }, (_, i) => shiftMonth(first, i));
}

/** "2026" for calendar years, "2026–27" for years that start in another month. */
export function formatFinancialYear(year: number, startMonth: number): string {
  return startMonth === 1 ? String(year) : `${year}–${String(year + 1).slice(2)}`;
}

// ---------------------------------------------------------------- formatting

export function formatMonthLabel(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' });
}

export function formatShortMonth(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(dateLocale(), { month: 'short' });
}

export function formatWeekday(date: ISODate, style: 'short' | 'narrow' = 'short'): string {
  return parseISODate(date).toLocaleDateString(dateLocale(), { weekday: style });
}

/** Formats a date with the user's chosen format: "21 Nov 2026", "21/11/2026", "2026-11-21"... */
export function formatDate(date: ISODate): string {
  const format = getLocalePrefs().dateFormat;
  if (format === 'system') {
    return parseISODate(date).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const [y, m, d] = date.split('-');
  switch (format) {
    case 'dd/mm/yyyy':
      return `${d}/${m}/${y}`;
    case 'mm/dd/yyyy':
      return `${m}/${d}/${y}`;
    case 'dd-mm-yyyy':
      return `${d}-${m}-${y}`;
    case 'dd.mm.yyyy':
      return `${d}.${m}.${y}`;
    case 'yyyy-mm-dd':
      return date;
  }
}

/** "Today", "Yesterday" or e.g. "Sat, 21 Nov 2026". */
export function formatDayLabel(date: ISODate, today: ISODate = todayISO()): string {
  if (date === today) return t('Today');
  if (date === addDays(today, -1)) return t('Yesterday');
  return `${formatWeekday(date)}, ${formatDate(date)}`;
}
