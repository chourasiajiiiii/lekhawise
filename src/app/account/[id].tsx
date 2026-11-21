import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { PALETTE } from '@/core/theme/theme';
import { AppText, Button, Card, Chip, IconBadge, type IconName, PromptModal, Screen, SectionTitle, TextField } from '@/core/ui';
import { formatDate } from '@/core/utils/date';
import { AppearancePicker } from '@/features/expenses/components/AppearancePicker';
import { Amount, MoneyField, useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { TransactionRow } from '@/features/expenses/components/TransactionRow';
import {
  deleteOrArchiveAccount,
  getAccount,
  getAccountBalance,
  listTransactions,
  reconcileAccount,
  saveAccount,
  setAccountArchived,
} from '@/features/expenses/repo';
import { ACCOUNT_TYPES, type Account, type AccountType } from '@/features/expenses/types';

const ACCOUNT_ICONS: IconName[] = [
  'cash-outline', 'business-outline', 'card-outline', 'wallet-outline', 'phone-portrait-outline',
  'briefcase-outline', 'home-outline', 'trending-up-outline', 'shield-checkmark-outline', 'globe-outline',
  'gift-outline', 'ellipsis-horizontal-circle-outline',
];

export default function AccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const isNew = id === 'new';
  const { data, loading } = useQuery(async (db) => (isNew ? null : await getAccount(db, id)), [id]);
  if (loading) return <Screen>{null}</Screen>;
  if (!isNew && !data) {
    return (
      <Screen>
        <AppText>{t('This account no longer exists.')}</AppText>
      </Screen>
    );
  }
  // Loan accounts are edited on the loan screen.
  if (data?.type === 'loan') return <Redirect href={`/loans/${data.id}`} />;
  return <AccountForm key={id} existing={data ?? null} />;
}

function AccountForm({ existing }: { existing: Account | null }) {
  const db = useSQLiteContext();
  const t = useT();
  const money = useMoney();
  const { parse, toInput } = useAmountFormat();
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'bank');
  const [icon, setIcon] = useState<IconName>(existing?.icon ?? 'business-outline');
  const [color, setColor] = useState<string>(existing?.color ?? PALETTE[7]);
  const [opening, setOpening] = useState(existing?.opening_balance ? toInput(Math.abs(existing.opening_balance)) : '');
  const [openingNegative, setOpeningNegative] = useState((existing?.opening_balance ?? 0) < 0);
  const [reconciling, setReconciling] = useState(false);

  const { data } = useQuery(
    async (db) =>
      existing
        ? {
            balance: await getAccountBalance(db, existing.id),
            recent: await listTransactions(db, { accountId: existing.id, limit: 10 }),
            account: await getAccount(db, existing.id),
          }
        : null,
    [existing?.id],
  );

  const chooseType = (next: AccountType) => {
    setType(next);
    // Follow the type's icon unless the user already picked a custom one.
    const typeIcons = ACCOUNT_TYPES.map((x) => x.icon);
    if (typeIcons.includes(icon)) setIcon(ACCOUNT_TYPES.find((x) => x.value === next)?.icon ?? icon);
    if (next === 'card' && !existing) setOpeningNegative(true);
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert(t('Name needed'), t('Give the account a name, e.g. "HDFC Savings".'));
      return;
    }
    const amount = opening.trim() === '' ? 0 : parse(opening);
    if (amount === null) {
      Alert.alert(t('Invalid amount'), t('Enter the starting balance as a number.'));
      return;
    }
    await saveAccount(db, existing?.id ?? null, {
      name: name.trim(),
      type,
      icon,
      color,
      opening_balance: openingNegative ? -amount : amount,
    });
    router.back();
  };

  const reconcile = async (value: string) => {
    const negative = value.trim().startsWith('-');
    const amount = parse(value.replace('-', ''));
    if (amount === null || !existing) {
      Alert.alert(t('Invalid amount'), t('Enter the balance your bank or wallet shows, for example 12500 or -3000 for a debt.'));
      return;
    }
    const actual = negative ? -amount : amount;
    const difference = await reconcileAccount(db, existing.id, actual);
    setReconciling(false);
    Alert.alert(
      t('Reconciled'),
      difference === 0
        ? t('The balance already matched.')
        : t('A balance adjustment of {amount} was recorded so the account matches.', { amount: money(difference) }),
    );
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(
      t('Delete account?'),
      t('If transactions use this account it is archived instead: hidden from new entries but kept in history.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: async () => {
            const result = await deleteOrArchiveAccount(db, existing.id);
            router.back();
            if (result === 'archived') Alert.alert(t('Archived'), t('The account has transactions, so it was archived.'));
          },
        },
      ],
    );
  };

  const reconciled = data?.account?.reconciled_date;

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? existing.name : t('New account') }} />
      {existing && data ? (
        <Card style={styles.balance}>
          <AppText variant="caption" muted>
            {t('Current balance')}
          </AppText>
          <Amount amount={data.balance} variant="title" />
          <AppText variant="caption" muted>
            {reconciled ? t('Last reconciled on {date}', { date: formatDate(reconciled) }) : t('Never reconciled')}
          </AppText>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button title={t('Reconcile')} variant="secondary" icon="checkmark-done-outline" onPress={() => setReconciling(true)} />
            </View>
            <View style={styles.flex}>
              <Button title={t('Statement')} variant="secondary" icon="document-text-outline" onPress={() => router.push(`/statement/${existing.id}`)} />
            </View>
          </View>
        </Card>
      ) : (
        <View style={styles.preview}>
          <IconBadge name={icon} color={color} size={64} />
        </View>
      )}

      <TextField label={t('Name')} value={name} onChangeText={setName} placeholder={t('e.g. HDFC Savings')} maxLength={40} autoFocus={!existing} />

      <SectionTitle>{t('Type')}</SectionTitle>
      <View style={styles.chips}>
        {ACCOUNT_TYPES.map((x) => (
          <Chip key={x.value} label={t(x.label)} icon={x.icon} selected={type === x.value} onPress={() => chooseType(x.value)} />
        ))}
      </View>

      <MoneyField
        label={type === 'card' ? t('Amount owed when you started tracking') : t('Starting balance')}
        value={opening}
        onChangeText={setOpening}
      />
      <View style={styles.chips}>
        <Chip label={t('I have this money')} selected={!openingNegative} onPress={() => setOpeningNegative(false)} />
        <Chip label={t('I owe this (debt)')} selected={openingNegative} onPress={() => setOpeningNegative(true)} />
      </View>

      <SectionTitle>{t('Look')}</SectionTitle>
      <AppearancePicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} icons={ACCOUNT_ICONS} />

      <View style={styles.actions}>
        <Button title={t('Save')} icon="checkmark" onPress={save} />
        {existing?.archived ? (
          <Button
            title={t('Unarchive')}
            variant="secondary"
            icon="arrow-undo-outline"
            onPress={async () => {
              await setAccountArchived(db, existing.id, false);
              router.back();
            }}
          />
        ) : existing ? (
          <Button title={t('Delete')} variant="danger" icon="trash-outline" onPress={remove} />
        ) : null}
      </View>

      {data?.recent.length ? (
        <>
          <SectionTitle>{t('Recent activity')}</SectionTitle>
          <Card style={styles.listCard}>
            {data.recent.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} showDate={formatDate(tx.date)} />
            ))}
          </Card>
        </>
      ) : null}

      <PromptModal
        visible={reconciling}
        title={t('Reconcile {name}', { name: existing?.name ?? '' })}
        message={t('Enter the balance your bank, card or wallet shows today. Any difference is recorded as a balance adjustment.')}
        initialValue={data ? toInput(data.balance) : ''}
        keyboardType="numbers-and-punctuation" // allows a minus sign for a card that is in debt
        submitLabel={t('Reconcile')}
        onSubmit={reconcile}
        onCancel={() => setReconciling(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  preview: { alignItems: 'center', paddingVertical: 8 },
  balance: { gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { gap: 10, marginTop: 16 },
  listCard: { paddingVertical: 4 },
});
