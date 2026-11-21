import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { AppText, Button, Card, Chip, DateField, Screen, SectionTitle, TextField } from '@/core/ui';
import { type ISODate, todayISO } from '@/core/utils/date';
import { MoneyField, useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { splitPayment } from '@/features/expenses/loanMath';
import { listAccounts } from '@/features/expenses/repo';
import { getLoan, increaseLoan, type LoanView, recordLoanPayment } from '@/features/expenses/repoLoans';

/** Route: /loans/pay?id=<loan>&mode=pay (a repayment) or mode=more (borrow or lend more). */
export default function LoanPaymentScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: 'pay' | 'more' }>();
  const { data } = useQuery(async (db) => ({ loan: await getLoan(db, id), accounts: await listAccounts(db) }), [id]);
  if (!data?.loan) return <Screen>{null}</Screen>;
  return <PaymentForm loan={data.loan} accounts={data.accounts} more={mode === 'more'} />;
}

function PaymentForm({ loan, accounts, more }: { loan: LoanView; accounts: Awaited<ReturnType<typeof listAccounts>>; more: boolean }) {
  const db = useSQLiteContext();
  const t = useT();
  const money = useMoney();
  const { parse, toInput } = useAmountFormat();
  const borrowed = loan.direction === 'borrowed';
  const defaultAmount = !more && loan.emi ? Math.min(loan.emi, loan.outstanding + Math.round((loan.outstanding * loan.annual_rate) / 120000)) : 0;
  const [amount, setAmount] = useState(defaultAmount > 0 ? toInput(defaultAmount) : '');
  const amountValue = parse(amount) ?? 0;
  const suggested = splitPayment(amountValue, loan.outstanding, loan.annual_rate);
  const [interestText, setInterestText] = useState<string | null>(null);
  const [date, setDate] = useState<ISODate>(todayISO());
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const interest = interestText === null ? suggested.interest : (parse(interestText) ?? 0);

  const save = async () => {
    if (amountValue <= 0) {
      Alert.alert(t('Check the details'), t('Enter an amount greater than zero.'));
      return;
    }
    setSaving(true);
    try {
      if (more) await increaseLoan(db, loan.account_id, { amount: amountValue, date, account_id: accountId, note });
      else await recordLoanPayment(db, loan.account_id, { amount: amountValue, interest, date, account_id: accountId, note });
      router.back();
    } catch (e) {
      Alert.alert(t('Check the details'), e instanceof Error ? t(e.message) : '');
      setSaving(false);
    }
  };

  const title = more
    ? borrowed
      ? t('Borrow more')
      : t('Lend more')
    : borrowed
      ? t('Record a repayment')
      : t('Record money received');

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <AppText variant="heading">{loan.name}</AppText>
      <AppText muted>{t('Outstanding: {amount}', { amount: money(loan.outstanding) })}</AppText>
      <MoneyField label={t('Amount')} value={amount} onChangeText={setAmount} />
      {!more ? (
        <Card style={styles.gap}>
          <MoneyField
            label={borrowed ? t('Of which interest') : t('Of which interest received')}
            value={interestText ?? (suggested.interest ? toInput(suggested.interest) : '')}
            onChangeText={setInterestText}
          />
          <AppText variant="caption" muted>
            {loan.annual_rate
              ? t('Worked out as one month of interest on what is outstanding. Change it to match your bank statement.')
              : t('No interest rate is set for this loan.')}
          </AppText>
          <AppText variant="label">
            {t('Reduces the loan by {amount}', { amount: money(Math.max(0, amountValue - interest)) })}
          </AppText>
        </Card>
      ) : null}
      <DateField label={t('Date')} value={date} onChange={setDate} />
      <SectionTitle>{borrowed === !more ? t('Paid from') : t('Received into')}</SectionTitle>
      <View style={styles.chips}>
        {accounts.map((a) => (
          <Chip key={a.id} label={a.name} icon={a.icon} color={a.color} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
        ))}
      </View>
      <TextField label={t('Note')} value={note} onChangeText={setNote} placeholder={t('Optional')} maxLength={200} />
      <Button title={t('Save')} icon="checkmark" onPress={save} loading={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
