import { type DateFormat, type NumberFormat, setLocalePrefs } from '@/core/i18n/locale';
import { getSetting, setSetting, useSetting } from '@/core/settings/settings';
import type { WeekStart } from '@/core/utils/date';

import { guessCurrency } from './currencies';

export const CURRENCY_SETTING_KEY = 'currency';
export const LAST_BACKUP_SETTING_KEY = 'lastBackupAt';
export const WEEK_START_SETTING_KEY = 'weekStart';
export const FY_START_SETTING_KEY = 'fyStartMonth';
export const LANGUAGE_SETTING_KEY = 'language';
export const DATE_FORMAT_SETTING_KEY = 'dateFormat';
export const NUMBER_FORMAT_SETTING_KEY = 'numberFormat';
export const HOME_CARDS_SETTING_KEY = 'homeCards';
export const BUDGET_ALERTS_SETTING_KEY = 'budgetAlerts';
export const BILL_REMINDERS_SETTING_KEY = 'billReminders';

export function getCurrency(): string {
  return getSetting(CURRENCY_SETTING_KEY, guessCurrency());
}

export function useCurrency(): [string, (code: string) => void] {
  return useSetting(CURRENCY_SETTING_KEY, guessCurrency());
}

export function useLastBackupAt(): string | null {
  return useSetting<string | null>(LAST_BACKUP_SETTING_KEY, null)[0];
}

export function getWeekStart(): WeekStart {
  return getSetting<WeekStart>(WEEK_START_SETTING_KEY, 1);
}

export function useWeekStart(): [WeekStart, (value: WeekStart) => void] {
  return useSetting<WeekStart>(WEEK_START_SETTING_KEY, 1);
}

/** India's financial year starts in April; elsewhere the calendar year is the usual default. */
function defaultFyStart(): number {
  return getCurrency() === 'INR' ? 4 : 1;
}

export function getFyStartMonth(): number {
  return getSetting<number>(FY_START_SETTING_KEY, defaultFyStart());
}

export function useFyStartMonth(): [number, (month: number) => void] {
  return useSetting<number>(FY_START_SETTING_KEY, defaultFyStart());
}

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

/** English unless the phone is set to a language the app has been translated into. */
export function deviceLanguage(): LanguageCode {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    return LANGUAGES.find((l) => locale.startsWith(l.code))?.code ?? 'en';
  } catch {
    return 'en';
  }
}

/** Reads the saved language and formats and applies them. Called once at startup and after a restore. */
export function applyLocaleSettings(): void {
  setLocalePrefs({
    language: getSetting<string>(LANGUAGE_SETTING_KEY, deviceLanguage()),
    dateFormat: getSetting<DateFormat>(DATE_FORMAT_SETTING_KEY, 'system'),
    numberFormat: getSetting<NumberFormat>(NUMBER_FORMAT_SETTING_KEY, 'system'),
  });
}

export function setLanguage(language: string): void {
  setSetting(LANGUAGE_SETTING_KEY, language);
  setLocalePrefs({ language });
}

export function setDateFormat(dateFormat: DateFormat): void {
  setSetting(DATE_FORMAT_SETTING_KEY, dateFormat);
  setLocalePrefs({ dateFormat });
}

export function setNumberFormat(numberFormat: NumberFormat): void {
  setSetting(NUMBER_FORMAT_SETTING_KEY, numberFormat);
  setLocalePrefs({ numberFormat });
}

/** Cards on the home screen, in their default order. */
export const HOME_CARDS = [
  { id: 'balance', label: 'Total balance' },
  { id: 'month', label: 'Income, expenses and savings' },
  { id: 'insights', label: 'Insights' },
  { id: 'bills', label: 'Upcoming bills' },
  { id: 'budget', label: 'Budget' },
  { id: 'breakdown', label: 'Where the money went' },
  { id: 'trend', label: 'Last 6 months' },
  { id: 'goals', label: 'Savings goals' },
  { id: 'networth', label: 'Net worth' },
  { id: 'recent', label: 'Recent transactions' },
  { id: 'accounts', label: 'Accounts' },
] as const;

export type HomeCardId = (typeof HOME_CARDS)[number]['id'];
export type HomeCardSetting = { id: HomeCardId; visible: boolean };

const DEFAULT_HOME_CARDS: HomeCardSetting[] = HOME_CARDS.map((c) => ({
  id: c.id,
  visible: c.id !== 'networth',
}));

/** Saved order and visibility, with cards added in later versions appended so they never go missing. */
export function normaliseHomeCards(saved: HomeCardSetting[] | null | undefined): HomeCardSetting[] {
  const known = new Set<string>(HOME_CARDS.map((c) => c.id));
  const result = (saved ?? []).filter((c) => known.has(c.id));
  for (const card of DEFAULT_HOME_CARDS) {
    if (!result.some((c) => c.id === card.id)) result.push(card);
  }
  return result;
}

export function useHomeCards(): [HomeCardSetting[], (cards: HomeCardSetting[]) => void] {
  const [saved, setSaved] = useSetting<HomeCardSetting[] | null>(HOME_CARDS_SETTING_KEY, null);
  return [normaliseHomeCards(saved), setSaved];
}

/** Settings that travel with a backup. Device-specific ones (app lock, reminders) stay on the device. */
export const BACKED_UP_SETTINGS = [
  CURRENCY_SETTING_KEY,
  'theme',
  WEEK_START_SETTING_KEY,
  FY_START_SETTING_KEY,
  LANGUAGE_SETTING_KEY,
  DATE_FORMAT_SETTING_KEY,
  NUMBER_FORMAT_SETTING_KEY,
  HOME_CARDS_SETTING_KEY,
];
