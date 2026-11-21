import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Card, Divider, Icon, Screen, SectionTitle } from '@/core/ui';
import { currentMonthKey, formatShortMonth, lastMonths } from '@/core/utils/date';
import { SeriesChart } from '@/features/expenses/components/Charts';
import { useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { netWorthHistory, netWorthNow } from '@/features/expenses/repoWealth';

/** Everything you own minus everything you owe, now and over the last 12 months. */
export default function NetWorthScreen() {
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { compact } = useAmountFormat();
  const months = lastMonths(currentMonthKey(), 12);
  const { data } = useQuery(async (db) => ({ now: await netWorthNow(db), history: await netWorthHistory(db, months) }), [months[11]]);
  const now = data?.now;
  const first = data?.history.find((p) => p.netWorth !== 0);
  const change = now && first ? now.netWorth - first.netWorth : 0;

  return (
    <Screen>
      <Card style={styles.gap}>
        <AppText variant="caption" muted>
          {t('Net worth')}
        </AppText>
        <AppText variant="title" color={(now?.netWorth ?? 0) < 0 ? colors.expense : colors.text}>
          {money(now?.netWorth ?? 0)}
        </AppText>
        {first && change !== 0 ? (
          <AppText color={change >= 0 ? colors.income : colors.expense}>
            {t('{change} since {month}', { change: `${change >= 0 ? '+' : '−'}${money(Math.abs(change))}`, month: formatShortMonth(first.month) })}
          </AppText>
        ) : null}
      </Card>

      <SectionTitle>{t('Last 12 months')}</SectionTitle>
      <Card>
        <SeriesChart
          points={(data?.history ?? []).map((p) => ({ key: p.month, label: formatShortMonth(p.month).slice(0, 3), value: p.netWorth }))}
          format={(v) => compact(v)}
        />
      </Card>

      <SectionTitle>{t('What you own')}</SectionTitle>
      <Card style={styles.listCard}>
        <Row icon="wallet-outline" label={t('Cash and bank accounts')} value={money(now?.cash ?? 0)} href="/accounts" />
        <Divider />
        <Row icon="trending-up-outline" label={t('Investments')} value={money(now?.investments ?? 0)} href="/holdings/investment" />
        <Divider />
        <Row icon="home-outline" label={t('Assets')} value={money(now?.assets ?? 0)} href="/holdings/asset" />
        <Divider />
        <Row icon="arrow-up-circle-outline" label={t('Money lent to others')} value={money(now?.lent ?? 0)} href="/loans" />
        <Divider />
        <Row label={t('Total')} value={money(now?.totalAssets ?? 0)} bold />
      </Card>

      <SectionTitle>{t('What you owe')}</SectionTitle>
      <Card style={styles.listCard}>
        <Row icon="card-outline" label={t('Credit cards and overdrafts')} value={money(now?.cards ?? 0)} href="/accounts" />
        <Divider />
        <Row icon="arrow-down-circle-outline" label={t('Loans')} value={money(now?.borrowed ?? 0)} href="/loans" />
        <Divider />
        <Row label={t('Total')} value={money(now?.totalLiabilities ?? 0)} bold />
      </Card>
      <AppText variant="caption" muted>
        {t('History is worked out from your entries and the values you recorded, so it fills in by itself.')}
      </AppText>
    </Screen>
  );
}

function Row({
  icon,
  label,
  value,
  href,
  bold,
}: {
  icon?: Parameters<typeof Icon>[0]['name'];
  label: string;
  value: string;
  href?: Href;
  bold?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable disabled={!href} onPress={() => href && router.push(href)} style={styles.row}>
      {icon ? <Icon name={icon} color={colors.primary} /> : <View style={styles.iconSpace} />}
      <AppText style={styles.flex} variant={bold ? 'label' : 'body'}>
        {label}
      </AppText>
      <AppText variant={bold ? 'heading' : 'label'}>{value}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 4 },
  listCard: { paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  iconSpace: { width: 20 },
});
