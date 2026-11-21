import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, type TextProps, View, type ViewProps } from 'react-native';

import { useTheme } from '../theme/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption';

const variants = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16 },
  label: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 13 },
});

type AppTextProps = TextProps & { variant?: Variant; muted?: boolean; color?: string };

export function AppText({ variant = 'body', muted, color, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  return (
    <Text
      style={[variants[variant], { color: color ?? (muted ? colors.textMuted : colors.text) }, style]}
      {...rest}
    />
  );
}

export function Card({ style, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
      {...rest}
    />
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="label" muted style={styles.sectionTitleText}>
        {children}
      </AppText>
      {right}
    </View>
  );
}

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? colors.text} />;
}

/** Coloured circle with an icon, used for categories and accounts. */
export function IconBadge({ name, color, size = 40 }: { name: IconName; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `${color}26`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={size * 0.5} color={color} />
    </View>
  );
}

export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height, backgroundColor: color ?? colors.primary }} />
    </View>
  );
}

export function EmptyState({ icon, title, message }: { icon: IconName; title: string; message?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.textMuted} />
      <AppText variant="heading" style={styles.emptyTitle}>
        {title}
      </AppText>
      {message ? (
        <AppText muted style={styles.emptyMessage}>
          {message}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  sectionTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionTitleText: { textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 12 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { textAlign: 'center' },
  emptyMessage: { textAlign: 'center' },
});
