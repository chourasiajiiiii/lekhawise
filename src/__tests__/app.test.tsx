/**
 * End-to-end screen tests: the real app (every route in src/app) rendered with real navigation and a real
 * SQLite database. Each test taps through a feature the way a user would.
 */
import { File } from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as ScreenCapture from 'expo-screen-capture';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';

import { getLockMethod } from '@/core/lock/AppLock';
import { getSetting, setSetting } from '@/core/settings/settings';
import { addPeriods, todayISO } from '@/core/utils/date';

jest.setTimeout(30_000);

// ------------------------------------------------------------------ helpers

const files = () => (globalThis as unknown as { __files: Map<string, string> }).__files;
const db = () => (globalThis as unknown as { __testDb: SQLiteDatabase }).__testDb;
const alerts = () => (Alert.alert as jest.Mock).mock.calls;
const lastAlert = () => alerts()[alerts().length - 1];

/** Presses a button in the most recent Alert.alert call. */
async function pressAlert(text: string) {
  const button = (lastAlert()[2] as { text: string; onPress?: () => unknown }[]).find((b) => b.text === text);
  if (!button) throw new Error(`No alert button "${text}" in ${JSON.stringify(lastAlert())}`);
  await act(async () => {
    await button.onPress?.();
  });
}

async function start(url = '/') {
  await renderRouter('./src/app', { initialUrl: url });
  await screen.findAllByText(/.+/);
}

async function go(path: string) {
  await act(async () => router.navigate(path as never));
}

async function press(text: string | RegExp, index = 0) {
  const matches = await screen.findAllByText(text);
  await fireEvent.press(matches[index]);
}

async function tapLabel(label: string) {
  await fireEvent.press(await screen.findByLabelText(label));
}

type TxOptions = {
  amount: string;
  type?: 'Expense' | 'Income' | 'Transfer';
  category?: string;
  account?: string;
  note?: string;
  repeat?: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
  date?: Date;
};

/** Fills and saves the add-transaction form starting from the home screen. */
async function addTransaction({ amount, type, category, account, note, repeat, date }: TxOptions) {
  await go('/transaction/new');
  const input = await screen.findByLabelText('Amount');
  if (type && type !== 'Expense') await press(type);
  await fireEvent.changeText(input, amount);
  if (category) await press(category);
  if (account) await press(account);
  if (note) await fireEvent.changeText(screen.getByPlaceholderText('Optional'), note);
  if (date) {
    const picker = screen.getByTestId('date-picker');
    await act(async () => picker.props.onChange({ type: 'set' }, date));
  }
  if (repeat) await press(repeat);
  await press('Save');
  await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());
}

const count = async (sql: string) => (await db().getFirstAsync<{ n: number }>(sql))?.n;

const visibleText = () =>
  screen
    .queryAllByText(/.+/)
    .map((t) => [t.props.children].flat().join(''))
    .filter((t) => t.trim().length > 1);

/** Waits for the transactions list to report `n` entries; on failure says what is on screen. */
async function expectEntries(n: number, step: string) {
  const label = `${n} ${n === 1 ? 'entry' : 'entries'}`;
  try {
    await screen.findByText(label);
  } catch {
    throw new Error(`[${step}] expected "${label}"; visible: ${visibleText().slice(0, 40).join(' | ')}`);
  }
}

beforeEach(() => {
  setSetting('currency', 'INR'); // deterministic formatting regardless of the computer's locale
});

// ------------------------------------------------------------------ tests

describe('home dashboard', () => {
  it('starts empty with the seeded accounts', async () => {
    await start();
    expect(screen.getByText('Total balance')).toBeTruthy();
    expect(screen.getByText('No transactions yet')).toBeTruthy();
    expect(screen.getByText('No expenses this month.')).toBeTruthy();
    expect(screen.getAllByText('Cash').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bank account').length).toBeGreaterThan(0);
    expect(screen.queryByText('Back up your data')).toBeNull(); // no reminder without data
  });

  it('updates totals, breakdown, recent list and balances after adding an expense', async () => {
    await start();
    await addTransaction({ amount: '250', category: 'Food & dining', note: 'Lunch' });

    await screen.findByText('Lunch'); // recent list row subtitle
    await screen.findAllByText('-₹250.00'); // recent list row amount
    expect(screen.getAllByText('₹250.00').length).toBeGreaterThanOrEqual(2); // expenses stat + category bar
    expect(screen.getAllByText('-₹250.00').length).toBeGreaterThanOrEqual(2); // row + total balance / account
    expect(screen.getAllByText('Food & dining')).toHaveLength(2); // category bar + recent row title
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('Back up your data')).toBeTruthy(); // reminder appears once there is data
  });

  it('shows savings and savings rate', async () => {
    await start();
    await addTransaction({ amount: '800', type: 'Income', category: 'Salary' });
    await addTransaction({ amount: '200', category: 'Groceries' });
    await screen.findByText('75%');
    expect(screen.getByText('savings rate')).toBeTruthy();
    expect(screen.getAllByText('₹600.00').length).toBeGreaterThan(0);
  });

  it('switches months and jumps back', async () => {
    await start();
    const thisMonth = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    expect(screen.getByText(thisMonth)).toBeTruthy();
    await tapLabel('Previous month');
    expect(await screen.findByText('Back to this month')).toBeTruthy();
    await press('Back to this month');
    await waitFor(() => expect(screen.queryByText('Back to this month')).toBeNull());
  });
});

describe('transaction form', () => {
  it('validates amount, category and transfer accounts', async () => {
    await start();
    await go('/transaction/new');
    await screen.findByLabelText('Amount');

    await press('Save');
    expect(lastAlert()).toEqual(['Check the details', 'Enter an amount greater than zero.']);

    await fireEvent.changeText(screen.getByLabelText('Amount'), 'abc');
    await press('Save');
    expect(lastAlert()[1]).toBe('Enter an amount greater than zero.');

    await fireEvent.changeText(screen.getByLabelText('Amount'), '50');
    await press('Save');
    expect(lastAlert()[1]).toBe('Choose a category.');

    await press('Transfer');
    await press('Save');
    expect(lastAlert()[1]).toBe('Choose the account to transfer to.');
    expect(await count('select count(*) as n from transactions')).toBe(0);
  });

  it('edits and deletes a transaction', async () => {
    await start();
    await addTransaction({ amount: '120', category: 'Transport', note: 'Taxi' });
    await go('/transactions');
    await press(/Taxi/);
    const input = await screen.findByLabelText('Amount');
    expect(input.props.value).toBe('120');
    expect(screen.getByText('Save changes')).toBeTruthy(); // edit mode

    await fireEvent.changeText(input, '135.50');
    await press('Save changes');
    expect(await screen.findAllByText('-₹135.50')).toHaveLength(2); // row + day total

    await press(/Taxi/);
    await screen.findByLabelText('Amount');
    await press('Delete');
    expect(lastAlert()[0]).toBe('Delete transaction?');
    await pressAlert('Delete');
    await screen.findByText('Nothing here'); // back on the now-empty list
    expect(await count('select count(*) as n from transactions')).toBe(0);
  });

  it('records income and transfers with correct account balances', async () => {
    await start();
    await addTransaction({ amount: '900', type: 'Income', category: 'Salary', account: 'Bank account' });
    // Transfer 300 from Bank to Cash
    await go('/transaction/new');
    const input = await screen.findByLabelText('Amount');
    await press('Transfer');
    await fireEvent.changeText(input, '300');
    await press('Bank account', 0); // "From" list
    await press('Cash', 1); // "To" list (the From list also contains Cash)
    await press('Save');
    await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());

    await go('/accounts');
    await screen.findByText('New account');
    expect(screen.getByText('₹900.00')).toBeTruthy(); // total
    expect(screen.getByText('₹300.00')).toBeTruthy(); // cash
    expect(screen.getByText('₹600.00')).toBeTruthy(); // bank

    const [transfer] = await db().getAllAsync<{ category_id: string | null; type: string }>(
      "select * from transactions where type = 'transfer'",
    );
    expect(transfer.category_id).toBeNull();
  });

  it('remembers the last used account', async () => {
    await start();
    await addTransaction({ amount: '10', category: 'Food & dining', account: 'Bank account' });
    await addTransaction({ amount: '20', category: 'Food & dining' });
    const rows = await db().getAllAsync<{ account_id: string }>('select account_id from transactions');
    expect(rows.map((r) => r.account_id)).toEqual(['acc_bank', 'acc_bank']);
  });
});

describe('recurring transactions', () => {
  it('backfills a monthly rule, lists it, and pauses it', async () => {
    await start();
    const twoMonthsAgo = addPeriods(todayISO(), 'monthly', -2);
    const [y, m, d] = twoMonthsAgo.split('-').map(Number);
    await addTransaction({
      amount: '199',
      category: 'Entertainment',
      note: 'Streaming',
      repeat: 'Monthly',
      date: new Date(y, m - 1, d),
    });
    expect(await count("select count(*) as n from transactions where note = 'Streaming'")).toBe(3);

    await go('/recurring');
    await screen.findByText('Streaming');
    expect(screen.getByText(/^Monthly · next/)).toBeTruthy();
    await press('Streaming');
    await press('Pause');
    await screen.findByText('Paused');
    await screen.findByText('Payment history');
    expect(screen.getAllByText(/Streaming/).length).toBeGreaterThan(1); // the three entries it created

    await press('Resume (adds any missed entries)');
    await screen.findByText(/^Next:/);
    expect(await count("select count(*) as n from transactions where note = 'Streaming'")).toBe(3);

    await press('Delete rule');
    await pressAlert('Delete');
    await screen.findByText('No recurring transactions');
    // History stays
    expect(await count("select count(*) as n from transactions where note = 'Streaming'")).toBe(3);
  });

  it('does not create anything for a future start date', async () => {
    await start();
    const next = addPeriods(todayISO(), 'daily', 5);
    const [y, m, d] = next.split('-').map(Number);
    await addTransaction({ amount: '50', category: 'Bills & utilities', repeat: 'Weekly', date: new Date(y, m - 1, d) });
    expect(await count('select count(*) as n from transactions')).toBe(0);
    expect(await count('select count(*) as n from recurring')).toBe(1);
  });
});

describe('transactions list', () => {
  it('searches across months and filters by type, account and category', async () => {
    await start();
    await addTransaction({ amount: '300', category: 'Food & dining', note: 'Pizza' });
    await addTransaction({ amount: '90', category: 'Transport', note: 'Metro', account: 'Bank account' });
    await addTransaction({ amount: '500', type: 'Income', category: 'Freelance', note: 'Logo job' });

    await go('/transactions');
    await expectEntries(3, 'initial');

    await fireEvent.changeText(screen.getByPlaceholderText('Search notes, categories, tags, amounts'), 'pizz');
    await screen.findByText('Searching all months');
    await expectEntries(1, 'search text');
    expect(screen.getByText(/Pizza/)).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText('Search notes, categories, tags, amounts'), '90');
    await screen.findByText(/Metro/);
    await expectEntries(1, 'search amount');

    await fireEvent.changeText(screen.getByPlaceholderText('Search notes, categories, tags, amounts'), '');
    await expectEntries(3, 'search cleared');

    await press('Income');
    await expectEntries(1, 'income filter');
    expect(screen.getByText(/Logo job/)).toBeTruthy();

    await press('Transfers');
    await screen.findByText('Nothing here');
    expect(screen.getByText('Try clearing a filter.')).toBeTruthy();

    await press('All');
    await expectEntries(3, 'all');
    await press('Bank account');
    // Metro, plus Logo job: the income form defaulted to the last used account (Bank account)
    await expectEntries(2, 'account filter');
    await press('Bank account'); // toggles off
    await expectEntries(3, 'account filter off');
    await press('Transport');
    await expectEntries(1, 'category filter');
  });
});

describe('budgets', () => {
  it('sets, shows progress, and removes a budget', async () => {
    await start();
    await addTransaction({ amount: '400', category: 'Food & dining' });
    await go('/budgets');
    await screen.findByText('Set a budget');

    await press('Food & dining');
    await screen.findByText('Monthly budget: Food & dining');
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '1000');
    await press('Save');

    await screen.findByText('By category');
    expect(screen.getByText('₹600.00 left')).toBeTruthy();
    expect(screen.getByText('₹400.00 of ₹1,000.00')).toBeTruthy(); // category row
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('₹400.00 / ₹1,000.00')).toBeTruthy(); // section total

    // Over budget: an alert right after saving the expense, and red figures
    await addTransaction({ amount: '700', category: 'Food & dining' });
    await waitFor(() => expect(lastAlert()[0]).toBe('Over budget: Food & dining'));
    await go('/budgets');
    await screen.findByText('₹100.00 over');

    // The budget's own screen: invalid input is rejected, then it is deleted
    await press('Food & dining');
    await press('Change amount');
    await fireEvent.changeText(await screen.findByDisplayValue('1000'), '12.345');
    await press('Save');
    expect(lastAlert()[0]).toBe('Invalid amount');
    await press('Cancel');

    await press('Delete budget');
    await pressAlert('Delete');
    await screen.findByText('Set a budget');
    expect(await count('select count(*) as n from budgets')).toBe(0);
  });
});

describe('categories', () => {
  it('creates, edits, deletes unused and archives used categories', async () => {
    await start('/categories');
    await press('New category');
    await fireEvent.changeText(await screen.findByPlaceholderText('e.g. Coffee'), 'Coffee');
    await tapLabel('cafe');
    await press('Save');
    await screen.findByText('Coffee');

    // Empty name is rejected
    await press('New category');
    await screen.findByPlaceholderText('e.g. Coffee');
    await press('Save');
    expect(lastAlert()[0]).toBe('Name needed');
    await act(async () => router.back());

    // Rename
    await press('Coffee');
    await fireEvent.changeText(await screen.findByDisplayValue('Coffee'), 'Coffee & tea');
    await press('Save');
    await screen.findByText('Coffee & tea');

    // Delete unused
    await press('Coffee & tea');
    await press('Delete');
    await pressAlert('Delete');
    await waitFor(() => expect(screen.queryByText('Coffee & tea')).toBeNull());

    // Used category is archived, then unarchived
    await addTransaction({ amount: '75', category: 'Travel' });
    await go('/categories');
    await press('Travel');
    await press('Delete');
    await pressAlert('Delete');
    await waitFor(() => expect(lastAlert()[0]).toBe('Archived'));
    await go('/categories');
    await screen.findByText('Archived (hidden when adding transactions, kept in history)');

    await go('/transaction/new');
    await screen.findByLabelText('Amount');
    expect(screen.queryByText('Travel')).toBeNull(); // hidden from new entries
    await act(async () => router.back());

    await go('/categories');
    await press('Travel');
    await press('Unarchive');
    await waitFor(() =>
      expect(screen.queryByText('Archived (hidden when adding transactions, kept in history)')).toBeNull(),
    );
  });

  it('creates an income category', async () => {
    await start('/categories');
    await press('Income');
    await press('New category');
    await fireEvent.changeText(await screen.findByPlaceholderText('e.g. Coffee'), 'Rental income');
    await press('Save');
    await screen.findByText('Rental income');
    const row = await db().getFirstAsync<{ type: string }>("select type from categories where name = 'Rental income'");
    expect(row?.type).toBe('income');
  });
});

describe('accounts', () => {
  it('creates bank and credit card accounts, edits, archives', async () => {
    await start('/accounts');
    await press('New account');
    await fireEvent.changeText(await screen.findByPlaceholderText('e.g. HDFC Savings'), 'HDFC Savings');
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '500');
    await press('Save');
    await screen.findByText('HDFC Savings');
    expect(screen.getAllByText('₹500.00').length).toBeGreaterThan(0);

    await press('New account');
    await fireEvent.changeText(await screen.findByPlaceholderText('e.g. HDFC Savings'), 'Visa card');
    await press('Credit card');
    expect(screen.getByLabelText('Amount owed when you started tracking')).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '200');
    await press('Save');
    await screen.findByText('Visa card');
    expect(screen.getByText('-₹200.00')).toBeTruthy();
    expect(screen.getByText('₹300.00')).toBeTruthy(); // total 500 - 200

    // Spend on the card, then archive it (it has history)
    await addTransaction({ amount: '50', category: 'Shopping', account: 'Visa card' });
    await go('/accounts');
    await press('Visa card');
    await screen.findByText('Current balance');
    expect(screen.getByText('Recent activity')).toBeTruthy();
    await press('Delete');
    await pressAlert('Delete');
    await waitFor(() => expect(lastAlert()[0]).toBe('Archived'));
    await go('/accounts');
    await screen.findByText('Archived');

    // Invalid starting balance
    await press('New account');
    await fireEvent.changeText(await screen.findByPlaceholderText('e.g. HDFC Savings'), 'Bad');
    await fireEvent.changeText(screen.getByPlaceholderText('0'), '1.2.3');
    await press('Save');
    expect(lastAlert()[0]).toBe('Invalid amount');
  });

  it('deletes an unused account', async () => {
    await start('/accounts');
    await press('Bank account');
    await press('Delete');
    await pressAlert('Delete');
    await screen.findByText('New account'); // back on the list
    await waitFor(() => expect(screen.queryByText('Bank account')).toBeNull());
    expect(await count("select count(*) as n from accounts where id = 'acc_bank'")).toBe(0);
  });
});

describe('settings', () => {
  it('changes currency and theme', async () => {
    await start('/settings');
    await press('Currency');
    await screen.findByPlaceholderText('Search currency');
    await fireEvent.changeText(screen.getByPlaceholderText('Search currency'), 'dollar');
    expect(screen.queryByText('INR · Indian rupee')).toBeNull();
    await press('USD · US dollar');
    await screen.findByText('USD · US dollar');
    expect(getSetting('currency', '')).toBe('USD');

    await press('Dark');
    expect(getSetting('theme', '')).toBe('dark');
    await press('System');
    expect(getSetting('theme', '')).toBe('system');

    await go('/');
    expect((await screen.findAllByText('$0.00')).length).toBeGreaterThan(0);
  });

  it('turns the phone lock on only after authenticating, and refuses without a screen lock', async () => {
    await start('/security');
    await screen.findByText('Phone lock');

    (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValueOnce(0);
    await press('Phone lock');
    await waitFor(() => expect(lastAlert()[0]).toBe('No screen lock'));
    expect(getLockMethod()).toBe('off');

    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await press('Phone lock');
    await act(async () => {});
    expect(getLockMethod()).toBe('off');

    await press('Phone lock');
    await waitFor(() => expect(getLockMethod()).toBe('device'));
    await screen.findByText('Lock again');
    await press('After 1 minute');
    expect(getSetting('lockAfterSeconds', 30)).toBe(60);
  });

  it('locks the app at start until authenticated', async () => {
    setSetting('appLock', true);
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await start();
    await screen.findByText(/is locked/);
    expect(screen.getByText('Unlock')).toBeTruthy();
    // The app-switcher preview is protected by the OS while the lock is on (test platform is iOS).
    expect(ScreenCapture.enableAppSwitcherProtectionAsync).toHaveBeenCalled();

    await press('Unlock');
    await waitFor(() => expect(screen.queryByText(/is locked/)).toBeNull());
  });
});

describe('backup, restore and export', () => {
  it('exports a backup file and a CSV through the share sheet', async () => {
    await start();
    await addTransaction({ amount: '250', category: 'Food & dining', note: 'Dinner, "with friends"' });
    await go('/backup');
    await screen.findByText('No backup made yet.');

    await press('Create backup file');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    const [uri, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
    expect(uri).toBe(`file:///cache/lekhawise-backup-${todayISO()}.json`);
    expect(options.mimeType).toBe('application/json');
    const backup = JSON.parse(files().get(uri)!);
    expect(backup.app).toBe('lekhawise');
    expect(backup.data.transactions).toHaveLength(1);
    expect(backup.settings.currency).toBe('INR');
    await screen.findByText(/^Last backup file created:/);

    await press('Share CSV');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(2));
    const csvUri = (Sharing.shareAsync as jest.Mock).mock.calls[1][0];
    const csv = files().get(csvUri)!;
    expect(csv).toContain('Date,Type,Amount,Currency,Category,Account,To account,Note');
    expect(csv).toContain(`${todayISO()},expense,-250,INR,Food & dining,Cash,,"Dinner, ""with friends"""`);

    // The home reminder disappears after a backup
    await go('/');
    await screen.findByText('Total balance');
    expect(screen.queryByText('Back up your data')).toBeNull();
  });

  it('previews and restores a backup, replacing current data', async () => {
    await start();
    await addTransaction({ amount: '111', category: 'Health', note: 'Doctor' });
    await go('/backup');
    await press('Create backup file');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    const backupText = files().get((Sharing.shareAsync as jest.Mock).mock.calls[0][0])!;

    // Change data after the backup
    await addTransaction({ amount: '222', category: 'Shopping', note: 'Shoes' });
    expect(await count('select count(*) as n from transactions')).toBe(2);

    files().set('file:///picked/my-backup.json', backupText);
    (File.pickFileAsync as unknown as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      result: new File('file:///picked/my-backup.json'),
    });
    await go('/backup');
    await press('Choose backup file');
    await screen.findByText('my-backup.json');
    expect(screen.getByText('Transactions')).toBeTruthy();

    await press('Restore this backup');
    expect(lastAlert()[0]).toBe('Replace all data?');
    await pressAlert('Replace');
    await waitFor(() => expect(lastAlert()[0]).toBe('Restored'));

    const notes = await db().getAllAsync<{ note: string }>('select note from transactions');
    expect(notes.map((n) => n.note)).toEqual(['Doctor']);
  });

  it('rejects a file that is not a backup and changes nothing', async () => {
    await start();
    await addTransaction({ amount: '10', category: 'Food & dining' });
    files().set('file:///picked/photo.json', '{"hello": "world"}');
    (File.pickFileAsync as unknown as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      result: new File('file:///picked/photo.json'),
    });
    await go('/backup');
    await press('Choose backup file');
    await waitFor(() => expect(lastAlert()).toEqual(['Could not complete', 'This file is not a LekhaWise backup.']));
    expect(screen.queryByText('Restore this backup')).toBeNull();
    expect(await count('select count(*) as n from transactions')).toBe(1);
  });

  it('does nothing when the file picker is cancelled', async () => {
    await start('/backup');
    (File.pickFileAsync as unknown as jest.Mock).mockResolvedValueOnce({ canceled: true, result: null });
    await press('Choose backup file');
    await screen.findByText('Choose backup file');
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
