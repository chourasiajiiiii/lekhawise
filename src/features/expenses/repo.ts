import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyDataChanged } from '@/core/db/events';
import type { IconName } from '@/core/ui';
import { addDays, type Frequency, type ISODate, type MonthKey, todayISO } from '@/core/utils/date';
import { newId } from '@/core/utils/id';
import { parseAmount } from '@/core/utils/money';

import { ADJUST_IN_CATEGORY_ID, ADJUST_OUT_CATEGORY_ID } from './defaults';
import { processRecurring } from './recurring';
import { computeDueOccurrences } from './schedule';
import { getCurrency } from './settings';
import type {
  Account,
  AccountType,
  AccountWithBalance,
  Category,
  CategoryType,
  RecurringMode,
  RecurringRule,
  Split,
  Transaction,
  TransactionView,
  TxType,
} from './types';

/*
 * All SQL lives in the repo files. Screens call these functions through useQuery() and never
 * write SQL themselves, so the schema can change in one place.
 */

// ---------------------------------------------------------------- accounts

/** SQL for an account's balance: opening balance plus everything that moved in or out. */
const BALANCE_SQL = `
  a.opening_balance
  + coalesce((select sum(case when t.type = 'income' then t.amount else -t.amount end)
              from transactions t where t.account_id = a.id), 0)
  + coalesce((select sum(t.amount) from transactions t
              where t.type = 'transfer' and t.to_account_id = a.id), 0)`;

export type AccountListOptions = {
  includeArchived?: boolean;
  /** 'money' (default): cash, bank, cards, wallets. 'loans': loan accounts only. 'all': both. */
  kind?: 'money' | 'loans' | 'all';
};

export function listAccounts(db: SQLiteDatabase, options: AccountListOptions = {}): Promise<AccountWithBalance[]> {
  const kind = options.kind ?? 'money';
  return db.getAllAsync<AccountWithBalance>(
    `select a.*, ${BALANCE_SQL} as balance
     from accounts a
     where (?1 = 1 or a.archived = 0)
       and (?2 = 'all' or (?2 = 'loans') = (a.type = 'loan'))
     order by a.archived, a.sort_order, a.name collate nocase`,
    options.includeArchived ? 1 : 0, kind,
  );
}

export function getAccount(db: SQLiteDatabase, id: string): Promise<Account | null> {
  return db.getFirstAsync<Account>('select * from accounts where id = ?', id);
}

export async function getAccountBalance(db: SQLiteDatabase, id: string, onOrBefore?: ISODate): Promise<number> {
  const row = await db.getFirstAsync<{ balance: number }>(
    `select a.opening_balance
       + coalesce((select sum(case when t.type = 'income' then t.amount else -t.amount end)
                   from transactions t where t.account_id = a.id and (?2 is null or t.date <= ?2)), 0)
       + coalesce((select sum(t.amount) from transactions t
                   where t.type = 'transfer' and t.to_account_id = a.id and (?2 is null or t.date <= ?2)), 0)
       as balance
     from accounts a where a.id = ?1`,
    id, onOrBefore ?? null,
  );
  return row?.balance ?? 0;
}

export type AccountInput = {
  name: string;
  type: AccountType;
  icon: IconName;
  color: string;
  opening_balance: number;
};

export async function saveAccount(db: SQLiteDatabase, id: string | null, input: AccountInput): Promise<string> {
  if (id) {
    await db.runAsync(
      'update accounts set name = ?, type = ?, icon = ?, color = ?, opening_balance = ? where id = ?',
      input.name, input.type, input.icon, input.color, input.opening_balance, id,
    );
  } else {
    id = newId();
    const max = await db.getFirstAsync<{ m: number | null }>('select max(sort_order) as m from accounts');
    await db.runAsync(
      `insert into accounts (id, name, type, icon, color, opening_balance, sort_order, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.name, input.type, input.icon, input.color, input.opening_balance,
      (max?.m ?? 0) + 1, new Date().toISOString(),
    );
  }
  notifyDataChanged();
  return id;
}

export async function setAccountArchived(db: SQLiteDatabase, id: string, archived: boolean): Promise<void> {
  await db.runAsync('update accounts set archived = ? where id = ?', archived ? 1 : 0, id);
  notifyDataChanged();
}

/** Deletes an unused account; archives it instead when transactions use it. */
export async function deleteOrArchiveAccount(db: SQLiteDatabase, id: string): Promise<'deleted' | 'archived'> {
  const used = await db.getFirstAsync<{ n: number }>(
    `select (select count(*) from transactions where account_id = ?1 or to_account_id = ?1 or loan_id = ?1)
          + (select count(*) from recurring where account_id = ?1 or to_account_id = ?1) as n`,
    id,
  );
  if ((used?.n ?? 0) > 0) {
    await setAccountArchived(db, id, true);
    return 'archived';
  }
  await db.runAsync('delete from accounts where id = ?', id);
  notifyDataChanged();
  return 'deleted';
}

/**
 * Reconciliation: the user enters the balance their bank or wallet shows. Any difference is
 * recorded as a "Balance adjustment" entry dated `date`, so the books match from then on.
 * Returns the adjustment made (0 when the balance already matched).
 */
export async function reconcileAccount(
  db: SQLiteDatabase,
  id: string,
  actualBalance: number,
  date: ISODate = todayISO(),
): Promise<number> {
  const current = await getAccountBalance(db, id, date);
  const difference = actualBalance - current;
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    if (difference !== 0) {
      await db.runAsync(
        `insert into transactions (id, type, amount, category_id, account_id, date, note, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), difference > 0 ? 'income' : 'expense', Math.abs(difference),
        difference > 0 ? ADJUST_IN_CATEGORY_ID : ADJUST_OUT_CATEGORY_ID, id, date, 'Reconciliation', now, now,
      );
    }
    await db.runAsync(
      'update accounts set reconciled_date = ?, reconciled_balance = ? where id = ?',
      date, actualBalance, id,
    );
  });
  notifyDataChanged();
  return difference;
}

export type StatementLine = TransactionView & { change: number; running: number };
export type Statement = { opening: number; closing: number; moneyIn: number; moneyOut: number; lines: StatementLine[] };

/** An account statement for a period: opening balance, every movement with a running balance, closing balance. */
export async function accountStatement(
  db: SQLiteDatabase,
  accountId: string,
  from: ISODate,
  to: ISODate,
): Promise<Statement> {
  const opening = await getAccountBalance(db, accountId, addDays(from, -1));
  const rows = await listTransactions(db, { accountId, from, to });
  rows.reverse(); // oldest first
  let running = opening;
  let moneyIn = 0;
  let moneyOut = 0;
  const lines = rows.map((t) => {
    const incoming = t.type === 'income' || (t.type === 'transfer' && t.to_account_id === accountId);
    const change = incoming ? t.amount : -t.amount;
    if (change > 0) moneyIn += change;
    else moneyOut -= change;
    running += change;
    return { ...t, change, running };
  });
  return { opening, closing: running, moneyIn, moneyOut, lines };
}

// ---------------------------------------------------------------- categories

export function listCategories(
  db: SQLiteDatabase,
  type?: CategoryType,
  includeArchived = false,
): Promise<Category[]> {
  // Parents are followed by their subcategories, so lists can indent them.
  return db.getAllAsync<Category>(
    `select c.* from categories c
     left join categories p on p.id = c.parent_id
     where (?1 is null or c.type = ?1) and (?2 = 1 or c.archived = 0)
     order by c.archived, coalesce(p.sort_order, c.sort_order), coalesce(p.name, c.name) collate nocase,
       c.parent_id is not null, c.sort_order, c.name collate nocase`,
    type ?? null, includeArchived ? 1 : 0,
  );
}

export function getCategory(db: SQLiteDatabase, id: string): Promise<Category | null> {
  return db.getFirstAsync<Category>('select * from categories where id = ?', id);
}

export type CategoryInput = {
  name: string;
  type: CategoryType;
  icon: IconName;
  color: string;
  parent_id?: string | null;
};

export async function saveCategory(db: SQLiteDatabase, id: string | null, input: CategoryInput): Promise<string> {
  const parentId = input.parent_id ?? null;
  if (parentId) {
    const parent = await getCategory(db, parentId);
    if (!parent || parent.parent_id || parent.type !== input.type || parent.id === id) {
      throw new Error('A subcategory needs a main category of the same type.');
    }
    if (id) {
      const children = await db.getFirstAsync<{ n: number }>('select count(*) as n from categories where parent_id = ?', id);
      if ((children?.n ?? 0) > 0) throw new Error('A category with subcategories cannot become a subcategory.');
    }
  }
  if (id) {
    await db.runAsync(
      'update categories set name = ?, icon = ?, color = ?, parent_id = ? where id = ?',
      input.name, input.icon, input.color, parentId, id,
    );
  } else {
    id = newId();
    const max = await db.getFirstAsync<{ m: number | null }>('select max(sort_order) as m from categories');
    await db.runAsync(
      'insert into categories (id, name, type, icon, color, sort_order, parent_id) values (?, ?, ?, ?, ?, ?, ?)',
      id, input.name, input.type, input.icon, input.color, (max?.m ?? 0) + 1, parentId,
    );
  }
  notifyDataChanged();
  return id;
}

export async function setCategoryArchived(db: SQLiteDatabase, id: string, archived: boolean): Promise<void> {
  await db.runAsync('update categories set archived = ?1 where id = ?2 or parent_id = ?2', archived ? 1 : 0, id);
  notifyDataChanged();
}

/** Deletes an unused category; archives it instead when history refers to it or it has subcategories. */
export async function deleteOrArchiveCategory(db: SQLiteDatabase, id: string): Promise<'deleted' | 'archived'> {
  const used = await db.getFirstAsync<{ n: number }>(
    `select (select count(*) from transactions where category_id = ?1)
          + (select count(*) from transaction_splits where category_id = ?1)
          + (select count(*) from recurring where category_id = ?1)
          + (select count(*) from categories where parent_id = ?1) as n`,
    id,
  );
  if ((used?.n ?? 0) > 0) {
    await setCategoryArchived(db, id, true);
    return 'archived';
  }
  await db.runAsync('delete from categories where id = ?', id); // budgets cascade, templates set null
  notifyDataChanged();
  return 'deleted';
}

// ---------------------------------------------------------------- transactions

const TX_VIEW_SELECT = `
  select t.*,
    c.name as category_name, c.icon as category_icon, c.color as category_color,
    a.name as account_name, ta.name as to_account_name,
    (select count(*) from transaction_splits s where s.transaction_id = t.id) as split_count,
    (select count(*) from attachments x where x.transaction_id = t.id) as attachment_count,
    (select group_concat(g.name, ', ') from transaction_tags tt join tags g on g.id = tt.tag_id
      where tt.transaction_id = t.id) as tag_names
  from transactions t
  left join categories c on c.id = t.category_id
  join accounts a on a.id = t.account_id
  left join accounts ta on ta.id = t.to_account_id`;

export type TransactionFilter = {
  from?: ISODate;
  to?: ISODate;
  type?: TxType;
  /** Includes the category's subcategories and split lines in it. */
  categoryId?: string;
  accountId?: string;
  tagId?: string;
  recurringId?: string;
  /** Everything that touched a loan: transfers in and out plus its interest entries. */
  loanId?: string;
  search?: string;
  limit?: number;
};

export function listTransactions(db: SQLiteDatabase, filter: TransactionFilter = {}): Promise<TransactionView[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.from) {
    where.push('t.date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('t.date <= ?');
    params.push(filter.to);
  }
  if (filter.type) {
    where.push('t.type = ?');
    params.push(filter.type);
  }
  if (filter.categoryId) {
    where.push(
      `(t.category_id in (select id from categories where id = ? or parent_id = ?)
        or exists (select 1 from transaction_splits s where s.transaction_id = t.id
                   and s.category_id in (select id from categories where id = ? or parent_id = ?)))`,
    );
    params.push(filter.categoryId, filter.categoryId, filter.categoryId, filter.categoryId);
  }
  if (filter.accountId) {
    where.push('(t.account_id = ? or t.to_account_id = ?)');
    params.push(filter.accountId, filter.accountId);
  }
  if (filter.tagId) {
    where.push('exists (select 1 from transaction_tags tt where tt.transaction_id = t.id and tt.tag_id = ?)');
    params.push(filter.tagId);
  }
  if (filter.loanId) {
    where.push('(t.account_id = ? or t.to_account_id = ? or t.loan_id = ?)');
    params.push(filter.loanId, filter.loanId, filter.loanId);
  }
  if (filter.recurringId) {
    where.push('t.recurring_id = ?');
    params.push(filter.recurringId);
  }
  const search = filter.search?.trim();
  if (search) {
    // Matches note, category, account or tag name, or the exact amount ("250" finds 250.00).
    const like = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(
      `(t.note like ? escape '\\' or c.name like ? escape '\\' or a.name like ? escape '\\'
        or exists (select 1 from transaction_tags tt join tags g on g.id = tt.tag_id
                   where tt.transaction_id = t.id and g.name like ? escape '\\')
        or t.amount = ?)`,
    );
    params.push(like, like, like, like, parseAmount(search, { currency: getCurrency() }) ?? -1);
  }
  let sql = TX_VIEW_SELECT;
  if (where.length) sql += ` where ${where.join(' and ')}`;
  sql += ' order by t.date desc, t.created_at desc';
  if (filter.limit) sql += ` limit ${Math.floor(filter.limit)}`;
  return db.getAllAsync<TransactionView>(sql, params);
}

export function getTransaction(db: SQLiteDatabase, id: string): Promise<Transaction | null> {
  return db.getFirstAsync<Transaction>('select * from transactions where id = ?', id);
}

export function getSplits(db: SQLiteDatabase, transactionId: string): Promise<Required<Split>[]> {
  return db.getAllAsync<Required<Split>>(
    'select id, category_id, amount, note from transaction_splits where transaction_id = ? order by sort_order',
    transactionId,
  );
}

export async function getTransactionTagIds(db: SQLiteDatabase, transactionId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ tag_id: string }>(
    'select tag_id from transaction_tags where transaction_id = ?',
    transactionId,
  );
  return rows.map((r) => r.tag_id);
}

export type TransactionInput = {
  type: TxType;
  amount: number;
  category_id: string | null;
  account_id: string;
  to_account_id: string | null;
  date: ISODate;
  note: string;
  /** Two or more lines that add up to `amount`; replaces the single category. */
  splits?: Split[];
  tagIds?: string[];
  loan_id?: string | null;
};

export function validateTransaction(input: TransactionInput): string | null {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return 'Enter an amount greater than zero.';
  if (!input.account_id) return 'Choose an account.';
  if (input.type === 'transfer') {
    if (!input.to_account_id) return 'Choose the account to transfer to.';
    if (input.to_account_id === input.account_id) return 'Pick two different accounts for a transfer.';
    return null;
  }
  const splits = input.splits ?? [];
  if (splits.length > 0) {
    if (splits.length < 2) return 'A split needs at least two parts.';
    if (splits.some((s) => !s.category_id)) return 'Choose a category for every part of the split.';
    if (splits.some((s) => !Number.isSafeInteger(s.amount) || s.amount <= 0)) return 'Every part of the split needs an amount.';
    const total = splits.reduce((sum, s) => sum + s.amount, 0);
    if (total !== input.amount) return 'The parts of the split must add up to the total amount.';
    return null;
  }
  if (!input.category_id) return 'Choose a category.';
  return null;
}

function normalise(input: TransactionInput): TransactionInput {
  if (input.type === 'transfer') return { ...input, category_id: null, splits: [] };
  const splits = input.splits ?? [];
  return { ...input, to_account_id: null, category_id: splits.length ? null : input.category_id };
}

export async function saveTransaction(db: SQLiteDatabase, id: string | null, raw: TransactionInput): Promise<string> {
  const input = normalise(raw);
  const now = new Date().toISOString();
  const txId = id ?? newId();
  await db.withTransactionAsync(async () => {
    if (id) {
      await db.runAsync(
        `update transactions set type = ?, amount = ?, category_id = ?, account_id = ?, to_account_id = ?,
           date = ?, note = ?, loan_id = ?, updated_at = ? where id = ?`,
        input.type, input.amount, input.category_id, input.account_id, input.to_account_id,
        input.date, input.note, input.loan_id ?? null, now, id,
      );
    } else {
      await db.runAsync(
        `insert into transactions
           (id, type, amount, category_id, account_id, to_account_id, date, note, loan_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        txId, input.type, input.amount, input.category_id, input.account_id, input.to_account_id,
        input.date, input.note, input.loan_id ?? null, now, now,
      );
    }
    await writeSplits(db, txId, input.splits ?? []);
    if (raw.tagIds) await writeTags(db, txId, raw.tagIds);
  });
  notifyDataChanged();
  return txId;
}

async function writeSplits(db: SQLiteDatabase, transactionId: string, splits: Split[]): Promise<void> {
  await db.runAsync('delete from transaction_splits where transaction_id = ?', transactionId);
  for (const [i, s] of splits.entries()) {
    await db.runAsync(
      'insert into transaction_splits (id, transaction_id, category_id, amount, note, sort_order) values (?, ?, ?, ?, ?, ?)',
      newId(), transactionId, s.category_id, s.amount, s.note.trim(), i,
    );
  }
}

async function writeTags(db: SQLiteDatabase, transactionId: string, tagIds: string[]): Promise<void> {
  await db.runAsync('delete from transaction_tags where transaction_id = ?', transactionId);
  for (const tagId of new Set(tagIds)) {
    await db.runAsync('insert into transaction_tags (transaction_id, tag_id) values (?, ?)', transactionId, tagId);
  }
}

export async function deleteTransaction(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from transactions where id = ?', id); // splits, tags and photo rows cascade
  notifyDataChanged();
}

export async function countTransactions(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('select count(*) as n from transactions');
  return row?.n ?? 0;
}

/**
 * Likely duplicates of an entry about to be saved: same type, amount and account within a day.
 * Ignores the entry itself when editing.
 */
export function findPossibleDuplicates(
  db: SQLiteDatabase,
  input: Pick<TransactionInput, 'type' | 'amount' | 'account_id' | 'date'>,
  excludeId: string | null = null,
): Promise<TransactionView[]> {
  return db.getAllAsync<TransactionView>(
    `${TX_VIEW_SELECT}
     where t.type = ? and t.amount = ? and t.account_id = ? and t.date between ? and ? and t.id is not ?
     order by t.date desc limit 5`,
    input.type, input.amount, input.account_id, addDays(input.date, -1), addDays(input.date, 1), excludeId,
  );
}

/** Groups of entries that look like duplicates of each other, newest first. */
export async function listDuplicateGroups(db: SQLiteDatabase): Promise<TransactionView[][]> {
  const rows = await db.getAllAsync<TransactionView>(
    `${TX_VIEW_SELECT}
     where exists (select 1 from transactions o
                   where o.account_id = t.account_id and o.type = t.type and o.amount = t.amount
                     and o.date between date(t.date, '-1 day') and date(t.date, '+1 day') and o.id <> t.id)
     order by t.account_id, t.type, t.amount, t.date`,
  );
  const groups: TransactionView[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (
      prev && prev.account_id === row.account_id && prev.type === row.type && prev.amount === row.amount &&
      addDays(prev.date, 1) >= row.date
    ) {
      last.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups.filter((g) => g.length > 1).sort((a, b) => (a[0].date < b[0].date ? 1 : -1));
}

// ---------------------------------------------------------------- bulk operations

function placeholders(ids: string[]): string {
  return ids.map(() => '?').join(', ');
}

export async function bulkDelete(db: SQLiteDatabase, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.runAsync(`delete from transactions where id in (${placeholders(ids)})`, ids);
  notifyDataChanged();
}

/** Moves the selected expenses or income to a category of the same type; others are left alone. */
export async function bulkSetCategory(db: SQLiteDatabase, ids: string[], categoryId: string): Promise<number> {
  if (!ids.length) return 0;
  const category = await getCategory(db, categoryId);
  if (!category) return 0;
  let changed = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `update transactions set category_id = ?, updated_at = ?
       where id in (${placeholders(ids)}) and type = ?
         and not exists (select 1 from transaction_splits s where s.transaction_id = transactions.id)`,
      categoryId, new Date().toISOString(), ...ids, category.type,
    );
    changed = result.changes;
  });
  notifyDataChanged();
  return changed;
}

export async function bulkSetAccount(db: SQLiteDatabase, ids: string[], accountId: string): Promise<number> {
  if (!ids.length) return 0;
  const result = await db.runAsync(
    `update transactions set account_id = ?, updated_at = ?
     where id in (${placeholders(ids)}) and (to_account_id is null or to_account_id <> ?)`,
    accountId, new Date().toISOString(), ...ids, accountId,
  );
  notifyDataChanged();
  return result.changes;
}

export async function bulkAddTag(db: SQLiteDatabase, ids: string[], tagId: string): Promise<void> {
  if (!ids.length) return;
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await db.runAsync('insert or ignore into transaction_tags (transaction_id, tag_id) values (?, ?)', id, tagId);
    }
  });
  notifyDataChanged();
}

// ---------------------------------------------------------------- reports

export type PeriodSummary = { income: number; expense: number };

export async function periodSummary(db: SQLiteDatabase, from: ISODate, to: ISODate): Promise<PeriodSummary> {
  const row = await db.getFirstAsync<PeriodSummary>(
    `select
       coalesce(sum(case when type = 'income' then amount end), 0) as income,
       coalesce(sum(case when type = 'expense' then amount end), 0) as expense
     from transactions where date between ? and ?`,
    from, to,
  );
  return row ?? { income: 0, expense: 0 };
}

export type CategoryTotal = { id: string; name: string; icon: IconName; color: string; total: number };

/** Totals per main category (subcategories and split lines roll up into it), largest first. */
export function categoryTotals(
  db: SQLiteDatabase,
  from: ISODate,
  to: ISODate,
  type: CategoryType = 'expense',
): Promise<CategoryTotal[]> {
  return db.getAllAsync<CategoryTotal>(
    `select p.id, p.name, p.icon, p.color, sum(l.amount) as total
     from tx_lines l
     join categories c on c.id = l.category_id
     join categories p on p.id = coalesce(c.parent_id, c.id)
     where l.type = ? and l.date between ? and ?
     group by p.id order by total desc`,
    type, from, to,
  );
}

/** Totals for a main category broken down into itself and its subcategories. */
export function subcategoryTotals(
  db: SQLiteDatabase,
  parentId: string,
  from: ISODate,
  to: ISODate,
): Promise<CategoryTotal[]> {
  return db.getAllAsync<CategoryTotal>(
    `select c.id, c.name, c.icon, c.color, sum(l.amount) as total
     from tx_lines l join categories c on c.id = l.category_id
     where (c.id = ?1 or c.parent_id = ?1) and l.type in ('expense', 'income') and l.date between ?2 and ?3
     group by c.id order by total desc`,
    parentId, from, to,
  );
}

export type MonthTotal = { month: MonthKey; income: number; expense: number };

export async function monthlyTotals(db: SQLiteDatabase, months: MonthKey[]): Promise<MonthTotal[]> {
  if (months.length === 0) return [];
  const rows = await db.getAllAsync<MonthTotal>(
    `select substr(date, 1, 7) as month,
       coalesce(sum(case when type = 'income' then amount end), 0) as income,
       coalesce(sum(case when type = 'expense' then amount end), 0) as expense
     from transactions where date between ? and ?
     group by month`,
    `${months[0]}-01`, `${months[months.length - 1]}-31`,
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months.map((month) => byMonth.get(month) ?? { month, income: 0, expense: 0 });
}

export type DayTotal = { date: ISODate; income: number; expense: number; count: number };

/** Per-day totals for the calendar. */
export function dailyTotals(db: SQLiteDatabase, from: ISODate, to: ISODate): Promise<DayTotal[]> {
  return db.getAllAsync<DayTotal>(
    `select date,
       coalesce(sum(case when type = 'income' then amount end), 0) as income,
       coalesce(sum(case when type = 'expense' then amount end), 0) as expense,
       count(*) as count
     from transactions where date between ? and ? group by date order by date`,
    from, to,
  );
}

export type TagTotal = { id: string; name: string; color: string; expense: number; income: number; count: number };

export function tagTotals(db: SQLiteDatabase, from: ISODate, to: ISODate): Promise<TagTotal[]> {
  return db.getAllAsync<TagTotal>(
    `select g.id, g.name, g.color,
       coalesce(sum(case when t.type = 'expense' then t.amount end), 0) as expense,
       coalesce(sum(case when t.type = 'income' then t.amount end), 0) as income,
       count(*) as count
     from transaction_tags tt join tags g on g.id = tt.tag_id join transactions t on t.id = tt.transaction_id
     where t.date between ? and ?
     group by g.id order by expense desc, income desc`,
    from, to,
  );
}

// ---------------------------------------------------------------- recurring

export type RecurringView = RecurringRule & {
  category_name: string | null;
  category_icon: IconName | null;
  category_color: string | null;
  account_name: string;
  to_account_name: string | null;
};

const RECURRING_VIEW_SELECT = `
  select r.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
    a.name as account_name, ta.name as to_account_name
  from recurring r
  left join categories c on c.id = r.category_id
  join accounts a on a.id = r.account_id
  left join accounts ta on ta.id = r.to_account_id`;

export function listRecurring(db: SQLiteDatabase): Promise<RecurringView[]> {
  return db.getAllAsync<RecurringView>(`${RECURRING_VIEW_SELECT} order by r.active desc, r.next_date`);
}

export function getRecurring(db: SQLiteDatabase, id: string): Promise<RecurringView | null> {
  return db.getFirstAsync<RecurringView>(`${RECURRING_VIEW_SELECT} where r.id = ?`, id);
}

/** Bills waiting to be marked as paid that are due on or before `until` (overdue ones included). */
export function listUpcomingBills(db: SQLiteDatabase, until: ISODate): Promise<RecurringView[]> {
  return db.getAllAsync<RecurringView>(
    `${RECURRING_VIEW_SELECT} where r.active = 1 and r.mode = 'remind' and r.next_date <= ? order by r.next_date`,
    until,
  );
}

export type RecurringOptions = {
  endDate?: ISODate | null;
  mode?: RecurringMode;
  remindDays?: number | null;
};

/**
 * Creates a recurring rule starting on input.date. Automatic rules immediately create any
 * occurrences that are already due (including today's); bill reminders wait to be marked paid.
 */
export async function createRecurring(
  db: SQLiteDatabase,
  raw: TransactionInput,
  frequency: Frequency,
  options: RecurringOptions = {},
): Promise<string> {
  const input = normalise({ ...raw, splits: [] });
  const id = newId();
  await db.runAsync(
    `insert into recurring
       (id, type, amount, category_id, account_id, to_account_id, note, frequency, start_date, end_date,
        generated_count, next_date, active, created_at, mode, remind_days)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?)`,
    id, input.type, input.amount, input.category_id, input.account_id, input.to_account_id, input.note,
    frequency, input.date, options.endDate ?? null, input.date, new Date().toISOString(),
    options.mode ?? 'auto', options.remindDays ?? null,
  );
  await processRecurring(db, todayISO());
  notifyDataChanged();
  return id;
}

export type RecurringUpdate = {
  amount: number;
  note: string;
  account_id: string;
  category_id: string | null;
  to_account_id: string | null;
  mode: RecurringMode;
  remind_days: number | null;
  end_date: ISODate | null;
};

/** Changes future occurrences of a rule. Entries already created stay as they are. */
export async function updateRecurring(db: SQLiteDatabase, id: string, update: RecurringUpdate): Promise<void> {
  await db.runAsync(
    `update recurring set amount = ?, note = ?, account_id = ?, category_id = ?, to_account_id = ?, mode = ?,
       remind_days = ?, end_date = ? where id = ?`,
    update.amount, update.note, update.account_id, update.category_id, update.to_account_id, update.mode,
    update.remind_days, update.end_date, id,
  );
  await processRecurring(db, todayISO());
  notifyDataChanged();
}

export async function setRecurringActive(db: SQLiteDatabase, id: string, active: boolean): Promise<void> {
  await db.runAsync('update recurring set active = ? where id = ?', active ? 1 : 0, id);
  if (active) await processRecurring(db, todayISO());
  notifyDataChanged();
}

/**
 * Marks the next due occurrence of a bill as paid: creates the transaction (with the amount actually
 * paid and the payment date) and moves the rule to the following due date.
 */
export async function markRecurringPaid(
  db: SQLiteDatabase,
  id: string,
  paid: { amount: number; date: ISODate; account_id: string },
): Promise<string | null> {
  const rule = await db.getFirstAsync<RecurringRule>('select * from recurring where id = ?', id);
  if (!rule || !rule.active) return null;
  const txId = newId();
  const now = new Date().toISOString();
  const next = computeDueOccurrences({ ...rule, end_date: rule.end_date }, rule.next_date);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `insert into transactions
         (id, type, amount, category_id, account_id, to_account_id, date, note, recurring_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      txId, rule.type, paid.amount, rule.category_id, paid.account_id,
      rule.type === 'transfer' ? rule.to_account_id : null, paid.date, rule.note, rule.id, now, now,
    );
    await advanceRule(db, rule, next.generatedCount, next.nextDate, next.active);
  });
  notifyDataChanged();
  return txId;
}

/** Skips the next due occurrence of a bill without recording a payment. */
export async function skipRecurring(db: SQLiteDatabase, id: string): Promise<void> {
  const rule = await db.getFirstAsync<RecurringRule>('select * from recurring where id = ?', id);
  if (!rule || !rule.active) return;
  const next = computeDueOccurrences(rule, rule.next_date);
  await advanceRule(db, rule, next.generatedCount, next.nextDate, next.active);
  notifyDataChanged();
}

async function advanceRule(db: SQLiteDatabase, rule: RecurringRule, count: number, nextDate: ISODate, active: boolean) {
  await db.runAsync(
    'update recurring set generated_count = ?, next_date = ?, active = ? where id = ?',
    count, nextDate, active ? 1 : 0, rule.id,
  );
}

/** Deletes the rule. Transactions it already created stay in history. */
export async function deleteRecurring(db: SQLiteDatabase, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('update transactions set recurring_id = null where recurring_id = ?', id);
    await db.runAsync('delete from recurring where id = ?', id);
  });
  notifyDataChanged();
}
