import { strFromU8, strToU8 } from 'fflate';
import type { SQLiteDatabase } from 'expo-sqlite';

import { isSealedBox, openWithPassword, type SealedBox, sealWithPassword } from '@/core/crypto/passwordBox';
import { notifyDataChanged } from '@/core/db/events';
import { getSchemaVersion } from '@/core/db/migrate';
import { type FileContent, pickTextFile, saveFileToFolder, shareFile } from '@/core/files/files';
import { getSetting, setSetting } from '@/core/settings/settings';
import { todayISO } from '@/core/utils/date';
import { moneyScale } from '@/core/utils/money';

import { readAllPhotos, writeAllPhotos } from './attachments';
import {
  BACKUP_APP_ID,
  BACKUP_FORMAT,
  BackupError,
  type BackupFile,
  type BackupSummary,
  isObject,
  MONEY_COLUMNS,
  parseBackup,
  parseBackupObject,
  RESTORE_ORDER,
  type Row,
  summarizeBackup,
  TABLE_COLUMNS,
  type TableName,
} from './backupFormat';
import { processRecurring } from './recurring';
import { listAllAttachments } from './repoExtras';
import { applyLocaleSettings, BACKED_UP_SETTINGS, CURRENCY_SETTING_KEY, getCurrency, LAST_BACKUP_SETTING_KEY } from './settings';

const RESTORE_CHUNK_ROWS = 400;

/**
 * Where an exported file goes: the share sheet (cloud, email, iOS Files) or, on Android,
 * a folder the user picks on the phone.
 */
export type ExportDestination = 'share' | 'phone';

export async function deliver(
  destination: ExportDestination,
  fileName: string,
  content: FileContent,
  mimeType: string,
  uti: string,
): Promise<boolean> {
  if (destination === 'phone') return saveFileToFolder(fileName, content, mimeType);
  await shareFile(fileName, content, { mimeType, uti });
  return true;
}

export type BackupOptions = {
  destination?: ExportDestination;
  /** Encrypts the file with this password when set. */
  password?: string;
  includePhotos?: boolean;
};

/** Reads everything into a backup object. */
export async function buildBackup(db: SQLiteDatabase, includePhotos = true): Promise<BackupFile> {
  const data = {} as Record<TableName, Row[]>;
  for (const table of RESTORE_ORDER) {
    const columns = TABLE_COLUMNS[table].join(', ');
    data[table] = await db.getAllAsync<Row>(`select ${columns} from ${table}`);
  }
  const settings: Record<string, unknown> = {};
  for (const key of BACKED_UP_SETTINGS) {
    const value = getSetting<unknown>(key, undefined);
    if (value !== undefined) settings[key] = value;
  }
  if (settings[CURRENCY_SETTING_KEY] === undefined) settings[CURRENCY_SETTING_KEY] = getCurrency();
  const files = includePhotos ? await readAllPhotos(await listAllAttachments(db)) : {};
  if (!includePhotos) data.attachments = [];
  return {
    app: BACKUP_APP_ID,
    format: BACKUP_FORMAT,
    schemaVersion: await getSchemaVersion(db),
    exportedAt: new Date().toISOString(),
    settings,
    data,
    files,
  };
}

type EncryptedEnvelope = { app: typeof BACKUP_APP_ID; encrypted: true; exportedAt: string; box: SealedBox };

/** Creates a backup file. Returns false if the user cancelled choosing where to save it. */
export async function exportBackup(db: SQLiteDatabase, options: BackupOptions = {}): Promise<boolean> {
  const backup = await buildBackup(db, options.includePhotos ?? true);
  let text = JSON.stringify(backup);
  let fileName = `lekhawise-backup-${todayISO()}.json`;
  if (options.password) {
    const envelope: EncryptedEnvelope = {
      app: BACKUP_APP_ID,
      encrypted: true,
      exportedAt: backup.exportedAt,
      box: await sealWithPassword(strToU8(text), options.password),
    };
    text = JSON.stringify(envelope);
    fileName = `lekhawise-backup-${todayISO()}-encrypted.json`;
  }
  const done = await deliver(options.destination ?? 'share', fileName, text, 'application/json', 'public.json');
  if (done) setSetting(LAST_BACKUP_SETTING_KEY, new Date().toISOString());
  return done;
}

export type PendingRestore = { file: BackupFile; summary: BackupSummary; fileName: string };
export type PickedBackup =
  | ({ kind: 'ready' } & PendingRestore)
  | { kind: 'encrypted'; fileName: string; text: string };

/** Step 1: pick and validate a file. Nothing is changed yet; show the summary (or ask for the password). */
export async function pickBackup(db: SQLiteDatabase): Promise<PickedBackup | null> {
  const picked = await pickTextFile();
  if (!picked) return null;
  return inspectBackup(db, picked.text, picked.name);
}

export async function inspectBackup(db: SQLiteDatabase, text: string, fileName: string): Promise<PickedBackup> {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new BackupError('This file is not a valid backup (it is not JSON).');
  }
  if (isObject(json) && json.app === BACKUP_APP_ID && json.encrypted === true) {
    if (!isSealedBox(json.box)) throw new BackupError('The encrypted backup is damaged.');
    return { kind: 'encrypted', fileName, text };
  }
  const file = parseBackupObject(json, await getSchemaVersion(db));
  return { kind: 'ready', file, summary: summarizeBackup(file), fileName };
}

/** Step 1b for encrypted files: decrypts with the password (throws WrongPasswordError) and validates. */
export async function decryptBackup(db: SQLiteDatabase, text: string, password: string, fileName: string): Promise<PendingRestore> {
  const envelope = JSON.parse(text.replace(/^﻿/, '')) as EncryptedEnvelope;
  const plain = strFromU8(await openWithPassword(envelope.box, password));
  const file = parseBackup(plain, await getSchemaVersion(db));
  return { file, summary: summarizeBackup(file), fileName };
}

/** Step 2: replace all data with the backup. All-or-nothing: any error rolls back. */
export async function applyRestore(db: SQLiteDatabase, file: BackupFile): Promise<void> {
  await db.withTransactionAsync(async () => {
    // References are checked at commit, so the order of rows inside a table does not matter
    // (a subcategory may come before its parent).
    await db.execAsync('PRAGMA defer_foreign_keys = ON;');
    await db.runAsync('delete from budget_alerts');
    for (const table of [...RESTORE_ORDER].reverse()) {
      await db.runAsync(`delete from ${table}`);
    }
    for (const table of RESTORE_ORDER) {
      const columns = TABLE_COLUMNS[table];
      const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
      const rows = file.data[table];
      // Multi-row inserts: one native call per chunk instead of one per row (5,000 rows: ~13 s -> ~1 s).
      // 400 rows x 16 columns stays far below SQLite's 32,766 bound-parameter limit.
      for (let i = 0; i < rows.length; i += RESTORE_CHUNK_ROWS) {
        const chunk = rows.slice(i, i + RESTORE_CHUNK_ROWS);
        await db.runAsync(
          `insert into ${table} (${columns.join(', ')}) values ${chunk.map(() => rowPlaceholder).join(', ')}`,
          chunk.flatMap((row) => columns.map((column) => row[column] ?? null)),
        );
      }
    }
  });
  await writeAllPhotos(file.files);
  for (const [key, value] of Object.entries(file.settings)) {
    if (BACKED_UP_SETTINGS.includes(key)) setSetting(key, value);
  }
  applyLocaleSettings();
  // Recurring entries that fell due since the backup was made are created now.
  await processRecurring(db, todayISO());
  notifyDataChanged();
}

/**
 * Switches the currency. Amounts are stored in 1/100 units, or 1/1000 for three-decimal currencies
 * (Kuwaiti, Bahraini, Omani money), so moving between the two kinds rescales every stored amount.
 * The numbers themselves are not converted between currencies: 500 stays 500.
 */
export async function changeCurrency(db: SQLiteDatabase, code: string): Promise<void> {
  const from = moneyScale(getCurrency());
  const to = moneyScale(code);
  if (from !== to) {
    await db.withTransactionAsync(async () => {
      for (const [table, columns] of Object.entries(MONEY_COLUMNS)) {
        const sets = columns.map((column) =>
          to > from
            ? `${column} = ${column} * 10`
            : `${column} = case when ${column} is null then null when ${column} = 0 then 0
                 else coalesce(nullif(cast(round(${column} / 10.0) as integer), 0), case when ${column} > 0 then 1 else -1 end) end`,
        );
        await db.runAsync(`update ${table} set ${sets.join(', ')}`);
      }
    });
  }
  setSetting(CURRENCY_SETTING_KEY, code);
  notifyDataChanged();
}
