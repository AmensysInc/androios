import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user, role, signOut } = useAuth();
  const roleLabel = role
    ? role === 'super_admin'
      ? t('roles.superAdmin')
      : role === 'organization_manager'
        ? t('roles.organizationManager')
        : role === 'company_manager'
          ? t('roles.companyManager')
          : t('roles.employee')
    : null;

  const handleSignOut = useCallback(() => {
    Alert.alert(t('settings.logoutConfirm.title'), t('settings.logoutConfirm.message'), [
      { text: t('settings.logoutConfirm.cancel'), style: 'cancel' },
      {
        text: t('settings.logoutConfirm.confirm'),
        style: 'destructive',
        onPress: () => void signOut(),
      },
    ]);
  }, [signOut, t]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('settings.profile')}</Text>
      {user && (
        <View style={styles.card}>
          <Text style={styles.label}>{t('settings.profileSection.email')}</Text>
          <Text style={styles.value}>{user.email ?? '—'}</Text>
          {user.full_name && (
            <>
              <Text style={styles.label}>{t('settings.profileSection.fullName')}</Text>
              <Text style={styles.value}>{user.full_name}</Text>
            </>
          )}
          {roleLabel && (
            <>
              <Text style={styles.label}>{t('settings.profileSection.role')}</Text>
              <Text style={styles.value}>{roleLabel}</Text>
            </>
          )}
        </View>
      )}
      <TouchableOpacity style={styles.button} onPress={handleSignOut}>
        <Text style={styles.buttonText}>{t('settings.logout')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  card: { backgroundColor: '#f8fafc', padding: 20, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#e2e8f0' },
  label: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  value: { fontSize: 16, color: '#0f172a', marginBottom: 16 },
  button: { backgroundColor: '#0f172a', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
