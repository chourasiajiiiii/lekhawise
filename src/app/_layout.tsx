import { type Href, router, Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { subscribeDataChanged } from '@/core/db/events';
import { useT } from '@/core/i18n/locale';
import { AppLockGate } from '@/core/lock/AppLock';
import { AppThemeProvider } from '@/core/theme/theme';
import { todayISO } from '@/core/utils/date';
import { cleanUpOrphanPhotos } from '@/features/expenses/attachments';
import { registerTranslations } from '@/features/expenses/i18n';
import { notifyBudgetAlerts, rescheduleBillReminders } from '@/features/expenses/notifications';
import { processRecurring } from '@/features/expenses/recurring';
import { checkBudgetAlerts } from '@/features/expenses/repoBudgets';
import { DATABASE_NAME, type DatabaseKey, prepareDatabaseEncryption } from '@/features/expenses/encryption';
import { initDatabase } from '@/features/expenses/schema';
import { applyLocaleSettings, getWeekStart } from '@/features/expenses/settings';
import { refreshWidget } from '@/features/expenses/widget';

export { ErrorBoundary } from 'expo-router';

// Language and formats are known before the first screen renders.
registerTranslations();
applyLocaleSettings();

export default function RootLayout() {
  const t = useT();
  return (
    <AppThemeProvider>
      <EncryptedDatabase>
        <BackgroundTasks />
        <AppLockGate>
          <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="transaction/[id]" options={{ presentation: 'modal', title: t('Transaction') }} />
            <Stack.Screen name="explore" options={{ title: t('Transactions') }} />
            <Stack.Screen name="calendar" options={{ title: t('Calendar') }} />
            <Stack.Screen name="categories" options={{ title: t('Categories') }} />
            <Stack.Screen name="category/[id]" options={{ title: t('Category') }} />
            <Stack.Screen name="accounts" options={{ title: t('Accounts') }} />
            <Stack.Screen name="account/[id]" options={{ title: t('Account') }} />
            <Stack.Screen name="statement/[id]" options={{ title: t('Statement') }} />
            <Stack.Screen name="tags" options={{ title: t('Tags') }} />
            <Stack.Screen name="templates" options={{ title: t('Templates') }} />
            <Stack.Screen name="recurring/index" options={{ title: t('Recurring & bills') }} />
            <Stack.Screen name="recurring/[id]" options={{ title: t('Recurring') }} />
            <Stack.Screen name="budget/[id]" options={{ title: t('Budget') }} />
            <Stack.Screen name="loans/index" options={{ title: t('Loans & debts') }} />
            <Stack.Screen name="loans/new" options={{ presentation: 'modal', title: t('New loan or debt') }} />
            <Stack.Screen name="loans/[id]" options={{ title: t('Loan') }} />
            <Stack.Screen name="loans/pay" options={{ presentation: 'modal', title: t('Record payment') }} />
            <Stack.Screen name="goals/index" options={{ title: t('Savings goals') }} />
            <Stack.Screen name="goals/[id]" options={{ title: t('Goal') }} />
            <Stack.Screen name="holdings/[kind]" options={{ title: t('Investments') }} />
            <Stack.Screen name="holding/[id]" options={{ title: t('Holding') }} />
            <Stack.Screen name="networth" options={{ title: t('Net worth') }} />
            <Stack.Screen name="import" options={{ title: t('Import from CSV') }} />
            <Stack.Screen name="duplicates" options={{ title: t('Find duplicates') }} />
            <Stack.Screen name="currency" options={{ title: t('Currency') }} />
            <Stack.Screen name="language" options={{ title: t('Language') }} />
            <Stack.Screen name="formats" options={{ title: t('Formats') }} />
            <Stack.Screen name="home-layout" options={{ title: t('Home screen') }} />
            <Stack.Screen name="notifications" options={{ title: t('Reminders & alerts') }} />
            <Stack.Screen name="security" options={{ title: t('App lock') }} />
            <Stack.Screen name="backup" options={{ title: t('Backup & export') }} />
          </Stack>
        </AppLockGate>
      </EncryptedDatabase>
    </AppThemeProvider>
  );
}

/**
 * Prepares the database key (and converts an unencrypted database once), then opens the database.
 * In Expo Go there is no encryption and the key is null.
 */
function EncryptedDatabase({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<DatabaseKey | undefined>(undefined);
  useEffect(() => {
    prepareDatabaseEncryption().then(setKey, (error) => {
      console.error(error);
      setKey(null);
    });
  }, []);
  const onInit = useCallback((db: Parameters<typeof initDatabase>[0]) => initDatabase(db, key ?? null), [key]);
  if (key === undefined) return null;
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={onInit}>
      {children}
    </SQLiteProvider>
  );
}

/**
 * Work that would need a server in other apps, done on the phone instead:
 * recurring entries that fell due while the app was closed, budget alerts for them,
 * bill reminders scheduled as local notifications, the home-screen widget, and removing photos of deleted entries.
 */
function BackgroundTasks() {
  const db = useSQLiteContext();

  useEffect(() => {
    let cancelled = false;
    // Once this tree is unmounted (Android recreates the screen when the text size changes, for example), its
    // database connection is closed on purpose and the new tree redoes the work: errors from then on are expected.
    const report = (error: unknown) => {
      if (!cancelled) console.error(error);
    };
    const catchUp = async () => {
      const created = await processRecurring(db, todayISO());
      if (created > 0 && !cancelled) await notifyBudgetAlerts(await checkBudgetAlerts(db, getWeekStart()));
      if (!cancelled) await rescheduleBillReminders(db);
      if (!cancelled) await refreshWidget(db);
    };
    catchUp().catch(report);
    cleanUpOrphanPhotos(db).catch(report);

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp().catch(report);
    });

    // Reminders follow edits to bills (debounced: a restore or import changes a lot at once).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeDataChanged(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        rescheduleBillReminders(db).catch(report);
        refreshWidget(db).catch(report);
      }, 1500);
    });

    // Tapping a reminder opens the screen it is about.
    const openFrom = (response: Notifications.NotificationResponse | null) => {
      const url = response?.notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as Href);
    };
    openFrom(Notifications.getLastNotificationResponse());
    const tap = Notifications.addNotificationResponseReceivedListener(openFrom);

    return () => {
      cancelled = true;
      appState.remove();
      unsubscribe();
      tap.remove();
      if (timer) clearTimeout(timer);
    };
  }, [db]);

  return null;
}
