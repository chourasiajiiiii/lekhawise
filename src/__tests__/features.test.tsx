/**
 * Screen tests for the features added after version 1, tapped through the real app with a real database.
 */
import { strFromU8, unzipSync } from 'fflate';
import { File } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as Print from 'expo-print';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as Sharing from 'expo-sharing';

import { getLockMethod } from '@/core/lock/AppLock';
import { setSetting } from '@/core/settings/settings';
import { addDays, currentMonthKey, financialYearOf, formatFinancialYear, todayISO } from '@/core/utils/date';
import { rescheduleBillReminders } from '@/features/expenses/notifications';

import {
  addTransaction,
  back,
  count,
  db,
  files,
  go,
  lastAlert,
  press,
  pressAlert,
  pressLast,
  start,
  tapLabel,
  type,
  typeIn,
} from './helpers';

jest.setTimeout(60_000);

beforeEach(() => {
  setSetting('currency', 'INR');
});

const sharedFile = (call: number) => {
  const uri = (Sharing.shareAsync as jest.Mock).mock.calls[call][0] as string;
  return { uri, content: files().get(uri), options: (Sharing.shareAsync as jest.Mock).mock.calls[call][1] };
};

describe('transaction form extras', () => {
  it('splits one payment across categories', async () => {
    await start();
    await go('/transaction/new');
    await type('Amount', '1000');
    await press('Split into several categories');
    await tapLabel('Category for part 1');
    await pressLast('Groceries');
    await type('Amount for part 1', '700');
    await tapLabel('Category for part 2');
    await pressLast('Personal care');
    await screen.findByText('₹300.00 left to assign');
    await press('Put the rest in the empty part');
    await screen.findByText('Adds up');
    await press('Save');
    await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());
    expect(await count('select count(*) as n from transaction_splits')).toBe(2);
    await go('/transactions');
    await screen.findByText('Split · 2 categories');
    await press('Groceries'); // category filter finds the split entry through its part
    await screen.findByText('Split · 2 categories');
  });

  it('adds tags, filters by tag, and fills the form from a template', async () => {
    await start();
    await go('/transaction/new');
    await type('Amount', '50');
    await press('Food & dining');
    await press('New tag');
    await typeIn('e.g. Goa trip', 'Goa');
    await pressLast('Save');
    await screen.findByText('#Goa');
    await press('Save');
    await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());
    expect(await count('select count(*) as n from transaction_tags')).toBe(1);

    await addTransaction({ amount: '75', category: 'Transport' });
    await go('/transactions');
    await press('#Goa');
    await screen.findByText('1 entry');

    await go('/transaction/new');
    await type('Amount', '20');
    await press('Transport');
    await typeIn('Optional', 'Metro card');
    await press('Save as template');
    await typeIn('e.g. Morning coffee', 'Metro');
    await pressLast('Save');
    await waitFor(() => expect(lastAlert()[0]).toBe('Template saved'));
    await back();
    await go('/transaction/new');
    await press('Metro');
    expect((await screen.findByLabelText('Amount')).props.value).toBe('20');
    expect(screen.getByDisplayValue('Metro card')).toBeTruthy();
  });

  it('splits a bill with friends: own share is spending, the rest is owed', async () => {
    await start();
    await go('/transaction/new');
    await type('Amount', '900');
    await press('Food & dining');
    await press('Others owe me part of this');
    await typeIn('Name', 'Asha');
    await press('Add person');
    await typeIn('Name', 'Ben', 1);
    await press('Split equally');
    await screen.findByText('Your share: ₹300.00');
    await press('Save');
    await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());

    await go('/loans');
    await screen.findByText('Asha');
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getAllByText('₹600.00').length).toBeGreaterThan(0); // owed to you
    expect(await count("select count(*) as n from transactions where type = 'expense' and amount = 30000")).toBe(1);
  });

  it('warns about a likely duplicate and lists duplicates for clean-up', async () => {
    await start();
    await addTransaction({ amount: '250', category: 'Food & dining' });
    await go('/transaction/new');
    await type('Amount', '250');
    await press('Food & dining');
    await press('Save');
    await waitFor(() => expect(lastAlert()[0]).toBe('Possible duplicate'));
    await pressAlert('Save anyway');
    await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());
    expect(await count('select count(*) as n from transactions')).toBe(2);

    await go('/duplicates');
    await press('Keep one, delete the rest');
    await pressAlert('Delete');
    await screen.findByText('No duplicates found');
    expect(await count('select count(*) as n from transactions')).toBe(1);
  });
});

describe('long lists', () => {
  it('shows the entries behind a total a page at a time', async () => {
    const today = todayISO();
    await start();
    await db().withTransactionAsync(async () => {
      for (let i = 0; i < 120; i++) {
        await db().runAsync(
          `insert into transactions (id, type, amount, account_id, category_id, date, note, created_at, updated_at)
           values (?, 'expense', ?, 'acc_cash', 'cat_food', ?, ?, ?, ?)`,
          `bulk${i}`, 100 + i, today, `Meal ${i}`, today, today,
        );
      }
    });
    await go('/explore', { categoryId: 'cat_food', from: addDays(today, -1), to: today });
    expect(await screen.findAllByText(/Meal \d+/)).toHaveLength(50);
    await press('Show 50 more (70 left)');
    expect(await screen.findAllByText(/Meal \d+/)).toHaveLength(100);
    await press('Show 20 more (20 left)');
    expect(await screen.findAllByText(/Meal \d+/)).toHaveLength(120);
    expect(screen.queryByText(/^Show \d+ more/)).toBeNull();
  });
});

describe('bills', () => {
  it('waits for a bill to be marked paid, records the actual amount and reminds ahead', async () => {
    await start();
    await go('/transaction/new');
    await type('Amount', '1500');
    await press('Bills & utilities');
    await typeIn('Optional', 'Electricity');
    const picker = screen.getByTestId('date-picker');
    const [y, m, d] = addDays(todayISO(), -3).split('-').map(Number);
    await act(async () => picker.props.onChange({ type: 'set' }, new Date(y, m - 1, d)));
    await press('Monthly');
    await press('Remind me (bill)');
    await press('Save');
    await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());
    expect(await count('select count(*) as n from transactions')).toBe(0);

    await go('/');
    await screen.findByText('Upcoming bills');
    expect(screen.getByText('Overdue by 3 days')).toBeTruthy();

    // A reminder is scheduled for the next due date, the day before at 9 am.
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    await go('/recurring');
    await press('Electricity');
    await press('Mark as paid');
    await type('Amount paid', '1620');
    await press('Save payment');
    await screen.findByText('Payment history');
    expect(await count('select count(*) as n from transactions where amount = 162000')).toBe(1);
    await rescheduleBillReminders(db());
    const trigger = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.at(-1)?.[0].trigger;
    expect(trigger.date.getHours()).toBe(9);

    await press('Skip this one');
    await pressAlert('Skip');
    expect(await count('select generated_count as n from recurring')).toBe(2);
  });
});

describe('notifications', () => {
  it('opens the screen a tapped reminder points to', async () => {
    (Notifications.getLastNotificationResponse as jest.Mock).mockReturnValueOnce({
      notification: { request: { content: { data: { url: '/recurring' } } } },
    });
    await start();
    await screen.findByText('No recurring transactions');
  });
});

describe('wealth', () => {
  it('takes a loan, works out the EMI and records a repayment with interest', async () => {
    await start();
    await go('/loans/new');
    await typeIn('e.g. SBI home loan', 'Car loan');
    await type('Amount', '100000');
    await type('Interest % a year', '12');
    await type('Months', '12');
    await screen.findByText(/^Worked out EMI: ₹8,884\.88 for 12 months at 12%/);
    await press('Bank account');
    await press('Save');
    await screen.findByText('You still owe');
    expect(screen.getAllByText('₹100,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('Total interest over the loan')).toBeTruthy();

    await press('Record a repayment');
    await screen.findByText('Reduces the loan by ₹7,884.88');
    await press('Bank account');
    await press('Save');
    await screen.findByText('₹92,115.12');
    expect(await count("select count(*) as n from transactions where category_id = 'cat_loan_interest'")).toBe(1);
    const bank = await db().getFirstAsync<{ balance: number }>(
      `select coalesce(sum(case when to_account_id = 'acc_bank' then amount else -amount end), 0) as balance
       from transactions where account_id = 'acc_bank' or to_account_id = 'acc_bank'`,
    );
    expect(bank?.balance).toBe(10_000_000 - 888_488);
  });

  it('tracks a savings goal with money added and taken out', async () => {
    await start();
    await go('/goals/new');
    await typeIn('e.g. Emergency fund', 'Trip');
    await type('Target amount', '50000');
    await press('Save');
    await screen.findByText('of ₹50,000.00');
    await type('Amount', '5000');
    await press('Add to goal');
    await screen.findByText('₹5,000.00');
    await press('Take money out');
    await type('Amount', '1000');
    await press('Take out of goal');
    await screen.findByText('₹4,000.00');
    await screen.findByText('₹46,000.00 to go');
  });

  it('values an investment and shows it in net worth', async () => {
    await start();
    await go('/holding/[id]', { id: 'new', kind: 'investment' });
    await typeIn('e.g. Nifty 50 index fund', 'Index fund');
    await press('Mutual funds');
    await type('Amount invested', '40000');
    await type('Current value (leave empty if the same)', '46000');
    await press('Save');
    await screen.findAllByText('₹46,000.00');
    await type('New value', '50000');
    await press('Save value');
    await screen.findAllByText('₹50,000.00');

    await go('/networth');
    await screen.findByText('What you own');
    expect(screen.getAllByText('₹50,000.00').length).toBeGreaterThanOrEqual(2); // net worth + investments
  });
});

describe('reports, calendar and bulk actions', () => {
  it('reports by month and financial year and exports a PDF', async () => {
    await start();
    await addTransaction({ amount: '1000', type: 'Income', category: 'Salary' });
    await addTransaction({ amount: '250', category: 'Food & dining' });
    await go('/reports');
    await screen.findByText('Expenses by category');
    expect(screen.getByText('75%')).toBeTruthy(); // savings rate
    await press('Financial year');
    const fy = financialYearOf(todayISO(), 4); // INR: April to March
    await screen.findByText(`FY ${formatFinancialYear(fy, 4)}`);

    await press('Share PDF');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    const html = (Print.printToFileAsync as jest.Mock).mock.calls[0][0].html as string;
    expect(html).toContain('Food &amp; dining');
    expect(sharedFile(0).options.mimeType).toBe('application/pdf');
  });

  it('shows a calendar and deletes entries in bulk', async () => {
    await start();
    await addTransaction({ amount: '40', category: 'Food & dining', note: 'Tea' });
    await addTransaction({ amount: '60', category: 'Transport', note: 'Bus' });
    await go('/calendar');
    await screen.findByText('Spent this month: ₹100.00');
    expect(screen.getByText('Tea')).toBeTruthy(); // today is selected

    await go('/transactions');
    await press('Select');
    await tapLabel('Not selected');
    await tapLabel('Not selected');
    await screen.findByText('2 selected');
    await press('Category');
    await pressLast('Travel');
    await waitFor(() => expect(lastAlert()[0]).toBe('Done'));
    expect(await count("select count(*) as n from transactions where category_id = 'cat_travel'")).toBe(2);

    await press('Select');
    await press('Select all shown');
    await press('Delete');
    await pressAlert('Delete');
    await screen.findByText('Nothing here');
    expect(await count('select count(*) as n from transactions')).toBe(0);
  });

  it('acts only on selected entries that are still shown after a search', async () => {
    await start();
    await addTransaction({ amount: '40', category: 'Food & dining', note: 'Coffee' });
    await addTransaction({ amount: '45', category: 'Food & dining', note: 'Coffee' });
    await addTransaction({ amount: '900', category: 'Transport', note: 'Train pass' });
    await go('/transactions');
    await press('Select');
    await press('Select all shown');
    await screen.findByText('3 selected');

    await typeIn('Search notes, categories, tags, amounts', 'Coffee');
    await screen.findByText('2 selected');
    await press('Delete');
    expect(lastAlert()[0]).toBe('Delete 2 transactions?');
    await pressAlert('Delete');
    await screen.findByText('Nothing here');
    expect(await count('select count(*) as n from transactions')).toBe(1);
    expect(await count("select count(*) as n from transactions where note = 'Train pass'")).toBe(1);
  });
});

describe('data', () => {
  it('imports a bank statement CSV', async () => {
    await start();
    files().set(
      'file:///picked/statement.csv',
      'Txn Date,Narration,Withdrawal Amt.,Deposit Amt.\n03/11/2026,Swiggy,450.00,\n04/11/2026,Salary,,"52,000.00"\nbad,row,1,\n',
    );
    (File.pickFileAsync as unknown as jest.Mock).mockResolvedValueOnce({ canceled: false, result: new File('file:///picked/statement.csv') });
    await go('/import');
    await press('Choose CSV file');
    await screen.findByText('statement.csv · 3 rows');
    await press('Check the rows');
    await screen.findByText('Line 4: Date not recognised');
    await press('Import 2 transactions');
    await waitFor(() => expect(lastAlert()[0]).toBe('Imported'));
    expect(await count('select count(*) as n from transactions')).toBe(2);
    expect(await count("select count(*) as n from transactions where type = 'income' and amount = 5200000")).toBe(1);
  });

  it('makes a password-protected backup and restores it only with the password', async () => {
    await start();
    await addTransaction({ amount: '321', category: 'Health', note: 'Dentist' });
    await go('/backup');
    await press('Protect with a password');
    await type('Password', 'correct horse');
    await type('Password again', 'correct horse');
    await press('Create backup file');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled(), { timeout: 20_000 });
    const backup = sharedFile(0);
    expect(backup.uri).toContain('-encrypted.json');
    expect(String(backup.content)).not.toContain('Dentist');

    await addTransaction({ amount: '999', category: 'Shopping', note: 'later' });
    files().set('file:///picked/secret.json', backup.content as string);
    const pick = () =>
      (File.pickFileAsync as unknown as jest.Mock).mockResolvedValueOnce({ canceled: false, result: new File('file:///picked/secret.json') });
    pick();
    await go('/backup');
    await press('Choose backup file');
    await typeIn('Password', 'wrong password');
    await press('Open');
    await waitFor(() => expect(lastAlert()[0]).toBe('Wrong password'), { timeout: 20_000 });

    pick();
    await press('Choose backup file');
    await typeIn('Password', 'correct horse');
    await press('Open');
    await screen.findByText('secret.json', {}, { timeout: 20_000 });
    await press('Restore this backup');
    await pressAlert('Replace');
    await waitFor(() => expect(lastAlert()[0]).toBe('Restored'));
    const notes = await db().getAllAsync<{ note: string }>('select note from transactions');
    expect(notes.map((n) => n.note)).toEqual(['Dentist']);
  });

  it('exports an Excel workbook', async () => {
    await start();
    await addTransaction({ amount: '250', category: 'Food & dining', note: 'Lunch' });
    await go('/backup');
    await press('Share Excel file');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    const xlsx = sharedFile(0);
    expect(xlsx.uri).toMatch(/\.xlsx$/);
    const sheets = unzipSync(xlsx.content as Uint8Array);
    const transactions = strFromU8(sheets['xl/worksheets/sheet1.xml']);
    expect(transactions).toContain('Food &amp; dining');
    expect(transactions).toContain('<v>-250</v>');
    expect(strFromU8(sheets['xl/workbook.xml'])).toContain('Monthly summary');
  });
});

describe('accounts and categories', () => {
  it('reconciles an account and shows its statement', async () => {
    await start();
    await addTransaction({ amount: '100', category: 'Food & dining' });
    await go('/account/acc_cash');
    await press('Reconcile');
    await fireEvent.changeText(await screen.findByDisplayValue('-100'), '-150');
    await pressLast('Reconcile');
    await waitFor(() => expect(lastAlert()[0]).toBe('Reconciled'));
    expect(lastAlert()[1]).toBe('A balance adjustment of -₹50.00 was recorded so the account matches.');
    await screen.findByText(/^Last reconciled on/);

    await press('Statement');
    await screen.findByText(/^Closing balance on/);
    expect(screen.getAllByText('-₹150.00').length).toBeGreaterThan(0);
  });

  it('adds a subcategory and files an expense under it', async () => {
    await start();
    await go('/category/cat_food');
    await press('Add subcategory');
    await typeIn('e.g. Coffee', 'Coffee');
    await press('Save');
    await go('/categories');
    await screen.findByText('Coffee'); // listed, indented under Food & dining
    expect(await count("select count(*) as n from categories where parent_id = 'cat_food'")).toBe(1);

    await go('/transaction/new');
    await type('Amount', '80');
    await press('Food & dining');
    await screen.findByText('Subcategory of Food & dining');
    await press('Coffee');
    await press('Save');
    await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());
    await go('/');
    await screen.findAllByText('Food & dining'); // the home breakdown rolls Coffee up into Food & dining
    expect(await count("select count(*) as n from transactions t join categories c on c.id = t.category_id where c.name = 'Coffee'")).toBe(1);
  });
});

describe('budgets', () => {
  it('sets a weekly overall limit and turns on carry-forward', async () => {
    await start();
    await go('/budgets');
    await press('Weekly');
    await press('Set a weekly spending limit');
    await fireEvent.changeText(await screen.findByPlaceholderText('0'), '5000');
    await pressLast('Save');
    await screen.findByText('₹0.00 of ₹5,000.00');
    await press('All spending', 1);
    await press('Carry unspent money forward');
    await waitFor(() => expect(screen.getByLabelText('Carry unspent money forward').props.value).toBe(true));
    expect(await count('select carry_forward as n from budgets')).toBe(1);
    expect(await count("select count(*) as n from budgets where period = 'week' and category_id is null")).toBe(1);
  });

  it('shows how far over the limit a budget is without a minus sign', async () => {
    await start();
    await addTransaction({ amount: '700', category: 'Food & dining' });
    await go('/budgets');
    await press('Weekly');
    await press('Set a weekly spending limit');
    await fireEvent.changeText(await screen.findByPlaceholderText('0'), '500');
    await pressLast('Save');
    await screen.findByText('₹700.00 of ₹500.00');
    await press('All spending', 1);
    await screen.findByText('over budget');
    expect(screen.getByText('₹200.00')).toBeTruthy();
    expect(screen.queryByText(/^-₹200/)).toBeNull();
  });
});

describe('preferences', () => {
  it('switches to Hindi', async () => {
    await start();
    await go('/language');
    await press('हिन्दी');
    await go('/');
    await screen.findByText('कुल बैलेंस');
    expect(screen.getByText('अधिक')).toBeTruthy(); // "More" tab
  });

  it('changes date format and hides a home card', async () => {
    await start();
    await go('/formats');
    await press('DD/MM/YYYY');
    await screen.findByText('Example: 21/11/2026');

    await addTransaction({ amount: '10', category: 'Food & dining' });
    await go('/');
    await screen.findByText('Accounts');
    await go('/home-layout');
    await fireEvent(await screen.findByLabelText('Accounts'), 'valueChange', false);
    await go('/');
    await screen.findByText('Total balance');
    expect(screen.queryByText('Accounts')).toBeNull();
    expect(currentMonthKey()).toBeTruthy();
  });

  it('locks the app with a PIN and pauses after wrong attempts', async () => {
    await start();
    await go('/security');
    await press('App PIN');
    await screen.findByText('Choose a PIN (4 to 6 digits)');
    for (const digit of '1357') await tapLabel(digit);
    await press('Continue');
    await screen.findByText('Enter the new PIN again');
    for (const digit of '1357') await tapLabel(digit);
    await waitFor(() => expect(lastAlert()[0]).toBe('PIN saved'));
    expect(getLockMethod()).toBe('pin');

    // Next start: locked until the PIN is entered.
    await start();
    await screen.findByText('Enter your PIN');
    for (const digit of '0000') await tapLabel(digit);
    await screen.findByText('Wrong PIN. 4 attempts left before a pause.');
    for (const digit of '1357') await tapLabel(digit);
    await waitFor(() => expect(screen.queryByText('Enter your PIN')).toBeNull());
  });
});
