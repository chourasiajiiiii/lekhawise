import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { AppText, Button, Card, EmptyState, IconBadge, ProgressBar, Screen, SectionTitle } from '@/core/ui';
import { formatDate } from '@/core/utils/date';
import { useMoney } from '@/features/expenses/components/Money';
import { type GoalView, listGoals } from '@/features/expenses/repoWealth';

export default function GoalsScreen() {
  const t = useT();
  const { data: goals = [] } = useQuery((db) => listGoals(db, true), []);
  const active = goals.filter((g) => !g.archived);
  const done = goals.filter((g) => g.archived);
  return (
    <Screen>
      <Button title={t('New goal')} icon="add" variant="secondary" onPress={() => router.push('/goals/new')} />
      {goals.length === 0 ? (
        <EmptyState icon="flag-outline" title={t('No goals yet')} message={t('Save towards a trip, a phone, an emergency fund or a down payment.')} />
      ) : null}
      {active.map((g) => (
        <GoalCard key={g.id} goal={g} />
      ))}
      {done.length ? <SectionTitle>{t('Completed or archived')}</SectionTitle> : null}
      {done.map((g) => (
        <GoalCard key={g.id} goal={g} />
      ))}
    </Screen>
  );
}

function GoalCard({ goal }: { goal: GoalView }) {
  const t = useT();
  const money = useMoney();
  const pct = Math.min(100, Math.round((goal.saved / goal.target) * 100));
  return (
    <Pressable onPress={() => router.push(`/goals/${goal.id}`)}>
      <Card style={[styles.card, goal.archived ? styles.faded : null]}>
        <View style={styles.row}>
          <IconBadge name={goal.icon} color={goal.color} size={40} />
          <View style={styles.flex}>
            <AppText variant="label" numberOfLines={1}>
              {goal.name}
            </AppText>
            <AppText variant="caption" muted>
              {goal.target_date ? t('by {date}', { date: formatDate(goal.target_date) }) : t('no deadline')}
              {goal.account_name ? ` · ${goal.account_name}` : ''}
            </AppText>
          </View>
          <AppText variant="heading">{pct}%</AppText>
        </View>
        <ProgressBar value={goal.saved / goal.target} color={goal.color} height={8} />
        <AppText variant="caption" muted>
          {t('{saved} of {target}', { saved: money(goal.saved), target: money(goal.target) })}
        </AppText>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: 8 },
  faded: { opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
