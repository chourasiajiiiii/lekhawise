/// <reference types="node" />
import type { SQLiteDatabase } from 'expo-sqlite';
// Node 22.5+ ships SQLite; tests use it so real SQL runs without a phone.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

type Params = unknown[];

const normalise = (params: Params): SQLInputValue[] =>
  (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as SQLInputValue[];

/**
 * An in-memory database exposing the subset of the expo-sqlite API the app uses.
 * Test-only: lets repository code run under Jest on a computer.
 */
export function createTestDatabase(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  const db = {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    runAsync: async (sql: string, ...params: Params) => {
      const result = raw.prepare(sql).run(...normalise(params));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    getAllAsync: async (sql: string, ...params: Params) =>
      raw.prepare(sql).all(...normalise(params)).map((row: object) => ({ ...row })),
    getFirstAsync: async (sql: string, ...params: Params) => {
      const row = raw.prepare(sql).get(...normalise(params));
      return row ? { ...row } : null;
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('begin');
      try {
        await task();
        raw.exec('commit');
      } catch (error) {
        raw.exec('rollback');
        throw error;
      }
    },
    closeAsync: async () => {
      if (raw.isOpen) raw.close();
    },
  };
  return db as unknown as SQLiteDatabase;
}
