import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { t } from '../i18n/locale';
import { useTheme } from '../theme/theme';
import { AppText } from '../ui/primitives';
import { PIN_MAX_LENGTH } from './pin';

type PinPadProps = {
  value: string;
  onChange: (value: string) => void;
  /** Number of dots to show; defaults to the digits typed so far (up to the maximum). */
  length?: number | null;
  disabled?: boolean;
  /** Shown in the bottom-left key, e.g. a fingerprint button. */
  extraKey?: { icon: 'finger-print' | 'scan-outline'; label: string; onPress: () => void };
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Numeric keypad with PIN dots. Large keys, as on the phone's own lock screen. */
export function PinPad({ value, onChange, length, disabled, extraKey }: PinPadProps) {
  const { colors } = useTheme();
  const dots = length ?? Math.max(4, value.length);
  const press = (digit: string) => {
    if (disabled || value.length >= (length ?? PIN_MAX_LENGTH)) return;
    onChange(value + digit);
  };

  const key = (digit: string) => (
    <Pressable
      key={digit}
      accessibilityRole="button"
      accessibilityLabel={digit}
      disabled={disabled}
      onPress={() => press(digit)}
      style={({ pressed }) => [styles.key, { backgroundColor: pressed ? colors.border : colors.surfaceAlt, opacity: disabled ? 0.4 : 1 }]}
    >
      <AppText variant="title">{digit}</AppText>
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.dots} accessibilityLabel={t('{count} digits entered', { count: value.length })}>
        {Array.from({ length: dots }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, { borderColor: colors.text, backgroundColor: i < value.length ? colors.text : 'transparent' }]}
          />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map(key)}
        {extraKey ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={extraKey.label}
            onPress={extraKey.onPress}
            style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Ionicons name={extraKey.icon} size={30} color={colors.primary} />
          </Pressable>
        ) : (
          <View style={styles.key} />
        )}
        {key('0')}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Delete digit')}
          onPress={() => onChange(value.slice(0, -1))}
          style={({ pressed }) => [styles.key, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="backspace-outline" size={28} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 28 },
  dots: { flexDirection: 'row', gap: 16, minHeight: 16 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  grid: { width: 264, flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  key: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
