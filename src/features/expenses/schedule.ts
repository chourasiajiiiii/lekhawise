import { addPeriods, type Frequency, type ISODate } from '@/core/utils/date';

/** Safety cap so a rule with a very old start date cannot freeze the app. */
export const MAX_OCCURRENCES_PER_RUN = 500;

type ScheduleInput = {
  frequency: Frequency;
  start_date: ISODate;
  end_date: ISODate | null;
  generated_count: number;
};

export type ScheduleResult = {
  /** Dates that are due now and have not been created yet. */
  dueDates: ISODate[];
  generatedCount: number;
  nextDate: ISODate;
  /** False once the next occurrence falls after the end date. */
  active: boolean;
};

/**
 * Works out which occurrences of a recurring rule are due by `today`.
 * Pure function: it is easy to test and the database code just applies the result.
 */
export function computeDueOccurrences(rule: ScheduleInput, today: ISODate): ScheduleResult {
  const dueDates: ISODate[] = [];
  let count = rule.generated_count;
  let next = addPeriods(rule.start_date, rule.frequency, count);

  while (next <= today && (rule.end_date === null || next <= rule.end_date) && dueDates.length < MAX_OCCURRENCES_PER_RUN) {
    dueDates.push(next);
    count += 1;
    next = addPeriods(rule.start_date, rule.frequency, count);
  }

  return {
    dueDates,
    generatedCount: count,
    nextDate: next,
    active: rule.end_date === null || next <= rule.end_date,
  };
}
