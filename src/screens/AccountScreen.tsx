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
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import {
  deleteFaceEnrollment,
  enrollFaceWithUri,
  getFaceEnrollmentStatus,
  pickFacePhotoFromCamera,
} from '../lib/accountFaceAuth';

export default function AccountScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
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
    } catch (e) {
      console.warn(e);
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
      Alert.alert('Success', 'Profile updated successfully');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update profile');
    } finally {
      setUpdating(false);
    }
  };

  const enrollOrReplaceFace = async () => {
    setFaceBusy(true);
    try {
      const uri = await pickFacePhotoFromCamera();
      if (!uri) return;
      await enrollFaceWithUri(uri);
      setFaceEnrolled(true);
      Alert.alert('Saved', 'Your face is stored for verification on any device when you clock in or out.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save face enrollment.');
    } finally {
      setFaceBusy(false);
    }
  };

  const removeFaceEnrollment = async () => {
    Alert.alert(
      'Remove face enrollment?',
      'Clock actions will no longer require a matching photo on the server. Device Face ID / fingerprint settings are unchanged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setFaceBusy(true);
              try {
                await deleteFaceEnrollment();
                setFaceEnrolled(false);
                Alert.alert('Removed', 'Account face enrollment was deleted.');
              } catch (e: any) {
                Alert.alert('Error', e?.message || 'Could not remove enrollment.');
              } finally {
                setFaceBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const changePassword = async () => {
    if (passwords.newPassword !== passwords.confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }
    if (passwords.newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    setChangingPassword(true);
    try {
      await api.changePassword({
        old_password: passwords.currentPassword,
        new_password: passwords.newPassword,
      });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      Alert.alert('Success', 'Password changed successfully');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to change password');
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
          <Text style={styles.title}>Account Settings</Text>
          <Text style={styles.subtitle}>Manage your profile and security</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile</Text>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            value={profile.full_name}
            onChangeText={(t) => setProfile((p) => ({ ...p, full_name: t }))}
            autoCapitalize="words"
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={profile.email}
            onChangeText={(t) => setProfile((p) => ({ ...p, email: t }))}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Mobile number"
            value={profile.mobile_number}
            onChangeText={(t) => setProfile((p) => ({ ...p, mobile_number: t }))}
            keyboardType="phone-pad"
          />
          <TouchableOpacity
            style={[styles.btn, updating && styles.btnDisabled]}
            onPress={updateProfile}
            disabled={updating}
          >
            <Text style={styles.btnText}>{updating ? 'Saving…' : 'Save profile'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change password</Text>
          <TextInput
            style={styles.input}
            placeholder="Current password"
            value={passwords.currentPassword}
            onChangeText={(t) => setPasswords((p) => ({ ...p, currentPassword: t }))}
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            placeholder="New password"
            value={passwords.newPassword}
            onChangeText={(t) => setPasswords((p) => ({ ...p, newPassword: t }))}
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm new password"
            value={passwords.confirmPassword}
            onChangeText={(t) => setPasswords((p) => ({ ...p, confirmPassword: t }))}
            secureTextEntry
          />
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary, changingPassword && styles.btnDisabled]}
            onPress={changePassword}
            disabled={changingPassword}
          >
            <Text style={styles.btnText}>{changingPassword ? 'Changing…' : 'Change password'}</Text>
          </TouchableOpacity>
        </View>

        {hasEmployee ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Face verification (account)</Text>
            <Text style={styles.helpText}>
              Enroll once here; the server checks a live photo when you clock in or out on any phone or tablet. This is
              separate from device Face ID in Settings.
            </Text>
            <TouchableOpacity
              style={[styles.btn, faceBusy && styles.btnDisabled]}
              onPress={enrollOrReplaceFace}
              disabled={faceBusy}
            >
              <Text style={styles.btnText}>{faceEnrolled ? 'Replace face photo' : 'Enroll face'}</Text>
            </TouchableOpacity>
            {faceEnrolled ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnDanger, faceBusy && styles.btnDisabled]}
                onPress={removeFaceEnrollment}
                disabled={faceBusy}
              >
                <Text style={styles.btnText}>Remove enrollment</Text>
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
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  btn: { backgroundColor: '#3b82f6', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#64748b' },
  btnDanger: { backgroundColor: '#b91c1c', marginTop: 10 },
  btnDisabled: { opacity: 0.7 },
  helpText: { fontSize: 14, color: '#64748b', marginBottom: 12, lineHeight: 20 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
