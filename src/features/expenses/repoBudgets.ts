import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyDataChanged } from '@/core/db/events';
import type { IconName } from '@/core/ui';
import { addDays, type ISODate, todayISO, toISODate, type WeekStart } from '@/core/utils/date';
import { newId } from '@/core/utils/id';

import { budgetLevel, bucketByPeriod, carryInto, limitAt, periodBounds, periodKeyOf, shiftPeriod } from './budgetMath';
import type { Budget, BudgetLimit, BudgetPeriod } from './types';

export type BudgetStatus = {
  id: string;
  category_id: string | null; // null = overall budget
  name: string | null;
  icon: IconName | null;
  color: string | null;
  period: BudgetPeriod;
  carry_forward: 0 | 1;
  /** The limit set for this period, before anything carried over. */
  base: number;
  carried: number;
  /** base + carried */
  limit: number;
  spent: number;
};

export type UnbudgetedCategory = { category_id: string; name: string; icon: IconName; color: string; spent: number };

type BudgetRow = Budget & { name: string | null; icon: IconName | null; color: string | null; parent_id: string | null };

/** Spending per category (direct) in a date range, expenses only, split lines included. */
async function spendingByCategory(db: SQLiteDatabase, from: ISODate, to: ISODate) {
  const rows = await db.getAllAsync<{ id: string; parent_id: string | null; spent: number }>(
    `select c.id, c.parent_id, sum(l.amount) as spent
     from tx_lines l join categories c on c.id = l.category_id
     where l.type = 'expense' and l.date between ? and ? group by c.id`,
    from, to,
  );
  const direct = new Map<string, number>();
  const rolled = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    direct.set(r.id, r.spent);
    const top = r.parent_id ?? r.id;
    rolled.set(top, (rolled.get(top) ?? 0) + r.spent);
    total += r.spent;
  }
  return { direct, rolled, total };
}

function scopeSpent(
  spending: Awaited<ReturnType<typeof spendingByCategory>>,
  budget: { category_id: string | null; parent_id: string | null },
): number {
  if (budget.category_id === null) return spending.total;
  return budget.parent_id
    ? (spending.direct.get(budget.category_id) ?? 0)
    : (spending.rolled.get(budget.category_id) ?? 0);
}

async function loadLimits(db: SQLiteDatabase, budgetIds: string[]): Promise<Map<string, BudgetLimit[]>> {
  const map = new Map<string, BudgetLimit[]>();
  if (!budgetIds.length) return map;
  const rows = await db.getAllAsync<BudgetLimit>(
    `select * from budget_limits where budget_id in (${budgetIds.map(() => '?').join(', ')}) order by start`,
    budgetIds,
  );
  for (const row of rows) {
    const list = map.get(row.budget_id) ?? [];
    list.push(row);
    map.set(row.budget_id, list);
  }
  return map;
}

/** Daily spending for one budget's scope, bucketed into its periods. */
async function spentPerPeriod(
  db: SQLiteDatabase,
  budget: BudgetRow,
  from: ISODate,
  to: ISODate,
  weekStart: WeekStart,
): Promise<Map<string, number>> {
  const days = await db.getAllAsync<{ date: ISODate; amount: number }>(
    `select l.date, sum(l.amount) as amount
     from tx_lines l join categories c on c.id = l.category_id
     where l.type = 'expense' and l.date between ?1 and ?2
       and (?3 is null or c.id = ?3 or (?4 = 0 and c.parent_id = ?3))
     group by l.date`,
    from, to, budget.category_id, budget.parent_id ? 1 : 0,
  );
  return bucketByPeriod(days, budget.period, weekStart);
}

/**
 * The first period that counts for carry-forward: the first limit's period, or for budgets
 * migrated from version 1 (whose limit has no real start) the period the budget was created in.
 */
function carryStartKey(budget: Budget, limits: BudgetLimit[], weekStart: WeekStart): string {
  const first = limits[0]?.start;
  if (first && !first.startsWith('0000')) return first;
  return periodKeyOf(toISODate(new Date(budget.created_at)), budget.period, weekStart);
}

async function loadBudgets(db: SQLiteDatabase, period: BudgetPeriod): Promise<BudgetRow[]> {
  return db.getAllAsync<BudgetRow>(
    `select b.*, c.name, c.icon, c.color, c.parent_id
     from budgets b left join categories c on c.id = b.category_id
     where b.period = ? and (b.category_id is null or c.archived = 0)
     order by b.category_id is not null, c.sort_order, c.name collate nocase`,
    period,
  );
}

/**
 * Every budget of a period type as it stood in the period `key`, plus the expense categories
 * without a budget. Budgets created after `key` are left out, so past periods show their history.
 */
export async function listBudgetStatus(
  db: SQLiteDatabase,
  period: BudgetPeriod,
  key: string,
  weekStart: WeekStart,
): Promise<{ budgets: BudgetStatus[]; unbudgeted: UnbudgetedCategory[] }> {
  const { start, end } = periodBounds(key, period);
  const [budgets, spending, categories] = await Promise.all([
    loadBudgets(db, period),
    spendingByCategory(db, start, end),
    db.getAllAsync<{ id: string; name: string; icon: IconName; color: string }>(
      `select id, name, icon, color from categories
       where type = 'expense' and archived = 0 and parent_id is null order by sort_order, name collate nocase`,
    ),
  ]);
  const limits = await loadLimits(db, budgets.map((b) => b.id));

  const result: BudgetStatus[] = [];
  for (const b of budgets) {
    const list = limits.get(b.id) ?? [];
    const base = limitAt(list, key);
    if (base === null) continue;
    let carried = 0;
    if (b.carry_forward) {
      const first = carryStartKey(b, list, weekStart);
      if (first < key) {
        const spent = await spentPerPeriod(db, b, periodBounds(first, period).start, addDays(start, -1), weekStart);
        carried = carryInto(key, first, period, list, (p) => spent.get(p) ?? 0);
      }
    }
    result.push({
      id: b.id,
      category_id: b.category_id,
      name: b.name,
      icon: b.icon,
      color: b.color,
      period: b.period,
      carry_forward: b.carry_forward,
      base,
      carried,
      limit: base + carried,
      spent: scopeSpent(spending, b),
    });
  }

  const budgeted = new Set(result.map((b) => b.category_id));
  const unbudgeted = categories
    .filter((c) => !budgeted.has(c.id))
    .map((c) => ({ category_id: c.id, name: c.name, icon: c.icon, color: c.color, spent: spending.rolled.get(c.id) ?? 0 }));
  return { budgets: result, unbudgeted };
}

/**
 * Sets the amount of a budget from period `key` onwards, creating the budget if needed.
 * Earlier periods keep the amount they had, so history stays accurate.
 */
export async function setBudgetAmount(
  db: SQLiteDatabase,
  scope: { categoryId: string | null; period: BudgetPeriod },
  key: string,
  amount: number,
  carryForward?: boolean,
): Promise<string> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
  let budget = await db.getFirstAsync<Budget>(
    "select * from budgets where coalesce(category_id, '') = ? and period = ?",
    scope.categoryId ?? '', scope.period,
  );
  await db.withTransactionAsync(async () => {
    if (!budget) {
      budget = {
        id: newId(),
        category_id: scope.categoryId,
        period: scope.period,
        carry_forward: carryForward ? 1 : 0,
        created_at: new Date().toISOString(),
      };
      await db.runAsync(
        'insert into budgets (id, category_id, period, carry_forward, created_at) values (?, ?, ?, ?, ?)',
        budget.id, budget.category_id, budget.period, budget.carry_forward, budget.created_at,
      );
    } else if (carryForward !== undefined) {
      await db.runAsync('update budgets set carry_forward = ? where id = ?', carryForward ? 1 : 0, budget.id);
    }
    await db.runAsync(
      `insert into budget_limits (budget_id, start, amount) values (?, ?, ?)
       on conflict (budget_id, start) do update set amount = excluded.amount`,
      budget.id, key, amount,
    );
  });
  notifyDataChanged();
  return budget!.id;
}

export async function setBudgetCarryForward(db: SQLiteDatabase, id: string, carry: boolean): Promise<void> {
  await db.runAsync('update budgets set carry_forward = ? where id = ?', carry ? 1 : 0, id);
  notifyDataChanged();
}

/** Deletes a budget and its history. */
export async function deleteBudget(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from budgets where id = ?', id);
  notifyDataChanged();
}

export type BudgetHistoryRow = { key: string; limit: number; carried: number; spent: number };

/** The last `count` periods of one budget (newest first), skipping periods before it existed. */
export async function budgetHistory(
  db: SQLiteDatabase,
  budgetId: string,
  currentKey: string,
  count: number,
  weekStart: WeekStart,
): Promise<{ budget: BudgetRow | null; rows: BudgetHistoryRow[] }> {
  const budget = await db.getFirstAsync<BudgetRow>(
    `select b.*, c.name, c.icon, c.color, c.parent_id from budgets b left join categories c on c.id = b.category_id
     where b.id = ?`,
    budgetId,
  );
  if (!budget) return { budget: null, rows: [] };
  const limits = (await loadLimits(db, [budget.id])).get(budget.id) ?? [];
  const firstKey = carryStartKey(budget, limits, weekStart);
  const oldest = shiftPeriod(currentKey, budget.period, -(count - 1));
  const from = periodBounds(firstKey < oldest ? firstKey : oldest, budget.period).start;
  const spent = await spentPerPeriod(db, budget, from, periodBounds(currentKey, budget.period).end, weekStart);

  const rows: BudgetHistoryRow[] = [];
  for (let i = 0; i < count; i++) {
    const key = shiftPeriod(currentKey, budget.period, -i);
    const base = limitAt(limits, key);
    if (base === null) break;
    const carried = budget.carry_forward && firstKey < key
      ? carryInto(key, firstKey, budget.period, limits, (p) => spent.get(p) ?? 0)
      : 0;
    rows.push({ key, limit: base + carried, carried, spent: spent.get(key) ?? 0 });
  }
  return { budget, rows };
}

export type BudgetAlert = { budgetId: string; name: string | null; level: 'warning' | 'over'; spent: number; limit: number; period: BudgetPeriod };

/**
 * After spending is recorded: budgets in the current period that just reached 80% or 100%.
 * Each level is reported once per period (remembered in budget_alerts).
 */
export async function checkBudgetAlerts(db: SQLiteDatabase, weekStart: WeekStart, today: ISODate = todayISO()): Promise<BudgetAlert[]> {
  const alerts: BudgetAlert[] = [];
  for (const period of ['month', 'week'] as const) {
    const key = periodKeyOf(today, period, weekStart);
    const { budgets } = await listBudgetStatus(db, period, key, weekStart);
    for (const b of budgets) {
      const level = budgetLevel(b.spent, b.limit);
      if (level === 'ok') continue;
      const levels = level === 'over' ? [80, 100] : [80];
      const fresh: number[] = [];
      for (const l of levels) {
        const result = await db.runAsync(
          'insert or ignore into budget_alerts (budget_id, period_start, level) values (?, ?, ?)',
          b.id, key, l,
        );
        if (result.changes > 0) fresh.push(l);
      }
      if (fresh.length) alerts.push({ budgetId: b.id, name: b.name, level, spent: b.spent, limit: b.limit, period });
    }
  }
  return alerts;
}
