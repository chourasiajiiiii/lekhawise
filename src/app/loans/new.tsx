import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { AppText, Button, Card, Chip, DateField, Screen, SectionTitle, Segmented, TextField } from '@/core/ui';
import { type ISODate, todayISO } from '@/core/utils/date';
import { formatNumber } from '@/core/utils/money';
import { MoneyField, useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { computeEmi, parseRate } from '@/features/expenses/loanMath';
import { listAccounts } from '@/features/expenses/repo';
import { createLoan } from '@/features/expenses/repoLoans';
import type { LoanDirection } from '@/features/expenses/types';

export default function NewLoanScreen() {
  const db = useSQLiteContext();
  const t = useT();
  const money = useMoney();
  const { parse, toInput } = useAmountFormat();
  const { data: accounts = [] } = useQuery((db) => listAccounts(db), []);
  const [direction, setDirection] = useState<LoanDirection>('borrowed');
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState('');
  const [emi, setEmi] = useState('');
  const [startDate, setStartDate] = useState<ISODate>(todayISO());
  const [source, setSource] = useState<'new' | 'existing'>('new');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [outstanding, setOutstanding] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const principalValue = parse(principal) ?? 0;
  const rateValue = parseRate(rate);
  const tenureValue = /^\d{1,4}$/.test(tenure.trim()) ? Number(tenure) : null;
  const suggestedEmi = principalValue && tenureValue && rateValue !== null ? computeEmi(principalValue, rateValue, tenureValue) : 0;
  const chosenAccount = accountId ?? accounts[0]?.id ?? null;

  const save = async () => {
    if (rateValue === null) {
      Alert.alert(t('Check the details'), t('Enter the interest rate as a percentage, for example 8.5.'));
      return;
    }
    const emiValue = emi.trim() ? parse(emi) : suggestedEmi || null;
    const outstandingValue = source === 'existing' ? (outstanding.trim() ? parse(outstanding) : principalValue) : 0;
    if (outstandingValue === null) {
      Alert.alert(t('Check the details'), t('Enter how much is still outstanding.'));
      return;
    }
    setSaving(true);
    try {
      const id = await createLoan(db, {
        direction,
        name,
        principal: principalValue,
        annual_rate: rateValue,
        tenure_months: tenureValue,
        emi: emiValue,
        start_date: startDate,
        note,
        source: source === 'new' ? { kind: 'new', account_id: chosenAccount ?? '' } : { kind: 'existing', outstanding: outstandingValue },
      });
      router.replace(`/loans/${id}`);
    } catch (e) {
      Alert.alert(t('Check the details'), e instanceof Error ? t(e.message) : '');
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Segmented
        options={[
          { value: 'borrowed', label: t('I borrowed') },
          { value: 'lent', label: t('I lent') },
        ]}
        value={direction}
        onChange={setDirection}
      />
      <TextField
        label={direction === 'borrowed' ? t('Loan or lender') : t('Who you lent to')}
        value={name}
        onChangeText={setName}
        placeholder={direction === 'borrowed' ? t('e.g. SBI home loan') : t('e.g. Ravi')}
        maxLength={40}
        autoFocus
      />
      <MoneyField label={t('Amount')} value={principal} onChangeText={setPrincipal} />
      <DateField label={direction === 'borrowed' ? t('Taken on') : t('Lent on')} value={startDate} onChange={setStartDate} />

      <SectionTitle>{t('Interest and EMI (optional)')}</SectionTitle>
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label={t('Interest % a year')} value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="0" />
        </View>
        <View style={styles.flex}>
          <TextField label={t('Months')} value={tenure} onChangeText={setTenure} keyboardType="number-pad" placeholder={t('e.g. 60')} />
        </View>
      </View>
      <MoneyField label={t('Monthly instalment (EMI)')} value={emi} onChangeText={setEmi} placeholder={suggestedEmi ? toInput(suggestedEmi) : '0'} />
      {suggestedEmi ? (
        <AppText variant="caption" muted>
          {t('Worked out EMI: {amount} for {months} months at {rate}%. Leave the EMI empty to use it.', {
            amount: money(suggestedEmi),
            months: tenureValue ?? 0,
            rate: formatNumber((rateValue ?? 0) / 100),
          })}
        </AppText>
      ) : null}

      <SectionTitle>{t('Money')}</SectionTitle>
      <Segmented
        options={[
          { value: 'new', label: direction === 'borrowed' ? t('Received now') : t('Paid now') },
          { value: 'existing', label: t('Already running') },
        ]}
        value={source}
        onChange={setSource}
      />
      {source === 'new' ? (
        <Card style={styles.gap}>
          <AppText variant="caption" muted>
            {direction === 'borrowed'
              ? t('The amount is added to this account as a transfer from the loan (it is not income).')
              : t('The amount leaves this account as a transfer to the person (it is not spending).')}
          </AppText>
          <View style={styles.chips}>
            {accounts.map((a) => (
              <Chip key={a.id} label={a.name} icon={a.icon} color={a.color} selected={chosenAccount === a.id} onPress={() => setAccountId(a.id)} />
            ))}
          </View>
        </Card>
      ) : (
        <Card style={styles.gap}>
          <AppText variant="caption" muted>
            {t('For a loan from before you started using the app. No account balance changes.')}
          </AppText>
          <MoneyField label={t('Still outstanding today')} value={outstanding} onChangeText={setOutstanding} placeholder={principal || '0'} />
        </Card>
      )}
      <TextField label={t('Note')} value={note} onChangeText={setNote} placeholder={t('Optional')} maxLength={200} />
      <Button title={t('Save')} icon="checkmark" onPress={save} loading={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  gap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
