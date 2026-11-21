import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, View } from 'react-native';

import { notifyDataChanged } from '@/core/db/events';
import { useLocale, useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Card, Divider, Icon, ListRow, Screen } from '@/core/ui';
import { relabelDefaults } from '@/features/expenses/schema';
import { LANGUAGES, setLanguage } from '@/features/expenses/settings';

export default function LanguageScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const { language } = useLocale();
  return (
    <Screen>
      <Card style={styles.listCard}>
        {LANGUAGES.map((l, i) => (
          <View key={l.code}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              title={l.native}
              subtitle={l.name}
              right={language === l.code ? <Icon name="checkmark" color={colors.primary} /> : null}
              onPress={async () => {
                setLanguage(l.code);
                await relabelDefaults(db);
                notifyDataChanged();
                router.back();
              }}
            />
          </View>
        ))}
      </Card>
      <AppText variant="caption" muted>
        {t('Built-in category and account names change language too. Names you typed or changed yourself stay as they are.')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: 4 },
});
