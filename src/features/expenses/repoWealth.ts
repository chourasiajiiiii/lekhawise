import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyDataChanged } from '@/core/db/events';
import type { IconName } from '@/core/ui';
import { type ISODate, type MonthKey, monthBounds, todayISO } from '@/core/utils/date';
import { newId } from '@/core/utils/id';

import { getAccountBalance, listAccounts } from './repo';
import { listLoans } from './repoLoans';
import type { Goal, GoalContribution, Holding, HoldingKind, HoldingValue } from './types';

// ---------------------------------------------------------------- savings goals

export type GoalView = Goal & { saved: number; account_name: string | null };

export async function listGoals(db: SQLiteDatabase, includeArchived = false): Promise<GoalView[]> {
  const goals = await db.getAllAsync<Goal & { contributed: number; account_name: string | null }>(
    `select g.*, a.name as account_name,
       coalesce((select sum(c.amount) from goal_contributions c where c.goal_id = g.id), 0) as contributed
     from goals g left join accounts a on a.id = g.account_id
     where ? = 1 or g.archived = 0
     order by g.archived, g.sort_order, g.name collate nocase`,
    includeArchived ? 1 : 0,
  );
  const result: GoalView[] = [];
  for (const { contributed, ...g } of goals) {
    // A goal linked to an account (say, a savings account) tracks that account's balance.
    const saved = g.account_id ? await getAccountBalance(db, g.account_id) : contributed;
    result.push({ ...g, saved });
  }
  return result;
}

export async function getGoal(db: SQLiteDatabase, id: string): Promise<GoalView | null> {
  return (await listGoals(db, true)).find((g) => g.id === id) ?? null;
}

export type GoalInput = {
  name: string;
  icon: IconName;
  color: string;
  target: number;
  target_date: ISODate | null;
  account_id: string | null;
};

export async function saveGoal(db: SQLiteDatabase, id: string | null, input: GoalInput): Promise<string> {
  if (!input.name.trim()) throw new Error('Give the goal a name.');
  if (!Number.isSafeInteger(input.target) || input.target <= 0) throw new Error('Enter a target amount.');
  if (id) {
    await db.runAsync(
      'update goals set name = ?, icon = ?, color = ?, target = ?, target_date = ?, account_id = ? where id = ?',
      input.name.trim(), input.icon, input.color, input.target, input.target_date, input.account_id, id,
    );
  } else {
    id = newId();
    const max = await db.getFirstAsync<{ m: number | null }>('select max(sort_order) as m from goals');
    await db.runAsync(
      `insert into goals (id, name, icon, color, target, target_date, account_id, sort_order, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.name.trim(), input.icon, input.color, input.target, input.target_date, input.account_id,
      (max?.m ?? 0) + 1, new Date().toISOString(),
    );
  }
  notifyDataChanged();
  return id;
}

export async function setGoalArchived(db: SQLiteDatabase, id: string, archived: boolean): Promise<void> {
  await db.runAsync('update goals set archived = ? where id = ?', archived ? 1 : 0, id);
  notifyDataChanged();
}

export async function deleteGoal(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from goals where id = ?', id);
  notifyDataChanged();
}

export function listContributions(db: SQLiteDatabase, goalId: string): Promise<GoalContribution[]> {
  return db.getAllAsync<GoalContribution>(
    'select * from goal_contributions where goal_id = ? order by date desc, created_at desc',
    goalId,
  );
}

/** Adds money to a goal, or takes it out with a negative amount. */
export async function addContribution(
  db: SQLiteDatabase,
  goalId: string,
  input: { amount: number; date: ISODate; note: string },
): Promise<void> {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new Error('Enter an amount.');
  await db.runAsync(
    'insert into goal_contributions (id, goal_id, date, amount, note, created_at) values (?, ?, ?, ?, ?, ?)',
    newId(), goalId, input.date, input.amount, input.note.trim(), new Date().toISOString(),
  );
  notifyDataChanged();
}

export async function deleteContribution(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from goal_contributions where id = ?', id);
  notifyDataChanged();
}

// ---------------------------------------------------------------- investments and assets

export type HoldingView = Holding & { value: number; value_date: ISODate | null };

const HOLDING_SELECT = `
  select h.*,
    coalesce((select v.value from holding_values v where v.holding_id = h.id
              order by v.date desc, v.created_at desc limit 1), 0) as value,
    (select max(v.date) from holding_values v where v.holding_id = h.id) as value_date
  from holdings h`;

export function listHoldings(db: SQLiteDatabase, kind: HoldingKind, includeArchived = false): Promise<HoldingView[]> {
  return db.getAllAsync<HoldingView>(
    `${HOLDING_SELECT} where h.kind = ? and (? = 1 or h.archived = 0)
     order by h.archived, h.subtype, h.name collate nocase`,
    kind, includeArchived ? 1 : 0,
  );
}

export function getHolding(db: SQLiteDatabase, id: string): Promise<HoldingView | null> {
  return db.getFirstAsync<HoldingView>(`${HOLDING_SELECT} where h.id = ?`, id);
}

export function listHoldingValues(db: SQLiteDatabase, holdingId: string): Promise<HoldingValue[]> {
  return db.getAllAsync<HoldingValue>(
    'select * from holding_values where holding_id = ? order by date desc, created_at desc',
    holdingId,
  );
}

export type HoldingInput = {
  kind: HoldingKind;
  subtype: string;
  name: string;
  invested: number;
  quantity: string;
  note: string;
  purchase_date: ISODate | null;
};

/** Creates a holding with its first value, or edits an existing one's details. */
export async function saveHolding(
  db: SQLiteDatabase,
  id: string | null,
  input: HoldingInput,
  currentValue?: { value: number; date: ISODate },
): Promise<string> {
  if (!input.name.trim()) throw new Error('Enter a name.');
  if (!Number.isSafeInteger(input.invested) || input.invested < 0) throw new Error('Enter a valid amount.');
  const now = new Date().toISOString();
  const holdingId = id ?? newId();
  await db.withTransactionAsync(async () => {
    if (id) {
      await db.runAsync(
        `update holdings set subtype = ?, name = ?, invested = ?, quantity = ?, note = ?, purchase_date = ? where id = ?`,
        input.subtype, input.name.trim(), input.invested, input.quantity.trim(), input.note.trim(), input.purchase_date, id,
      );
    } else {
      await db.runAsync(
        `insert into holdings (id, kind, subtype, name, invested, quantity, note, purchase_date, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        holdingId, input.kind, input.subtype, input.name.trim(), input.invested, input.quantity.trim(),
        input.note.trim(), input.purchase_date, now,
      );
    }
    if (currentValue) {
      await insertValue(db, holdingId, currentValue.value, currentValue.date, now);
    }
  });
  notifyDataChanged();
  return holdingId;
}

async function insertValue(db: SQLiteDatabase, holdingId: string, value: number, date: ISODate, now: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Enter a valid value.');
  await db.runAsync(
    'insert into holding_values (id, holding_id, date, value, created_at) values (?, ?, ?, ?, ?)',
    newId(), holdingId, date, value, now,
  );
}

/** Records today's (or another date's) value. Older values stay for the history. */
export async function updateHoldingValue(db: SQLiteDatabase, holdingId: string, value: number, date: ISODate = todayISO()) {
  await insertValue(db, holdingId, value, date, new Date().toISOString());
  notifyDataChanged();
}

export async function deleteHoldingValue(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from holding_values where id = ?', id);
  notifyDataChanged();
}

/** Sold or disposed of: its value drops to zero from `date` and it moves to the archive. */
export async function markHoldingSold(db: SQLiteDatabase, holdingId: string, date: ISODate = todayISO()): Promise<void> {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await insertValue(db, holdingId, 0, date, now);
    await db.runAsync('update holdings set archived = 1 where id = ?', holdingId);
  });
  notifyDataChanged();
}

export async function deleteHolding(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from holdings where id = ?', id);
  notifyDataChanged();
}

// ---------------------------------------------------------------- net worth

export type NetWorth = {
  cash: number; // money accounts with a positive balance
  lent: number;
  investments: number;
  assets: number;
  cards: number; // money accounts below zero (credit cards, overdrafts), as a positive amount owed
  borrowed: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
};

export async function netWorthNow(db: SQLiteDatabase): Promise<NetWorth> {
  const [accounts, loans, investments, assets] = await Promise.all([
    listAccounts(db, { includeArchived: true }),
    listLoans(db, true),
    listHoldings(db, 'investment'),
    listHoldings(db, 'asset'),
  ]);
  const cash = accounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0);
  const cards = accounts.filter((a) => a.balance < 0).reduce((s, a) => s - a.balance, 0);
  // A loan's balance is what you are owed (positive) or owe (negative); overpaying flips the side.
  const lent = loans.reduce((s, l) => s + Math.max(0, l.direction === 'lent' ? l.outstanding : -l.outstanding), 0);
  const borrowed = loans.reduce((s, l) => s + Math.max(0, l.direction === 'borrowed' ? l.outstanding : -l.outstanding), 0);
  const inv = investments.reduce((s, h) => s + h.value, 0);
  const ast = assets.reduce((s, h) => s + h.value, 0);
  const totalAssets = cash + lent + inv + ast;
  const totalLiabilities = cards + borrowed;
  return {
    cash,
    lent,
    investments: inv,
    assets: ast,
    cards,
    borrowed,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
  };
}

export type NetWorthPoint = { month: MonthKey; netWorth: number };

/**
 * Net worth at the end of each month, worked out from history (no snapshots needed):
 * all account balances (loans included) plus each investment's and asset's latest value by then.
 * Transfers move money between accounts, so the sum of balances only changes with income and expenses.
 */
export async function netWorthHistory(db: SQLiteDatabase, months: MonthKey[]): Promise<NetWorthPoint[]> {
  if (!months.length) return [];
  const [opening, flows, values] = await Promise.all([
    db.getFirstAsync<{ total: number }>('select coalesce(sum(opening_balance), 0) as total from accounts'),
    db.getAllAsync<{ month: MonthKey; net: number }>(
      `select substr(date, 1, 7) as month,
         sum(case when type = 'income' then amount when type = 'expense' then -amount else 0 end) as net
       from transactions group by month order by month`,
    ),
    db.getAllAsync<{ holding_id: string; date: ISODate; value: number }>(
      'select holding_id, date, value from holding_values order by date, created_at',
    ),
  ]);
  return computeNetWorthSeries(months, opening?.total ?? 0, flows, values);
}

/** Pure part of netWorthHistory, unit-tested separately. */
export function computeNetWorthSeries(
  months: MonthKey[],
  opening: number,
  flows: { month: MonthKey; net: number }[],
  values: { holding_id: string; date: ISODate; value: number }[],
): NetWorthPoint[] {
  return months.map((month) => {
    const end = monthBounds(month).end;
    const accounts = opening + flows.filter((f) => f.month <= month).reduce((s, f) => s + f.net, 0);
    const latest = new Map<string, number>();
    for (const v of values) {
      if (v.date <= end) latest.set(v.holding_id, v.value); // values are sorted, so the last one wins
    }
    let holdings = 0;
    latest.forEach((value) => (holdings += value));
    return { month, netWorth: accounts + holdings };
  });
}
