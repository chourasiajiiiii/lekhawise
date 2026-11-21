import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Linking, StyleSheet } from 'react-native';

import { useT } from '@/core/i18n/locale';
import { useSetting } from '@/core/settings/settings';
import { AppText, Card, Divider, Screen, SwitchRow } from '@/core/ui';
import { ensureNotificationPermission, rescheduleBillReminders } from '@/features/expenses/notifications';
import { BILL_REMINDERS_SETTING_KEY, BUDGET_ALERTS_SETTING_KEY } from '@/features/expenses/settings';

export default function NotificationsScreen() {
  const db = useSQLiteContext();
  const t = useT();
  const [budgetAlerts, setBudgetAlerts] = useSetting<boolean>(BUDGET_ALERTS_SETTING_KEY, true);
  const [billReminders, setBillReminders] = useSetting<boolean>(BILL_REMINDERS_SETTING_KEY, true);

  const needPermission = async (): Promise<boolean> => {
    if (await ensureNotificationPermission()) return true;
    Alert.alert(t('Notifications are off'), t('Allow notifications for LekhaWise in the phone settings.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Open settings'), onPress: () => Linking.openSettings() },
    ]);
    return false;
  };

  return (
    <Screen>
      <Card style={styles.listCard}>
        <SwitchRow
          title={t('Budget alerts')}
          subtitle={t('When a budget reaches 80% and when it is exceeded')}
          value={budgetAlerts}
          onChange={async (on) => {
            if (on && !(await needPermission())) return;
            setBudgetAlerts(on);
          }}
        />
        <Divider />
        <SwitchRow
          title={t('Bill reminders')}
          subtitle={t('Before bills and recurring payments that have a reminder')}
          value={billReminders}
          onChange={async (on) => {
            if (on && !(await needPermission())) return;
            setBillReminders(on);
            await rescheduleBillReminders(db);
          }}
        />
      </Card>
      <AppText variant="caption" muted>
        {t('Reminders are scheduled on this phone at 9 am. They work without internet and nothing is sent anywhere. Choose when to be reminded on each bill.')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: 4 },
});
