import { getLocalePrefs, numberLocale } from '../i18n/locale';

/**
 * Money helpers.
 *
 * Amounts are always stored as integers in minor units, never as floating point.
 * The unit is 1/100 of the currency (12.50 is stored as 1250), or 1/1000 for the few
 * currencies that use three decimals (Kuwaiti, Bahraini and Omani money): see moneyScale().
 */

/** Minor units per whole unit of the currency: 1000 for three-decimal currencies, otherwise 100. */
export function moneyScale(currency: string): 100 | 1000 {
  return currencyDecimals(currency) === 3 ? 1000 : 100;
}

const decimalsCache = new Map<string, number>();

/** How many decimals the currency uses: 0 for JPY, 2 for INR, 3 for KWD. */
export function currencyDecimals(currency: string): number {
  let digits = decimalsCache.get(currency);
  if (digits === undefined) {
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    decimalsCache.set(currency, digits);
  }
  return digits;
}

/** The decimal separator the device uses ("." or ","). */
export function deviceDecimalSeparator(): '.' | ',' {
  try {
    return (1.1).toLocaleString().includes(',') ? ',' : '.';
  } catch {
    return '.';
  }
}

/** The decimal separator for amounts, following the number format chosen in the app. */
export function decimalSeparator(): '.' | ',' {
  switch (getLocalePrefs().numberFormat) {
    case 'indian':
    case 'international':
      return '.';
    case 'european':
    case 'spaced':
      return ',';
    default:
      return deviceDecimalSeparator();
  }
}

type AmountOptions = { decimalSeparator?: '.' | ','; currency?: string };

/**
 * Parses user input such as "1,234.50" (or "1.234,50" when the decimal separator is a comma)
 * into minor units. Returns null when invalid or empty.
 *
 * Phone keypads offer both "," and ".", so a single "other" separator followed by
 * one or two digits ("12,50" when the separator is ".") is read as the decimal point, not as
 * a thousands separator. Thousands groups always have three digits, so this is safe.
 * Currencies without decimals (yen) reject a fraction; three-decimal currencies accept three.
 */
export function parseAmount(input: string, options: AmountOptions = {}): number | null {
  const sep = options.decimalSeparator ?? decimalSeparator();
  const digits = options.currency ? Math.min(currencyDecimals(options.currency), 3) : 2;
  const scale = options.currency ? moneyScale(options.currency) : 100;
  const other = sep === '.' ? ',' : '.';
  let cleaned = input.trim().replace(/[\s  ']/g, '');
  if (!cleaned.includes(sep)) {
    const maxLone = Math.min(Math.max(digits, 1), 2); // "1,234" stays a thousands group
    const lone = new RegExp(`^(\\d+)\\${other}(\\d{1,${maxLone}})$`).exec(cleaned);
    if (lone) cleaned = `${lone[1]}${sep}${lone[2]}`;
  }
  cleaned = cleaned.split(other).join(''); // drop thousands separators
  if (sep === ',') cleaned = cleaned.replace(',', '.');
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d*(\\.\\d{0,${digits}})?$`);
  if (cleaned === '' || cleaned === '.' || !pattern.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  const places = scale === 1000 ? 3 : 2;
  const minor = Number(whole || '0') * scale + Number((fraction + '000').slice(0, places));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Converts minor units back into an editable string, e.g. 1250 -> "12.50", 1200 -> "12". */
export function toInputString(minor: number, options: AmountOptions = {}): string {
  const sep = options.decimalSeparator ?? decimalSeparator();
  const scale = options.currency ? moneyScale(options.currency) : 100;
  const places = scale === 1000 ? 3 : 2;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / scale);
  const fraction = abs % scale;
  if (fraction === 0) return `${sign}${whole}`;
  return `${sign}${whole}${sep}${String(fraction).padStart(places, '0')}`;
}

/** Minor units as a plain number of whole units, for spreadsheets: 1250 -> 12.5. */
export function toMajor(minor: number, currency: string): number {
  return minor / moneyScale(currency);
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, locale: string | undefined): Intl.NumberFormat {
  const key = `${locale ?? ''}|${currency}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Formats minor units as a currency string in the chosen number format, e.g. "₹1,250.00". */
export function formatMoney(minor: number, currency: string): string {
  const value = minor === 0 ? 0 : minor / moneyScale(currency); // never "-₹0.00"
  try {
    return currencyFormatter(currency, numberLocale()).format(value);
  } catch {
    return `${currency} ${value.toFixed(currencyDecimals(currency))}`;
  }
}

/** Formats a plain number (not money) in the chosen number format, e.g. 12.5 -> "12.5". */
export function formatNumber(value: number, maximumFractionDigits = 2): string {
  try {
    return new Intl.NumberFormat(numberLocale(), { maximumFractionDigits }).format(value);
  } catch {
    return String(value);
  }
}

/** Short label for charts: 12500 major units -> "12.5K". No currency symbol. */
export function formatCompact(minor: number, currency?: string): string {
  const value = Math.abs(minor / (currency ? moneyScale(currency) : 100));
  const sign = minor < 0 ? '-' : '';
  const indian = getLocalePrefs().numberFormat === 'indian';
  if (indian) {
    if (value >= 10_000_000) return `${sign}${trim(value / 10_000_000)}Cr`;
    if (value >= 100_000) return `${sign}${trim(value / 100_000)}L`;
  } else {
    if (value >= 1_000_000_000) return `${sign}${trim(value / 1_000_000_000)}B`;
    if (value >= 1_000_000) return `${sign}${trim(value / 1_000_000)}M`;
  }
  if (value >= 1_000) return `${sign}${trim(value / 1_000)}K`;
  return `${sign}${Math.round(value)}`;
}

function trim(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
}
