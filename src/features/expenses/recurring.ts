import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyDataChanged } from '@/core/db/events';
import type { ISODate } from '@/core/utils/date';
import { newId } from '@/core/utils/id';

import { computeDueOccurrences } from './schedule';
import type { RecurringRule } from './types';

/**
 * Creates every recurring transaction that has become due. Runs at startup and
 * whenever the app returns to the foreground. No background jobs or servers:
 * if the phone was off for a week, the missed entries are created on next open.
 * Returns the number of transactions created.
 */
export function processRecurring(db: SQLiteDatabase, today: ISODate): Promise<number> {
  // Two quick foreground events must not both read the same due rules and create duplicates.
  let pending = inFlight.get(db);
  if (!pending) {
    pending = run(db, today).finally(() => inFlight.delete(db));
    inFlight.set(db, pending);
  }
  return pending;
}

const inFlight = new WeakMap<SQLiteDatabase, Promise<number>>();

async function run(db: SQLiteDatabase, today: ISODate): Promise<number> {
  const rules = await db.getAllAsync<RecurringRule>(
    "select * from recurring where active = 1 and mode = 'auto' and next_date <= ?",
    today,
  );
  if (rules.length === 0) return 0;

  let created = 0;
  await db.withTransactionAsync(async () => {
    const now = new Date().toISOString();
    for (const rule of rules) {
      const result = computeDueOccurrences(rule, today);
      for (const date of result.dueDates) {
        await db.runAsync(
          `insert into transactions
             (id, type, amount, category_id, account_id, to_account_id, date, note, recurring_id, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId(), rule.type, rule.amount, rule.category_id, rule.account_id, rule.to_account_id,
          date, rule.note, rule.id, now, now,
        );
        created += 1;
      }
      await db.runAsync(
        'update recurring set generated_count = ?, next_date = ?, active = ? where id = ?',
        result.generatedCount, result.nextDate, result.active ? 1 : 0, rule.id,
      );
    }
  });

  if (created > 0) notifyDataChanged();
  return created;
}
