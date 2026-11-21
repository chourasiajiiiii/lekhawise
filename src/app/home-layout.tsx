import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, Icon, Screen } from '@/core/ui';
import { HOME_CARDS, HOME_CARDS_SETTING_KEY, useHomeCards } from '@/features/expenses/settings';
import { removeSetting } from '@/core/settings/settings';

/** Show, hide and reorder the cards on the home screen. */
export default function HomeLayoutScreen() {
  const { colors } = useTheme();
  const t = useT();
  const [cards, setCards] = useHomeCards();

  const move = (index: number, delta: number) => {
    const next = [...cards];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setCards(next);
  };

  return (
    <Screen>
      <AppText variant="caption" muted>
        {t('Switch cards on or off and use the arrows to change their order.')}
      </AppText>
      <Card style={styles.listCard}>
        {cards.map((card, i) => {
          const label = t(HOME_CARDS.find((c) => c.id === card.id)?.label ?? card.id);
          return (
            <View key={card.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <Switch
                  value={card.visible}
                  onValueChange={(visible) => setCards(cards.map((c) => (c.id === card.id ? { ...c, visible } : c)))}
                  accessibilityLabel={label}
                  trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
                />
                <AppText style={styles.flex} muted={!card.visible}>
                  {label}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('Move {name} up', { name: label })}
                  disabled={i === 0}
                  onPress={() => move(i, -1)}
                  hitSlop={6}
                  style={styles.arrow}
                >
                  <Icon name="chevron-up" color={i === 0 ? colors.border : colors.text} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('Move {name} down', { name: label })}
                  disabled={i === cards.length - 1}
                  onPress={() => move(i, 1)}
                  hitSlop={6}
                  style={styles.arrow}
                >
                  <Icon name="chevron-down" color={i === cards.length - 1 ? colors.border : colors.text} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </Card>
      <Button title={t('Reset to default')} variant="ghost" onPress={() => removeSetting(HOME_CARDS_SETTING_KEY)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listCard: { paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  arrow: { padding: 6 },
});
