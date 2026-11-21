import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, ProgressBar, PromptModal, Screen, SectionTitle, SwitchRow } from '@/core/ui';
import { addDays, formatDate, formatMonthLabel, todayISO } from '@/core/utils/date';
import { budgetLevel, periodKeyOf } from '@/features/expenses/budgetMath';
import { useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { budgetHistory, deleteBudget, setBudgetAmount, setBudgetCarryForward } from '@/features/expenses/repoBudgets';
import { useWeekStart } from '@/features/expenses/settings';

/** One budget: change it, carry unspent money forward, and see how each past period went. */
export default function BudgetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { parse, toInput, keyboard } = useAmountFormat();
  const [weekStart] = useWeekStart();
  const [editing, setEditing] = useState(false);

  const { data } = useQuery(
    async (db) => {
      const head = await db.getFirstAsync<{ period: 'month' | 'week' }>('select period from budgets where id = ?', id);
      if (!head) return null;
      const current = periodKeyOf(todayISO(), head.period, weekStart);
      return { current, ...(await budgetHistory(db, id, current, 12, weekStart)) };
    },
    [id, weekStart],
  );

  if (!data?.budget) {
    return (
      <Screen>
        <AppText>{data === null ? t('This budget no longer exists.') : ''}</AppText>
      </Screen>
    );
  }
  const { budget, rows, current } = data;
  const name = budget.name ?? t('All spending');
  const label = (key: string) => (budget.period === 'month' ? formatMonthLabel(key) : `${formatDate(key)} – ${formatDate(addDays(key, 6))}`);
  const now = rows[0];

  const save = async (value: string) => {
    const amount = parse(value);
    if (amount === null || amount <= 0) {
      Alert.alert(t('Invalid amount'), t('Enter a number such as 5000 or 5000.50.'));
      return;
    }
    await setBudgetAmount(db, { categoryId: budget.category_id, period: budget.period }, current, amount);
    setEditing(false);
  };

  const remove = () =>
    Alert.alert(t('Delete this budget?'), t('Its history is deleted too. Your transactions are not affected.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteBudget(db, budget.id);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: name }} />
      {now ? (
        <Card style={styles.gap}>
          <AppText variant="caption" muted>
            {budget.period === 'month' ? t('This month') : t('This week')}
          </AppText>
          {/* The words say which side of the limit it is, so the amount is shown without a sign. */}
          <AppText variant="title" color={now.spent > now.limit ? colors.expense : undefined}>
            {money(Math.abs(now.limit - now.spent))}
          </AppText>
          <AppText variant="caption" muted>
            {now.spent <= now.limit ? t('left to spend') : t('over budget')}
          </AppText>
          <ProgressBar value={now.spent / now.limit} color={levelColor(budgetLevel(now.spent, now.limit), colors)} height={10} />
          <AppText variant="caption" muted>
            {t('{spent} of {limit}', { spent: money(now.spent), limit: money(now.limit) })}
            {now.carried ? ` · ${t('{amount} carried over', { amount: money(now.carried) })}` : ''}
          </AppText>
        </Card>
      ) : (
        <AppText muted>{t('This budget starts in a later period.')}</AppText>
      )}

      <Card style={styles.listCard}>
        <SwitchRow
          title={t('Carry unspent money forward')}
          subtitle={t('What is left at the end of a period is added to the next one')}
          value={budget.carry_forward === 1}
          onChange={(on) => setBudgetCarryForward(db, budget.id, on)}
        />
      </Card>

      <View style={styles.gap}>
        <Button title={t('Change amount')} icon="create-outline" variant="secondary" onPress={() => setEditing(true)} />
        <Button title={t('Delete budget')} icon="trash-outline" variant="danger" onPress={remove} />
      </View>

      <SectionTitle>{t('History')}</SectionTitle>
      <Card style={styles.listCard}>
        {rows.map((row, i) => {
          const level = budgetLevel(row.spent, row.limit);
          return (
            <View key={row.key}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.historyRow}>
                <View style={styles.between}>
                  <AppText variant="label">{label(row.key)}</AppText>
                  <AppText variant="label" color={levelColor(level, colors)}>
                    {Math.round((row.spent / row.limit) * 100)}%
                  </AppText>
                </View>
                <ProgressBar value={row.spent / row.limit} color={levelColor(level, colors)} height={6} />
                <AppText variant="caption" muted>
                  {t('{spent} of {limit}', { spent: money(row.spent), limit: money(row.limit) })}
                  {row.carried ? ` · ${t('{amount} carried over', { amount: money(row.carried) })}` : ''}
                </AppText>
              </View>
            </View>
          );
        })}
      </Card>

      <PromptModal
        visible={editing}
        title={t('New amount')}
        message={t('Applies from this period onwards. Earlier periods keep their amount.')}
        initialValue={now ? toInput(now.limit - now.carried) : ''}
        keyboardType={keyboard}
        onSubmit={save}
        onCancel={() => setEditing(false)}
      />
    </Screen>
  );
}

function levelColor(level: 'ok' | 'warning' | 'over', colors: ReturnType<typeof useTheme>['colors']): string {
  return level === 'over' ? colors.danger : level === 'warning' ? colors.warning : colors.income;
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  listCard: { paddingVertical: 4 },
  historyRow: { paddingVertical: 10, gap: 6 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
});
