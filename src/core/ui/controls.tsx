import type { ReactNode, Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  View,
} from 'react-native';

import { useTheme } from '../theme/theme';
import { AppText, Glyph, type IconName } from './primitives';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ title, onPress, variant = 'primary', icon, disabled, loading }: ButtonProps) {
  const { colors } = useTheme();
  const bg = {
    primary: colors.primary,
    secondary: colors.surfaceAlt,
    danger: `${colors.danger}1F`,
    ghost: 'transparent',
  }[variant];
  const fg = {
    primary: colors.primaryText,
    secondary: colors.text,
    danger: colors.danger,
    ghost: colors.primary,
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Glyph name={icon} size={18} color={fg} /> : null}
          <AppText variant="label" color={fg} style={styles.buttonText}>
            {title}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

type TextFieldProps = TextInputProps & { label?: string; ref?: Ref<TextInputInstance> };

export function TextField({ label, style, ...rest }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      {label ? (
        <AppText variant="caption" muted style={styles.fieldLabel}>
          {label}
        </AppText>
      ) : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

type SegmentedProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceAlt }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: colors.surface }]}
          >
            <AppText
              variant="label"
              color={selected ? colors.text : colors.textMuted}
              numberOfLines={1}
              adjustsFontSizeToFit // large system text on small phones would otherwise break words
              minimumFontScale={0.7}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

type ChipProps = { label: string; selected?: boolean; onPress: () => void; icon?: IconName; color?: string };

export function Chip({ label, selected, onPress, icon, color }: ChipProps) {
  const { colors } = useTheme();
  const accent = color ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? accent : colors.border,
          backgroundColor: selected ? `${accent}22` : colors.surface,
        },
      ]}
    >
      {icon ? <Glyph name={icon} size={16} color={selected ? accent : colors.textMuted} /> : null}
      <AppText variant="caption" color={selected ? colors.text : colors.textMuted} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

type ListRowProps = {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
};

export function ListRow({ title, subtitle, left, right, onPress, onLongPress, chevron, destructive }: ListRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      {left}
      <View style={styles.rowBody}>
        <AppText numberOfLines={2} color={destructive ? colors.danger : undefined}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" muted numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {chevron ? <Glyph name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

export function SwitchRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      onPress={() => onChange(!value)} // the whole row toggles, as in system settings
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          accessibilityLabel={title}
          trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
        />
      }
    />
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

/** Floating "add" button. Tab screens already end above the tab bar, so no inset is needed. */
export function Fab({ onPress, label = 'Add' }: { onPress: () => void; label?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
    >
      <Glyph name="add" size={30} color={colors.primaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontSize: 16 },
  field: { gap: 6 },
  fieldLabel: { paddingHorizontal: 4 },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, borderRadius: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 200,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 52 },
  rowBody: { flex: 1, gap: 2 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
