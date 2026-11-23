import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, Icon, Segmented, SelectModal } from '@/core/ui';
import { formatDate, toISODate } from '@/core/utils/date';

import type { PickedBackup } from '../backup';
import {
  backupToDrive,
  connectDrive,
  disconnectDrive,
  type DriveAutoBackup,
  type DriveBackup,
  type DriveErrorKind,
  driveErrorKind,
  listDriveBackups,
  openDriveBackup,
  useDriveAccount,
  useDriveAutoBackup,
  useDriveLastBackupAt,
  useDriveLastError,
} from '../drive/driveBackup';
import { DrivePermissionError, SignInCancelledError } from '../drive/googleAccount';

type Props = {
  /** The Backup screen's busy marker, so only one backup or restore runs at a time. */
  busy: string | null;
  setBusy: (busy: string | null) => void;
  includePhotos: boolean;
  /** A Drive backup was downloaded and checked: the Backup screen shows its preview and restores it. */
  onPicked: (picked: PickedBackup) => void;
};

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function dateTimeLabel(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${formatDate(toISODate(date))}, ${time}`;
}

/** Google Drive backup on the Backup screen: sign in, back up now, automatic backups, restore from Drive. */
export function DriveBackupCard({ busy, setBusy, includePhotos, onPicked }: Props) {
  const db = useSQLiteContext();
  const t = useT();
  const { colors } = useTheme();
  const account = useDriveAccount();
  const lastBackupAt = useDriveLastBackupAt();
  const lastError = useDriveLastError();
  const [auto, setAuto] = useDriveAutoBackup();
  const [backups, setBackups] = useState<DriveBackup[] | null>(null);

  const errorText = (kind: DriveErrorKind): string =>
    ({
      offline: t('Could not reach Google Drive. Check the internet connection and try again.'),
      signedOut: t('Google no longer allows LekhaWise to use your Drive. Sign in again.'),
      storageFull: t('Your Google Drive is full. Free up space in Drive and try again.'),
      failed: t('Google Drive did not accept the request. Try again later.'),
    })[kind];

  const run = async (kind: string, task: () => Promise<void>) => {
    setBusy(kind);
    try {
      await task();
    } catch (error) {
      if (error instanceof SignInCancelledError) return;
      if (error instanceof DrivePermissionError) {
        Alert.alert(t('Drive permission needed'), t('LekhaWise needs permission to keep its backups in your Google Drive.'));
        return;
      }
      if (!(error instanceof Error && /Drive|Google/i.test(error.name))) console.warn(error);
      Alert.alert(t('Could not complete'), errorText(driveErrorKind(error)));
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run('drive-connect', async () => {
      await connectDrive();
      // A new phone usually wants its data back first: offer the backups already in Drive.
      const existing = await listDriveBackups();
      if (existing.length > 0) setBackups(existing);
    });

  const signOut = () =>
    Alert.alert(t('Sign out of Google?'), t('Backups already in Google Drive stay there and can be restored after signing in again.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Sign out'), style: 'destructive', onPress: () => run('drive-signout', disconnectDrive) },
    ]);

  const backUpNow = () =>
    run('drive-backup', async () => {
      await backupToDrive(db, includePhotos);
      Alert.alert(t('Backed up'), t('Your data was saved to Google Drive.'));
    });

  const chooseBackup = () =>
    run('drive-list', async () => {
      const list = await listDriveBackups();
      if (list.length === 0) {
        Alert.alert(t('No backups in Google Drive'), t('There is no LekhaWise backup in this Google account yet.'));
        return;
      }
      setBackups(list);
    });

  const restore = (backup: DriveBackup) => {
    setBackups(null);
    run('drive-download', async () => onPicked(await openDriveBackup(db, backup)));
  };

  return (
    <Card style={styles.gap}>
      {account ? (
        <>
          <View style={styles.row}>
            <Icon name="logo-google" color={colors.primary} />
            <View style={styles.flex}>
              <AppText>{t('Signed in as {email}', { email: account })}</AppText>
              <AppText variant="caption" muted>
                {lastBackupAt
                  ? t('Last Drive backup: {date}', { date: dateTimeLabel(lastBackupAt) })
                  : t('No Drive backup yet.')}
              </AppText>
            </View>
          </View>
          {lastError ? (
            <AppText variant="caption" color={colors.danger}>
              {t('The last automatic backup did not finish.')} {errorText(lastError)}
            </AppText>
          ) : null}
          <Button
            title={t('Back up to Google Drive now')}
            icon="cloud-upload-outline"
            loading={busy === 'drive-backup'}
            disabled={busy !== null}
            onPress={backUpNow}
          />
          <AppText variant="label">{t('Automatic backup')}</AppText>
          <Segmented<DriveAutoBackup>
            options={[
              { value: 'off', label: t('Off') },
              { value: 'daily', label: t('Daily') },
              { value: 'weekly', label: t('Weekly') },
            ]}
            value={auto}
            onChange={setAuto}
          />
          <AppText variant="caption" muted>
            {t('Made when you open the app and the last backup is older than a day or a week. The 10 most recent backups are kept.')}
          </AppText>
          <Divider />
          <Button
            title={t('Restore from Google Drive')}
            variant="secondary"
            icon="cloud-download-outline"
            loading={busy === 'drive-list' || busy === 'drive-download'}
            disabled={busy !== null}
            onPress={chooseBackup}
          />
          <Button title={t('Sign out of Google')} variant="ghost" disabled={busy !== null} onPress={signOut} />
        </>
      ) : (
        <>
          <AppText variant="caption" muted>
            {t('Keep backups in your own Google Drive and restore them on this phone or a new one. They are stored in a private app folder that only LekhaWise can open.')}
          </AppText>
          <Button
            title={t('Sign in with Google')}
            icon="logo-google"
            loading={busy === 'drive-connect'}
            disabled={busy !== null}
            onPress={connect}
          />
        </>
      )}

      <SelectModal
        visible={backups !== null}
        title={t('Choose a backup to restore')}
        options={(backups ?? []).map((b) => ({
          value: b.id,
          label: dateTimeLabel(b.createdAt),
          subtitle: [
            b.device,
            b.transactions !== null ? t('{count} transactions', { count: b.transactions }) : null,
            sizeLabel(b.size),
          ]
            .filter(Boolean)
            .join(' · '),
          icon: 'cloud-outline',
        }))}
        onSelect={(id) => {
          const backup = backups?.find((b) => b.id === id);
          if (backup) restore(backup);
        }}
        onCancel={() => setBackups(null)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
