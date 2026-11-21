import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { t } from '@/core/i18n/locale';
import { getSetting } from '@/core/settings/settings';
import { addDays, formatDate, parseISODate, todayISO } from '@/core/utils/date';
import { formatMoney } from '@/core/utils/money';

import type { BudgetAlert } from './repoBudgets';
import { BILL_REMINDERS_SETTING_KEY, BUDGET_ALERTS_SETTING_KEY, getCurrency } from './settings';
import type { RecurringRule } from './types';

/**
 * Local notifications only: they are scheduled on the phone itself, so there is no push server,
 * no account and nothing to pay for. Used for budget alerts and bill reminders.
 */

const CHANNEL_ID = 'reminders';
const REMINDER_HOUR = 9;
/** iOS keeps at most 64 scheduled notifications per app. */
const MAX_SCHEDULED = 60;

let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: t('Reminders and budget alerts'),
      // Exported through a re-export the lint plugin cannot follow.
      importance: Notifications.AndroidImportance.DEFAULT, // eslint-disable-line import/namespace
    }).catch(() => {});
  }
}

/** Asks for permission the first time it is needed. Returns whether notifications may be shown. */
export async function ensureNotificationPermission(): Promise<boolean> {
  configure();
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function notifyBudgetAlerts(alerts: BudgetAlert[]): Promise<void> {
  if (!alerts.length || !getSetting<boolean>(BUDGET_ALERTS_SETTING_KEY, true)) return;
  if (!(await ensureNotificationPermission())) return;
  const currency = getCurrency();
  for (const alert of alerts) {
    const name = alert.name ?? t('Total spending');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: alert.level === 'over' ? t('Over budget: {name}', { name }) : t('Budget almost used: {name}', { name }),
        body: t('{spent} of {limit} spent this {period}.', {
          spent: formatMoney(alert.spent, currency),
          limit: formatMoney(alert.limit, currency),
          period: alert.period === 'week' ? t('week') : t('month'),
        }),
        data: { url: '/budgets' },
      },
      trigger: null,
    });
  }
}

/**
 * Replaces all scheduled bill reminders with fresh ones for the next due date of every active rule
 * that has a reminder. Called at start-up, when the app returns to the foreground and after changes.
 */
export async function rescheduleBillReminders(db: SQLiteDatabase): Promise<number> {
  configure();
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    return 0;
  }
  if (!getSetting<boolean>(BILL_REMINDERS_SETTING_KEY, true)) return 0;
  const rules = await db.getAllAsync<RecurringRule & { category_name: string | null }>(
    `select r.*, c.name as category_name from recurring r left join categories c on c.id = r.category_id
     where r.active = 1 and r.remind_days is not null and r.next_date >= ?
     order by r.next_date limit ?`,
    todayISO(), MAX_SCHEDULED,
  );
  if (!rules.length) return 0;
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) return 0;

  const currency = getCurrency();
  const now = Date.now();
  let scheduled = 0;
  for (const rule of rules) {
    const when = parseISODate(addDays(rule.next_date, -(rule.remind_days ?? 0)));
    when.setHours(REMINDER_HOUR, 0, 0, 0);
    if (when.getTime() <= now) continue;
    const name = rule.note || rule.category_name || t('Bill');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: rule.remind_days ? t('{name} is due soon', { name }) : t('{name} is due today', { name }),
        body: t('{amount} due on {date}.', {
          amount: formatMoney(rule.amount, currency),
          date: formatDate(rule.next_date),
        }),
        data: { url: '/recurring' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: CHANNEL_ID },
    });
    scheduled += 1;
  }
  return scheduled;
}
