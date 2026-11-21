import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, EmptyState, IconBadge, ListRow, Screen, SectionTitle } from '@/core/ui';
import { daysBetween, formatDate, todayISO } from '@/core/utils/date';
import { Amount } from '@/features/expenses/components/Money';
import { ruleTitle } from '@/features/expenses/labels';
import { listRecurring, type RecurringView } from '@/features/expenses/repo';
import { FREQUENCIES } from '@/features/expenses/types';

export default function RecurringScreen() {
  const t = useT();
  const { data: rules = [] } = useQuery((db) => listRecurring(db), []);
  const bills = rules.filter((r) => r.active && r.mode === 'remind');
  const automatic = rules.filter((r) => r.active && r.mode === 'auto');
  const inactive = rules.filter((r) => !r.active);

  return (
    <Screen>
      <AppText variant="caption" muted>
        {t('Automatic entries are added when you open the app on or after their date. Bills wait until you mark them as paid. To create either, add a transaction and choose how often it repeats.')}
      </AppText>
      <Button title={t('New recurring transaction or bill')} icon="add" variant="secondary" onPress={() => router.push('/transaction/new')} />
      {rules.length === 0 ? (
        <EmptyState icon="repeat-outline" title={t('No recurring transactions')} message={t('Rent, salary, subscriptions and EMIs are good candidates.')} />
      ) : null}
      <RuleGroup title={t('Bills')} rules={bills} />
      <RuleGroup title={t('Added automatically')} rules={automatic} />
      <RuleGroup title={t('Paused or finished')} rules={inactive} />
    </Screen>
  );
}

function RuleGroup({ title, rules }: { title: string; rules: RecurringView[] }) {
  if (!rules.length) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card style={styles.listCard}>
        {rules.map((rule, i) => (
          <View key={rule.id}>
            {i > 0 ? <Divider /> : null}
            <RuleRow rule={rule} />
          </View>
        ))}
      </Card>
    </>
  );
}

function RuleRow({ rule }: { rule: RecurringView }) {
  const { colors } = useTheme();
  const t = useT();
  const frequency = t(FREQUENCIES.find((f) => f.value === rule.frequency)?.label ?? '');
  const days = daysBetween(todayISO(), rule.next_date);
  let subtitle: string;
  if (!rule.active) {
    subtitle = rule.end_date && rule.next_date > rule.end_date ? t('Finished') : t('Paused');
  } else if (rule.mode === 'remind') {
    subtitle =
      days < 0
        ? tPlural(-days, '{frequency} · overdue by {count} day', '{frequency} · overdue by {count} days', { frequency })
        : t('{frequency} · due {date}', { frequency, date: formatDate(rule.next_date) });
  } else {
    subtitle = t('{frequency} · next {date}', { frequency, date: formatDate(rule.next_date) });
  }
  return (
    <ListRow
      onPress={() => router.push(`/recurring/${rule.id}`)}
      left={
        <IconBadge
          name={rule.type === 'transfer' ? 'swap-horizontal' : (rule.category_icon ?? 'repeat-outline')}
          color={!rule.active ? colors.textMuted : rule.mode === 'remind' && days < 0 ? colors.danger : (rule.category_color ?? colors.primary)}
          size={36}
        />
      }
      title={ruleTitle(rule, t)}
      subtitle={subtitle}
      right={<Amount amount={rule.amount} type={rule.type} />}
      chevron
    />
  );
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: 4 },
});
