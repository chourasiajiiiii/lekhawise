import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { getSetting, setSetting, useSetting } from '@/core/settings/settings';

import { inspectBackup, makeBackupText, markBackupMade, type PickedBackup } from '../backup';
import { deleteFile, downloadFile, DriveError, type DriveFile, listFiles, uploadFile } from './driveApi';
import { driveAccessToken, isDriveBackupAvailable, SignedOutError, signInToGoogle, signOutOfGoogle } from './googleAccount';

/**
 * Google Drive backup: the same backup file as "Save backup to this phone", kept in the app's hidden Drive folder.
 * Restoring works on this phone or a new one (Android or iPhone) after signing in with the same Google account.
 * Automatic backups run when the app is opened and the last one is older than the chosen interval: there is no
 * server and no background job.
 */

export const DRIVE_ACCOUNT_KEY = 'driveAccount';
export const DRIVE_LAST_BACKUP_KEY = 'driveLastBackupAt';
export const DRIVE_AUTO_KEY = 'driveAutoBackup';
export const DRIVE_LAST_ERROR_KEY = 'driveLastError';

export type DriveAutoBackup = 'off' | 'daily' | 'weekly';
const AUTO_INTERVAL_MS: Record<Exclude<DriveAutoBackup, 'off'>, number> = {
  daily: 24 * 3600_000,
  weekly: 7 * 24 * 3600_000,
};

/** Older backups beyond this many are deleted after each new one. */
export const DRIVE_BACKUPS_KEPT = 10;
const FILE_PREFIX = 'lekhawise-backup-';

export type DriveBackup = {
  id: string;
  fileName: string;
  createdAt: string;
  size: number;
  /** The phone it came from, e.g. "Pixel 8", when known. */
  device: string | null;
  transactions: number | null;
};

export { isDriveBackupAvailable };

export function useDriveAccount(): string | null {
  return useSetting<string | null>(DRIVE_ACCOUNT_KEY, null)[0];
}
export function useDriveLastBackupAt(): string | null {
  return useSetting<string | null>(DRIVE_LAST_BACKUP_KEY, null)[0];
}
export function useDriveAutoBackup(): [DriveAutoBackup, (value: DriveAutoBackup) => void] {
  return useSetting<DriveAutoBackup>(DRIVE_AUTO_KEY, 'off');
}
export function useDriveLastError(): DriveErrorKind | null {
  return useSetting<DriveErrorKind | null>(DRIVE_LAST_ERROR_KEY, null)[0];
}

export async function connectDrive(): Promise<string> {
  const email = await signInToGoogle();
  setSetting(DRIVE_ACCOUNT_KEY, email);
  setSetting(DRIVE_LAST_ERROR_KEY, null);
  return email;
}

/** Signs out; backups already in Drive stay there for a later restore. */
export async function disconnectDrive(): Promise<void> {
  try {
    await signOutOfGoogle();
  } finally {
    setSetting(DRIVE_ACCOUNT_KEY, null);
    setSetting(DRIVE_AUTO_KEY, 'off');
    setSetting(DRIVE_LAST_ERROR_KEY, null);
  }
}

/** Runs a Drive call with a token, asking once more for a fresh token if Google rejected the cached one. */
async function withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
  const token = await driveAccessToken();
  try {
    return await call(token);
  } catch (error) {
    if (error instanceof DriveError && error.status === 401) return call(await driveAccessToken(token));
    throw error;
  }
}

function deviceName(): string {
  const constants = Platform.constants as { Model?: string; Manufacturer?: string } | undefined;
  if (Platform.OS === 'android' && constants?.Model) return constants.Model;
  return Platform.OS === 'ios' ? 'iPhone' : Platform.OS;
}

/** Uploads a new backup to Drive and removes the oldest beyond DRIVE_BACKUPS_KEPT. */
export async function backupToDrive(db: SQLiteDatabase, includePhotos = true): Promise<DriveBackup> {
  const { text, fileName, summary } = await makeBackupText(db, { includePhotos });
  const file = await withToken((token) =>
    uploadFile(token, fileName, text, 'application/json', {
      device: deviceName(),
      transactions: String(summary.counts.transactions),
    }),
  );
  const now = new Date().toISOString();
  setSetting(DRIVE_LAST_BACKUP_KEY, now);
  setSetting(DRIVE_LAST_ERROR_KEY, null);
  markBackupMade();
  try {
    const all = await withToken((token) => listFiles(token, FILE_PREFIX));
    for (const old of all.slice(DRIVE_BACKUPS_KEPT)) await withToken((token) => deleteFile(token, old.id));
  } catch (error) {
    console.warn('Could not remove old Drive backups', error); // the new backup is safe either way
  }
  return toBackup(file);
}

function toBackup(file: DriveFile): DriveBackup {
  const count = Number(file.appProperties.transactions);
  return {
    id: file.id,
    fileName: file.name,
    createdAt: file.createdTime,
    size: file.size,
    device: file.appProperties.device || null,
    transactions: Number.isFinite(count) && file.appProperties.transactions !== undefined ? count : null,
  };
}

/** The backups in Drive, newest first. */
export async function listDriveBackups(): Promise<DriveBackup[]> {
  return (await withToken((token) => listFiles(token, FILE_PREFIX))).map(toBackup);
}

/** Downloads a backup and checks it, like a file picked on the phone. Nothing is changed yet. */
export async function openDriveBackup(db: SQLiteDatabase, backup: DriveBackup): Promise<PickedBackup> {
  const text = await withToken((token) => downloadFile(token, backup.id));
  return inspectBackup(db, text, backup.fileName);
}

/** Whether an automatic backup is due (pure, for tests and the screen). */
export function isAutoBackupDue(auto: DriveAutoBackup, lastBackupAt: string | null, now: Date): boolean {
  if (auto === 'off') return false;
  if (!lastBackupAt) return true;
  const last = Date.parse(lastBackupAt);
  return !Number.isFinite(last) || now.getTime() - last >= AUTO_INTERVAL_MS[auto];
}

/** Why a Drive call failed, in terms the screen can explain (and translate). */
export type DriveErrorKind = 'offline' | 'signedOut' | 'storageFull' | 'failed';

export function driveErrorKind(error: unknown): DriveErrorKind {
  if (error instanceof SignedOutError) return 'signedOut';
  if (error instanceof DriveError) {
    if (error.status === 0) return 'offline';
    if (error.status === 401 || error.status === 403) return /quota|storage/i.test(error.message) ? 'storageFull' : 'signedOut';
  }
  return 'failed';
}

let autoRunning: Promise<void> | null = null;

/**
 * Called when the app starts or comes back to the foreground. Errors (offline, signed out) are kept for the
 * Backup screen instead of interrupting the user; the next opening tries again.
 */
export function autoBackupToDriveIfDue(db: SQLiteDatabase, now = new Date()): Promise<void> {
  if (autoRunning) return autoRunning;
  if (!isDriveBackupAvailable() || !getSetting<string | null>(DRIVE_ACCOUNT_KEY, null)) return Promise.resolve();
  const auto = getSetting<DriveAutoBackup>(DRIVE_AUTO_KEY, 'off');
  if (!isAutoBackupDue(auto, getSetting<string | null>(DRIVE_LAST_BACKUP_KEY, null), now)) return Promise.resolve();
  autoRunning = backupToDrive(db)
    .then(() => undefined)
    .catch((error: unknown) => {
      setSetting(DRIVE_LAST_ERROR_KEY, driveErrorKind(error));
    })
    .finally(() => {
      autoRunning = null;
    });
  return autoRunning;
}
