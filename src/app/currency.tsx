import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';

import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Divider, Icon, ListRow, Screen, TextField } from '@/core/ui';
import { formatMoney, moneyScale } from '@/core/utils/money';
import { changeCurrency } from '@/features/expenses/backup';
import { CURRENCIES } from '@/features/expenses/currencies';
import { useCurrency } from '@/features/expenses/settings';

export default function CurrencyScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const [currency] = useCurrency();
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const items = CURRENCIES.filter(
    (c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || t(c.name).toLowerCase().includes(q),
  );

  const choose = (code: string) => {
    const apply = async () => {
      await changeCurrency(db, code);
      router.back();
    };
    if (moneyScale(code) !== moneyScale(currency)) {
      Alert.alert(
        t('Change to {code}?', { code }),
        t('{code} uses a different number of decimals, so every stored amount is adjusted to keep the same value (500 stays 500). Amounts are not converted between currencies.', { code }),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('Change'), onPress: () => apply().catch(console.error) },
        ],
      );
      return;
    }
    apply().catch(console.error);
  };

  return (
    <Screen scroll={false}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.code}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <TextField placeholder={t('Search currency')} value={search} onChangeText={setSearch} autoCorrect={false} />
            <AppText variant="caption" muted>
              {t('Changing the currency only changes how amounts are shown. It does not convert existing amounts.')}
            </AppText>
          </View>
        }
        ItemSeparatorComponent={Divider}
        renderItem={({ item }) => (
          <ListRow
            title={`${item.code} · ${t(item.name)}`}
            subtitle={formatMoney(123456 * (moneyScale(item.code) / 100), item.code)}
            right={item.code === currency ? <Icon name="checkmark" color={colors.primary} /> : null}
            onPress={() => (item.code === currency ? router.back() : choose(item.code))}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  header: { gap: 10, marginBottom: 8 },
});
