import { useEffect } from 'react';
import { useProcessingStore } from './processingStore';
import { useLocaleStore } from './localeStore';
import { setLocale } from '../lib/i18n';

export function useInitSubscriptions() {
  useEffect(() => {
    window.api.getLocale().then((locale) => {
      setLocale(locale);
      useLocaleStore.setState({ locale });
    });
    return useProcessingStore.getState().startSubscriptions();
  }, []);
}
