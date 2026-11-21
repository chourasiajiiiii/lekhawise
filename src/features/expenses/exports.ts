import * as Print from 'expo-print';
import type { SQLiteDatabase } from 'expo-sqlite';

import { saveFileToFolder, shareFile } from '@/core/files/files';
import { type CsvCell, toCsv } from '@/core/utils/csv';
import { type ISODate, todayISO } from '@/core/utils/date';
import { formatMoney, toMajor } from '@/core/utils/money';
import { buildXlsx, type XlsxCell } from '@/core/utils/xlsx';

import { deliver, type ExportDestination } from './backup';
import { accountStatement, categoryTotals, getAccount, listAccounts, listTransactions, periodSummary } from './repo';
import { listLoans } from './repoLoans';
import { reportHtml, statementHtml } from './reportHtml';
import { getCurrency } from './settings';
import type { TransactionView } from './types';

async function splitNames(db: SQLiteDatabase): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ transaction_id: string; names: string }>(
    `select s.transaction_id, group_concat(c.name || ' ' || (s.amount), '; ') as names
     from transaction_splits s join categories c on c.id = s.category_id group by s.transaction_id`,
  );
  return new Map(rows.map((r) => [r.transaction_id, r.names]));
}

function categoryLabel(t: TransactionView, splits: Map<string, string>, currency: string): string {
  if (t.split_count > 0) {
    // "Food 1250; Groceries 800" in minor units -> readable amounts
    return (splits.get(t.id) ?? '')
      .split('; ')
      .map((part) => {
        const at = part.lastIndexOf(' ');
        return `${part.slice(0, at)} ${toMajor(Number(part.slice(at + 1)), currency)}`;
      })
      .join('; ');
  }
  return t.category_name ?? '';
}

/** All transactions as a spreadsheet-friendly CSV. Expenses are negative. */
export async function exportCsv(db: SQLiteDatabase, destination: ExportDestination = 'share'): Promise<boolean> {
  const currency = getCurrency();
  const [transactions, splits] = await Promise.all([listTransactions(db), splitNames(db)]);
  const rows: CsvCell[][] = [['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'To account', 'Note', 'Tags']];
  for (const t of [...transactions].reverse()) {
    const signed = t.type === 'expense' ? -t.amount : t.amount;
    rows.push([
      t.date,
      t.type,
      toMajor(signed, currency),
      currency,
      categoryLabel(t, splits, currency),
      t.account_name,
      t.to_account_name ?? '',
      t.note,
      t.tag_names ?? '',
    ]);
  }
  return deliver(
    destination,
    `lekhawise-transactions-${todayISO()}.csv`,
    toCsv(rows),
    'text/csv',
    'public.comma-separated-values-text',
  );
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** An Excel workbook: transactions, monthly summary, category totals and account balances. */
export async function exportXlsx(db: SQLiteDatabase, destination: ExportDestination = 'share'): Promise<boolean> {
  const currency = getCurrency();
  const major = (minor: number) => toMajor(minor, currency);
  const [transactions, splits, accounts, loans] = await Promise.all([
    listTransactions(db),
    splitNames(db),
    listAccounts(db, { includeArchived: true }),
    listLoans(db, true),
  ]);
  const ordered = [...transactions].reverse();

  const months = new Map<string, { income: number; expense: number }>();
  for (const t of ordered) {
    const month = t.date.slice(0, 7);
    const m = months.get(month) ?? { income: 0, expense: 0 };
    if (t.type === 'income') m.income += t.amount;
    if (t.type === 'expense') m.expense += t.amount;
    months.set(month, m);
  }
  const categories = await db.getAllAsync<{ name: string; type: string; total: number; count: number }>(
    `select c.name, l.type, sum(l.amount) as total, count(*) as count
     from tx_lines l join categories c on c.id = l.category_id
     where l.type in ('expense', 'income') group by c.id order by l.type, total desc`,
  );

  const bytes = buildXlsx([
    {
      name: 'Transactions',
      columns: [
        { header: 'Date', type: 'date', width: 12 },
        { header: 'Type', type: 'text', width: 10 },
        { header: `Amount (${currency})`, type: 'money', width: 14 },
        { header: 'Category', type: 'text', width: 22 },
        { header: 'Account', type: 'text', width: 18 },
        { header: 'To account', type: 'text', width: 18 },
        { header: 'Note', type: 'text', width: 30 },
        { header: 'Tags', type: 'text', width: 18 },
      ],
      rows: ordered.map((t): XlsxCell[] => [
        t.date,
        t.type,
        major(t.type === 'expense' ? -t.amount : t.amount),
        categoryLabel(t, splits, currency),
        t.account_name,
        t.to_account_name ?? '',
        t.note,
        t.tag_names ?? '',
      ]),
    },
    {
      name: 'Monthly summary',
      columns: [
        { header: 'Month', type: 'text', width: 10 },
        { header: 'Income', type: 'money', width: 14 },
        { header: 'Expenses', type: 'money', width: 14 },
        { header: 'Saved', type: 'money', width: 14 },
        { header: 'Savings rate %', type: 'number', width: 14 },
      ],
      rows: [...months.entries()].map(([month, m]) => [
        month,
        major(m.income),
        major(m.expense),
        major(m.income - m.expense),
        m.income > 0 ? Math.round(((m.income - m.expense) / m.income) * 100) : null,
      ]),
    },
    {
      name: 'Categories',
      columns: [
        { header: 'Category', type: 'text', width: 22 },
        { header: 'Type', type: 'text', width: 10 },
        { header: 'Total', type: 'money', width: 14 },
        { header: 'Entries', type: 'number', width: 10 },
      ],
      rows: categories.map((c) => [c.name, c.type, major(c.total), c.count]),
    },
    {
      name: 'Accounts',
      columns: [
        { header: 'Account', type: 'text', width: 22 },
        { header: 'Type', type: 'text', width: 12 },
        { header: 'Balance', type: 'money', width: 14 },
        { header: 'Archived', type: 'text', width: 10 },
      ],
      rows: [
        ...accounts.map((a) => [a.name, a.type, major(a.balance), a.archived ? 'yes' : '']),
        ...loans.map((l) => [l.name, l.direction === 'borrowed' ? 'loan taken' : 'money lent', major(l.direction === 'borrowed' ? -l.outstanding : l.outstanding), l.archived ? 'yes' : '']),
      ],
    },
  ]);
  return deliver(destination, `lekhawise-${todayISO()}.xlsx`, bytes, XLSX_MIME, 'org.openxmlformats.spreadsheetml.sheet');
}

/**
 * The print module returns the PDF as base64, which is written straight to its destination. Reading the
 * print module's own temporary file is not allowed inside Expo Go, and this way works everywhere.
 */
async function deliverPdf(html: string, fileName: string, destination: ExportDestination): Promise<boolean> {
  const { base64 } = await Print.printToFileAsync({ html, base64: true });
  if (!base64) throw new Error('The PDF could not be created.');
  if (destination === 'phone') return saveFileToFolder(fileName, base64, 'application/pdf', 'base64');
  await shareFile(fileName, base64, { mimeType: 'application/pdf', uti: 'com.adobe.pdf', encoding: 'base64' });
  return true;
}

/** A PDF report for a period: totals, categories and every transaction. */
export async function exportPdfReport(
  db: SQLiteDatabase,
  period: { from: ISODate; to: ISODate; title: string },
  destination: ExportDestination = 'share',
): Promise<boolean> {
  const currency = getCurrency();
  const [summary, expenseCategories, incomeCategories, transactions] = await Promise.all([
    periodSummary(db, period.from, period.to),
    categoryTotals(db, period.from, period.to, 'expense'),
    categoryTotals(db, period.from, period.to, 'income'),
    listTransactions(db, { from: period.from, to: period.to }),
  ]);
  const html = reportHtml(
    { title: period.title, from: period.from, to: period.to, ...summary, expenseCategories, incomeCategories, transactions },
    (minor) => formatMoney(minor, currency),
  );
  return deliverPdf(html, `lekhawise-report-${period.from}-to-${period.to}.pdf`, destination);
}

/** A PDF account statement with a running balance. */
export async function exportStatementPdf(
  db: SQLiteDatabase,
  accountId: string,
  from: ISODate,
  to: ISODate,
  destination: ExportDestination = 'share',
): Promise<boolean> {
  const currency = getCurrency();
  const [account, statement] = await Promise.all([getAccount(db, accountId), accountStatement(db, accountId, from, to)]);
  if (!account) return false;
  const html = statementHtml(account.name, from, to, statement, (minor) => formatMoney(minor, currency));
  const safeName = account.name.replace(/[^\w-]+/g, '-').slice(0, 30) || 'account';
  return deliverPdf(html, `statement-${safeName}-${from}-to-${to}.pdf`, destination);
}
