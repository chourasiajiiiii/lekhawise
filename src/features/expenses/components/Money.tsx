import { useCallback, useMemo } from 'react';
import { StyleSheet, TextInput, type TextProps, View } from 'react-native';

import { useLocale } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText } from '@/core/ui';
import { currencyDecimals, formatCompact, formatMoney, parseAmount, toInputString } from '@/core/utils/money';

import { useCurrency } from '../settings';
import type { TxType } from '../types';

/** Returns a formatter bound to the user's currency: `const money = useMoney(); money(1250)`. */
export function useMoney(): (minor: number) => string {
  const [currency] = useCurrency();
  const { numberFormat, language } = useLocale();
  // numberFormat and language change how numbers look, so they are part of the formatter's identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((minor: number) => formatMoney(minor, currency), [currency, numberFormat, language]);
}

/** Parsing and formatting of typed amounts for the current currency and number format. */
export function useAmountFormat() {
  const [currency] = useCurrency();
  const { numberFormat } = useLocale();
  return useMemo(
    () => ({
      currency,
      parse: (text: string) => parseAmount(text, { currency }),
      toInput: (minor: number) => toInputString(minor, { currency }),
      compact: (minor: number) => formatCompact(minor, currency),
      keyboard: currencyDecimals(currency) === 0 ? ('number-pad' as const) : ('decimal-pad' as const),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, numberFormat],
  );
}

type AmountProps = Omit<TextProps, 'children'> & {
  amount: number;
  type?: TxType;
  variant?: 'title' | 'heading' | 'body' | 'label' | 'caption';
};

/** Amount coloured by direction: expenses red with "-", income green with "+", transfers neutral. */
export function Amount({ amount, type, variant = 'label', ...rest }: AmountProps) {
  const { colors } = useTheme();
  const money = useMoney();
  const color = type === 'expense' ? colors.expense : type === 'income' ? colors.income : colors.text;
  const sign = type === 'expense' ? '-' : type === 'income' ? '+' : '';
  return (
    <AppText variant={variant} color={color} numberOfLines={1} {...rest}>
      {sign}
      {money(amount)}
    </AppText>
  );
}

/** A labelled amount field with the currency code in front. */
export function MoneyField({
  label,
  value,
  onChangeText,
  placeholder = '0',
  accessibilityLabel,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const { currency, keyboard } = useAmountFormat();
  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="caption" muted style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <AppText muted>{currency}</AppText>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboard}
          accessibilityLabel={accessibilityLabel ?? label}
          style={[styles.input, { color: colors.text }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { paddingHorizontal: 4 },
  box: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
});
