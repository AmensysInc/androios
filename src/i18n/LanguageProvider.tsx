import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import i18n, { changeAppLanguage, initI18n } from './index';
import {
  getStoredLanguage,
  setStoredLanguage,
  type SupportedLanguage,
} from './language-storage';

type LanguageContextValue = {
  language: SupportedLanguage;
  isReady: boolean;
  hasStoredPreference: boolean;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>('en');
  const [isReady, setIsReady] = useState(false);
  const [hasStoredPreference, setHasStoredPreference] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await getStoredLanguage();
      const initial = stored ?? 'en';
      await initI18n(initial);
      if (cancelled) return;
      setLanguageState((i18n.language as SupportedLanguage) || initial);
      setHasStoredPreference(stored !== null);
      setIsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback(async (nextLanguage: SupportedLanguage) => {
    await changeAppLanguage(nextLanguage);
    await setStoredLanguage(nextLanguage);
    setLanguageState(nextLanguage);
    setHasStoredPreference(true);
  }, []);

  const value = useMemo(
    () => ({ language, isReady, hasStoredPreference, setLanguage }),
    [language, isReady, hasStoredPreference, setLanguage]
  );

  if (!isReady) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <LanguageContext.Provider value={value}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  boot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
});
