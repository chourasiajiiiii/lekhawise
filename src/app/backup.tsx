import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { WrongPasswordError } from '@/core/crypto/passwordBox';
import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Divider, Icon, PromptModal, Screen, SectionTitle, SwitchRow, TextField } from '@/core/ui';
import { formatDate, toISODate } from '@/core/utils/date';
import {
  applyRestore,
  decryptBackup,
  type ExportDestination,
  exportBackup,
  type PendingRestore,
  pickBackup,
} from '@/features/expenses/backup';
import { BackupError } from '@/features/expenses/backupFormat';
import { exportCsv, exportXlsx } from '@/features/expenses/exports';
import { useLastBackupAt } from '@/features/expenses/settings';

type Busy = null | string;

// Android's share sheet has no "save to this phone" target, so Android gets a folder picker as well.
// On iOS the share sheet already includes "Save to Files".
const CAN_SAVE_TO_PHONE = Platform.OS === 'android';
const MIN_PASSWORD = 8;

export default function BackupScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const lastBackupAt = useLastBackupAt();
  const [busy, setBusy] = useState<Busy>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [encrypted, setEncrypted] = useState<{ text: string; fileName: string } | null>(null);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [includePhotos, setIncludePhotos] = useState(true);

  const run = async (kind: string, task: () => Promise<void>) => {
    setBusy(kind);
    try {
      await task();
    } catch (error) {
      if (error instanceof WrongPasswordError) {
        Alert.alert(t('Wrong password'), t('That password does not open this backup.'));
      } else {
        const message = error instanceof BackupError ? t(error.message) : t('Something went wrong. Your data was not changed.');
        if (!(error instanceof BackupError)) console.error(error);
        Alert.alert(t('Could not complete'), message);
      }
    } finally {
      setBusy(null);
    }
  };

  const savedMessage = (done: boolean, destination: ExportDestination) => {
    if (done && destination === 'phone') Alert.alert(t('Saved'), t('The file was saved in the folder you chose.'));
  };

  const backup = (destination: ExportDestination) => {
    if (encrypt) {
      if (password.length < MIN_PASSWORD) {
        Alert.alert(t('Password too short'), t('Use at least {count} characters.', { count: MIN_PASSWORD }));
        return;
      }
      if (password !== passwordAgain) {
        Alert.alert(t('Passwords differ'), t('Type the same password twice.'));
        return;
      }
    }
    run(`backup-${destination}`, async () => {
      const done = await exportBackup(db, { destination, password: encrypt ? password : undefined, includePhotos });
      savedMessage(done, destination);
    });
  };

  const confirmRestore = () => {
    if (!pending) return;
    Alert.alert(
      t('Replace all data?'),
      t('Everything currently in the app will be replaced by this backup. This cannot be undone. Consider making a backup of the current data first.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Replace'),
          style: 'destructive',
          onPress: () =>
            run('restore', async () => {
              await applyRestore(db, pending.file);
              setPending(null);
              Alert.alert(t('Restored'), t('Your backup has been restored.'));
            }),
        },
      ],
    );
  };

  const counts = pending?.summary.counts;

  return (
    <Screen>
      <Card style={styles.info}>
        <Icon name="phone-portrait-outline" color={colors.primary} />
        <AppText variant="caption" muted style={styles.flex}>
          {t('LekhaWise keeps your data only on this phone. A backup file can be saved to Google Drive, iCloud Drive, email or a computer, and restored on any phone, Android or iPhone.')}
        </AppText>
      </Card>

      <SectionTitle>{t('Backup')}</SectionTitle>
      <Card style={styles.gap}>
        <AppText variant="caption" muted>
          {lastBackupAt
            ? t('Last backup file created: {date}', { date: formatDate(toISODate(new Date(lastBackupAt))) })
            : t('No backup made yet.')}
        </AppText>
        <SwitchRow title={t('Include receipt photos')} subtitle={t('Makes the file larger')} value={includePhotos} onChange={setIncludePhotos} />
        <Divider />
        <SwitchRow
          title={t('Protect with a password')}
          subtitle={t('The file cannot be opened without it. There is no way to recover a forgotten password.')}
          value={encrypt}
          onChange={(on) => {
            setEncrypt(on);
            if (!on) {
              setPassword('');
              setPasswordAgain('');
            }
          }}
        />
        {encrypt ? (
          <>
            <TextField label={t('Password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <TextField label={t('Password again')} value={passwordAgain} onChangeText={setPasswordAgain} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          </>
        ) : null}
        {CAN_SAVE_TO_PHONE ? (
          <>
            <Button
              title={t('Save backup to this phone')}
              icon="download-outline"
              loading={busy === 'backup-phone'}
              disabled={busy !== null}
              onPress={() => backup('phone')}
            />
            <Button
              title={t('Share backup (Drive, email…)')}
              variant="secondary"
              icon="share-outline"
              loading={busy === 'backup-share'}
              disabled={busy !== null}
              onPress={() => backup('share')}
            />
          </>
        ) : (
          <Button
            title={t('Create backup file')}
            icon="cloud-upload-outline"
            loading={busy === 'backup-share'}
            disabled={busy !== null}
            onPress={() => backup('share')}
          />
        )}
      </Card>

      <SectionTitle>{t('Restore')}</SectionTitle>
      <Card style={styles.gap}>
        {pending && counts ? (
          <View style={styles.gap}>
            <AppText variant="label">{pending.fileName}</AppText>
            <AppText variant="caption" muted>
              {pending.summary.exportedAt ? t('Made on {date}', { date: formatDate(toISODate(new Date(pending.summary.exportedAt))) }) : ''}
            </AppText>
            <Preview label={t('Transactions')} value={counts.transactions} />
            <Preview label={t('Accounts')} value={counts.accounts} />
            <Preview label={t('Categories')} value={counts.categories} />
            <Preview label={t('Budgets')} value={counts.budgets} />
            <Preview label={t('Recurring rules')} value={counts.recurring} />
            {counts.loans ? <Preview label={t('Loans & debts')} value={counts.loans} /> : null}
            {counts.goals ? <Preview label={t('Savings goals')} value={counts.goals} /> : null}
            {counts.holdings ? <Preview label={t('Investments and assets')} value={counts.holdings} /> : null}
            {pending.summary.photos ? <Preview label={t('Receipt photos')} value={pending.summary.photos} /> : null}
            {pending.summary.firstDate && pending.summary.lastDate ? (
              <AppText variant="caption" muted>
                {t('From {from} to {to}', { from: formatDate(pending.summary.firstDate), to: formatDate(pending.summary.lastDate) })}
              </AppText>
            ) : null}
            <Button
              title={t('Restore this backup')}
              variant="danger"
              icon="refresh-outline"
              loading={busy === 'restore'}
              disabled={busy !== null}
              onPress={confirmRestore}
            />
            <Button title={t('Cancel')} variant="ghost" onPress={() => setPending(null)} />
          </View>
        ) : (
          <>
            <AppText variant="caption" muted>
              {t('Choose a LekhaWise backup file. It is checked first and you will see what it contains before anything changes.')}
            </AppText>
            <Button
              title={t('Choose backup file')}
              variant="secondary"
              icon="folder-open-outline"
              loading={busy === 'pick'}
              disabled={busy !== null}
              onPress={() =>
                run('pick', async () => {
                  const result = await pickBackup(db);
                  if (!result) return;
                  if (result.kind === 'encrypted') setEncrypted({ text: result.text, fileName: result.fileName });
                  else setPending(result);
                })
              }
            />
          </>
        )}
      </Card>

      <SectionTitle>{t('Export')}</SectionTitle>
      <Card style={styles.gap}>
        <AppText variant="caption" muted>
          {t('Excel: transactions, monthly summary, categories and accounts on separate sheets. CSV: all transactions, for any spreadsheet app.')}
        </AppText>
        {(['xlsx', 'csv'] as const).map((kind) => (
          <View key={kind} style={styles.gap}>
            {CAN_SAVE_TO_PHONE ? (
              <Button
                title={kind === 'xlsx' ? t('Save Excel file to this phone') : t('Save CSV to this phone')}
                variant="secondary"
                icon="download-outline"
                loading={busy === `${kind}-phone`}
                disabled={busy !== null}
                onPress={() =>
                  run(`${kind}-phone`, async () => savedMessage(await (kind === 'xlsx' ? exportXlsx : exportCsv)(db, 'phone'), 'phone'))
                }
              />
            ) : null}
            <Button
              title={kind === 'xlsx' ? t('Share Excel file') : t('Share CSV')}
              variant="secondary"
              icon={kind === 'xlsx' ? 'grid-outline' : 'document-text-outline'}
              loading={busy === `${kind}-share`}
              disabled={busy !== null}
              onPress={() => run(`${kind}-share`, async () => void (await (kind === 'xlsx' ? exportXlsx : exportCsv)(db, 'share')))}
            />
          </View>
        ))}
        <Button title={t('PDF reports are on the Reports tab')} variant="ghost" icon="document-outline" onPress={() => router.navigate('/reports')} />
      </Card>

      <PromptModal
        visible={encrypted !== null}
        title={t('Backup password')}
        message={t('This backup is protected. Enter its password.')}
        placeholder={t('Password')}
        secureTextEntry
        submitLabel={t('Open')}
        onSubmit={(value) => {
          const file = encrypted;
          setEncrypted(null);
          if (file) run('pick', async () => setPending(await decryptBackup(db, file.text, value, file.fileName)));
        }}
        onCancel={() => setEncrypted(null)}
      />
    </Screen>
  );
}

function Preview({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.preview}>
      <AppText muted>{label}</AppText>
      <AppText variant="label">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 10 },
  info: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  preview: { flexDirection: 'row', justifyContent: 'space-between' },
});
