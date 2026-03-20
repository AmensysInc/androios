import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
  ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

export default function TemplateScreen() {
  const { user, role } = useAuth();
  const [templates, setTemplates] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; full_name: string | null; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assignModal, setAssignModal] = useState<{ templateId: string; templateName: string } | null>(null);
  const [assigning, setAssigning] = useState(false);

  const isAdmin = role === 'super_admin' || role === 'operations_manager' || role === 'manager';

  const loadTemplates = useCallback(async () => {
    try {
      const raw = await api.getTemplates();
      setTemplates(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    try {
      const raw = await api.getTemplateAssignments();
      setAssignments(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const loadTeamMembers = useCallback(async () => {
    if (!user || !isAdmin) return;
    try {
      if (role === 'super_admin') {
        const users = await api.getUsers();
        setTeamMembers(
          (users || []).map((u: any) => ({
            user_id: u.id,
            full_name: u.profile?.full_name || u.full_name || null,
            email: u.email || '',
          }))
        );
        return;
      }
      const companies = await api.getCompanies(
        role === 'operations_manager' && user?.id ? { organization_manager: user.id } : role === 'manager' && user?.id ? { company_manager: user.id } : undefined
      );
      const list = Array.isArray(companies) ? companies : [];
      const companyIds = list.map((c: any) => c?.id).filter(Boolean);
      const seen = new Set<string>();
      const members: { user_id: string; full_name: string | null; email: string }[] = [];
      for (const cid of companyIds) {
        const emps = await api.getEmployees({ company: cid, status: 'active' });
        (Array.isArray(emps) ? emps : []).forEach((emp: any) => {
          const uid = emp.user || emp.user_id;
          if (uid && !seen.has(uid)) {
            seen.add(uid);
            members.push({
              user_id: uid,
              full_name: `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || null,
              email: emp.email || '',
            });
          }
        });
      }
      setTeamMembers(members);
    } catch (e) {
      console.warn(e);
    }
  }, [user, role, isAdmin]);

  const load = useCallback(async () => {
    await Promise.all([loadTemplates(), loadAssignments(), loadTeamMembers()]);
    setLoading(false);
    setRefreshing(false);
  }, [loadTemplates, loadAssignments, loadTeamMembers]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const norm = (v: any) => (v != null ? String(v) : '');
  const assignedUserIds = (templateId: string) =>
    assignments
      .filter((a) => norm(a.template_id || a.template?.id || a.template) === norm(templateId))
      .map((a) => norm(a.user_id || a.user?.id || a.user));

  const unassignedMembers = assignModal
    ? teamMembers.filter((m) => !assignedUserIds(assignModal.templateId).includes(m.user_id))
    : [];

  const handleAssign = async (userId: string) => {
    if (!assignModal) return;
    setAssigning(true);
    try {
      await api.assignTemplate(assignModal.templateId, userId);
      await loadAssignments();
      setAssignModal(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to assign');
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = (templateId: string, userId: string) => {
    Alert.alert('Remove user', 'Remove this user from the template?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.unassignTemplate(templateId, userId);
            await loadAssignments();
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Failed to unassign');
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
        <Text style={styles.title}>Check List Templates</Text>
      </View>
      <FlatList
        data={templates}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No templates</Text>}
        renderItem={({ item }) => {
          const assigned = assignedUserIds(item.id);
          return (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.name || 'Template'}</Text>
              {item.description ? <Text style={styles.cardDesc}>{item.description}</Text> : null}
              <View style={styles.row}>
                <Text style={styles.meta}>Assigned: {assigned.length}</Text>
                {isAdmin && (
                  <TouchableOpacity style={styles.smallBtn} onPress={() => setAssignModal({ templateId: item.id, templateName: item.name || 'Template' })}>
                    <Text style={styles.smallBtnText}>+ Assign</Text>
                  </TouchableOpacity>
                )}
              </View>
              {assigned.length > 0 && (
                <ScrollView style={styles.chipList}>
                  {assigned.map((uid) => {
                    const m = teamMembers.find((t) => t.user_id === uid);
                    return (
                      <TouchableOpacity
                        key={uid}
                        style={styles.chip}
                        onPress={() => isAdmin && handleUnassign(item.id, uid)}
                      >
                        <Text style={styles.chipText}>{m ? (m.full_name || m.email) : uid}</Text>
                        {isAdmin && <Text style={styles.chipRemove}> ×</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          );
        }}
      />
      <Modal visible={!!assignModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAssignModal(null)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Assign to {assignModal?.templateName}</Text>
            <ScrollView style={styles.modalList}>
              {unassignedMembers.length === 0 ? (
                <Text style={styles.empty}>No users to assign</Text>
              ) : (
                unassignedMembers.map((m) => (
                  <TouchableOpacity
                    key={m.user_id}
                    style={styles.modalRow}
                    onPress={() => handleAssign(m.user_id)}
                    disabled={assigning}
                  >
                    <Text style={styles.modalRowText}>{m.full_name || m.email}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setAssignModal(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  listContent: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  cardDesc: { fontSize: 13, color: '#64748b', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  meta: { fontSize: 13, color: '#64748b' },
  smallBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  smallBtnText: { fontSize: 14, color: '#3b82f6', fontWeight: '600' },
  chipList: { marginTop: 8, maxHeight: 80 },
  chip: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: '#e2e8f0', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, marginRight: 6, marginBottom: 4 },
  chipText: { fontSize: 12, color: '#0f172a' },
  chipRemove: { color: '#64748b' },
  empty: { padding: 24, textAlign: 'center', color: '#64748b' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20, maxHeight: 400 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  modalList: { maxHeight: 240 },
  modalRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  modalRowText: { fontSize: 16, color: '#0f172a' },
  cancelBtn: { marginTop: 12, padding: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 16, color: '#64748b' },
});
