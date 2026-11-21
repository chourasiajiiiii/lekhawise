import { BackupError, parseBackup, RESTORE_ORDER, summarizeBackup } from '../backupFormat';

/** A backup in the version 1 layout (five tables, budgets keyed by category). */
function makeV1(overrides: Record<string, unknown> = {}) {
  return {
    app: 'lekhawise',
    format: 1,
    schemaVersion: 1,
    exportedAt: '2026-11-21T10:00:00.000Z',
    settings: { currency: 'INR' },
    data: {
      accounts: [{ id: 'a1', name: 'Cash', type: 'cash', icon: 'cash-outline', color: '#000', opening_balance: 0, archived: 0, sort_order: 0, created_at: 'x' }],
      categories: [{ id: 'c1', name: 'Food', type: 'expense', icon: 'restaurant-outline', color: '#000', archived: 0, sort_order: 0 }],
      transactions: [
        { id: 't1', type: 'expense', amount: 1250, category_id: 'c1', account_id: 'a1', to_account_id: null, date: '2026-11-02', note: '', recurring_id: null, created_at: 'x', updated_at: 'x' },
        { id: 't2', type: 'expense', amount: 500, category_id: 'c1', account_id: 'a1', to_account_id: null, date: '2026-10-01', note: '', recurring_id: null, created_at: 'x', updated_at: 'x' },
      ],
      budgets: [{ category_id: 'c1', amount: 100000 }] as Record<string, unknown>[],
      recurring: [] as Record<string, unknown>[],
    },
    ...overrides,
  };
}

/** The same data in the version 2 layout, with one row in some of the new tables. */
function makeV2() {
  const v1 = makeV1();
  return {
    ...v1,
    format: 2,
    schemaVersion: 2,
    data: {
      ...v1.data,
      categories: [...v1.data.categories.map((c) => ({ ...c, parent_id: null })), { id: 'c2', name: 'Coffee', type: 'expense', icon: 'cafe-outline', color: '#000', archived: 0, sort_order: 1, parent_id: 'c1' }],
      budgets: [{ id: 'b1', category_id: 'c1', period: 'month', carry_forward: 0, created_at: 'x' }],
      budget_limits: [{ budget_id: 'b1', start: '2026-11', amount: 5000 }],
      tags: [{ id: 'g1', name: 'Trip', color: '#000' }],
      transaction_tags: [{ transaction_id: 't1', tag_id: 'g1' }],
      transaction_splits: [] as Record<string, unknown>[],
      attachments: [{ id: 'p1', transaction_id: 't1', file_name: 'receipt.jpg', mime: 'image/jpeg', size: 3, created_at: 'x' }],
      templates: [],
      loans: [],
      goals: [{ id: 'goal', name: 'Trip', icon: 'x', color: '#000', target: 1000, target_date: null, account_id: null, archived: 0, sort_order: 0, created_at: 'x' }],
      goal_contributions: [{ id: 'gc', goal_id: 'goal', date: '2026-11-01', amount: -50, note: '', created_at: 'x' }],
      holdings: [],
      holding_values: [],
    },
    files: { p1: 'AAAA' },
  };
}

const parse = (value: unknown, schema = 2) => parseBackup(JSON.stringify(value), schema);

describe('parseBackup', () => {
  it('accepts a version 2 backup and summarises it', () => {
    const file = parse(makeV2());
    const summary = summarizeBackup(file);
    expect(summary.counts).toMatchObject({ accounts: 1, categories: 2, transactions: 2, budgets: 1, tags: 1, goals: 1 });
    expect(Object.keys(summary.counts)).toEqual(RESTORE_ORDER);
    expect(summary.photos).toBe(1);
    expect(summary.firstDate).toBe('2026-10-01');
    expect(summary.lastDate).toBe('2026-11-02');
  });

  it('upgrades a version 1 backup to the current layout', () => {
    const file = parse(makeV1());
    expect(file.schemaVersion).toBe(2);
    expect(file.data.budgets).toEqual([{ id: 'b_c1', category_id: 'c1', period: 'month', carry_forward: 0, created_at: '2026-11-21T10:00:00.000Z' }]);
    expect(file.data.budget_limits).toEqual([{ budget_id: 'b_c1', start: '0000-01', amount: 100000 }]);
    expect(file.data.tags).toEqual([]);
    expect(file.data.categories[0].parent_id).toBeNull();
  });

  it('rejects files that are not JSON or not ours', () => {
    expect(() => parseBackup('not json', 2)).toThrow(BackupError);
    expect(() => parse({ app: 'other' })).toThrow('not a LekhaWise backup');
  });

  it('rejects backups from a newer app version', () => {
    expect(() => parse(makeV1({ schemaVersion: 3 }))).toThrow('newer version');
  });

  it('rejects broken references and bad values', () => {
    const missingAccount = makeV1();
    missingAccount.data.transactions[0].account_id = 'nope';
    expect(() => parse(missingAccount)).toThrow('account');

    const badAmount = makeV1();
    badAmount.data.transactions[0].amount = 12.5;
    expect(() => parse(badAmount)).toThrow('amount');

    const badDate = makeV1();
    badDate.data.transactions[0].date = '2026-02-31';
    expect(() => parse(badDate)).toThrow('date');

    const duplicate = makeV1();
    duplicate.data.transactions[1].id = 't1';
    expect(() => parse(duplicate)).toThrow('same id');

    const badParent = makeV2();
    badParent.data.categories[1].parent_id = 'missing';
    expect(() => parse(badParent)).toThrow('parent');

    const badTag = makeV2();
    badTag.data.transaction_tags[0].tag_id = 'missing';
    expect(() => parse(badTag)).toThrow('tag');

    const strayPhoto = makeV2();
    (strayPhoto.files as Record<string, string>).other = 'AAAA';
    expect(() => parse(strayPhoto)).toThrow('photo');

    const badLimit = makeV2();
    badLimit.data.budget_limits[0].amount = 0;
    expect(() => parse(badLimit)).toThrow('budget');
  });

  it('rejects a missing table', () => {
    const backup = makeV1();
    delete (backup.data as Record<string, unknown>).budgets;
    expect(() => parse(backup)).toThrow('budgets');
    const v2 = makeV2();
    delete (v2.data as Record<string, unknown>).loans;
    expect(() => parse(v2)).toThrow('loans');
  });
});
