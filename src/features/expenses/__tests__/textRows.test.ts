import { parseReceipt } from '../receiptParser';
import { joinRows, type TextPiece } from '../textRows';

const piece = (text: string, left: number, top: number, right: number, bottom: number): TextPiece => ({
  text,
  box: { left, top, right, bottom },
});

describe('joining recognised text into rows', () => {
  it('joins pieces of the same row left to right and orders rows top to bottom', () => {
    // Pixel positions, as Android returns them, deliberately out of order.
    const pieces = [
      piece('871.50', 600, 905, 700, 940),
      piece('GARDEN RESTAURANT', 260, 40, 620, 82),
      piece('Grand Total Rs.', 40, 900, 330, 942),
      piece('SPICE', 120, 42, 230, 80),
      piece('Date: 20/11/2026', 40, 150, 330, 185),
    ];
    expect(joinRows(pieces)).toEqual(['SPICE GARDEN RESTAURANT', 'Date: 20/11/2026', 'Grand Total Rs. 871.50']);
  });

  it('keeps close rows apart when they overlap by less than half', () => {
    const pieces = [piece('Sub Total 830.00', 0, 100, 300, 130), piece('CGST 20.75', 0, 120, 300, 150)];
    expect(joinRows(pieces)).toEqual(['Sub Total 830.00', 'CGST 20.75']);
  });

  it('keeps pieces without a position at the end', () => {
    expect(joinRows([{ text: 'loose', box: null }, piece('first', 0, 0, 10, 10)])).toEqual(['first', 'loose']);
  });

  it('reads a receipt from iPhone-style positions (fractions of the photo)', () => {
    // Apple Vision splits a row into a label and a far-right amount; positions are fractions of the photo.
    const pieces = [
      piece('Corner Store', 0.3, 0.05, 0.7, 0.08),
      piece('11/18/2026 4:05 PM', 0.1, 0.12, 0.6, 0.145),
      piece('$10.00', 0.75, 0.3, 0.9, 0.325),
      piece('SUBTOTAL', 0.1, 0.302, 0.35, 0.327),
      piece('TAX', 0.1, 0.34, 0.2, 0.365),
      piece('$0.83', 0.77, 0.338, 0.9, 0.363),
      piece('TOTAL', 0.1, 0.38, 0.25, 0.405),
      piece('$10.83', 0.75, 0.381, 0.9, 0.406),
    ];
    const lines = joinRows(pieces);
    expect(lines).toEqual(['Corner Store', '11/18/2026 4:05 PM', 'SUBTOTAL $10.00', 'TAX $0.83', 'TOTAL $10.83']);
    expect(parseReceipt(lines, { today: '2026-11-21', dateOrder: 'mdy' })).toEqual({
      amount: 1083,
      date: '2026-11-18',
      merchant: 'Corner Store',
    });
  });

  it('returns nothing for a photo without text', () => {
    expect(joinRows([])).toEqual([]);
  });
});
