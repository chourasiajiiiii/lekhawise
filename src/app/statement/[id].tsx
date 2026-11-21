import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Chip, DateField, Divider, Screen, SectionTitle, useShowMore } from '@/core/ui';
import { currentMonthKey, formatDate, type ISODate, monthBounds, shiftMonth, todayISO } from '@/core/utils/date';
import { useMoney } from '@/features/expenses/components/Money';
import { exportStatementPdf } from '@/features/expenses/exports';
import { accountStatement, getAccount } from '@/features/expenses/repo';

type Range = 'this' | 'last' | 'custom';

/** An account statement: opening balance, every movement with a running balance, closing balance. */
export default function StatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const [range, setRange] = useState<Range>('this');
  const [customFrom, setCustomFrom] = useState<ISODate>(monthBounds(shiftMonth(currentMonthKey(), -2)).start);
  const [customTo, setCustomTo] = useState<ISODate>(todayISO());
  const [busy, setBusy] = useState(false);

  const bounds =
    range === 'this'
      ? monthBounds(currentMonthKey())
      : range === 'last'
        ? monthBounds(shiftMonth(currentMonthKey(), -1))
        : {
            start: customFrom <= customTo ? customFrom : customTo,
            end: customFrom <= customTo ? customTo : customFrom,
          };

  const { data } = useQuery(
    async (db) => ({
      account: await getAccount(db, id),
      statement: await accountStatement(db, id, bounds.start, bounds.end),
    }),
    [id, bounds.start, bounds.end],
  );

  const exportPdf = async (destination: 'share' | 'phone') => {
    setBusy(true);
    try {
      const done = await exportStatementPdf(db, id, bounds.start, bounds.end, destination);
      if (done && destination === 'phone') Alert.alert(t('Saved'), t('The file was saved in the folder you chose.'));
    } catch (e) {
      console.error(e);
      Alert.alert(t('Could not complete'), t('Something went wrong. Your data was not changed.'));
    } finally {
      setBusy(false);
    }
  };

  const s = data?.statement;
  const lines = useShowMore(s?.lines ?? []);
  return (
    <Screen>
      <Stack.Screen
        options={{
          title: data?.account ? t('Statement: {name}', { name: data.account.name }) : t('Statement'),
        }}
      />
      <View style={styles.chips}>
        <Chip label={t('This month')} selected={range === 'this'} onPress={() => setRange('this')} />
        <Chip label={t('Last month')} selected={range === 'last'} onPress={() => setRange('last')} />
        <Chip label={t('Choose dates')} selected={range === 'custom'} onPress={() => setRange('custom')} />
      </View>
      {range === 'custom' ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <DateField label={t('From')} value={customFrom} onChange={setCustomFrom} />
          </View>
          <View style={styles.flex}>
            <DateField label={t('To')} value={customTo} onChange={setCustomTo} />
          </View>
        </View>
      ) : null}

      {s ? (
        <Card style={styles.gap}>
          <Line
            label={t('Opening balance on {date}', {
              date: formatDate(bounds.start),
            })}
            value={money(s.opening)}
          />
          <Line label={t('Money in')} value={money(s.moneyIn)} color={colors.income} />
          <Line label={t('Money out')} value={money(s.moneyOut)} color={colors.expense} />
          <Divider />
          <Line
            label={t('Closing balance on {date}', {
              date: formatDate(bounds.end),
            })}
            value={money(s.closing)}
            bold
          />
        </Card>
      ) : null}

      <SectionTitle>{t('Entries')}</SectionTitle>
      <Card style={styles.listCard}>
        {s?.lines.length ? (
          <>
            {lines.visible.map((l, i) => (
              <View key={l.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.entry}>
                  <View style={styles.flex}>
                    <AppText numberOfLines={1}>
                      {l.type === 'transfer'
                        ? l.change > 0
                          ? t('From {name}', { name: l.account_name })
                          : t('To {name}', { name: l.to_account_name ?? '' })
                        : (l.category_name ?? (l.split_count ? t('Split') : ''))}
                    </AppText>
                    <AppText variant="caption" muted numberOfLines={1}>
                      {formatDate(l.date)}
                      {l.note ? ` · ${l.note}` : ''}
                    </AppText>
                  </View>
                  <View style={styles.amounts}>
                    <AppText variant="label" color={l.change < 0 ? colors.expense : colors.income}>
                      {l.change > 0 ? '+' : '−'}
                      {money(Math.abs(l.change))}
                    </AppText>
                    <AppText variant="caption" muted>
                      {money(l.running)}
                    </AppText>
                  </View>
                </View>
              </View>
            ))}
            {lines.more}
          </>
        ) : (
          <AppText muted style={styles.pad}>
            {t('No entries in this period.')}
          </AppText>
        )}
      </Card>

      <SectionTitle>{t('PDF statement')}</SectionTitle>
      <View style={styles.gap}>
        {Platform.OS === 'android' ? (
          <Button
            title={t('Save PDF to this phone')}
            icon="download-outline"
            loading={busy}
            onPress={() => exportPdf('phone')}
          />
        ) : null}
        <Button
          title={t('Share PDF')}
          variant="secondary"
          icon="document-outline"
          disabled={busy}
          onPress={() => exportPdf('share')}
        />
      </View>
    </Screen>
  );
}

function Line({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <View style={styles.line}>
      <AppText muted={!bold} style={styles.flex}>
        {label}
      </AppText>
      <AppText variant={bold ? 'heading' : 'label'} color={color}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listCard: { paddingVertical: 4 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  amounts: { alignItems: 'flex-end' },
  pad: { paddingVertical: 12 },
});
