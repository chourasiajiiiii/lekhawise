import { StyleSheet, View } from 'react-native';

import { type DateFormat, type NumberFormat, useLocale, useT } from '@/core/i18n/locale';
import { AppText, Card, Chip, Screen, SectionTitle } from '@/core/ui';
import { formatDate, formatMonthLabel, type WeekStart } from '@/core/utils/date';
import { formatMoney } from '@/core/utils/money';
import { setDateFormat, setNumberFormat, useCurrency, useFyStartMonth, useWeekStart } from '@/features/expenses/settings';

const DATE_FORMATS: DateFormat[] = ['system', 'dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'dd-mm-yyyy', 'dd.mm.yyyy'];
const NUMBER_FORMATS: { value: NumberFormat; label: string }[] = [
  { value: 'system', label: 'Phone setting' },
  { value: 'indian', label: 'Indian (lakh, crore)' },
  { value: 'international', label: 'International' },
  { value: 'european', label: 'European' },
  { value: 'spaced', label: 'Spaced' },
];
const SAMPLE_DATE = '2026-11-21';

export default function FormatsScreen() {
  const t = useT();
  const { dateFormat, numberFormat } = useLocale();
  const [currency] = useCurrency();
  const [weekStart, setWeekStart] = useWeekStart();
  const [fyStart, setFyStart] = useFyStartMonth();

  return (
    <Screen>
      <SectionTitle>{t('Dates')}</SectionTitle>
      <View style={styles.chips}>
        {DATE_FORMATS.map((f) => (
          <Chip
            key={f}
            label={f === 'system' ? t('Phone setting') : f.toUpperCase()}
            selected={dateFormat === f}
            onPress={() => setDateFormat(f)}
          />
        ))}
      </View>
      <AppText variant="caption" muted>
        {t('Example: {date}', { date: formatDate(SAMPLE_DATE) })}
      </AppText>

      <SectionTitle>{t('Numbers')}</SectionTitle>
      <View style={styles.chips}>
        {NUMBER_FORMATS.map((f) => (
          <Chip key={f.value} label={t(f.label)} selected={numberFormat === f.value} onPress={() => setNumberFormat(f.value)} />
        ))}
      </View>
      <Card>
        <AppText variant="heading">{formatMoney(123456789, currency)}</AppText>
        <AppText variant="caption" muted>
          {t('Amounts are typed with the decimal separator of this format.')}
        </AppText>
      </Card>

      <SectionTitle>{t('Week starts on')}</SectionTitle>
      <View style={styles.chips}>
        {([
          [1, 'Monday'],
          [0, 'Sunday'],
          [6, 'Saturday'],
        ] as [WeekStart, string][]).map(([value, label]) => (
          <Chip key={value} label={t(label)} selected={weekStart === value} onPress={() => setWeekStart(value)} />
        ))}
      </View>

      <SectionTitle>{t('Financial year starts in')}</SectionTitle>
      <View style={styles.chips}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <Chip
            key={m}
            label={formatMonthLabel(`2026-${String(m).padStart(2, '0')}`).split(' ')[0]}
            selected={fyStart === m}
            onPress={() => setFyStart(m)}
          />
        ))}
      </View>
      <AppText variant="caption" muted>
        {t('India uses April to March. Yearly reports follow this setting.')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
