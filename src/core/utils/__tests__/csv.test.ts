import { toCsv } from '../csv';

describe('toCsv', () => {
  it('quotes commas, quotes and new lines', () => {
    const csv = toCsv([
      ['Note', 'Amount'],
      ['Dinner, with "friends"', -12.5],
      ['two\nlines', 3],
    ]);
    expect(csv).toBe('﻿Note,Amount\r\n"Dinner, with ""friends""",-12.5\r\n"two\nlines",3\r\n');
  });

  it('neutralises spreadsheet formulas in text but not negative numbers', () => {
    const csv = toCsv([['=HYPERLINK("x")', '-5', -5, null]]);
    expect(csv).toBe('﻿"\'=HYPERLINK(""x"")",\'-5,-5,\r\n');
  });
});
