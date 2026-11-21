import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import {
  AppText,
  Card,
  IconBadge,
  ListRow,
  MonthSwitcher,
  PeriodSwitcher,
  ProgressBar,
  PromptModal,
  Screen,
  SectionTitle,
  Segmented,
} from '@/core/ui';
import { addDays, currentMonthKey, formatDate, todayISO } from '@/core/utils/date';
import { budgetLevel, periodKeyOf, shiftPeriod } from '@/features/expenses/budgetMath';
import { useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { type BudgetStatus, listBudgetStatus, setBudgetAmount } from '@/features/expenses/repoBudgets';
import { useWeekStart } from '@/features/expenses/settings';
import type { BudgetPeriod } from '@/features/expenses/types';

type Editing = { categoryId: string | null; name: string };

export default function BudgetsScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { parse, keyboard } = useAmountFormat();
  const [weekStart] = useWeekStart();
  const [period, setPeriod] = useState<BudgetPeriod>('month');
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [weekKey, setWeekKey] = useState(() => periodKeyOf(todayISO(), 'week', weekStart));
  const [editing, setEditing] = useState<Editing | null>(null);
  const key = period === 'month' ? monthKey : weekKey;

  const { data } = useQuery((db) => listBudgetStatus(db, period, key, weekStart), [period, key, weekStart]);
  const budgets = data?.budgets ?? [];
  const overall = budgets.find((b) => b.category_id === null);
  const categoryBudgets = budgets.filter((b) => b.category_id !== null);
  const totalLimit = categoryBudgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = categoryBudgets.reduce((s, b) => s + b.spent, 0);

  const statusColor = (spent: number, limit: number) => {
    const level = budgetLevel(spent, limit);
    return level === 'over' ? colors.danger : level === 'warning' ? colors.warning : colors.income;
  };

  const save = async (value: string) => {
    if (!editing) return;
    const amount = parse(value);
    if (amount === null || amount <= 0) {
      Alert.alert(t('Invalid amount'), t('Enter a number such as 5000 or 5000.50.'));
      return;
    }
    await setBudgetAmount(db, { categoryId: editing.categoryId, period }, key, amount);
    setEditing(null);
  };

  const currentWeek = periodKeyOf(todayISO(), 'week', weekStart);

  return (
    <Screen>
      <Segmented
        options={[
          { value: 'month', label: t('Monthly') },
          { value: 'week', label: t('Weekly') },
        ]}
        value={period}
        onChange={setPeriod}
      />
      {period === 'month' ? (
        <MonthSwitcher month={monthKey} onChange={setMonthKey} />
      ) : (
        <PeriodSwitcher
          label={`${formatDate(weekKey)} – ${formatDate(addDays(weekKey, 6))}`}
          onPrevious={() => setWeekKey(shiftPeriod(weekKey, 'week', -1))}
          onNext={() => setWeekKey(shiftPeriod(weekKey, 'week', 1))}
          previousLabel={t('Previous week')}
          nextLabel={t('Next week')}
          resetLabel={weekKey === currentWeek ? undefined : t('Back to this week')}
          onReset={weekKey === currentWeek ? undefined : () => setWeekKey(currentWeek)}
        />
      )}
      <AppText variant="caption" muted>
        {t('A budget applies from the period it is set in. Tap one to see its history, change it or carry unspent money forward.')}
      </AppText>

      <SectionTitle>{t('All spending')}</SectionTitle>
      {overall ? (
        <BudgetCard budget={overall} name={t('All spending')} statusColor={statusColor} />
      ) : (
        <Card style={styles.listCard}>
          <ListRow
            left={<IconBadge name="wallet-outline" color={colors.primary} size={36} />}
            title={period === 'month' ? t('Set a monthly spending limit') : t('Set a weekly spending limit')}
            subtitle={t('Covers every expense, whatever the category')}
            onPress={() => setEditing({ categoryId: null, name: t('All spending') })}
            chevron
          />
        </Card>
      )}

      {categoryBudgets.length ? (
        <>
          <SectionTitle
            right={
              <AppText variant="caption" muted>
                {money(totalSpent)} / {money(totalLimit)}
              </AppText>
            }
          >
            {t('By category')}
          </SectionTitle>
          {categoryBudgets.map((b) => (
            <BudgetCard key={b.id} budget={b} name={b.name ?? ''} statusColor={statusColor} />
          ))}
        </>
      ) : null}

      <SectionTitle>{categoryBudgets.length ? t('No budget set') : t('Set a budget')}</SectionTitle>
      <Card style={styles.listCard}>
        {(data?.unbudgeted ?? []).map((row) => (
          <ListRow
            key={row.category_id}
            onPress={() => setEditing({ categoryId: row.category_id, name: row.name })}
            left={<IconBadge name={row.icon} color={row.color} size={36} />}
            title={row.name}
            subtitle={row.spent ? t('{amount} spent', { amount: money(row.spent) }) : undefined}
            right={
              <AppText variant="label" color={colors.primary}>
                {t('Set')}
              </AppText>
            }
          />
        ))}
      </Card>

      <PromptModal
        visible={editing !== null}
        title={editing ? (period === 'month' ? t('Monthly budget: {name}', { name: editing.name }) : t('Weekly budget: {name}', { name: editing.name })) : ''}
        message={t('Applies from this period onwards.')}
        placeholder="0"
        keyboardType={keyboard}
        onSubmit={save}
        onCancel={() => setEditing(null)}
      />
    </Screen>
  );
}

function BudgetCard({
  budget,
  name,
  statusColor,
}: {
  budget: BudgetStatus;
  name: string;
  statusColor: (spent: number, limit: number) => string;
}) {
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const color = statusColor(budget.spent, budget.limit);
  return (
    <Card style={styles.gap}>
      <ListRow
        onPress={() => router.push(`/budget/${budget.id}`)}
        left={<IconBadge name={budget.icon ?? 'wallet-outline'} color={budget.color ?? colors.primary} size={36} />}
        title={name}
        subtitle={budget.carried > 0 ? t('Includes {amount} carried over', { amount: money(budget.carried) }) : undefined}
        right={
          <AppText variant="label" color={color}>
            {Math.round((budget.spent / budget.limit) * 100)}%
          </AppText>
        }
      />
      <ProgressBar value={budget.spent / budget.limit} color={color} />
      {/* Amounts sit under the bar so long figures and large text wrap instead of being cut off. */}
      <View style={styles.amounts}>
        <AppText variant="caption" muted>
          {t('{spent} of {limit}', { spent: money(budget.spent), limit: money(budget.limit) })}
        </AppText>
        <AppText variant="caption" color={budget.spent > budget.limit ? colors.danger : colors.textMuted}>
          {budget.spent <= budget.limit
            ? t('{amount} left', { amount: money(budget.limit - budget.spent) })
            : t('{amount} over', { amount: money(budget.spent - budget.limit) })}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  listCard: { paddingVertical: 4 },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12 },
});
