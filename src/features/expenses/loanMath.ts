import { addPeriods, type ISODate } from '@/core/utils/date';

/**
 * Loan arithmetic for reducing-balance loans (home, car, personal loans, EMIs).
 * Pure functions on integer minor units, unit-tested without a database.
 *
 * Rates are stored in hundredths of a percent per year: 850 means 8.50% a year.
 */

export function monthlyRate(annualRate: number): number {
  return annualRate / 10000 / 12;
}

/** The fixed monthly instalment that repays `principal` over `months` at `annualRate`. */
export function computeEmi(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = monthlyRate(annualRate);
  if (r === 0) return Math.ceil(principal / months);
  const growth = (1 + r) ** months;
  return Math.round((principal * r * growth) / (growth - 1));
}

/** Interest due for one month on an outstanding balance. */
export function interestForMonth(outstanding: number, annualRate: number): number {
  if (outstanding <= 0) return 0;
  return Math.round(outstanding * monthlyRate(annualRate));
}

export type ScheduleRow = {
  number: number;
  date: ISODate;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
};

/**
 * The full repayment schedule. The first instalment falls one month after `startDate`; the last one
 * is adjusted so the balance ends at exactly zero.
 */
export function amortizationSchedule(
  principal: number,
  annualRate: number,
  months: number,
  startDate: ISODate,
  emi: number = computeEmi(principal, annualRate, months),
): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let i = 1; i <= months && balance > 0 && i <= 1200; i++) {
    const interest = interestForMonth(balance, annualRate);
    let principalPart = emi - interest;
    if (principalPart <= 0) break; // the instalment does not even cover the interest
    if (i === months || principalPart > balance) principalPart = balance;
    balance -= principalPart;
    rows.push({
      number: i,
      date: addPeriods(startDate, 'monthly', i),
      payment: principalPart + interest,
      interest,
      principal: principalPart,
      balance,
    });
  }
  return rows;
}

/** Total interest over the life of the loan. */
export function totalInterest(schedule: ScheduleRow[]): number {
  return schedule.reduce((sum, row) => sum + row.interest, 0);
}

/**
 * Splits a payment into interest and principal. Interest is one month's interest on what is
 * outstanding, capped at the payment; the rest reduces the loan.
 */
export function splitPayment(payment: number, outstanding: number, annualRate: number): { interest: number; principal: number } {
  const interest = Math.min(payment, interestForMonth(outstanding, annualRate));
  return { interest, principal: payment - interest };
}

/** Months left at the current instalment, or null if it never pays off. */
export function monthsRemaining(outstanding: number, annualRate: number, emi: number): number | null {
  if (outstanding <= 0) return 0;
  if (emi <= 0) return null;
  let balance = outstanding;
  for (let months = 1; months <= 1200; months++) {
    const interest = interestForMonth(balance, annualRate);
    // The last instalment may be smaller than the EMI; rounding leftovers do not add a month.
    if (balance + interest <= emi + months) return months;
    if (emi <= interest) return null;
    balance -= emi - interest;
  }
  return null;
}

/** Parses "8.5", "8,5" or "8.5%" into hundredths of a percent (850). Empty means 0; nonsense gives null. */
export function parseRate(text: string): number | null {
  const cleaned = text.trim().replace(',', '.').replace('%', '').trim();
  if (!cleaned) return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
