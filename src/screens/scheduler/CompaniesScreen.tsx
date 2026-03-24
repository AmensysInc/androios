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
  Pressable,
  Platform,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api';

type Organization = { id: string; name: string; [k: string]: any };
type Company = { id: string; name: string; organization_id?: string; company_manager_id?: string; [k: string]: any };

function companyOrganizationId(c: Company): string {
  const v = c.organization_id ?? (c as any).organization;
  return v != null ? String(v) : '';
}

/** Backend `POST /scheduler/companies/` expects `type` (e.g. IT, Hospitality). */
const COMPANY_TYPES = ['IT', 'General', 'Hospitality', 'Retail', 'Other'] as const;

type PickerOption = { id: string; label: string };

function normalizeHexColor(input: string | null | undefined, fallback = '#3b82f6'): string {
  const raw = String(input || '').trim();
  const s = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return fallback;
}

function normalizeRoleToken(r: any): string {
  if (r == null) return '';
  const s = typeof r === 'string' ? r : r?.role || r?.name || '';
  return String(s).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function getUserLabel(u: any): string {
  const full = u?.profile?.full_name ?? u?.full_name;
  const name = full && String(full).trim() ? String(full).trim() : '';
  if (name) return name;
  return u?.username ?? u?.email ?? 'User';
}

function userHasRole(u: any, roleToken: string): boolean {
  const roles = u?.roles ?? u?.role ?? u?.user_roles;
  const list = Array.isArray(roles) ? roles : roles != null ? [roles] : [];
  return list.some((r) => normalizeRoleToken(r) === roleToken);
}

function OptionPickerModal({
  visible,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.pickerOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>{title}</Text>
          <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {options.map((o) => {
              const isSel = selectedId != null && String(selectedId) === String(o.id);
              return (
                <TouchableOpacity
                  key={o.id}
                  style={[styles.pickerRow, isSel && styles.pickerRowSel]}
                  onPress={() => {
                    onSelect(o.id);
                    onClose();
                  }}
                >
                  <Text style={styles.pickerRowText}>{o.label}</Text>
                  {isSel ? <MaterialCommunityIcons name="check" size={20} color="#2563eb" /> : <View style={{ width: 20 }} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.pickerCancelBtn} onPress={onClose}>
            <Text style={styles.pickerCancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function ColorControl({
  value,
  fallback,
  onChange,
}: {
  value: string;
  fallback?: string;
  onChange: (v: string) => void;
}) {
  const safe = normalizeHexColor(value, fallback || '#3b82f6');
  return (
    <View style={styles.brandRow}>
      <View style={[styles.brandPreview, { backgroundColor: safe }]} />
      {Platform.OS === 'web'
        ? React.createElement('input', {
            type: 'color',
            value: safe,
            onChange: (e: any) => onChange(normalizeHexColor(e?.target?.value, fallback || '#3b82f6')),
            style: styles.webColorInput,
          })
        : null}
      <TextInput
        style={styles.brandInput}
        value={safe}
        onChangeText={(t) => onChange(normalizeHexColor(t, fallback || '#3b82f6'))}
        placeholder={fallback || '#3b82f6'}
        autoCapitalize="none"
      />
    </View>
  );
}

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
  const [formCompanyType, setFormCompanyType] = useState<string>('IT');
  const [saving, setSaving] = useState(false);
  const [collapsedOrgIds, setCollapsedOrgIds] = useState<Set<string>>(new Set());

  // Create organization/company form state (UI-only; payload stays minimal for safety)
  const [brandColor, setBrandColor] = useState('#3b82f6');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [managerId, setManagerId] = useState<string | null>(null);
  const [managerOptions, setManagerOptions] = useState<PickerOption[]>([]);

  const [companyOrgPicker, setCompanyOrgPicker] = useState(false);
  const [companyTypePicker, setCompanyTypePicker] = useState(false);
  const [managerPicker, setManagerPicker] = useState(false);
  const [companyMenuForId, setCompanyMenuForId] = useState<string | null>(null);
  const [companyDetails, setCompanyDetails] = useState<Company | null>(null);
  const [assignManagerCompany, setAssignManagerCompany] = useState<Company | null>(null);
  const [managerByCompany, setManagerByCompany] = useState<Record<string, string>>({});

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
      const orgIds = new Set(filteredCompanies.map((c) => companyOrganizationId(c)).filter(Boolean));
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

  const toggleOrgCollapsed = (id: string) => {
    setCollapsedOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadManagers = async (roleToken: string) => {
    try {
      const raw = await api.getUsers({}).catch(() => []);
      const list = Array.isArray(raw) ? raw : [];
      const options: PickerOption[] = list
        .filter((u) => userHasRole(u, roleToken))
        .map((u: any) => ({
          id: String(u?.id ?? u?.pk ?? u?.uuid ?? ''),
          label: getUserLabel(u),
        }))
        .filter((o) => o.id !== '');
      setManagerOptions(options);
    } catch {
      setManagerOptions([]);
    }
  };

  const handleCreateOrg = () => {
    setEditOrg(null);
    setFormName('');
    setBrandColor('#6366f1');
    setAddress('');
    setPhone('');
    setEmail('');
    setManagerId(null);
    setManagerOptions([]);
    setModal('org');
    void loadManagers('organization_manager');
  };
  const handleEditOrg = (org: Organization) => {
    setEditOrg(org);
    setFormName(org.name);
    setBrandColor(normalizeHexColor((org as any).brand_color ?? (org as any).color, '#6366f1'));
    setAddress(String((org as any).address ?? '') || '');
    setPhone(String((org as any).phone ?? '') || '');
    setEmail(String((org as any).email ?? '') || '');
    setManagerId((org as any).organization_manager_id ? String((org as any).organization_manager_id) : null);
    void loadManagers('organization_manager');
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
      const minimalCreate = { name };
      const minimalUpdate = { name };
      const richPayload: Record<string, any> = {
        name,
        brand_color: brandColor?.trim() || undefined,
        color: brandColor?.trim() || undefined,
        address: address?.trim() || undefined,
        phone: phone?.trim() || undefined,
        email: email?.trim() || undefined,
      };
      if (managerId) {
        richPayload.organization_manager = managerId;
        richPayload.organization_manager_id = managerId;
      }
      if (editOrg) {
        try {
          await api.updateOrganization(editOrg.id, richPayload);
        } catch {
          await api.updateOrganization(editOrg.id, minimalUpdate);
        }
        Alert.alert('Success', 'Organization updated');
      } else {
        try {
          await api.createOrganization(richPayload);
        } catch {
          await api.createOrganization(minimalCreate);
        }
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

  const deleteOrg = async () => {
    if (!editOrg?.id) return;
    if (typeof (globalThis as any).confirm === 'function') {
      const ok = (globalThis as any).confirm(`Delete organization "${editOrg.name}"?`);
      if (!ok) return;
    }
    setSaving(true);
    try {
      await api.deleteOrganization(editOrg.id);
      setModal(null);
      setEditOrg(null);
      await load();
      Alert.alert('Success', 'Organization deleted');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to delete organization');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCompany = (organizationId?: string) => {
    setEditCompany(null);
    setFormName('');
    setFormCompanyType('IT');
    setOrgIdForCompany(organizationId || filteredOrgs[0]?.id || '');
    setBrandColor('#3b82f6');
    setAddress('');
    setPhone('');
    setEmail('');
    setManagerId(null);
    setManagerOptions([]);
    setModal('company');
    void loadManagers('company_manager');
  };
  const openEditCompany = (company: Company) => {
    setEditCompany(company);
    setFormName(company.name);
    setOrgIdForCompany(companyOrganizationId(company));
    setFormCompanyType(String((company as any).type || 'IT').trim() || 'IT');
    setBrandColor(normalizeHexColor((company as any).brand_color ?? (company as any).color, '#3b82f6'));
    setAddress(String((company as any).address ?? '') || '');
    setPhone(String((company as any).phone ?? '') || '');
    setEmail(String((company as any).email ?? '') || '');
    setManagerId(company.company_manager_id ? String(company.company_manager_id) : null);
    void loadManagers('company_manager');
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
      const minimalCreate = {
        name,
        organization_id: orgIdForCompany.trim(),
        type: formCompanyType.trim(),
      };
      const minimalUpdate = {
        name,
        organization_id: orgIdForCompany.trim(),
        type: formCompanyType.trim(),
      };
      const richPayload: Record<string, any> = {
        name,
        organization_id: orgIdForCompany.trim(),
        type: formCompanyType.trim(),
        brand_color: brandColor?.trim() || undefined,
        color: brandColor?.trim() || undefined,
        address: address?.trim() || undefined,
        phone: phone?.trim() || undefined,
        email: email?.trim() || undefined,
      };
      if (managerId) {
        richPayload.company_manager = managerId;
        richPayload.company_manager_id = managerId;
      }
      if (editCompany) {
        try {
          await api.updateCompany(editCompany.id, richPayload);
        } catch {
          await api.updateCompany(editCompany.id, minimalUpdate);
        }
        Alert.alert('Success', 'Company updated');
      } else {
        try {
          await api.createCompany(richPayload);
        } catch {
          await api.createCompany(minimalCreate);
        }
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

  const deleteCompany = async () => {
    if (!editCompany?.id) return;
    if (typeof (globalThis as any).confirm === 'function') {
      const ok = (globalThis as any).confirm(`Delete company "${editCompany.name}"?`);
      if (!ok) return;
    }
    setSaving(true);
    try {
      await api.deleteCompany(editCompany.id);
      setModal(null);
      setEditCompany(null);
      await load();
      Alert.alert('Success', 'Company deleted');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to delete company');
    } finally {
      setSaving(false);
    }
  };

  const assignManager = () => {
    if (!assignManagerCompany) return;
    const label = managerId ? managerOptions.find((o) => o.id === managerId)?.label || '' : '';
    setManagerByCompany((prev) => ({ ...prev, [assignManagerCompany.id]: label || 'No company manager' }));
    setAssignManagerCompany(null);
    Alert.alert('Saved', 'Manager assignment updated in UI.');
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
              <View style={styles.modalHeaderRow}>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>{editCompany ? 'Edit company' : 'Create New Company'}</Text>
                <TouchableOpacity onPress={() => setModal(null)} hitSlop={12} style={styles.modalCloseBtn} disabled={saving}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                </TouchableOpacity>
              </View>

              {!editCompany ? (
                <>
                  <Text style={styles.label}>Company Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={formName}
                    onChangeText={setFormName}
                    placeholder="Enter company name"
                  />

                  <Text style={styles.label}>Organization (Business Type) *</Text>
                  <TouchableOpacity style={styles.selectField} onPress={() => setCompanyOrgPicker(true)} disabled={filteredOrgs.length === 0}>
                    <Text style={[styles.selectFieldText, !orgIdForCompany && styles.selectPlaceholder]} numberOfLines={1}>
                      {orgIdForCompany ? filteredOrgs.find((o) => o.id === orgIdForCompany)?.name : 'Select organization'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>

                  <Text style={styles.label}>Brand Color</Text>
                  <ColorControl value={brandColor} fallback="#3b82f6" onChange={setBrandColor} />

                  <Text style={styles.label}>Address</Text>
                  <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Enter company address" />

                  <View style={styles.twoColRow}>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={[styles.input, styles.inputNoMargin]}
                        value={phone}
                        onChangeText={setPhone}
                        placeholder="(555) 123-4567"
                        keyboardType="phone-pad"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={[styles.input, styles.inputNoMargin]}
                        value={email}
                        onChangeText={setEmail}
                        placeholder="contact@company.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>
                  </View>

                  <Text style={styles.label}>Company Manager</Text>
                  <TouchableOpacity style={styles.selectField} onPress={() => setManagerPicker(true)}>
                    <Text style={[styles.selectFieldText, !managerId && styles.selectPlaceholder]} numberOfLines={1}>
                      {managerId ? managerOptions.find((o) => o.id === managerId)?.label : 'Select company manager'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Type</Text>
                  <ScrollView horizontal style={styles.chipRow} showsHorizontalScrollIndicator={false}>
                    {COMPANY_TYPES.map((t) => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.chip, formCompanyType === t && styles.chipActive]}
                        onPress={() => setFormCompanyType(t)}
                      >
                        <Text style={[styles.chipText, formCompanyType === t && styles.chipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={styles.label}>Name</Text>
                  <TextInput style={styles.input} value={formName} onChangeText={setFormName} placeholder="Company name" />
                </>
              )}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setModal(null)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalPrimaryButton, saving && styles.disabled]} onPress={saveCompany} disabled={saving}>
                  <Text style={styles.primaryButtonText}>
                    {saving ? 'Saving…' : editCompany ? 'Save' : 'Create Company'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <OptionPickerModal
          visible={companyOrgPicker}
          title="Organization (Business Type)"
          options={filteredOrgs.map((o) => ({ id: o.id, label: o.name }))}
          selectedId={orgIdForCompany}
          onSelect={(id) => setOrgIdForCompany(id)}
          onClose={() => setCompanyOrgPicker(false)}
        />
        <OptionPickerModal
          visible={managerPicker}
          title="Company Manager"
          options={managerOptions}
          selectedId={managerId ?? undefined}
          onSelect={(id) => setManagerId(id)}
          onClose={() => setManagerPicker(false)}
        />
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
          const orgCompanies = filteredCompanies.filter((c) => companyOrganizationId(c) === org.id);
          const isCollapsed = collapsedOrgIds.has(org.id);
          return (
            <View style={styles.section}>
              <View style={styles.orgCard}>
                <View style={styles.orgHeader}>
                  <View style={styles.orgTitleWrap}>
                    <View style={styles.orgIconBubble}>
                      <MaterialCommunityIcons name="office-building-outline" size={20} color="#2563eb" />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.sectionTitle}>{org.name}</Text>
                      <Text style={styles.orgSub}>{orgCompanies.length} compan{orgCompanies.length === 1 ? 'y' : 'ies'}</Text>
                    </View>
                  </View>
                  <View style={styles.orgHeaderActions}>
                    {canEditCompany && (
                      <TouchableOpacity style={styles.orgActionBtn} onPress={() => handleEditOrg(org)}>
                        <MaterialCommunityIcons name="cog-outline" size={16} color="#0f172a" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.orgActionBtn} onPress={() => toggleOrgCollapsed(org.id)}>
                      <MaterialCommunityIcons
                        name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                        size={18}
                        color="#0f172a"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                {!isCollapsed && (
                  <View style={styles.companyGrid}>
                    {orgCompanies.map((c) => (
                      <View key={c.id} style={styles.companyCard}>
                        <View style={styles.companyTitleRow}>
                          <View style={styles.companyIconBubble}>
                            <MaterialCommunityIcons name="domain" size={16} color="#2563eb" />
                          </View>
                          <Text style={styles.cardTitle} numberOfLines={1}>
                            {c.name}
                          </Text>
                        </View>
                        <Text style={styles.companyTypeText}>{String((c as any).type || 'general').toLowerCase()}</Text>
                        {canEditCompany && (
                          <TouchableOpacity style={styles.companyEditBtn} onPress={() => setCompanyMenuForId(c.id)}>
                            <MaterialCommunityIcons name="cog-outline" size={15} color="#0f172a" />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    {canCreateCompany && (
                      <TouchableOpacity style={styles.addCompanyGhost} onPress={() => handleCreateCompany(org.id)}>
                        <MaterialCommunityIcons name="plus" size={28} color="#64748b" />
                        <Text style={styles.addCompanyGhostText}>Add Company</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />
      <Modal visible={modal === 'org'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { marginBottom: 0 }]}>{editOrg ? 'Edit organization' : 'Create New Organization'}</Text>
              <TouchableOpacity onPress={() => setModal(null)} hitSlop={12} style={styles.modalCloseBtn} disabled={saving}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {editOrg ? (
              <>
                <Text style={styles.label}>Organization Name *</Text>
                <TextInput style={styles.input} value={formName} onChangeText={setFormName} placeholder="Enter organization name" />
                <Text style={styles.label}>Brand Color</Text>
                <ColorControl value={brandColor} fallback="#6366f1" onChange={setBrandColor} />
                <Text style={styles.label}>Address</Text>
                <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Enter organization address" />
                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="(555) 123-4567"
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="contact@organization.com"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>
                <Text style={styles.label}>Organization Manager</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setManagerPicker(true)}>
                  <Text style={[styles.selectFieldText, !managerId && styles.selectPlaceholder]}>
                    {managerId ? managerOptions.find((o) => o.id === managerId)?.label : 'Select organization manager'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>
                <Text style={styles.helperText}>
                  The organization manager has super admin access to all companies within this organization.
                </Text>
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.deleteButton} onPress={() => void deleteOrg()} disabled={saving}>
                    <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalCancelButton} onPress={() => setModal(null)}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalPrimaryButton, saving && styles.disabled]} onPress={saveOrg} disabled={saving}>
                    <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Update Organization'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.label}>Organization Name *</Text>
                <TextInput style={styles.input} value={formName} onChangeText={setFormName} placeholder="Enter organization name" />

                <Text style={styles.label}>Brand Color</Text>
                <ColorControl value={brandColor} fallback="#3b82f6" onChange={setBrandColor} />

                <Text style={styles.label}>Address</Text>
                <TextInput
                  style={styles.input}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Enter organization address"
                />

                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="(555) 123-4567"
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="contact@organization.com"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <Text style={styles.label}>Organization Manager</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setManagerPicker(true)}>
                  <Text style={[styles.selectFieldText, !managerId && styles.selectPlaceholder]}>
                    {managerId ? managerOptions.find((o) => o.id === managerId)?.label : 'Select organization manager'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>

                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancelButton} onPress={() => setModal(null)}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalPrimaryButton, saving && styles.disabled]} onPress={saveOrg} disabled={saving}>
                    <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Create Organization'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
      <Modal visible={modal === 'company'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { marginBottom: 0 }]}>{editCompany ? 'Edit company' : 'Create New Company'}</Text>
              <TouchableOpacity onPress={() => setModal(null)} hitSlop={12} style={styles.modalCloseBtn} disabled={saving}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>
            {!editCompany ? (
              <>
                <Text style={styles.label}>Company Name *</Text>
                <TextInput style={styles.input} value={formName} onChangeText={setFormName} placeholder="Enter company name" />

                <Text style={styles.label}>Organization (Business Type) *</Text>
                <TouchableOpacity
                  style={styles.selectField}
                  onPress={() => setCompanyOrgPicker(true)}
                  disabled={filteredOrgs.length === 0}
                >
                  <Text style={[styles.selectFieldText, !orgIdForCompany && styles.selectPlaceholder]} numberOfLines={1}>
                    {orgIdForCompany
                      ? filteredOrgs.find((o) => o.id === orgIdForCompany)?.name
                      : 'Select organization'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>

                <Text style={styles.label}>Brand Color</Text>
                <ColorControl value={brandColor} fallback="#3b82f6" onChange={setBrandColor} />

                <Text style={styles.label}>Address</Text>
                <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Enter company address" />

                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.labelInline}>Phone</Text>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="(555) 123-4567"
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.labelInline}>Email</Text>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="contact@company.com"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <Text style={styles.label}>Company Manager</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setManagerPicker(true)}>
                  <Text style={[styles.selectFieldText, !managerId && styles.selectPlaceholder]} numberOfLines={1}>
                    {managerId ? managerOptions.find((o) => o.id === managerId)?.label : 'Select company manager'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>Company Name *</Text>
                <TextInput style={styles.input} value={formName} onChangeText={setFormName} placeholder="Enter company name" />

                <Text style={styles.label}>Business Type *</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setCompanyTypePicker(true)}>
                  <Text style={[styles.selectFieldText, !formCompanyType && styles.selectPlaceholder]} numberOfLines={1}>
                    {formCompanyType || 'Select type'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>

                <Text style={styles.label}>Brand Color</Text>
                <View style={styles.colorSwatchRow}>
                  {['#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#f97316'].map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.colorSwatch, { backgroundColor: c }, brandColor === c && styles.colorSwatchActive]}
                      onPress={() => setBrandColor(c)}
                    />
                  ))}
                </View>

                <Text style={styles.label}>Address</Text>
                <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Enter company address" />

                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="(555) 123-4567"
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="Enter company email"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>
              </>
            )}
            <View style={styles.modalActions}>
              {editCompany ? (
                <TouchableOpacity style={styles.deleteButton} onPress={() => void deleteCompany()} disabled={saving}>
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              ) : null}
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setModal(null)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
                <TouchableOpacity style={[styles.modalPrimaryButton, saving && styles.disabled]} onPress={saveCompany} disabled={saving}>
                <Text style={styles.primaryButtonText}>
                  {saving ? 'Saving…' : editCompany ? 'Update Company' : 'Create Company'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={!!companyMenuForId} transparent animationType="fade" onRequestClose={() => setCompanyMenuForId(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCompanyMenuForId(null)}>
          <Pressable style={styles.companyMenuSheet} onPress={(e) => e.stopPropagation()}>
            <TouchableOpacity
              style={styles.companyMenuItem}
              onPress={() => {
                const c = filteredCompanies.find((x) => x.id === companyMenuForId);
                setCompanyMenuForId(null);
                if (c) setCompanyDetails(c);
              }}
            >
              <MaterialCommunityIcons name="eye-outline" size={18} color="#0f172a" />
              <Text style={styles.companyMenuText}>View Details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.companyMenuItem}
              onPress={() => {
                const c = filteredCompanies.find((x) => x.id === companyMenuForId);
                setCompanyMenuForId(null);
                if (c) openEditCompany(c);
              }}
            >
              <MaterialCommunityIcons name="square-edit-outline" size={18} color="#0f172a" />
              <Text style={styles.companyMenuText}>Edit Company</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.companyMenuItem}
              onPress={() => {
                const c = filteredCompanies.find((x) => x.id === companyMenuForId);
                setCompanyMenuForId(null);
                if (c) {
                  setAssignManagerCompany(c);
                  void loadManagers('company_manager');
                }
              }}
            >
              <MaterialCommunityIcons name="account-tie-outline" size={18} color="#0f172a" />
              <Text style={styles.companyMenuText}>Assign Managers</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={!!assignManagerCompany} transparent animationType="fade" onRequestClose={() => setAssignManagerCompany(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setAssignManagerCompany(null)}>
          <Pressable style={styles.assignManagerBox} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { marginBottom: 0 }]}>
                Assign Manager - {assignManagerCompany?.name || ''}
              </Text>
              <TouchableOpacity onPress={() => setAssignManagerCompany(null)} hitSlop={12} style={styles.modalCloseBtn}>
                <MaterialCommunityIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Company Manager</Text>
            <TouchableOpacity style={styles.selectField} onPress={() => setManagerPicker(true)}>
              <Text style={[styles.selectFieldText, !managerId && styles.selectPlaceholder]}>
                {managerId ? managerOptions.find((o) => o.id === managerId)?.label : 'No company manager'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>
            <Text style={styles.helperText}>
              The company manager will have full admin access to all operations within this company.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setAssignManagerCompany(null)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalPrimaryButton} onPress={assignManager}>
                <Text style={styles.primaryButtonText}>Assign Manager</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={!!companyDetails} transparent animationType="fade" onRequestClose={() => setCompanyDetails(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCompanyDetails(null)}>
          <Pressable style={styles.companyDetailsBox} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.companyDetailsHead}>
                <View style={styles.companyIconBubble}>
                  <MaterialCommunityIcons name="office-building-outline" size={18} color="#2563eb" />
                </View>
                <View>
                  <Text style={styles.companyDetailsTitle}>{companyDetails?.name || 'Company'}</Text>
                  <Text style={styles.companyTypeText}>{String((companyDetails as any)?.type || 'car_wash').toLowerCase()}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setCompanyDetails(null)} hitSlop={12} style={styles.modalCloseBtn}>
                <MaterialCommunityIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <View style={styles.companyDetailsActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setAssignManagerCompany(companyDetails);
                  setCompanyDetails(null);
                }}
              >
                <Text style={styles.cancelButtonText}>Assign existing user</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalPrimaryButton}>
                <Text style={styles.primaryButtonText}>Add new employee</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.companyDetailsGrid}>
              <View style={styles.detailsCard}><Text style={styles.detailsCardTitle}>Company Details</Text></View>
              <View style={styles.detailsCard}>
                <Text style={styles.detailsCardTitle}>Manager</Text>
                <Text style={styles.emptyText}>{managerByCompany[companyDetails?.id || ''] || 'No manager assigned'}</Text>
              </View>
            </View>
            <View style={styles.detailsEmployeesCard}>
              <Text style={styles.detailsCardTitle}>Assigned Employees (0)</Text>
              <Text style={styles.emptyText}>No employees added yet</Text>
              <TouchableOpacity style={[styles.modalCancelButton, { marginTop: 12 }]}>
                <Text style={styles.cancelButtonText}>Add First Employee</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <OptionPickerModal
        visible={companyOrgPicker}
        title="Organization (Business Type)"
        options={filteredOrgs.map((o) => ({ id: o.id, label: o.name }))}
        selectedId={orgIdForCompany}
        onSelect={(id) => setOrgIdForCompany(id)}
        onClose={() => setCompanyOrgPicker(false)}
      />
      <OptionPickerModal
        visible={companyTypePicker}
        title="Business Type"
        options={COMPANY_TYPES.map((t) => ({ id: t, label: t }))}
        selectedId={formCompanyType}
        onSelect={(id) => setFormCompanyType(id)}
        onClose={() => setCompanyTypePicker(false)}
      />
      <OptionPickerModal
        visible={managerPicker}
        title={modal === 'org' ? 'Organization Manager' : 'Company Manager'}
        options={managerOptions}
        selectedId={managerId ?? undefined}
        onSelect={(id) => setManagerId(id)}
        onClose={() => setManagerPicker(false)}
      />
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
  modalPrimaryButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#3b82f6', alignItems: 'center' },
  modalCancelButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a', flex: 1 },
  link: { color: '#3b82f6', fontSize: 14 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: '#fff', borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 15, color: '#0f172a' },
  muted: { fontSize: 13, color: '#94a3b8', marginLeft: 14 },
  orgCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
  },
  orgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  orgTitleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 10 },
  orgIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  orgHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orgActionBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  companyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  companyCard: {
    width: '48.5%',
    minHeight: 76,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#fff',
    padding: 10,
    position: 'relative',
  },
  companyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  companyIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyTypeText: { fontSize: 12, color: '#64748b', marginTop: 6, marginLeft: 36 },
  companyEditBtn: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  addCompanyGhost: {
    width: '48.5%',
    minHeight: 76,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    gap: 4,
  },
  addCompanyGhostText: { fontSize: 14, color: '#475569', fontWeight: '500' },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 15, color: '#64748b', marginBottom: 12 },
  disabled: { opacity: 0.7 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' },
  modalCloseBtn: { padding: 4 },
  label: { fontSize: 12, color: '#64748b', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 16 },
  inputNoMargin: { marginBottom: 0 },
  chipRow: { marginBottom: 12, maxHeight: 44 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9', marginRight: 8 },
  chipActive: { backgroundColor: '#3b82f6' },
  chipText: { fontSize: 14, color: '#0f172a' },
  chipTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center' },
  cancelButtonText: { color: '#64748b', fontWeight: '600' },

  // Shared modal form elements (match screenshot create dialogs)
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    marginBottom: 16,
  },
  selectFieldText: { fontSize: 16, color: '#0f172a', flex: 1, minWidth: 0, marginRight: 10 },
  selectPlaceholder: { color: '#94a3b8' },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  brandPreview: { width: 36, height: 28, borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  webColorInput: {
    width: 36,
    height: 28,
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
  } as any,
  brandInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
    marginBottom: 0,
  },

  twoColRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  labelInline: { fontSize: 12, color: '#64748b', marginBottom: 6 },

  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  pickerSheet: {
    backgroundColor: '#fff',
    borderRadius: 14,
    maxHeight: '70%',
    paddingVertical: 8,
  },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', paddingHorizontal: 16, paddingBottom: 8 },
  pickerScroll: { maxHeight: 320 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pickerRowSel: { backgroundColor: 'rgba(59,130,246,0.08)' },
  pickerRowText: { flex: 1, fontSize: 16, color: '#0f172a', marginRight: 8 },
  pickerCancelBtn: { padding: 16, alignItems: 'center' },
  pickerCancelBtnText: { fontSize: 16, color: '#64748b', fontWeight: '600' },

  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    minWidth: 92,
  },
  deleteButtonText: { color: '#fff', fontWeight: '700' },
  helperText: { fontSize: 12, color: '#64748b', marginTop: -6, marginBottom: 10, lineHeight: 18 },
  colorSwatchRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  colorSwatch: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)' },
  colorSwatchActive: { borderWidth: 2, borderColor: '#0f172a' },

  companyMenuSheet: {
    alignSelf: 'center',
    width: 220,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  companyMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  companyMenuText: { fontSize: 14, color: '#0f172a' },

  assignManagerBox: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
  },

  companyDetailsBox: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 920,
    maxHeight: '86%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  companyDetailsHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  companyDetailsTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  companyDetailsActions: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 12 },
  companyDetailsGrid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  detailsCard: {
    flex: 1,
    minHeight: 140,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsEmployeesCard: {
    minHeight: 180,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsCardTitle: { alignSelf: 'flex-start', fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
});
