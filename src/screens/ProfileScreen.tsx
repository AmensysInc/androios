import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getRoleDisplayLabel } from '../types/auth';

export default function ProfileScreen() {
  const { user, role, signOut } = useAuth();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profile</Text>
      {user && (
        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user.email ?? '—'}</Text>
          {user.full_name && (
            <>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{user.full_name}</Text>
            </>
          )}
          {role && (
            <>
              <Text style={styles.label}>Role</Text>
              <Text style={styles.value}>{getRoleDisplayLabel(role)}</Text>
            </>
          )}
        </View>
      )}
      <TouchableOpacity style={styles.button} onPress={() => signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
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
