export type Currency = { code: string; name: string; region: string[] };

/** Common currencies. Any ISO 4217 code works with the formatter; extend as needed. */
export const CURRENCIES: Currency[] = [
  { code: 'INR', name: 'Indian rupee', region: ['IN'] },
  { code: 'USD', name: 'US dollar', region: ['US', 'EC', 'SV', 'PR'] },
  { code: 'EUR', name: 'Euro', region: ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR'] },
  { code: 'GBP', name: 'British pound', region: ['GB'] },
  { code: 'AED', name: 'UAE dirham', region: ['AE'] },
  { code: 'SAR', name: 'Saudi riyal', region: ['SA'] },
  { code: 'QAR', name: 'Qatari riyal', region: ['QA'] },
  { code: 'KWD', name: 'Kuwaiti dinar', region: ['KW'] },
  { code: 'OMR', name: 'Omani rial', region: ['OM'] },
  { code: 'BHD', name: 'Bahraini dinar', region: ['BH'] },
  { code: 'CAD', name: 'Canadian dollar', region: ['CA'] },
  { code: 'AUD', name: 'Australian dollar', region: ['AU'] },
  { code: 'NZD', name: 'New Zealand dollar', region: ['NZ'] },
  { code: 'SGD', name: 'Singapore dollar', region: ['SG'] },
  { code: 'MYR', name: 'Malaysian ringgit', region: ['MY'] },
  { code: 'JPY', name: 'Japanese yen', region: ['JP'] },
  { code: 'CNY', name: 'Chinese yuan', region: ['CN'] },
  { code: 'HKD', name: 'Hong Kong dollar', region: ['HK'] },
  { code: 'KRW', name: 'South Korean won', region: ['KR'] },
  { code: 'THB', name: 'Thai baht', region: ['TH'] },
  { code: 'IDR', name: 'Indonesian rupiah', region: ['ID'] },
  { code: 'PHP', name: 'Philippine peso', region: ['PH'] },
  { code: 'VND', name: 'Vietnamese dong', region: ['VN'] },
  { code: 'PKR', name: 'Pakistani rupee', region: ['PK'] },
  { code: 'BDT', name: 'Bangladeshi taka', region: ['BD'] },
  { code: 'LKR', name: 'Sri Lankan rupee', region: ['LK'] },
  { code: 'NPR', name: 'Nepalese rupee', region: ['NP'] },
  { code: 'CHF', name: 'Swiss franc', region: ['CH'] },
  { code: 'SEK', name: 'Swedish krona', region: ['SE'] },
  { code: 'NOK', name: 'Norwegian krone', region: ['NO'] },
  { code: 'DKK', name: 'Danish krone', region: ['DK'] },
  { code: 'PLN', name: 'Polish zloty', region: ['PL'] },
  { code: 'TRY', name: 'Turkish lira', region: ['TR'] },
  { code: 'ZAR', name: 'South African rand', region: ['ZA'] },
  { code: 'NGN', name: 'Nigerian naira', region: ['NG'] },
  { code: 'KES', name: 'Kenyan shilling', region: ['KE'] },
  { code: 'EGP', name: 'Egyptian pound', region: ['EG'] },
  { code: 'BRL', name: 'Brazilian real', region: ['BR'] },
  { code: 'MXN', name: 'Mexican peso', region: ['MX'] },
];

/** Picks a starting currency from the device locale's region, e.g. en-IN -> INR. */
export function guessCurrency(): string {
  try {
    const locale = Intl.NumberFormat().resolvedOptions().locale;
    const region = locale.split('-').find((part) => /^[A-Z]{2}$/.test(part));
    const match = region ? CURRENCIES.find((c) => c.region.includes(region)) : undefined;
    return match?.code ?? 'USD';
  } catch {
    return 'USD';
  }
}
