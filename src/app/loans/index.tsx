import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, EmptyState, IconBadge, ListRow, ProgressBar, Screen, SectionTitle } from '@/core/ui';
import { useMoney } from '@/features/expenses/components/Money';
import { listLoans, type LoanView } from '@/features/expenses/repoLoans';

export default function LoansScreen() {
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { data: loans = [] } = useQuery((db) => listLoans(db, true), []);
  const open = loans.filter((l) => !l.archived);
  const owe = open.filter((l) => l.direction === 'borrowed');
  const owed = open.filter((l) => l.direction === 'lent');
  const closed = loans.filter((l) => l.archived);
  const sum = (list: LoanView[]) => list.reduce((s, l) => s + l.outstanding, 0);

  return (
    <Screen>
      <View style={styles.row}>
        <Card style={[styles.flex, styles.gapSmall]}>
          <AppText variant="caption" muted>
            {t('You owe')}
          </AppText>
          <AppText variant="heading" color={colors.expense} numberOfLines={1} adjustsFontSizeToFit>
            {money(sum(owe))}
          </AppText>
        </Card>
        <Card style={[styles.flex, styles.gapSmall]}>
          <AppText variant="caption" muted>
            {t('Owed to you')}
          </AppText>
          <AppText variant="heading" color={colors.income} numberOfLines={1} adjustsFontSizeToFit>
            {money(sum(owed))}
          </AppText>
        </Card>
      </View>
      <Button title={t('Add a loan or debt')} icon="add" variant="secondary" onPress={() => router.push('/loans/new')} />
      {loans.length === 0 ? (
        <EmptyState
          icon="swap-vertical-outline"
          title={t('No loans or debts')}
          message={t('Track a home or car loan with its EMI, or money you lent to or borrowed from someone.')}
        />
      ) : null}
      <LoanGroup title={t('You owe')} loans={owe} />
      <LoanGroup title={t('Owed to you')} loans={owed} />
      <LoanGroup title={t('Closed')} loans={closed} />
    </Screen>
  );
}

function LoanGroup({ title, loans }: { title: string; loans: LoanView[] }) {
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  if (!loans.length) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card style={styles.listCard}>
        {loans.map((loan, i) => {
          const repaid = loan.principal > 0 ? 1 - loan.outstanding / loan.principal : 0;
          return (
            <View key={loan.account_id}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                left={<IconBadge name={loan.icon} color={loan.color} size={36} />}
                title={loan.name}
                subtitle={
                  loan.emi
                    ? t('EMI {amount}', { amount: money(loan.emi) })
                    : loan.direction === 'lent'
                      ? t('Money lent')
                      : t('Money borrowed')
                }
                right={
                  <AppText variant="label" color={loan.direction === 'borrowed' ? colors.expense : colors.income}>
                    {money(loan.outstanding)}
                  </AppText>
                }
                chevron
                onPress={() => router.push(`/loans/${loan.account_id}`)}
              />
              {loan.principal > 0 && !loan.archived ? (
                <View style={styles.progress}>
                  <ProgressBar value={repaid} color={loan.color} height={5} />
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12 },
  gapSmall: { gap: 4 },
  listCard: { paddingVertical: 4 },
  progress: { paddingBottom: 10, paddingLeft: 48 },
});
