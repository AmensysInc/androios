import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  Pressable,
  FlatList,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const KeyedView = View as React.ComponentType<React.ComponentProps<typeof View> & { key?: React.Key }>;
import { useAuth } from '../../context/AuthContext';
import { localizedEmployeeStatus } from '../../lib/i18nLabels';
import * as api from '../../api';
import {
  buildDepartmentFilterOptions,
  employeeMatchesDepartmentFilter,
  departmentPrimaryId,
  departmentNameFromCatalog,
  isLikelyUuid,
} from '../../lib/departmentEmployeeMatch';

type Company = { id: string; name: string; company_manager_id?: string; [k: string]: any };
type Employee = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  company_id?: string;
  department_id?: string;
  department?: string | { id?: string; name?: string };
  position?: string;
  job_title?: string;
  title?: string;
  hourly_rate?: string | number;
  rate?: string | number;
  status?: string;
  employment_status?: string;
  nickname?: string;
  preferred_name?: string;
  [k: string]: any;
};

function employeeDisplayName(e: Employee): string {
  const fn = (e.first_name || '').trim();
  const ln = (e.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return e.email || '—';
}

function employeeInitials(e: Employee): string {
  const fn = (e.first_name || '').trim();
  const ln = (e.last_name || '').trim();
  if (fn && ln) return `${fn[0]}${ln[0]}`.toUpperCase();
  if (fn) return fn.slice(0, 2).toUpperCase();
  return (e.email || '?').slice(0, 2).toUpperCase();
}

function employeeSubtitle(e: Employee): string {
  const nick = (e.nickname || e.preferred_name || '').trim();
  if (nick) return nick;
  return '—';
}

function departmentLabel(e: Employee, deptCatalog: any[], t: TFunction): string {
  const d = e.department;
  if (d && typeof d === 'object' && (d as any).name) return String((d as any).name);
  const primary = departmentPrimaryId(e);
  if (primary) {
    const hit = departmentNameFromCatalog(deptCatalog, primary);
    if (hit) return hit;
  }
  const dn = (e as any).department_name;
  if (dn != null && String(dn).trim() !== '') {
    const s = String(dn).trim();
    const hit = departmentNameFromCatalog(deptCatalog, s);
    if (hit) return hit;
    if (!isLikelyUuid(s)) return s;
  }
  if (typeof d === 'string' && d.trim()) {
    const hit = departmentNameFromCatalog(deptCatalog, d);
    if (hit) return hit;
    if (!isLikelyUuid(d)) return d;
  }
  return t('employee.noDepartment');
}

function departmentKey(e: Employee, deptCatalog: any[], t: TFunction): string {
  let id: string | number | undefined = e.department_id;
  if ((id == null || id === '') && typeof e.department === 'object' && e.department?.id != null) {
    id = e.department.id;
  }
  if (id != null && id !== '') return String(id);
  const dn = (e as any).department_name;
  if (dn) return `name:${String(dn)}`;
  if (departmentLabel(e, deptCatalog, t) === t('employee.noDepartment')) return '__none__';
  return `name:${departmentLabel(e, deptCatalog, t)}`;
}

function positionLabel(e: Employee, t: TFunction): string {
  const p = e.position || e.job_title || e.title || (e as any).role;
  if (p && String(p).toLowerCase() !== 'employee') return String(p);
  return t('employee.noPosition');
}

function hourlyLabel(e: Employee, t: TFunction): string {
  const r = e.hourly_rate ?? e.rate ?? (e as any).pay_rate;
  if (r == null || r === '') return t('employee.notSet');
  const n = typeof r === 'number' ? r : parseFloat(String(r));
  if (Number.isFinite(n)) return `$${n.toFixed(2)}`;
  return String(r);
}

function statusLabel(e: Employee): string {
  const s = (e.status || e.employment_status || 'active').toString().toLowerCase();
  return s || 'active';
}

function isActiveEmployee(e: Employee): boolean {
  const s = statusLabel(e);
  return s === 'active' || s === 'employed' || s === 'enabled';
}

type PickerModalProps = {
  visible: boolean;
  title: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
  onClose: () => void;
};

function PickerModal({ visible, title, options, onSelect, onClose }: PickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.pickerBox}>
          <Text style={styles.pickerTitle}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={styles.pickerRowText}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const COL = {
  employee: 200,
  contact: 210,
  department: 128,
  rate: 96,
  status: 92,
  actions: 52,
};

export default function EmployeesScreen() {
  const { t } = useTranslation();
  const { user, role } = useAuth();
  const { width } = useWindowDimensions();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [scopeModal, setScopeModal] = useState(false);
  const [deptModal, setDeptModal] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuEmployee, setMenuEmployee] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    hire_date: '',
    department_id: '',
    position: '',
    hourly_rate: '',
    status: 'active',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    notes: '',
    company_id: '',
  });
  const [saving, setSaving] = useState(false);

  const isManager = role === 'company_manager';
  const scopedCompanies = api.filterCompaniesForCompanyManagerRole(companies, role, user?.id);
  const managerCompanyId = isManager
    ? scopedCompanies[0]?.id ?? companies[0]?.id
    : undefined;
  const effectiveCompanyId = isManager ? managerCompanyId : selectedCompanyId === 'all' ? undefined : selectedCompanyId;

  const load = useCallback(async () => {
    try {
      const compPromise = api.getCompanies();
      const empPromise = api.getEmployees(effectiveCompanyId ? { company: effectiveCompanyId } : undefined);
      const deptPromise = api.getDepartments(
        effectiveCompanyId ? { company: effectiveCompanyId } : undefined
      );
      const [compRaw, empRaw, deptRaw] = await Promise.all([compPromise, empPromise, deptPromise]);
      setCompanies(Array.isArray(compRaw) ? compRaw : []);
      setEmployees(Array.isArray(empRaw) ? empRaw : []);
      setDepartments(Array.isArray(deptRaw) ? deptRaw : []);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('employee.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [effectiveCompanyId, role, user?.id, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setDepartmentFilter('all');
  }, [effectiveCompanyId]);

  const departmentOptions = useMemo(() => {
    const base = buildDepartmentFilterOptions(departments, employees, t('common.allDepartments'));
    const hasNone = employees.some((e) => departmentKey(e, departments, t) === '__none__');
    if (hasNone && !base.some((o) => o.id === '__none__')) {
      return [...base, { id: '__none__', label: t('employee.noDepartment') }];
    }
    return base;
  }, [departments, employees, t]);

  const scopeLabel = useMemo(() => {
    if (isManager) return companies[0]?.name || t('common.company');
    if (selectedCompanyId === 'all') return t('common.allEmployees');
    return companies.find((c) => c.id === selectedCompanyId)?.name || t('common.company');
  }, [isManager, selectedCompanyId, companies, t]);

  const filteredEmployees = useMemo(() => {
    const q = search.toLowerCase().trim();
    return employees.filter((e) => {
      if (departmentFilter !== 'all') {
        if (departmentFilter === '__none__') {
          if (departmentKey(e, departments, t) !== '__none__') return false;
        } else if (!employeeMatchesDepartmentFilter(e, departmentFilter, departments)) {
          return false;
        }
      }
      if (!q) return true;
      const name = employeeDisplayName(e).toLowerCase();
      const email = (e.email || '').toLowerCase();
      const sub = employeeSubtitle(e).toLowerCase();
      const dept = departmentLabel(e, departments, t).toLowerCase();
      const pos = positionLabel(e, t).toLowerCase();
      return (
        name.includes(q) ||
        email.includes(q) ||
        sub.includes(q) ||
        dept.includes(q) ||
        pos.includes(q)
      );
    });
  }, [employees, search, departmentFilter, departments, t]);

  const kpis = useMemo(() => {
    const total = employees.length;
    const active = employees.filter(isActiveEmployee).length;
    const deptKeys = new Set(
      employees.map((e) => departmentKey(e, departments, t)).filter((k) => k !== '__none__')
    );
    const deptCount = deptKeys.size;
    const rates = employees
      .map((e) => {
        const r = e.hourly_rate ?? e.rate ?? (e as any).pay_rate;
        if (r == null || r === '') return null;
        const n = typeof r === 'number' ? r : parseFloat(String(r));
        return Number.isFinite(n) ? n : null;
      })
      .filter((n): n is number => n != null);
    const avg =
      rates.length > 0 ? (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2) : null;
    return { total, active, deptCount, avg };
  }, [employees, departments, t]);

  const scopeOptions = useMemo(() => {
    const base = [{ id: 'all', label: t('common.allEmployees') }];
    return [...base, ...companies.map((c) => ({ id: c.id, label: c.name }))];
  }, [companies, t]);

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setForm({
      first_name: emp.first_name || '',
      last_name: emp.last_name || '',
      email: emp.email || '',
      phone: String((emp as any).phone ?? ''),
      hire_date: String((emp as any).hire_date ?? ''),
      department_id:
        String(
          emp.department_id ??
            (typeof emp.department === 'object' ? emp.department?.id : '') ??
            ''
        ) || '',
      position: String(emp.position ?? emp.job_title ?? emp.title ?? ''),
      hourly_rate: String(emp.hourly_rate ?? (emp as any).rate ?? ''),
      status: String(emp.status ?? emp.employment_status ?? 'active'),
      emergency_contact_name: String((emp as any).emergency_contact_name ?? ''),
      emergency_contact_phone: String((emp as any).emergency_contact_phone ?? ''),
      notes: String((emp as any).notes ?? ''),
      company_id: emp.company_id || (emp as any).company || '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    const {
      first_name,
      last_name,
      email,
      phone,
      hire_date,
      department_id,
      position,
      hourly_rate,
      status,
      emergency_contact_name,
      emergency_contact_phone,
      notes,
      company_id,
    } = form;
    if (!first_name.trim() || !last_name.trim()) {
      Alert.alert(t('common.validation'), t('employee.nameRequired'));
      return;
    }
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateEmployee(editing.id, {
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        hire_date: hire_date.trim() || undefined,
        department_id: department_id || undefined,
        position: position.trim() || undefined,
        job_title: position.trim() || undefined,
        hourly_rate: hourly_rate.trim() || undefined,
        status: status.trim() || undefined,
        emergency_contact_name: emergency_contact_name.trim() || undefined,
        emergency_contact_phone: emergency_contact_phone.trim() || undefined,
        notes: notes.trim() || undefined,
        company_id: company_id || undefined,
      });
        Alert.alert(t('common.success'), t('employee.updatedSuccess'));
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('employee.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const runDeleteEmployee = async (emp: Employee) => {
    try {
      setSaving(true);
      await api.deleteEmployee(emp.id);
      setModalOpen(false);
      setEditing(null);
      await load();
      Alert.alert(t('common.success'), t('employee.deletedSuccess'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('employee.deleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  const deleteEmployee = (emp: Employee) => {
    const confirmMessage = t('employee.deleteConfirm', { name: employeeDisplayName(emp) });
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm(confirmMessage)) {
        void runDeleteEmployee(emp);
      }
      return;
    }
    Alert.alert(t('employee.deleteTitle'), confirmMessage, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void runDeleteEmployee(emp) },
    ]);
  };

  const tableMinWidth =
    COL.employee + COL.contact + COL.department + COL.rate + COL.status + COL.actions;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{t('employee.title')}</Text>
          <Text style={styles.pageSubtitle}>{t('employee.subtitle')}</Text>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{t('employee.totalEmployees')}</Text>
            <Text style={styles.kpiValue}>{kpis.total}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{t('employee.active')}</Text>
            <Text style={[styles.kpiValue, styles.kpiValueGreen]}>{kpis.active}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{t('employee.departments')}</Text>
            <Text style={styles.kpiValue}>{kpis.deptCount}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{t('employee.avgHourlyRate')}</Text>
            <Text style={styles.kpiValue}>{kpis.avg != null ? `$${kpis.avg}` : t('common.notAvailable')}</Text>
          </View>
        </View>

        <View style={styles.directoryCard}>
          <Text style={styles.directoryTitle}>{t('employee.directory')}</Text>

          <View style={styles.filterRow}>
        {!isManager && (
              <TouchableOpacity style={styles.filterSelect} onPress={() => setScopeModal(true)} activeOpacity={0.85}>
                <Text style={styles.filterSelectText} numberOfLines={1}>
                  {scopeLabel}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
              </TouchableOpacity>
        )}
            <View style={styles.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={20} color="#94a3b8" style={styles.searchIcon} />
        <TextInput
                style={styles.searchInput}
                placeholder={t('employee.searchEmployees')}
                placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
        />
            </View>
            <TouchableOpacity style={styles.filterSelect} onPress={() => setDeptModal(true)} activeOpacity={0.85}>
              <Text style={styles.filterSelectText} numberOfLines={1}>
                {departmentOptions.find((o) => o.id === departmentFilter)?.label || t('common.allDepartments')}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled style={styles.tableScroll}>
            <View style={{ minWidth: Math.max(tableMinWidth, width - 32) }}>
              <View style={[styles.tr, styles.trHeader]}>
                <View style={[styles.th, { width: COL.employee }]}>
                  <Text style={styles.thText}>{t('common.employee')}</Text>
                </View>
                <View style={[styles.th, { width: COL.contact }]}>
                  <Text style={styles.thText}>{t('common.contact')}</Text>
                </View>
                <View style={[styles.th, { width: COL.department }]}>
                  <Text style={styles.thText}>{t('common.department')}</Text>
                </View>
                <View style={[styles.th, { width: COL.rate }]}>
                  <Text style={styles.thText}>{t('employee.hourlyRate')}</Text>
                </View>
                <View style={[styles.th, { width: COL.status }]}>
                  <Text style={styles.thText}>{t('common.status')}</Text>
                </View>
                <View style={[styles.th, { width: COL.actions, alignItems: 'center' }]}>
                  <Text style={styles.thText}> </Text>
                </View>
              </View>

              {filteredEmployees.length === 0 ? (
                <View style={styles.tableEmpty}>
                  <Text style={styles.tableEmptyText}>
                    {employees.length === 0
                      ? t('employee.noEmployeesScope')
                      : t('employee.noEmployeesFilter')}
                  </Text>
                </View>
              ) : (
                filteredEmployees.map((item) => (
                  <KeyedView key={item.id} style={styles.tr}>
                    <View style={[styles.td, { width: COL.employee, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{employeeInitials(item)}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.empName} numberOfLines={1}>
                          {employeeDisplayName(item)}
                        </Text>
                        <Text style={styles.empSub} numberOfLines={1}>
                          {employeeSubtitle(item)}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.td, { width: COL.contact, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                      <MaterialCommunityIcons name="email-outline" size={16} color="#94a3b8" />
                      <Text style={styles.tdMuted} numberOfLines={2}>
                        {item.email || '—'}
                      </Text>
                    </View>
                    <View style={[styles.td, { width: COL.department }]}>
                      <Text style={styles.tdText} numberOfLines={2}>
                        {departmentLabel(item, departments, t)}
                      </Text>
                    </View>
                    <View style={[styles.td, { width: COL.rate }]}>
                      <Text style={styles.tdMuted} numberOfLines={1}>
                        {hourlyLabel(item, t)}
                      </Text>
                    </View>
                    <View style={[styles.td, { width: COL.status }]}>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>
                          {localizedEmployeeStatus(t, statusLabel(item))}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.td, { width: COL.actions, alignItems: 'center', justifyContent: 'center' }]}>
                      <TouchableOpacity onPress={() => setMenuEmployee(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialCommunityIcons name="dots-horizontal" size={22} color="#64748b" />
                      </TouchableOpacity>
                    </View>
                  </KeyedView>
                ))
              )}
            </View>
          </ScrollView>
          </View>
      </ScrollView>

      <PickerModal
        visible={scopeModal}
        title={t('employee.employeeScope')}
        options={scopeOptions}
        onSelect={(id) => setSelectedCompanyId(id)}
        onClose={() => setScopeModal(false)}
      />
      <PickerModal
        visible={deptModal}
        title={t('common.department')}
        options={departmentOptions}
        onSelect={(id) => setDepartmentFilter(id)}
        onClose={() => setDeptModal(false)}
      />

      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modalBox}>
              <View style={styles.modalTitleRow}>
                <Text style={styles.modalTitle}>{t('employee.editEmployee')}</Text>
                <TouchableOpacity onPress={() => setModalOpen(false)} hitSlop={8}>
                  <MaterialCommunityIcons name="close" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>
              <View style={styles.formRow2}>
                <View style={styles.formCol}>
                  <Text style={styles.label}>{t('employeeModal.firstName')} *</Text>
                  <TextInput
                    style={styles.input}
                    value={form.first_name}
                    onChangeText={(v) => setForm((f) => ({ ...f, first_name: v }))}
                    placeholder={t('employeeModal.firstNamePlaceholder')}
                  />
                </View>
                <View style={styles.formCol}>
                  <Text style={styles.label}>{t('employeeModal.lastName')} *</Text>
                  <TextInput
                    style={styles.input}
                    value={form.last_name}
                    onChangeText={(v) => setForm((f) => ({ ...f, last_name: v }))}
                    placeholder={t('employeeModal.lastNamePlaceholder')}
                  />
                </View>
              </View>
              <Text style={styles.label}>{t('employee.email')} *</Text>
              <TextInput
                style={styles.input}
                value={form.email}
                onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                placeholder={t('employeeModal.emailPlaceholder')}
                keyboardType="email-address"
              />
              <View style={styles.formRow2}>
                <View style={styles.formCol}>
                  <Text style={styles.label}>{t('employeeModal.phone')}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.phone}
                    onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                    placeholder={t('employeeModal.phonePlaceholder')}
                  />
                </View>
                <View style={styles.formCol}>
                  <Text style={styles.label}>{t('employeeModal.hireDate')}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.hire_date}
                    onChangeText={(v) => setForm((f) => ({ ...f, hire_date: v }))}
                    placeholder={t('employeeModal.hireDatePlaceholder')}
                  />
                </View>
              </View>
              <View style={styles.formRow2}>
                <View style={styles.formCol}>
                  <Text style={styles.label}>{t('common.department')}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.department_id}
                    onChangeText={(v) => setForm((f) => ({ ...f, department_id: v }))}
                    placeholder={t('employeeModal.departmentIdPlaceholder')}
                  />
                </View>
                <View style={styles.formCol}>
                  <Text style={styles.label}>{t('employeeModal.position')}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.position}
                    onChangeText={(v) => setForm((f) => ({ ...f, position: v }))}
                    placeholder={t('employeeModal.positionPlaceholder')}
                  />
                </View>
              </View>
              <View style={styles.formRow2}>
                <View style={styles.formCol}>
                  <Text style={styles.label}>{t('employeeModal.hourlyRate')}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.hourly_rate}
                    onChangeText={(v) => setForm((f) => ({ ...f, hourly_rate: v }))}
                    placeholder={t('employeeModal.ratePlaceholder')}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.formCol}>
                  <Text style={styles.label}>{t('common.status')}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.status}
                    onChangeText={(v) => setForm((f) => ({ ...f, status: v }))}
                    placeholder={t('employeeModal.statusPlaceholder')}
                  />
                </View>
              </View>
              <Text style={styles.label}>{t('employeeModal.emergencyContact')}</Text>
              <View style={styles.formRow2}>
                <View style={styles.formCol}>
                  <TextInput
                    style={styles.input}
                    value={form.emergency_contact_name}
                    onChangeText={(v) => setForm((f) => ({ ...f, emergency_contact_name: v }))}
                    placeholder={t('employeeModal.emergencyContactPlaceholder')}
                  />
                </View>
                <View style={styles.formCol}>
                  <TextInput
                    style={styles.input}
                    value={form.emergency_contact_phone}
                    onChangeText={(v) => setForm((f) => ({ ...f, emergency_contact_phone: v }))}
                    placeholder={t('employeeModal.phonePlaceholder')}
                  />
                </View>
              </View>
              <Text style={styles.label}>{t('common.notes')}</Text>
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={form.notes}
                onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
                placeholder={t('employeeModal.notesPlaceholder')}
                multiline
              />
              {!isManager && companies.length > 0 && (
                <>
                  <Text style={styles.label}>{t('common.company')}</Text>
                  <ScrollView horizontal style={styles.chipRow} showsHorizontalScrollIndicator={false}>
                    {companies.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, form.company_id === c.id && styles.chipActive]}
                        onPress={() => setForm((f) => ({ ...f, company_id: c.id }))}
                      >
                        <Text style={[styles.chipText, form.company_id === c.id && styles.chipTextActive]} numberOfLines={1}>
                          {c.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.deleteButton, saving && styles.disabled]}
                  onPress={() => editing && deleteEmployee(editing)}
                  disabled={saving || !editing}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                  <Text style={styles.deleteButtonText}>{t('common.delete')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setModalOpen(false)}>
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryButton, saving && styles.disabled]} onPress={save} disabled={saving}>
                  <Text style={styles.primaryButtonText}>
                    {saving ? t('common.saving') : t('employeeModal.saveChanges')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!menuEmployee} transparent animationType="fade" onRequestClose={() => setMenuEmployee(null)}>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuEmployee(null)}>
          <View style={styles.menuSheet}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const e = menuEmployee;
                setMenuEmployee(null);
                if (e) openEdit(e);
              }}
            >
              <MaterialCommunityIcons name="square-edit-outline" size={18} color="#0f172a" />
              <Text style={styles.menuText}>{t('employee.editEmployee')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                const e = menuEmployee;
                setMenuEmployee(null);
                if (e) deleteEmployee(e);
              }}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={18} color="#ef4444" />
              <Text style={styles.menuTextDanger}>{t('employee.deleteEmployee')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  pageHeader: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  pageSubtitle: { fontSize: 14, color: '#64748b', marginTop: 6, lineHeight: 20 },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 12,
  },
  kpiCard: {
    flexGrow: 1,
    minWidth: 148,
    flexBasis: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(15,23,42,0.06)' },
      default: { elevation: 1 },
    }),
  },
  kpiLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 },
  kpiValue: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginTop: 6 },
  kpiValueGreen: { color: '#16a34a' },
  directoryCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    paddingBottom: 8,
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15,23,42,0.08)' },
      default: { elevation: 2 },
    }),
  },
  directoryTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 14 },
  filterRow: { gap: 10, marginBottom: 12 },
  filterSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  filterSelectText: { flex: 1, fontSize: 14, color: '#0f172a', fontWeight: '500' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 10,
    backgroundColor: '#f8fafc',
  },
  searchIcon: { marginRight: 4 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: '#0f172a' },
  tableScroll: { marginHorizontal: -4 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#f1f5f9', alignItems: 'stretch' },
  trHeader: { backgroundColor: '#f8fafc', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  th: { paddingVertical: 10, paddingHorizontal: 8, justifyContent: 'center' },
  thText: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
  td: { paddingVertical: 12, paddingHorizontal: 8, justifyContent: 'center' },
  tdText: { fontSize: 13, color: '#0f172a' },
  tdMuted: { fontSize: 13, color: '#64748b', flex: 1 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  empName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  empSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusPillText: { fontSize: 12, fontWeight: '600', color: '#1d4ed8', textTransform: 'lowercase' },
  tableEmpty: { paddingVertical: 36, paddingHorizontal: 16 },
  tableEmptyText: { fontSize: 14, color: '#64748b', textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center' },
  pickerBox: {
    marginHorizontal: 24,
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  pickerTitle: { fontSize: 16, fontWeight: '700', padding: 16, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  pickerRow: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  pickerRowText: { fontSize: 15, color: '#0f172a' },
  modalScroll: { padding: 24 },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 20, maxWidth: 860, width: '100%', alignSelf: 'center' },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  label: { fontSize: 12, color: '#64748b', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 16 },
  formRow2: { flexDirection: 'row', gap: 12 },
  formCol: { flex: 1, minWidth: 0 },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  chipRow: { marginBottom: 16, maxHeight: 44 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9', marginRight: 8 },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 14, color: '#0f172a' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
  },
  deleteButtonText: { color: '#fff', fontWeight: '600' },
  cancelButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center' },
  cancelButtonText: { color: '#64748b', fontWeight: '600' },
  primaryButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#2563eb', alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.7 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.08)' },
  menuSheet: {
    position: 'absolute',
    right: 32,
    top: 220,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minWidth: 170,
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(15,23,42,0.12)' },
      default: { elevation: 4 },
    }),
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  menuText: { fontSize: 14, color: '#0f172a' },
  menuTextDanger: { fontSize: 14, color: '#ef4444', fontWeight: '500' },
});
