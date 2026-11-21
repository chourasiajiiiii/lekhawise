import { requireOptionalNativeModule } from 'expo-modules-core';
import type { SQLiteDatabase } from 'expo-sqlite';

import { t } from '@/core/i18n/locale';
import { currentMonthKey, formatMonthLabel, monthBounds, todayISO } from '@/core/utils/date';
import { formatMoney } from '@/core/utils/money';

import type { SummaryWidgetProps } from '../../widgets/summaryTypes';
import { periodSummary } from './repo';
import { listBudgetStatus } from './repoBudgets';
import { getCurrency, getWeekStart } from './settings';

type SummaryWidget = { updateSnapshot(props: SummaryWidgetProps): void };

/** The widget, loaded only where the native widget module exists (installed builds, not Expo Go). */
function loadWidget(): SummaryWidget | null {
  if (!requireOptionalNativeModule('ExpoWidgets')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('../../widgets/SummaryWidget') as { default: SummaryWidget }).default;
  } catch {
    return null;
  }
}

/** What the widget shows: today's spending, this month's spending, and what is left of the budget. */
export async function buildSummary(db: SQLiteDatabase): Promise<SummaryWidgetProps> {
  const currency = getCurrency();
  const money = (minor: number) => formatMoney(minor, currency);
  const today = todayISO();
  const month = currentMonthKey();
  const { start, end } = monthBounds(month);
  const [todaySummary, monthSummary, budgets] = await Promise.all([
    periodSummary(db, today, today),
    periodSummary(db, start, end),
    listBudgetStatus(db, 'month', month, getWeekStart()),
  ]);
  const overall = budgets.budgets.find((b) => b.category_id === null);
  const limit = overall ? overall.limit : budgets.budgets.reduce((s, b) => s + b.limit, 0);
  const spent = overall ? overall.spent : budgets.budgets.reduce((s, b) => s + b.spent, 0);
  return {
    title: 'LekhaWise',
    todayLabel: t('Spent today'),
    today: money(todaySummary.expense),
    monthLine: t('{month}: {amount} spent', { month: formatMonthLabel(month), amount: money(monthSummary.expense) }),
    budgetLine:
      limit > 0
        ? spent <= limit
          ? t('{amount} of the budget left', { amount: money(limit - spent) })
          : t('{amount} over budget', { amount: money(spent - limit) })
        : '',
  };
}

/** Refreshes the home-screen widget. Does nothing where widgets are not available. */
export async function refreshWidget(db: SQLiteDatabase): Promise<boolean> {
  const widget = loadWidget();
  if (!widget) return false;
  widget.updateSnapshot(await buildSummary(db));
  return true;
}
