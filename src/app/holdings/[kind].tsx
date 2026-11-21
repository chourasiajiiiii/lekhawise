import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, EmptyState, IconBadge, ListRow, Screen, SectionTitle } from '@/core/ui';
import { formatDate } from '@/core/utils/date';
import { useMoney } from '@/features/expenses/components/Money';
import { type HoldingView, listHoldings } from '@/features/expenses/repoWealth';
import { ASSET_TYPES, type HoldingKind, INVESTMENT_TYPES } from '@/features/expenses/types';

/** Investments (/holdings/investment) or assets (/holdings/asset): values entered by hand, no market feed. */
export default function HoldingsScreen() {
  const { kind: raw } = useLocalSearchParams<{ kind: string }>();
  const kind: HoldingKind = raw === 'asset' ? 'asset' : 'investment';
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { data: holdings = [] } = useQuery((db) => listHoldings(db, kind, true), [kind]);
  const types = kind === 'investment' ? INVESTMENT_TYPES : ASSET_TYPES;
  const active = holdings.filter((h) => !h.archived);
  const sold = holdings.filter((h) => h.archived);
  const value = active.reduce((s, h) => s + h.value, 0);
  const invested = active.reduce((s, h) => s + h.invested, 0);
  const gain = value - invested;

  return (
    <Screen>
      <Stack.Screen options={{ title: kind === 'investment' ? t('Investments') : t('Assets') }} />
      <Card style={styles.gap}>
        <AppText variant="caption" muted>
          {t('Current value')}
        </AppText>
        <AppText variant="title">{money(value)}</AppText>
        {kind === 'investment' && invested > 0 ? (
          <AppText color={gain >= 0 ? colors.income : colors.expense}>
            {t('{gain} on {invested} invested ({pct}%)', {
              gain: `${gain >= 0 ? '+' : '−'}${money(Math.abs(gain))}`,
              invested: money(invested),
              pct: Math.round((gain / invested) * 100),
            })}
          </AppText>
        ) : null}
      </Card>
      <Button
        title={kind === 'investment' ? t('Add an investment') : t('Add an asset')}
        icon="add"
        variant="secondary"
        onPress={() => router.push({ pathname: '/holding/[id]', params: { id: 'new', kind } })}
      />
      <AppText variant="caption" muted>
        {t('LekhaWise works offline, so prices are not fetched. Update the value whenever you check it.')}
      </AppText>
      {holdings.length === 0 ? (
        <EmptyState
          icon={kind === 'investment' ? 'trending-up-outline' : 'home-outline'}
          title={kind === 'investment' ? t('No investments yet') : t('No assets yet')}
        />
      ) : null}
      {types.map((type) => {
        const list = active.filter((h) => h.subtype === type.value);
        if (!list.length) return null;
        return (
          <View key={type.value}>
            <SectionTitle right={<AppText variant="caption" muted>{money(list.reduce((s, h) => s + h.value, 0))}</AppText>}>
              {t(type.label)}
            </SectionTitle>
            <Card style={styles.listCard}>
              {list.map((h, i) => (
                <HoldingRow key={h.id} holding={h} divider={i > 0} />
              ))}
            </Card>
          </View>
        );
      })}
      {sold.length ? (
        <>
          <SectionTitle>{t('Sold or disposed of')}</SectionTitle>
          <Card style={styles.listCard}>
            {sold.map((h, i) => (
              <HoldingRow key={h.id} holding={h} divider={i > 0} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function HoldingRow({ holding, divider }: { holding: HoldingView; divider: boolean }) {
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const type = [...INVESTMENT_TYPES, ...ASSET_TYPES].find((x) => x.value === holding.subtype);
  const gain = holding.value - holding.invested;
  return (
    <View>
      {divider ? <Divider /> : null}
      <ListRow
        left={<IconBadge name={type?.icon ?? 'cube-outline'} color={colors.primary} size={36} />}
        title={holding.name}
        subtitle={[
          holding.quantity,
          holding.value_date ? t('value as of {date}', { date: formatDate(holding.value_date) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        right={
          <View style={styles.right}>
            <AppText variant="label">{money(holding.value)}</AppText>
            {holding.invested > 0 && !holding.archived ? (
              <AppText variant="caption" color={gain >= 0 ? colors.income : colors.expense}>
                {gain >= 0 ? '+' : '−'}
                {money(Math.abs(gain))}
              </AppText>
            ) : null}
          </View>
        }
        chevron
        onPress={() => router.push(`/holding/${holding.id}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 4 },
  listCard: { paddingVertical: 4 },
  right: { alignItems: 'flex-end' },
});
