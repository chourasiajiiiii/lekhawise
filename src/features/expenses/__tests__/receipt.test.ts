import { parseReceipt } from '../receiptParser';

const today = '2026-11-21';

describe('receipt reading', () => {
  it('reads an Indian restaurant bill', () => {
    const lines = [
      'Cafe Coffee Corner',
      'MG Road, Pune',
      'GSTIN: 27ABCDE1234F1Z5',
      'Bill No: 4521   Date: 19/11/2026 13:42',
      'Cappuccino x2          360.00',
      'Sandwich               240.00',
      'Sub Total              600.00',
      'CGST 2.5%               15.00',
      'SGST 2.5%               15.00',
      'Round off                0.00',
      'Grand Total           ₹630.00',
      'Thank you! Visit again',
    ];
    expect(parseReceipt(lines, { today })).toEqual({ amount: 63000, date: '2026-11-19', merchant: 'Cafe Coffee Corner' });
  });

  it('reads a supermarket receipt with the total on the next line and savings below', () => {
    const lines = [
      'TAX INVOICE',
      'FRESH MART SUPERMARKET',
      'Ph: 020-12345678',
      '20-Nov-26',
      'Milk 1L                 66.00',
      'Rice 5kg               425.50',
      'Total Items: 2',
      'NET AMOUNT PAYABLE',
      'Rs. 1,491.50',
      'You saved Rs. 25.00',
      'Cash tendered 2000.00',
      'Change 508.50',
    ];
    expect(parseReceipt(lines, { today })).toEqual({ amount: 149150, date: '2026-11-20', merchant: 'FRESH MART SUPERMARKET' });
  });

  it('reads a US receipt with month-first dates', () => {
    const lines = ['Corner Store', '11/18/2026 4:05 PM', 'SUBTOTAL $10.00', 'TAX $0.83', 'TOTAL $10.83', 'VISA ****1234'];
    expect(parseReceipt(lines, { today, dateOrder: 'mdy' })).toEqual({ amount: 1083, date: '2026-11-18', merchant: 'Corner Store' });
  });

  it('falls back to the largest amount and ignores future dates, phone numbers and years', () => {
    const lines = ['Hardware Shop', 'Tel 9876543210', 'Est. 1998', 'Nails 120.00', 'Paint 899.00', 'Date 01/01/2030'];
    expect(parseReceipt(lines, { today })).toEqual({ amount: 89900, date: null, merchant: 'Hardware Shop' });
  });

  it('reads rows as the Android recogniser returns them, with a day-first date on a dollar receipt', () => {
    // Rows joined left to right (textRows.ts), as read from a printed bill on an Android emulator.
    const lines = [
      'SPICE GARDEN RESTAURANT',
      'FC Road, Pune 411004',
      'GSTIN: 27AAACS1234F1Z9',
      'Bill No: 1187',
      'Date: 20/11/2026 20:14',
      'Paneer Tikka 320.00',
      'Dal Makhani 260.00',
      'Butter Naan x4 160.00',
      'Sub Total 830.00',
      'CGST 2.5% 20.75',
      'SGST 2.5% 20.75',
      'Grand Total Rs. 871.50',
      'Thank you. Visit again!',
    ];
    expect(parseReceipt(lines, { today, currency: 'USD', dateOrder: 'mdy' })).toEqual({
      amount: 87150,
      date: '2026-11-20',
      merchant: 'SPICE GARDEN RESTAURANT',
    });
  });

  it('reads a US receipt with prices in a column and a card line repeating the total', () => {
    // Rows as joined from the photo used for the iPhone simulator test (e2e/ios/media/receipt-us.png).
    const lines = [
      'HARBOR FRESH MARKET',
      '1420 Pine Street, Seattle WA',
      '(206) 555-0142',
      '11/19/2026 6:42 PM',
      'Organic Bananas 3.49',
      'Whole Milk 1 gal 4.29',
      'Sourdough Bread 6.50',
      'Coffee Beans 14.99',
      'SUBTOTAL 29.27',
      'TAX 2.98',
      'TOTAL $32.25',
      'VISA **** 4821 32.25',
      'Thank you for shopping!',
    ];
    expect(parseReceipt(lines, { today, currency: 'USD', dateOrder: 'mdy' })).toEqual({
      amount: 3225,
      date: '2026-11-19',
      merchant: 'HARBOR FRESH MARKET',
    });
  });

  it('returns nothing it cannot find', () => {
    expect(parseReceipt(['', '***'], { today })).toEqual({ amount: null, date: null, merchant: null });
  });
});
