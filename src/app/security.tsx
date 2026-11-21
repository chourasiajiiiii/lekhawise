import { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tPlural, useT } from '@/core/i18n/locale';
import {
  authenticate,
  canUseAppLock,
  hasBiometrics,
  LOCK_AFTER_OPTIONS,
  LOCK_AFTER_SETTING_KEY,
  LOCK_METHOD_SETTING_KEY,
  type LockMethod,
  PIN_BIOMETRIC_SETTING_KEY,
  useLockMethod,
} from '@/core/lock/AppLock';
import { clearPin, setPin, verifyPin } from '@/core/lock/pin';
import { PinPad } from '@/core/lock/PinPad';
import { setSetting, useSetting } from '@/core/settings/settings';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Chip, Divider, ListRow, Screen, SectionTitle, SwitchRow } from '@/core/ui';

type PinFlow = null | { step: 'current' | 'new' | 'confirm'; first?: string; then: 'set' | 'off' };

export default function SecurityScreen() {
  const { colors } = useTheme();
  const t = useT();
  const method = useLockMethod();
  const [lockAfter, setLockAfter] = useSetting<number>(LOCK_AFTER_SETTING_KEY, 30);
  const [pinBiometric, setPinBiometric] = useSetting<boolean>(PIN_BIOMETRIC_SETTING_KEY, false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [flow, setFlow] = useState<PinFlow>(null);

  useEffect(() => {
    hasBiometrics().then(setBiometricsAvailable).catch(() => setBiometricsAvailable(false));
  }, []);

  const setMethod = (next: LockMethod) => setSetting(LOCK_METHOD_SETTING_KEY, next);

  const chooseDevice = async () => {
    if (!(await canUseAppLock())) {
      Alert.alert(t('No screen lock'), t('Set up a fingerprint, face unlock or a passcode on this phone first.'));
      return;
    }
    if (await authenticate(t('Confirm to turn on app lock'))) {
      if (method === 'pin') await clearPin();
      setMethod('device');
    }
  };

  const turnOff = async () => {
    if (method === 'device') {
      if (await authenticate(t('Confirm to turn off app lock'))) setMethod('off');
    } else if (method === 'pin') {
      setFlow({ step: 'current', then: 'off' });
    }
  };

  const lockLabel = (seconds: number) =>
    seconds === 0
      ? t('Immediately')
      : seconds < 60
        ? t('After {count} seconds', { count: seconds })
        : tPlural(seconds / 60, 'After {count} minute', 'After {count} minutes');

  return (
    <Screen>
      <SectionTitle>{t('Lock with')}</SectionTitle>
      <Card style={styles.listCard}>
        <ListRow
          title={t('Off')}
          subtitle={t('Anyone with your unlocked phone can open the app')}
          right={method === 'off' ? <Check /> : null}
          onPress={method === 'off' ? undefined : turnOff}
        />
        <Divider />
        <ListRow
          title={t('Phone lock')}
          subtitle={t('Fingerprint, face or the phone passcode')}
          right={method === 'device' ? <Check /> : null}
          onPress={method === 'device' ? undefined : chooseDevice}
        />
        <Divider />
        <ListRow
          title={t('App PIN')}
          subtitle={t('A separate 4 to 6 digit PIN just for LekhaWise')}
          right={method === 'pin' ? <Check /> : null}
          onPress={method === 'pin' ? undefined : () => setFlow({ step: 'new', then: 'set' })}
        />
      </Card>

      {method === 'pin' ? (
        <Card style={styles.listCard}>
          {biometricsAvailable ? (
            <>
              <SwitchRow
                title={t('Also unlock with fingerprint or face')}
                value={pinBiometric}
                onChange={async (on) => {
                  if (!on || (await authenticate(t('Confirm fingerprint or face'), true))) setPinBiometric(on);
                }}
              />
              <Divider />
            </>
          ) : null}
          <ListRow title={t('Change PIN')} chevron onPress={() => setFlow({ step: 'current', then: 'set' })} />
        </Card>
      ) : null}

      {method !== 'off' ? (
        <>
          <SectionTitle>{t('Lock again')}</SectionTitle>
          <View style={styles.chips}>
            {LOCK_AFTER_OPTIONS.map((s) => (
              <Chip key={s} label={lockLabel(s)} selected={lockAfter === s} onPress={() => setLockAfter(s)} />
            ))}
          </View>
          <AppText variant="caption" muted>
            {t('How long the app can stay in the background before it asks again.')}
          </AppText>
        </>
      ) : null}

      <AppText variant="caption" muted>
        {t('While the lock is on, the app-switcher preview is hidden and Android blocks screenshots of the app. If you forget the app PIN, reinstalling the app removes it together with all data, so keep a backup.')}
      </AppText>

      <PinFlowModal
        flow={flow}
        onDone={async (pin) => {
          if (!flow) return;
          if (flow.then === 'off') {
            await clearPin();
            setMethod('off');
          } else if (pin) {
            await setPin(pin);
            setMethod('pin');
            Alert.alert(t('PIN saved'), t('LekhaWise will ask for this PIN when it opens.'));
          }
          setFlow(null);
        }}
        setFlow={setFlow}
        colors={colors}
      />
    </Screen>
  );
}

function Check() {
  const { colors } = useTheme();
  return <AppText color={colors.primary}>✓</AppText>;
}

function PinFlowModal({
  flow,
  setFlow,
  onDone,
  colors,
}: {
  flow: PinFlow;
  setFlow: (flow: PinFlow) => void;
  onDone: (pin: string | null) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const t = useT();
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (pin: string) => {
    if (!flow) return;
    if (flow.step === 'current') {
      const result = await verifyPin(pin);
      setValue('');
      if (!result.ok) {
        setMessage(result.lockedForMs > 0 ? t('Too many wrong attempts. Try again in {seconds} s.', { seconds: Math.ceil(result.lockedForMs / 1000) }) : t('Wrong PIN.'));
        return;
      }
      setMessage('');
      if (flow.then === 'off') onDone(null);
      else setFlow({ step: 'new', then: 'set' });
    } else if (flow.step === 'new') {
      setValue('');
      setMessage('');
      setFlow({ ...flow, step: 'confirm', first: pin });
    } else {
      setValue('');
      if (pin !== flow.first) {
        setMessage(t('The PINs did not match. Start again.'));
        setFlow({ step: 'new', then: 'set' });
        return;
      }
      setMessage('');
      onDone(pin);
    }
  };

  const title =
    flow?.step === 'current' ? t('Enter your current PIN') : flow?.step === 'confirm' ? t('Enter the new PIN again') : t('Choose a PIN (4 to 6 digits)');
  const autoLength = flow?.step === 'confirm' ? flow.first?.length : undefined;

  return (
    <Modal visible={flow !== null} animationType="slide" onRequestClose={() => setFlow(null)}>
      <SafeAreaView style={[styles.modal, { backgroundColor: colors.background }]}>
        <AppText variant="heading" style={styles.center}>
          {title}
        </AppText>
        <PinPad
          value={value}
          onChange={(next) => {
            setValue(next);
            if (autoLength && next.length === autoLength) submit(next);
          }}
          length={autoLength ?? null}
        />
        <AppText variant="caption" color={colors.danger} style={styles.center}>
          {message}
        </AppText>
        <View style={styles.modalActions}>
          {!autoLength ? <Button title={t('Continue')} onPress={() => submit(value)} disabled={value.length < 4} /> : null}
          <Button
            title={t('Cancel')}
            variant="ghost"
            onPress={() => {
              setValue('');
              setMessage('');
              setFlow(null);
            }}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modal: { flex: 1, justifyContent: 'center', gap: 24, padding: 24 },
  center: { textAlign: 'center' },
  modalActions: { gap: 8 },
});
