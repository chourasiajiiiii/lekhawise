import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, IconBadge, ProgressBar } from '@/core/ui';
import { formatShortMonth } from '@/core/utils/date';

import type { CategoryTotal, MonthTotal } from '../repo';
import { useAmountFormat, useMoney } from './Money';

/*
 * Charts drawn with plain Views: no chart or SVG library to keep updated.
 */

/** Spending per category as horizontal bars, largest first. Rows can be tapped to see the entries. */
export function CategoryBreakdown({
  items,
  limit = 6,
  onPress,
}: {
  items: CategoryTotal[];
  limit?: number;
  onPress?: (item: CategoryTotal) => void;
}) {
  const money = useMoney();
  const t = useT();
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const shown = items.slice(0, limit);
  const rest = items.slice(limit).reduce((sum, item) => sum + item.total, 0);

  return (
    <View style={styles.list}>
      {shown.map((item) => (
        <Pressable
          key={item.id}
          disabled={!onPress}
          onPress={() => onPress?.(item)}
          accessibilityRole={onPress ? 'button' : undefined}
          style={({ pressed }) => [styles.breakdownRow, { opacity: pressed ? 0.6 : 1 }]}
        >
          <IconBadge name={item.icon} color={item.color} size={34} />
          <View style={styles.flex}>
            <View style={styles.breakdownHeader}>
              <AppText numberOfLines={1} style={styles.flex}>
                {item.name}
              </AppText>
              <AppText variant="label">{money(item.total)}</AppText>
            </View>
            <View style={styles.breakdownHeader}>
              <View style={styles.flex}>
                <ProgressBar value={total ? item.total / total : 0} color={item.color} height={6} />
              </View>
              <AppText variant="caption" muted style={styles.pct}>
                {total ? Math.round((item.total / total) * 100) : 0}%
              </AppText>
            </View>
          </View>
        </Pressable>
      ))}
      {rest > 0 ? (
        <AppText variant="caption" muted>
          {t('Other categories: {amount}', { amount: money(rest) })}
        </AppText>
      ) : null}
    </View>
  );
}

/** Income vs expense per month as paired vertical bars. */
export function MonthlyTrend({ months, onPress }: { months: MonthTotal[]; onPress?: (month: string) => void }) {
  const { colors } = useTheme();
  const t = useT();
  const { compact } = useAmountFormat();
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const CHART_HEIGHT = 120;

  return (
    <View>
      <View style={[styles.trend, { height: CHART_HEIGHT + 36 }]}>
        {months.map((m) => (
          <Pressable
            key={m.month}
            disabled={!onPress}
            onPress={() => onPress?.(m.month)}
            style={styles.trendColumn}
            accessible
            accessibilityLabel={t('{month}: income {income}, expenses {expense}', {
              month: formatShortMonth(m.month),
              income: compact(m.income),
              expense: compact(m.expense),
            })}
          >
            <AppText variant="caption" muted style={styles.trendValue} numberOfLines={1}>
              {m.expense ? compact(m.expense) : ''}
            </AppText>
            <View style={[styles.trendBars, { height: CHART_HEIGHT }]}>
              <View style={[styles.bar, { height: barHeight(m.income, max, CHART_HEIGHT), backgroundColor: colors.income }]} />
              <View style={[styles.bar, { height: barHeight(m.expense, max, CHART_HEIGHT), backgroundColor: colors.expense }]} />
            </View>
            <AppText variant="caption" muted numberOfLines={1}>
              {formatShortMonth(m.month)}
            </AppText>
          </Pressable>
        ))}
      </View>
      <View style={styles.legend}>
        <LegendDot color={colors.income} label={t('Income')} />
        <LegendDot color={colors.expense} label={t('Expense')} />
      </View>
    </View>
  );
}

/**
 * One value per period as bars from a zero line: positive values go up, negative values down.
 * Used for net worth, savings and savings rate over time.
 */
export function SeriesChart({
  points,
  format,
  color,
  negativeColor,
}: {
  points: { key: string; label: string; value: number }[];
  format: (value: number) => string;
  color?: string;
  negativeColor?: string;
}) {
  const { colors } = useTheme();
  const HEIGHT = 110;
  const maxUp = Math.max(0, ...points.map((p) => p.value));
  const maxDown = Math.max(0, ...points.map((p) => -p.value));
  const range = Math.max(1, maxUp + maxDown);
  const upHeight = (maxUp / range) * HEIGHT;
  const downHeight = (maxDown / range) * HEIGHT;

  return (
    <View style={styles.series}>
      {points.map((p) => (
        <View key={p.key} style={styles.seriesColumn} accessible accessibilityLabel={`${p.label}: ${format(p.value)}`}>
          <View style={[styles.seriesHalf, { height: upHeight }]}>
            {p.value > 0 ? (
              <View style={[styles.seriesBar, { height: barHeight(p.value, range, HEIGHT), backgroundColor: color ?? colors.primary }]} />
            ) : null}
          </View>
          <View style={[styles.zero, { backgroundColor: colors.border }]} />
          <View style={[styles.seriesHalfDown, { height: downHeight }]}>
            {p.value < 0 ? (
              <View style={[styles.seriesBar, { height: barHeight(-p.value, range, HEIGHT), backgroundColor: negativeColor ?? colors.expense }]} />
            ) : null}
          </View>
          <AppText variant="caption" muted numberOfLines={1} style={styles.seriesLabel}>
            {p.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** Zero draws nothing; any non-zero value stays visible even when tiny next to the largest one. */
function barHeight(value: number, max: number, chartHeight: number): number {
  if (value <= 0) return 0;
  return Math.max(3, (value / max) * chartHeight);
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 14 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  breakdownHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  pct: { width: 36, textAlign: 'right' },
  trend: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  trendColumn: { flex: 1, alignItems: 'center', gap: 4 },
  trendValue: { fontSize: 11 },
  trendBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { width: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  series: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  seriesColumn: { flex: 1, alignItems: 'center' },
  seriesHalf: { width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  seriesHalfDown: { width: '100%', justifyContent: 'flex-start', alignItems: 'center' },
  seriesBar: { width: '70%', maxWidth: 18, borderRadius: 3 },
  zero: { height: 1, width: '100%' },
  seriesLabel: { fontSize: 11, marginTop: 4 },
});
