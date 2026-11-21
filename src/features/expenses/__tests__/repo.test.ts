/**
 * Integration tests: the real migrations and repository SQL against an in-memory SQLite.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { strToU8 } from 'fflate';

import { sealWithPassword } from '@/core/crypto/passwordBox';
import { migrate } from '@/core/db/migrate';
import { createTestDatabase } from '@/core/db/testing/nodeSqlite';
import { setSetting } from '@/core/settings/settings';
import { addDays, currentMonthKey, shiftMonth, todayISO } from '@/core/utils/date';

import { applyRestore, buildBackup, changeCurrency, decryptBackup, inspectBackup } from '../backup';
import { parseBackup, RESTORE_ORDER, type Row, TABLE_COLUMNS, type TableName } from '../backupFormat';
import { buildImportRows, guessMapping } from '../csvImport';
import { commitImport, prepareImport } from '../importer';
import { processRecurring } from '../recurring';
import {
  accountStatement,
  bulkAddTag,
  bulkDelete,
  bulkSetAccount,
  bulkSetCategory,
  categoryTotals,
  createRecurring,
  deleteOrArchiveCategory,
  findPossibleDuplicates,
  getAccountBalance,
  listAccounts,
  listCategories,
  listDuplicateGroups,
  listTransactions,
  listUpcomingBills,
  markRecurringPaid,
  monthlyTotals,
  periodSummary,
  reconcileAccount,
  saveAccount,
  saveCategory,
  saveTransaction,
  skipRecurring,
  subcategoryTotals,
  tagTotals,
  type TransactionInput,
  validateTransaction,
} from '../repo';
import { budgetHistory, checkBudgetAlerts, deleteBudget, listBudgetStatus, setBudgetAmount } from '../repoBudgets';
import { createTag, deleteTag, listTags, saveTemplate, listTemplates } from '../repoExtras';
import { closeLoan, createLoan, getLoan, increaseLoan, listLoans, recordLoanPayment, saveSharedExpense } from '../repoLoans';
import {
  addContribution,
  listGoals,
  markHoldingSold,
  netWorthHistory,
  netWorthNow,
  saveGoal,
  saveHolding,
  updateHoldingValue,
} from '../repoWealth';
import { prepareDatabaseEncryption } from '../encryption';
import { initDatabase, MIGRATIONS, SCHEMA_VERSION } from '../schema';
import { buildSummary } from '../widget';

const expense = (amount: number, date: string, extra: Partial<TransactionInput> = {}): TransactionInput => ({
  type: 'expense',
  amount,
  category_id: 'cat_food',
  account_id: 'acc_cash',
  to_account_id: null,
  date,
  note: '',
  ...extra,
});

async function freshDb() {
  const db = createTestDatabase();
  await initDatabase(db);
  return db;
}

const dump = async (db: SQLiteDatabase, table: TableName) => {
  const columns = TABLE_COLUMNS[table].join(', ');
  return db.getAllAsync(`select ${columns} from ${table} order by ${TABLE_COLUMNS[table].join(', ')}`);
};

describe('schema', () => {
  it('creates tables and seeds defaults once', async () => {
    const db = await freshDb();
    await initDatabase(db); // running again must be a no-op
    expect(await listAccounts(db)).toHaveLength(2);
    expect((await listCategories(db, 'expense')).length).toBeGreaterThan(5);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('upgrades a version 1 database with data to the latest version without losing anything', async () => {
    const db = createTestDatabase();
    await migrate(db, MIGRATIONS.slice(0, 1));
    const now = new Date().toISOString();
    await db.runAsync(
      `insert into transactions (id, type, amount, category_id, account_id, date, note, created_at, updated_at)
       values ('t1', 'expense', 1500, 'cat_food', 'acc_cash', '2026-11-02', 'lunch', ?, ?)`,
      now, now,
    );
    await db.runAsync("insert into budgets (category_id, amount) values ('cat_food', 20000)");
    await db.runAsync(`update accounts set opening_balance = 5000 where id = 'acc_bank'`);

    await initDatabase(db); // runs migrations 2 and 3
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(SCHEMA_VERSION);
    expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
    expect((await listTransactions(db)).map((t) => [t.id, t.note, t.amount])).toEqual([['t1', 'lunch', 1500]]);
    expect(await getAccountBalance(db, 'acc_bank')).toBe(5000);
    const { budgets } = await listBudgetStatus(db, 'month', '2026-11', 1);
    expect(budgets.map((b) => [b.category_id, b.limit, b.spent])).toEqual([['cat_food', 20000, 1500]]);
    // the old budget applied to every month, and still does
    expect((await listBudgetStatus(db, 'month', '2020-01', 1)).budgets).toHaveLength(1);
    expect((await listCategories(db, 'expense')).some((c) => c.id === 'cat_loan_interest')).toBe(true);
    // the rebuilt accounts table accepts loans and still enforces types
    await expect(db.runAsync(`update accounts set type = 'nonsense' where id = 'acc_cash'`)).rejects.toThrow();
  });
});

describe('transactions and balances', () => {
  it('computes balances across expenses, income and transfers', async () => {
    const db = await freshDb();
    await saveAccount(db, 'acc_bank', { name: 'Bank', type: 'bank', icon: 'business-outline', color: '#000', opening_balance: 100_000 });
    await saveTransaction(db, null, expense(2_500, '2026-11-02'));
    await saveTransaction(db, null, { ...expense(50_000, '2026-11-01'), type: 'income', category_id: 'cat_salary', account_id: 'acc_bank' });
    await saveTransaction(db, null, { ...expense(10_000, '2026-11-03'), type: 'transfer', account_id: 'acc_bank', to_account_id: 'acc_cash' });

    const balances = Object.fromEntries((await listAccounts(db)).map((a) => [a.id, a.balance]));
    expect(balances.acc_cash).toBe(-2_500 + 10_000);
    expect(balances.acc_bank).toBe(100_000 + 50_000 - 10_000);
    expect(await periodSummary(db, '2026-11-01', '2026-11-30')).toEqual({ income: 50_000, expense: 2_500 });
  });

  it('searches notes, categories, tags and exact amounts, treating % literally', async () => {
    const db = await freshDb();
    const tag = await createTag(db, 'Goa trip', '#f00');
    await saveTransaction(db, null, expense(25_000, '2026-11-01', { note: 'Pizza night', tagIds: [tag] }));
    await saveTransaction(db, null, expense(1_000, '2026-11-02', { note: '100% juice', category_id: 'cat_groceries' }));

    expect((await listTransactions(db, { search: 'pizza' })).map((t) => t.note)).toEqual(['Pizza night']);
    expect((await listTransactions(db, { search: 'grocer' })).map((t) => t.note)).toEqual(['100% juice']);
    expect((await listTransactions(db, { search: '250' })).map((t) => t.note)).toEqual(['Pizza night']);
    expect((await listTransactions(db, { search: '0%' })).map((t) => t.note)).toEqual(['100% juice']);
    expect((await listTransactions(db, { search: 'goa' })).map((t) => t.note)).toEqual(['Pizza night']);
    expect(await listTransactions(db, { search: 'zzz' })).toEqual([]);
  });

  it('filters by date range, type, account and category', async () => {
    const db = await freshDb();
    await saveTransaction(db, null, expense(100, '2026-10-31'));
    await saveTransaction(db, null, expense(200, '2026-11-01', { account_id: 'acc_bank' }));
    await saveTransaction(db, null, expense(300, '2026-11-30', { category_id: 'cat_travel' }));

    const nov = await listTransactions(db, { from: '2026-11-01', to: '2026-11-30' });
    expect(nov.map((t) => t.amount)).toEqual([300, 200]);
    expect((await listTransactions(db, { accountId: 'acc_bank' })).map((t) => t.amount)).toEqual([200]);
    expect((await listTransactions(db, { categoryId: 'cat_travel' })).map((t) => t.amount)).toEqual([300]);
    expect(await listTransactions(db, { type: 'income' })).toEqual([]);
  });
});

describe('split transactions', () => {
  it('validates that parts add up', () => {
    const base = expense(1_000, '2026-11-01', { category_id: null });
    expect(validateTransaction({ ...base, splits: [{ category_id: 'cat_food', amount: 1_000, note: '' }] })).toMatch(/two parts/);
    expect(
      validateTransaction({ ...base, splits: [{ category_id: 'cat_food', amount: 600, note: '' }, { category_id: 'cat_groceries', amount: 300, note: '' }] }),
    ).toMatch(/add up/);
    expect(
      validateTransaction({ ...base, splits: [{ category_id: 'cat_food', amount: 600, note: '' }, { category_id: 'cat_groceries', amount: 400, note: '' }] }),
    ).toBeNull();
  });

  it('counts each part in its own category for reports, filters and budgets', async () => {
    const db = await freshDb();
    await saveTransaction(db, null, {
      ...expense(1_000, '2026-11-05', { category_id: null }),
      splits: [
        { category_id: 'cat_groceries', amount: 700, note: 'veg' },
        { category_id: 'cat_personal', amount: 300, note: 'soap' },
      ],
    });
    const totals = await categoryTotals(db, '2026-11-01', '2026-11-30');
    expect(totals.map((c) => [c.id, c.total])).toEqual([['cat_groceries', 700], ['cat_personal', 300]]);
    expect(await periodSummary(db, '2026-11-01', '2026-11-30')).toEqual({ income: 0, expense: 1_000 });
    const [tx] = await listTransactions(db, { categoryId: 'cat_personal' });
    expect(tx.split_count).toBe(2);
    expect(tx.category_id).toBeNull();
    await setBudgetAmount(db, { categoryId: 'cat_groceries', period: 'month' }, '2026-11', 5_000);
    const { budgets } = await listBudgetStatus(db, 'month', '2026-11', 1);
    expect(budgets[0].spent).toBe(700);
  });
});

describe('subcategories', () => {
  it('rolls subcategory spending up into the main category', async () => {
    const db = await freshDb();
    const coffee = await saveCategory(db, null, { name: 'Coffee', type: 'expense', icon: 'cafe-outline', color: '#000', parent_id: 'cat_food' });
    await saveTransaction(db, null, expense(300, '2026-11-02', { category_id: coffee }));
    await saveTransaction(db, null, expense(1_000, '2026-11-03'));
    expect((await categoryTotals(db, '2026-11-01', '2026-11-30')).map((c) => [c.id, c.total])).toEqual([['cat_food', 1_300]]);
    expect((await subcategoryTotals(db, 'cat_food', '2026-11-01', '2026-11-30')).map((c) => [c.name, c.total])).toEqual([
      ['Food & dining', 1_000],
      ['Coffee', 300],
    ]);
    expect((await listTransactions(db, { categoryId: 'cat_food' })).length).toBe(2);
    // listed right after the parent
    const ids = (await listCategories(db, 'expense')).map((c) => c.id);
    expect(ids.indexOf(coffee)).toBe(ids.indexOf('cat_food') + 1);
  });

  it('allows only one level and the same type', async () => {
    const db = await freshDb();
    const coffee = await saveCategory(db, null, { name: 'Coffee', type: 'expense', icon: 'cafe-outline', color: '#000', parent_id: 'cat_food' });
    await expect(saveCategory(db, null, { name: 'Latte', type: 'expense', icon: 'cafe-outline', color: '#000', parent_id: coffee })).rejects.toThrow();
    await expect(saveCategory(db, null, { name: 'Bonus', type: 'income', icon: 'cafe-outline', color: '#000', parent_id: 'cat_food' })).rejects.toThrow();
    await expect(saveCategory(db, 'cat_food', { name: 'Food', type: 'expense', icon: 'cafe-outline', color: '#000', parent_id: 'cat_groceries' })).rejects.toThrow();
    expect(await deleteOrArchiveCategory(db, 'cat_food')).toBe('archived'); // has a subcategory
    expect((await listCategories(db, 'expense', true)).find((c) => c.id === coffee)?.archived).toBe(1);
  });
});

describe('tags, templates and bulk operations', () => {
  it('creates tags once per name, reports and deletes them', async () => {
    const db = await freshDb();
    const a = await createTag(db, '#Holiday', '#f00');
    expect(await createTag(db, 'holiday', '#0f0')).toBe(a);
    const id = await saveTransaction(db, null, expense(500, '2026-11-01', { tagIds: [a] }));
    expect((await listTransactions(db, { tagId: a })).map((t) => t.id)).toEqual([id]);
    expect((await tagTotals(db, '2026-11-01', '2026-11-30')).map((t) => [t.name, t.expense])).toEqual([['Holiday', 500]]);
    await deleteTag(db, a);
    expect(await listTags(db)).toEqual([]);
    expect((await listTransactions(db))[0].tag_names).toBeNull();
  });

  it('saves templates', async () => {
    const db = await freshDb();
    await saveTemplate(db, null, { name: 'Tea', type: 'expense', amount: 2_000, category_id: 'cat_food', account_id: 'acc_cash', to_account_id: 'acc_bank', note: 'chai' });
    const [tpl] = await listTemplates(db);
    expect(tpl).toMatchObject({ name: 'Tea', amount: 2_000, category_name: 'Food & dining', to_account_id: null });
  });

  it('bulk deletes, recategorises, moves and tags', async () => {
    const db = await freshDb();
    const a = await saveTransaction(db, null, expense(100, '2026-11-01'));
    const b = await saveTransaction(db, null, expense(200, '2026-11-02'));
    const c = await saveTransaction(db, null, { ...expense(300, '2026-11-03'), type: 'income', category_id: 'cat_salary' });
    expect(await bulkSetCategory(db, [a, b, c], 'cat_travel')).toBe(2); // the income entry is left alone
    expect(await bulkSetAccount(db, [a, b], 'acc_bank')).toBe(2);
    const tag = await createTag(db, 'x', '#000');
    await bulkAddTag(db, [a, b], tag);
    await bulkAddTag(db, [a], tag); // no duplicate link
    expect((await listTransactions(db, { tagId: tag })).length).toBe(2);
    expect((await listTransactions(db, { categoryId: 'cat_travel', accountId: 'acc_bank' })).length).toBe(2);
    await bulkDelete(db, [a, b]);
    expect((await listTransactions(db)).map((t) => t.id)).toEqual([c]);
  });
});

describe('duplicates', () => {
  it('finds entries with the same amount and account within a day', async () => {
    const db = await freshDb();
    const first = await saveTransaction(db, null, expense(4_999, '2026-11-10'));
    await saveTransaction(db, null, expense(4_999, '2026-11-11'));
    await saveTransaction(db, null, expense(4_999, '2026-11-20'));
    expect((await findPossibleDuplicates(db, { type: 'expense', amount: 4_999, account_id: 'acc_cash', date: '2026-11-09' })).length).toBe(1);
    expect(await findPossibleDuplicates(db, { type: 'expense', amount: 4_999, account_id: 'acc_bank', date: '2026-11-10' })).toEqual([]);
    expect((await findPossibleDuplicates(db, { type: 'expense', amount: 4_999, account_id: 'acc_cash', date: '2026-11-10' }, first)).length).toBe(1);
    const groups = await listDuplicateGroups(db);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((t) => t.date)).toEqual(['2026-11-10', '2026-11-11']);
  });
});

describe('accounts: reconcile and statements', () => {
  it('records the difference as an adjustment and remembers the reconciliation', async () => {
    const db = await freshDb();
    await saveTransaction(db, null, expense(1_000, '2026-11-01'));
    expect(await reconcileAccount(db, 'acc_cash', -1_500, '2026-11-05')).toBe(-500);
    expect(await getAccountBalance(db, 'acc_cash')).toBe(-1_500);
    expect(await reconcileAccount(db, 'acc_cash', -1_500, '2026-11-06')).toBe(0);
    const account = await db.getFirstAsync<{ reconciled_date: string; reconciled_balance: number }>(
      "select reconciled_date, reconciled_balance from accounts where id = 'acc_cash'",
    );
    expect(account).toEqual({ reconciled_date: '2026-11-06', reconciled_balance: -1_500 });
  });

  it('builds a statement with opening, running and closing balances', async () => {
    const db = await freshDb();
    await saveAccount(db, 'acc_bank', { name: 'Bank', type: 'bank', icon: 'business-outline', color: '#000', opening_balance: 10_000 });
    await saveTransaction(db, null, expense(1_000, '2026-10-30', { account_id: 'acc_bank' }));
    await saveTransaction(db, null, { ...expense(5_000, '2026-11-01'), type: 'income', category_id: 'cat_salary', account_id: 'acc_bank' });
    await saveTransaction(db, null, { ...expense(2_000, '2026-11-02'), type: 'transfer', account_id: 'acc_bank', to_account_id: 'acc_cash' });
    const s = await accountStatement(db, 'acc_bank', '2026-11-01', '2026-11-30');
    expect(s.opening).toBe(9_000);
    expect(s.lines.map((l) => [l.change, l.running])).toEqual([[5_000, 14_000], [-2_000, 12_000]]);
    expect([s.moneyIn, s.moneyOut, s.closing]).toEqual([5_000, 2_000, 12_000]);
  });
});

describe('budgets', () => {
  it('keeps history: a changed limit applies from that month on', async () => {
    const db = await freshDb();
    await setBudgetAmount(db, { categoryId: 'cat_food', period: 'month' }, '2026-09', 10_000);
    await setBudgetAmount(db, { categoryId: 'cat_food', period: 'month' }, '2026-11', 15_000);
    const limit = async (key: string) => (await listBudgetStatus(db, 'month', key, 1)).budgets[0]?.limit ?? null;
    expect(await limit('2026-08')).toBeNull();
    expect(await limit('2026-09')).toBe(10_000);
    expect(await limit('2026-10')).toBe(10_000);
    expect(await limit('2026-11')).toBe(15_000);
    expect(await limit('2027-03')).toBe(15_000);
    // the category without a budget in August is offered for one
    expect((await listBudgetStatus(db, 'month', '2026-08', 1)).unbudgeted.some((c) => c.category_id === 'cat_food')).toBe(true);
  });

  it('carries unspent money forward but not overspending', async () => {
    const db = await freshDb();
    await setBudgetAmount(db, { categoryId: 'cat_food', period: 'month' }, '2026-08', 10_000, true);
    await saveTransaction(db, null, expense(4_000, '2026-08-10')); // 6,000 left
    await saveTransaction(db, null, expense(20_000, '2026-09-10')); // over by 4,000
    await saveTransaction(db, null, expense(1_000, '2026-10-10'));
    const status = async (key: string) => (await listBudgetStatus(db, 'month', key, 1)).budgets[0];
    expect((await status('2026-08')).carried).toBe(0);
    expect((await status('2026-09')).limit).toBe(16_000);
    expect((await status('2026-10')).carried).toBe(0); // overspending did not reduce October
    expect((await status('2026-11')).carried).toBe(9_000);
    const history = await budgetHistory(db, (await status('2026-11')).id, '2026-11', 6, 1);
    expect(history.rows.map((r) => [r.key, r.limit, r.spent])).toEqual([
      ['2026-11', 19_000, 0],
      ['2026-10', 10_000, 1_000],
      ['2026-09', 16_000, 20_000],
      ['2026-08', 10_000, 4_000],
    ]);
  });

  it('supports weekly and overall budgets', async () => {
    const db = await freshDb();
    await setBudgetAmount(db, { categoryId: null, period: 'week' }, '2026-11-16', 5_000); // Monday
    await saveTransaction(db, null, expense(1_000, '2026-11-15')); // Sunday, previous week
    await saveTransaction(db, null, expense(2_000, '2026-11-16'));
    await saveTransaction(db, null, expense(500, '2026-11-22', { category_id: 'cat_travel' })); // Sunday, same week
    const { budgets } = await listBudgetStatus(db, 'week', '2026-11-16', 1);
    expect(budgets.map((b) => [b.category_id, b.limit, b.spent])).toEqual([[null, 5_000, 2_500]]);
    await deleteBudget(db, budgets[0].id);
    expect((await listBudgetStatus(db, 'week', '2026-11-16', 1)).budgets).toEqual([]);
  });

  it('alerts once per level per period', async () => {
    const db = await freshDb();
    const today = todayISO();
    await setBudgetAmount(db, { categoryId: 'cat_food', period: 'month' }, currentMonthKey(), 1_000);
    await saveTransaction(db, null, expense(850, today));
    expect((await checkBudgetAlerts(db, 1, today)).map((a) => a.level)).toEqual(['warning']);
    expect(await checkBudgetAlerts(db, 1, today)).toEqual([]);
    await saveTransaction(db, null, expense(200, today));
    expect((await checkBudgetAlerts(db, 1, today)).map((a) => a.level)).toEqual(['over']);
    expect(await checkBudgetAlerts(db, 1, today)).toEqual([]);
  });
});

describe('recurring', () => {
  it('backfills due occurrences once and never duplicates', async () => {
    const db = await freshDb();
    const start = `${shiftMonth(currentMonthKey(), -2)}-01`;
    await createRecurring(db, expense(99_900, start, { note: 'Rent' }), 'monthly');
    const first = await listTransactions(db, { search: 'Rent' });
    expect(first).toHaveLength(3);
    await processRecurring(db, todayISO());
    await Promise.all([processRecurring(db, todayISO()), processRecurring(db, todayISO())]);
    expect(await listTransactions(db, { search: 'Rent' })).toHaveLength(3);
  });

  it('waits for bills in reminder mode to be marked paid or skipped', async () => {
    const db = await freshDb();
    const due = addDays(todayISO(), -3);
    const id = await createRecurring(db, expense(1_200, due, { note: 'Electricity', category_id: 'cat_bills' }), 'monthly', { mode: 'remind', remindDays: 2 });
    expect(await listTransactions(db, { search: 'Electricity' })).toEqual([]);
    const [bill] = await listUpcomingBills(db, todayISO());
    expect(bill).toMatchObject({ id, next_date: due, remind_days: 2 });

    await markRecurringPaid(db, id, { amount: 1_350, date: todayISO(), account_id: 'acc_bank' });
    const paid = await listTransactions(db, { recurringId: id });
    expect(paid.map((t) => [t.amount, t.account_id, t.date])).toEqual([[1_350, 'acc_bank', todayISO()]]);
    expect(await listUpcomingBills(db, todayISO())).toEqual([]);

    await skipRecurring(db, id);
    expect(await listTransactions(db, { recurringId: id })).toHaveLength(1);
    const row = await db.getFirstAsync<{ generated_count: number }>('select generated_count from recurring where id = ?', id);
    expect(row?.generated_count).toBe(2);
  });
});

describe('loans and debts', () => {
  it('takes a loan into the bank, repays it with interest and tracks what is left', async () => {
    const db = await freshDb();
    const id = await createLoan(db, {
      direction: 'borrowed', name: 'Car loan', principal: 100_000, annual_rate: 1200, tenure_months: 12, emi: 8_885,
      start_date: '2026-01-01', note: '', source: { kind: 'new', account_id: 'acc_bank' },
    });
    expect(await getAccountBalance(db, 'acc_bank')).toBe(100_000);
    expect((await getLoan(db, id))?.outstanding).toBe(100_000);
    await recordLoanPayment(db, id, { amount: 8_885, interest: 1_000, date: '2026-02-01', account_id: 'acc_bank' });
    const loan = await getLoan(db, id);
    expect(loan).toMatchObject({ outstanding: 92_115, interest_paid: 1_000, payments: 1, last_payment: '2026-02-01' });
    expect(await getAccountBalance(db, 'acc_bank')).toBe(100_000 - 8_885);
    expect(await periodSummary(db, '2026-02-01', '2026-02-28')).toEqual({ income: 0, expense: 1_000 }); // only interest is spending
    expect((await listAccounts(db)).some((a) => a.id === id)).toBe(false); // not mixed into money accounts
    expect(await closeLoan(db, id)).toBe('closed');
    expect(await listLoans(db)).toEqual([]);
  });

  it('records an existing loan without touching accounts, and money lent', async () => {
    const db = await freshDb();
    const old = await createLoan(db, {
      direction: 'borrowed', name: 'Home loan', principal: 5_000_000, annual_rate: 850, tenure_months: 240, emi: null,
      start_date: '2020-01-01', note: '', source: { kind: 'existing', outstanding: 3_000_000 },
    });
    expect((await getLoan(db, old))?.outstanding).toBe(3_000_000);
    expect(await getAccountBalance(db, 'acc_bank')).toBe(0);

    const lent = await createLoan(db, {
      direction: 'lent', name: 'Ravi', principal: 2_000, annual_rate: 0, tenure_months: null, emi: null,
      start_date: '2026-11-01', note: '', source: { kind: 'new', account_id: 'acc_cash' },
    });
    await increaseLoan(db, lent, { amount: 500, date: '2026-11-02', account_id: 'acc_cash' });
    await recordLoanPayment(db, lent, { amount: 1_000, interest: 0, date: '2026-11-03', account_id: 'acc_cash' });
    expect((await getLoan(db, lent))?.outstanding).toBe(1_500);
    expect(await getAccountBalance(db, 'acc_cash')).toBe(-1_500);
    const worth = await netWorthNow(db);
    expect(worth).toMatchObject({ lent: 1_500, borrowed: 3_000_000, cards: 1_500 });
  });

  it('splits a bill: your share is spending, the rest is owed to you', async () => {
    const db = await freshDb();
    const tag = await createTag(db, 'Dinner', '#000');
    await saveSharedExpense(db, expense(3_000, '2026-11-05', { account_id: 'acc_bank', note: 'Dinner', tagIds: [tag] }), [
      { person: 'Asha', amount: 1_000 },
      { person: 'Ben', amount: 1_000 },
    ]);
    expect(await periodSummary(db, '2026-11-01', '2026-11-30')).toEqual({ income: 0, expense: 1_000 });
    expect(await getAccountBalance(db, 'acc_bank')).toBe(-3_000);
    const loans = await listLoans(db);
    expect(loans.map((l) => [l.name, l.direction, l.outstanding])).toEqual([['Asha', 'lent', 1_000], ['Ben', 'lent', 1_000]]);
    // a second bill with Asha adds to the same record
    await saveSharedExpense(db, expense(600, '2026-11-06', { account_id: 'acc_bank' }), [{ person: 'asha', amount: 300 }]);
    expect((await listLoans(db)).find((l) => l.name === 'Asha')?.outstanding).toBe(1_300);
    await expect(saveSharedExpense(db, expense(100, '2026-11-06'), [{ person: 'X', amount: 100 }])).rejects.toThrow();
  });
});

describe('goals, investments, assets and net worth', () => {
  it('tracks goals by contributions or by a linked account', async () => {
    const db = await freshDb();
    const trip = await saveGoal(db, null, { name: 'Trip', icon: 'airplane-outline', color: '#000', target: 50_000, target_date: null, account_id: null });
    await addContribution(db, trip, { amount: 10_000, date: '2026-11-01', note: '' });
    await addContribution(db, trip, { amount: -2_000, date: '2026-11-02', note: 'used some' });
    await saveGoal(db, null, { name: 'Emergency', icon: 'shield-checkmark-outline', color: '#000', target: 100_000, target_date: null, account_id: 'acc_bank' });
    await saveTransaction(db, null, { ...expense(30_000, '2026-11-01'), type: 'income', category_id: 'cat_salary', account_id: 'acc_bank' });
    expect((await listGoals(db)).map((g) => [g.name, g.saved])).toEqual([['Trip', 8_000], ['Emergency', 30_000]]);
  });

  it('values holdings and works out net worth now and over time', async () => {
    const db = await freshDb();
    const m = currentMonthKey();
    const lastMonth = shiftMonth(m, -1);
    await saveTransaction(db, null, { ...expense(100_000, `${lastMonth}-05`), type: 'income', category_id: 'cat_salary', account_id: 'acc_bank' });
    const fund = await saveHolding(
      db, null,
      { kind: 'investment', subtype: 'mutual_fund', name: 'Index fund', invested: 40_000, quantity: '10 units', note: '', purchase_date: `${lastMonth}-10` },
      { value: 40_000, date: `${lastMonth}-10` },
    );
    await updateHoldingValue(db, fund, 46_000, `${m}-01`);
    const car = await saveHolding(
      db, null,
      { kind: 'asset', subtype: 'vehicle', name: 'Car', invested: 0, quantity: '', note: '', purchase_date: null },
      { value: 300_000, date: `${m}-01` },
    );
    let worth = await netWorthNow(db);
    expect(worth).toMatchObject({ cash: 100_000, investments: 46_000, assets: 300_000, netWorth: 446_000 });
    const history = await netWorthHistory(db, [shiftMonth(m, -2), lastMonth, m]);
    expect(history.map((p) => p.netWorth)).toEqual([0, 140_000, 446_000]);
    await markHoldingSold(db, car, todayISO());
    worth = await netWorthNow(db);
    expect(worth.assets).toBe(0);
  });
});

describe('CSV import', () => {
  it('imports a bank statement, matching categories and flagging duplicates', async () => {
    const db = await freshDb();
    await saveTransaction(db, null, expense(45_000, '2026-11-03', { account_id: 'acc_bank' }));
    const header = ['Txn Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Category'];
    const rows = [
      ['03/11/2026', 'Swiggy order', '450.00', '', 'Food & dining'],
      ['04/11/2026', 'Salary NOV', '', '52,000.00', 'Salary'],
      ['05/11/2026', 'Unknown shop', '99.50', '', 'Gadgets'],
      ['xx', 'bad row', '1', '', ''],
    ];
    const mapping = guessMapping(header);
    const parsed = buildImportRows(rows, mapping, { dateOrder: 'dmy', decimalSeparator: '.' });
    const prepared = await prepareImport(db, parsed, 'acc_bank');
    expect(prepared.map((r) => [r.type, r.amount, r.category_id, r.duplicate, r.error])).toEqual([
      ['expense', 45_000, 'cat_food', true, null],
      ['income', 5_200_000, 'cat_salary', false, null],
      ['expense', 9_950, 'cat_other_out', false, null],
      ['expense', 100, 'cat_other_out', false, 'Date not recognised'],
    ]);
    expect(await commitImport(db, prepared.filter((r) => !r.duplicate))).toBe(2);
    expect(await getAccountBalance(db, 'acc_bank')).toBe(-45_000 + 5_200_000 - 9_950);
  });
});

describe('backup round trip', () => {
  async function richDb() {
    const db = await freshDb();
    const tag = await createTag(db, 'Trip', '#123456');
    const sub = await saveCategory(db, null, { name: 'Coffee', type: 'expense', icon: 'cafe-outline', color: '#000', parent_id: 'cat_food' });
    await saveTransaction(db, null, expense(1_234, '2026-11-01', { note: 'Café, "quoted"', tagIds: [tag], category_id: sub }));
    await saveTransaction(db, null, {
      ...expense(1_000, '2026-11-02', { category_id: null }),
      splits: [{ category_id: 'cat_food', amount: 400, note: '' }, { category_id: 'cat_travel', amount: 600, note: '' }],
    });
    await setBudgetAmount(db, { categoryId: 'cat_food', period: 'month' }, '2026-10', 50_000, true);
    await setBudgetAmount(db, { categoryId: null, period: 'week' }, '2026-11-16', 9_000);
    await createRecurring(db, expense(500, '2026-11-01', { note: 'Gym' }), 'weekly');
    await createLoan(db, {
      direction: 'borrowed', name: 'Loan', principal: 10_000, annual_rate: 900, tenure_months: 10, emi: 1_045,
      start_date: '2026-11-01', note: '', source: { kind: 'new', account_id: 'acc_bank' },
    });
    const goal = await saveGoal(db, null, { name: 'Bike', icon: 'bicycle-outline', color: '#000', target: 9_000, target_date: '2027-01-01', account_id: null });
    await addContribution(db, goal, { amount: 1_000, date: '2026-11-01', note: '' });
    await saveHolding(db, null, { kind: 'investment', subtype: 'gold', name: 'Gold', invested: 5_000, quantity: '1 g', note: '', purchase_date: null }, { value: 5_500, date: '2026-11-01' });
    await saveTemplate(db, null, { name: 'Tea', type: 'expense', amount: null, category_id: 'cat_food', account_id: 'acc_cash', to_account_id: null, note: '' });
    return db;
  }

  it('restores exactly what was exported, replacing existing data', async () => {
    const source = await richDb();
    const text = JSON.stringify(await buildBackup(source));
    const target = await freshDb();
    await saveTransaction(target, null, expense(777, '2026-01-01', { note: 'should disappear' }));
    const picked = await inspectBackup(target, text, 'b.json');
    if (picked.kind !== 'ready') throw new Error('expected a plain backup');
    expect(picked.summary.counts.transactions).toBeGreaterThan(2);
    await applyRestore(target, picked.file);
    for (const table of RESTORE_ORDER) {
      expect([table, await dump(target, table)]).toEqual([table, await dump(source, table)]);
    }
  });

  it('encrypts with a password and refuses a wrong one', async () => {
    const source = await richDb();
    const box = await sealWithPassword(strToU8(JSON.stringify(await buildBackup(source))), 'correct horse', 64 * 1024);
    const text = JSON.stringify({ app: 'lekhawise', encrypted: true, exportedAt: 'x', box });
    expect(text).not.toContain('Café');
    const target = await freshDb();
    const picked = await inspectBackup(target, text, 'e.json');
    expect(picked.kind).toBe('encrypted');
    await expect(decryptBackup(target, text, 'wrong', 'e.json')).rejects.toThrow(/Wrong password/);
    const pending = await decryptBackup(target, text, 'correct horse', 'e.json');
    await applyRestore(target, pending.file);
    expect(await dump(target, 'transactions')).toEqual(await dump(source, 'transactions'));
  });

  it('restores a backup made by version 1 of the app', async () => {
    const v1 = {
      app: 'lekhawise', format: 1, schemaVersion: 1, exportedAt: '2026-11-01T00:00:00.000Z', settings: { currency: 'INR' },
      data: {
        accounts: [{ id: 'acc_cash', name: 'Cash', type: 'cash', icon: 'cash-outline', color: '#000', opening_balance: 0, archived: 0, sort_order: 0, created_at: 'x' }],
        categories: [{ id: 'cat_food', name: 'Food', type: 'expense', icon: 'x', color: '#000', archived: 0, sort_order: 0 }],
        transactions: [{ id: 't', type: 'expense', amount: 500, category_id: 'cat_food', account_id: 'acc_cash', to_account_id: null, date: '2026-11-02', note: '', recurring_id: null, created_at: 'x', updated_at: 'x' }],
        budgets: [{ category_id: 'cat_food', amount: 7_000 }],
        recurring: [],
      },
    };
    const db = await freshDb();
    await applyRestore(db, parseBackup(JSON.stringify(v1), SCHEMA_VERSION));
    expect((await listTransactions(db)).map((t) => t.amount)).toEqual([500]);
    const { budgets } = await listBudgetStatus(db, 'month', '2026-11', 1);
    expect(budgets.map((b) => [b.category_id, b.limit, b.spent])).toEqual([['cat_food', 7_000, 500]]);
  });

  it('restores large backups exactly across insert batches', async () => {
    const source = await freshDb();
    for (let i = 0; i < 950; i++) {
      await saveTransaction(source, null, expense(100 + i, `2026-${String((i % 12) + 1).padStart(2, '0')}-15`, { note: `n${i}` }));
    }
    const target = await freshDb();
    await applyRestore(target, parseBackup(JSON.stringify(await buildBackup(source)), SCHEMA_VERSION));
    const sum = async (db: SQLiteDatabase) =>
      db.getFirstAsync<{ n: number; total: number }>('select count(*) as n, sum(amount) as total from transactions');
    expect(await sum(target)).toEqual(await sum(source));
    expect((await sum(target))?.n).toBe(950);
  });

  it('rolls back completely when a row is rejected by the database', async () => {
    const db = await freshDb();
    await saveTransaction(db, null, expense(100, '2026-11-01', { note: 'keep me' }));
    const data = Object.fromEntries(RESTORE_ORDER.map((t) => [t, [] as Row[]])) as Record<TableName, Row[]>;
    data.accounts = [{ id: 'a', name: 'A', type: 'not-a-type', icon: 'x', color: '#000', opening_balance: 0, archived: 0, sort_order: 0, created_at: 'x' }];
    const file = parseBackup(JSON.stringify({ app: 'lekhawise', schemaVersion: 2, data }), SCHEMA_VERSION);
    await expect(applyRestore(db, file)).rejects.toThrow();
    expect((await listTransactions(db)).map((t) => t.note)).toEqual(['keep me']);
  });
});

describe('currency', () => {
  it('rescales stored amounts when moving to and from a three-decimal currency', async () => {
    const db = await freshDb();
    setSetting('currency', 'INR');
    await saveTransaction(db, null, expense(1_250, '2026-11-01')); // 12.50
    await setBudgetAmount(db, { categoryId: 'cat_food', period: 'month' }, '2026-11', 1);
    await changeCurrency(db, 'KWD');
    expect((await listTransactions(db))[0].amount).toBe(12_500); // 12.500
    await changeCurrency(db, 'USD');
    expect((await listTransactions(db))[0].amount).toBe(1_250);
    expect((await listBudgetStatus(db, 'month', '2026-11', 1)).budgets[0].limit).toBe(1); // never rounded to 0
    expect(await monthlyTotals(db, ['2026-11'])).toEqual([{ month: '2026-11', income: 0, expense: 1_250 }]);
  });
});

describe('home-screen widget and encryption', () => {
  it('summarises today, the month and the budget', async () => {
    const db = await freshDb();
    setSetting('currency', 'INR');
    await saveTransaction(db, null, expense(25_000, todayISO()));
    await saveTransaction(db, null, expense(5_000, `${currentMonthKey()}-01`));
    await setBudgetAmount(db, { categoryId: null, period: 'month' }, currentMonthKey(), 100_000);
    const summary = await buildSummary(db);
    expect(summary.today).toContain('250.00');
    expect(summary.monthLine).toMatch(/300.00 spent$/);
    expect(summary.budgetLine).toMatch(/700.00 of the budget left$/);
  });

  it('reports no key where SQLite has no encryption (Expo Go, tests)', async () => {
    expect(await prepareDatabaseEncryption()).toBeNull();
  });
});
