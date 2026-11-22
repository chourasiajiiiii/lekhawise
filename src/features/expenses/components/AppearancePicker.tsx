import { Pressable, StyleSheet, View } from 'react-native';

import { t } from '@/core/i18n/locale';
import { PALETTE, PALETTE_NAMES, useTheme } from '@/core/theme/theme';
import { Glyph, type IconName } from '@/core/ui';

import { ICON_CHOICES } from '../defaults';

/** Icon grid + colour swatches, shared by the category and account editors. */
export function AppearancePicker({
  icon,
  color,
  onIcon,
  onColor,
  icons = ICON_CHOICES,
}: {
  icon: IconName;
  color: string;
  onIcon: (icon: IconName) => void;
  onColor: (color: string) => void;
  icons?: IconName[];
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {PALETTE.map((c) => (
          <Pressable
            key={c}
            accessibilityLabel={t('{name} colour', { name: t(PALETTE_NAMES[c] ?? 'Colour') })}
            accessibilityState={{ selected: c === color }}
            onPress={() => onColor(c)}
            style={[styles.swatch, { backgroundColor: c, borderColor: c === color ? colors.text : 'transparent' }]}
          />
        ))}
      </View>
      <View style={styles.grid}>
        {icons.map((name) => {
          const selected = name === icon;
          return (
            <Pressable
              key={name}
              accessibilityLabel={name.replace(/-outline$/, '').replace(/-/g, ' ')}
              accessibilityState={{ selected }}
              onPress={() => onIcon(name)}
              style={[
                styles.icon,
                { backgroundColor: selected ? `${color}33` : colors.surface, borderColor: selected ? color : colors.border },
              ]}
            >
              <Glyph name={name} size={22} color={selected ? color : colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
