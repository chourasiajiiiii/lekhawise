import { setLocalePrefs } from '../../i18n/locale';
import { currencyDecimals, formatCompact, formatMoney, moneyScale, parseAmount, toInputString, toMajor } from '../money';

const dot = { decimalSeparator: '.' } as const;
const comma = { decimalSeparator: ',' } as const;

describe('parseAmount', () => {
  it('parses whole numbers and decimals into minor units', () => {
    expect(parseAmount('12', dot)).toBe(1200);
    expect(parseAmount('12.5', dot)).toBe(1250);
    expect(parseAmount('12.05', dot)).toBe(1205);
    expect(parseAmount('.5', dot)).toBe(50);
    expect(parseAmount('0.01', dot)).toBe(1);
  });

  it('ignores thousands separators and spaces', () => {
    expect(parseAmount('1,23,456.78', dot)).toBe(12345678);
    expect(parseAmount(' 1 000 ', dot)).toBe(100000);
    expect(parseAmount('1 000,50', comma)).toBe(100050);
  });

  it('supports comma as decimal separator', () => {
    expect(parseAmount('12,50', comma)).toBe(1250);
    expect(parseAmount('1.234,5', comma)).toBe(123450);
    expect(parseAmount('1.234', comma)).toBe(123400); // thousands
  });

  it('reads a lone "other" separator with 1-2 digits as the decimal point (both keys are on the keypad)', () => {
    expect(parseAmount('12,50', dot)).toBe(1250);
    expect(parseAmount('1,5', dot)).toBe(150);
    expect(parseAmount('12.50', comma)).toBe(1250);
    expect(parseAmount('1,234', dot)).toBe(123400); // three digits: thousands
    expect(parseAmount('1,25,000', dot)).toBe(12500000); // Indian grouping
  });

  it('rejects invalid input', () => {
    expect(parseAmount('', dot)).toBeNull();
    expect(parseAmount('.', dot)).toBeNull();
    expect(parseAmount('abc', dot)).toBeNull();
    expect(parseAmount('1.234', dot)).toBeNull(); // three decimals
    expect(parseAmount('-5', dot)).toBeNull();
    expect(parseAmount('1.2.3', dot)).toBeNull();
  });

  it('never produces floating point drift', () => {
    expect(parseAmount('0.29', dot)).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(parseAmount('1.15', dot)).toBe(115);
  });

  it('follows the currency: no decimals for yen, three for Kuwaiti dinar', () => {
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('KWD')).toBe(3);
    expect(currencyDecimals('INR')).toBe(2);
    expect(moneyScale('KWD')).toBe(1000);
    expect(moneyScale('JPY')).toBe(100);
    expect(parseAmount('1500', { ...dot, currency: 'JPY' })).toBe(150000);
    expect(parseAmount('15.5', { ...dot, currency: 'JPY' })).toBeNull();
    expect(parseAmount('12.345', { ...dot, currency: 'KWD' })).toBe(12345);
    expect(parseAmount('12.3', { ...dot, currency: 'KWD' })).toBe(12300);
    expect(parseAmount('1,234', { ...dot, currency: 'KWD' })).toBe(1234000); // still thousands
  });
});

describe('toInputString', () => {
  it('round-trips with parseAmount', () => {
    for (const minor of [0, 1, 50, 1200, 1205, 123456789]) {
      expect(parseAmount(toInputString(minor, dot), dot)).toBe(minor);
      expect(parseAmount(toInputString(minor, comma), comma)).toBe(minor);
    }
    for (const minor of [1, 12345, 1000]) {
      expect(parseAmount(toInputString(minor, { ...dot, currency: 'KWD' }), { ...dot, currency: 'KWD' })).toBe(minor);
    }
  });

  it('drops a zero fraction', () => {
    expect(toInputString(1200, dot)).toBe('12');
    expect(toInputString(1205, dot)).toBe('12.05');
    expect(toInputString(12050, { ...dot, currency: 'KWD' })).toBe('12.050');
  });
});

describe('formatting', () => {
  afterEach(() => setLocalePrefs({ numberFormat: 'international', language: 'en' }));

  it('formats money in the chosen number format', () => {
    setLocalePrefs({ numberFormat: 'indian' });
    expect(formatMoney(12345678, 'INR')).toBe('₹1,23,456.78');
    setLocalePrefs({ numberFormat: 'international' });
    expect(formatMoney(12345678, 'USD')).toBe('$123,456.78');
    expect(formatMoney(-0, 'USD')).toBe('$0.00');
    setLocalePrefs({ numberFormat: 'european' });
    expect(formatMoney(12345678, 'EUR').replace(/\s/g, ' ')).toBe('123.456,78 €');
    expect(formatMoney(12345, 'KWD').replace(/\s/g, ' ')).toContain('12,345');
    expect(toMajor(12345, 'KWD')).toBe(12.345);
  });

  it('shortens large values, in lakh and crore for the Indian format', () => {
    expect(formatCompact(99_00)).toBe('99');
    expect(formatCompact(1_500_00)).toBe('1.5K');
    expect(formatCompact(250_000_00)).toBe('250K');
    expect(formatCompact(1_200_000_00)).toBe('1.2M');
    expect(formatCompact(-1_000_00)).toBe('-1K');
    setLocalePrefs({ numberFormat: 'indian' });
    expect(formatCompact(2_50_000_00)).toBe('2.5L');
    expect(formatCompact(1_20_00_000_00)).toBe('1.2Cr');
  });
});
