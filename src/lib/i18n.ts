import en from '../components/lib/i18n/translations/en.json';
import vi from '../components/lib/i18n/translations/vi.json';

export type Locale = 'en' | 'vi';

const translations: Record<Locale, Record<string, string>> = { en, vi };

let currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: string, fallback: string): string {
  return translations[currentLocale][key] ?? fallback;
}
