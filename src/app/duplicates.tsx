import { useSQLiteContext } from 'expo-sqlite';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { AppText, Button, Card, Divider, EmptyState, Screen, useShowMore } from '@/core/ui';
import { formatDate } from '@/core/utils/date';
import { TransactionRow } from '@/features/expenses/components/TransactionRow';
import { deleteTransaction, listDuplicateGroups } from '@/features/expenses/repo';
import type { TransactionView } from '@/features/expenses/types';

/** Entries that look like the same payment recorded twice: same amount, type and account within a day. */
export default function DuplicatesScreen() {
  const db = useSQLiteContext();
  const t = useT();
  const { data: groups = [], loading } = useQuery((db) => listDuplicateGroups(db), []);
  const list = useShowMore(groups, 20);

  const keepFirst = (group: TransactionView[]) =>
    Alert.alert(
      tPlural(group.length - 1, 'Delete {count} copy?', 'Delete {count} copies?'),
      t('The oldest entry is kept. This cannot be undone.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: async () => {
            const sorted = [...group].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
            for (const tx of sorted.slice(1)) await deleteTransaction(db, tx.id);
          },
        },
      ],
    );

  return (
    <Screen>
      <AppText variant="caption" muted>
        {t(
          'These entries have the same amount, type and account within a day of each other. Some are genuine (two coffees), so check before deleting. Tap an entry to open it.',
        )}
      </AppText>
      {!loading && groups.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" title={t('No duplicates found')} />
      ) : null}
      {list.visible.map((group) => (
        <Card key={group.map((g) => g.id).join()} style={styles.card}>
          {group.map((tx, i) => (
            <View key={tx.id}>
              {i > 0 ? <Divider /> : null}
              <TransactionRow tx={tx} showDate={formatDate(tx.date)} />
            </View>
          ))}
          <Button
            title={t('Keep one, delete the rest')}
            variant="danger"
            icon="trash-outline"
            onPress={() => keepFirst(group)}
          />
        </Card>
      ))}
      {list.more}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 4, gap: 4, paddingBottom: 12 },
});
