import { registerTranslations } from '@/features/expenses/i18n';

import { setLocalePrefs } from '../../i18n/locale';
import {
  addDays,
  addPeriods,
  daysBetween,
  financialYearBounds,
  financialYearMonths,
  financialYearOf,
  formatDate,
  formatDayLabel,
  formatFinancialYear,
  isISODate,
  lastMonths,
  monthBounds,
  shiftMonth,
  weekStartOf,
} from '../date';

registerTranslations();

describe('addPeriods', () => {
  it('adds days and weeks across month and year ends', () => {
    expect(addPeriods('2026-12-30', 'daily', 3)).toBe('2027-01-02');
    expect(addPeriods('2026-02-25', 'weekly', 1)).toBe('2026-03-04');
  });

  it('clamps monthly schedules to the month end without drifting', () => {
    const start = '2026-01-31';
    expect(addPeriods(start, 'monthly', 1)).toBe('2026-02-28');
    expect(addPeriods(start, 'monthly', 2)).toBe('2026-03-31'); // back to the 31st, not stuck on the 28th
    expect(addPeriods(start, 'monthly', 3)).toBe('2026-04-30');
    expect(addPeriods('2027-11-30', 'monthly', 3)).toBe('2028-02-29'); // leap year
  });

  it('handles yearly schedules on 29 February', () => {
    expect(addPeriods('2028-02-29', 'yearly', 1)).toBe('2029-02-28');
    expect(addPeriods('2028-02-29', 'yearly', 4)).toBe('2032-02-29');
  });
});

describe('months', () => {
  it('returns inclusive bounds', () => {
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('shifts across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('isISODate', () => {
  it('accepts real dates only', () => {
    expect(isISODate('2026-11-21')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-1-5')).toBe(false);
    expect(isISODate(20261121)).toBe(false);
  });
});

describe('weeks and financial years', () => {
  it('finds the start of the week', () => {
    // 2026-11-22 is a Sunday
    expect(weekStartOf('2026-11-22', 1)).toBe('2026-11-16');
    expect(weekStartOf('2026-11-22', 0)).toBe('2026-11-22');
    expect(weekStartOf('2026-11-22', 6)).toBe('2026-11-21');
  });

  it('works out April to March financial years', () => {
    expect(financialYearOf('2026-03-31', 4)).toBe(2025);
    expect(financialYearOf('2026-04-01', 4)).toBe(2026);
    expect(financialYearBounds(2026, 4)).toEqual({ start: '2026-04-01', end: '2027-03-31' });
    expect(financialYearMonths(2026, 4)[11]).toBe('2027-03');
    expect(formatFinancialYear(2026, 4)).toBe('2026–27');
    expect(formatFinancialYear(2026, 1)).toBe('2026');
    expect(financialYearBounds(2026, 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('counts days', () => {
    expect(daysBetween('2026-11-21', '2026-12-01')).toBe(10);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('date formats', () => {
  afterEach(() => setLocalePrefs({ dateFormat: 'system', language: 'en' }));

  it('uses the chosen format', () => {
    setLocalePrefs({ dateFormat: 'dd/mm/yyyy' });
    expect(formatDate('2026-11-05')).toBe('05/11/2026');
    setLocalePrefs({ dateFormat: 'mm/dd/yyyy' });
    expect(formatDate('2026-11-05')).toBe('11/05/2026');
    setLocalePrefs({ dateFormat: 'yyyy-mm-dd' });
    expect(formatDate('2026-11-05')).toBe('2026-11-05');
    expect(formatDayLabel('2026-11-21', '2026-11-21')).toBe('Today');
    expect(formatDayLabel('2026-11-20', '2026-11-21')).toBe('Yesterday');
  });

  it('translates day labels', () => {
    setLocalePrefs({ language: 'hi' });
    expect(formatDayLabel('2026-11-21', '2026-11-21')).toBe('आज');
  });
});
