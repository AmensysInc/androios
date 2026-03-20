import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
  ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

function getRoleLabel(roles: any[]): string {
  if (!Array.isArray(roles)) return 'User';
  const r = roles.map((x: any) => x?.role || x).filter(Boolean);
  if (r.includes('super_admin')) return 'Super Admin';
  if (r.includes('operations_manager') || r.includes('organization_manager')) return 'Org Manager';
  if (r.includes('manager') || r.includes('company_manager')) return 'Manager';
  if (r.includes('admin')) return 'Admin';
  if (r.includes('employee') || r.includes('house_keeping') || r.includes('maintenance')) return 'Employee';
  return 'User';
}

export default function UserManagementScreen() {
  const { user } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [search, setSearch] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    email: '',
    username: '',
    full_name: '',
    password: '',
    role: 'employee' as string,
  });
  const [editForm, setEditForm] = useState({ full_name: '', email: '' });

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const userData = await api.getCurrentUser() as any;
      const roles = userData?.roles || [];
      const isAdmin = roles.some((r: any) => ['super_admin', 'admin'].includes(r?.role || r));
      if (!isAdmin) {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      let raw = await api.getUsers({}).catch(() => []);
      raw = Array.isArray(raw) ? raw : [];
      const list = raw
        .filter((u: any) => (u.profile?.status ?? u.status) !== 'deleted')
        .map((u: any) => ({
          id: u.id,
          user_id: u.id,
          email: u.email || u.profile?.email || '',
          full_name: u.profile?.full_name || u.full_name || '',
          roles: u.roles || [],
          roleLabel: getRoleLabel(u.roles || []),
        }));
      setUsers(list);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = users.filter(
    (u) =>
      !search.trim() ||
      (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.full_name || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    if (!form.email.trim()) {
      Alert.alert('Error', 'Email is required');
      return;
    }
    if (!form.password || form.password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    setSaving(true);
    try {
      const backendRole =
        form.role === 'operations_manager' ? 'organization_manager' : form.role === 'manager' ? 'company_manager' : 'employee';
      await api.createUser({
        email: form.email.trim(),
        username: (form.username || form.email).trim(),
        password: form.password,
        full_name: (form.full_name || form.email.split('@')[0]).trim(),
        role: backendRole,
      });
      setCreateModal(false);
      setForm({ email: '', username: '', full_name: '', password: '', role: 'employee' });
      await load();
      Alert.alert('Success', 'User created');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editModal) return;
    setSaving(true);
    try {
      await api.updateUser(editModal.user_id, {
        full_name: editForm.full_name.trim(),
        email: editForm.email.trim(),
      });
      setEditModal(null);
      await load();
      Alert.alert('Success', 'Profile updated');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (!authorized) {
    return (
      <View style={styles.centered}>
        <Text style={styles.unauthorized}>You don't have access to User Management.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>User Management</Text>
        <TextInput
          style={styles.search}
          placeholder="Search by name or email"
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#94a3b8"
        />
        <TouchableOpacity style={styles.addBtn} onPress={() => setCreateModal(true)}>
          <Text style={styles.addBtnText}>+ Add User</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.user_id || item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No users</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => {
              setEditModal(item);
              setEditForm({ full_name: item.full_name || '', email: item.email || '' });
            }}
          >
            <Text style={styles.cardTitle}>{item.full_name || item.email || '—'}</Text>
            <Text style={styles.cardSub}>{item.email}</Text>
            <Text style={styles.badge}>{item.roleLabel}</Text>
          </TouchableOpacity>
        )}
      />
      <Modal visible={createModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => !saving && setCreateModal(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add User</Text>
            <TextInput style={styles.input} placeholder="Email" value={form.email} onChangeText={(t) => setForm((f) => ({ ...f, email: t }))} placeholderTextColor="#94a3b8" />
            <TextInput style={styles.input} placeholder="Username (optional)" value={form.username} onChangeText={(t) => setForm((f) => ({ ...f, username: t }))} placeholderTextColor="#94a3b8" />
            <TextInput style={styles.input} placeholder="Full name" value={form.full_name} onChangeText={(t) => setForm((f) => ({ ...f, full_name: t }))} placeholderTextColor="#94a3b8" />
            <TextInput style={styles.input} placeholder="Password (min 6)" value={form.password} onChangeText={(t) => setForm((f) => ({ ...f, password: t }))} secureTextEntry placeholderTextColor="#94a3b8" />
            <View style={styles.roleRow}>
              {['employee', 'manager', 'operations_manager'].map((r) => (
                <TouchableOpacity key={r} style={[styles.roleChip, form.role === r && styles.roleChipActive]} onPress={() => setForm((f) => ({ ...f, role: r }))}>
                  <Text style={[styles.roleChipText, form.role === r && styles.roleChipTextActive]}>{r === 'operations_manager' ? 'Org Mgr' : r === 'manager' ? 'Manager' : 'Employee'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setCreateModal(false)} disabled={saving}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreate} disabled={saving}>
                <Text style={styles.saveBtnText}>{saving ? 'Creating…' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
      <Modal visible={!!editModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => !saving && setEditModal(null)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit User</Text>
            <TextInput style={styles.input} placeholder="Full name" value={editForm.full_name} onChangeText={(t) => setEditForm((f) => ({ ...f, full_name: t }))} placeholderTextColor="#94a3b8" />
            <TextInput style={styles.input} placeholder="Email" value={editForm.email} onChangeText={(t) => setEditForm((f) => ({ ...f, email: t }))} placeholderTextColor="#94a3b8" keyboardType="email-address" />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditModal(null)} disabled={saving}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleEdit} disabled={saving}>
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  unauthorized: { color: '#64748b', padding: 24, textAlign: 'center' },
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  search: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 10, marginTop: 10, fontSize: 14 },
  addBtn: { marginTop: 10, padding: 10, backgroundColor: '#3b82f6', borderRadius: 8, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '600' },
  listContent: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  cardSub: { fontSize: 13, color: '#64748b', marginTop: 4 },
  badge: { fontSize: 12, color: '#64748b', marginTop: 4 },
  empty: { padding: 24, textAlign: 'center', color: '#64748b' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16 },
  roleRow: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  roleChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#e2e8f0' },
  roleChipActive: { backgroundColor: '#3b82f6' },
  roleChipText: { fontSize: 14, color: '#64748b' },
  roleChipTextActive: { color: '#fff' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  cancelBtn: { padding: 12 },
  cancelBtnText: { fontSize: 16, color: '#64748b' },
  saveBtn: { paddingVertical: 12, paddingHorizontal: 20, backgroundColor: '#3b82f6', borderRadius: 8 },
  saveBtnText: { color: '#fff', fontWeight: '600' },
});
