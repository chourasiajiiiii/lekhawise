import { t } from '@/core/i18n/locale';
import type { IconName } from '@/core/ui';

import { addDays, daysBetween, type ISODate } from '@/core/utils/date';

import { projectSpending } from './budgetMath';

/**
 * Financial insights and period comparisons. Pure functions: the screen loads the numbers,
 * these turn them into short sentences. Unit-tested without a database.
 */

export type CategoryAmount = { id: string; name: string; total: number };

export type CategoryComparison = {
  id: string;
  name: string;
  current: number;
  previous: number;
  change: number;
  /** Percentage change, or null when there was nothing to compare with. */
  percent: number | null;
};

/** Lines up two periods' category totals, biggest change first. */
export function compareCategories(current: CategoryAmount[], previous: CategoryAmount[]): CategoryComparison[] {
  const rows = new Map<string, CategoryComparison>();
  for (const c of current) {
    rows.set(c.id, { id: c.id, name: c.name, current: c.total, previous: 0, change: c.total, percent: null });
  }
  for (const p of previous) {
    const row = rows.get(p.id) ?? { id: p.id, name: p.name, current: 0, previous: 0, change: 0, percent: null };
    row.previous = p.total;
    row.change = row.current - p.total;
    rows.set(p.id, row);
  }
  for (const row of rows.values()) row.percent = percentChange(row.current, row.previous);
  return [...rows.values()].sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export type TrendStats = { average: number; highest: { key: string; value: number } | null; lowest: { key: string; value: number } | null };

/** Average, highest and lowest of a series, ignoring empty periods for highest and lowest. */
export function trendStats(series: { key: string; value: number }[]): TrendStats {
  const nonEmpty = series.filter((s) => s.value !== 0);
  if (!nonEmpty.length) return { average: 0, highest: null, lowest: null };
  const total = nonEmpty.reduce((sum, s) => sum + s.value, 0);
  let highest = nonEmpty[0];
  let lowest = nonEmpty[0];
  for (const s of nonEmpty) {
    if (s.value > highest.value) highest = s;
    if (s.value < lowest.value) lowest = s;
  }
  return { average: Math.round(total / nonEmpty.length), highest, lowest };
}

/**
 * For a period still in progress, the matching part of the period it is compared with: November 1-21
 * against October 1-21, April-November of this financial year against April-November of the last.
 * Comparing a half-finished period with a whole one would always look like a fall.
 */
export function comparablePeriod(
  current: { start: ISODate; end: ISODate },
  previous: { start: ISODate; end: ISODate },
  today: ISODate,
): { start: ISODate; end: ISODate; partial: boolean } {
  if (today < current.start || today >= current.end) return { ...previous, partial: false };
  const cut = addDays(previous.start, daysBetween(current.start, today));
  return { start: previous.start, end: cut < previous.end ? cut : previous.end, partial: true };
}

export function savingsRate(income: number, expense: number): number | null {
  if (income <= 0) return null;
  return Math.round(((income - expense) / income) * 100);
}

export type Insight = { icon: IconName; tone: 'good' | 'warning' | 'info'; text: string };

export type InsightInput = {
  income: number;
  expense: number;
  /** Expenses last month up to the same day of the month, for a fair comparison. */
  lastMonthToDateExpense: number;
  categories: CategoryAmount[];
  lastMonthToDateCategories: CategoryAmount[];
  budgets: { name: string | null; spent: number; limit: number }[];
  daysElapsed: number;
  daysInMonth: number;
  /** True when looking at the current month (projections only make sense then). */
  isCurrentMonth: boolean;
};

/** Up to four short observations about the month, most useful first. */
export function buildInsights(input: InsightInput, money: (minor: number) => string): Insight[] {
  const insights: Insight[] = [];

  // Budgets heading over the limit at the current pace.
  if (input.isCurrentMonth && input.daysElapsed < input.daysInMonth) {
    for (const b of input.budgets) {
      if (b.spent > b.limit) continue; // already over: the budget card shows that
      const projected = projectSpending(b.spent, input.daysElapsed, input.daysInMonth);
      if (projected > b.limit * 1.05 && b.spent > 0) {
        insights.push({
          icon: 'speedometer-outline',
          tone: 'warning',
          text: t('At this pace {name} will reach {projected}, {over} over budget.', {
            name: b.name ?? t('total spending'),
            projected: money(projected),
            over: money(projected - b.limit),
          }),
        });
      }
    }
  }

  // Spending compared with the same point last month.
  if (input.expense > 0 && input.lastMonthToDateExpense > 0) {
    const pct = percentChange(input.expense, input.lastMonthToDateExpense) ?? 0;
    if (Math.abs(pct) >= 10) {
      insights.push(
        pct > 0
          ? { icon: 'trending-up-outline', tone: 'warning', text: t('You have spent {pct}% more than at this point last month.', { pct }) }
          : { icon: 'trending-down-outline', tone: 'good', text: t('You have spent {pct}% less than at this point last month.', { pct: -pct }) },
      );
    }
  }

  // The category that grew the most.
  const growth = compareCategories(input.categories, input.lastMonthToDateCategories).find(
    (c) => c.change > 0 && c.previous > 0 && (c.percent ?? 0) >= 25,
  );
  if (growth) {
    insights.push({
      icon: 'alert-circle-outline',
      tone: 'info',
      text: t('{name} is up {pct}% ({change} more than last month so far).', {
        name: growth.name,
        pct: growth.percent ?? 0,
        change: money(growth.change),
      }),
    });
  }

  // Savings.
  const rate = savingsRate(input.income, input.expense);
  if (rate !== null) {
    insights.push(
      rate >= 0
        ? { icon: 'leaf-outline', tone: rate >= 20 ? 'good' : 'info', text: t('You have kept {rate}% of your income this month.', { rate }) }
        : { icon: 'warning-outline', tone: 'warning', text: t('Expenses are {amount} more than income this month.', { amount: money(input.expense - input.income) }) },
    );
  }

  // The biggest category's share.
  const top = input.categories[0];
  if (top && input.expense > 0) {
    const share = Math.round((top.total / input.expense) * 100);
    if (share >= 30) {
      insights.push({ icon: 'pie-chart-outline', tone: 'info', text: t('{name} makes up {share}% of your spending.', { name: top.name, share }) });
    }
  }

  return insights.slice(0, 4);
}
