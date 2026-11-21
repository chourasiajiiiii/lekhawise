import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { PALETTE, useTheme } from '@/core/theme/theme';
import {
  AppText,
  Button,
  Card,
  Chip,
  DateField,
  Divider,
  IconBadge,
  type IconName,
  ProgressBar,
  Screen,
  SectionTitle,
  Segmented,
  SwitchRow,
  TextField,
} from '@/core/ui';
import { addPeriods, daysBetween, formatDate, type ISODate, todayISO } from '@/core/utils/date';
import { AppearancePicker } from '@/features/expenses/components/AppearancePicker';
import { MoneyField, useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import { listAccounts } from '@/features/expenses/repo';
import {
  addContribution,
  deleteContribution,
  deleteGoal,
  getGoal,
  type GoalView,
  listContributions,
  saveGoal,
  setGoalArchived,
} from '@/features/expenses/repoWealth';

const GOAL_ICONS: IconName[] = [
  'flag-outline', 'airplane-outline', 'car-outline', 'home-outline', 'phone-portrait-outline', 'laptop-outline',
  'school-outline', 'heart-outline', 'gift-outline', 'shield-checkmark-outline', 'trophy-outline', 'rocket-outline',
  'diamond-outline', 'bicycle-outline', 'umbrella-outline', 'medkit-outline',
];

export default function GoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const isNew = id === 'new';
  const { data, loading } = useQuery(
    async (db) => ({
      goal: isNew ? null : await getGoal(db, id),
      contributions: isNew ? [] : await listContributions(db, id),
      accounts: await listAccounts(db),
    }),
    [id],
  );
  if (loading || !data) return <Screen>{null}</Screen>;
  if (!isNew && !data.goal) {
    return (
      <Screen>
        <AppText>{t('This goal no longer exists.')}</AppText>
      </Screen>
    );
  }
  return <GoalDetail key={id} goal={data.goal} contributions={data.contributions} accounts={data.accounts} />;
}

function GoalDetail({
  goal,
  contributions,
  accounts,
}: {
  goal: GoalView | null;
  contributions: Awaited<ReturnType<typeof listContributions>>;
  accounts: Awaited<ReturnType<typeof listAccounts>>;
}) {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { parse, toInput } = useAmountFormat();
  const [editing, setEditing] = useState(goal === null);
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? toInput(goal.target) : '');
  const [hasDate, setHasDate] = useState(goal?.target_date != null);
  const [targetDate, setTargetDate] = useState<ISODate>(goal?.target_date ?? addPeriods(todayISO(), 'yearly', 1));
  const [linked, setLinked] = useState<string | null>(goal?.account_id ?? null);
  const [icon, setIcon] = useState<IconName>(goal?.icon ?? 'flag-outline');
  const [color, setColor] = useState(goal?.color ?? PALETTE[5]);
  const [moveType, setMoveType] = useState<'add' | 'withdraw'>('add');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveDate, setMoveDate] = useState<ISODate>(todayISO());

  const save = async () => {
    const value = parse(target);
    if (!value) {
      Alert.alert(t('Check the details'), t('Enter a target amount.'));
      return;
    }
    try {
      const id = await saveGoal(db, goal?.id ?? null, {
        name,
        icon,
        color,
        target: value,
        target_date: hasDate ? targetDate : null,
        account_id: linked,
      });
      if (!goal) router.replace(`/goals/${id}`);
      else setEditing(false);
    } catch (e) {
      Alert.alert(t('Check the details'), e instanceof Error ? t(e.message) : '');
    }
  };

  const move = async () => {
    const value = parse(moveAmount);
    if (!value || !goal) {
      Alert.alert(t('Check the details'), t('Enter an amount greater than zero.'));
      return;
    }
    await addContribution(db, goal.id, { amount: moveType === 'add' ? value : -value, date: moveDate, note: '' });
    setMoveAmount('');
  };

  if (editing || !goal) {
    return (
      <Screen>
        <Stack.Screen options={{ title: goal ? t('Edit goal') : t('New goal') }} />
        <View style={styles.preview}>
          <IconBadge name={icon} color={color} size={64} />
        </View>
        <TextField label={t('Name')} value={name} onChangeText={setName} placeholder={t('e.g. Emergency fund')} maxLength={40} autoFocus={!goal} />
        <MoneyField label={t('Target amount')} value={target} onChangeText={setTarget} />
        <SwitchRow title={t('Target date')} value={hasDate} onChange={setHasDate} />
        {hasDate ? <DateField value={targetDate} onChange={setTargetDate} /> : null}
        <SectionTitle>{t('How progress is counted')}</SectionTitle>
        <View style={styles.chips}>
          <Chip label={t('Money I set aside here')} selected={linked === null} onPress={() => setLinked(null)} />
          {accounts.map((a) => (
            <Chip key={a.id} label={t('Balance of {name}', { name: a.name })} icon={a.icon} color={a.color} selected={linked === a.id} onPress={() => setLinked(a.id)} />
          ))}
        </View>
        <SectionTitle>{t('Look')}</SectionTitle>
        <AppearancePicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} icons={GOAL_ICONS} />
        <View style={styles.gap}>
          <Button title={t('Save')} icon="checkmark" onPress={save} />
          {goal ? <Button title={t('Cancel')} variant="ghost" onPress={() => setEditing(false)} /> : null}
        </View>
      </Screen>
    );
  }

  const remaining = Math.max(0, goal.target - goal.saved);
  const monthsLeft = goal.target_date ? Math.max(1, Math.ceil(daysBetween(todayISO(), goal.target_date) / 30.44)) : null;
  const perMonth = monthsLeft && remaining > 0 ? Math.ceil(remaining / monthsLeft) : 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: goal.name }} />
      <Card style={styles.gap}>
        <View style={styles.row}>
          <IconBadge name={goal.icon} color={goal.color} size={48} />
          <View style={styles.flex}>
            <AppText variant="title">{money(goal.saved)}</AppText>
            <AppText variant="caption" muted>
              {t('of {target}', { target: money(goal.target) })}
            </AppText>
          </View>
        </View>
        <ProgressBar value={goal.saved / goal.target} color={goal.color} height={10} />
        {remaining === 0 ? (
          <AppText variant="label" color={colors.income}>
            {t('Goal reached!')}
          </AppText>
        ) : (
          <AppText>
            {t('{amount} to go', { amount: money(remaining) })}
            {goal.target_date ? ` · ${t('by {date}', { date: formatDate(goal.target_date) })}` : ''}
          </AppText>
        )}
        {perMonth > 0 ? (
          <AppText variant="caption" muted>
            {t('Save about {amount} a month to get there on time.', { amount: money(perMonth) })}
          </AppText>
        ) : null}
        {goal.account_name ? (
          <AppText variant="caption" muted>
            {t('Progress follows the balance of {name}.', { name: goal.account_name })}
          </AppText>
        ) : null}
      </Card>

      {!goal.account_id ? (
        <Card style={styles.gap}>
          <Segmented
            options={[
              { value: 'add', label: t('Add money') },
              { value: 'withdraw', label: t('Take money out') },
            ]}
            value={moveType}
            onChange={setMoveType}
          />
          <MoneyField value={moveAmount} onChangeText={setMoveAmount} accessibilityLabel={t('Amount')} />
          <DateField value={moveDate} onChange={setMoveDate} />
          <Button title={moveType === 'add' ? t('Add to goal') : t('Take out of goal')} icon="checkmark" onPress={move} />
          <AppText variant="caption" muted>
            {t('This only tracks money set aside for the goal. Account balances do not change.')}
          </AppText>
        </Card>
      ) : null}

      <View style={styles.gap}>
        <Button title={t('Edit goal')} variant="secondary" icon="create-outline" onPress={() => setEditing(true)} />
        <Button
          title={goal.archived ? t('Move back to active goals') : t('Mark as completed')}
          variant="secondary"
          icon={goal.archived ? 'arrow-undo-outline' : 'trophy-outline'}
          onPress={() => setGoalArchived(db, goal.id, !goal.archived)}
        />
        <Button
          title={t('Delete goal')}
          variant="danger"
          icon="trash-outline"
          onPress={() =>
            Alert.alert(t('Delete this goal?'), t('Its history is deleted too. Account balances are not affected.'), [
              { text: t('Cancel'), style: 'cancel' },
              {
                text: t('Delete'),
                style: 'destructive',
                onPress: async () => {
                  await deleteGoal(db, goal.id);
                  router.back();
                },
              },
            ])
          }
        />
      </View>

      {contributions.length ? (
        <>
          <SectionTitle>{t('History')}</SectionTitle>
          <Card style={styles.listCard}>
            {contributions.map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.historyRow}>
                  <AppText style={styles.flex}>{formatDate(c.date)}</AppText>
                  <AppText variant="label" color={c.amount > 0 ? colors.income : colors.expense}>
                    {c.amount > 0 ? '+' : '−'}
                    {money(Math.abs(c.amount))}
                  </AppText>
                  <Button
                    title={t('Remove')}
                    variant="ghost"
                    onPress={() =>
                      Alert.alert(t('Remove this entry?'), undefined, [
                        { text: t('Cancel'), style: 'cancel' },
                        { text: t('Remove'), style: 'destructive', onPress: () => deleteContribution(db, c.id) },
                      ])
                    }
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { alignItems: 'center', paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  listCard: { paddingVertical: 4 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
});
