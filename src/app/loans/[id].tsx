import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import {
  AppText,
  Button,
  Card,
  DateField,
  Divider,
  ProgressBar,
  Screen,
  SectionTitle,
  TextField,
  useShowMore,
} from '@/core/ui';
import { addPeriods, formatDate, type ISODate } from '@/core/utils/date';
import { formatNumber } from '@/core/utils/money';
import { MoneyField, useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { TransactionRow } from '@/features/expenses/components/TransactionRow';
import { amortizationSchedule, monthsRemaining, parseRate, totalInterest } from '@/features/expenses/loanMath';
import {
  closeLoan,
  getLoan,
  loanHistory,
  type LoanView,
  reopenLoan,
  updateLoanDetails,
} from '@/features/expenses/repoLoans';

export default function LoanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { data, loading } = useQuery(
    async (db) => ({
      loan: await getLoan(db, id),
      history: await loanHistory(db, id),
    }),
    [id],
  );
  if (loading || !data) return <Screen>{null}</Screen>;
  if (!data.loan) {
    return (
      <Screen>
        <AppText>{t('This loan no longer exists.')}</AppText>
      </Screen>
    );
  }
  return <LoanDetail loan={data.loan} history={data.history} />;
}

function LoanDetail({ loan, history }: { loan: LoanView; history: Awaited<ReturnType<typeof loanHistory>> }) {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { parse, toInput } = useAmountFormat();
  const [editing, setEditing] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [name, setName] = useState(loan.name);
  const [principal, setPrincipal] = useState(toInput(loan.principal));
  const [rate, setRate] = useState(loan.annual_rate ? String(loan.annual_rate / 100) : '');
  const [tenure, setTenure] = useState(loan.tenure_months ? String(loan.tenure_months) : '');
  const [emi, setEmi] = useState(loan.emi ? toInput(loan.emi) : '');
  const [startDate, setStartDate] = useState<ISODate>(loan.start_date);

  const borrowed = loan.direction === 'borrowed';
  const repaid = loan.principal > 0 ? Math.max(0, Math.min(1, 1 - loan.outstanding / loan.principal)) : 0;
  const schedule =
    loan.tenure_months && loan.principal
      ? amortizationSchedule(
          loan.principal,
          loan.annual_rate,
          loan.tenure_months,
          loan.start_date,
          loan.emi ?? undefined,
        )
      : [];
  const left = loan.emi ? monthsRemaining(loan.outstanding, loan.annual_rate, loan.emi) : null;
  const scheduleList = useShowMore(schedule, 60);
  const historyList = useShowMore(history);
  const nextDue =
    loan.emi && loan.tenure_months
      ? addPeriods(loan.start_date, 'monthly', Math.min(loan.payments + 1, loan.tenure_months))
      : null;

  const saveEdit = async () => {
    const rateValue = parseRate(rate);
    const principalValue = parse(principal);
    if (rateValue === null || principalValue === null) {
      Alert.alert(t('Check the details'), t('Enter the amount and the interest rate as numbers.'));
      return;
    }
    try {
      await updateLoanDetails(db, loan.account_id, {
        name,
        principal: principalValue,
        annual_rate: rateValue,
        tenure_months: /^\d+$/.test(tenure.trim()) ? Number(tenure) : null,
        emi: emi.trim() ? parse(emi) : null,
        start_date: startDate,
        note: loan.note,
      });
      setEditing(false);
    } catch (e) {
      Alert.alert(t('Could not save'), e instanceof Error ? t(e.message) : '');
    }
  };

  const close = () =>
    Alert.alert(
      t('Close this loan?'),
      loan.outstanding !== 0
        ? t('{amount} is still outstanding. Close it anyway? It stays in your history.', {
            amount: money(loan.outstanding),
          })
        : t('It moves to Closed and stays in your history.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Close loan'),
          onPress: async () => {
            const result = await closeLoan(db, loan.account_id);
            if (result === 'deleted') router.back();
          },
        },
      ],
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: loan.name }} />
      <Card style={styles.gap}>
        <AppText variant="caption" muted>
          {borrowed ? t('You still owe') : t('Still owed to you')}
        </AppText>
        <AppText variant="title" color={borrowed ? colors.expense : colors.income}>
          {money(loan.outstanding)}
        </AppText>
        {loan.principal > 0 ? (
          <>
            <ProgressBar value={repaid} color={loan.color} height={10} />
            <AppText variant="caption" muted>
              {t('{pct}% of {amount} repaid', {
                pct: Math.round(repaid * 100),
                amount: money(loan.principal),
              })}
            </AppText>
          </>
        ) : null}
        <Divider />
        {loan.annual_rate ? (
          <Fact label={t('Interest rate')} value={`${formatNumber(loan.annual_rate / 100)}% ${t('a year')}`} />
        ) : null}
        {loan.emi ? <Fact label={t('EMI')} value={money(loan.emi)} /> : null}
        {nextDue && loan.outstanding > 0 && !loan.archived ? (
          <Fact label={t('Next instalment due')} value={formatDate(nextDue)} />
        ) : null}
        {left !== null && loan.outstanding > 0 ? (
          <Fact label={t('Instalments left at this EMI')} value={String(left)} />
        ) : null}
        <Fact
          label={borrowed ? t('Interest paid so far') : t('Interest received so far')}
          value={money(loan.interest_paid)}
        />
        <Fact label={t('Payments recorded')} value={String(loan.payments)} />
        <Fact label={borrowed ? t('Taken on') : t('Lent on')} value={formatDate(loan.start_date)} />
      </Card>

      {!loan.archived ? (
        <View style={styles.gap}>
          <Button
            title={borrowed ? t('Record a repayment') : t('Record money received')}
            icon="checkmark-circle-outline"
            onPress={() =>
              router.push({
                pathname: '/loans/pay',
                params: { id: loan.account_id, mode: 'pay' },
              })
            }
          />
          <Button
            title={borrowed ? t('Borrow more') : t('Lend more')}
            variant="secondary"
            icon="add"
            onPress={() =>
              router.push({
                pathname: '/loans/pay',
                params: { id: loan.account_id, mode: 'more' },
              })
            }
          />
        </View>
      ) : null}

      {editing ? (
        <Card style={styles.gap}>
          <TextField label={t('Name')} value={name} onChangeText={setName} maxLength={40} />
          <MoneyField label={t('Amount')} value={principal} onChangeText={setPrincipal} />
          <View style={styles.row}>
            <View style={styles.flex}>
              <TextField
                label={t('Interest % a year')}
                value={rate}
                onChangeText={setRate}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.flex}>
              <TextField label={t('Months')} value={tenure} onChangeText={setTenure} keyboardType="number-pad" />
            </View>
          </View>
          <MoneyField label={t('Monthly instalment (EMI)')} value={emi} onChangeText={setEmi} />
          <DateField label={borrowed ? t('Taken on') : t('Lent on')} value={startDate} onChange={setStartDate} />
          <Button title={t('Save changes')} icon="checkmark" onPress={saveEdit} />
          <Button title={t('Cancel')} variant="ghost" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <View style={styles.gap}>
          <Button
            title={t('Edit details')}
            variant="secondary"
            icon="create-outline"
            onPress={() => setEditing(true)}
          />
          {loan.archived ? (
            <Button
              title={t('Reopen')}
              variant="secondary"
              icon="arrow-undo-outline"
              onPress={() => reopenLoan(db, loan.account_id)}
            />
          ) : (
            <Button title={t('Close loan')} variant="danger" icon="archive-outline" onPress={close} />
          )}
        </View>
      )}

      {schedule.length ? (
        <>
          <SectionTitle
            right={
              <Button
                title={showSchedule ? t('Hide') : t('Show')}
                variant="ghost"
                onPress={() => setShowSchedule(!showSchedule)}
              />
            }
          >
            {t('Repayment schedule')}
          </SectionTitle>
          <Card style={styles.gap}>
            <Fact label={t('Total interest over the loan')} value={money(totalInterest(schedule))} />
            <Fact label={t('Last instalment')} value={formatDate(schedule[schedule.length - 1].date)} />
            {showSchedule ? (
              <View>
                <View style={styles.scheduleRow}>
                  <AppText variant="caption" muted style={styles.no}>
                    #
                  </AppText>
                  <AppText variant="caption" muted style={styles.cell}>
                    {t('Date')}
                  </AppText>
                  <AppText variant="caption" muted style={styles.num}>
                    {t('Interest')}
                  </AppText>
                  <AppText variant="caption" muted style={styles.num}>
                    {t('Balance')}
                  </AppText>
                </View>
                {scheduleList.visible.map((row) => (
                  <View
                    key={row.number}
                    style={[styles.scheduleRow, row.number <= loan.payments ? { opacity: 0.45 } : null]}
                    accessibilityLabel={tPlural(row.number, 'Instalment {count}', 'Instalment {count}')}
                  >
                    <AppText variant="caption" style={styles.no}>
                      {row.number}
                    </AppText>
                    <AppText variant="caption" style={styles.cell}>
                      {formatDate(row.date)}
                    </AppText>
                    <AppText variant="caption" style={styles.num}>
                      {money(row.interest)}
                    </AppText>
                    <AppText variant="caption" style={styles.num}>
                      {money(row.balance)}
                    </AppText>
                  </View>
                ))}
                {scheduleList.more}
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('History')}</SectionTitle>
      <Card style={styles.listCard}>
        {history.length ? (
          <>
            {historyList.visible.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} showDate={formatDate(tx.date)} />
            ))}
            {historyList.more}
          </>
        ) : (
          <AppText muted style={styles.pad}>
            {t('Nothing recorded yet.')}
          </AppText>
        )}
      </Card>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
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
  row: { flexDirection: 'row', gap: 10 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listCard: { paddingVertical: 4 },
  pad: { paddingVertical: 12 },
  scheduleRow: { flexDirection: 'row', paddingVertical: 4, gap: 6 },
  no: { width: 28 },
  cell: { flex: 1.2 },
  num: { flex: 1, textAlign: 'right' },
});
