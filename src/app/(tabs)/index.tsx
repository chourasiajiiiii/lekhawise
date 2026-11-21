import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Card, EmptyState, Fab, Icon, type IconName, MonthSwitcher, ProgressBar, Screen, SectionTitle } from '@/core/ui';
import { addDays, currentMonthKey, daysBetween, formatDate, lastMonths, monthBounds, shiftMonth, todayISO } from '@/core/utils/date';
import { budgetLevel } from '@/features/expenses/budgetMath';
import { CategoryBreakdown, MonthlyTrend } from '@/features/expenses/components/Charts';
import { Amount, useMoney } from '@/features/expenses/components/Money';
import { TransactionRow } from '@/features/expenses/components/TransactionRow';
import { buildInsights, savingsRate } from '@/features/expenses/insights';
import {
  categoryTotals,
  listAccounts,
  listTransactions,
  listUpcomingBills,
  monthlyTotals,
  periodSummary,
} from '@/features/expenses/repo';
import { listBudgetStatus } from '@/features/expenses/repoBudgets';
import { listGoals, netWorthNow } from '@/features/expenses/repoWealth';
import { type HomeCardId, useHomeCards, useLastBackupAt, useWeekStart } from '@/features/expenses/settings';

const BACKUP_REMINDER_DAYS = 14;

export default function HomeScreen() {
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const [cards] = useHomeCards();
  const [weekStart] = useWeekStart();
  const [month, setMonth] = useState(currentMonthKey());
  const { start, end } = monthBounds(month);
  const visible = new Set(cards.filter((c) => c.visible).map((c) => c.id));

  const { data } = useQuery(
    async (db) => {
      const today = todayISO();
      const isCurrent = month === currentMonthKey();
      // For a fair comparison, last month is cut at the same day of the month.
      const elapsed = isCurrent ? Number(today.slice(8, 10)) : Number(end.slice(8, 10));
      const prev = monthBounds(shiftMonth(month, -1));
      const prevCut = addDays(prev.start, Math.min(elapsed, Number(prev.end.slice(8, 10))) - 1);
      const [summary, categories, prevSummary, prevCategories, trend, recent, accounts, budgets, bills, goals, worth] =
        await Promise.all([
          periodSummary(db, start, end),
          categoryTotals(db, start, end, 'expense'),
          periodSummary(db, prev.start, prevCut),
          categoryTotals(db, prev.start, prevCut, 'expense'),
          monthlyTotals(db, lastMonths(month, 6)),
          listTransactions(db, { from: start, to: end, limit: 5 }),
          listAccounts(db),
          listBudgetStatus(db, 'month', month, weekStart),
          listUpcomingBills(db, addDays(today, 7)),
          visible.has('goals') ? listGoals(db) : Promise.resolve([]),
          visible.has('networth') ? netWorthNow(db) : Promise.resolve(null),
        ]);
      return { summary, categories, prevSummary, prevCategories, trend, recent, accounts, budgets, bills, goals, worth, elapsed, isCurrent };
    },
    [month, weekStart, visible.has('goals'), visible.has('networth')],
  );

  const total = data?.accounts.reduce((sum, a) => sum + a.balance, 0) ?? 0;
  const income = data?.summary.income ?? 0;
  const expense = data?.summary.expense ?? 0;
  const savings = income - expense;
  const rate = savingsRate(income, expense);
  const budgets = data?.budgets.budgets ?? [];
  const overall = budgets.find((b) => b.category_id === null);
  const budgetLimit = overall ? overall.limit : budgets.reduce((s, b) => s + b.limit, 0);
  const budgetSpent = overall ? overall.spent : budgets.reduce((s, b) => s + b.spent, 0);
  const daysInMonth = Number(end.slice(8, 10));

  const insights = data
    ? buildInsights(
        {
          income,
          expense,
          lastMonthToDateExpense: data.prevSummary.expense,
          categories: data.categories,
          lastMonthToDateCategories: data.prevCategories,
          budgets: budgets.map((b) => ({ name: b.name, spent: b.spent, limit: b.limit })),
          daysElapsed: data.elapsed,
          daysInMonth,
          isCurrentMonth: data.isCurrent,
        },
        money,
      )
    : [];

  const explore = (params: Record<string, string>) => router.push({ pathname: '/explore', params });

  const sections: Record<HomeCardId, ReactNode> = {
    balance: (
      <Pressable onPress={() => router.push('/accounts')}>
        <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
          <AppText variant="caption" color={colors.primaryText} style={styles.dim}>
            {t('Total balance')}
          </AppText>
          <AppText variant="title" color={colors.primaryText}>
            {money(total)}
          </AppText>
          <AppText variant="caption" color={colors.primaryText} style={styles.dim}>
            {tPlural(data?.accounts.length ?? 0, 'across {count} account', 'across {count} accounts')}
          </AppText>
        </Card>
      </Pressable>
    ),
    month: (
      <View style={styles.gap}>
        <MonthSwitcher month={month} onChange={setMonth} />
        <View style={styles.statRow}>
          <Stat label={t('Income')} value={money(income)} color={colors.income} icon="arrow-down-circle-outline" onPress={() => explore({ from: start, to: end, type: 'income', title: t('Income') })} />
          <Stat label={t('Expenses')} value={money(expense)} color={colors.expense} icon="arrow-up-circle-outline" onPress={() => explore({ from: start, to: end, type: 'expense', title: t('Expenses') })} />
        </View>
        <Card style={styles.savings}>
          <View style={styles.flex}>
            <AppText variant="caption" muted>
              {t('Saved this month')}
            </AppText>
            <AppText variant="heading" color={savings >= 0 ? colors.income : colors.expense}>
              {money(savings)}
            </AppText>
          </View>
          {rate !== null ? (
            <View style={styles.rate}>
              <AppText variant="heading">{rate}%</AppText>
              <AppText variant="caption" muted>
                {t('savings rate')}
              </AppText>
            </View>
          ) : null}
        </Card>
      </View>
    ),
    insights: insights.length ? (
      <>
        <SectionTitle>{t('Insights')}</SectionTitle>
        <Card style={styles.gap}>
          {insights.map((insight) => (
            <View key={insight.text} style={styles.insight}>
              <Icon
                name={insight.icon}
                size={20}
                color={insight.tone === 'good' ? colors.income : insight.tone === 'warning' ? colors.warning : colors.primary}
              />
              <AppText style={styles.flex}>{insight.text}</AppText>
            </View>
          ))}
        </Card>
      </>
    ) : null,
    bills: data?.bills.length ? (
      <>
        <SectionTitle
          right={
            <Pressable onPress={() => router.push('/recurring')} hitSlop={8}>
              <AppText variant="label" color={colors.primary}>
                {t('See all')}
              </AppText>
            </Pressable>
          }
        >
          {t('Upcoming bills')}
        </SectionTitle>
        <Card style={styles.listCard}>
          {data.bills.map((bill) => {
            const days = daysBetween(todayISO(), bill.next_date);
            return (
              <Pressable key={bill.id} onPress={() => router.push(`/recurring/${bill.id}`)} style={styles.billRow}>
                <Icon name={days < 0 ? 'alert-circle' : 'calendar-outline'} color={days < 0 ? colors.danger : colors.warning} />
                <View style={styles.flex}>
                  <AppText numberOfLines={1}>{bill.note || bill.category_name || t('Bill')}</AppText>
                  <AppText variant="caption" color={days < 0 ? colors.danger : colors.textMuted}>
                    {days < 0
                      ? tPlural(-days, 'Overdue by {count} day', 'Overdue by {count} days')
                      : days === 0
                        ? t('Due today')
                        : t('Due {date}', { date: formatDate(bill.next_date) })}
                  </AppText>
                </View>
                <Amount amount={bill.amount} type={bill.type} />
              </Pressable>
            );
          })}
        </Card>
      </>
    ) : null,
    budget:
      budgetLimit > 0 ? (
        <Pressable onPress={() => router.navigate('/budgets')}>
          <Card style={styles.gap}>
            <AppText variant="label">{overall ? t('Monthly spending limit') : t('Budget')}</AppText>
            <ProgressBar
              value={budgetSpent / budgetLimit}
              color={{ over: colors.danger, warning: colors.warning, ok: colors.income }[budgetLevel(budgetSpent, budgetLimit)]}
            />
            <AppText variant="caption" muted>
              {t('{spent} of {limit}', { spent: money(budgetSpent), limit: money(budgetLimit) })}
            </AppText>
          </Card>
        </Pressable>
      ) : null,
    breakdown: (
      <>
        <SectionTitle>{t('Where the money went')}</SectionTitle>
        <Card>
          {data?.categories.length ? (
            <CategoryBreakdown
              items={data.categories}
              onPress={(c) => explore({ from: start, to: end, categoryId: c.id, type: 'expense', title: c.name })}
            />
          ) : (
            <AppText muted>{t('No expenses this month.')}</AppText>
          )}
        </Card>
      </>
    ),
    trend: (
      <>
        <SectionTitle>{t('Last 6 months')}</SectionTitle>
        <Card>{data ? <MonthlyTrend months={data.trend} onPress={setMonth} /> : null}</Card>
      </>
    ),
    goals: data?.goals.length ? (
      <>
        <SectionTitle
          right={
            <Pressable onPress={() => router.push('/goals')} hitSlop={8}>
              <AppText variant="label" color={colors.primary}>
                {t('See all')}
              </AppText>
            </Pressable>
          }
        >
          {t('Savings goals')}
        </SectionTitle>
        <Card style={styles.gap}>
          {data.goals.slice(0, 3).map((g) => (
            <Pressable key={g.id} onPress={() => router.push(`/goals/${g.id}`)} style={styles.gapSmall}>
              <View style={styles.between}>
                <AppText numberOfLines={1} style={styles.flex}>
                  {g.name}
                </AppText>
                <AppText variant="caption" muted>
                  {Math.min(100, Math.round((g.saved / g.target) * 100))}%
                </AppText>
              </View>
              <ProgressBar value={g.saved / g.target} color={g.color} height={6} />
            </Pressable>
          ))}
        </Card>
      </>
    ) : null,
    networth: data?.worth ? (
      <Pressable onPress={() => router.push('/networth')}>
        <Card style={styles.gapSmall}>
          <AppText variant="caption" muted>
            {t('Net worth')}
          </AppText>
          <AppText variant="heading" color={data.worth.netWorth < 0 ? colors.expense : colors.text}>
            {money(data.worth.netWorth)}
          </AppText>
          <AppText variant="caption" muted>
            {t('{assets} owned, {liabilities} owed', { assets: money(data.worth.totalAssets), liabilities: money(data.worth.totalLiabilities) })}
          </AppText>
        </Card>
      </Pressable>
    ) : null,
    recent: (
      <>
        <SectionTitle
          right={
            <Pressable onPress={() => router.navigate('/transactions')} hitSlop={8}>
              <AppText variant="label" color={colors.primary}>
                {t('See all')}
              </AppText>
            </Pressable>
          }
        >
          {t('Recent')}
        </SectionTitle>
        <Card style={styles.listCard}>
          {data?.recent.length ? (
            data.recent.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
          ) : (
            <EmptyState icon="receipt-outline" title={t('No transactions yet')} message={t('Tap + to add your first one.')} />
          )}
        </Card>
      </>
    ),
    accounts: data?.accounts.length ? (
      <>
        <SectionTitle>{t('Accounts')}</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accounts}>
          {data.accounts.map((a) => (
            <Pressable key={a.id} onPress={() => router.push(`/account/${a.id}`)}>
              <Card style={styles.accountCard}>
                <Icon name={a.icon} color={a.color} />
                <AppText variant="caption" muted numberOfLines={1}>
                  {a.name}
                </AppText>
                <AppText variant="label" color={a.balance < 0 ? colors.expense : colors.text} numberOfLines={1}>
                  {money(a.balance)}
                </AppText>
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      </>
    ) : null,
  };

  return (
    <Screen overlay={<Fab label={t('Add transaction')} onPress={() => router.push('/transaction/new')} />}>
      <BackupReminder hasData={data?.trend.some((m) => m.income || m.expense) ?? false} />
      {cards.filter((c) => c.visible).map((c) => (
        <View key={c.id} style={styles.gap}>
          {sections[c.id]}
        </View>
      ))}
      <Pressable onPress={() => router.push('/home-layout')} style={styles.customise} accessibilityRole="button">
        <Icon name="options-outline" size={16} color={colors.primary} />
        <AppText variant="caption" color={colors.primary}>
          {t('Customise home screen')}
        </AppText>
      </Pressable>
    </Screen>
  );
}

function Stat({ label, value, color, icon, onPress }: { label: string; value: string; color: string; icon: IconName; onPress: () => void }) {
  return (
    <Pressable style={styles.flex} onPress={onPress} accessibilityRole="button">
      <Card style={styles.gapSmall}>
        <View style={styles.statLabel}>
          <Icon name={icon} color={color} size={18} />
          <AppText variant="caption" muted>
            {label}
          </AppText>
        </View>
        <AppText variant="heading" color={color} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </AppText>
      </Card>
    </Pressable>
  );
}

function BackupReminder({ hasData }: { hasData: boolean }) {
  const { colors } = useTheme();
  const t = useT();
  const lastBackupAt = useLastBackupAt();
  const [now] = useState(Date.now); // read the clock once per mount, not on every render
  if (!hasData) return null;
  const days = lastBackupAt ? (now - new Date(lastBackupAt).getTime()) / 86_400_000 : Infinity;
  if (days < BACKUP_REMINDER_DAYS) return null;

  return (
    <Pressable onPress={() => router.push('/backup')}>
      <Card style={[styles.reminder, { backgroundColor: `${colors.warning}1A`, borderColor: colors.warning }]}>
        <Icon name="cloud-upload-outline" color={colors.warning} />
        <View style={styles.flex}>
          <AppText variant="label">{lastBackupAt ? t('Time for a backup') : t('Back up your data')}</AppText>
          <AppText variant="caption" muted>
            {t('Your data lives only on this phone. Save a backup file somewhere safe.')}
          </AppText>
        </View>
        <Icon name="chevron-forward" color={colors.textMuted} size={18} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.85 },
  statRow: { flexDirection: 'row', gap: 12 },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  savings: { flexDirection: 'row', alignItems: 'center' },
  rate: { alignItems: 'flex-end' },
  gap: { gap: 10 },
  gapSmall: { gap: 6 },
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  listCard: { paddingVertical: 4 },
  accounts: { gap: 10, paddingRight: 16 },
  accountCard: { width: 140, gap: 4 },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  insight: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  customise: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
});
