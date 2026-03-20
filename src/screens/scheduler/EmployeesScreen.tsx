import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api';

type Company = { id: string; name: string };
type Employee = { id: string; first_name?: string; last_name?: string; email?: string; company_id?: string; [k: string]: any };

export default function EmployeesScreen() {
  const { user, role } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', company_id: '' });
  const [saving, setSaving] = useState(false);

  const isManager = role === 'manager';
  const managerCompanyId = companies.find((c: any) => c.company_manager_id === user?.id)?.id || companies[0]?.id;
  const effectiveCompanyId = isManager ? managerCompanyId : selectedCompanyId === 'all' ? undefined : selectedCompanyId;

  const load = useCallback(async () => {
    try {
      const [compRaw, empRaw] = await Promise.all([
        api.getCompanies(role === 'manager' && user?.id ? { company_manager: user.id } : undefined),
        api.getEmployees(effectiveCompanyId ? { company: effectiveCompanyId } : undefined),
      ]);
      setCompanies(compRaw);
      setEmployees(empRaw);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [effectiveCompanyId, role, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = employees.filter((e) => {
    const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
    const email = (e.email || '').toLowerCase();
    const q = search.toLowerCase().trim();
    return !q || name.toLowerCase().includes(q) || email.includes(q);
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ first_name: '', last_name: '', email: '', company_id: effectiveCompanyId || companies[0]?.id || '' });
    setModalOpen(true);
  };
  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setForm({
      first_name: emp.first_name || '',
      last_name: emp.last_name || '',
      email: emp.email || '',
      company_id: emp.company_id || emp.company || '',
    });
    setModalOpen(true);
  };
  const save = async () => {
    const { first_name, last_name, email, company_id } = form;
    if (!first_name.trim() || !last_name.trim()) {
      Alert.alert('Validation', 'First and last name required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateEmployee(editing.id, { first_name: first_name.trim(), last_name: last_name.trim(), email: email.trim() || undefined, company_id: company_id || undefined });
        Alert.alert('Success', 'Employee updated');
      } else {
        await api.createEmployee({ first_name: first_name.trim(), last_name: last_name.trim(), email: email.trim() || undefined, company_id: company_id || undefined });
        Alert.alert('Success', 'Employee created');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };
  const deleteEmployee = (emp: Employee) => {
    Alert.alert('Delete', `Delete ${emp.first_name} ${emp.last_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteEmployee(emp.id);
            load();
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Failed to delete');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Employees</Text>
        {!isManager && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.companyTabs}>
            <TouchableOpacity
              style={[styles.tab, selectedCompanyId === 'all' && styles.tabActive]}
              onPress={() => setSelectedCompanyId('all')}
            >
              <Text style={[styles.tabText, selectedCompanyId === 'all' && styles.tabTextActive]}>All</Text>
            </TouchableOpacity>
            {companies.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.tab, selectedCompanyId === c.id && styles.tabActive]}
                onPress={() => setSelectedCompanyId(c.id)}
              >
                <Text style={[styles.tabText, selectedCompanyId === c.id && styles.tabTextActive]} numberOfLines={1}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        <TextInput
          style={styles.search}
          placeholder="Search by name or email"
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity style={styles.primaryButton} onPress={openCreate}>
          <Text style={styles.primaryButtonText}>+ Add employee</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No employees</Text></View>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.name}>{[item.first_name, item.last_name].filter(Boolean).join(' ') || '—'}</Text>
              {item.email ? <Text style={styles.email}>{item.email}</Text> : null}
            </View>
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => openEdit(item)}><Text style={styles.link}>Edit</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => deleteEmployee(item)}><Text style={styles.danger}>Delete</Text></TouchableOpacity>
            </View>
          </View>
        )}
      />
      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>{editing ? 'Edit employee' : 'Add employee'}</Text>
              <Text style={styles.label}>First name</Text>
              <TextInput style={styles.input} value={form.first_name} onChangeText={(t) => setForm((f) => ({ ...f, first_name: t }))} placeholder="First name" />
              <Text style={styles.label}>Last name</Text>
              <TextInput style={styles.input} value={form.last_name} onChangeText={(t) => setForm((f) => ({ ...f, last_name: t }))} placeholder="Last name" />
              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} value={form.email} onChangeText={(t) => setForm((f) => ({ ...f, email: t }))} placeholder="Email" keyboardType="email-address" />
              {!isManager && companies.length > 0 && (
                <>
                  <Text style={styles.label}>Company</Text>
                  <ScrollView horizontal style={styles.chipRow}>
                    {companies.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, form.company_id === c.id && styles.chipActive]}
                        onPress={() => setForm((f) => ({ ...f, company_id: c.id }))}
                      >
                        <Text style={styles.chipText} numberOfLines={1}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setModalOpen(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryButton, saving && styles.disabled]} onPress={save} disabled={saving}>
                  <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  companyTabs: { marginTop: 10, marginBottom: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9', marginRight: 8 },
  tabActive: { backgroundColor: '#3b82f6' },
  tabText: { fontSize: 14, color: '#64748b' },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  search: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 10, marginTop: 8, fontSize: 15 },
  primaryButton: { marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: '#3b82f6', alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '600' },
  listContent: { padding: 16, paddingBottom: 48 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: '#fff', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  cardBody: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  email: { fontSize: 13, color: '#64748b', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 12 },
  link: { color: '#3b82f6', fontSize: 14 },
  danger: { color: '#ef4444', fontSize: 14 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#64748b' },
  disabled: { opacity: 0.7 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' },
  modalScroll: { padding: 24 },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  label: { fontSize: 12, color: '#64748b', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 16 },
  chipRow: { marginBottom: 16, maxHeight: 44 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9', marginRight: 8 },
  chipActive: { backgroundColor: '#3b82f6' },
  chipText: { fontSize: 14, color: '#0f172a' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center' },
  cancelButtonText: { color: '#64748b', fontWeight: '600' },
});
