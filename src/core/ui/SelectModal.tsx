import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n/locale';
import { useTheme } from '../theme/theme';
import { Button } from './controls';
import { AppText, Icon, IconBadge, type IconName } from './primitives';

export type SelectOption = {
  value: string;
  label: string;
  subtitle?: string;
  icon?: IconName;
  color?: string;
  /** Indents the row, e.g. for subcategories. */
  indent?: boolean;
};

type SelectModalProps = {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selected?: string | null;
  onSelect: (value: string) => void;
  onCancel: () => void;
};

/** A bottom sheet with a list to pick one item from (categories, accounts, periods...). */
export function SelectModal({ visible, title, options, selected, onSelect, onCancel }: SelectModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel={t('Close')} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: 16 + insets.bottom }]}>
          <AppText variant="heading" style={styles.title}>
            {title}
          </AppText>
          {/* Option lists are short (categories, accounts, columns), so every row is rendered at once. */}
          <ScrollView style={styles.list}>
            {options.map((item) => (
              <Pressable
                key={item.value}
                accessibilityRole="button"
                accessibilityState={{ selected: item.value === selected }}
                onPress={() => onSelect(item.value)}
                style={({ pressed }) => [styles.row, item.indent && styles.indent, { opacity: pressed ? 0.6 : 1 }]}
              >
                {item.icon ? <IconBadge name={item.icon} color={item.color ?? colors.primary} size={34} /> : null}
                <View style={styles.flex}>
                  <AppText numberOfLines={1}>{item.label}</AppText>
                  {item.subtitle ? (
                    <AppText variant="caption" muted numberOfLines={1}>
                      {item.subtitle}
                    </AppText>
                  ) : null}
                </View>
                {item.value === selected ? <Icon name="checkmark" color={colors.primary} /> : null}
              </Pressable>
            ))}
          </ScrollView>
          <Button title={t('Cancel')} variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 12, maxHeight: '80%' },
  title: { paddingHorizontal: 4 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, minHeight: 52 },
  indent: { paddingLeft: 28 },
  flex: { flex: 1 },
});
