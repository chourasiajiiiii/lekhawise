import {
  addDays,
  type ISODate,
  monthBounds,
  monthKeyOf,
  shiftMonth,
  weekStartOf,
  type WeekStart,
} from '@/core/utils/date';

import type { BudgetPeriod } from './types';

/**
 * Budget arithmetic. Pure functions, unit-tested without a database.
 *
 * A period is identified by a key: "YYYY-MM" for monthly budgets, the week's first day
 * ("YYYY-MM-DD") for weekly ones. Keys of the same kind sort in time order as text.
 */

export function periodKeyOf(date: ISODate, period: BudgetPeriod, weekStart: WeekStart): string {
  return period === 'month' ? monthKeyOf(date) : weekStartOf(date, weekStart);
}

export function periodBounds(key: string, period: BudgetPeriod): { start: ISODate; end: ISODate } {
  return period === 'month' ? monthBounds(key) : { start: key, end: addDays(key, 6) };
}

export function shiftPeriod(key: string, period: BudgetPeriod, delta: number): string {
  return period === 'month' ? shiftMonth(key, delta) : addDays(key, delta * 7);
}

/**
 * The limit in force for a period: the latest one starting at or before it, or null before the first.
 * `limits` must be sorted by start, oldest first (which is how they are loaded).
 */
export function limitAt(limits: { start: string; amount: number }[], key: string): number | null {
  let found: number | null = null;
  for (const limit of limits) {
    if (limit.start > key) break;
    found = limit.amount;
  }
  return found;
}

/**
 * Money carried into `key` from earlier periods. Unspent money rolls over; overspending does
 * not reduce the next period. Counting starts at `firstKey` (when the budget was created).
 */
export function carryInto(
  key: string,
  firstKey: string,
  period: BudgetPeriod,
  limits: { start: string; amount: number }[],
  spentIn: (key: string) => number,
): number {
  let carry = 0;
  let guard = 0;
  for (let p = firstKey; p < key && guard < 2000; p = shiftPeriod(p, period, 1), guard++) {
    const limit = limitAt(limits, p);
    if (limit === null) {
      carry = 0;
      continue;
    }
    carry = Math.max(0, limit + carry - spentIn(p));
  }
  return carry;
}

/** Sums daily amounts into period buckets. */
export function bucketByPeriod(
  days: { date: ISODate; amount: number }[],
  period: BudgetPeriod,
  weekStart: WeekStart,
): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const day of days) {
    const key = periodKeyOf(day.date, period, weekStart);
    buckets.set(key, (buckets.get(key) ?? 0) + day.amount);
  }
  return buckets;
}

export type BudgetLevel = 'ok' | 'warning' | 'over';

/** 'warning' from 80% of the limit, 'over' once spending passes it. */
export function budgetLevel(spent: number, limit: number): BudgetLevel {
  if (spent > limit) return 'over';
  if (spent >= limit * 0.8) return 'warning';
  return 'ok';
}

/**
 * How spending is tracking against a monthly or weekly limit, given how far into the period we are.
 * Returns the projected total at the end of the period if the current pace continues.
 */
export function projectSpending(spent: number, daysElapsed: number, daysInPeriod: number): number {
  if (daysElapsed <= 0) return spent;
  return Math.round((spent / daysElapsed) * daysInPeriod);
}
