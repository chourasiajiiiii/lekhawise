import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Chip, DateField, Divider, Screen, SectionTitle, SwitchRow, TextField } from '@/core/ui';
import { formatDate, type ISODate, todayISO } from '@/core/utils/date';
import { MoneyField, useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import {
  deleteHolding,
  deleteHoldingValue,
  getHolding,
  type HoldingView,
  listHoldingValues,
  markHoldingSold,
  saveHolding,
  updateHoldingValue,
} from '@/features/expenses/repoWealth';
import { ASSET_TYPES, type HoldingKind, INVESTMENT_TYPES } from '@/features/expenses/types';

/** Route: /holding/new?kind=investment|asset, or /holding/<id>. */
export default function HoldingScreen() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: HoldingKind }>();
  const t = useT();
  const isNew = id === 'new';
  const { data, loading } = useQuery(
    async (db) => ({ holding: isNew ? null : await getHolding(db, id), values: isNew ? [] : await listHoldingValues(db, id) }),
    [id],
  );
  if (loading || !data) return <Screen>{null}</Screen>;
  if (!isNew && !data.holding) {
    return (
      <Screen>
        <AppText>{t('This item no longer exists.')}</AppText>
      </Screen>
    );
  }
  return <HoldingDetail key={id} holding={data.holding} values={data.values} kind={data.holding?.kind ?? kind ?? 'investment'} />;
}

function HoldingDetail({
  holding,
  values,
  kind,
}: {
  holding: HoldingView | null;
  values: Awaited<ReturnType<typeof listHoldingValues>>;
  kind: HoldingKind;
}) {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { parse, toInput } = useAmountFormat();
  const types = kind === 'investment' ? INVESTMENT_TYPES : ASSET_TYPES;
  const [editing, setEditing] = useState(holding === null);
  const [name, setName] = useState(holding?.name ?? '');
  const [subtype, setSubtype] = useState(holding?.subtype ?? types[0].value);
  const [invested, setInvested] = useState(holding?.invested ? toInput(holding.invested) : '');
  const [quantity, setQuantity] = useState(holding?.quantity ?? '');
  const [note, setNote] = useState(holding?.note ?? '');
  const [hasPurchaseDate, setHasPurchaseDate] = useState(holding?.purchase_date != null);
  const [purchaseDate, setPurchaseDate] = useState<ISODate>(holding?.purchase_date ?? todayISO());
  const [valueText, setValueText] = useState('');
  const [valueDate, setValueDate] = useState<ISODate>(todayISO());

  const save = async () => {
    const investedValue = invested.trim() ? parse(invested) : 0;
    const current = valueText.trim() ? parse(valueText) : null;
    if (investedValue === null || (valueText.trim() && current === null)) {
      Alert.alert(t('Check the details'), t('Enter amounts as numbers.'));
      return;
    }
    try {
      const id = await saveHolding(
        db,
        holding?.id ?? null,
        { kind, subtype, name, invested: investedValue, quantity, note, purchase_date: hasPurchaseDate ? purchaseDate : null },
        current !== null ? { value: current, date: valueDate } : !holding ? { value: investedValue, date: hasPurchaseDate ? purchaseDate : todayISO() } : undefined,
      );
      if (!holding) router.replace(`/holding/${id}`);
      else setEditing(false);
      setValueText('');
    } catch (e) {
      Alert.alert(t('Check the details'), e instanceof Error ? t(e.message) : '');
    }
  };

  const recordValue = async () => {
    const value = parse(valueText);
    if (value === null || !holding) {
      Alert.alert(t('Check the details'), t('Enter the current value.'));
      return;
    }
    await updateHoldingValue(db, holding.id, value, valueDate);
    setValueText('');
  };

  if (editing || !holding) {
    return (
      <Screen>
        <Stack.Screen options={{ title: holding ? t('Edit') : kind === 'investment' ? t('Add an investment') : t('Add an asset') }} />
        <TextField
          label={t('Name')}
          value={name}
          onChangeText={setName}
          placeholder={kind === 'investment' ? t('e.g. Nifty 50 index fund') : t('e.g. Flat in Pune')}
          maxLength={60}
          autoFocus={!holding}
        />
        <View style={styles.chips}>
          {types.map((x) => (
            <Chip key={x.value} label={t(x.label)} icon={x.icon} selected={subtype === x.value} onPress={() => setSubtype(x.value)} />
          ))}
        </View>
        <MoneyField label={kind === 'investment' ? t('Amount invested') : t('Purchase price')} value={invested} onChangeText={setInvested} />
        {!holding ? (
          <MoneyField label={t('Current value (leave empty if the same)')} value={valueText} onChangeText={setValueText} />
        ) : null}
        <TextField
          label={kind === 'investment' ? t('Units, grams or quantity') : t('Details')}
          value={quantity}
          onChangeText={setQuantity}
          placeholder={kind === 'investment' ? t('e.g. 120.5 units') : t('e.g. 2 BHK, 950 sq ft')}
          maxLength={60}
        />
        <SwitchRow title={t('Purchase date')} value={hasPurchaseDate} onChange={setHasPurchaseDate} />
        {hasPurchaseDate ? <DateField value={purchaseDate} onChange={setPurchaseDate} /> : null}
        <TextField label={t('Note')} value={note} onChangeText={setNote} placeholder={t('Optional')} maxLength={200} />
        <Button title={t('Save')} icon="checkmark" onPress={save} />
        {holding ? <Button title={t('Cancel')} variant="ghost" onPress={() => setEditing(false)} /> : null}
      </Screen>
    );
  }

  const gain = holding.value - holding.invested;
  return (
    <Screen>
      <Stack.Screen options={{ title: holding.name }} />
      <Card style={styles.gap}>
        <AppText variant="caption" muted>
          {holding.value_date ? t('Value as of {date}', { date: formatDate(holding.value_date) }) : t('Current value')}
        </AppText>
        <AppText variant="title">{money(holding.value)}</AppText>
        {holding.invested > 0 ? (
          <AppText color={gain >= 0 ? colors.income : colors.expense}>
            {gain >= 0 ? '+' : '−'}
            {money(Math.abs(gain))} ({Math.round((gain / holding.invested) * 100)}%) ·{' '}
            {t('{amount} invested', { amount: money(holding.invested) })}
          </AppText>
        ) : null}
        {holding.quantity ? <AppText muted>{holding.quantity}</AppText> : null}
        {holding.note ? <AppText muted>{holding.note}</AppText> : null}
      </Card>

      {!holding.archived ? (
        <Card style={styles.gap}>
          <AppText variant="label">{t('Update the value')}</AppText>
          <MoneyField value={valueText} onChangeText={setValueText} accessibilityLabel={t('New value')} />
          <DateField value={valueDate} onChange={setValueDate} />
          <Button title={t('Save value')} icon="checkmark" onPress={recordValue} />
        </Card>
      ) : null}

      <View style={styles.gap}>
        <Button title={t('Edit details')} variant="secondary" icon="create-outline" onPress={() => setEditing(true)} />
        {!holding.archived ? (
          <Button
            title={t('Mark as sold')}
            variant="secondary"
            icon="archive-outline"
            onPress={() =>
              Alert.alert(t('Mark as sold?'), t('Its value becomes zero from today and it moves to the sold list. Record the money you received as income or a transfer if you want it in an account.'), [
                { text: t('Cancel'), style: 'cancel' },
                { text: t('Mark as sold'), onPress: () => markHoldingSold(db, holding.id) },
              ])
            }
          />
        ) : null}
        <Button
          title={t('Delete')}
          variant="danger"
          icon="trash-outline"
          onPress={() =>
            Alert.alert(t('Delete {name}?', { name: holding.name }), t('Its value history is deleted too.'), [
              { text: t('Cancel'), style: 'cancel' },
              {
                text: t('Delete'),
                style: 'destructive',
                onPress: async () => {
                  await deleteHolding(db, holding.id);
                  router.back();
                },
              },
            ])
          }
        />
      </View>

      <SectionTitle>{t('Value history')}</SectionTitle>
      <Card style={styles.listCard}>
        {values.map((v, i) => (
          <View key={v.id}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.historyRow}>
              <AppText style={styles.flex}>{formatDate(v.date)}</AppText>
              <AppText variant="label">{money(v.value)}</AppText>
              {values.length > 1 ? (
                <Button title={t('Remove')} variant="ghost" onPress={() => deleteHoldingValue(db, v.id)} />
              ) : null}
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  listCard: { paddingVertical: 4 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
});
