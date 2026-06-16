import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../i18n/LanguageProvider';
import type { SupportedLanguage } from '../i18n/language-storage';

const OPTIONS: { code: SupportedLanguage; labelKey: 'language.english' | 'language.spanish' }[] = [
  { code: 'en', labelKey: 'language.english' },
  { code: 'es', labelKey: 'language.spanish' },
];

type Props = {
  /** When true, user cannot dismiss without choosing (first login). */
  required?: boolean;
};

export default function LanguageSelectionScreen({ required = false }: Props) {
  const { t } = useTranslation();
  const { setLanguage } = useLanguage();
  const [saving, setSaving] = useState(false);

  const handleSelect = async (language: SupportedLanguage) => {
    setSaving(true);
    try {
      await setLanguage(language);
    } catch {
      Alert.alert(t('common.error'), t('settings.languageSettings.changeFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>
          {required ? t('language.chooseTitle') : t('settings.languageSettings.selectLanguage')}
        </Text>
        <Text style={styles.subtitle}>{t('language.chooseDescription')}</Text>
        {required ? (
          <Text style={styles.requiredHint}>{t('language.requiredHint')}</Text>
        ) : null}

        <View style={styles.options}>
          {OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.code}
              style={[styles.optionBtn, saving && styles.optionBtnDisabled]}
              onPress={() => handleSelect(option.code)}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#3b82f6" style={styles.spinner} />
              ) : null}
              <Text style={styles.optionText}>{t(option.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  requiredHint: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 16,
  },
  options: { gap: 12, marginTop: 16 },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
  },
  optionBtnDisabled: { opacity: 0.7 },
  optionText: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  spinner: { marginRight: 8 },
});
