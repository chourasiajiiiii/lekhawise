import { type RefObject, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  type KeyboardTypeOptions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  type TextInputInstance,
  View,
} from 'react-native';

import { t } from '../i18n/locale';
import { useTheme } from '../theme/theme';
import { Button, TextField } from './controls';
import { AppText } from './primitives';

type PromptModalProps = {
  visible: boolean;
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  submitLabel?: string;
  /** Optional secondary action, e.g. "Remove budget". */
  extraAction?: { label: string; onPress: () => void };
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

/** Cross-platform text prompt (Alert.prompt only exists on iOS). */
export function PromptModal(props: PromptModalProps) {
  const inputRef = useRef<TextInputInstance>(null);
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onCancel}
      // autoFocus inside a Modal does not open the Android keyboard; focus once the modal is on screen.
      onShow={() => {
        setTimeout(() => inputRef.current?.focus(), 50);
      }}
    >
      {/* Remount the form each time it opens so it starts from initialValue. */}
      {props.visible ? <PromptBody {...props} inputRef={inputRef} /> : null}
    </Modal>
  );
}

function PromptBody({
  title,
  message,
  initialValue = '',
  placeholder,
  keyboardType,
  secureTextEntry,
  submitLabel,
  extraAction,
  onSubmit,
  onCancel,
  inputRef,
}: PromptModalProps & { inputRef: RefObject<TextInputInstance | null> }) {
  const { colors } = useTheme();
  const [value, setValue] = useState(initialValue);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.backdrop, { backgroundColor: colors.overlay }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel={t('Close')} />
      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <AppText variant="heading">{title}</AppText>
        {message ? <AppText muted>{message}</AppText> : null}
        <TextField
          ref={inputRef}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={secureTextEntry ? 'none' : undefined}
          onSubmitEditing={() => onSubmit(value)}
          returnKeyType="done"
        />
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button title={t('Cancel')} variant="secondary" onPress={onCancel} />
          </View>
          <View style={styles.flex}>
            <Button title={submitLabel ?? t('Save')} onPress={() => onSubmit(value)} />
          </View>
        </View>
        {extraAction ? <Button title={extraAction.label} variant="ghost" onPress={extraAction.onPress} /> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 20, padding: 20, gap: 14 },
  actions: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
