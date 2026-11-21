import { t } from '@/core/i18n/locale';
import { isISODate } from '@/core/utils/date';

/**
 * Backup file format. Pure code (no database or native modules) so it can be unit-tested.
 *
 * When a new migration changes a table, update TABLE_COLUMNS and add a step to
 * upgradeBackup() that converts older files, so old backups always restore.
 */

export const BACKUP_APP_ID = 'lekhawise';
export const BACKUP_FORMAT = 2;

export const TABLE_COLUMNS = {
  accounts: [
    'id', 'name', 'type', 'icon', 'color', 'opening_balance', 'archived', 'sort_order', 'created_at',
    'reconciled_date', 'reconciled_balance',
  ],
  categories: ['id', 'name', 'type', 'icon', 'color', 'archived', 'sort_order', 'parent_id'],
  tags: ['id', 'name', 'color'],
  transactions: [
    'id', 'type', 'amount', 'category_id', 'account_id', 'to_account_id', 'date', 'note', 'recurring_id',
    'loan_id', 'created_at', 'updated_at',
  ],
  transaction_splits: ['id', 'transaction_id', 'category_id', 'amount', 'note', 'sort_order'],
  transaction_tags: ['transaction_id', 'tag_id'],
  attachments: ['id', 'transaction_id', 'file_name', 'mime', 'size', 'created_at'],
  templates: [
    'id', 'name', 'type', 'amount', 'category_id', 'account_id', 'to_account_id', 'note', 'sort_order', 'created_at',
  ],
  budgets: ['id', 'category_id', 'period', 'carry_forward', 'created_at'],
  budget_limits: ['budget_id', 'start', 'amount'],
  recurring: [
    'id', 'type', 'amount', 'category_id', 'account_id', 'to_account_id', 'note', 'frequency', 'start_date',
    'end_date', 'generated_count', 'next_date', 'active', 'created_at', 'mode', 'remind_days',
  ],
  loans: ['account_id', 'direction', 'principal', 'annual_rate', 'tenure_months', 'emi', 'start_date', 'note'],
  goals: [
    'id', 'name', 'icon', 'color', 'target', 'target_date', 'account_id', 'archived', 'sort_order', 'created_at',
  ],
  goal_contributions: ['id', 'goal_id', 'date', 'amount', 'note', 'created_at'],
  holdings: [
    'id', 'kind', 'subtype', 'name', 'invested', 'quantity', 'note', 'purchase_date', 'archived', 'created_at',
  ],
  holding_values: ['id', 'holding_id', 'date', 'value', 'created_at'],
} as const;

export type TableName = keyof typeof TABLE_COLUMNS;

/** Parents first, so foreign keys are satisfied while inserting. */
export const RESTORE_ORDER: TableName[] = [
  'accounts',
  'categories',
  'tags',
  'transactions',
  'transaction_splits',
  'transaction_tags',
  'attachments',
  'templates',
  'budgets',
  'budget_limits',
  'recurring',
  'loans',
  'goals',
  'goal_contributions',
  'holdings',
  'holding_values',
];

/** Columns holding money, per table. Used to rescale amounts when switching to or from a 3-decimal currency. */
export const MONEY_COLUMNS: Partial<Record<TableName, string[]>> = {
  accounts: ['opening_balance', 'reconciled_balance'],
  transactions: ['amount'],
  transaction_splits: ['amount'],
  templates: ['amount'],
  budget_limits: ['amount'],
  recurring: ['amount'],
  loans: ['principal', 'emi'],
  goals: ['target'],
  goal_contributions: ['amount'],
  holdings: ['invested'],
  holding_values: ['value'],
};

/** Tables whose rows have no single `id` column, and the column(s) that identify a row. */
const ROW_KEYS: Partial<Record<TableName, string[]>> = {
  transaction_tags: ['transaction_id', 'tag_id'],
  budget_limits: ['budget_id', 'start'],
  loans: ['account_id'],
};

export type Row = Record<string, string | number | null>;

/** Receipt photos: file content as base64, keyed by attachment id. */
export type BackupFiles = Record<string, string>;

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  format: number;
  schemaVersion: number;
  exportedAt: string;
  settings: Record<string, unknown>;
  data: Record<TableName, Row[]>;
  files: BackupFiles;
}

export interface BackupSummary {
  exportedAt: string;
  counts: Record<TableName, number>;
  firstDate: string | null;
  lastDate: string | null;
  photos: number;
}

export class BackupError extends Error {}

/** Tables a backup must contain for its schema version. */
function tablesFor(schemaVersion: number): TableName[] {
  return schemaVersion < 2 ? ['accounts', 'categories', 'transactions', 'budgets', 'recurring'] : RESTORE_ORDER;
}

/** Parses and validates a backup file. Throws BackupError with a message fit to show the user. */
export function parseBackup(text: string, currentSchemaVersion: number): BackupFile {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new BackupError(t('This file is not a valid backup (it is not JSON).'));
  }
  return parseBackupObject(json, currentSchemaVersion);
}

export function parseBackupObject(json: unknown, currentSchemaVersion: number): BackupFile {
  if (!isObject(json) || json.app !== BACKUP_APP_ID) {
    throw new BackupError(t('This file is not a LekhaWise backup.'));
  }
  if (typeof json.schemaVersion !== 'number' || !Number.isInteger(json.schemaVersion) || json.schemaVersion < 1) {
    throw new BackupError(t('The backup is missing its version number.'));
  }
  if (json.schemaVersion > currentSchemaVersion) {
    throw new BackupError(t('This backup was made by a newer version of the app. Update the app, then restore.'));
  }
  if (!isObject(json.data)) throw new BackupError(t('The backup has no data section.'));

  const data = {} as Record<TableName, Row[]>;
  const required = tablesFor(json.schemaVersion);
  for (const table of RESTORE_ORDER) {
    const rows = json.data[table];
    if (rows === undefined && !required.includes(table)) {
      data[table] = [];
      continue;
    }
    if (!Array.isArray(rows) || !rows.every(isObject)) {
      throw new BackupError(t('The backup is damaged: "{table}" is missing or invalid.', { table }));
    }
    data[table] = rows as Row[];
  }

  const files: BackupFiles = {};
  if (isObject(json.files)) {
    for (const [id, content] of Object.entries(json.files)) {
      if (typeof content !== 'string') throw new BackupError(t('The backup is damaged: a photo is invalid.'));
      files[id] = content;
    }
  }

  const file = upgradeBackup({
    app: BACKUP_APP_ID,
    format: typeof json.format === 'number' ? json.format : BACKUP_FORMAT,
    schemaVersion: json.schemaVersion,
    exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : '',
    settings: isObject(json.settings) ? json.settings : {},
    data,
    files,
  });
  validateRows(file.data, file.files);
  return file;
}

/** Converts an older backup to the current table layout. Add a step per schema change. */
export function upgradeBackup(file: BackupFile): BackupFile {
  if (file.schemaVersion < 2) {
    // v2: budgets got an id, a period and limits over time; new columns default to empty.
    const createdAt = file.exportedAt || new Date(0).toISOString();
    const oldBudgets = file.data.budgets;
    file.data.budgets = oldBudgets.map((b) => ({
      id: `b_${String(b.category_id)}`,
      category_id: b.category_id,
      period: 'month',
      carry_forward: 0,
      created_at: createdAt,
    }));
    file.data.budget_limits = oldBudgets.map((b) => ({
      budget_id: `b_${String(b.category_id)}`,
      start: '0000-01',
      amount: b.amount,
    }));
    file.data.categories.forEach((c) => (c.parent_id = null));
    file.data.transactions.forEach((t) => (t.loan_id = null));
    file.data.recurring.forEach((r) => {
      r.mode = 'auto';
      r.remind_days = null;
    });
    file.data.accounts.forEach((a) => {
      a.reconciled_date = null;
      a.reconciled_balance = null;
    });
    file.schemaVersion = 2;
  }
  return file;
}

function validateRows(data: Record<TableName, Row[]>, files: BackupFiles): void {
  const fail = (message: string) => {
    throw new BackupError(t('The backup is damaged: {detail}', { detail: t(message) }));
  };

  for (const table of RESTORE_ORDER) {
    const seen = new Set<string>();
    const keys = ROW_KEYS[table] ?? ['id'];
    for (const row of data[table]) {
      for (const key of keys) {
        if (typeof row[key] !== 'string' || !row[key]) fail(t('a row in "{table}" has no id.', { table }));
      }
      const id = keys.map((key) => row[key]).join('|');
      if (seen.has(id)) fail(t('"{table}" contains the same id twice.', { table }));
      seen.add(id);
    }
  }

  const ids = (table: TableName, key = 'id') => new Set(data[table].map((row) => row[key]));
  const accountIds = ids('accounts');
  const categoryIds = ids('categories');
  const transactionIds = ids('transactions');
  const tagIds = ids('tags');
  const budgetIds = ids('budgets');
  const goalIds = ids('goals');
  const holdingIds = ids('holdings');
  const isAmount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  const isWhole = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
  const optional = (set: Set<unknown>, value: unknown) => value == null || set.has(value);

  for (const c of data.categories) {
    if (c.parent_id != null && (!categoryIds.has(c.parent_id) || c.parent_id === c.id)) {
      fail('a subcategory refers to a missing parent category.');
    }
  }
  for (const tx of [...data.transactions, ...data.recurring]) {
    if (!isAmount(tx.amount)) fail('an amount is not a positive whole number of cents.');
    if (!accountIds.has(tx.account_id)) fail('an entry refers to an account that is not in the backup.');
    if (!optional(accountIds, tx.to_account_id)) fail('a transfer refers to a missing account.');
    if (!optional(categoryIds, tx.category_id)) fail('an entry refers to a missing category.');
  }
  for (const tx of data.transactions) {
    if (!isISODate(tx.date)) fail(t('"{value}" is not a valid date.', { value: String(tx.date) }));
    if (!optional(accountIds, tx.loan_id)) fail('an interest entry refers to a missing loan.');
  }
  for (const r of data.recurring) {
    if (!isISODate(r.start_date) || !isISODate(r.next_date)) fail('a recurring entry has an invalid date.');
  }
  for (const s of data.transaction_splits) {
    if (!transactionIds.has(s.transaction_id) || !categoryIds.has(s.category_id)) fail('a split is incomplete.');
    if (!isAmount(s.amount)) fail('a split amount is invalid.');
  }
  for (const tt of data.transaction_tags) {
    if (!transactionIds.has(tt.transaction_id) || !tagIds.has(tt.tag_id)) fail('a tag link is incomplete.');
  }
  for (const a of data.attachments) {
    if (!transactionIds.has(a.transaction_id)) fail('a photo belongs to a missing transaction.');
  }
  for (const id of Object.keys(files)) {
    if (!data.attachments.some((a) => a.id === id)) fail('the backup contains a photo that belongs to nothing.');
  }
  for (const tpl of data.templates) {
    if (tpl.amount != null && !isAmount(tpl.amount)) fail('a template amount is invalid.');
    if (!optional(categoryIds, tpl.category_id) || !optional(accountIds, tpl.account_id)) {
      fail('a template refers to something that is missing.');
    }
  }
  for (const b of data.budgets) {
    if (!optional(categoryIds, b.category_id)) fail('a budget refers to a missing category.');
    if (b.period !== 'month' && b.period !== 'week') fail('a budget has an unknown period.');
  }
  for (const l of data.budget_limits) {
    if (!budgetIds.has(l.budget_id)) fail('a budget limit belongs to a missing budget.');
    if (!isAmount(l.amount)) fail('a budget amount is invalid.');
  }
  for (const loan of data.loans) {
    if (!accountIds.has(loan.account_id)) fail('a loan has no account.');
    if (loan.direction !== 'borrowed' && loan.direction !== 'lent') fail('a loan has an unknown direction.');
    if (!isISODate(loan.start_date)) fail('a loan has an invalid start date.');
  }
  for (const g of data.goals) {
    if (!isAmount(g.target)) fail('a goal target is invalid.');
    if (!optional(accountIds, g.account_id)) fail('a goal refers to a missing account.');
  }
  for (const c of data.goal_contributions) {
    if (!goalIds.has(c.goal_id)) fail('a goal contribution belongs to a missing goal.');
    if (!isWhole(c.amount) || c.amount === 0 || !isISODate(c.date)) fail('a goal contribution is invalid.');
  }
  for (const h of data.holdings) {
    if (h.kind !== 'investment' && h.kind !== 'asset') fail('an investment or asset has an unknown kind.');
    if (!isWhole(h.invested) || (h.invested as number) < 0) fail('an invested amount is invalid.');
  }
  for (const v of data.holding_values) {
    if (!holdingIds.has(v.holding_id)) fail('a value belongs to a missing investment or asset.');
    if (!isWhole(v.value) || (v.value as number) < 0 || !isISODate(v.date)) fail('a value entry is invalid.');
  }
}

export function summarizeBackup(file: BackupFile): BackupSummary {
  const dates = file.data.transactions.map((t) => String(t.date)).sort();
  const counts = {} as Record<TableName, number>;
  for (const table of RESTORE_ORDER) counts[table] = file.data[table].length;
  return {
    exportedAt: file.exportedAt,
    counts,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    photos: Object.keys(file.files).length,
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
