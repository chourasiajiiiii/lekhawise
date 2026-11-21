import Constants from 'expo-constants';
import { type Href, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useLocale, useT } from '@/core/i18n/locale';
import { useLockMethod } from '@/core/lock/AppLock';
import { useSetting } from '@/core/settings/settings';
import { THEME_SETTING_KEY, type ThemePreference, useTheme } from '@/core/theme/theme';
import { AppText, Card, Divider, Icon, type IconName, ListRow, Screen, SectionTitle, Segmented } from '@/core/ui';
import { formatDate, toISODate } from '@/core/utils/date';
import { CURRENCIES } from '@/features/expenses/currencies';
import { LANGUAGES, useCurrency, useLastBackupAt } from '@/features/expenses/settings';

type Row = { icon: IconName; title: string; subtitle?: string; href: Href };

export default function MoreScreen() {
  const t = useT();
  const { language } = useLocale();
  const [currency] = useCurrency();
  const [theme, setTheme] = useSetting<ThemePreference>(THEME_SETTING_KEY, 'system');
  const lockMethod = useLockMethod();
  const lastBackupAt = useLastBackupAt();
  const currencyName = CURRENCIES.find((c) => c.code === currency)?.name;

  const wealth: Row[] = [
    { icon: 'stats-chart-outline', title: t('Net worth'), href: '/networth' },
    { icon: 'swap-vertical-outline', title: t('Loans & debts'), subtitle: t('EMIs, money borrowed and lent'), href: '/loans' },
    { icon: 'flag-outline', title: t('Savings goals'), href: '/goals' },
    { icon: 'trending-up-outline', title: t('Investments'), subtitle: t('Stocks, mutual funds, gold, deposits'), href: '/holdings/investment' },
    { icon: 'home-outline', title: t('Assets'), subtitle: t('Property, vehicles and more'), href: '/holdings/asset' },
  ];
  const manage: Row[] = [
    { icon: 'wallet-outline', title: t('Accounts'), subtitle: t('Balances, reconcile, statements'), href: '/accounts' },
    { icon: 'pricetags-outline', title: t('Categories'), href: '/categories' },
    { icon: 'pricetag-outline', title: t('Tags'), href: '/tags' },
    { icon: 'flash-outline', title: t('Templates'), href: '/templates' },
    { icon: 'repeat-outline', title: t('Recurring & bills'), href: '/recurring' },
    { icon: 'calendar-outline', title: t('Calendar'), href: '/calendar' },
  ];
  const data: Row[] = [
    {
      icon: 'cloud-upload-outline',
      title: t('Backup, restore & export'),
      subtitle: lastBackupAt
        ? t('Last backup file {date}', { date: formatDate(toISODate(new Date(lastBackupAt))) })
        : t('Never backed up'),
      href: '/backup',
    },
    { icon: 'document-attach-outline', title: t('Import from CSV'), subtitle: t('Bank statements and spreadsheets'), href: '/import' },
    { icon: 'copy-outline', title: t('Find duplicates'), href: '/duplicates' },
  ];
  const preferences: Row[] = [
    { icon: 'cash-outline', title: t('Currency'), subtitle: currencyName ? `${currency} · ${t(currencyName)}` : currency, href: '/currency' },
    { icon: 'language-outline', title: t('Language'), subtitle: LANGUAGES.find((l) => l.code === language)?.native ?? 'English', href: '/language' },
    { icon: 'calendar-number-outline', title: t('Formats'), subtitle: t('Dates, numbers, week and financial year'), href: '/formats' },
    { icon: 'apps-outline', title: t('Home screen'), subtitle: t('Choose and order the cards'), href: '/home-layout' },
    { icon: 'notifications-outline', title: t('Reminders & alerts'), href: '/notifications' },
  ];

  return (
    <Screen>
      <Group title={t('Wealth')} rows={wealth} />
      <Group title={t('Manage')} rows={manage} />
      <Group title={t('Your data')} rows={data} />
      <Group title={t('Preferences')} rows={preferences} />
      <Card style={styles.themeCard}>
        <AppText>{t('Theme')}</AppText>
        <Segmented
          options={[
            { value: 'system', label: t('System') },
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
          ]}
          value={theme}
          onChange={setTheme}
        />
      </Card>
      <Group
        title={t('Security')}
        rows={[
          {
            icon: 'lock-closed-outline',
            title: t('App lock'),
            subtitle: lockMethod === 'pin' ? t('On · app PIN') : lockMethod === 'device' ? t('On · phone lock') : t('Off'),
            href: '/security',
          },
        ]}
      />

      <SectionTitle>{t('About')}</SectionTitle>
      <Card style={styles.about}>
        <AppText variant="label">LekhaWise {Constants.expoConfig?.version}</AppText>
        <AppText variant="caption" muted>
          {t(
            'Everything stays on this phone. No account, no internet connection, no ads and no tracking. Back up regularly: if the phone is lost or the app is uninstalled, a backup file is the only copy.',
          )}
        </AppText>
      </Card>
    </Screen>
  );
}

function Group({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card style={styles.listCard}>
        {rows.map((row, i) => (
          <View key={String(row.href)}>
            {i > 0 ? <Divider /> : null}
            <ListRow left={<RowIcon name={row.icon} />} title={row.title} subtitle={row.subtitle} chevron onPress={() => router.push(row.href)} />
          </View>
        ))}
      </Card>
    </>
  );
}

function RowIcon({ name }: { name: IconName }) {
  const { colors } = useTheme();
  return <Icon name={name} color={colors.primary} size={22} />;
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: 4 },
  themeCard: { gap: 10 },
  about: { gap: 6 },
});
