import { detectDelimiter, parseCsv, toCsv } from '@/core/utils/csv';

import { buildImportRows, detectDateOrder, guessMapping, parseImportAmount, parseImportDate } from '../csvImport';

describe('CSV reading', () => {
  it('handles quotes, commas and line breaks inside fields, and a BOM', () => {
    const text = '﻿Date,Note,Amount\r\n2026-11-01,"Dinner, with ""friends""",-450\r\n2026-11-02,"two\nlines",100\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['Date', 'Note', 'Amount'],
      ['2026-11-01', 'Dinner, with "friends"', '-450'],
      ['2026-11-02', 'two\nlines', '100'],
    ]);
  });

  it('detects semicolon and tab separated files', () => {
    expect(detectDelimiter('Date;Amount;Note\n01.11.2026;-4,50;x')).toBe(';');
    expect(detectDelimiter('Date\tAmount\n2026-11-01\t5')).toBe('\t');
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('reads back what the app exports', () => {
    const exported = toCsv([['Date', 'Note'], ['2026-11-01', '=1+1'], ['2026-11-02', 'a,b']]);
    expect(parseCsv(exported)).toEqual([['Date', 'Note'], ['2026-11-01', "'=1+1"], ['2026-11-02', 'a,b']]);
  });
});

describe('dates and amounts in statements', () => {
  it('reads common date styles', () => {
    expect(parseImportDate('21/11/2026', 'dmy')).toBe('2026-11-21');
    expect(parseImportDate('11/21/2026', 'mdy')).toBe('2026-11-21');
    expect(parseImportDate('2026-11-21', 'dmy')).toBe('2026-11-21');
    expect(parseImportDate('21-Nov-26', 'dmy')).toBe('2026-11-21');
    expect(parseImportDate('21 November 2026', 'dmy')).toBe('2026-11-21');
    expect(parseImportDate('Nov 21, 2026', 'mdy')).toBe('2026-11-21');
    expect(parseImportDate('21.11.2026 14:05', 'dmy')).toBe('2026-11-21');
    expect(parseImportDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseImportDate('hello', 'dmy')).toBeNull();
  });

  it('detects whether day or month comes first', () => {
    expect(detectDateOrder(['01/11/2026', '25/11/2026'])).toBe('dmy');
    expect(detectDateOrder(['11/01/2026', '11/25/2026'])).toBe('mdy');
    expect(detectDateOrder(['01/02/2026'])).toBe('dmy'); // ambiguous: day first
  });

  it('reads amounts with symbols, signs, brackets and Dr/Cr', () => {
    expect(parseImportAmount('₹ 1,234.50', '.')).toBe(123450);
    expect(parseImportAmount('-1,234.50', '.')).toBe(-123450);
    expect(parseImportAmount('(500.00)', '.')).toBe(-50000);
    expect(parseImportAmount('500.00 Dr', '.')).toBe(-50000);
    expect(parseImportAmount('500.00 CR', '.')).toBe(50000);
    expect(parseImportAmount('1.234,50', ',')).toBe(123450);
    expect(parseImportAmount('', '.')).toBeNull();
    expect(parseImportAmount('-', '.')).toBeNull();
  });
});

describe('mapping rows', () => {
  it('guesses columns from typical bank headers', () => {
    expect(guessMapping(['Txn Date', 'Narration', 'Chq./Ref.No.', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'])).toMatchObject({
      date: 0, description: 1, debit: 3, credit: 4, amount: null,
    });
    expect(guessMapping(['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'To account', 'Note', 'Tags'])).toMatchObject({
      date: 0, type: 1, amount: 2, category: 4, account: 5, toAccount: 6, description: 7,
    });
  });

  it('turns rows into entries and explains rows it cannot use', () => {
    const mapping = guessMapping(['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'To account', 'Note']);
    const rows = buildImportRows(
      [
        ['2026-11-01', 'expense', '-12.5', 'INR', 'Food & dining', 'Cash', '', 'Tea'],
        ['2026-11-01', 'transfer', '100', 'INR', '', 'Bank', 'Cash', ''],
        ['2026-11-02', 'income', '0', 'INR', '', 'Bank', '', ''],
      ],
      mapping,
      { dateOrder: 'dmy', decimalSeparator: '.' },
    );
    expect(rows.map((r) => [r.type, r.amount, r.categoryName, r.accountName, r.toAccountName, r.error])).toEqual([
      ['expense', 1250, 'Food & dining', 'Cash', '', null],
      ['transfer', 10000, '', 'Bank', 'Cash', null],
      ['income', 0, '', 'Bank', '', 'No amount'],
    ]);
  });
});
