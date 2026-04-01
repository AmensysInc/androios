import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import apiClient from '../lib/api-client';
import { useAuth } from '../context/AuthContext';

const FORCE_PASSWORD_ROLES = new Set([
  'super_admin',
  'operations_manager',
  'organization_manager',
  'manager',
  'company_manager',
  'employee',
]);

function shouldForcePasswordChange(user: any): boolean {
  const must = !!user?.profile?.must_change_password;
  if (!must) return false;
  const roleNames = (Array.isArray(user?.roles) ? user.roles : [])
    .map((r: any) => String(r?.role ?? r?.name ?? '').toLowerCase())
    .filter(Boolean);
  return roleNames.some((r: string) => FORCE_PASSWORD_ROLES.has(r));
}

export default function AdminAuthScreen({ navigation }: any) {
  const [mode, setMode] = useState<'login' | 'reset' | 'firstLogin'>('login');
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setSessionFromLogin } = useAuth();

  const handleSignIn = async () => {
    const trimmed = usernameOrEmail.trim();
    if (!trimmed || !password) {
      Alert.alert('Validation', 'Please enter username or email and password');
      return;
    }
    setLoading(true);
    try {
      const { user, access, refresh } = await apiClient.loginWithSession(trimmed, password);
      if (shouldForcePasswordChange(user)) {
        setMode('firstLogin');
        setCurrentPassword(password);
        setNewPassword('');
        setConfirmPassword('');
        Alert.alert('Password update required', 'For first login, change your password to continue.');
        return;
      }
      await setSessionFromLogin({ user, access, refresh });
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const trimmed = usernameOrEmail.trim();
    if (!trimmed || !currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Validation', 'Please fill all password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Validation', 'New password and confirm password do not match.');
      return;
    }
    setLoading(true);
    try {
      await apiClient.resetPasswordWithCurrent(trimmed, currentPassword, newPassword);
      if (mode === 'firstLogin') {
        const { user, access, refresh } = await apiClient.loginWithSession(trimmed, newPassword);
        await setSessionFromLogin({ user, access, refresh });
      } else {
        Alert.alert('Success', 'Password reset successful. Please sign in.');
        setMode('login');
        setPassword('');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (e: any) {
      Alert.alert('Reset failed', e?.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Admin Portal</Text>
        <Text style={styles.subtitle}>
          {mode === 'login' ? 'Sign in' : mode === 'firstLogin' ? 'First login: change password' : 'Reset password'}
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Username or email"
          value={usernameOrEmail}
          onChangeText={setUsernameOrEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={mode !== 'firstLogin'}
        />
        {mode === 'login' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSignIn}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.link} onPress={() => setMode('reset')}>
              <Text style={styles.linkText}>Reset Password</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Current Password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
            />
            <TextInput
              style={styles.input}
              placeholder="New Password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{mode === 'firstLogin' ? 'Change and Continue' : 'Reset Password'}</Text>
              )}
            </TouchableOpacity>
            {mode !== 'firstLogin' && (
              <TouchableOpacity style={styles.link} onPress={() => setMode('login')}>
                <Text style={styles.linkText}>Back to sign in</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('Auth')}>
          <Text style={styles.linkText}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f8fafc' },
  card: { width: '100%', maxWidth: 400, backgroundColor: '#fff', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#e2e8f0' },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 4, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 24, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 14, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#3b82f6', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { marginTop: 16, alignItems: 'center' },
  linkText: { color: '#3b82f6', fontSize: 14 },
});
