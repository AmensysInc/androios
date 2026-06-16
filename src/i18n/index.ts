import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en/translation.json';
import es from '../locales/es/translation.json';
import type { SupportedLanguage } from './language-storage';

let initPromise: Promise<typeof i18n> | null = null;

export async function initI18n(initialLanguage: SupportedLanguage = 'en'): Promise<typeof i18n> {
  if (i18n.isInitialized) {
    if (i18n.language !== initialLanguage) {
      await i18n.changeLanguage(initialLanguage);
    }
    return i18n;
  }

  if (initPromise) return initPromise;

  initPromise = i18n.use(initReactI18next).init({
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    ns: ['translation'],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
  }).then(() => i18n);

  return initPromise;
}

export async function changeAppLanguage(language: SupportedLanguage): Promise<void> {
  await initI18n(language);
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }
}

export default i18n;
