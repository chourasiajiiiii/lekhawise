import type { SQLiteDatabase } from 'expo-sqlite';

import { migrate, type Migration } from '@/core/db/migrate';
import { allTranslationsOf, t } from '@/core/i18n/locale';
import { todayISO } from '@/core/utils/date';

import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, V2_CATEGORIES } from './defaults';
import { type DatabaseKey, keyStatement } from './encryption';
import { processRecurring } from './recurring';

/**
 * Database migrations. Append new ones to the end; never edit a shipped one.
 * The array index + 1 is the schema version stored in PRAGMA user_version.
 */
export const MIGRATIONS: Migration[] = [
  // v1: initial schema
  async (db) => {
    await db.execAsync(`
      create table accounts (
        id text primary key not null,
        name text not null,
        type text not null default 'other' check (type in ('cash', 'bank', 'card', 'wallet', 'other')),
        icon text not null,
        color text not null,
        opening_balance integer not null default 0,
        archived integer not null default 0,
        sort_order integer not null default 0,
        created_at text not null
      );

      create table categories (
        id text primary key not null,
        name text not null,
        type text not null check (type in ('expense', 'income')),
        icon text not null,
        color text not null,
        archived integer not null default 0,
        sort_order integer not null default 0
      );

      create table transactions (
        id text primary key not null,
        type text not null check (type in ('expense', 'income', 'transfer')),
        amount integer not null check (amount > 0),
        category_id text references categories (id),
        account_id text not null references accounts (id),
        to_account_id text references accounts (id),
        date text not null,
        note text not null default '',
        recurring_id text,
        created_at text not null,
        updated_at text not null
      );
      create index idx_transactions_date on transactions (date);
      create index idx_transactions_category on transactions (category_id);
      create index idx_transactions_account on transactions (account_id);

      create table budgets (
        category_id text primary key not null references categories (id) on delete cascade,
        amount integer not null check (amount > 0)
      );

      create table recurring (
        id text primary key not null,
        type text not null check (type in ('expense', 'income', 'transfer')),
        amount integer not null check (amount > 0),
        category_id text references categories (id),
        account_id text not null references accounts (id),
        to_account_id text references accounts (id),
        note text not null default '',
        frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
        start_date text not null,
        end_date text,
        generated_count integer not null default 0,
        next_date text not null,
        active integer not null default 1,
        created_at text not null
      );
    `);

    const now = new Date().toISOString();
    for (const [i, a] of DEFAULT_ACCOUNTS.entries()) {
      await db.runAsync(
        'insert into accounts (id, name, type, icon, color, opening_balance, sort_order, created_at) values (?, ?, ?, ?, ?, 0, ?, ?)',
        a.id, t(a.name), a.type, a.icon, a.color, i, now,
      );
    }
    for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
      await db.runAsync(
        'insert into categories (id, name, type, icon, color, sort_order) values (?, ?, ?, ?, ?, ?)',
        c.id, t(c.name), c.type, c.icon, c.color, i,
      );
    }
  },

  // v2: everything for phases 2 to 6 (tags, splits, attachments, templates, subcategories,
  // weekly and carried-over budgets with history, bill reminders, loans, goals, investments, assets).
  async (db) => {
    const now = new Date().toISOString();
    await db.execAsync(`
      -- Accounts are rebuilt to allow the 'loan' type and to remember the last reconciliation.
      create table accounts_v2 (
        id text primary key not null,
        name text not null,
        type text not null default 'other' check (type in ('cash', 'bank', 'card', 'wallet', 'other', 'loan')),
        icon text not null,
        color text not null,
        opening_balance integer not null default 0,
        archived integer not null default 0,
        sort_order integer not null default 0,
        created_at text not null,
        reconciled_date text,
        reconciled_balance integer
      );
      insert into accounts_v2 (id, name, type, icon, color, opening_balance, archived, sort_order, created_at)
        select id, name, type, icon, color, opening_balance, archived, sort_order, created_at from accounts;
      drop table accounts;
      alter table accounts_v2 rename to accounts;

      alter table categories add column parent_id text references categories (id);
      alter table transactions add column loan_id text references accounts (id);
      create index idx_transactions_to_account on transactions (to_account_id);
      create index idx_transactions_recurring on transactions (recurring_id);

      create table tags (
        id text primary key not null,
        name text not null collate nocase unique,
        color text not null
      );
      create table transaction_tags (
        transaction_id text not null references transactions (id) on delete cascade,
        tag_id text not null references tags (id) on delete cascade,
        primary key (transaction_id, tag_id)
      );
      create index idx_transaction_tags_tag on transaction_tags (tag_id);

      create table transaction_splits (
        id text primary key not null,
        transaction_id text not null references transactions (id) on delete cascade,
        category_id text not null references categories (id),
        amount integer not null check (amount > 0),
        note text not null default '',
        sort_order integer not null default 0
      );
      create index idx_splits_transaction on transaction_splits (transaction_id);
      create index idx_splits_category on transaction_splits (category_id);

      create table attachments (
        id text primary key not null,
        transaction_id text not null references transactions (id) on delete cascade,
        file_name text not null,
        mime text not null,
        size integer not null default 0,
        created_at text not null
      );
      create index idx_attachments_transaction on attachments (transaction_id);

      create table templates (
        id text primary key not null,
        name text not null,
        type text not null check (type in ('expense', 'income', 'transfer')),
        amount integer check (amount is null or amount > 0),
        category_id text references categories (id) on delete set null,
        account_id text references accounts (id) on delete set null,
        to_account_id text references accounts (id) on delete set null,
        note text not null default '',
        sort_order integer not null default 0,
        created_at text not null
      );

      -- Budgets are rebuilt: an id, a period (month or week), an optional overall budget
      -- (category_id null), carry-forward, and limits that change over time.
      create table budgets_v2 (
        id text primary key not null,
        category_id text references categories (id) on delete cascade,
        period text not null default 'month' check (period in ('month', 'week')),
        carry_forward integer not null default 0,
        created_at text not null
      );
      create table budget_limits (
        budget_id text not null references budgets (id) on delete cascade,
        start text not null,
        amount integer not null check (amount > 0),
        primary key (budget_id, start)
      );
      insert into budgets_v2 (id, category_id, period, carry_forward, created_at)
        select 'b_' || category_id, category_id, 'month', 0, '${now}' from budgets;
      -- Existing budgets applied to every month, so their limit starts at the beginning of time.
      insert into budget_limits (budget_id, start, amount) select 'b_' || category_id, '0000-01', amount from budgets;
      drop table budgets;
      alter table budgets_v2 rename to budgets;
      create unique index idx_budgets_scope on budgets (coalesce(category_id, ''), period);

      create table budget_alerts (
        budget_id text not null references budgets (id) on delete cascade,
        period_start text not null,
        level integer not null,
        primary key (budget_id, period_start, level)
      );

      alter table recurring add column mode text not null default 'auto' check (mode in ('auto', 'remind'));
      alter table recurring add column remind_days integer;

      create table loans (
        account_id text primary key not null references accounts (id) on delete cascade,
        direction text not null check (direction in ('borrowed', 'lent')),
        principal integer not null default 0 check (principal >= 0),
        annual_rate integer not null default 0 check (annual_rate >= 0),
        tenure_months integer,
        emi integer,
        start_date text not null,
        note text not null default ''
      );

      create table goals (
        id text primary key not null,
        name text not null,
        icon text not null,
        color text not null,
        target integer not null check (target > 0),
        target_date text,
        account_id text references accounts (id) on delete set null,
        archived integer not null default 0,
        sort_order integer not null default 0,
        created_at text not null
      );
      create table goal_contributions (
        id text primary key not null,
        goal_id text not null references goals (id) on delete cascade,
        date text not null,
        amount integer not null check (amount <> 0),
        note text not null default '',
        created_at text not null
      );
      create index idx_goal_contributions_goal on goal_contributions (goal_id);

      create table holdings (
        id text primary key not null,
        kind text not null check (kind in ('investment', 'asset')),
        subtype text not null,
        name text not null,
        invested integer not null default 0 check (invested >= 0),
        quantity text not null default '',
        note text not null default '',
        purchase_date text,
        archived integer not null default 0,
        created_at text not null
      );
      create table holding_values (
        id text primary key not null,
        holding_id text not null references holdings (id) on delete cascade,
        date text not null,
        value integer not null check (value >= 0),
        created_at text not null
      );
      create index idx_holding_values_holding on holding_values (holding_id, date);

      -- One row per category amount: a split transaction contributes one line per split,
      -- any other transaction one line. Reports and budgets read this instead of transactions.
      create view tx_lines as
        select t.id as transaction_id, t.type, t.date, t.account_id, t.category_id, t.amount
        from transactions t
        where not exists (select 1 from transaction_splits s where s.transaction_id = t.id)
        union all
        select t.id, t.type, t.date, t.account_id, s.category_id, s.amount
        from transactions t join transaction_splits s on s.transaction_id = t.id;
    `);

    const max = await db.getFirstAsync<{ m: number | null }>('select max(sort_order) as m from categories');
    for (const [i, c] of V2_CATEGORIES.entries()) {
      await db.runAsync(
        'insert or ignore into categories (id, name, type, icon, color, sort_order) values (?, ?, ?, ?, ?, ?)',
        c.id, t(c.name), c.type, c.icon, c.color, (max?.m ?? 0) + 1 + i,
      );
    }
  },
  // v3: finding duplicates (same account, type and amount within a day) without scanning the whole account.
  async (db) => {
    await db.execAsync('create index idx_transactions_duplicates on transactions (account_id, type, amount, date)');
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Passed to <SQLiteProvider onInit>: unlock (when the build encrypts the database), migrate, then catch up on
 * recurring transactions. The key must be the very first statement on the connection.
 */
export async function initDatabase(db: SQLiteDatabase, key: DatabaseKey = null): Promise<void> {
  if (key) await db.execAsync(keyStatement(key.hex));
  await migrate(db, MIGRATIONS);
  await processRecurring(db, todayISO());
}

/**
 * After the language changes: renames the built-in accounts and categories into the new language,
 * but only those the user has not renamed (their name is still the default in some language).
 */
export async function relabelDefaults(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const a of DEFAULT_ACCOUNTS) {
      const names = allTranslationsOf(a.name);
      await db.runAsync(
        `update accounts set name = ? where id = ? and name in (${names.map(() => '?').join(', ')})`,
        t(a.name), a.id, ...names,
      );
    }
    for (const c of [...DEFAULT_CATEGORIES, ...V2_CATEGORIES]) {
      const names = allTranslationsOf(c.name);
      await db.runAsync(
        `update categories set name = ? where id = ? and name in (${names.map(() => '?').join(', ')})`,
        t(c.name), c.id, ...names,
      );
    }
  });
}
