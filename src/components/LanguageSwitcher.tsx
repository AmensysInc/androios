import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../i18n/LanguageProvider';
import type { SupportedLanguage } from '../i18n/language-storage';

const GRADIENT_EN = ['#e879f9', '#8b5cf6', '#9333ea'] as const;
const GRADIENT_ES = ['#8b5cf6', '#d946ef', '#ec4899'] as const;

export default function LanguageSwitcher() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const [busy, setBusy] = useState(false);
  const isEnglish = language === 'en';

  const toggleLanguage = async () => {
    if (busy) return;
    const next: SupportedLanguage = isEnglish ? 'es' : 'en';
    setBusy(true);
    try {
      await setLanguage(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={() => void toggleLanguage()}
      disabled={busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={t('settings.languageSettings.selectLanguage')}
      style={styles.wrap}
    >
      <LinearGradient
        colors={isEnglish ? [...GRADIENT_EN] : [...GRADIENT_ES]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.pill, busy && styles.pillBusy]}
      >
        <Text style={styles.label} numberOfLines={1}>
          {isEnglish ? t('language.english') : t('language.spanish')}
        </Text>
        <View style={styles.iconCircle}>
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : isEnglish ? (
            <MaterialCommunityIcons name="check" size={14} color="#fff" />
          ) : (
            <MaterialCommunityIcons name="earth" size={14} color="#fff" />
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginRight: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 120,
    height: 36,
    borderRadius: 999,
    paddingLeft: 14,
    paddingRight: 6,
    gap: 8,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  pillBusy: {
    opacity: 0.85,
  },
  label: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.3,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
});
