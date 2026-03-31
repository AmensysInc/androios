import React, { useEffect, useState, useCallback, type CSSProperties } from 'react';
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
import { getPrimaryRoleFromUser } from '../../types/auth';
import * as api from '../../api';

type Organization = { id: string; name: string; [k: string]: any };
type Company = { id: string; name: string; organization_id?: string; company_manager_id?: string; [k: string]: any };

function companyOrganizationId(c: Company | null | undefined): string {
  if (c == null) return '';
  const v = c.organization_id ?? (c as any).organization;
  return v != null ? String(v) : '';
}

function organizationIdFromAuthUser(u: any): string {
  if (!u || typeof u !== 'object') return '';
  const raw =
    u.organization_id ??
    (typeof u.organization === 'object' && u.organization != null && (u.organization as any).id != null
      ? (u.organization as any).id
      : u.organization) ??
    u.profile?.organization_id ??
    u.user_profile?.organization_id ??
    (typeof u.profile?.organization === 'object' && u.profile?.organization?.id != null
      ? u.profile.organization.id
      : u.profile?.organization);
  const s = raw != null ? String(raw).trim() : '';
  return s;
}

/** Backend `POST /scheduler/companies/` expects `type` (e.g. IT, Hospitality). */
const COMPANY_TYPES = ['IT', 'General', 'Hospitality', 'Retail', 'Other'] as const;

type PickerOption = { id: string; label: string };

function normalizeHexColor(input: string | null | undefined, fallback = '#3b82f6'): string {
  const raw = String(input || '').trim();
  const s = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return fallback;
}

/** Icon color (dark or white) for contrast on a solid brand background. */
function iconColorOnBrandBg(hex: string): string {
  const s = normalizeHexColor(hex, '#3b82f6').slice(1);
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 165 ? '#0f172a' : '#ffffff';
}

function digitsOnly(s: string): string {
  return String(s || '').replace(/\D/g, '');
}

/** US display format (XXX) XXX-XXXX, max 10 digits. */
function formatUsPhoneDisplay(digits: string): string {
  const d = digitsOnly(digits).slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function displayUsPhoneFromRaw(raw: string | null | undefined): string {
  return formatUsPhoneDisplay(digitsOnly(String(raw ?? '')));
}

function orgIsArchived(o: Organization): boolean {
  const a = (o as any).archived ?? (o as any).is_archived ?? (o as any).deleted;
  if (a === true || a === 'true' || a === 1 || a === '1') return true;
  const st = String((o as any).status ?? '').toLowerCase();
  return st === 'archived' || st === 'inactive';
}

function companyIsArchived(c: Company): boolean {
  const a = (c as any).archived ?? (c as any).is_archived ?? (c as any).deleted;
  if (a === true || a === 'true' || a === 1 || a === '1') return true;
  const st = String((c as any).status ?? '').toLowerCase();
  return st === 'archived' || st === 'inactive';
}

function normalizeRoleToken(r: any): string {
  if (r == null) return '';
  const s = typeof r === 'string' ? r : r?.role || r?.name || '';
  return String(s).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function companyManagerUserId(c: Company | null | undefined): string {
  if (!c) return '';
  const v =
    (c as any).company_manager_id ??
    (c as any).company_manager ??
    (c as any).manager_id ??
    (c as any).manager ??
    '';
  if (v != null && typeof v === 'object' && (v as any).id != null) return String((v as any).id).trim();
  return v != null ? String(v).trim() : '';
}

/** Nested `company_manager` / `manager` object from API (not only an id). */
function nestedCompanyManagerUser(c: Company | null | undefined): any | null {
  if (!c) return null;
  const m = (c as any).company_manager ?? (c as any).manager;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    if (
      (m as any).id != null ||
      (m as any).email ||
      (m as any).username ||
      (m as any).first_name
    ) {
      return m;
    }
  }
  return null;
}

function employeeRowCompanyId(e: any): string {
  const c = e?.company_id ?? e?.company;
  if (c != null && typeof c === 'object' && (c as any).id != null) return String((c as any).id).trim();
  if (c != null && c !== '') return String(c).trim();
  return '';
}

function employeeRowUserId(e: any): string {
  const u = e?.user_id ?? e?.user;
  if (u != null && typeof u === 'object' && (u as any).id != null) return String((u as any).id).trim();
  if (u != null && u !== '') return String(u).trim();
  return '';
}

function assignedEmployeeDisplayName(e: any): string {
  const fn = String(e?.first_name ?? '').trim();
  const ln = String(e?.last_name ?? '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  const profile = e?.profile;
  const full = profile && typeof profile === 'object' ? String((profile as any).full_name ?? '').trim() : '';
  if (full) return full;
  return String(e?.email ?? e?.username ?? 'Employee').trim() || 'Employee';
}

function assignedEmployeesForCompany(rows: any[], companyId: string, excludeManagerUserId: string): any[] {
  const cid = String(companyId || '').trim();
  const mgr = String(excludeManagerUserId || '').trim();
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((e) => {
    if (cid && employeeRowCompanyId(e) !== cid) return false;
    const uid = employeeRowUserId(e);
    if (mgr && uid && uid === mgr) return false;
    return true;
  });
}

function isAssignedId(v: any): boolean {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (!s) return false;
  if (s === 'undefined' || s === 'null' || s === 'none') return false;
  if (s === '0') return false;
  return true;
}

function getUserLabel(u: any): string {
  const full = u?.profile?.full_name ?? u?.full_name;
  const name = full && String(full).trim() ? String(full).trim() : '';
  if (name) return name;
  return u?.username ?? u?.email ?? 'User';
}

function displayNameFromUserLike(u: any): string {
  if (!u) return '';
  const fn = String(u.first_name ?? '').trim();
  const ln = String(u.last_name ?? '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return getUserLabel(u);
}

function userEmail(u: any): string {
  return String(u?.email ?? u?.username ?? '').trim();
}

function userStatusToken(u: any): string {
  if (u && typeof u === 'object' && typeof u.is_active === 'boolean') {
    return u.is_active ? 'active' : 'inactive';
  }
  const raw = u?.profile?.status ?? u?.status ?? '';
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'active';
  if (['active', 'enabled', 'ok'].includes(s)) return 'active';
  if (['inactive', 'disabled', 'blocked'].includes(s)) return 'inactive';
  if (['deleted'].includes(s)) return 'deleted';
  return s;
}

function initialsFromLabel(label: string): string {
  const t = String(label || '').trim();
  if (!t) return '—';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

function userHasRole(u: any, roleToken: string): boolean {
  const roles = u?.roles ?? u?.role ?? u?.user_roles;
  const list = Array.isArray(roles) ? roles : roles != null ? [roles] : [];
  return list.some((r) => normalizeRoleToken(r) === roleToken);
}

/** Role strings from nested serializers (groups, role objects, primary role). */
function collectUserRoleTokens(u: any): Set<string> {
  const out = new Set<string>();
  const add = (v: any) => {
    const t = normalizeRoleToken(v);
    if (t) out.add(t);
  };
  const roles = u?.roles ?? u?.user_roles;
  if (Array.isArray(roles)) {
    for (const r of roles) {
      if (r != null && typeof r === 'object') {
        add((r as any).role);
        add((r as any).name);
        add((r as any).role_name);
      } else add(r);
    }
  }
  if (typeof u?.role === 'string') add(u.role);
  if (typeof u?.role_name === 'string') add(u.role_name);
  if (typeof u?.primary_role === 'string') add(u.primary_role);
  const groups = u?.groups;
  if (Array.isArray(groups)) {
    for (const g of groups) {
      if (g != null && typeof g === 'object') add((g as any).name);
      else add(g);
    }
  }
  try {
    add(getPrimaryRoleFromUser(u));
  } catch {
    /* ignore */
  }
  return out;
}

/** Match picker tokens (company_manager, manager, org manager, etc.) against all known role shapes. */
function userMatchesPickTokens(u: any, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  if (userStatusToken(u) === 'deleted') return false;
  const want = new Set(tokens.map((t) => normalizeRoleToken(t)));
  const have = collectUserRoleTokens(u);
  for (const t of tokens) {
    if (userHasRole(u, normalizeRoleToken(t))) return true;
  }
  for (const h of have) {
    if (want.has(h)) return true;
  }
  if (want.has('company_manager') || want.has('manager')) {
    if (have.has('company_manager') || have.has('manager')) return true;
    if (have.has('admin') || have.has('super_admin')) return true;
  }
  if (want.has('organization_manager') || want.has('operations_manager')) {
    if (have.has('organization_manager') || have.has('operations_manager')) return true;
    if (have.has('admin') || have.has('super_admin')) return true;
  }
  return false;
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
  const fb = fallback || '#3b82f6';
  const safe = normalizeHexColor(value, fb);
  const apply = (next: string) => onChange(normalizeHexColor(next, fb));

  const webColorInputStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
    border: 'none',
    padding: 0,
    margin: 0,
  };

  return (
    <View style={styles.brandRow}>
      <View style={[styles.brandPreviewTile, { backgroundColor: safe }]}>
        <MaterialCommunityIcons
          name="office-building-outline"
          size={24}
          color={iconColorOnBrandBg(safe)}
          style={styles.brandPreviewIcon}
        />
        {Platform.OS === 'web'
          ? React.createElement('input', {
              type: 'color',
              value: safe,
              'aria-label': 'Pick brand color',
              onChange: (e: any) => apply(e?.target?.value),
              onInput: (e: any) => apply(e?.target?.value),
              style: webColorInputStyle,
            })
          : null}
      </View>
      <TextInput
        style={styles.brandInput}
        value={safe}
        onChangeText={(t) => apply(t)}
        placeholder={fb}
        autoCapitalize="none"
      />
    </View>
  );
}

export default function CompaniesScreen() {
  const { user, role } = useAuth();
  /** Context `role` can lag one frame; align with web sidebar resolution. */
  const effectiveRole = role ?? (user ? getPrimaryRoleFromUser(user) : null);
  const authOrgId = React.useMemo(() => organizationIdFromAuthUser(user), [user]);
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
  const [orgListFilter, setOrgListFilter] = useState<'active' | 'archived'>('active');

  // Create organization/company form state (UI-only; payload stays minimal for safety)
  const [brandColor, setBrandColor] = useState('#3b82f6');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [managerId, setManagerId] = useState<string | null>(null);
  const [managerOptions, setManagerOptions] = useState<PickerOption[]>([]);
  const [usersById, setUsersById] = useState<Record<string, any>>({});

  const [companyOrgPicker, setCompanyOrgPicker] = useState(false);
  const [companyTypePicker, setCompanyTypePicker] = useState(false);
  const [managerPicker, setManagerPicker] = useState(false);
  const [companyMenuForId, setCompanyMenuForId] = useState<string | null>(null);
  const [companyDetails, setCompanyDetails] = useState<Company | null>(null);
  const [companyDetailsEmployees, setCompanyDetailsEmployees] = useState<any[]>([]);
  const [companyDetailsEmployeesLoading, setCompanyDetailsEmployeesLoading] = useState(false);
  const [companyDetailsManagerLoading, setCompanyDetailsManagerLoading] = useState(false);
  const [assignManagerCompany, setAssignManagerCompany] = useState<Company | null>(null);
  const [managerByCompany, setManagerByCompany] = useState<Record<string, string>>({});

  const handlePhoneChange = useCallback((text: string) => {
    setPhone(formatUsPhoneDisplay(digitsOnly(text)));
  }, []);

  const isOrgManager = effectiveRole === 'operations_manager' && user?.id;
  const canCreateOrg = role === 'super_admin';
  const canDeleteOrg = role === 'super_admin';
  const canCreateCompany = role === 'super_admin' || role === 'operations_manager';
  const canEditCompany = role === 'super_admin' || role === 'operations_manager';

  const filteredCompanies = React.useMemo(() => {
    let list = api.filterCompaniesForCompanyManagerRole(companies, effectiveRole, user?.id);
    const oid = authOrgId || (user?.organization_id ? String(user.organization_id) : '');
    if (effectiveRole === 'operations_manager' && oid) {
      list = list.filter((c) => companyOrganizationId(c) === oid);
    }
    return list;
  }, [companies, effectiveRole, user?.id, user?.organization_id, authOrgId]);

  const filteredOrgs = React.useMemo(() => {
    if (effectiveRole === 'operations_manager') {
      const oid = authOrgId || (user?.organization_id ? String(user.organization_id) : '');
      if (oid) return organizations.filter((o) => String(o.id) === oid);
      if (organizations.length === 1) return organizations;
      return organizations;
    }
    if (role === 'manager' && filteredCompanies.length > 0) {
      const orgIds = new Set(filteredCompanies.map((c) => companyOrganizationId(c)).filter(Boolean));
      return organizations.filter((o) => orgIds.has(o.id));
    }
    return organizations;
  }, [organizations, filteredCompanies, role, user?.organization_id, effectiveRole, authOrgId]);

  const activeOrgList = React.useMemo(() => filteredOrgs.filter((o) => !orgIsArchived(o)), [filteredOrgs]);
  const archivedOrgList = React.useMemo(() => filteredOrgs.filter(orgIsArchived), [filteredOrgs]);
  const orgsForList = orgListFilter === 'active' ? activeOrgList : archivedOrgList;

  const orgIdForOrgManagerActions = React.useMemo(() => {
    if (effectiveRole !== 'operations_manager') return '';
    return String(
      authOrgId || user?.organization_id || filteredOrgs[0]?.id || companyOrganizationId(filteredCompanies[0]) || ''
    ).trim();
  }, [effectiveRole, authOrgId, user?.organization_id, filteredOrgs, filteredCompanies]);

  /** Org managers only manage one org — show companies in a flat grid (no org wrapper row). */
  const orgManagerFlatView = effectiveRole === 'operations_manager';
  const orgManagerCompaniesForList = React.useMemo(() => {
    if (!orgManagerFlatView) return [];
    const active = filteredCompanies.filter((c) => !companyIsArchived(c));
    const archived = filteredCompanies.filter(companyIsArchived);
    return orgListFilter === 'active' ? active : archived;
  }, [orgManagerFlatView, filteredCompanies, orgListFilter]);
  const orgManagerActiveCompanyCount = React.useMemo(
    () => filteredCompanies.filter((c) => !companyIsArchived(c)).length,
    [filteredCompanies]
  );
  const orgManagerArchivedCompanyCount = React.useMemo(
    () => filteredCompanies.filter(companyIsArchived).length,
    [filteredCompanies]
  );

  const load = useCallback(async () => {
    try {
      let orgsRaw: Organization[] = [];
      let compRaw: Company[] = [];

      if (isOrgManager) {
        const oid = authOrgId || (user?.organization_id ? String(user.organization_id) : '');
        if (oid) {
          try {
            const one = await api.getOrganization(oid);
            if (one && typeof one === 'object') {
              const id = String((one as any).id ?? (one as any).pk ?? oid);
              orgsRaw = [{ ...(one as object), id } as Organization];
            }
          } catch {
            /* fall through */
          }
          if (orgsRaw.length === 0) {
            try {
              const listed = await api.getOrganizations();
              const arr = Array.isArray(listed) ? listed : [];
              orgsRaw = arr.filter((o) => String(o.id) === oid);
            } catch {
              orgsRaw = [];
            }
          }
          try {
            compRaw = await api.getCompanies({ organization: oid });
          } catch {
            try {
              compRaw = await api.getCompanies({ organization_id: oid });
            } catch {
              const all = await api.getCompanies();
              compRaw = (Array.isArray(all) ? all : []).filter((c) => companyOrganizationId(c) === oid);
            }
          }
        } else {
          try {
            const listed = await api.getOrganizations();
            orgsRaw = Array.isArray(listed) ? listed : [];
          } catch {
            orgsRaw = [];
          }
          try {
            compRaw = await api.getCompanies();
          } catch {
            compRaw = [];
          }
        }
      } else {
        const [o, c] = await Promise.all([api.getOrganizations(), api.getCompanies()]);
        orgsRaw = Array.isArray(o) ? o : [];
        compRaw = Array.isArray(c) ? c : [];
      }

      setOrganizations(orgsRaw);
      setCompanies(compRaw);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOrgManager, user?.organization_id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const cid = companyDetails?.id ? String(companyDetails.id) : '';
    if (!cid) {
      setCompanyDetailsEmployees([]);
      setCompanyDetailsEmployeesLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setCompanyDetailsEmployeesLoading(true);
      try {
        let raw: any[] = [];
        try {
          raw = await api.getEmployees({ company: cid });
        } catch {
          try {
            raw = await api.getEmployees({ company_id: cid });
          } catch {
            const all = await api.getEmployees().catch(() => []);
            raw = Array.isArray(all) ? all : [];
          }
        }
        const mgr = companyManagerUserId(companyDetails);
        const next = assignedEmployeesForCompany(raw, cid, mgr);
        if (!cancelled) setCompanyDetailsEmployees(next);
      } catch {
        if (!cancelled) setCompanyDetailsEmployees([]);
      } finally {
        if (!cancelled) setCompanyDetailsEmployeesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyDetails]);

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

  const loadManagers = useCallback(async (roleTokens: string | string[]) => {
    const tokens = (Array.isArray(roleTokens) ? roleTokens : [roleTokens])
      .map((t) => normalizeRoleToken(t))
      .filter(Boolean);
    try {
      const list = await api.getAuthUsersForAdminPicker();
      const nextById: Record<string, any> = {};
      for (const u of list) {
        const id = String((u as any)?.id ?? (u as any)?.pk ?? (u as any)?.uuid ?? '').trim();
        if (id) nextById[id] = u;
      }
      setUsersById(nextById);
      const filtered = list.filter((u) => tokens.length === 0 || userMatchesPickTokens(u, tokens));
      const options: PickerOption[] = filtered
        .map((u: any) => ({
          id: String(u?.id ?? u?.pk ?? u?.uuid ?? ''),
          label: getUserLabel(u),
        }))
        .filter((o) => o.id !== '');
      setManagerOptions(options);
      return nextById;
    } catch {
      setManagerOptions([]);
      setUsersById({});
      return null;
    }
  }, []);

  useEffect(() => {
    if (!companyDetails) {
      setCompanyDetailsManagerLoading(false);
      return;
    }
    const nested = nestedCompanyManagerUser(companyDetails);
    if (nested) {
      setCompanyDetailsManagerLoading(false);
      return;
    }
    const mid = companyManagerUserId(companyDetails);
    if (!mid) {
      setCompanyDetailsManagerLoading(false);
      return;
    }
    let cancelled = false;
    setCompanyDetailsManagerLoading(true);
    void (async () => {
      try {
        const map = await loadManagers(['company_manager', 'manager']);
        if (cancelled) return;
        const key = String(mid);
        if (map && !map[key]) {
          try {
            const u = await api.getUser(mid);
            if (!cancelled && u) {
              setUsersById((prev) => ({ ...prev, [key]: u }));
            }
          } catch {
            /* ignore */
          }
        }
      } finally {
        if (!cancelled) setCompanyDetailsManagerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyDetails?.id, loadManagers]);

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
    void loadManagers(['organization_manager', 'operations_manager']);
  };
  const handleEditOrg = (org: Organization) => {
    setEditOrg(org);
    setFormName(org.name);
    setBrandColor(normalizeHexColor((org as any).brand_color ?? (org as any).color, '#6366f1'));
    setAddress(String((org as any).address ?? '') || '');
    setPhone(displayUsPhoneFromRaw((org as any).phone));
    setEmail(String((org as any).email ?? '') || '');
    setManagerId((org as any).organization_manager_id ? String((org as any).organization_manager_id) : null);
    void loadManagers(['organization_manager', 'operations_manager']);
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
    void loadManagers(['company_manager', 'manager']);
  };
  const openEditCompany = (company: Company) => {
    setEditCompany(company);
    setFormName(company.name);
    setOrgIdForCompany(companyOrganizationId(company));
    setFormCompanyType(String((company as any).type || 'IT').trim() || 'IT');
    setBrandColor(normalizeHexColor((company as any).brand_color ?? (company as any).color, '#3b82f6'));
    setAddress(String((company as any).address ?? '') || '');
    setPhone(displayUsPhoneFromRaw((company as any).phone));
    setEmail(String((company as any).email ?? '') || '');
    setManagerId(company.company_manager_id ? String(company.company_manager_id) : null);
    void loadManagers(['company_manager', 'manager']);
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

  const managerPickerOptions = React.useMemo<PickerOption[]>(
    () => [{ id: '__none__', label: 'No company manager' }, ...managerOptions],
    [managerOptions]
  );

  const assignManager = async () => {
    if (!assignManagerCompany) return;
    const selected = managerId === '__none__' ? null : managerId;
    const label = selected ? managerOptions.find((o) => o.id === selected)?.label || '' : '';
    setSaving(true);
    try {
      try {
        await api.updateCompany(assignManagerCompany.id, {
          company_manager_id: selected || null,
          company_manager: selected || null,
        });
      } catch {
        await api.updateCompany(assignManagerCompany.id, { manager_id: selected || null, manager: selected || null });
      }
      setManagerByCompany((prev) => ({ ...prev, [assignManagerCompany.id]: label || 'No company manager' }));
      setAssignManagerCompany(null);
      Alert.alert('Saved', 'Company manager assigned.');
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to assign manager');
    } finally {
      setSaving(false);
    }
  };

  const renderCompanyCard = (c: Company) => {
    const companyBubbleColor = normalizeHexColor((c as any).brand_color ?? (c as any).color, '#3b82f6');
    const companyManagerAssigned = isAssignedId(
      (c as any).company_manager_id ??
        (c as any).company_manager ??
        (c as any).manager_id ??
        (c as any).manager
    );
    return (
      <Pressable style={styles.companyCard} onPress={() => setCompanyDetails(c)}>
        <View style={styles.companyTitleRow}>
          <View style={[styles.companyIconBubble, { backgroundColor: companyBubbleColor }]}>
            <MaterialCommunityIcons name="domain" size={16} color={iconColorOnBrandBg(companyBubbleColor)} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {c.name}
          </Text>
        </View>
        <Text style={styles.companyTypeText}>{String((c as any).type || 'general').toLowerCase()}</Text>
        {companyManagerAssigned ? (
          <View style={styles.companyAssignedBadge}>
            <Text style={styles.assignedBadgeText}>Manager Assigned</Text>
          </View>
        ) : null}
        {canEditCompany && (
          <TouchableOpacity
            style={styles.companyEditBtn}
            onPress={(e) => {
              (e as any)?.stopPropagation?.();
              setCompanyMenuForId(c.id);
            }}
          >
            <MaterialCommunityIcons name="cog-outline" size={15} color="#0f172a" />
          </TouchableOpacity>
        )}
      </Pressable>
    );
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
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.title}>
              {role === 'operations_manager' ? 'Companies' : 'Organizations & Companies'}
            </Text>
            <Text style={styles.subtitle}>
              {role === 'operations_manager'
                ? "Your organization's companies"
                : 'Manage organizations and companies'}
            </Text>
          </View>
          <View style={styles.headerToolbar}>
            <TouchableOpacity
              style={[styles.statusPill, orgListFilter === 'active' && styles.statusPillSelected]}
              onPress={() => setOrgListFilter('active')}
              accessibilityRole="button"
              accessibilityState={{ selected: orgListFilter === 'active' }}
            >
              <MaterialCommunityIcons
                name="check"
                size={16}
                color={orgListFilter === 'active' ? '#0f172a' : '#94a3b8'}
              />
              <Text style={[styles.statusPillText, orgListFilter === 'active' && styles.statusPillTextSelected]}>
                Active ({orgManagerFlatView ? orgManagerActiveCompanyCount : activeOrgList.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.statusPill, orgListFilter === 'archived' && styles.statusPillSelected]}
              onPress={() => setOrgListFilter('archived')}
              accessibilityRole="button"
              accessibilityState={{ selected: orgListFilter === 'archived' }}
            >
              <MaterialCommunityIcons
                name="archive-outline"
                size={16}
                color={orgListFilter === 'archived' ? '#0f172a' : '#94a3b8'}
              />
              <Text style={[styles.statusPillText, orgListFilter === 'archived' && styles.statusPillTextSelected]}>
                Archived ({orgManagerFlatView ? orgManagerArchivedCompanyCount : archivedOrgList.length})
              </Text>
            </TouchableOpacity>
            {canCreateOrg ? (
              <TouchableOpacity style={styles.headerNewOrgButton} onPress={handleCreateOrg} accessibilityRole="button">
                <Text style={styles.headerNewOrgButtonText}>+ New org</Text>
              </TouchableOpacity>
            ) : null}
            {canCreateCompany && role === 'operations_manager' ? (
              <TouchableOpacity
                style={styles.headerNewOrgButton}
                onPress={() =>
                  handleCreateCompany(
                    orgManagerFlatView && orgIdForOrgManagerActions
                      ? orgIdForOrgManagerActions
                      : filteredOrgs[0]?.id
                  )
                }
                accessibilityRole="button"
              >
                <Text style={styles.headerNewOrgButtonText}>+ New company</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
      {orgManagerFlatView ? (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
        >
          {orgManagerCompaniesForList.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {orgListFilter === 'archived' ? 'No archived companies' : 'No companies yet'}
              </Text>
              {canCreateCompany && orgListFilter === 'active' && orgIdForOrgManagerActions ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => handleCreateCompany(orgIdForOrgManagerActions)}
                >
                  <Text style={styles.primaryButtonText}>+ New company</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <View style={styles.orgCard}>
              <View style={styles.companyGrid}>
                {orgManagerCompaniesForList.map((c) => (
                  <React.Fragment key={c.id}>{renderCompanyCard(c)}</React.Fragment>
                ))}
                {canCreateCompany && orgIdForOrgManagerActions ? (
                  <TouchableOpacity
                    style={styles.addCompanyGhost}
                    onPress={() => handleCreateCompany(orgIdForOrgManagerActions)}
                  >
                    <MaterialCommunityIcons name="plus" size={28} color="#64748b" />
                    <Text style={styles.addCompanyGhostText}>Add Company</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={orgsForList}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {role === 'operations_manager'
                  ? orgListFilter === 'archived'
                    ? 'No archived organizations'
                    : 'No organization loaded. Check that your profile includes an organization, then pull to refresh.'
                  : orgListFilter === 'archived'
                    ? 'No archived organizations'
                    : 'No organizations yet'}
              </Text>
              {canCreateOrg && orgListFilter === 'active' ? (
                <TouchableOpacity style={styles.primaryButton} onPress={handleCreateOrg}>
                  <Text style={styles.primaryButtonText}>Create organization</Text>
                </TouchableOpacity>
              ) : null}
              {canCreateCompany && role === 'operations_manager' && orgListFilter === 'active' && filteredOrgs[0]?.id ? (
                <TouchableOpacity style={styles.primaryButton} onPress={() => handleCreateCompany(filteredOrgs[0].id)}>
                  <Text style={styles.primaryButtonText}>+ New company</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          renderItem={({ item: org }) => {
            const orgCompanies = filteredCompanies.filter((c) => companyOrganizationId(c) === org.id);
            const isCollapsed = collapsedOrgIds.has(org.id);
            const orgBubbleColor = normalizeHexColor((org as any).brand_color ?? (org as any).color, '#6366f1');
            const orgManagerAssigned = isAssignedId((org as any).organization_manager_id ?? (org as any).organization_manager);
            return (
              <View style={styles.section}>
                <View style={styles.orgCard}>
                  <View style={styles.orgHeader}>
                    <View style={styles.orgTitleWrap}>
                      <View style={[styles.orgIconBubble, { backgroundColor: orgBubbleColor }]}>
                        <MaterialCommunityIcons name="office-building-outline" size={20} color={iconColorOnBrandBg(orgBubbleColor)} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.sectionTitle}>{org.name}</Text>
                        <View style={styles.orgSubRow}>
                          <Text style={styles.orgSub}>
                            {orgCompanies.length} compan{orgCompanies.length === 1 ? 'y' : 'ies'}
                          </Text>
                          {orgManagerAssigned ? (
                            <View style={styles.assignedBadge}>
                              <Text style={styles.assignedBadgeText}>Organization Manager Assigned</Text>
                            </View>
                          ) : null}
                        </View>
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
                        <React.Fragment key={c.id}>{renderCompanyCard(c)}</React.Fragment>
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
      )}
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
                      onChangeText={handlePhoneChange}
                      placeholder="(555) 123-4567"
                      keyboardType="phone-pad"
                      maxLength={14}
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
                  {canDeleteOrg ? (
                    <TouchableOpacity style={styles.deleteButton} onPress={() => void deleteOrg()} disabled={saving}>
                      <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </TouchableOpacity>
                  ) : null}
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
                      onChangeText={handlePhoneChange}
                      placeholder="(555) 123-4567"
                      keyboardType="phone-pad"
                      maxLength={14}
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
                      onChangeText={handlePhoneChange}
                      placeholder="(555) 123-4567"
                      keyboardType="phone-pad"
                      maxLength={14}
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
                  {['#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#f97316'].map((c) => {
                    const norm = normalizeHexColor(c, '#3b82f6');
                    const active = normalizeHexColor(brandColor, '#3b82f6') === norm;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[styles.colorSwatch, { backgroundColor: norm }, active && styles.colorSwatchActive]}
                        onPress={() => setBrandColor(norm)}
                      />
                    );
                  })}
                </View>

                <Text style={styles.label}>Address</Text>
                <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Enter company address" />

                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={[styles.input, styles.inputNoMargin]}
                      value={phone}
                      onChangeText={handlePhoneChange}
                      placeholder="(555) 123-4567"
                      keyboardType="phone-pad"
                      maxLength={14}
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
                  setManagerId(companyManagerUserId(c) || '__none__');
                  setAssignManagerCompany(c);
                  void loadManagers(['company_manager', 'manager']);
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
            <TouchableOpacity style={styles.selectField} onPress={() => setManagerPicker(true)} disabled={saving}>
              <Text style={[styles.selectFieldText, !managerId && styles.selectPlaceholder]}>
                {managerId && managerId !== '__none__'
                  ? managerOptions.find((o) => o.id === managerId)?.label
                  : 'No company manager'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>
            <Text style={styles.helperText}>
              The company manager will have full admin access to all operations within this company.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setAssignManagerCompany(null)} disabled={saving}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalPrimaryButton, saving && styles.disabled]} onPress={() => void assignManager()} disabled={saving}>
                <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Assign Manager'}</Text>
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
                <View
                  style={[
                    styles.companyIconBubble,
                    {
                      backgroundColor: normalizeHexColor(
                        (companyDetails as any)?.brand_color ?? (companyDetails as any)?.color,
                        '#3b82f6'
                      ),
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="office-building-outline"
                    size={18}
                    color={iconColorOnBrandBg(
                      normalizeHexColor(
                        (companyDetails as any)?.brand_color ?? (companyDetails as any)?.color,
                        '#3b82f6'
                      )
                    )}
                  />
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
                  setManagerId(companyManagerUserId(companyDetails) || '__none__');
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
              <View style={styles.detailsCard}>
                <Text style={styles.detailsCardTitle}>Company Details</Text>
                <View style={styles.detailsLine}>
                  <MaterialCommunityIcons name="map-marker-outline" size={18} color="#64748b" />
                  <Text style={styles.detailsLineText} numberOfLines={2}>
                    {String((companyDetails as any)?.address || '—')}
                  </Text>
                </View>
                <View style={styles.detailsLine}>
                  <MaterialCommunityIcons name="phone-outline" size={18} color="#64748b" />
                  <Text style={styles.detailsLineText}>
                    {displayUsPhoneFromRaw(String((companyDetails as any)?.phone || '')) || '—'}
                  </Text>
                </View>
                <View style={styles.detailsLine}>
                  <MaterialCommunityIcons name="email-outline" size={18} color="#64748b" />
                  <Text style={styles.detailsLineText} numberOfLines={1}>
                    {String((companyDetails as any)?.email || '—')}
                  </Text>
                </View>
              </View>
              <View style={styles.detailsCard}>
                <Text style={styles.detailsCardTitle}>Manager</Text>
                {(() => {
                  const mid = companyManagerUserId(companyDetails);
                  const nested = nestedCompanyManagerUser(companyDetails);
                  const u = nested ?? (mid ? usersById[String(mid)] : null);
                  const cachedName =
                    companyDetails?.id != null
                      ? managerByCompany[String(companyDetails.id)]
                      : '';
                  const label = u ? displayNameFromUserLike(u) : '';
                  const email = u ? userEmail(u) : '';
                  const st = u ? userStatusToken(u) : '';
                  const badgeText = st ? st.charAt(0).toUpperCase() + st.slice(1) : 'Active';
                  if (companyDetailsManagerLoading && mid && !nested) {
                    return <ActivityIndicator style={{ marginVertical: 12 }} color="#3b82f6" />;
                  }
                  if (!mid && !nested) {
                    return <Text style={styles.emptyText}>No manager assigned</Text>;
                  }
                  if (u) {
                    return (
                      <View style={styles.managerCard}>
                        <View style={styles.managerAvatar}>
                          <Text style={styles.managerAvatarText}>{initialsFromLabel(label)}</Text>
                        </View>
                        <View style={styles.managerInfo}>
                          <Text style={styles.managerName} numberOfLines={1}>
                            {label}
                          </Text>
                          <Text style={styles.managerEmail} numberOfLines={1}>
                            {email || '—'}
                          </Text>
                          <View style={[styles.managerStatusPill, st === 'inactive' && styles.managerStatusPillInactive]}>
                            <Text style={[styles.managerStatusText, st === 'inactive' && styles.managerStatusTextInactive]}>
                              {badgeText}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  }
                  if (cachedName && cachedName !== 'No company manager') {
                    return (
                      <View style={styles.managerCard}>
                        <View style={styles.managerAvatar}>
                          <Text style={styles.managerAvatarText}>{initialsFromLabel(cachedName)}</Text>
                        </View>
                        <View style={styles.managerInfo}>
                          <Text style={styles.managerName} numberOfLines={1}>
                            {cachedName}
                          </Text>
                          <Text style={styles.managerEmail} numberOfLines={1}>
                            —
                          </Text>
                          <View style={styles.managerStatusPill}>
                            <Text style={styles.managerStatusText}>Active</Text>
                          </View>
                        </View>
                      </View>
                    );
                  }
                  if (mid) {
                    return (
                      <Text style={styles.emptyText}>
                        Manager assigned — profile details could not be loaded.
                      </Text>
                    );
                  }
                  return <Text style={styles.emptyText}>No manager assigned</Text>;
                })()}
              </View>
            </View>
            <View style={styles.detailsEmployeesCard}>
              <Text style={styles.detailsCardTitle}>
                Assigned Employees ({companyDetailsEmployees.length})
              </Text>
              {companyDetailsEmployeesLoading ? (
                <ActivityIndicator style={{ marginVertical: 16 }} color="#3b82f6" />
              ) : companyDetailsEmployees.length === 0 ? (
                <>
                  <Text style={styles.emptyText}>No employees assigned to this company yet</Text>
                  <TouchableOpacity style={[styles.modalCancelButton, { marginTop: 12 }]}>
                    <Text style={styles.cancelButtonText}>Add First Employee</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <ScrollView
                  style={styles.detailsEmployeesScroll}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {companyDetailsEmployees.map((e, i) => {
                    const eid = String(e?.id ?? e?.pk ?? '').trim() || `emp-${i}`;
                    const name = assignedEmployeeDisplayName(e);
                    const mail = String(e?.email ?? '').trim() || '—';
                    const dept =
                      typeof e?.department === 'object' && e?.department?.name
                        ? String(e.department.name)
                        : String(e?.department_name ?? e?.department ?? '').trim() || '—';
                    const pos = String(e?.position ?? e?.job_title ?? e?.title ?? '').trim() || '—';
                    return (
                      <View key={eid} style={styles.assignedEmployeeRow}>
                        <View style={styles.assignedEmployeeAvatar}>
                          <Text style={styles.assignedEmployeeAvatarText}>{initialsFromLabel(name)}</Text>
                        </View>
                        <View style={styles.assignedEmployeeBody}>
                          <Text style={styles.assignedEmployeeName} numberOfLines={1}>
                            {name}
                          </Text>
                          <Text style={styles.assignedEmployeeMeta} numberOfLines={1}>
                            {mail}
                          </Text>
                          <Text style={styles.assignedEmployeeMeta} numberOfLines={1}>
                            {dept} · {pos}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
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
        options={modal === 'org' ? managerOptions : managerPickerOptions}
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
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  headerTitleBlock: { flex: 1, minWidth: 200 },
  headerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  statusPillSelected: {
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    ...Platform.select({ web: { boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)' } as any }),
  },
  statusPillText: { fontSize: 13, fontWeight: '500', color: '#64748b' },
  statusPillTextSelected: { color: '#0f172a', fontWeight: '600' },
  headerNewOrgButton: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerNewOrgButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
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
  orgSubRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  orgIconBubble: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgSub: { fontSize: 12, color: '#64748b' },
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
  assignedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#e0e7ff',
    alignSelf: 'flex-start',
  },
  companyAssignedBadge: {
    position: 'absolute',
    left: 36,
    bottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#e0e7ff',
  },
  assignedBadgeText: { fontSize: 11, fontWeight: '700', color: '#3730a3' },
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
  brandPreviewTile: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  brandPreviewIcon: { pointerEvents: 'none' } as any,
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
    maxHeight: 320,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#fff',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  detailsEmployeesScroll: { maxHeight: 240, marginTop: 4 },
  assignedEmployeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  assignedEmployeeAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignedEmployeeAvatarText: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  assignedEmployeeBody: { flex: 1, minWidth: 0 },
  assignedEmployeeName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  assignedEmployeeMeta: { marginTop: 2, fontSize: 12, color: '#64748b' },
  detailsCardTitle: { alignSelf: 'flex-start', fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  detailsLine: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', marginTop: 8 },
  detailsLineText: { flex: 1, fontSize: 13, color: '#334155' },
  managerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', marginTop: 4 },
  managerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  managerAvatarText: { fontWeight: '800', color: '#0f172a' },
  managerInfo: { flex: 1, minWidth: 0 },
  managerName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  managerEmail: { marginTop: 2, fontSize: 12, color: '#64748b' },
  managerStatusPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
  },
  managerStatusText: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
  managerStatusPillInactive: { backgroundColor: '#fee2e2' },
  managerStatusTextInactive: { color: '#b91c1c' },
});
