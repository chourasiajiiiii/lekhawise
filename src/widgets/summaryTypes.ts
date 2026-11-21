/** Everything the home-screen widget shows, already formatted (the widget runtime cannot format money). */
export type SummaryWidgetProps = {
  title: string;
  todayLabel: string;
  today: string;
  monthLine: string;
  budgetLine: string;
};

export const EMPTY_SUMMARY: SummaryWidgetProps = {
  title: 'LekhaWise',
  todayLabel: 'Spent today',
  today: '–',
  monthLine: 'Open LekhaWise once to fill in this widget.',
  budgetLine: '',
};
