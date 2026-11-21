import { Pressable, StyleSheet, View } from 'react-native';

import { t, useLocale } from '../i18n/locale';
import { useTheme } from '../theme/theme';
import { currentMonthKey, formatMonthLabel, type MonthKey, shiftMonth } from '../utils/date';
import { AppText, Icon } from './primitives';

type PeriodSwitcherProps = {
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  /** Shown under the label when not on the current period; tapping it jumps back. */
  resetLabel?: string;
  onReset?: () => void;
  previousLabel?: string;
  nextLabel?: string;
};

/** "‹ November 2026 ›" style switcher for months, weeks or years. */
export function PeriodSwitcher({ label, onPrevious, onNext, resetLabel, onReset, previousLabel, nextLabel }: PeriodSwitcherProps) {
  const { colors } = useTheme();
  useLocale();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={previousLabel ?? t('Previous')}
        hitSlop={12}
        onPress={onPrevious}
        style={[styles.arrow, { backgroundColor: colors.surfaceAlt }]}
      >
        <Icon name="chevron-back" />
      </Pressable>
      <Pressable onPress={onReset} disabled={!onReset} style={styles.center}>
        <AppText variant="heading" style={styles.centerText} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </AppText>
        {resetLabel ? (
          <AppText variant="caption" color={colors.primary} style={styles.centerText}>
            {resetLabel}
          </AppText>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={nextLabel ?? t('Next')}
        hitSlop={12}
        onPress={onNext}
        style={[styles.arrow, { backgroundColor: colors.surfaceAlt }]}
      >
        <Icon name="chevron-forward" />
      </Pressable>
    </View>
  );
}

export function MonthSwitcher({ month, onChange }: { month: MonthKey; onChange: (month: MonthKey) => void }) {
  useLocale();
  const isCurrent = month === currentMonthKey();
  return (
    <PeriodSwitcher
      label={formatMonthLabel(month)}
      onPrevious={() => onChange(shiftMonth(month, -1))}
      onNext={() => onChange(shiftMonth(month, 1))}
      previousLabel={t('Previous month')}
      nextLabel={t('Next month')}
      resetLabel={isCurrent ? undefined : t('Back to this month')}
      onReset={isCurrent ? undefined : () => onChange(currentMonthKey())}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  arrow: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center' },
  centerText: { textAlign: 'center' },
});
