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

type Organization = { id: string; name: string; [k: string]: any };
type Company = { id: string; name: string; organization_id?: string; company_manager_id?: string; [k: string]: any };

export default function CompaniesScreen() {
  const { user, role } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<'org' | 'company' | null>(null);
  const [editOrg, setEditOrg] = useState<Organization | null>(null);
  const [editCompany, setEditCompany] = useState<Company | null>(null);
  const [orgIdForCompany, setOrgIdForCompany] = useState('');
  const [formName, setFormName] = useState('');
  const [saving, setSaving] = useState(false);

  const isOrgManager = role === 'operations_manager' && user?.id;
  const canCreateOrg = role === 'super_admin';
  const canCreateCompany = role === 'super_admin' || role === 'operations_manager';
  const canEditCompany = role === 'super_admin' || role === 'operations_manager';

  const filteredCompanies = React.useMemo(() => {
    if (role === 'manager' && user?.id) {
      return companies.filter((c) => c.company_manager_id === user.id);
    }
    return companies;
  }, [companies, role, user?.id]);

  const filteredOrgs = React.useMemo(() => {
    if (role === 'manager' && filteredCompanies.length > 0) {
      const orgIds = new Set(filteredCompanies.map((c) => c.organization_id).filter(Boolean));
      return organizations.filter((o) => orgIds.has(o.id));
    }
    return organizations;
  }, [organizations, filteredCompanies, role]);

  const load = useCallback(async () => {
    try {
      const [orgsRaw, compRaw] = await Promise.all([
        api.getOrganizations(isOrgManager ? { operations_manager: user?.id } : undefined),
        api.getCompanies(isOrgManager ? { organization_manager: user?.id } : undefined),
      ]);
      setOrganizations(orgsRaw);
      setCompanies(compRaw);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOrgManager, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleCreateOrg = () => {
    setEditOrg(null);
    setFormName('');
    setModal('org');
  };
  const handleEditOrg = (org: Organization) => {
    setEditOrg(org);
    setFormName(org.name);
    setModal('org');
  };
  const saveOrg = async () => {
    const name = formName.trim();
    if (!name) {
      Alert.alert('Validation', 'Name is required');
      return;
    }
    setSaving(true);
    try {
      if (editOrg) {
        await api.updateOrganization(editOrg.id, { name });
        Alert.alert('Success', 'Organization updated');
      } else {
        await api.createOrganization({ name });
        Alert.alert('Success', 'Organization created');
      }
      setModal(null);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCompany = (organizationId?: string) => {
    setEditCompany(null);
    setFormName('');
    setOrgIdForCompany(organizationId || filteredOrgs[0]?.id || '');
    setModal('company');
  };
  const openEditCompany = (company: Company) => {
    setEditCompany(company);
    setFormName(company.name);
    setOrgIdForCompany(company.organization_id || '');
    setModal('company');
  };
  const saveCompany = async () => {
    const name = formName.trim();
    if (!name) {
      Alert.alert('Validation', 'Name is required');
      return;
    }
    if (!editCompany && !orgIdForCompany) {
      Alert.alert('Validation', 'Select an organization');
      return;
    }
    setSaving(true);
    try {
      if (editCompany) {
        await api.updateCompany(editCompany.id, { name, organization_id: orgIdForCompany });
        Alert.alert('Success', 'Company updated');
      } else {
        await api.createCompany({ name, organization_id: orgIdForCompany });
        Alert.alert('Success', 'Company created');
      }
      setModal(null);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save');
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

  if (isOrgManager) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Companies</Text>
          <Text style={styles.subtitle}>Your organization's companies</Text>
          {canCreateCompany && (
            <TouchableOpacity style={styles.primaryButton} onPress={() => handleCreateCompany()}>
              <Text style={styles.primaryButtonText}>+ New company</Text>
            </TouchableOpacity>
          )}
        </View>
        <FlatList
          data={filteredCompanies}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No companies yet</Text>
              {canCreateCompany && filteredOrgs[0]?.id && (
                <TouchableOpacity style={styles.primaryButton} onPress={() => handleCreateCompany(filteredOrgs[0].id)}>
                  <Text style={styles.primaryButtonText}>Create company</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              {canEditCompany && (
                <TouchableOpacity onPress={() => openEditCompany(item)}>
                  <Text style={styles.link}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
        <Modal visible={modal === 'company'} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>{editCompany ? 'Edit company' : 'New company'}</Text>
              {!editCompany && (
                <Text style={styles.label}>Organization</Text>
                <ScrollView horizontal style={styles.chipRow}>
                  {filteredOrgs.map((o) => (
                    <TouchableOpacity
                      key={o.id}
                      style={[styles.chip, orgIdForCompany === o.id && styles.chipActive]}
                      onPress={() => setOrgIdForCompany(o.id)}
                    >
                      <Text style={styles.chipText}>{o.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={formName}
                onChangeText={setFormName}
                placeholder="Company name"
              />
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setModal(null)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryButton, saving && styles.disabled]} onPress={saveCompany} disabled={saving}>
                  <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Organizations & Companies</Text>
        <Text style={styles.subtitle}>Manage organizations and companies</Text>
        {canCreateOrg && (
          <TouchableOpacity style={styles.primaryButton} onPress={handleCreateOrg}>
            <Text style={styles.primaryButtonText}>+ New organization</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={filteredOrgs}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No organizations yet</Text>
            {canCreateOrg && (
              <TouchableOpacity style={styles.primaryButton} onPress={handleCreateOrg}>
                <Text style={styles.primaryButtonText}>Create organization</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item: org }) => {
          const orgCompanies = filteredCompanies.filter((c) => c.organization_id === org.id);
          return (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{org.name}</Text>
                {canCreateCompany && (
                  <TouchableOpacity onPress={() => handleCreateCompany(org.id)}>
                    <Text style={styles.link}>+ Company</Text>
                  </TouchableOpacity>
                )}
                {canEditCompany && (
                  <TouchableOpacity onPress={() => handleEditOrg(org)}>
                    <Text style={styles.link}>Edit org</Text>
                  </TouchableOpacity>
                )}
              </View>
              {orgCompanies.length === 0 ? (
                <Text style={styles.muted}>No companies</Text>
              ) : (
                orgCompanies.map((c) => (
                  <View key={c.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    {canEditCompany && (
                      <TouchableOpacity onPress={() => openEditCompany(c)}>
                        <Text style={styles.link}>Edit</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </View>
          );
        }}
      />
      <Modal visible={modal === 'org'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{editOrg ? 'Edit organization' : 'New organization'}</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={formName} onChangeText={setFormName} placeholder="Organization name" />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setModal(null)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, saving && styles.disabled]} onPress={saveOrg} disabled={saving}>
                <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={modal === 'company'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{editCompany ? 'Edit company' : 'New company'}</Text>
            {!editCompany && (
              <>
                <Text style={styles.label}>Organization</Text>
                <ScrollView horizontal style={styles.chipRow}>
                  {filteredOrgs.map((o) => (
                    <TouchableOpacity
                      key={o.id}
                      style={[styles.chip, orgIdForCompany === o.id && styles.chipActive]}
                      onPress={() => setOrgIdForCompany(o.id)}
                    >
                      <Text style={styles.chipText}>{o.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={formName} onChangeText={setFormName} placeholder="Company name" />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setModal(null)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, saving && styles.disabled]} onPress={saveCompany} disabled={saving}>
                <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
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
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4 },
  primaryButton: { marginTop: 12, padding: 12, borderRadius: 8, backgroundColor: '#3b82f6', alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '600' },
  listContent: { padding: 16, paddingBottom: 48 },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a', flex: 1 },
  link: { color: '#3b82f6', fontSize: 14 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: '#fff', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 15, color: '#0f172a' },
  muted: { fontSize: 13, color: '#94a3b8', marginLeft: 14 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 15, color: '#64748b', marginBottom: 12 },
  disabled: { opacity: 0.7 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  label: { fontSize: 12, color: '#64748b', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 16 },
  chipRow: { marginBottom: 12, maxHeight: 44 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9', marginRight: 8 },
  chipActive: { backgroundColor: '#3b82f6' },
  chipText: { fontSize: 14, color: '#0f172a' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center' },
  cancelButtonText: { color: '#64748b', fontWeight: '600' },
});
