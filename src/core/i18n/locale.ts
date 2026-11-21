import { useSyncExternalStore } from 'react';

/**
 * Language and formatting preferences, plus `t()` for translated text.
 *
 * Text is written in English in the code and looked up in a per-language dictionary:
 * `t('Add transaction')`, `t('{count} entries', { count })`. A missing translation falls
 * back to the English text, so the app never shows a raw key. Screens call `useLocale()`
 * (or `useT()`) so they re-render when the language or a format changes.
 */

export type DateFormat = 'system' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'yyyy-mm-dd' | 'dd-mm-yyyy' | 'dd.mm.yyyy';
export type NumberFormat = 'system' | 'indian' | 'international' | 'european' | 'spaced';

export type LocalePrefs = { language: string; dateFormat: DateFormat; numberFormat: NumberFormat };
export type TParams = Record<string, string | number>;

type Dictionary = Record<string, string>;

const dictionaries = new Map<string, Dictionary>();
let prefs: LocalePrefs = { language: 'en', dateFormat: 'system', numberFormat: 'system' };
let version = 0;
const listeners = new Set<() => void>();

export function addTranslations(language: string, dictionary: Dictionary): void {
  dictionaries.set(language, { ...dictionaries.get(language), ...dictionary });
}

export function getLocalePrefs(): LocalePrefs {
  return prefs;
}

export function setLocalePrefs(next: Partial<LocalePrefs>): void {
  const merged = { ...prefs, ...next };
  if (
    merged.language === prefs.language &&
    merged.dateFormat === prefs.dateFormat &&
    merged.numberFormat === prefs.numberFormat
  ) {
    return;
  }
  prefs = merged;
  version += 1;
  listeners.forEach((listener) => listener());
}

/** Translates English text into the current language and fills in {placeholders}. */
export function t(text: string, params?: TParams): string {
  const translated = prefs.language === 'en' ? text : (dictionaries.get(prefs.language)?.[text] ?? text);
  if (!params) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

/** The English text and every translation of it, e.g. to recognise a default name in any language. */
export function allTranslationsOf(text: string): string[] {
  const values = [text];
  for (const dictionary of dictionaries.values()) {
    if (dictionary[text]) values.push(dictionary[text]);
  }
  return values;
}

/** Picks "1 entry" or "5 entries" style text, then translates it. */
export function tPlural(count: number, one: string, other: string, params?: TParams): string {
  return t(count === 1 ? one : other, { count, ...params });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the calling component when the language, date format or number format changes. */
export function useLocale(): LocalePrefs {
  useSyncExternalStore(subscribe, () => version);
  return prefs;
}

/** `const t = useT();` re-renders on language changes and returns the translate function. */
export function useT(): typeof t {
  useLocale();
  return t;
}

/** Locale used for dates (month and weekday names follow the app language). */
export function dateLocale(): string | undefined {
  return prefs.language === 'en' ? undefined : localeForLanguage(prefs.language);
}

const NUMBER_LOCALES: Record<Exclude<NumberFormat, 'system'>, string> = {
  indian: 'en-IN', // 1,00,000.00
  international: 'en-US', // 100,000.00
  european: 'de-DE', // 100.000,00
  spaced: 'fr-FR', // 100 000,00
};

/** Locale used for numbers and money, or undefined for the phone's own setting. */
export function numberLocale(): string | undefined {
  if (prefs.numberFormat !== 'system') return NUMBER_LOCALES[prefs.numberFormat];
  return prefs.language === 'en' ? undefined : localeForLanguage(prefs.language);
}

function localeForLanguage(language: string): string {
  return language === 'hi' ? 'hi-IN' : language;
}
