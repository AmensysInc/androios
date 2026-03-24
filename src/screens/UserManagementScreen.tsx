import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
  Pressable,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { getPrimaryRoleFromUser, getRoleDisplayLabel } from '../types/auth';
import * as api from '../api';

const BLUE = '#2563eb';

function normalizeRoleToken(r: any): string {
  if (r == null) return '';
  const s = typeof r === 'string' ? r : r?.role || r?.name || '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function userIsAdminRole(roles: any[] | undefined): boolean {
  if (!Array.isArray(roles)) return false;
  const adminTokens = new Set([
    'super_admin',
    'admin',
    'operations_manager',
    'organization_manager',
    'manager',
    'company_manager',
  ]);
  return roles.some((x) => adminTokens.has(normalizeRoleToken(x)));
}

/** Matches web sidebar: User Management is only for `super_admin`. */
function canAccessUserManagement(roles: any[]): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((r) => normalizeRoleToken(r) === 'super_admin');
}

type RowUser = {
  id: string;
  username: string;
  email: string;
  full_name: string;
  phone: string;
  title: string;
  team: string;
  department: string;
  pin: string;
  dateAdded: string;
  lastLogin: string;
  addedBy: string;
  roles: any[];
  raw: any;
};

function initialsFromName(name: string, email: string): string {
  const n = (name || '').trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  const e = (email || '').trim();
  return e.slice(0, 2).toUpperCase() || '—';
}

function formatDate(v: any): string {
  if (v == null || v === '') return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function formatLastLogin(v: any): string {
  if (v == null || v === '') return 'Never logged in';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'Never logged in';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function pickFirstNonEmpty(...values: any[]): string {
  for (const value of values) {
    if (value == null) continue;
    const s = String(value).trim();
    if (s !== '') return s;
  }
  return '';
}

function normalizeEmail(v: any): string {
  return String(v || '')
    .trim()
    .toLowerCase();
}

function mapApiUser(u: any): RowUser {
  const profile = u.profile || u.user_profile || u.employee_profile || {};
  const employee = u.employee || u.employee_details || {};
  const addedByObj =
    (u.created_by && typeof u.created_by === 'object' ? u.created_by : null) ||
    (u.added_by && typeof u.added_by === 'object' ? u.added_by : null);
  const title =
    pickFirstNonEmpty(profile.job_title, profile.title, employee.job_title, employee.title) ||
    getRoleDisplayLabel(getPrimaryRoleFromUser(u)) ||
    '—';
  const phone = pickFirstNonEmpty(
    profile.phone,
    profile.mobile_number,
    employee.phone,
    employee.mobile_number,
    u.phone,
    u.mobile_number
  );
  const team = pickFirstNonEmpty(profile.team, employee.team, profile.team_name, employee.team_name);
  const department = pickFirstNonEmpty(
    profile.department,
    employee.department,
    profile.department_name,
    employee.department_name
  );
  const pin = pickFirstNonEmpty(profile.employee_pin, profile.pin, employee.employee_pin, employee.pin, u.employee_pin);
  const addedBy = pickFirstNonEmpty(
    u.added_by_name,
    u.created_by_name,
    u.created_by_email,
    u.added_by_email,
    addedByObj?.full_name,
    addedByObj?.name,
    addedByObj?.username,
    addedByObj?.email
  );
  return {
    id: String(u.id),
    username: u.username || (u.email ? String(u.email).split('@')[0] : '') || '—',
    email: u.email || profile.email || '—',
    full_name: profile.full_name || u.full_name || '—',
    phone: phone || '—',
    title: title || '—',
    team: team || '—',
    department: department || '—',
    pin: pin || '—',
    dateAdded: formatDate(u.date_joined || u.created_at || profile.created_at || employee.created_at),
    lastLogin: formatLastLogin(u.last_login),
    addedBy: addedBy || 'N/A',
    roles: u.roles || [],
    raw: u,
  };
}

const COL = {
  check: 44,
  avatar: 52,
  username: 112,
  email: 200,
  fullName: 140,
  phone: 112,
  title: 104,
  team: 100,
  department: 112,
  pin: 96,
  dateAdded: 104,
  lastLogin: 120,
  addedBy: 100,
  gear: 44,
  actions: 200,
};

type ColumnKey =
  | 'username'
  | 'email'
  | 'fullName'
  | 'phone'
  | 'title'
  | 'team'
  | 'department'
  | 'pin'
  | 'dateAdded'
  | 'lastLogin'
  | 'addedBy';

const COL_WIDTH_BY_KEY: Record<ColumnKey, number> = {
  username: COL.username,
  email: COL.email,
  fullName: COL.fullName,
  phone: COL.phone,
  title: COL.title,
  team: COL.team,
  department: COL.department,
  pin: COL.pin,
  dateAdded: COL.dateAdded,
  lastLogin: COL.lastLogin,
  addedBy: COL.addedBy,
};

const DEFAULT_COLS: Record<ColumnKey, boolean> = {
  username: true,
  email: true,
  fullName: true,
  phone: true,
  title: true,
  team: true,
  department: true,
  pin: true,
  dateAdded: true,
  lastLogin: true,
  addedBy: true,
};

const COL_LABELS: Record<ColumnKey, string> = {
  username: 'Username',
  email: 'Email',
  fullName: 'Full name',
  phone: 'Phone',
  title: 'Title',
  team: 'Team',
  department: 'Department',
  pin: 'Employee PIN',
  dateAdded: 'Date added',
  lastLogin: 'Last login',
  addedBy: 'Added by',
};

type PickerOption = { id: string; label: string };

function OptionPickerModal({
  visible,
  title,
  options,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.pickerOverlay} onPress={onClose}>
        <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.pickerTitle}>{title}</Text>
          <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
            {options.map((o) => (
              <TouchableOpacity
                key={o.id}
                style={styles.pickerRow}
                onPress={() => {
                  onSelect(o.id);
                  onClose();
                }}
              >
                <Text style={styles.pickerRowText}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.pickerCancelBtn} onPress={onClose}>
            <Text style={styles.pickerCancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createFormRoleLabel(role: string): string {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'organization_manager') return 'Organization Manager';
  if (role === 'company_manager') return 'Company Manager';
  return 'Employee';
}

function assignRoleLabel(role: 'employee' | 'company_manager' | 'organization_manager' | 'super_admin'): string {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'organization_manager') return 'Organization Manager';
  if (role === 'company_manager') return 'Company Manager';
  return 'Employee';
}

export default function UserManagementScreen() {
  const { user } = useAuth();
  const [rows, setRows] = useState<RowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'users' | 'admins'>('users');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>({ ...DEFAULT_COLS });

  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<RowUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    email: '',
    username: '',
    full_name: '',
    phone: '',
    password: '',
    employee_pin: '',
    hourly_rate: '',
    role: 'employee' as string,
    organization_id: '',
    company_id: '',
  });
  const [editForm, setEditForm] = useState({
    username: '',
    email: '',
    full_name: '',
    phone: '',
    role: 'employee' as string,
    organization_id: '',
    company_id: '',
    employee_pin: '',
    hourly_rate: '',
  });

  const [createRolePicker, setCreateRolePicker] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [orgList, setOrgList] = useState<{ id: string; name: string }[]>([]);
  const [companyList, setCompanyList] = useState<{ id: string; name: string }[]>([]);
  const [assignOrgId, setAssignOrgId] = useState<string | null>(null);
  const [assignCompanyId, setAssignCompanyId] = useState<string | null>(null);
  const [assignRole, setAssignRole] = useState<'employee' | 'company_manager' | 'organization_manager' | 'super_admin'>('employee');
  const [employeeUserIds, setEmployeeUserIds] = useState<Set<string>>(new Set());
  const [assignSelectedUserIds, setAssignSelectedUserIds] = useState<Set<string>>(new Set());
  const [assignOrgPicker, setAssignOrgPicker] = useState(false);
  const [assignCompanyPicker, setAssignCompanyPicker] = useState(false);
  const [assignRolePicker, setAssignRolePicker] = useState(false);
  const [createOrgPicker, setCreateOrgPicker] = useState(false);
  const [createCompanyPicker, setCreateCompanyPicker] = useState(false);
  const [createOrgList, setCreateOrgList] = useState<{ id: string; name: string }[]>([]);
  const [createCompanyList, setCreateCompanyList] = useState<{ id: string; name: string }[]>([]);
  const [editRolePicker, setEditRolePicker] = useState(false);
  const [editOrgPicker, setEditOrgPicker] = useState(false);
  const [editCompanyPicker, setEditCompanyPicker] = useState(false);
  const [editOrgList, setEditOrgList] = useState<{ id: string; name: string }[]>([]);
  const [editCompanyList, setEditCompanyList] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const userData = (await api.getCurrentUser()) as any;
      const roles = userData?.roles || [];
      if (!canAccessUserManagement(roles)) {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      const [rawUsers, rawEmployees] = await Promise.all([
        api.getUsers({}).catch(() => []),
        api.getEmployees({}).catch(() => []),
      ]);
      const users = Array.isArray(rawUsers) ? rawUsers : [];
      const employees = Array.isArray(rawEmployees) ? rawEmployees : [];

      // Fill sparse auth-user rows with scheduler employee details where available.
      const employeeByUserId = new Map<string, any>();
      const employeeByEmail = new Map<string, any>();
      for (const e of employees) {
        const uid = e?.user_id ?? e?.user;
        if (uid != null && String(uid).trim() !== '' && !employeeByUserId.has(String(uid))) {
          employeeByUserId.set(String(uid), e);
        }
        const em = normalizeEmail(e?.email);
        if (em && !employeeByEmail.has(em)) employeeByEmail.set(em, e);
      }

      const enrichedUsers = users.map((u: any) => {
        const uid = String(u?.id ?? '');
        const em = normalizeEmail(u?.email ?? u?.profile?.email);
        const employee = employeeByUserId.get(uid) || (em ? employeeByEmail.get(em) : undefined);
        if (!employee) return u;
        return {
          ...u,
          employee,
          employee_details: employee,
          // Keep existing profile values; use employee as fallback.
          profile: {
            ...(u?.profile || {}),
            phone: pickFirstNonEmpty(u?.profile?.phone, employee?.phone, employee?.mobile_number),
            employee_pin: pickFirstNonEmpty(u?.profile?.employee_pin, employee?.employee_pin, employee?.pin),
            department: pickFirstNonEmpty(u?.profile?.department, employee?.department_name, employee?.department),
            team: pickFirstNonEmpty(u?.profile?.team, employee?.team_name, employee?.team),
          },
        };
      });

      const list = enrichedUsers
        .filter((u: any) => (u.profile?.status ?? u.status) !== 'deleted')
        .map(mapApiUser);
      setRows(list);
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

  useEffect(() => {
    if (!assignCompanyId) {
      setEmployeeUserIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const emps = await api.getEmployees({ company: assignCompanyId });
        const next = new Set<string>();
        for (const e of Array.isArray(emps) ? emps : []) {
          const uid = e.user ?? e.user_id;
          if (uid != null && String(uid) !== '') next.add(String(uid));
        }
        if (!cancelled) setEmployeeUserIds(next);
      } catch {
        if (!cancelled) setEmployeeUserIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assignCompanyId]);

  useEffect(() => {
    if (!assignOrgId) {
      setCompanyList([]);
      setAssignCompanyId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const comps = await api.getCompanies({ organization: assignOrgId });
        const list = (Array.isArray(comps) ? comps : []).map((c: any) => ({
          id: String(c.id),
          name: c.name || '—',
        }));
        if (!cancelled) {
          setCompanyList(list);
          setAssignCompanyId(null);
        }
      } catch {
        if (!cancelled) setCompanyList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assignOrgId]);

  useEffect(() => {
    setAssignSelectedUserIds(new Set());
  }, [assignCompanyId]);

  useEffect(() => {
    if (!form.organization_id) {
      setCreateCompanyList([]);
      setForm((f) => ({ ...f, company_id: '' }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const comps = await api.getCompanies({ organization: form.organization_id });
        const list = (Array.isArray(comps) ? comps : []).map((c: any) => ({
          id: String(c.id),
          name: c.name || '—',
        }));
        if (!cancelled) setCreateCompanyList(list);
      } catch {
        if (!cancelled) setCreateCompanyList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.organization_id]);

  useEffect(() => {
    if (!editModal) return;
    if (!editForm.organization_id) {
      setEditCompanyList([]);
      setEditForm((f) => ({ ...f, company_id: '' }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const comps = await api.getCompanies({ organization: editForm.organization_id });
        const list = (Array.isArray(comps) ? comps : []).map((c: any) => ({
          id: String(c.id),
          name: c.name || '—',
        }));
        if (!cancelled) setEditCompanyList(list);
      } catch {
        if (!cancelled) setEditCompanyList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editForm.organization_id, editModal]);

  const assignAvailableUsers = useMemo(() => {
    if (!assignCompanyId) return [];
    return rows.filter((r) => !employeeUserIds.has(r.id));
  }, [rows, assignCompanyId, employeeUserIds]);

  const openAssignModal = useCallback(async () => {
    setAddMenuOpen(false);
    setAssignModalVisible(true);
    setAssignOrgId(null);
    setAssignCompanyId(null);
    setAssignRole('employee');
    setAssignSelectedUserIds(new Set());
    setEmployeeUserIds(new Set());
    setCompanyList([]);
    try {
      const orgs = await api.getOrganizations();
      const list = (Array.isArray(orgs) ? orgs : []).map((o: any) => ({
        id: String(o.id),
        name: o.name || '—',
      }));
      setOrgList(list);
    } catch {
      setOrgList([]);
    }
  }, []);

  const toggleAssignUser = (id: string) => {
    setAssignSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllAssign = () => {
    setAssignSelectedUserIds(new Set(assignAvailableUsers.map((r) => r.id)));
  };

  const clearAllAssign = () => setAssignSelectedUserIds(new Set());

  const handleAssignSubmit = async () => {
    if (assignSelectedUserIds.size === 0 || !assignCompanyId) return;
    const backendRole =
      assignRole === 'organization_manager' || assignRole === 'company_manager' || assignRole === 'super_admin'
        ? assignRole
        : 'employee';
    setSaving(true);
    const errors: string[] = [];
    try {
      for (const id of assignSelectedUserIds) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        const rawName = row.full_name && row.full_name !== '—' ? row.full_name.trim() : row.username;
        const parts = rawName.split(/\s+/).filter(Boolean);
        const first = parts[0] || row.username || 'User';
        const last = parts.slice(1).join(' ') || '—';
        try {
          await api.createEmployee({
            company: assignCompanyId,
            user: id,
            email: row.email && row.email !== '—' ? row.email : undefined,
            first_name: first,
            last_name: last,
            status: 'active',
            job_title: assignRoleLabel(assignRole),
          });
          try {
            await api.updateUser(id, { role: backendRole });
          } catch {
            /* optional: some backends only persist role via employee */
          }
        } catch (e: any) {
          errors.push(row.username + (e?.message ? `: ${e.message}` : ''));
        }
      }
      if (errors.length === 0) {
        setAssignModalVisible(false);
        setAssignSelectedUserIds(new Set());
        await load();
        Alert.alert('Success', 'Users assigned to organization/company.');
      } else if (errors.length < assignSelectedUserIds.size) {
        await load();
        Alert.alert('Partial success', `Some assignments failed:\n${errors.slice(0, 5).join('\n')}`);
      } else {
        Alert.alert('Error', errors.slice(0, 3).join('\n') || 'Assignment failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const adminRows = useMemo(() => rows.filter((r) => userIsAdminRole(r.roles)), [rows]);
  const userRows = useMemo(() => rows.filter((r) => !userIsAdminRole(r.roles)), [rows]);

  const tabRows = tab === 'admins' ? adminRows : userRows;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabRows;
    return tabRows.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q)
    );
  }, [tabRows, search]);

  const tableMinWidth = useMemo(() => {
    let w = COL.check + COL.avatar + COL.gear + COL.actions;
    (Object.keys(COL_WIDTH_BY_KEY) as ColumnKey[]).forEach((key) => {
      if (visibleCols[key]) w += COL_WIDTH_BY_KEY[key];
    });
    return w;
  }, [visibleCols]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const ids = filtered.map((r) => r.id);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      if (allOn) {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const openEdit = (r: RowUser) => {
    const raw = (r.raw || {}) as any;
    const profile = raw.profile || {};
    const employee = raw.employee || raw.employee_details || {};
    const rawRole = normalizeRoleToken(getPrimaryRoleFromUser(raw));
    const role =
      rawRole === 'super_admin' ||
      rawRole === 'organization_manager' ||
      rawRole === 'operations_manager' ||
      rawRole === 'company_manager' ||
      rawRole === 'manager'
        ? rawRole === 'operations_manager'
          ? 'organization_manager'
          : rawRole === 'manager'
            ? 'company_manager'
            : rawRole
        : 'employee';
    const orgId = String(
      profile.organization_id ??
        profile.organization ??
        raw.organization_id ??
        raw.organization ??
        employee.organization_id ??
        employee.organization ??
        ''
    );
    const companyId = String(
      profile.company_id ?? profile.company ?? raw.company_id ?? raw.company ?? employee.company_id ?? employee.company ?? ''
    );
    setEditModal(r);
    setEditForm({
      username: r.username === '—' ? '' : r.username,
      email: r.email === '—' ? '' : r.email,
      full_name: r.full_name === '—' ? '' : r.full_name,
      phone: r.phone === '—' ? '' : r.phone,
      role,
      organization_id: orgId && orgId !== 'undefined' ? orgId : '',
      company_id: companyId && companyId !== 'undefined' ? companyId : '',
      employee_pin: r.pin === '—' ? '' : r.pin,
      hourly_rate: String(profile.hourly_rate ?? employee.hourly_rate ?? ''),
    });
    void (async () => {
      try {
        const orgs = await api.getOrganizations();
        const list = (Array.isArray(orgs) ? orgs : []).map((o: any) => ({ id: String(o.id), name: o.name || '—' }));
        setEditOrgList(list);
      } catch {
        setEditOrgList([]);
      }
    })();
  };

  const handleMessage = (r: RowUser) => {
    const email = r.email && r.email !== '—' ? r.email : '';
    if (!email) {
      Alert.alert('Message', 'No email for this user.');
      return;
    }
    const url = `mailto:${encodeURIComponent(email)}`;
    Linking.canOpenURL(url).then((ok) => {
      if (ok) Linking.openURL(url);
      else Alert.alert('Message', `Email: ${email}`);
    });
  };

  const handleDelete = (r: RowUser) => {
    const run = async () => {
      setSaving(true);
      try {
        await api.deleteUser(r.id);
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(r.id);
          return next;
        });
        await load();
        Alert.alert('Success', 'User removed');
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to delete user');
      } finally {
        setSaving(false);
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm(`Delete user "${r.username}"?`)) void run();
      return;
    }
    Alert.alert('Delete user', `Remove "${r.username}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const handleCreate = async () => {
    if (!form.email.trim()) {
      Alert.alert('Error', 'Email is required');
      return;
    }
    if (!form.password || form.password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    if (form.role === 'organization_manager' && !form.organization_id) {
      Alert.alert('Error', 'Organization is required for Organization Manager');
      return;
    }
    if (form.role === 'company_manager' && (!form.organization_id || !form.company_id)) {
      Alert.alert('Error', 'Organization and company are required for Company Manager');
      return;
    }
    setSaving(true);
    try {
      const email = form.email.trim();
      const username = (form.username || email.split('@')[0] || email).trim();
      const fullName = (form.full_name || email.split('@')[0] || username).trim();
      const parts = fullName.split(/\s+/).filter(Boolean);
      const firstName = parts[0] || username;
      const lastName = parts.slice(1).join(' ') || '';
      const desiredRole = form.role;
      const phone = form.phone?.trim();
      const employeePin = form.employee_pin?.trim();
      const hourlyRate = form.hourly_rate?.trim();
      const orgId = form.organization_id?.trim();
      const companyId = form.company_id?.trim();

      const roleCandidates =
        desiredRole === 'company_manager'
          ? ['company_manager', 'manager']
          : desiredRole === 'organization_manager'
            ? ['organization_manager', 'operations_manager']
            : desiredRole === 'super_admin'
              ? ['super_admin', 'admin']
              : ['employee'];

      let created = false;
      let createdUserId = '';
      let lastErr: any = null;
      for (const roleCandidate of roleCandidates) {
        const basePayload = {
          email,
          username,
        password: form.password,
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
        };
        const clean = (obj: Record<string, any>): Record<string, any> => {
          const out: Record<string, any> = {};
          Object.entries(obj).forEach(([k, v]) => {
            if (v != null && v !== '') out[k] = v;
          });
          return out;
        };
        const withProfileByRef = clean({
          ...basePayload,
          phone,
          employee_pin: employeePin,
          hourly_rate: hourlyRate,
          organization: orgId,
          company: companyId,
          role: roleCandidate,
        });
        const withProfileById = clean({
          ...basePayload,
          phone,
          employee_pin: employeePin,
          hourly_rate: hourlyRate,
          organization_id: orgId,
          company_id: companyId,
          role: roleCandidate,
        });
        const roleNamePayload = clean({ ...basePayload, role_name: roleCandidate });
        const strictMinimal = clean({ email, username, password: form.password });

        // Keep variants deterministic and deduplicated.
        const rawAttempts: Record<string, any>[] = [
          withProfileByRef,
          withProfileById,
          clean({ ...withProfileByRef, re_password: form.password }),
          clean({ ...withProfileById, re_password: form.password }),
          clean({ ...withProfileByRef, password2: form.password }),
          clean({ ...withProfileById, password2: form.password }),
          clean({ ...withProfileByRef, confirm_password: form.password }),
          clean({ ...withProfileById, confirm_password: form.password }),
          roleNamePayload,
          clean({ ...roleNamePayload, re_password: form.password }),
          // Minimal fallbacks: no role, no org/company/profile fields.
          strictMinimal,
          clean({ ...strictMinimal, re_password: form.password }),
          clean({ ...strictMinimal, password2: form.password }),
          clean({ ...strictMinimal, confirm_password: form.password }),
          clean({ email, password: form.password, re_password: form.password }),
        ];
        const seen = new Set<string>();
        const attempts: Record<string, any>[] = [];
        for (const p of rawAttempts) {
          const key = JSON.stringify(p, Object.keys(p).sort());
          if (seen.has(key)) continue;
          seen.add(key);
          attempts.push(p);
        }
        for (const payload of attempts) {
          try {
            const createdUser = await api.createUser(payload);
            const maybeId =
              createdUser?.id ??
              createdUser?.pk ??
              createdUser?.uuid ??
              createdUser?.data?.id ??
              createdUser?.data?.pk ??
              '';
            createdUserId = maybeId ? String(maybeId) : '';
            created = true;
            break;
          } catch (e: any) {
            lastErr = e;
          }
        }
        if (created) break;
      }
      if (!created) {
        throw lastErr || new Error('Failed to create user');
      }
      // Enforce role assignment even when strict serializer accepted only minimal fields.
      if (createdUserId && desiredRole !== 'employee') {
        const roleBackfillCandidates =
          desiredRole === 'company_manager'
            ? ['company_manager', 'manager']
            : desiredRole === 'organization_manager'
              ? ['organization_manager', 'operations_manager']
              : desiredRole === 'super_admin'
                ? ['super_admin', 'admin']
                : ['employee'];
        for (const r of roleBackfillCandidates) {
          try {
            await api.updateUser(createdUserId, { role: r });
            break;
          } catch {
            try {
              await api.updateUser(createdUserId, { role_name: r });
              break;
            } catch {
              // keep trying alias roles
            }
          }
        }
      }
      setCreateModal(false);
      setAddMenuOpen(false);
      setForm({
        email: '',
        username: '',
        full_name: '',
        phone: '',
        password: '',
        employee_pin: '',
        hourly_rate: '',
        role: 'employee',
        organization_id: '',
        company_id: '',
      });
      await load();
      Alert.alert('Success', 'User created');
    } catch (e: any) {
      const body = e?.body ?? e?.response?.data ?? e?.errors;
      const detail =
        body && typeof body === 'object' ? JSON.stringify(body).slice(0, 600) : (e?.message ? '' : '');
      Alert.alert('Error', e?.message ? `${e.message}${detail ? `\n${detail}` : ''}` : detail || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editModal) return;
    if (!editForm.email.trim()) {
      Alert.alert('Error', 'Email is required');
      return;
    }
    if (!editForm.username.trim()) {
      Alert.alert('Error', 'Username is required');
      return;
    }
    if (editForm.role === 'organization_manager' && !editForm.organization_id) {
      Alert.alert('Error', 'Organization is required for Organization Manager');
      return;
    }
    if (editForm.role === 'company_manager' && (!editForm.organization_id || !editForm.company_id)) {
      Alert.alert('Error', 'Organization and company are required for Company Manager');
      return;
    }
    if (editForm.role === 'employee' && (!editForm.organization_id || !editForm.company_id)) {
      Alert.alert('Error', 'Organization and company are required for employees');
      return;
    }
    setSaving(true);
    try {
      const fullName = editForm.full_name.trim();
      const names = fullName.split(/\s+/).filter(Boolean);
      const firstName = names[0] || editForm.username.trim();
      const lastName = names.slice(1).join(' ');
      const clean = (obj: Record<string, any>) => {
        const out: Record<string, any> = {};
        Object.entries(obj).forEach(([k, v]) => {
          if (v != null && v !== '') out[k] = v;
        });
        return out;
      };
      const roleCandidates =
        editForm.role === 'company_manager'
          ? ['company_manager', 'manager']
          : editForm.role === 'organization_manager'
            ? ['organization_manager', 'operations_manager']
            : editForm.role === 'super_admin'
              ? ['super_admin', 'admin']
              : ['employee'];
      const userAttempts = [
        clean({
          username: editForm.username.trim(),
          email: editForm.email.trim(),
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          phone: editForm.phone.trim(),
          employee_pin: editForm.employee_pin.trim(),
          hourly_rate: editForm.hourly_rate.trim(),
          organization_id: editForm.organization_id,
          company_id: editForm.company_id,
        }),
        clean({
          username: editForm.username.trim(),
          email: editForm.email.trim(),
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          phone: editForm.phone.trim(),
          employee_pin: editForm.employee_pin.trim(),
          hourly_rate: editForm.hourly_rate.trim(),
          organization: editForm.organization_id,
          company: editForm.company_id,
        }),
        clean({
          username: editForm.username.trim(),
          email: editForm.email.trim(),
          full_name: fullName,
        }),
      ];
      let lastErr: any = null;
      let userUpdated = false;
      for (const payload of userAttempts) {
        try {
          await api.updateUser(editModal.id, payload);
          userUpdated = true;
          break;
        } catch (e: any) {
          lastErr = e;
        }
      }
      if (!userUpdated) throw lastErr || new Error('Failed to update user');

      // Keep role update compatible with backend aliases.
      for (const roleCandidate of roleCandidates) {
        try {
          await api.updateUser(editModal.id, { role: roleCandidate });
          break;
        } catch {
          try {
            await api.updateUser(editModal.id, { role_name: roleCandidate });
            break;
          } catch {
            // continue trying aliases
          }
        }
      }

      // Scheduler employee row holds company assignment; resolve id if enrich missed it.
      let employeeId = String(editModal.raw?.employee?.id ?? editModal.raw?.employee_details?.id ?? '').trim();
      if (!employeeId && editForm.role === 'employee') {
        const resolved = await api.resolveEmployeeForUser({
          id: editModal.id,
          email: editForm.email.trim(),
        });
        if (resolved?.id) employeeId = String(resolved.id).trim();
      }
      if (editForm.role === 'employee') {
        if (!employeeId) {
          throw new Error('No employee record for this user; company cannot be updated.');
        }
        const rawEmp = editModal.raw?.employee ?? editModal.raw?.employee_details ?? {};
        const prevCompany = String(
          rawEmp.company_id ?? (typeof rawEmp.company === 'object' ? rawEmp.company?.id : rawEmp.company) ?? ''
        ).trim();
        const nextCompany = String(editForm.company_id ?? '').trim();
        const companyChanged = nextCompany !== '' && prevCompany !== nextCompany;

        const empPayload: Record<string, any> = {
          email: editForm.email.trim(),
          first_name: firstName,
          last_name: lastName || undefined,
          company_id: nextCompany,
          company: nextCompany,
          phone: editForm.phone.trim() || undefined,
          employee_pin: editForm.employee_pin.trim() || undefined,
          hourly_rate: editForm.hourly_rate.trim() || undefined,
        };
        const empBody = clean(empPayload);
        if (companyChanged) {
          empBody.department = null;
          empBody.team = null;
        }
        await api.updateEmployee(employeeId, empBody);
      }
      setEditModal(null);
      await load();
      Alert.alert('Success', 'User updated');
    } catch (e: any) {
      const body = e?.body ?? e?.response?.data ?? e?.errors;
      const detail = body && typeof body === 'object' ? JSON.stringify(body).slice(0, 600) : '';
      Alert.alert('Error', e?.message ? `${e.message}${detail ? `\n${detail}` : ''}` : detail || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const renderHeaderCells = () => {
    const cells: React.ReactNode[] = [
      <View style={[styles.cell, styles.cellHead, { width: COL.check }]} key="h-check">
        <TouchableOpacity onPress={toggleSelectAll} hitSlop={8} style={styles.checkboxOuter}>
          <View
            style={[
              styles.checkboxInner,
              filtered.length > 0 && filtered.every((r) => selected.has(r.id)) ? styles.checkboxOn : null,
            ]}
          />
        </TouchableOpacity>
      </View>,
      <View style={[styles.cell, styles.cellHead, { width: COL.avatar }]} key="h-av" />,
    ];
    const push = (key: ColumnKey, w: number, label: string) => {
      if (!visibleCols[key]) return;
      cells.push(
        <View style={[styles.cell, styles.cellHead, { width: w }]} key={`h-${key}`}>
          <Text style={styles.thText}>{label}</Text>
        </View>
      );
    };
    push('username', COL.username, 'Username');
    push('email', COL.email, 'Email');
    push('fullName', COL.fullName, 'Full name');
    push('phone', COL.phone, 'Phone');
    push('title', COL.title, 'Title');
    push('team', COL.team, 'Team');
    push('department', COL.department, 'Department');
    push('pin', COL.pin, 'Employee PIN');
    push('dateAdded', COL.dateAdded, 'Date added');
    push('lastLogin', COL.lastLogin, 'Last login');
    push('addedBy', COL.addedBy, 'Added by');
    cells.push(
      <View style={[styles.cell, styles.cellHead, { width: COL.gear, alignItems: 'center' }]} key="h-gear">
        <TouchableOpacity onPress={() => setColumnsOpen(true)} hitSlop={10}>
          <MaterialCommunityIcons name="cog-outline" size={20} color="#64748b" />
        </TouchableOpacity>
      </View>
    );
    cells.push(
      <View style={[styles.cell, styles.cellHead, { width: COL.actions }]} key="h-act">
        <Text style={styles.thText}>Actions</Text>
      </View>
    );
    return cells;
  };

  const renderRow = ({ item: r }: { item: RowUser }) => {
    const ini = initialsFromName(r.full_name, r.email);
    const cellsOut: React.ReactNode[] = [
      <View style={[styles.cell, { width: COL.check }]} key="c">
        <TouchableOpacity onPress={() => toggleSelect(r.id)} hitSlop={8} style={styles.checkboxOuter}>
          <View style={[styles.checkboxInner, selected.has(r.id) && styles.checkboxOn]} />
        </TouchableOpacity>
      </View>,
      <View style={[styles.cell, { width: COL.avatar }]} key="a">
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{ini}</Text>
        </View>
      </View>,
    ];
    const pushVal = (key: ColumnKey, w: number, node: React.ReactNode) => {
      if (!visibleCols[key]) return;
      cellsOut.push(
        <View style={[styles.cell, { width: w }]} key={key}>
          {node}
        </View>
      );
    };
    pushVal('username', COL.username, <Text style={styles.tdText}>{r.username}</Text>);
    pushVal('email', COL.email, <Text style={styles.tdText}>{r.email}</Text>);
    pushVal('fullName', COL.fullName, <Text style={[styles.tdText, styles.tdName]}>{r.full_name}</Text>);
    pushVal('phone', COL.phone, <Text style={styles.tdText}>{r.phone}</Text>);
    pushVal('title', COL.title, <Text style={styles.tdText}>{r.title}</Text>);
    pushVal('team', COL.team, <Text style={styles.tdMuted}>{r.team}</Text>);
    pushVal('department', COL.department, <Text style={styles.tdMuted}>{r.department}</Text>);
    pushVal('pin', COL.pin, <Text style={styles.tdText}>{r.pin}</Text>);
    pushVal('dateAdded', COL.dateAdded, <Text style={styles.tdText}>{r.dateAdded}</Text>);
    pushVal(
      'lastLogin',
      COL.lastLogin,
      <Text style={[styles.tdText, styles.tdMutedSmall]} numberOfLines={2}>
        {r.lastLogin}
      </Text>
    );
    pushVal('addedBy', COL.addedBy, <Text style={styles.tdMuted}>{r.addedBy}</Text>);
    cellsOut.push(<View style={[styles.cell, { width: COL.gear }]} key="g" />);
    cellsOut.push(
      <View style={[styles.cell, styles.actionsCell, { width: COL.actions }]} key="act">
        <TouchableOpacity style={styles.iconBtn} onPress={() => openEdit(r)} accessibilityLabel="Edit">
          <MaterialCommunityIcons name="square-edit-outline" size={20} color="#0f172a" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => handleMessage(r)} accessibilityLabel="Message">
          <MaterialCommunityIcons name="email-outline" size={20} color="#0f172a" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtnDanger} onPress={() => handleDelete(r)} accessibilityLabel="Delete">
          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    );
    return <View style={styles.tr}>{cellsOut}</View>;
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BLUE} />
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

  const usersTabLabel = `Users (${userRows.length}/${rows.length})`;
  const adminsTabLabel = `Admins (${adminRows.length})`;

  return (
    <View style={styles.container}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>User Management</Text>
        <Text style={styles.pageSubtitle}>Manage users and their roles in the system.</Text>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, tab === 'users' && styles.tabActive]}
            onPress={() => setTab('users')}
            activeOpacity={0.85}
          >
            <Text style={[styles.tabText, tab === 'users' && styles.tabTextActive]}>{usersTabLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'admins' && styles.tabActive]}
            onPress={() => setTab('admins')}
            activeOpacity={0.85}
          >
            <Text style={[styles.tabText, tab === 'admins' && styles.tabTextActive]}>{adminsTabLabel}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.searchWrap}>
            <MaterialCommunityIcons name="magnify" size={20} color="#94a3b8" style={styles.searchIcon} />
        <TextInput
          style={styles.search}
              placeholder="Search"
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#94a3b8"
        />
          </View>
          <View style={styles.addWrap}>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => setAddMenuOpen((o) => !o)}
              activeOpacity={0.9}
            >
              <Text style={styles.addBtnText}>+ Add users</Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
        </View>
      </View>

      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={styles.hScroll} contentContainerStyle={styles.hScrollContent}>
        <View style={[styles.tableWrap, { minWidth: tableMinWidth }]}>
          <View style={styles.thead}>{renderHeaderCells()}</View>
      <FlatList
        data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
            ListEmptyComponent={<Text style={styles.empty}>No users match your search.</Text>}
            contentContainerStyle={filtered.length === 0 ? styles.listEmpty : styles.listContent}
          />
        </View>
      </ScrollView>

      <Modal visible={createModal} transparent animationType="fade" onRequestClose={() => !saving && setCreateModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setCreateModal(false)} />
          <Pressable style={styles.createUserBox} onPress={(e) => e.stopPropagation()}>
            <View style={styles.createUserHeader}>
              <View style={styles.createUserTitleBlock}>
                <Text style={styles.createUserTitle}>Add New User</Text>
                <Text style={styles.createUserSubtitle}>
                  Create a new user account and assign a role.
                </Text>
              </View>
              <TouchableOpacity onPress={() => !saving && setCreateModal(false)} hitSlop={12} style={styles.createCloseBtn}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.createUserFormScroll}
              contentContainerStyle={styles.createUserFormContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              <Text style={styles.fieldLabel}>Username</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="Login username"
                value={form.username}
                onChangeText={(t) => setForm((f) => ({ ...f, username: t }))}
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
              />
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="user@example.com"
                value={form.email}
                onChangeText={(t) => setForm((f) => ({ ...f, email: t }))}
                placeholderTextColor="#94a3b8"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Text style={styles.fieldLabel}>Full Name</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="Full name"
                value={form.full_name}
                onChangeText={(t) => setForm((f) => ({ ...f, full_name: t }))}
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="10 digit phone (no country code)"
                value={form.phone}
                onChangeText={(t) => setForm((f) => ({ ...f, phone: t }))}
                placeholderTextColor="#94a3b8"
                keyboardType="phone-pad"
              />
              <Text style={styles.fieldLabel}>Password</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="Password"
                value={form.password}
                onChangeText={(t) => setForm((f) => ({ ...f, password: t }))}
                secureTextEntry
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.fieldLabel}>Employee PIN</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="4-digit PIN"
                value={form.employee_pin}
                onChangeText={(t) => setForm((f) => ({ ...f, employee_pin: t }))}
                placeholderTextColor="#94a3b8"
                keyboardType="number-pad"
              />
              <Text style={styles.fieldLabel}>Hourly Rate</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="e.g. 15.00"
                value={form.hourly_rate}
                onChangeText={(t) => setForm((f) => ({ ...f, hourly_rate: t }))}
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
              />
              <Text style={styles.fieldLabel}>Role</Text>
              <TouchableOpacity style={styles.selectField} onPress={() => setCreateRolePicker(true)} disabled={saving}>
                <Text style={styles.selectFieldText}>{createFormRoleLabel(form.role)}</Text>
                <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
              </TouchableOpacity>
              <Text style={styles.fieldLabel}>Organization</Text>
              <TouchableOpacity style={styles.selectField} onPress={() => setCreateOrgPicker(true)} disabled={saving}>
                <Text style={[styles.selectFieldText, !form.organization_id && styles.selectPlaceholder]}>
                  {form.organization_id
                    ? createOrgList.find((o) => o.id === form.organization_id)?.name || 'Select organization'
                    : 'Select organization'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
              </TouchableOpacity>
              <Text style={styles.fieldLabel}>Company</Text>
          <TouchableOpacity
                style={[styles.selectField, !form.organization_id && styles.selectFieldDisabled]}
                onPress={() => form.organization_id && setCreateCompanyPicker(true)}
                disabled={saving || !form.organization_id}
              >
                <Text style={[styles.selectFieldText, !form.company_id && styles.selectPlaceholder]}>
                  {!form.organization_id
                    ? 'Select organization first'
                    : form.company_id
                      ? createCompanyList.find((c) => c.id === form.company_id)?.name || 'Select company'
                      : 'Select company'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
          </TouchableOpacity>
              <View style={styles.createUserActions}>
                <TouchableOpacity style={styles.cancelOutlineBtn} onPress={() => setCreateModal(false)} disabled={saving}>
                  <Text style={styles.cancelOutlineBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBlueBtn, saving && styles.disabledOpacity]} onPress={handleCreate} disabled={saving}>
                  <Text style={styles.saveBlueBtnText}>{saving ? 'Creating…' : 'Create User'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!editModal} transparent animationType="fade" onRequestClose={() => !saving && setEditModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setEditModal(null)} />
          <Pressable style={styles.createUserBox} onPress={(e) => e.stopPropagation()}>
            <View style={styles.createUserHeader}>
              <View style={styles.createUserTitleBlock}>
                <Text style={styles.createUserTitle}>Edit User</Text>
                <Text style={styles.createUserSubtitle}>Update user information.</Text>
              </View>
              <TouchableOpacity style={styles.createCloseBtn} onPress={() => !saving && setEditModal(null)} hitSlop={8}>
                <MaterialCommunityIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.createUserFormScroll}
              contentContainerStyle={styles.createUserFormContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.fieldLabel}>Username</Text>
              <TextInput
                style={styles.inputOutlined}
                value={editForm.username}
                onChangeText={(t) => setEditForm((f) => ({ ...f, username: t }))}
                placeholder="Username"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
              />

              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.inputOutlined}
                value={editForm.email}
                onChangeText={(t) => setEditForm((f) => ({ ...f, email: t }))}
                placeholder="Email"
                placeholderTextColor="#94a3b8"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.fieldLabel}>Full Name</Text>
              <TextInput
                style={styles.inputOutlined}
                value={editForm.full_name}
                onChangeText={(t) => setEditForm((f) => ({ ...f, full_name: t }))}
                placeholder="Full name"
                placeholderTextColor="#94a3b8"
              />

              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                style={styles.inputOutlined}
                value={editForm.phone}
                onChangeText={(t) => setEditForm((f) => ({ ...f, phone: t }))}
                placeholder="10 digit phone (no country code)"
                placeholderTextColor="#94a3b8"
                keyboardType="phone-pad"
                autoCapitalize="none"
              />

              <Text style={styles.fieldLabel}>Role</Text>
              <TouchableOpacity style={styles.selectField} onPress={() => setEditRolePicker(true)} disabled={saving}>
                <Text style={styles.selectFieldText}>{createFormRoleLabel(editForm.role)}</Text>
                <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>

              <Text style={styles.fieldLabel}>Organization</Text>
              <TouchableOpacity style={styles.selectField} onPress={() => setEditOrgPicker(true)} disabled={saving}>
                <Text style={[styles.selectFieldText, !editForm.organization_id && styles.selectPlaceholder]}>
                  {editForm.organization_id
                    ? editOrgList.find((o) => o.id === editForm.organization_id)?.name || 'Select organization'
                    : 'Select organization'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Company</Text>
              <TouchableOpacity
                style={[styles.selectField, !editForm.organization_id && styles.selectFieldDisabled]}
                onPress={() => editForm.organization_id && setEditCompanyPicker(true)}
                disabled={saving || !editForm.organization_id}
              >
                <Text style={[styles.selectFieldText, !editForm.company_id && styles.selectPlaceholder]}>
                  {!editForm.organization_id
                    ? 'Select organization first'
                    : editForm.company_id
                      ? editCompanyList.find((c) => c.id === editForm.company_id)?.name || 'Select company'
                      : 'Select company'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Employee PIN</Text>
              <TextInput
                style={styles.inputOutlined}
                value={editForm.employee_pin}
                onChangeText={(t) => setEditForm((f) => ({ ...f, employee_pin: t }))}
                placeholder="4-digit PIN"
                placeholderTextColor="#94a3b8"
                keyboardType="number-pad"
              />

              <Text style={styles.fieldLabel}>Hourly Rate</Text>
              <TextInput
                style={styles.inputOutlined}
                value={editForm.hourly_rate}
                onChangeText={(t) => setEditForm((f) => ({ ...f, hourly_rate: t }))}
                placeholder="e.g. 15.00"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
              />

              <View style={styles.createUserActions}>
                <TouchableOpacity style={styles.cancelOutlineBtn} onPress={() => setEditModal(null)} disabled={saving}>
                  <Text style={styles.cancelOutlineBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBlueBtn, saving && styles.disabledOpacity]} onPress={handleEdit} disabled={saving}>
                  <Text style={styles.saveBlueBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
                </TouchableOpacity>
            </View>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={addMenuOpen} transparent animationType="fade" onRequestClose={() => setAddMenuOpen(false)}>
        <Pressable style={styles.addMenuOverlay} onPress={() => setAddMenuOpen(false)}>
          <View style={styles.addMenuOuter} pointerEvents="box-none">
            <Pressable style={styles.addMenu} onPress={(e) => e.stopPropagation()}>
              <TouchableOpacity
                style={styles.addMenuItem}
                onPress={async () => {
                  setAddMenuOpen(false);
                  setForm({
                    email: '',
                    username: '',
                    full_name: '',
                    phone: '',
                    password: '',
                    employee_pin: '',
                    hourly_rate: '',
                    role: 'employee',
                    organization_id: '',
                    company_id: '',
                  });
                  try {
                    const orgs = await api.getOrganizations();
                    const list = (Array.isArray(orgs) ? orgs : []).map((o: any) => ({
                      id: String(o.id),
                      name: o.name || '—',
                    }));
                    setCreateOrgList(list);
                  } catch {
                    setCreateOrgList([]);
                  }
                  setCreateModal(true);
                }}
              >
                <Text style={styles.addMenuItemText}>Add single user</Text>
              </TouchableOpacity>
              <View style={styles.addMenuDivider} />
              <TouchableOpacity style={styles.addMenuItem} onPress={() => void openAssignModal()}>
                <Text style={styles.addMenuItemText}>Assign to organization</Text>
              </TouchableOpacity>
            </Pressable>
            </View>
        </Pressable>
      </Modal>

      <Modal visible={assignModalVisible} transparent animationType="fade" onRequestClose={() => !saving && setAssignModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setAssignModalVisible(false)} />
          <Pressable style={styles.assignOrgBox} onPress={(e) => e.stopPropagation()}>
            <View style={styles.assignOrgHeader}>
              <View style={styles.assignOrgTitleBlock}>
                <Text style={styles.assignOrgTitle}>Assign User to Organization</Text>
                <Text style={styles.assignOrgSubtitle}>
                  Select users and assign them to an organization/company with a specific role.
                </Text>
          </View>
              <TouchableOpacity onPress={() => !saving && setAssignModalVisible(false)} hitSlop={12}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
        </TouchableOpacity>
            </View>

            <ScrollView style={styles.assignScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.assignUsersToolbar}>
              <Text style={styles.assignUsersLabel}>
                Available Users ({assignSelectedUserIds.size} selected)
              </Text>
              <View style={styles.assignUsersToolbarBtns}>
                <TouchableOpacity
                  style={[styles.textLinkBtn, !assignCompanyId && styles.textLinkBtnDisabled]}
                  onPress={selectAllAssign}
                  disabled={!assignCompanyId || assignAvailableUsers.length === 0}
                >
                  <Text style={styles.textLinkBtnText}>Select All</Text>
              </TouchableOpacity>
                <TouchableOpacity style={styles.textLinkBtn} onPress={clearAllAssign}>
                  <Text style={styles.textLinkBtnText}>Clear All</Text>
              </TouchableOpacity>
            </View>
            </View>

            <ScrollView style={styles.assignUserListBox} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {!assignCompanyId ? (
                <Text style={styles.assignEmptyText}>Select an organization and company to see available users.</Text>
              ) : assignAvailableUsers.length === 0 ? (
                <Text style={styles.assignEmptyText}>
                  No available users to assign. All users are either already assigned or don't have the required permissions.
                </Text>
              ) : (
                assignAvailableUsers.map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.assignUserRow}
                    onPress={() => toggleAssignUser(r.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkboxOuter, styles.checkboxOuterSm]}>
                      <View
                        style={[
                          styles.checkboxInner,
                          styles.checkboxInnerSm,
                          assignSelectedUserIds.has(r.id) ? styles.checkboxOn : null,
                        ]}
                      />
                    </View>
                    <View style={styles.assignUserRowText}>
                      <Text style={styles.assignUserName}>{r.full_name !== '—' ? r.full_name : r.username}</Text>
                      <Text style={styles.assignUserEmail}>{r.email}</Text>
          </View>
        </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <Text style={styles.fieldLabel}>Organization</Text>
            <TouchableOpacity style={styles.selectField} onPress={() => setAssignOrgPicker(true)} disabled={saving}>
              <Text style={[styles.selectFieldText, !assignOrgId && styles.selectPlaceholder]}>
                {assignOrgId ? orgList.find((o) => o.id === assignOrgId)?.name : 'Select an organization'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Company</Text>
            <TouchableOpacity
              style={[styles.selectField, !assignOrgId && styles.selectFieldDisabled]}
              onPress={() => assignOrgId && setAssignCompanyPicker(true)}
              disabled={saving || !assignOrgId}
            >
              <Text style={[styles.selectFieldText, !assignCompanyId && styles.selectPlaceholder]}>
                {!assignOrgId
                  ? 'Select organization first'
                  : assignCompanyId
                    ? companyList.find((c) => c.id === assignCompanyId)?.name
                    : 'Select a company'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Role</Text>
            <TouchableOpacity style={styles.selectField} onPress={() => setAssignRolePicker(true)} disabled={saving}>
              <Text style={styles.selectFieldText}>{assignRoleLabel(assignRole)}</Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.assignSubmitBtn,
                (saving ||
                  assignSelectedUserIds.size === 0 ||
                  !assignOrgId ||
                  !assignCompanyId) &&
                  styles.assignSubmitBtnDisabled,
              ]}
              onPress={() => void handleAssignSubmit()}
              disabled={saving || assignSelectedUserIds.size === 0 || !assignOrgId || !assignCompanyId}
            >
              <Text style={styles.assignSubmitBtnText}>
                Assign {assignSelectedUserIds.size} User{assignSelectedUserIds.size === 1 ? '' : 's'} to Organization
              </Text>
            </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <OptionPickerModal
        visible={createRolePicker}
        title="Role"
        options={[
          { id: 'employee', label: 'Employee' },
          { id: 'company_manager', label: 'Company Manager' },
          { id: 'organization_manager', label: 'Organization Manager' },
          { id: 'super_admin', label: 'Super Admin' },
        ]}
        onSelect={(id) => setForm((f) => ({ ...f, role: id }))}
        onClose={() => setCreateRolePicker(false)}
      />
      <OptionPickerModal
        visible={createOrgPicker}
        title="Organization"
        options={createOrgList.map((o) => ({ id: o.id, label: o.name }))}
        onSelect={(id) => setForm((f) => ({ ...f, organization_id: id, company_id: '' }))}
        onClose={() => setCreateOrgPicker(false)}
      />
      <OptionPickerModal
        visible={createCompanyPicker}
        title="Company"
        options={createCompanyList.map((c) => ({ id: c.id, label: c.name }))}
        onSelect={(id) => setForm((f) => ({ ...f, company_id: id }))}
        onClose={() => setCreateCompanyPicker(false)}
      />
      <OptionPickerModal
        visible={editRolePicker}
        title="Role"
        options={[
          { id: 'employee', label: 'Employee' },
          { id: 'company_manager', label: 'Company Manager' },
          { id: 'organization_manager', label: 'Organization Manager' },
          { id: 'super_admin', label: 'Super Admin' },
        ]}
        onSelect={(id) => setEditForm((f) => ({ ...f, role: id }))}
        onClose={() => setEditRolePicker(false)}
      />
      <OptionPickerModal
        visible={editOrgPicker}
        title="Organization"
        options={editOrgList.map((o) => ({ id: o.id, label: o.name }))}
        onSelect={(id) => setEditForm((f) => ({ ...f, organization_id: id, company_id: '' }))}
        onClose={() => setEditOrgPicker(false)}
      />
      <OptionPickerModal
        visible={editCompanyPicker}
        title="Company"
        options={editCompanyList.map((c) => ({ id: c.id, label: c.name }))}
        onSelect={(id) => setEditForm((f) => ({ ...f, company_id: id }))}
        onClose={() => setEditCompanyPicker(false)}
      />
      <OptionPickerModal
        visible={assignOrgPicker}
        title="Organization"
        options={orgList.map((o) => ({ id: o.id, label: o.name }))}
        onSelect={(id) => setAssignOrgId(id)}
        onClose={() => setAssignOrgPicker(false)}
      />
      <OptionPickerModal
        visible={assignCompanyPicker}
        title="Company"
        options={companyList.map((c) => ({ id: c.id, label: c.name }))}
        onSelect={(id) => setAssignCompanyId(id)}
        onClose={() => setAssignCompanyPicker(false)}
      />
      <OptionPickerModal
        visible={assignRolePicker}
        title="Role"
        options={[
          { id: 'employee', label: 'Employee' },
          { id: 'company_manager', label: 'Company Manager' },
          { id: 'organization_manager', label: 'Organization Manager' },
          { id: 'super_admin', label: 'Super Admin' },
        ]}
        onSelect={(id) =>
          setAssignRole(id as 'employee' | 'company_manager' | 'organization_manager' | 'super_admin')
        }
        onClose={() => setAssignRolePicker(false)}
      />

      <Modal visible={columnsOpen} transparent animationType="fade" onRequestClose={() => setColumnsOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setColumnsOpen(false)}>
          <Pressable style={styles.columnModal} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.columnModalTitle}>Visible columns</Text>
            {(Object.keys(COL_LABELS) as ColumnKey[]).map((key) => (
              <TouchableOpacity
                key={key}
                style={styles.columnRow}
                onPress={() => setVisibleCols((v) => ({ ...v, [key]: !v[key] }))}
              >
                <View style={[styles.checkboxOuter, styles.checkboxOuterSm]}>
                  <View style={[styles.checkboxInner, styles.checkboxInnerSm, visibleCols[key] && styles.checkboxOn]} />
                </View>
                <Text style={styles.columnRowLabel}>{COL_LABELS[key]}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.columnDone} onPress={() => setColumnsOpen(false)}>
              <Text style={styles.columnDoneText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  unauthorized: { color: '#64748b', padding: 24, textAlign: 'center' },

  pageHeader: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  pageTitle: { fontSize: 28, fontWeight: '700', color: BLUE },
  pageSubtitle: { fontSize: 15, color: '#64748b', marginTop: 8, lineHeight: 22 },

  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  tabActive: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
  },
  tabText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#0f172a' },

  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
  },
  searchWrap: {
    flex: 1,
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 999,
    backgroundColor: '#fff',
    paddingLeft: 12,
  },
  searchIcon: { marginRight: 4 },
  search: { flex: 1, paddingVertical: 12, paddingRight: 14, fontSize: 15, color: '#0f172a' },

  addWrap: { position: 'relative' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BLUE,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  addMenuOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.25)' },
  addMenuOuter: { flex: 1, alignItems: 'flex-end', paddingTop: 160, paddingRight: 24 },
  addMenu: {
    minWidth: 260,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    overflow: 'hidden',
  },
  addMenuItem: { paddingVertical: 14, paddingHorizontal: 16 },
  addMenuItemText: { fontSize: 15, color: '#0f172a', fontWeight: '600' },
  addMenuDivider: { height: 1, backgroundColor: '#e2e8f0' },

  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  pickerSheet: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', padding: 16, paddingBottom: 8 },
  pickerScroll: { maxHeight: 320 },
  pickerRow: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  pickerRowText: { fontSize: 16, color: '#0f172a' },
  pickerCancelBtn: { padding: 16, alignItems: 'center' },
  pickerCancelBtnText: { fontSize: 16, color: '#64748b', fontWeight: '600' },

  createUserBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    maxHeight: '92%',
  },
  createUserFormScroll: { marginTop: 4, width: '100%' },
  createUserFormContent: { paddingBottom: 8 },
  createUserHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  createUserTitleBlock: { flex: 1, paddingRight: 8, minWidth: 0 },
  createUserTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  createUserSubtitle: { fontSize: 14, color: '#64748b', marginTop: 8, lineHeight: 20 },
  createCloseBtn: { padding: 4 },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 8, marginTop: 14 },
  inputOutlined: {
    borderWidth: 1,
    borderColor: '#0f172a',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#0f172a',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  selectFieldDisabled: { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  selectFieldText: { fontSize: 16, color: '#0f172a', flex: 1 },
  selectPlaceholder: { color: '#94a3b8' },
  createUserActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 24 },
  cancelOutlineBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  cancelOutlineBtnText: { fontSize: 15, fontWeight: '600', color: '#334155' },
  saveBlueBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: BLUE,
    alignItems: 'center',
  },
  saveBlueBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  disabledOpacity: { opacity: 0.6 },

  assignOrgBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 16,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
  },
  assignScroll: { flexGrow: 0 },
  assignOrgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  assignOrgTitleBlock: { flex: 1, paddingRight: 8, minWidth: 0 },
  assignOrgTitle: { fontSize: 19, fontWeight: '700', color: '#0f172a' },
  assignOrgSubtitle: { fontSize: 14, color: '#64748b', marginTop: 8, lineHeight: 20 },
  assignUsersToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  assignUsersLabel: { fontSize: 15, fontWeight: '700', color: '#0f172a', flex: 1, minWidth: 160 },
  assignUsersToolbarBtns: { flexDirection: 'row', gap: 8 },
  textLinkBtn: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  textLinkBtnDisabled: { opacity: 0.4 },
  textLinkBtnText: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  assignUserListBox: {
    minHeight: 120,
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#fafafa',
  },
  assignEmptyText: { padding: 16, fontSize: 14, color: '#64748b', lineHeight: 20 },
  assignUserRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  assignUserRowText: { marginLeft: 12, flex: 1, minWidth: 0 },
  assignUserName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  assignUserEmail: { fontSize: 13, color: '#64748b', marginTop: 2 },
  assignSubmitBtn: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#6366f1',
    alignItems: 'center',
  },
  assignSubmitBtnDisabled: { backgroundColor: '#a5b4fc', opacity: 0.85 },
  assignSubmitBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },

  hScroll: { flex: 1 },
  hScrollContent: { flexGrow: 1 },
  tableWrap: {
    flex: 1,
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  thead: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    minHeight: 56,
  },
  cell: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  cellHead: { paddingVertical: 12 },
  thText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  tdText: { fontSize: 14, color: '#0f172a' },
  tdName: { fontWeight: '700' },
  tdMuted: { fontSize: 14, color: '#94a3b8' },
  tdMutedSmall: { fontSize: 13, color: '#94a3b8', lineHeight: 18 },

  checkboxOuter: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  checkboxOuterSm: { width: 20, height: 20 },
  checkboxInner: { width: 12, height: 12, borderRadius: 2 },
  checkboxInnerSm: { width: 10, height: 10 },
  checkboxOn: { backgroundColor: BLUE },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  avatarText: { fontSize: 13, fontWeight: '700', color: '#64748b' },

  actionsCell: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDanger: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: { paddingBottom: 40 },
  listEmpty: { flexGrow: 1, padding: 32 },
  empty: { textAlign: 'center', color: '#64748b', fontSize: 15 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: '#0f172a' },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 16, color: '#0f172a' },
  roleRow: { flexDirection: 'row', marginBottom: 12, gap: 8, flexWrap: 'wrap' },
  roleChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#e2e8f0' },
  roleChipActive: { backgroundColor: BLUE },
  roleChipText: { fontSize: 14, color: '#64748b' },
  roleChipTextActive: { color: '#fff' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  cancelBtn: { padding: 12 },
  cancelBtnText: { fontSize: 16, color: '#64748b' },
  saveBtn: { paddingVertical: 12, paddingHorizontal: 20, backgroundColor: BLUE, borderRadius: 8 },
  saveBtnText: { color: '#fff', fontWeight: '600' },

  columnModal: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    maxWidth: 360,
    alignSelf: 'center',
    width: '100%',
  },
  columnModalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: '#0f172a' },
  columnRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  columnRowLabel: { fontSize: 16, color: '#334155' },
  columnDone: { marginTop: 16, padding: 14, backgroundColor: BLUE, borderRadius: 10, alignItems: 'center' },
  columnDoneText: { color: '#fff', fontWeight: '700' },
});
