import { create } from 'zustand';
import { setLocale, getLocale, type Locale } from '../lib/i18n';

interface LocaleStore {
  locale: Locale;
  changeLocale: (locale: Locale) => Promise<void>;
}

export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: getLocale(),
  changeLocale: async (locale: Locale) => {
    setLocale(locale);
    await window.api.setLocale(locale);
    set({ locale });
  },
}));
