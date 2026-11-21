import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, EmptyState, MonthSwitcher, Screen, SectionTitle } from '@/core/ui';
import {
  addDays,
  currentMonthKey,
  formatDayLabel,
  formatWeekday,
  type ISODate,
  monthBounds,
  todayISO,
  weekStartOf,
} from '@/core/utils/date';
import { useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { TransactionRow } from '@/features/expenses/components/TransactionRow';
import { dailyTotals, listTransactions } from '@/features/expenses/repo';
import { useWeekStart } from '@/features/expenses/settings';

/** Month grid with each day's spending; tap a day to see its entries or add one on that date. */
export default function CalendarScreen() {
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { compact } = useAmountFormat();
  const [weekStart] = useWeekStart();
  const [month, setMonth] = useState(currentMonthKey());
  const [selected, setSelected] = useState<ISODate>(todayISO());
  const { start, end } = monthBounds(month);
  const gridStart = weekStartOf(start, weekStart);
  const days: ISODate[] = [];
  for (let d = gridStart; d <= end || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);

  const { data } = useQuery(
    async (db) => ({
      totals: await dailyTotals(db, start, end),
      entries: await listTransactions(db, { from: selected, to: selected }),
    }),
    [start, end, selected],
  );
  const byDay = new Map((data?.totals ?? []).map((d) => [d.date, d]));
  const maxSpend = Math.max(1, ...(data?.totals ?? []).map((d) => d.expense));
  const monthSpend = (data?.totals ?? []).reduce((s, d) => s + d.expense, 0);
  const today = todayISO();

  return (
    <Screen>
      <MonthSwitcher
        month={month}
        onChange={(m) => {
          setMonth(m);
          setSelected(m === currentMonthKey() ? today : monthBounds(m).start);
        }}
      />
      <Card style={styles.card}>
        <View style={styles.week}>
          {days.slice(0, 7).map((d) => (
            <AppText key={d} variant="caption" muted style={styles.weekday}>
              {formatWeekday(d, 'narrow')}
            </AppText>
          ))}
        </View>
        <View style={styles.grid}>
          {days.map((d) => {
            const inMonth = d >= start && d <= end;
            const total = byDay.get(d);
            const intensity = total?.expense ? 0.15 + 0.6 * (total.expense / maxSpend) : 0;
            const isSelected = d === selected;
            return (
              <Pressable
                key={d}
                disabled={!inMonth}
                onPress={() => setSelected(d)}
                accessibilityRole="button"
                accessibilityLabel={`${formatDayLabel(d)}${total ? `, ${t('spent {amount}', { amount: money(total.expense) })}` : ''}`}
                accessibilityState={{ selected: isSelected }}
                style={[
                  styles.day,
                  inMonth && intensity ? { backgroundColor: `${colors.expense}${Math.round(intensity * 255).toString(16).padStart(2, '0')}` } : null,
                  isSelected ? { borderColor: colors.primary, borderWidth: 2 } : null,
                ]}
              >
                {inMonth ? (
                  <>
                    <AppText variant="label" color={d === today ? colors.primary : colors.text}>
                      {Number(d.slice(8, 10))}
                    </AppText>
                    <AppText variant="caption" muted numberOfLines={1} style={styles.dayAmount}>
                      {total?.expense ? compact(total.expense) : total?.income ? `+${compact(total.income)}` : ''}
                    </AppText>
                  </>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <AppText variant="caption" muted style={styles.centre}>
          {t('Spent this month: {amount}', { amount: money(monthSpend) })}
        </AppText>
      </Card>

      <SectionTitle>{formatDayLabel(selected)}</SectionTitle>
      <Card style={styles.listCard}>
        {data?.entries.length ? (
          data.entries.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
        ) : (
          <EmptyState icon="calendar-outline" title={t('Nothing on this day')} />
        )}
      </Card>
      <Button
        title={t('Add on this day')}
        icon="add"
        variant="secondary"
        onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: 'new', date: selected } })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, paddingHorizontal: 8 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: {
    width: `${100 / 7}%`,
    aspectRatio: 0.9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  dayAmount: { fontSize: 10 },
  centre: { textAlign: 'center' },
  listCard: { paddingVertical: 4 },
});
