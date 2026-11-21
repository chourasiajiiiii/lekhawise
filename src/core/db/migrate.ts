import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * A migration moves the schema forward by one version. Migrations are append-only:
 * never edit one that has shipped, add a new one at the end of the list instead.
 */
export type Migration = (db: SQLiteDatabase) => Promise<void>;

/**
 * Runs every migration the database has not seen yet, tracked with PRAGMA user_version.
 * Each migration and its version bump commit together, so a crash never leaves a half-migrated schema.
 *
 * Foreign keys are switched off while migrations run, so a migration can rebuild a table
 * (create new, copy, drop old, rename), which is SQLite's way to change a column constraint.
 * Before each migration commits, `foreign_key_check` must come back empty, so a migration can
 * never leave broken references behind.
 */
export async function migrate(db: SQLiteDatabase, migrations: Migration[]): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current < migrations.length) {
    await db.execAsync('PRAGMA foreign_keys = OFF;'); // has no effect inside a transaction, so set it here
    try {
      for (let version = current; version < migrations.length; version++) {
        const step = migrations[version];
        await db.withTransactionAsync(async () => {
          await step(db);
          const broken = await db.getAllAsync<{ table: string }>('PRAGMA foreign_key_check');
          if (broken.length > 0) {
            throw new Error(`Migration ${version + 1} left broken references in "${broken[0].table}".`);
          }
          await db.execAsync(`PRAGMA user_version = ${version + 1}`);
        });
      }
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
  } else {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}

export async function getSchemaVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}
