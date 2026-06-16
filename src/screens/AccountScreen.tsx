import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../i18n/LanguageProvider';
import type { SupportedLanguage } from '../i18n/language-storage';
import * as api from '../api';
import {
  deleteFaceEnrollment,
  enrollFaceWithUri,
  getFaceEnrollmentStatus,
  pickFacePhotoFromCamera,
} from '../lib/accountFaceAuth';

const LANGUAGE_OPTIONS: { code: SupportedLanguage; labelKey: 'language.english' | 'language.spanish' }[] = [
  { code: 'en', labelKey: 'language.english' },
  { code: 'es', labelKey: 'language.spanish' },
];

export default function AccountScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [hasEmployee, setHasEmployee] = useState(false);
  const [faceEnrolled, setFaceEnrolled] = useState(false);
  const [faceBusy, setFaceBusy] = useState(false);
  const [profile, setProfile] = useState({
    full_name: '',
    email: '',
    mobile_number: '',
  });
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    if (user) fetchProfile();
  }, [user]);

  const fetchProfile = async () => {
    try {
      const data = await api.getCurrentUser() as any;
      const profileData = data?.profile || {};
      setProfile({
        full_name: profileData.full_name || data.full_name || '',
        email: data.email || '',
        mobile_number: profileData.mobile_number || '',
      });
      if (user) {
        const emp = await api.findSchedulerEmployeeForAuthUser({ ...user, ...data });
        setHasEmployee(!!emp);
        if (emp) {
          const st = await getFaceEnrollmentStatus();
          setFaceEnrolled(st.enrolled);
        } else {
          setFaceEnrolled(false);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async () => {
    setUpdating(true);
    try {
      await api.updateProfile({
        full_name: profile.full_name,
        email: profile.email,
        mobile_number: profile.mobile_number,
      });
      Alert.alert(t('common.success'), t('settings.toast.updatedSuccessfully'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('account.updateFailed'));
    } finally {
      setUpdating(false);
    }
  };

  const handleLanguageChange = async (code: SupportedLanguage) => {
    if (code === language || languageBusy) return;
    setLanguageBusy(true);
    try {
      await setLanguage(code);
      Alert.alert(t('common.success'), t('settings.toast.languageUpdatedSuccessfully'));
    } catch {
      Alert.alert(t('common.error'), t('settings.languageSettings.changeFailed'));
    } finally {
      setLanguageBusy(false);
    }
  };

  const enrollOrReplaceFace = async () => {
    setFaceBusy(true);
    try {
      const uri = await pickFacePhotoFromCamera();
      if (!uri) return;
      await enrollFaceWithUri(uri);
      setFaceEnrolled(true);
      Alert.alert(t('common.success'), t('account.faceSaved'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('account.faceSaveFailed'));
    } finally {
      setFaceBusy(false);
    }
  };

  const removeFaceEnrollment = async () => {
    Alert.alert(t('account.removeFaceTitle'), t('account.removeFaceMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.remove'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setFaceBusy(true);
            try {
              await deleteFaceEnrollment();
              setFaceEnrolled(false);
              Alert.alert(t('common.success'), t('account.faceRemoved'));
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.message || t('account.faceRemoveFailed'));
            } finally {
              setFaceBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const changePassword = async () => {
    if (passwords.newPassword !== passwords.confirmPassword) {
      Alert.alert(t('common.error'), t('settings.password.passwordsDoNotMatch'));
      return;
    }
    if (passwords.newPassword.length < 6) {
      Alert.alert(t('common.error'), t('settings.password.invalidPassword'));
      return;
    }
    setChangingPassword(true);
    try {
      await api.changePassword({
        old_password: passwords.currentPassword,
        new_password: passwords.newPassword,
      });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      Alert.alert(t('common.success'), t('settings.password.updatedSuccessfully'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('settings.password.invalidPassword'));
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('settings.title')}</Text>
          <Text style={styles.subtitle}>{t('settings.subtitle')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.languageSettings.title')}</Text>
          <Text style={styles.helpText}>{t('language.settingsDescription')}</Text>
          <View style={styles.langRow}>
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = language === opt.code;
              return (
                <TouchableOpacity
                  key={opt.code}
                  style={[styles.langChip, active && styles.langChipActive, languageBusy && styles.btnDisabled]}
                  onPress={() => handleLanguageChange(opt.code)}
                  disabled={languageBusy}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{t(opt.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.profile')}</Text>
          <Text style={styles.fieldLabel}>{t('settings.profileSection.fullName')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.profileSection.fullName')}
            value={profile.full_name}
            onChangeText={(v) => setProfile((p) => ({ ...p, full_name: v }))}
            autoCapitalize="words"
          />
          <Text style={styles.fieldLabel}>{t('settings.profileSection.email')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.profileSection.email')}
            value={profile.email}
            onChangeText={(v) => setProfile((p) => ({ ...p, email: v }))}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Text style={styles.fieldLabel}>{t('settings.profileSection.phoneNumber')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.profileSection.phoneNumber')}
            value={profile.mobile_number}
            onChangeText={(v) => setProfile((p) => ({ ...p, mobile_number: v }))}
            keyboardType="phone-pad"
          />
          <TouchableOpacity
            style={[styles.btn, updating && styles.btnDisabled]}
            onPress={updateProfile}
            disabled={updating}
          >
            <Text style={styles.btnText}>{updating ? t('common.saving') : t('common.save')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.password.title')}</Text>
          <Text style={styles.fieldLabel}>{t('settings.password.currentPassword')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.password.currentPassword')}
            value={passwords.currentPassword}
            onChangeText={(v) => setPasswords((p) => ({ ...p, currentPassword: v }))}
            secureTextEntry
          />
          <Text style={styles.fieldLabel}>{t('settings.password.newPassword')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.password.newPassword')}
            value={passwords.newPassword}
            onChangeText={(v) => setPasswords((p) => ({ ...p, newPassword: v }))}
            secureTextEntry
          />
          <Text style={styles.fieldLabel}>{t('settings.password.confirmPassword')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.password.confirmPassword')}
            value={passwords.confirmPassword}
            onChangeText={(v) => setPasswords((p) => ({ ...p, confirmPassword: v }))}
            secureTextEntry
          />
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary, changingPassword && styles.btnDisabled]}
            onPress={changePassword}
            disabled={changingPassword}
          >
            <Text style={styles.btnText}>
              {changingPassword ? t('account.changing') : t('settings.password.changePassword')}
            </Text>
          </TouchableOpacity>
        </View>

        {hasEmployee ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('account.faceSection')}</Text>
            <Text style={styles.helpText}>{t('account.faceHelp')}</Text>
            <TouchableOpacity
              style={[styles.btn, faceBusy && styles.btnDisabled]}
              onPress={enrollOrReplaceFace}
              disabled={faceBusy}
            >
              <Text style={styles.btnText}>{faceEnrolled ? t('account.replaceFace') : t('account.enrollFace')}</Text>
            </TouchableOpacity>
            {faceEnrolled ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnDanger, faceBusy && styles.btnDisabled]}
                onPress={removeFaceEnrollment}
                disabled={faceBusy}
              >
                <Text style={styles.btnText}>{t('account.removeEnrollment')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: 20, paddingBottom: 48 },
  header: { marginBottom: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a', marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  langRow: { flexDirection: 'row', gap: 10 },
  langChip: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  langChipActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  langChipText: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  langChipTextActive: { color: '#fff' },
  btn: { backgroundColor: '#3b82f6', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#64748b' },
  btnDanger: { backgroundColor: '#b91c1c', marginTop: 10 },
  btnDisabled: { opacity: 0.7 },
  helpText: { fontSize: 14, color: '#64748b', marginBottom: 12, lineHeight: 20 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
