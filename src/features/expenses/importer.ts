import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyDataChanged } from '@/core/db/events';
import { addDays, type ISODate } from '@/core/utils/date';
import { newId } from '@/core/utils/id';

import type { ImportRow } from './csvImport';
import type { TxType } from './types';

export type PreparedRow = {
  line: number;
  date: ISODate;
  type: TxType;
  amount: number;
  note: string;
  category_id: string | null;
  category_name: string | null;
  account_id: string;
  to_account_id: string | null;
  /** Looks like an entry already in the app (same type, amount and account within a day). */
  duplicate: boolean;
  error: string | null;
};

const FALLBACK_CATEGORY: Record<'expense' | 'income', string> = { expense: 'cat_other_out', income: 'cat_other_in' };

/**
 * Resolves names in the file to categories and accounts in the app and flags likely duplicates.
 * Category names that do not exist fall back to "Other"; unknown account names use `defaultAccountId`.
 */
export async function prepareImport(
  db: SQLiteDatabase,
  rows: ImportRow[],
  defaultAccountId: string,
): Promise<PreparedRow[]> {
  const [categories, accounts] = await Promise.all([
    db.getAllAsync<{ id: string; name: string; type: string; archived: number }>('select id, name, type, archived from categories'),
    db.getAllAsync<{ id: string; name: string }>('select id, name from accounts'),
  ]);
  const findCategory = (name: string, type: string) => {
    const key = name.trim().toLowerCase();
    if (!key) return undefined;
    const matches = categories.filter((c) => c.type === type && c.name.toLowerCase() === key);
    return matches.find((c) => !c.archived) ?? matches[0];
  };
  const findAccount = (name: string) => {
    const key = name.trim().toLowerCase();
    return key ? accounts.find((a) => a.name.toLowerCase() === key) : undefined;
  };
  const fallbackName = (type: 'expense' | 'income') => categories.find((c) => c.id === FALLBACK_CATEGORY[type])?.name ?? null;

  const prepared: PreparedRow[] = [];
  for (const row of rows) {
    const accountId = findAccount(row.accountName)?.id ?? defaultAccountId;
    let error = row.error;
    let categoryId: string | null = null;
    let categoryName: string | null = null;
    let toAccountId: string | null = null;
    if (row.type === 'transfer') {
      toAccountId = findAccount(row.toAccountName)?.id ?? null;
      if (!error && !toAccountId) error = 'Transfer target account not found';
      if (!error && toAccountId === accountId) error = 'Transfer to the same account';
    } else {
      const match = findCategory(row.categoryName, row.type);
      categoryId = match?.id ?? FALLBACK_CATEGORY[row.type];
      categoryName = match?.name ?? fallbackName(row.type);
    }
    let duplicate = false;
    if (!error && row.date) {
      const existing = await db.getFirstAsync<{ id: string }>(
        `select id from transactions where type = ? and amount = ? and account_id = ? and date between ? and ? limit 1`,
        row.type, row.amount, accountId, addDays(row.date, -1), addDays(row.date, 1),
      );
      duplicate = existing !== null;
    }
    prepared.push({
      line: row.line,
      date: row.date ?? '',
      type: row.type,
      amount: row.amount,
      note: row.description.slice(0, 200),
      category_id: categoryId,
      category_name: categoryName,
      account_id: accountId,
      to_account_id: toAccountId,
      duplicate,
      error,
    });
  }
  return prepared;
}

const CHUNK = 300;

/** Imports the given rows in one transaction: all of them or, on any error, none. Returns how many were added. */
export async function commitImport(db: SQLiteDatabase, rows: PreparedRow[]): Promise<number> {
  const usable = rows.filter((r) => !r.error);
  if (!usable.length) return 0;
  const now = new Date().toISOString();
  const columns = '(id, type, amount, category_id, account_id, to_account_id, date, note, created_at, updated_at)';
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < usable.length; i += CHUNK) {
      const chunk = usable.slice(i, i + CHUNK);
      await db.runAsync(
        `insert into transactions ${columns} values ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap((r) => [
          newId(), r.type, r.amount, r.category_id, r.account_id, r.to_account_id, r.date, r.note, now, now,
        ]),
      );
    }
  });
  notifyDataChanged();
  return usable.length;
}
