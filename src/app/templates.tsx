import { useSQLiteContext } from 'expo-sqlite';
import { Alert, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Card, Divider, EmptyState, IconBadge, type IconName, ListRow, Screen } from '@/core/ui';
import { Amount } from '@/features/expenses/components/Money';
import { deleteTemplate, listTemplates } from '@/features/expenses/repoExtras';

/** Saved transactions that fill the form in one tap. */
export default function TemplatesScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const { data: templates = [] } = useQuery((db) => listTemplates(db), []);

  return (
    <Screen>
      <AppText variant="caption" muted>
        {t('Create a template from the transaction form with "Save as template". Templates appear at the top of the form when adding a transaction.')}
      </AppText>
      {templates.length ? (
        <Card style={styles.listCard}>
          {templates.map((tpl, i) => (
            <View key={tpl.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                left={
                  <IconBadge
                    name={(tpl.type === 'transfer' ? 'swap-horizontal' : (tpl.category_icon ?? 'flash-outline')) as IconName}
                    color={tpl.category_color ?? colors.primary}
                    size={36}
                  />
                }
                title={tpl.name}
                subtitle={[tpl.category_name, tpl.account_name, tpl.note].filter(Boolean).join(' · ')}
                right={tpl.amount ? <Amount amount={tpl.amount} type={tpl.type} /> : <AppText muted>{t('Any amount')}</AppText>}
                onPress={() =>
                  Alert.alert(t('Delete template "{name}"?', { name: tpl.name }), undefined, [
                    { text: t('Cancel'), style: 'cancel' },
                    { text: t('Delete'), style: 'destructive', onPress: () => deleteTemplate(db, tpl.id) },
                  ])
                }
              />
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState icon="flash-outline" title={t('No templates yet')} message={t('Good for things you enter often: tea, fuel, the weekly vegetable shop.')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: 4 },
});
