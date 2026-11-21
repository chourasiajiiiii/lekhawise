/**
 * Pure logic of the newer features: budgets, loans, insights and net worth history.
 */
import { setLocalePrefs } from '@/core/i18n/locale';

import { budgetLevel, bucketByPeriod, carryInto, limitAt, periodBounds, periodKeyOf, projectSpending, shiftPeriod } from '../budgetMath';
import { buildInsights, comparablePeriod, compareCategories, percentChange, savingsRate, trendStats } from '../insights';
import { amortizationSchedule, computeEmi, interestForMonth, monthsRemaining, parseRate, splitPayment, totalInterest } from '../loanMath';
import { computeNetWorthSeries } from '../repoWealth';

describe('budget maths', () => {
  it('identifies periods', () => {
    expect(periodKeyOf('2026-11-22', 'month', 1)).toBe('2026-11');
    expect(periodKeyOf('2026-11-22', 'week', 1)).toBe('2026-11-16');
    expect(periodBounds('2026-11-16', 'week')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(shiftPeriod('2026-11-16', 'week', -1)).toBe('2026-11-09');
    expect(shiftPeriod('2026-01', 'month', -1)).toBe('2025-12');
  });

  it('applies the latest limit at or before a period', () => {
    const limits = [{ start: '2026-01', amount: 100 }, { start: '2026-06', amount: 200 }];
    expect(limitAt(limits, '2025-12')).toBeNull();
    expect(limitAt(limits, '2026-03')).toBe(100);
    expect(limitAt(limits, '2026-06')).toBe(200);
    expect(limitAt(limits, '2030-01')).toBe(200);
  });

  it('carries unspent money forward and resets on overspending', () => {
    const limits = [{ start: '2026-01', amount: 100 }];
    const spent: Record<string, number> = { '2026-01': 40, '2026-02': 300, '2026-03': 50 };
    const at = (key: string) => carryInto(key, '2026-01', 'month', limits, (p) => spent[p] ?? 0);
    expect(at('2026-01')).toBe(0);
    expect(at('2026-02')).toBe(60);
    expect(at('2026-03')).toBe(0);
    expect(at('2026-04')).toBe(50);
  });

  it('buckets days into weeks and rates progress', () => {
    const buckets = bucketByPeriod([{ date: '2026-11-15', amount: 5 }, { date: '2026-11-16', amount: 7 }, { date: '2026-11-22', amount: 1 }], 'week', 1);
    expect(Object.fromEntries(buckets)).toEqual({ '2026-11-09': 5, '2026-11-16': 8 });
    expect(budgetLevel(79, 100)).toBe('ok');
    expect(budgetLevel(80, 100)).toBe('warning');
    expect(budgetLevel(101, 100)).toBe('over');
    expect(projectSpending(1000, 10, 30)).toBe(3000);
  });
});

describe('loan maths', () => {
  it('computes the standard EMI', () => {
    // 10 lakh at 8.5% for 20 years: about 8,678 a month
    expect(computeEmi(1_000_000_00, 850, 240)).toBe(867_823);
    expect(computeEmi(12_000_00, 0, 12)).toBe(1_000_00);
    expect(interestForMonth(1_000_000_00, 1200)).toBe(10_000_00);
  });

  it('builds a schedule that ends at exactly zero', () => {
    const schedule = amortizationSchedule(100_000_00, 1200, 12, '2026-01-15');
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toMatchObject({ number: 1, date: '2026-02-15', interest: 1_000_00 });
    expect(schedule[11].balance).toBe(0);
    expect(schedule.reduce((s, r) => s + r.principal, 0)).toBe(100_000_00);
    expect(totalInterest(schedule)).toBeGreaterThan(6_000_00);
  });

  it('splits a payment and counts the months left', () => {
    expect(splitPayment(10_000, 100_000, 1200)).toEqual({ interest: 1_000, principal: 9_000 });
    expect(splitPayment(500, 100_000, 1200)).toEqual({ interest: 500, principal: 0 });
    expect(monthsRemaining(100_000_00, 1200, 8_885_00)).toBe(12);
    // after the first EMI of a 5 lakh, 9.5%, 60-month loan: 59 left, not 60 because of paise of rounding
    const schedule = amortizationSchedule(500_000_00, 950, 60, '2026-11-21');
    expect(monthsRemaining(schedule[0].balance, 950, computeEmi(500_000_00, 950, 60))).toBe(59);
    expect(monthsRemaining(0, 950, 100)).toBe(0);
    expect(monthsRemaining(100_000_00, 1200, 500_00)).toBeNull(); // never pays off
    expect(parseRate('8.5')).toBe(850);
    expect(parseRate('8,25%')).toBe(825);
    expect(parseRate('')).toBe(0);
    expect(parseRate('abc')).toBeNull();
  });
});

describe('insights', () => {
  const money = (minor: number) => `₹${minor / 100}`;
  beforeEach(() => setLocalePrefs({ language: 'en' }));

  it('compares categories and periods', () => {
    const rows = compareCategories(
      [{ id: 'a', name: 'Food', total: 500 }, { id: 'b', name: 'Fuel', total: 100 }],
      [{ id: 'a', name: 'Food', total: 1000 }, { id: 'c', name: 'Gifts', total: 50 }],
    );
    expect(rows.map((r) => [r.id, r.change, r.percent])).toEqual([['a', -500, -50], ['b', 100, null], ['c', -50, -100]]);
    expect(percentChange(150, 100)).toBe(50);
    expect(savingsRate(1000, 750)).toBe(25);
    expect(savingsRate(0, 10)).toBeNull();
    expect(trendStats([{ key: 'x', value: 0 }, { key: 'y', value: 10 }, { key: 'z', value: 30 }])).toEqual({
      average: 20,
      highest: { key: 'z', value: 30 },
      lowest: { key: 'y', value: 10 },
    });
  });

  it('compares a period in progress with the same part of the previous one', () => {
    expect(comparablePeriod({ start: '2026-11-01', end: '2026-11-30' }, { start: '2026-10-01', end: '2026-10-31' }, '2026-11-21')).toEqual({ start: '2026-10-01', end: '2026-10-21', partial: true });
    expect(comparablePeriod({ start: '2026-03-01', end: '2026-03-31' }, { start: '2026-02-01', end: '2026-02-28' }, '2026-03-30')).toEqual({ start: '2026-02-01', end: '2026-02-28', partial: true });
    expect(comparablePeriod({ start: '2026-04-01', end: '2027-03-31' }, { start: '2025-04-01', end: '2026-03-31' }, '2026-11-21').end).toBe('2025-11-21');
    expect(comparablePeriod({ start: '2026-10-01', end: '2026-10-31' }, { start: '2026-09-01', end: '2026-09-30' }, '2026-11-21')).toEqual({ start: '2026-09-01', end: '2026-09-30', partial: false });
  });

  it('warns about a budget that will run out and notices growth', () => {
    const insights = buildInsights(
      {
        income: 100_000,
        expense: 60_000,
        lastMonthToDateExpense: 40_000,
        categories: [{ id: 'f', name: 'Food', total: 30_000 }, { id: 't', name: 'Travel', total: 30_000 }],
        lastMonthToDateCategories: [{ id: 'f', name: 'Food', total: 10_000 }],
        budgets: [{ name: 'Food', spent: 30_000, limit: 40_000 }],
        daysElapsed: 10,
        daysInMonth: 30,
        isCurrentMonth: true,
      },
      money,
    );
    expect(insights.map((i) => i.text)).toEqual([
      'At this pace Food will reach ₹900, ₹500 over budget.',
      'You have spent 50% more than at this point last month.',
      'Food is up 200% (₹200 more than last month so far).',
      'You have kept 40% of your income this month.',
    ]);
  });
});

describe('net worth history', () => {
  it('adds account flows and the latest holding values at each month end', () => {
    const series = computeNetWorthSeries(
      ['2026-09', '2026-10', '2026-11'],
      1_000,
      [{ month: '2026-10', net: 500 }, { month: '2026-11', net: -200 }],
      [
        { holding_id: 'h', date: '2026-10-05', value: 3_000 },
        { holding_id: 'h', date: '2026-11-30', value: 3_500 },
        { holding_id: 'k', date: '2026-12-01', value: 9_999 },
      ],
    );
    expect(series.map((p) => p.netWorth)).toEqual([1_000, 4_500, 4_800]);
  });
});
