import { getRandomBytes } from 'expo-crypto';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

/**
 * Encryption of the database file on the phone (SQLCipher, AES-256).
 *
 * Installed builds of the app include SQLCipher (expo-sqlite config plugin, `useSQLCipher`). The key is
 * 32 random bytes created on first launch and kept in the phone's secure storage (Android Keystore,
 * iOS Keychain), so the user never has to remember it, and the file is unreadable if copied off the phone.
 *
 * In Expo Go (used while developing) SQLite has no encryption; everything still works, unencrypted.
 */

export const DATABASE_NAME = 'lekhawise.db';
const KEY_NAME = 'db.encryptionKey';
const TEMP_NAME = 'lekhawise.encrypting.db';

export type DatabaseKey = { hex: string } | null;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const hex = toHex(getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_NAME, hex);
  return hex;
}

/** Statement that unlocks a SQLCipher database with a raw 256-bit key (no key derivation needed). */
export function keyStatement(hex: string, schema?: string): string {
  return `PRAGMA ${schema ? `${schema}.` : ''}key = "x'${hex}'";`;
}

async function hasSqlCipher(db: SQLiteDatabase): Promise<boolean> {
  try {
    const row = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
    return !!row?.cipher_version;
  } catch {
    return false;
  }
}

function fileUri(name: string): string {
  const dir = String(defaultDatabaseDirectory);
  return `${dir.startsWith('file://') ? dir : `file://${dir}`}/${name}`;
}

function remove(name: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = new File(fileUri(`${name}${suffix}`));
    if (file.exists) file.delete();
  }
}

/**
 * Runs before the database opens. Returns the key to unlock it with, or null where SQLite has no
 * encryption (Expo Go, tests). A database created by an earlier version without encryption is
 * converted once: copied into a new encrypted file (sqlcipher_export), which then replaces it.
 */
export async function prepareDatabaseEncryption(): Promise<DatabaseKey> {
  const probe = await openDatabaseAsync(DATABASE_NAME);
  try {
    if (!(await hasSqlCipher(probe))) return null;
    const hex = await getOrCreateKey();

    // Without a key, an encrypted file cannot be read at all, while a plain one can.
    let plainTables: number | null = null;
    try {
      const row = await probe.getFirstAsync<{ n: number }>("select count(*) as n from sqlite_master where type = 'table'");
      plainTables = row?.n ?? 0;
    } catch {
      plainTables = null; // already encrypted
    }
    if (plainTables === null) return { hex };

    if (plainTables > 0) {
      const version = (await probe.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
      remove(TEMP_NAME);
      const target = fileUri(TEMP_NAME).replace(/^file:\/\//, '').replace(/'/g, "''");
      await probe.execAsync(`
        PRAGMA wal_checkpoint(TRUNCATE);
        ATTACH DATABASE '${target}' AS encrypted KEY "x'${hex}'";
        SELECT sqlcipher_export('encrypted');
        PRAGMA encrypted.user_version = ${Math.floor(version)};
        DETACH DATABASE encrypted;
      `);
    }
    await probe.closeAsync();
    remove(DATABASE_NAME);
    if (plainTables > 0) {
      new File(fileUri(TEMP_NAME)).rename(DATABASE_NAME);
    }
    return { hex };
  } finally {
    try {
      await probe.closeAsync();
    } catch {
      // already closed
    }
  }
}

/** True when the open database file is encrypted (for the security screen). */
export async function isDatabaseEncrypted(db: SQLiteDatabase): Promise<boolean> {
  return hasSqlCipher(db);
}
