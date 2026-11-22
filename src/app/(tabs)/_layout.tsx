import { Tabs } from 'expo-router/js-tabs';
import { type ColorValue, Text } from 'react-native';

import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { Glyph, type IconName } from '@/core/ui';

function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Glyph name={name} color={typeof color === 'string' ? color : undefined} size={size} />;
  };
}

/** Labels shrink rather than being cut off ("Transac…") on small phones with large text. */
function tabLabel(text: string) {
  return function TabLabel({ color }: { color: ColorValue }) {
    return (
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ color: typeof color === 'string' ? color : undefined, fontSize: 11, paddingHorizontal: 2 }}
      >
        {text}
      </Text>
    );
  };
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const t = useT();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('Home'), tabBarLabel: tabLabel(t('Home')), headerTitle: 'LekhaWise', tabBarIcon: tabIcon('home-outline') }} />
      <Tabs.Screen name="transactions" options={{ title: t('Transactions'), tabBarLabel: tabLabel(t('Transactions')), tabBarIcon: tabIcon('list-outline') }} />
      <Tabs.Screen name="budgets" options={{ title: t('Budgets'), tabBarLabel: tabLabel(t('Budgets')), tabBarIcon: tabIcon('pie-chart-outline') }} />
      <Tabs.Screen name="reports" options={{ title: t('Reports'), tabBarLabel: tabLabel(t('Reports')), tabBarIcon: tabIcon('bar-chart-outline') }} />
      <Tabs.Screen name="settings" options={{ title: t('More'), tabBarLabel: tabLabel(t('More')), tabBarIcon: tabIcon('grid-outline') }} />
    </Tabs>
  );
}
