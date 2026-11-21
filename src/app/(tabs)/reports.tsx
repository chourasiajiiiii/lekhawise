import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, MonthSwitcher, PeriodSwitcher, Screen, SectionTitle, Segmented } from '@/core/ui';
import {
  currentMonthKey,
  financialYearBounds,
  financialYearMonths,
  financialYearOf,
  formatFinancialYear,
  formatMonthLabel,
  formatShortMonth,
  lastMonths,
  monthBounds,
  shiftMonth,
  todayISO,
} from '@/core/utils/date';
import { CategoryBreakdown, MonthlyTrend, SeriesChart } from '@/features/expenses/components/Charts';
import { useMoney } from '@/features/expenses/components/Money';
import { exportPdfReport } from '@/features/expenses/exports';
import { comparablePeriod, compareCategories, percentChange, savingsRate, trendStats } from '@/features/expenses/insights';
import { categoryTotals, monthlyTotals, periodSummary, tagTotals } from '@/features/expenses/repo';
import { useFyStartMonth } from '@/features/expenses/settings';

type Mode = 'month' | 'year';
type CompareWith = 'previous' | 'lastYear';

export default function ReportsScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const [fyStart] = useFyStartMonth();
  const [mode, setMode] = useState<Mode>('month');
  const [month, setMonth] = useState(currentMonthKey());
  const [year, setYear] = useState(() => financialYearOf(todayISO(), fyStart));
  const [compareWith, setCompareWith] = useState<CompareWith>('previous');
  const [exporting, setExporting] = useState(false);

  const period = mode === 'month' ? monthBounds(month) : financialYearBounds(year, fyStart);
  const previous = comparablePeriod(
    period,
    mode === 'month'
      ? monthBounds(compareWith === 'previous' ? shiftMonth(month, -1) : shiftMonth(month, -12))
      : financialYearBounds(year - 1, fyStart),
    todayISO(),
  );
  const trendMonths = mode === 'month' ? lastMonths(month, 12) : financialYearMonths(year, fyStart);
  const title = mode === 'month' ? formatMonthLabel(month) : t('Financial year {year}', { year: formatFinancialYear(year, fyStart) });

  const { data } = useQuery(
    async (db) => {
      const [summary, prevSummary, expenses, prevExpenses, incomes, trend, tags] = await Promise.all([
        periodSummary(db, period.start, period.end),
        periodSummary(db, previous.start, previous.end),
        categoryTotals(db, period.start, period.end, 'expense'),
        categoryTotals(db, previous.start, previous.end, 'expense'),
        categoryTotals(db, period.start, period.end, 'income'),
        monthlyTotals(db, trendMonths),
        tagTotals(db, period.start, period.end),
      ]);
      return { summary, prevSummary, expenses, prevExpenses, incomes, trend, tags };
    },
    [period.start, period.end, previous.start, previous.end, trendMonths.join()],
  );

  const income = data?.summary.income ?? 0;
  const expense = data?.summary.expense ?? 0;
  const rate = savingsRate(income, expense);
  const comparison = data ? compareCategories(data.expenses, data.prevExpenses).slice(0, 8) : [];
  const spendStats = trendStats((data?.trend ?? []).map((m) => ({ key: m.month, value: m.expense })));
  const incomeStats = trendStats((data?.trend ?? []).map((m) => ({ key: m.month, value: m.income })));
  const explore = (params: Record<string, string>) => router.push({ pathname: '/explore', params });
  const previousLabel = mode === 'year' ? t('last year') : compareWith === 'previous' ? t('last month') : t('the same month last year');

  const exportPdf = async (destination: 'share' | 'phone') => {
    setExporting(true);
    try {
      const done = await exportPdfReport(db, { from: period.start, to: period.end, title }, destination);
      if (done && destination === 'phone') Alert.alert(t('Saved'), t('The file was saved in the folder you chose.'));
    } catch (e) {
      console.error(e);
      Alert.alert(t('Could not complete'), t('Something went wrong. Your data was not changed.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen>
      <Segmented
        options={[
          { value: 'month', label: t('Month') },
          { value: 'year', label: t('Financial year') },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'month' ? (
        <MonthSwitcher month={month} onChange={setMonth} />
      ) : (
        <PeriodSwitcher
          label={t('FY {year}', { year: formatFinancialYear(year, fyStart) })}
          onPrevious={() => setYear(year - 1)}
          onNext={() => setYear(year + 1)}
          previousLabel={t('Previous year')}
          nextLabel={t('Next year')}
          resetLabel={year === financialYearOf(todayISO(), fyStart) ? undefined : t('Back to this year')}
          onReset={() => setYear(financialYearOf(todayISO(), fyStart))}
        />
      )}
      {mode === 'year' ? (
        <Pressable onPress={() => router.push('/formats')}>
          <AppText variant="caption" muted>
            {t('{start} to {end}. Change the first month of the financial year in More, Formats.', {
              start: formatShortMonth(trendMonths[0]),
              end: formatShortMonth(trendMonths[11]),
            })}
          </AppText>
        </Pressable>
      ) : null}

      <View style={styles.statRow}>
        <Figure label={t('Income')} value={money(income)} change={percentChange(income, data?.prevSummary.income ?? 0)} color={colors.income} goodWhenUp onPress={() => explore({ from: period.start, to: period.end, type: 'income', title: t('Income') })} />
        <Figure label={t('Expenses')} value={money(expense)} change={percentChange(expense, data?.prevSummary.expense ?? 0)} color={colors.expense} onPress={() => explore({ from: period.start, to: period.end, type: 'expense', title: t('Expenses') })} />
      </View>
      <View style={styles.statRow}>
        <Figure label={t('Amount saved')} value={money(income - expense)} color={income - expense >= 0 ? colors.income : colors.expense} />
        <Figure label={t('Savings rate')} value={rate === null ? '–' : `${rate}%`} color={colors.text} />
      </View>
      <AppText variant="caption" muted>
        {previous.partial
          ? t('Percentages compare with the same days of {previous}.', { previous: previousLabel })
          : t('Percentages compare with {previous}.', { previous: previousLabel })}
      </AppText>

      <SectionTitle>{mode === 'month' ? t('Last 12 months') : t('Month by month')}</SectionTitle>
      <Card style={styles.gap}>
        {data ? (
          <MonthlyTrend
            months={data.trend}
            onPress={(m) => {
              setMode('month');
              setMonth(m);
            }}
          />
        ) : null}
        <Divider />
        <Stat label={t('Average monthly spending')} value={money(spendStats.average)} />
        {spendStats.highest ? <Stat label={t('Highest spending')} value={`${money(spendStats.highest.value)} · ${formatShortMonth(spendStats.highest.key)}`} /> : null}
        {spendStats.lowest ? <Stat label={t('Lowest spending')} value={`${money(spendStats.lowest.value)} · ${formatShortMonth(spendStats.lowest.key)}`} /> : null}
        <Stat label={t('Average monthly income')} value={money(incomeStats.average)} />
      </Card>

      <SectionTitle>{t('Savings rate by month')}</SectionTitle>
      <Card>
        <SeriesChart
          points={(data?.trend ?? []).map((m) => ({
            key: m.month,
            label: formatShortMonth(m.month),
            value: savingsRate(m.income, m.expense) ?? 0,
          }))}
          format={(v) => `${v}%`}
          color={colors.income}
        />
      </Card>

      <SectionTitle>{t('Expenses by category')}</SectionTitle>
      <Card>
        {data?.expenses.length ? (
          <CategoryBreakdown
            items={data.expenses}
            limit={20}
            onPress={(c) => explore({ from: period.start, to: period.end, categoryId: c.id, type: 'expense', title: c.name })}
          />
        ) : (
          <AppText muted>{t('Nothing in this period.')}</AppText>
        )}
      </Card>

      {mode === 'month' ? (
        <Segmented
          options={[
            { value: 'previous', label: t('vs last month') },
            { value: 'lastYear', label: t('vs a year ago') },
          ]}
          value={compareWith}
          onChange={setCompareWith}
        />
      ) : null}
      <SectionTitle>{t('Biggest changes in spending')}</SectionTitle>
      <Card style={styles.listCard}>
        {comparison.length ? (
          comparison.map((row, i) => (
            <View key={row.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.compareRow}>
                <View style={styles.flex}>
                  <AppText numberOfLines={1}>{row.name}</AppText>
                  <AppText variant="caption" muted>
                    {t('{current} now, {previous} before', { current: money(row.current), previous: money(row.previous) })}
                  </AppText>
                </View>
                <AppText variant="label" color={row.change > 0 ? colors.expense : colors.income}>
                  {row.change > 0 ? '+' : '−'}
                  {money(Math.abs(row.change))}
                  {row.percent !== null ? ` (${row.percent > 0 ? '+' : ''}${row.percent}%)` : ''}
                </AppText>
              </View>
            </View>
          ))
        ) : (
          <AppText muted style={styles.pad}>
            {t('Nothing to compare yet.')}
          </AppText>
        )}
      </Card>

      <SectionTitle>{t('Income by category')}</SectionTitle>
      <Card>
        {data?.incomes.length ? (
          <CategoryBreakdown
            items={data.incomes}
            onPress={(c) => explore({ from: period.start, to: period.end, categoryId: c.id, type: 'income', title: c.name })}
          />
        ) : (
          <AppText muted>{t('Nothing in this period.')}</AppText>
        )}
      </Card>

      {data?.tags.length ? (
        <>
          <SectionTitle>{t('By tag')}</SectionTitle>
          <Card style={styles.listCard}>
            {data.tags.map((tag, i) => (
              <View key={tag.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  style={styles.compareRow}
                  onPress={() => explore({ from: period.start, to: period.end, tagId: tag.id, title: `#${tag.name}` })}
                >
                  <View style={[styles.tagDot, { backgroundColor: tag.color }]} />
                  <AppText style={styles.flex}>#{tag.name}</AppText>
                  <AppText variant="label" color={colors.expense}>
                    {money(tag.expense)}
                  </AppText>
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('PDF report')}</SectionTitle>
      <Card style={styles.gap}>
        <AppText variant="caption" muted>
          {t('Totals, categories and every transaction for {period}.', { period: title })}
        </AppText>
        {Platform.OS === 'android' ? (
          <Button title={t('Save PDF to this phone')} icon="download-outline" loading={exporting} onPress={() => exportPdf('phone')} />
        ) : null}
        <Button title={t('Share PDF')} variant="secondary" icon="document-outline" disabled={exporting} onPress={() => exportPdf('share')} />
      </Card>
    </Screen>
  );
}

function Figure({
  label,
  value,
  change,
  color,
  goodWhenUp,
  onPress,
}: {
  label: string;
  value: string;
  change?: number | null;
  color: string;
  goodWhenUp?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const good = change != null && (goodWhenUp ? change >= 0 : change <= 0);
  return (
    <Pressable style={styles.flex} onPress={onPress} disabled={!onPress}>
      <Card style={styles.figure}>
        <AppText variant="caption" muted>
          {label}
        </AppText>
        <AppText variant="heading" color={color} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </AppText>
        {change != null ? (
          <AppText variant="caption" color={good ? colors.income : colors.expense}>
            {change > 0 ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}%
          </AppText>
        ) : null}
      </Card>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.between}>
      <AppText muted style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="label">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 10 },
  statRow: { flexDirection: 'row', gap: 12 },
  figure: { gap: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  listCard: { paddingVertical: 4 },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  tagDot: { width: 12, height: 12, borderRadius: 6 },
  pad: { paddingVertical: 12 },
});
