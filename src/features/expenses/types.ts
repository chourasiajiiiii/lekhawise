import type { IconName } from '@/core/ui';
import type { Frequency, ISODate } from '@/core/utils/date';

export type TxType = 'expense' | 'income' | 'transfer';
export type CategoryType = 'expense' | 'income';
/** 'loan' accounts are created from the Loans & debts screen and hold one loan each. */
export type AccountType = 'cash' | 'bank' | 'card' | 'wallet' | 'other' | 'loan';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  icon: IconName;
  color: string;
  opening_balance: number; // minor units
  archived: 0 | 1;
  sort_order: number;
  created_at: string;
  reconciled_date: ISODate | null;
  reconciled_balance: number | null;
}

export interface AccountWithBalance extends Account {
  balance: number;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  icon: IconName;
  color: string;
  archived: 0 | 1;
  sort_order: number;
  /** Set for subcategories. Only one level: a subcategory has no children. */
  parent_id: string | null;
}

export interface Transaction {
  id: string;
  type: TxType;
  amount: number; // minor units, always positive; `type` gives the direction
  category_id: string | null; // null for transfers and split transactions
  account_id: string; // source account (or destination for income)
  to_account_id: string | null; // only for transfers
  date: ISODate;
  note: string;
  recurring_id: string | null;
  /** Set on interest entries recorded together with a loan payment. */
  loan_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionView extends Transaction {
  category_name: string | null;
  category_icon: IconName | null;
  category_color: string | null;
  account_name: string;
  to_account_name: string | null;
  split_count: number;
  attachment_count: number;
  tag_names: string | null; // comma separated
}

export interface Split {
  id?: string;
  category_id: string;
  amount: number;
  note: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Attachment {
  id: string;
  transaction_id: string;
  file_name: string;
  mime: string;
  size: number;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  type: TxType;
  amount: number | null;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  note: string;
  sort_order: number;
  created_at: string;
}

export type RecurringMode = 'auto' | 'remind';

export interface RecurringRule {
  id: string;
  type: TxType;
  amount: number;
  category_id: string | null;
  account_id: string;
  to_account_id: string | null;
  note: string;
  frequency: Frequency;
  start_date: ISODate;
  end_date: ISODate | null;
  /** How many occurrences have been created; the next one is addPeriods(start_date, frequency, generated_count). */
  generated_count: number;
  next_date: ISODate;
  active: 0 | 1;
  created_at: string;
  /** 'auto' adds entries on their date; 'remind' waits until the user marks the bill as paid. */
  mode: RecurringMode;
  /** Days before the due date to send a reminder; null for none. */
  remind_days: number | null;
}

export type BudgetPeriod = 'month' | 'week';

export interface Budget {
  id: string;
  /** null for an overall budget covering all spending. */
  category_id: string | null;
  period: BudgetPeriod;
  carry_forward: 0 | 1;
  created_at: string;
}

/** A budget's amount from a period onwards; the latest one at or before a period applies. */
export interface BudgetLimit {
  budget_id: string;
  start: string; // MonthKey for monthly budgets, ISODate (week start) for weekly ones
  amount: number;
}

export type LoanDirection = 'borrowed' | 'lent';

export interface Loan {
  account_id: string;
  direction: LoanDirection;
  principal: number;
  /** Yearly interest in hundredths of a percent: 850 = 8.50%. */
  annual_rate: number;
  tenure_months: number | null;
  emi: number | null;
  start_date: ISODate;
  note: string;
}

export interface Goal {
  id: string;
  name: string;
  icon: IconName;
  color: string;
  target: number;
  target_date: ISODate | null;
  /** When set, progress is that account's balance instead of manual contributions. */
  account_id: string | null;
  archived: 0 | 1;
  sort_order: number;
  created_at: string;
}

export interface GoalContribution {
  id: string;
  goal_id: string;
  date: ISODate;
  amount: number; // negative for a withdrawal
  note: string;
  created_at: string;
}

export type HoldingKind = 'investment' | 'asset';

export interface Holding {
  id: string;
  kind: HoldingKind;
  subtype: string;
  name: string;
  invested: number;
  quantity: string;
  note: string;
  purchase_date: ISODate | null;
  archived: 0 | 1;
  created_at: string;
}

export interface HoldingValue {
  id: string;
  holding_id: string;
  date: ISODate;
  value: number;
  created_at: string;
}

export const ACCOUNT_TYPES: { value: Exclude<AccountType, 'loan'>; label: string; icon: IconName }[] = [
  { value: 'cash', label: 'Cash', icon: 'cash-outline' },
  { value: 'bank', label: 'Bank', icon: 'business-outline' },
  { value: 'card', label: 'Credit card', icon: 'card-outline' },
  { value: 'wallet', label: 'Wallet', icon: 'wallet-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const INVESTMENT_TYPES: { value: string; label: string; icon: IconName }[] = [
  { value: 'stock', label: 'Stocks', icon: 'stats-chart-outline' },
  { value: 'mutual_fund', label: 'Mutual funds', icon: 'pie-chart-outline' },
  { value: 'gold', label: 'Gold', icon: 'diamond-outline' },
  { value: 'fixed_deposit', label: 'Fixed deposit', icon: 'lock-closed-outline' },
  { value: 'retirement', label: 'Provident & pension funds', icon: 'umbrella-outline' },
  { value: 'bond', label: 'Bonds', icon: 'document-text-outline' },
  { value: 'crypto', label: 'Crypto', icon: 'logo-bitcoin' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

export const ASSET_TYPES: { value: string; label: string; icon: IconName }[] = [
  { value: 'property', label: 'Property', icon: 'home-outline' },
  { value: 'vehicle', label: 'Vehicle', icon: 'car-outline' },
  { value: 'jewellery', label: 'Jewellery', icon: 'diamond-outline' },
  { value: 'electronics', label: 'Electronics', icon: 'laptop-outline' },
  { value: 'other', label: 'Other', icon: 'cube-outline' },
];
