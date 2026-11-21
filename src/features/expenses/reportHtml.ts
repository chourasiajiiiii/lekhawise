import { t } from '@/core/i18n/locale';
import { formatDate, type ISODate } from '@/core/utils/date';

import type { CategoryTotal, StatementLine } from './repo';
import type { TransactionView } from './types';

/**
 * HTML for PDF reports (turned into a PDF by the phone's own print engine).
 * Pure functions: given numbers and a money formatter, they return a complete HTML page.
 */

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Segoe UI", "Noto Sans", "Noto Sans Devanagari", sans-serif; color: #0F172A; margin: 28px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .05em; color: #475569; }
  .muted { color: #64748B; }
  .cards { display: flex; gap: 10px; margin-top: 14px; }
  .card { flex: 1; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 12px; }
  .card .label { color: #64748B; font-size: 11px; }
  .card .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: #64748B; border-bottom: 1px solid #CBD5E1; padding: 6px 4px; }
  td { border-bottom: 1px solid #F1F5F9; padding: 5px 4px; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .bar { height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden; }
  .bar > div { height: 6px; }
  .in { color: #15803D; } .out { color: #B91C1C; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 24px; color: #94A3B8; font-size: 10px; }
`;

function page(title: string, subtitle: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body>
<h1>${esc(title)}</h1><div class="muted">${esc(subtitle)}</div>
${body}
<footer>${esc(t('Created with LekhaWise on {date}', { date: formatDate(new Date().toISOString().slice(0, 10)) }))}</footer>
</body></html>`;
}

export type ReportData = {
  title: string;
  from: ISODate;
  to: ISODate;
  income: number;
  expense: number;
  expenseCategories: CategoryTotal[];
  incomeCategories: CategoryTotal[];
  transactions: TransactionView[];
};

export function reportHtml(data: ReportData, money: (minor: number) => string): string {
  const savings = data.income - data.expense;
  const rate = data.income > 0 ? Math.round((savings / data.income) * 100) : null;
  const categoryTable = (rows: CategoryTotal[], total: number) =>
    rows.length
      ? `<table><tr><th>${esc(t('Category'))}</th><th style="width:40%"></th><th class="num">${esc(t('Amount'))}</th><th class="num">%</th></tr>
${rows
  .map((c) => {
    const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
    return `<tr><td>${esc(c.name)}</td><td><div class="bar"><div style="width:${pct}%;background:${esc(c.color)}"></div></div></td>
<td class="num">${esc(money(c.total))}</td><td class="num">${pct}%</td></tr>`;
  })
  .join('')}</table>`
      : `<div class="muted">${esc(t('Nothing in this period.'))}</div>`;

  const txRows = data.transactions
    .map((tx) => {
      const category = tx.type === 'transfer'
        ? `${tx.account_name} → ${tx.to_account_name ?? ''}`
        : tx.split_count > 0 ? t('Split') : (tx.category_name ?? '');
      const sign = tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : '';
      const cls = tx.type === 'expense' ? 'out' : tx.type === 'income' ? 'in' : '';
      return `<tr><td>${esc(formatDate(tx.date))}</td><td>${esc(category)}</td><td>${esc(tx.type === 'transfer' ? '' : tx.account_name)}</td>
<td>${esc(tx.note)}</td><td class="num ${cls}">${sign}${esc(money(tx.amount))}</td></tr>`;
    })
    .join('');

  const body = `
<div class="cards">
  <div class="card"><div class="label">${esc(t('Income'))}</div><div class="value in">${esc(money(data.income))}</div></div>
  <div class="card"><div class="label">${esc(t('Expenses'))}</div><div class="value out">${esc(money(data.expense))}</div></div>
  <div class="card"><div class="label">${esc(t('Amount saved'))}</div><div class="value">${esc(money(savings))}</div>
    ${rate !== null ? `<div class="label">${esc(t('{rate}% of income', { rate }))}</div>` : ''}</div>
</div>
<h2>${esc(t('Expenses by category'))}</h2>${categoryTable(data.expenseCategories, data.expense)}
<h2>${esc(t('Income by category'))}</h2>${categoryTable(data.incomeCategories, data.income)}
<h2>${esc(t('Transactions'))} (${data.transactions.length})</h2>
<table><tr><th>${esc(t('Date'))}</th><th>${esc(t('Category'))}</th><th>${esc(t('Account'))}</th><th>${esc(t('Note'))}</th><th class="num">${esc(t('Amount'))}</th></tr>${txRows}</table>`;

  return page(data.title, `${formatDate(data.from)} – ${formatDate(data.to)}`, body);
}

export function statementHtml(
  account: string,
  from: ISODate,
  to: ISODate,
  statement: { opening: number; closing: number; moneyIn: number; moneyOut: number; lines: StatementLine[] },
  money: (minor: number) => string,
): string {
  const rows = statement.lines
    .map((l) => {
      const what = l.type === 'transfer'
        ? (l.change > 0 ? t('From {name}', { name: l.account_name }) : t('To {name}', { name: l.to_account_name ?? '' }))
        : (l.category_name ?? (l.split_count ? t('Split') : ''));
      return `<tr><td>${esc(formatDate(l.date))}</td><td>${esc(what)}</td><td>${esc(l.note)}</td>
<td class="num out">${l.change < 0 ? esc(money(-l.change)) : ''}</td><td class="num in">${l.change > 0 ? esc(money(l.change)) : ''}</td>
<td class="num">${esc(money(l.running))}</td></tr>`;
    })
    .join('');
  const body = `
<div class="cards">
  <div class="card"><div class="label">${esc(t('Opening balance'))}</div><div class="value">${esc(money(statement.opening))}</div></div>
  <div class="card"><div class="label">${esc(t('Money in'))}</div><div class="value in">${esc(money(statement.moneyIn))}</div></div>
  <div class="card"><div class="label">${esc(t('Money out'))}</div><div class="value out">${esc(money(statement.moneyOut))}</div></div>
  <div class="card"><div class="label">${esc(t('Closing balance'))}</div><div class="value">${esc(money(statement.closing))}</div></div>
</div>
<h2>${esc(t('Entries'))} (${statement.lines.length})</h2>
<table><tr><th>${esc(t('Date'))}</th><th>${esc(t('Details'))}</th><th>${esc(t('Note'))}</th><th class="num">${esc(t('Out'))}</th><th class="num">${esc(t('In'))}</th><th class="num">${esc(t('Balance'))}</th></tr>
<tr><td>${esc(formatDate(from))}</td><td>${esc(t('Opening balance'))}</td><td></td><td></td><td></td><td class="num">${esc(money(statement.opening))}</td></tr>
${rows}</table>`;
  return page(t('Statement: {name}', { name: account }), `${formatDate(from)} – ${formatDate(to)}`, body);
}
