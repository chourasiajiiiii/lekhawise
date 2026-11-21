import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/theme';

type ScreenProps = {
  children: ReactNode;
  /** Set false for screens that render their own FlatList/SectionList. */
  scroll?: boolean;
  /** Rendered outside the scroll area, e.g. a floating button. */
  overlay?: ReactNode;
};

/**
 * Standard screen container: themed background, padding, keyboard handling,
 * and automatic insets under the transparent iOS 26 header.
 */
export function Screen({ children, scroll = true, overlay }: ScreenProps) {
  const { colors } = useTheme();
  return (
    // Android too: apps targeting Android 15+ are drawn edge to edge, so the window no longer shrinks for the
    // keyboard and the end of a form (its Save button) would stay hidden behind it.
    <KeyboardAvoidingView style={[styles.flex, { backgroundColor: colors.background }]} behavior="padding">
      {scroll ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{children}</View>
      )}
      {overlay}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 110, gap: 12 },
});
