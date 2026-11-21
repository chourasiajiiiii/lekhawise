import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { t } from '../i18n/locale';
import { getSetting, useSetting } from '../settings/settings';
import { useTheme } from '../theme/theme';
import { Button } from '../ui/controls';
import { AppText, Icon } from '../ui/primitives';
import { pinLength, pinLockoutRemaining, verifyPin } from './pin';
import { PinPad } from './PinPad';

/** Old on/off setting from version 1, still read so an existing lock stays on after updating. */
export const APP_LOCK_SETTING_KEY = 'appLock';
export const LOCK_METHOD_SETTING_KEY = 'lockMethod';
export const LOCK_AFTER_SETTING_KEY = 'lockAfterSeconds';
export const PIN_BIOMETRIC_SETTING_KEY = 'pinBiometric';

/** 'device': fingerprint, face or the phone's passcode. 'pin': the app's own PIN (plus optional fingerprint/face). */
export type LockMethod = 'off' | 'device' | 'pin';

export const LOCK_AFTER_OPTIONS = [0, 30, 60, 300] as const;

/** Display name from app.json, so this file works unchanged in other apps. */
const appName = () => Constants.expoConfig?.name ?? 'App';

export function getLockMethod(): LockMethod {
  const saved = getSetting<LockMethod | null>(LOCK_METHOD_SETTING_KEY, null);
  if (saved) return saved;
  return getSetting<boolean>(APP_LOCK_SETTING_KEY, false) ? 'device' : 'off';
}

export function useLockMethod(): LockMethod {
  const [saved] = useSetting<LockMethod | null>(LOCK_METHOD_SETTING_KEY, null);
  const [legacy] = useSetting<boolean>(APP_LOCK_SETTING_KEY, false);
  return saved ?? (legacy ? 'device' : 'off');
}

/** True when the device has a fingerprint, face or passcode that can protect the app. */
export async function canUseAppLock(): Promise<boolean> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level !== LocalAuthentication.SecurityLevel.NONE;
}

/** True when a fingerprint or face is enrolled (not just a passcode). */
export async function hasBiometrics(): Promise<boolean> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG || level === LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK;
}

export async function authenticate(promptMessage = t('Unlock'), biometricOnly = false): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    disableDeviceFallback: biometricOnly,
    cancelLabel: biometricOnly ? t('Use PIN') : undefined,
  });
  return result.success;
}

/**
 * Blocks the app behind the chosen lock (device lock or the app's PIN) and locks again after
 * the chosen time in the background. Also keeps balances out of the app-switcher preview.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const method = useLockMethod();
  const [lockAfter] = useSetting<number>(LOCK_AFTER_SETTING_KEY, 30);
  const [pinBiometric] = useSetting<boolean>(PIN_BIOMETRIC_SETTING_KEY, false);
  const enabled = method !== 'off';
  const [lockedState, setLocked] = useState(enabled);
  // Turning the lock off unlocks; turning it on does not lock the person out of the settings screen.
  const locked = enabled && lockedState;
  const [hidden, setHidden] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const authenticating = useRef(false);

  const unlockWithDevice = useCallback(async (biometricOnly: boolean) => {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      if (await authenticate(t('Unlock {app}', { app: appName() }), biometricOnly)) setLocked(false);
    } finally {
      authenticating.current = false;
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!enabled) return;
      if (state === 'active') {
        setHidden(false);
        const away = backgroundAt.current ? Date.now() - backgroundAt.current : 0;
        backgroundAt.current = null;
        if (away > lockAfter * 1000 || (lockAfter === 0 && away > 0)) setLocked(true);
      } else {
        // The unlock prompt itself can background the app (Android passcode screen, iOS Face ID),
        // so never start the relock timer or cover the screen while authenticating.
        if (authenticating.current) return;
        if (state === 'background' && backgroundAt.current === null) backgroundAt.current = Date.now();
        setHidden(true);
      }
    });
    return () => subscription.remove();
  }, [enabled, lockAfter]);

  useEffect(() => {
    if (!locked) return;
    if (method === 'device') unlockWithDevice(false);
    if (method === 'pin' && pinBiometric) unlockWithDevice(true);
  }, [method, locked, pinBiometric, unlockWithDevice]);

  // The OS captures the app-switcher preview the moment the app pauses, before any cover can be drawn,
  // so ask the OS directly: Android marks the window secure (blank preview, no screenshots),
  // iOS blurs the preview.
  useEffect(() => {
    if (!enabled) return;
    const key = 'app-lock';
    const protect = Platform.OS === 'ios'
      ? ScreenCapture.enableAppSwitcherProtectionAsync()
      : ScreenCapture.preventScreenCaptureAsync(key);
    protect.catch((error) => console.warn('Screen protection unavailable', error));
    return () => {
      const release = Platform.OS === 'ios'
        ? ScreenCapture.disableAppSwitcherProtectionAsync()
        : ScreenCapture.allowScreenCaptureAsync(key);
      release.catch(() => {});
    };
  }, [enabled]);

  const showCover = enabled && (locked || hidden);

  return (
    <View style={styles.flex}>
      {children}
      {showCover ? (
        <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: colors.background }]}>
          <Icon name="lock-closed" size={40} color={colors.primary} />
          <AppText variant="heading">{t('{app} is locked', { app: appName() })}</AppText>
          {locked && method === 'pin' ? (
            <PinUnlock
              biometric={pinBiometric}
              onBiometric={() => unlockWithDevice(true)}
              onUnlocked={() => setLocked(false)}
            />
          ) : locked ? (
            <Button title={t('Unlock')} icon="finger-print" onPress={() => unlockWithDevice(false)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PinUnlock({
  biometric,
  onBiometric,
  onUnlocked,
}: {
  biometric: boolean;
  onBiometric: () => void;
  onUnlocked: () => void;
}) {
  const { colors } = useTheme();
  const [pin, setPin] = useState('');
  const [length, setLength] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [waitMs, setWaitMs] = useState(() => pinLockoutRemaining());
  const checking = useRef(false);

  useEffect(() => {
    pinLength().then(setLength).catch(() => setLength(null));
  }, []);

  useEffect(() => {
    if (waitMs <= 0) return;
    const timer = setInterval(() => {
      const left = pinLockoutRemaining();
      setWaitMs(left);
      if (left <= 0) setMessage('');
    }, 1000);
    return () => clearInterval(timer);
  }, [waitMs]);

  const submit = useCallback(
    async (value: string) => {
      if (checking.current) return;
      checking.current = true;
      try {
        const result = await verifyPin(value);
        if (result.ok) {
          onUnlocked();
          return;
        }
        setPin('');
        if (result.lockedForMs > 0) {
          setWaitMs(result.lockedForMs);
          setMessage(t('Too many wrong attempts.'));
        } else {
          setMessage(t('Wrong PIN. {count} attempts left before a pause.', { count: result.attemptsLeft }));
        }
      } finally {
        checking.current = false;
      }
    },
    [onUnlocked],
  );

  const change = (value: string) => {
    setPin(value);
    if (length && value.length === length) submit(value);
  };

  return (
    <View style={styles.pin}>
      <AppText muted>{t('Enter your PIN')}</AppText>
      <PinPad
        value={pin}
        onChange={change}
        length={length}
        disabled={waitMs > 0}
        extraKey={biometric ? { icon: 'finger-print', label: t('Use fingerprint or face'), onPress: onBiometric } : undefined}
      />
      <AppText variant="caption" color={colors.danger} style={styles.message}>
        {waitMs > 0 ? t('Try again in {seconds} s.', { seconds: Math.ceil(waitMs / 1000) }) : message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cover: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  pin: { alignItems: 'center', gap: 16 },
  message: { minHeight: 18, textAlign: 'center' },
});
