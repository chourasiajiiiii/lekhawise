import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Card, EmptyState, Screen, SectionTitle, useShowMore } from '@/core/ui';
import { formatDate } from '@/core/utils/date';
import { CategoryBreakdown } from '@/features/expenses/components/Charts';
import { useMoney } from '@/features/expenses/components/Money';
import { TransactionRow } from '@/features/expenses/components/TransactionRow';
import { listTransactions, subcategoryTotals } from '@/features/expenses/repo';
import type { TxType } from '@/features/expenses/types';

type Params = {
  from?: string;
  to?: string;
  categoryId?: string;
  tagId?: string;
  accountId?: string;
  type?: TxType;
  title?: string;
};

/** The transactions behind a number on a report: a category, a tag, income or expenses in a period. */
export default function ExploreScreen() {
  const params = useLocalSearchParams<Params>();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { data } = useQuery(
    async (db) => {
      const transactions = await listTransactions(db, {
        from: params.from,
        to: params.to,
        categoryId: params.categoryId,
        tagId: params.tagId,
        accountId: params.accountId,
        type: params.type,
      });
      const subcategories =
        params.categoryId && params.from && params.to
          ? await subcategoryTotals(db, params.categoryId, params.from, params.to)
          : [];
      return { transactions, subcategories };
    },
    [params.from, params.to, params.categoryId, params.tagId, params.accountId, params.type],
  );
  const transactions = data?.transactions ?? [];
  const list = useShowMore(transactions);
  // For a category, only its own amounts count (a split transaction may hold other categories too).
  const total =
    params.categoryId && data
      ? data.subcategories.reduce((s, c) => s + c.total, 0)
      : transactions.reduce(
          (s, tx) => s + (tx.type === 'expense' ? -tx.amount : tx.type === 'income' ? tx.amount : 0),
          0,
        );

  return (
    <Screen>
      <Stack.Screen options={{ title: params.title ?? t('Transactions') }} />
      <Card style={styles.gap}>
        {params.from && params.to ? (
          <AppText variant="caption" muted>
            {formatDate(params.from)} – {formatDate(params.to)}
          </AppText>
        ) : null}
        <AppText variant="title" color={total < 0 ? colors.expense : colors.text}>
          {money(Math.abs(total))}
        </AppText>
        <AppText variant="caption" muted>
          {tPlural(transactions.length, '{count} entry', '{count} entries')}
        </AppText>
      </Card>
      {data && data.subcategories.length > 1 ? (
        <>
          <SectionTitle>{t('Subcategories')}</SectionTitle>
          <Card>
            <CategoryBreakdown items={data.subcategories} />
          </Card>
        </>
      ) : null}
      <SectionTitle>{t('Entries')}</SectionTitle>
      <Card style={styles.listCard}>
        {transactions.length ? (
          <>
            {list.visible.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} showDate={formatDate(tx.date)} />
            ))}
            {list.more}
          </>
        ) : (
          <EmptyState icon="search-outline" title={t('Nothing here')} />
        )}
      </Card>
      <View />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 4 },
  listCard: { paddingVertical: 4 },
});
