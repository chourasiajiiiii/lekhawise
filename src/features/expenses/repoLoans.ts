import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyDataChanged } from '@/core/db/events';
import type { IconName } from '@/core/ui';
import { type ISODate, todayISO } from '@/core/utils/date';
import { newId } from '@/core/utils/id';

import { INTEREST_INCOME_CATEGORY_ID, LOAN_INTEREST_CATEGORY_ID } from './defaults';
import type { Loan, LoanDirection } from './types';
import { listTransactions, type TransactionInput, validateTransaction } from './repo';

/**
 * Loans and debts. Each loan is an account of type 'loan', so money borrowed or lent moves through
 * ordinary transfers and account balances stay correct:
 *
 *   borrowed: loan account balance is negative (what you owe);  lent: positive (what you are owed).
 *   taking a loan   = transfer loan -> bank;   repaying = transfer bank -> loan (+ interest expense)
 *   lending money   = transfer bank -> loan;   being repaid = transfer loan -> bank (+ interest income)
 */

export type LoanView = Loan & {
  name: string;
  icon: IconName;
  color: string;
  archived: 0 | 1;
  /** Positive amount still owed (by you for borrowed, to you for lent). */
  outstanding: number;
  interest_paid: number;
  payments: number;
  last_payment: ISODate | null;
};

const LOAN_SELECT = `
  select l.*, a.name, a.icon, a.color, a.archived,
    a.opening_balance
      + coalesce((select sum(case when t.type = 'income' then t.amount else -t.amount end)
                  from transactions t where t.account_id = a.id), 0)
      + coalesce((select sum(t.amount) from transactions t where t.type = 'transfer' and t.to_account_id = a.id), 0)
      as balance,
    coalesce((select sum(t.amount) from transactions t where t.loan_id = a.id), 0) as interest_paid,
    (select count(*) from transactions t
       where (l.direction = 'borrowed' and t.type = 'transfer' and t.to_account_id = a.id)
          or (l.direction = 'lent' and t.type = 'transfer' and t.account_id = a.id)) as payments,
    (select max(t.date) from transactions t
       where (l.direction = 'borrowed' and t.type = 'transfer' and t.to_account_id = a.id)
          or (l.direction = 'lent' and t.type = 'transfer' and t.account_id = a.id)) as last_payment
  from loans l join accounts a on a.id = l.account_id`;

function toView(row: LoanView & { balance: number }): LoanView {
  const { balance, ...rest } = row;
  return { ...rest, outstanding: row.direction === 'borrowed' ? -balance : balance };
}

export async function listLoans(db: SQLiteDatabase, includeClosed = false): Promise<LoanView[]> {
  const rows = await db.getAllAsync<LoanView & { balance: number }>(
    `${LOAN_SELECT} where ? = 1 or a.archived = 0 order by a.archived, l.direction, a.name collate nocase`,
    includeClosed ? 1 : 0,
  );
  return rows.map(toView);
}

export async function getLoan(db: SQLiteDatabase, accountId: string): Promise<LoanView | null> {
  const row = await db.getFirstAsync<LoanView & { balance: number }>(`${LOAN_SELECT} where l.account_id = ?`, accountId);
  return row ? toView(row) : null;
}

export type LoanInput = {
  direction: LoanDirection;
  name: string;
  principal: number;
  annual_rate: number;
  tenure_months: number | null;
  emi: number | null;
  start_date: ISODate;
  note: string;
  /**
   * 'new': the money moves now, into or out of `account_id`.
   * 'existing': a loan taken earlier; `outstanding` is what is still owed and no account changes.
   */
  source: { kind: 'new'; account_id: string } | { kind: 'existing'; outstanding: number };
};

const LOAN_ICON: Record<LoanDirection, { icon: IconName; color: string }> = {
  borrowed: { icon: 'arrow-down-circle-outline', color: '#DC2626' },
  lent: { icon: 'arrow-up-circle-outline', color: '#16A34A' },
};

export function validateLoan(input: LoanInput): string | null {
  if (!input.name.trim()) return 'Enter a name for the loan or the person.';
  if (!Number.isSafeInteger(input.principal) || input.principal <= 0) return 'Enter the loan amount.';
  if (input.source.kind === 'new' && !input.source.account_id) return 'Choose the account the money moved through.';
  if (input.source.kind === 'existing' && (input.source.outstanding < 0 || input.source.outstanding > input.principal * 10)) {
    return 'Enter how much is still outstanding.';
  }
  return null;
}

export async function createLoan(db: SQLiteDatabase, input: LoanInput): Promise<string> {
  const error = validateLoan(input);
  if (error) throw new Error(error);
  const id = newId();
  const now = new Date().toISOString();
  const sign = input.direction === 'borrowed' ? -1 : 1;
  const opening = input.source.kind === 'existing' ? sign * input.source.outstanding : 0;
  const look = LOAN_ICON[input.direction];
  await db.withTransactionAsync(async () => {
    const max = await db.getFirstAsync<{ m: number | null }>('select max(sort_order) as m from accounts');
    await db.runAsync(
      `insert into accounts (id, name, type, icon, color, opening_balance, sort_order, created_at)
       values (?, ?, 'loan', ?, ?, ?, ?, ?)`,
      id, input.name.trim(), look.icon, look.color, opening, (max?.m ?? 0) + 1, now,
    );
    await db.runAsync(
      `insert into loans (account_id, direction, principal, annual_rate, tenure_months, emi, start_date, note)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.direction, input.principal, input.annual_rate, input.tenure_months, input.emi, input.start_date,
      input.note.trim(),
    );
    if (input.source.kind === 'new') {
      const from = input.direction === 'borrowed' ? id : input.source.account_id;
      const to = input.direction === 'borrowed' ? input.source.account_id : id;
      await insertTransfer(db, from, to, input.principal, input.start_date, input.name.trim(), now);
    }
  });
  notifyDataChanged();
  return id;
}

async function insertTransfer(
  db: SQLiteDatabase,
  from: string,
  to: string,
  amount: number,
  date: ISODate,
  note: string,
  now: string,
): Promise<void> {
  await db.runAsync(
    `insert into transactions (id, type, amount, account_id, to_account_id, date, note, created_at, updated_at)
     values (?, 'transfer', ?, ?, ?, ?, ?, ?, ?)`,
    newId(), amount, from, to, date, note, now, now,
  );
}

export type LoanDetailsInput = Pick<LoanInput, 'name' | 'principal' | 'annual_rate' | 'tenure_months' | 'emi' | 'start_date' | 'note'>;

export async function updateLoanDetails(db: SQLiteDatabase, accountId: string, input: LoanDetailsInput): Promise<void> {
  if (!input.name.trim()) throw new Error('Enter a name for the loan or the person.');
  await db.withTransactionAsync(async () => {
    await db.runAsync('update accounts set name = ? where id = ?', input.name.trim(), accountId);
    await db.runAsync(
      `update loans set principal = ?, annual_rate = ?, tenure_months = ?, emi = ?, start_date = ?, note = ?
       where account_id = ?`,
      input.principal, input.annual_rate, input.tenure_months, input.emi, input.start_date, input.note.trim(), accountId,
    );
  });
  notifyDataChanged();
}

export type LoanPaymentInput = {
  /** Total paid or received, interest included. */
  amount: number;
  interest: number;
  date: ISODate;
  account_id: string;
  note?: string;
};

/**
 * Records a repayment. For a loan you took: money leaves `account_id`; the principal part reduces
 * the loan and the interest part is an expense ("Loan interest"). For money you lent: money arrives,
 * the principal part reduces what you are owed and the interest is income.
 */
export async function recordLoanPayment(db: SQLiteDatabase, loanId: string, input: LoanPaymentInput): Promise<void> {
  const loan = await getLoan(db, loanId);
  if (!loan) throw new Error('This loan no longer exists.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Enter the amount paid.');
  if (input.interest < 0 || input.interest > input.amount) throw new Error('Interest cannot be more than the payment.');
  if (!input.account_id) throw new Error('Choose an account.');
  const principal = input.amount - input.interest;
  const now = new Date().toISOString();
  const note = input.note?.trim() || loan.name;
  await db.withTransactionAsync(async () => {
    if (principal > 0) {
      const [from, to] = loan.direction === 'borrowed' ? [input.account_id, loanId] : [loanId, input.account_id];
      await insertTransfer(db, from, to, principal, input.date, note, now);
    }
    if (input.interest > 0) {
      await db.runAsync(
        `insert into transactions (id, type, amount, category_id, account_id, date, note, loan_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), loan.direction === 'borrowed' ? 'expense' : 'income', input.interest,
        loan.direction === 'borrowed' ? LOAN_INTEREST_CATEGORY_ID : INTEREST_INCOME_CATEGORY_ID,
        input.account_id, input.date, `${note} · interest`, loanId, now, now,
      );
    }
  });
  notifyDataChanged();
}

/** Borrowing more on the same loan, or lending the same person more. */
export async function increaseLoan(
  db: SQLiteDatabase,
  loanId: string,
  input: { amount: number; date: ISODate; account_id: string; note?: string },
): Promise<void> {
  const loan = await getLoan(db, loanId);
  if (!loan) throw new Error('This loan no longer exists.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Enter an amount.');
  const [from, to] = loan.direction === 'borrowed' ? [loanId, input.account_id] : [input.account_id, loanId];
  await insertTransfer(db, from, to, input.amount, input.date, input.note?.trim() || loan.name, new Date().toISOString());
  notifyDataChanged();
}

/** Every entry that touched the loan (disbursements, repayments, interest), newest first. */
export function loanHistory(db: SQLiteDatabase, loanId: string) {
  return listTransactions(db, { loanId });
}

/** Closes a settled loan (kept for history) or deletes it if nothing was ever recorded against it. */
export async function closeLoan(db: SQLiteDatabase, loanId: string): Promise<'closed' | 'deleted'> {
  const used = await db.getFirstAsync<{ n: number }>(
    'select count(*) as n from transactions where account_id = ?1 or to_account_id = ?1 or loan_id = ?1',
    loanId,
  );
  if ((used?.n ?? 0) > 0) {
    await db.runAsync('update accounts set archived = 1 where id = ?', loanId);
    notifyDataChanged();
    return 'closed';
  }
  await db.runAsync('delete from accounts where id = ?', loanId); // the loans row cascades
  notifyDataChanged();
  return 'deleted';
}

export async function reopenLoan(db: SQLiteDatabase, loanId: string): Promise<void> {
  await db.runAsync('update accounts set archived = 0 where id = ?', loanId);
  notifyDataChanged();
}

// ---------------------------------------------------------------- splitting a bill with others

export type Share = { person: string; amount: number };

/** The open "money lent" record for a person, created if they do not have one yet. */
async function lentAccountFor(db: SQLiteDatabase, person: string, date: ISODate, now: string): Promise<string> {
  const existing = await db.getFirstAsync<{ id: string }>(
    `select a.id from accounts a join loans l on l.account_id = a.id
     where l.direction = 'lent' and a.archived = 0 and a.name = ? collate nocase`,
    person,
  );
  if (existing) return existing.id;
  const id = newId();
  const max = await db.getFirstAsync<{ m: number | null }>('select max(sort_order) as m from accounts');
  const look = LOAN_ICON.lent;
  await db.runAsync(
    `insert into accounts (id, name, type, icon, color, opening_balance, sort_order, created_at)
     values (?, ?, 'loan', ?, ?, 0, ?, ?)`,
    id, person, look.icon, look.color, (max?.m ?? 0) + 1, now,
  );
  await db.runAsync(
    `insert into loans (account_id, direction, principal, annual_rate, start_date, note) values (?, 'lent', 0, 0, ?, '')`,
    id, date,
  );
  return id;
}

export function validateShares(total: number, shares: Share[]): string | null {
  if (shares.some((s) => !s.person.trim())) return 'Enter a name for everyone in the split.';
  if (shares.some((s) => !Number.isSafeInteger(s.amount) || s.amount <= 0)) return "Enter each person's share.";
  const names = shares.map((s) => s.person.trim().toLowerCase());
  if (new Set(names).size !== names.length) return 'Each person can appear only once.';
  const others = shares.reduce((sum, s) => sum + s.amount, 0);
  if (others >= total) return "Other people's shares must be less than the total.";
  return null;
}

/**
 * You paid the whole bill (`input.amount`) and others owe you their shares. Records your share as
 * the expense and each other share as money lent to that person, which shows under Loans & debts
 * until they pay you back. Returns the id of your expense.
 */
export async function saveSharedExpense(db: SQLiteDatabase, input: TransactionInput, shares: Share[]): Promise<string> {
  const others = shares.reduce((sum, s) => sum + s.amount, 0);
  const mine: TransactionInput = { ...input, amount: input.amount - others, splits: [] };
  const shareError = validateShares(input.amount, shares);
  if (shareError) throw new Error(shareError);
  const error = validateTransaction(mine);
  if (error) throw new Error(error);
  const id = newId();
  const now = new Date().toISOString();
  const note = input.note.trim();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `insert into transactions (id, type, amount, category_id, account_id, date, note, created_at, updated_at)
       values (?, 'expense', ?, ?, ?, ?, ?, ?, ?)`,
      id, mine.amount, mine.category_id, mine.account_id, mine.date, note, now, now,
    );
    for (const tagId of new Set(input.tagIds ?? [])) {
      await db.runAsync('insert into transaction_tags (transaction_id, tag_id) values (?, ?)', id, tagId);
    }
    for (const share of shares) {
      const person = share.person.trim();
      const lent = await lentAccountFor(db, person, input.date, now);
      await insertTransfer(db, mine.account_id, lent, share.amount, input.date, note ? `${note} · ${person}` : person, now);
    }
  });
  notifyDataChanged();
  return id;
}

export function defaultLoanStart(): ISODate {
  return todayISO();
}
