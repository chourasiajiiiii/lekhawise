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
  Chip,
  DateField,
  Screen,
  SectionTitle,
  Segmented,
  SwitchRow,
  TextField,
  useShowMore,
} from '@/core/ui';
import { daysBetween, formatDate, type ISODate, todayISO } from '@/core/utils/date';
import { Amount, MoneyField, useAmountFormat } from '@/features/expenses/components/Money';
import { TransactionRow } from '@/features/expenses/components/TransactionRow';
import {
  deleteRecurring,
  getRecurring,
  listAccounts,
  listTransactions,
  markRecurringPaid,
  type RecurringView,
  setRecurringActive,
  skipRecurring,
  updateRecurring,
} from '@/features/expenses/repo';
import { ruleTitle } from '@/features/expenses/labels';
import { ensureNotificationPermission } from '@/features/expenses/notifications';
import { FREQUENCIES, type RecurringMode } from '@/features/expenses/types';

export default function RecurringRuleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { data, loading } = useQuery(
    async (db) => ({
      rule: await getRecurring(db, id),
      history: await listTransactions(db, { recurringId: id }),
      accounts: await listAccounts(db, { kind: 'all' }),
    }),
    [id],
  );
  if (loading || !data) return <Screen>{null}</Screen>;
  if (!data.rule) {
    return (
      <Screen>
        <AppText>{t('This recurring rule no longer exists.')}</AppText>
      </Screen>
    );
  }
  return (
    <RuleDetail
      key={`${data.rule.id}-${data.rule.next_date}-${data.rule.amount}`}
      rule={data.rule}
      history={data.history}
      accounts={data.accounts}
    />
  );
}

function RuleDetail({
  rule,
  history,
  accounts,
}: {
  rule: RecurringView;
  history: Awaited<ReturnType<typeof listTransactions>>;
  accounts: Awaited<ReturnType<typeof listAccounts>>;
}) {
  const db = useSQLiteContext();
  const historyList = useShowMore(history);
  const { colors } = useTheme();
  const t = useT();
  const { parse, toInput } = useAmountFormat();
  const [paying, setPaying] = useState(false);
  const [paidAmount, setPaidAmount] = useState(toInput(rule.amount));
  const [paidDate, setPaidDate] = useState<ISODate>(todayISO());
  const [paidAccount, setPaidAccount] = useState(rule.account_id);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(toInput(rule.amount));
  const [note, setNote] = useState(rule.note);
  const [mode, setMode] = useState<RecurringMode>(rule.mode);
  const [remindDays, setRemindDays] = useState<number | null>(rule.remind_days);
  const [hasEnd, setHasEnd] = useState(rule.end_date !== null);
  const [endDate, setEndDate] = useState<ISODate>(rule.end_date ?? rule.next_date);

  const days = daysBetween(todayISO(), rule.next_date);
  const frequency = t(FREQUENCIES.find((f) => f.value === rule.frequency)?.label ?? '');
  const moneyAccounts = accounts.filter((a) => rule.type === 'transfer' || a.type !== 'loan');

  const pay = async () => {
    const value = parse(paidAmount);
    if (!value || value <= 0) {
      Alert.alert(t('Check the details'), t('Enter an amount greater than zero.'));
      return;
    }
    await markRecurringPaid(db, rule.id, {
      amount: value,
      date: paidDate,
      account_id: paidAccount,
    });
    setPaying(false);
  };

  const saveEdit = async () => {
    const value = parse(amount);
    if (!value || value <= 0) {
      Alert.alert(t('Check the details'), t('Enter an amount greater than zero.'));
      return;
    }
    await updateRecurring(db, rule.id, {
      amount: value,
      note: note.trim(),
      account_id: rule.account_id,
      category_id: rule.category_id,
      to_account_id: rule.to_account_id,
      mode,
      remind_days: remindDays,
      end_date: hasEnd ? endDate : null,
    });
    if (remindDays !== null) await ensureNotificationPermission();
    setEditing(false);
  };

  const remove = () =>
    Alert.alert(t('Delete this rule?'), t('Entries it already created stay in your history.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteRecurring(db, rule.id);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: ruleTitle(rule, t) }} />
      <Card style={styles.gap}>
        <Amount amount={rule.amount} type={rule.type} variant="title" />
        <AppText muted>
          {frequency} · {rule.mode === 'remind' ? t('bill, marked as paid by you') : t('added automatically')}
        </AppText>
        {rule.active ? (
          <AppText variant="label" color={rule.mode === 'remind' && days < 0 ? colors.danger : colors.text}>
            {rule.mode === 'remind' && days < 0
              ? tPlural(-days, 'Overdue by {count} day ({date})', 'Overdue by {count} days ({date})', {
                  date: formatDate(rule.next_date),
                })
              : t('Next: {date}', { date: formatDate(rule.next_date) })}
          </AppText>
        ) : (
          <AppText variant="label" muted>
            {rule.end_date && rule.next_date > rule.end_date ? t('Finished') : t('Paused')}
          </AppText>
        )}
        <AppText variant="caption" muted>
          {rule.type === 'transfer'
            ? `${rule.account_name} → ${rule.to_account_name ?? ''}`
            : `${rule.category_name ?? ''} · ${rule.account_name}`}
          {rule.remind_days !== null
            ? ` · ${rule.remind_days === 0 ? t('reminder on the day') : tPlural(rule.remind_days, 'reminder {count} day before', 'reminder {count} days before')}`
            : ''}
        </AppText>
      </Card>

      {rule.active && rule.mode === 'remind' ? (
        paying ? (
          <Card style={styles.gap}>
            <AppText variant="label">{t('Mark as paid')}</AppText>
            <MoneyField label={t('Amount paid')} value={paidAmount} onChangeText={setPaidAmount} />
            <DateField label={t('Paid on')} value={paidDate} onChange={setPaidDate} />
            <View style={styles.chips}>
              {moneyAccounts.map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  icon={a.icon}
                  color={a.color}
                  selected={paidAccount === a.id}
                  onPress={() => setPaidAccount(a.id)}
                />
              ))}
            </View>
            <Button title={t('Save payment')} icon="checkmark" onPress={pay} />
            <Button title={t('Cancel')} variant="ghost" onPress={() => setPaying(false)} />
          </Card>
        ) : (
          <View style={styles.gap}>
            <Button title={t('Mark as paid')} icon="checkmark-circle-outline" onPress={() => setPaying(true)} />
            <Button
              title={t('Skip this one')}
              variant="secondary"
              icon="play-skip-forward-outline"
              onPress={() =>
                Alert.alert(
                  t('Skip {date}?', { date: formatDate(rule.next_date) }),
                  t('No payment is recorded for this date.'),
                  [
                    { text: t('Cancel'), style: 'cancel' },
                    {
                      text: t('Skip'),
                      onPress: () => skipRecurring(db, rule.id),
                    },
                  ],
                )
              }
            />
          </View>
        )
      ) : null}

      {editing ? (
        <Card style={styles.gap}>
          <MoneyField label={t('Amount')} value={amount} onChangeText={setAmount} />
          <TextField label={t('Note')} value={note} onChangeText={setNote} maxLength={200} />
          <Segmented
            options={[
              { value: 'auto', label: t('Add automatically') },
              { value: 'remind', label: t('Remind me (bill)') },
            ]}
            value={mode}
            onChange={setMode}
          />
          <View style={styles.chips}>
            {[0, 1, 3, 7].map((d) => (
              <Chip
                key={d}
                label={d === 0 ? t('Remind on the day') : tPlural(d, '{count} day before', '{count} days before')}
                selected={remindDays === d}
                onPress={() => setRemindDays(d)}
              />
            ))}
            <Chip label={t('No reminder')} selected={remindDays === null} onPress={() => setRemindDays(null)} />
          </View>
          <SwitchRow title={t('Ends on a date')} value={hasEnd} onChange={setHasEnd} />
          {hasEnd ? <DateField label={t('Last date')} value={endDate} onChange={setEndDate} /> : null}
          <Button title={t('Save changes')} icon="checkmark" onPress={saveEdit} />
          <Button title={t('Cancel')} variant="ghost" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <View style={styles.gap}>
          <Button title={t('Edit')} variant="secondary" icon="create-outline" onPress={() => setEditing(true)} />
          <Button
            title={rule.active ? t('Pause') : t('Resume (adds any missed entries)')}
            variant="secondary"
            icon={rule.active ? 'pause-outline' : 'play-outline'}
            onPress={() => setRecurringActive(db, rule.id, !rule.active)}
          />
          <Button title={t('Delete rule')} variant="danger" icon="trash-outline" onPress={remove} />
        </View>
      )}

      <SectionTitle>{t('Payment history')}</SectionTitle>
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

const styles = StyleSheet.create({
  gap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  listCard: { paddingVertical: 4 },
  pad: { paddingVertical: 12 },
});
