import { computeDueOccurrences, MAX_OCCURRENCES_PER_RUN } from '../schedule';

const rule = (overrides: Partial<Parameters<typeof computeDueOccurrences>[0]> = {}) => ({
  frequency: 'monthly' as const,
  start_date: '2026-09-15',
  end_date: null,
  generated_count: 0,
  ...overrides,
});

describe('computeDueOccurrences', () => {
  it('creates every missed occurrence up to today', () => {
    const result = computeDueOccurrences(rule(), '2026-11-21');
    expect(result.dueDates).toEqual(['2026-09-15', '2026-10-15', '2026-11-15']);
    expect(result.generatedCount).toBe(3);
    expect(result.nextDate).toBe('2026-12-15');
    expect(result.active).toBe(true);
  });

  it('includes an occurrence that falls on today', () => {
    expect(computeDueOccurrences(rule({ start_date: '2026-11-21' }), '2026-11-21').dueDates).toEqual(['2026-11-21']);
  });

  it('creates nothing for a future start date', () => {
    const result = computeDueOccurrences(rule({ start_date: '2026-12-01' }), '2026-11-21');
    expect(result.dueDates).toEqual([]);
    expect(result.nextDate).toBe('2026-12-01');
  });

  it('continues from what was already generated', () => {
    const result = computeDueOccurrences(rule({ generated_count: 2 }), '2026-11-21');
    expect(result.dueDates).toEqual(['2026-11-15']);
  });

  it('stops at the end date and deactivates', () => {
    const result = computeDueOccurrences(rule({ end_date: '2026-10-31' }), '2026-11-21');
    expect(result.dueDates).toEqual(['2026-09-15', '2026-10-15']);
    expect(result.active).toBe(false);
  });

  it('caps a single run', () => {
    const result = computeDueOccurrences(rule({ frequency: 'daily', start_date: '2020-01-01' }), '2026-11-21');
    expect(result.dueDates).toHaveLength(MAX_OCCURRENCES_PER_RUN);
  });
});
