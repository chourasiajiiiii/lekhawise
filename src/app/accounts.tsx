import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, IconBadge, ListRow, Screen } from '@/core/ui';
import { formatDate } from '@/core/utils/date';
import { useMoney } from '@/features/expenses/components/Money';
import { listAccounts } from '@/features/expenses/repo';
import { ACCOUNT_TYPES, type AccountWithBalance } from '@/features/expenses/types';

export default function AccountsScreen() {
  const t = useT();
  const money = useMoney();
  const { data: accounts = [] } = useQuery((db) => listAccounts(db, { includeArchived: true }), []);
  const active = accounts.filter((a) => a.archived === 0);
  const archived = accounts.filter((a) => a.archived === 1);
  const total = active.reduce((sum, a) => sum + a.balance, 0);

  return (
    <Screen>
      <Card style={styles.total}>
        <AppText variant="caption" muted>
          {t('Total balance')}
        </AppText>
        <AppText variant="title">{money(total)}</AppText>
        <AppText variant="caption" muted>
          {t('Loans and money lent are under More, Loans & debts.')}
        </AppText>
      </Card>
      <Button title={t('New account')} icon="add" variant="secondary" onPress={() => router.push('/account/new')} />
      <Card style={styles.listCard}>
        {active.map((a, i) => (
          <AccountItem key={a.id} account={a} divider={i > 0} />
        ))}
      </Card>
      {archived.length ? (
        <>
          <AppText variant="caption" muted>
            {t('Archived')}
          </AppText>
          <Card style={styles.listCard}>
            {archived.map((a, i) => (
              <AccountItem key={a.id} account={a} divider={i > 0} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function AccountItem({ account, divider }: { account: AccountWithBalance; divider: boolean }) {
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const typeLabel = t(ACCOUNT_TYPES.find((x) => x.value === account.type)?.label ?? '');
  return (
    <View>
      {divider ? <Divider /> : null}
      <ListRow
        left={<IconBadge name={account.icon} color={account.color} size={36} />}
        title={account.name}
        subtitle={account.reconciled_date ? `${typeLabel} · ${t('reconciled {date}', { date: formatDate(account.reconciled_date) })}` : typeLabel}
        right={
          <AppText variant="label" color={account.balance < 0 ? colors.expense : colors.text}>
            {money(account.balance)}
          </AppText>
        }
        chevron
        onPress={() => router.push(`/account/${account.id}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  total: { gap: 4 },
  listCard: { paddingVertical: 4 },
});
