import React, { useEffect, useState, useCallback, useMemo, useRef, Fragment } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Modal,
  FlatList,
  Platform,
  useWindowDimensions,
  Alert,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { getPrimaryRoleFromUser } from '../../types/auth';
import * as api from '../../api';

type Organization = { id: string; name: string; [k: string]: any };
type Company = { id: string; name: string; organization_id?: string; company_manager_id?: string; [k: string]: any };
type Employee = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: string;
  [k: string]: any;
};

type ViewMode = 'daily' | 'weekly';

function companyOrganizationId(c: Company | null | undefined): string {
  if (c == null) return '';
  const raw = (c as any).organization_id ?? (c as any).organization;
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object' && raw !== null && (raw as any).id != null) {
    return String((raw as any).id).trim();
  }
  return String(raw).trim();
}

function employeeCompanyId(e: any): string {
  if (!e || typeof e !== 'object') return '';
  const c = (e as any).company_id ?? (e as any).company;
  if (c == null || c === '') return '';
  if (typeof c === 'object' && c !== null) {
    const id = (c as any).id ?? (c as any).pk ?? (c as any).uuid ?? (c as any).company_id ?? (c as any).company;
    return id != null ? String(id).trim() : '';
  }
  return String(c).trim();
}

/** Compare org ids when API mixes int/string/uuid shapes. */
function organizationIdsMatch(a: string, b: string): boolean {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isNaN(nx) && !Number.isNaN(ny) && nx === ny) return true;
  return false;
}

/** Backend may nest org id under profile / user_profile only. */
function organizationIdFromAuthUser(u: any): string {
  if (!u || typeof u !== 'object') return '';
  const raw =
    u.organization_id ??
    (typeof u.organization === 'object' && u.organization != null && (u.organization as any).id != null
      ? (u.organization as any).id
      : u.organization) ??
    (u as any).profile?.organization_id ??
    (u as any).user_profile?.organization_id ??
    (typeof (u as any).profile?.organization === 'object' && (u as any).profile?.organization?.id != null
      ? (u as any).profile.organization.id
      : (u as any).profile?.organization);
  const s = raw != null ? String(raw).trim() : '';
  return s;
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function weekRangeFromStart(weekStart: Date): { start: Date; end: Date } {
  const start = startOfWeekMonday(weekStart);
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getViewRange(view: ViewMode, anchor: Date): { start: Date; end: Date } {
  if (view === 'daily') {
    const start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    const end = new Date(anchor);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  return weekRangeFromStart(anchor);
}

function formatRangeLabel(view: ViewMode, start: Date, end: Date): string {
  if (view === 'daily') {
    return start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  const left: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const right: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${start.toLocaleDateString(undefined, left)} - ${end.toLocaleDateString(undefined, right)}`;
}

function employeeDisplayName(e: Employee): string {
  const fn = (e.first_name || '').trim();
  const ln = (e.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return e.email || 'Employee';
}

function initials(e: Employee): string {
  const fn = (e.first_name || '').trim();
  const ln = (e.last_name || '').trim();
  if (fn && ln) return `${fn[0]}${ln[0]}`.toUpperCase();
  if (fn) return fn.slice(0, 2).toUpperCase();
  return (e.email || '?').slice(0, 2).toUpperCase();
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function employeeRoleLabel(emp: Employee): string {
  const r = String(emp.role || '').toLowerCase();
  if (!r || ['employee', 'house_keeping', 'maintenance', 'user'].includes(r)) return 'Employee';
  return emp.role || 'Employee';
}

function cellContentForDay(employee: Employee, day: Date, shiftList: any[]): string {
  const empId = String(employee.id);
  const relevant = shiftList.filter((s) => {
    const sid = String(s.employee_id ?? s.employee ?? '');
    if (sid !== empId) return false;
    const st = s.start_time ? new Date(s.start_time) : null;
    if (!st || Number.isNaN(st.getTime())) return false;
    return sameCalendarDay(st, day);
  });
  if (relevant.length === 0) return '-';
  return relevant
    .map((s) => {
      const st = new Date(s.start_time);
      const et = s.end_time ? new Date(s.end_time) : null;
      const t1 = st.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      if (!et) return t1;
      const t2 = et.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return `${t1}–${t2}`;
    })
    .join('\n');
}

function shiftEmployeeId(s: any): string {
  return String(s.employee_id ?? s.employee ?? '');
}

function shiftStartsInRange(s: any, rangeStart: Date, rangeEnd: Date): boolean {
  const st = s.start_time ? new Date(s.start_time) : null;
  if (!st || Number.isNaN(st.getTime())) return false;
  return st >= rangeStart && st <= rangeEnd;
}

function shiftDurationHours(s: any): number {
  const st = s.start_time ? new Date(s.start_time) : null;
  const et = s.end_time ? new Date(s.end_time) : null;
  if (!st || !et || Number.isNaN(st.getTime()) || Number.isNaN(et.getTime())) return 0;
  return Math.max(0, (et.getTime() - st.getTime()) / 3_600_000);
}

function csvEscape(cell: string): string {
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

function buildScheduleCsv(opts: {
  orgName: string;
  companyName: string;
  viewLabel: string;
  rangeStart: Date;
  rangeEnd: Date;
  employees: Employee[];
  shifts: any[];
}): string {
  const lines: string[] = [];
  lines.push(
    ['Organization', 'Company', 'View', 'PeriodStart', 'PeriodEnd']
      .map(csvEscape)
      .join(',')
  );
  lines.push(
    [
      opts.orgName,
      opts.companyName,
      opts.viewLabel,
      opts.rangeStart.toISOString(),
      opts.rangeEnd.toISOString(),
    ]
      .map(csvEscape)
      .join(',')
  );
  lines.push('');
  lines.push(['Employee', 'Email', 'ShiftDate', 'StartTime', 'EndTime', 'Hours'].map(csvEscape).join(','));

  const empById = new Map(opts.employees.map((e) => [String(e.id), e]));
  const inRange = opts.shifts.filter((s) => shiftStartsInRange(s, opts.rangeStart, opts.rangeEnd));
  inRange.sort((a, b) => {
    const ta = a.start_time ? new Date(a.start_time).getTime() : 0;
    const tb = b.start_time ? new Date(b.start_time).getTime() : 0;
    return ta - tb;
  });

  for (const s of inRange) {
    const eid = shiftEmployeeId(s);
    const emp = empById.get(eid);
    const name = emp ? employeeDisplayName(emp) : eid || 'Unknown';
    const email = emp?.email || '';
    const st = s.start_time ? new Date(s.start_time) : null;
    const et = s.end_time ? new Date(s.end_time) : null;
    const dateStr = st ? st.toLocaleDateString() : '';
    const startStr = st ? st.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    const endStr = et ? et.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
    const hrs = shiftDurationHours(s).toFixed(2);
    lines.push([name, email, dateStr, startStr, endStr, hrs].map(csvEscape).join(','));
  }

  return lines.join('\n');
}

async function saveAndShareCsv(filename: string, csv: string): Promise<void> {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const base = FileSystem.cacheDirectory;
  if (!base) {
    Alert.alert('Export', 'Could not access file storage on this device.');
    return;
  }
  const path = `${base}${filename}`;
  await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Download report' });
  } else {
    Alert.alert('Report saved', path);
  }
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
      <View style={modalStyles.overlay} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <View style={modalStyles.box} pointerEvents="auto">
          <Text style={modalStyles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => `opt-${i.id}`}
            style={modalStyles.list}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            ListEmptyComponent={
              <Text style={modalStyles.emptyList}>No options available. Pull to refresh or check permissions.</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                style={modalStyles.row}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={modalStyles.rowText}>{item.label}</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 14,
    maxHeight: '70%',
    paddingVertical: 8,
    zIndex: 2,
    ...(Platform.OS === 'web' ? ({ elevation: 8 } as object) : {}),
  },
  list: { maxHeight: 360 },
  title: { fontSize: 17, fontWeight: '700', color: '#0f172a', paddingHorizontal: 16, paddingBottom: 8 },
  emptyList: { padding: 12, paddingHorizontal: 16, color: '#64748b', fontSize: 14 },
  row: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowText: { fontSize: 16, color: '#0f172a' },
});

const KeyedView = View as React.ComponentType<React.ComponentProps<typeof View> & { key?: React.Key }>;
const KeyedFragment = Fragment as React.ComponentType<{ children?: React.ReactNode; key?: React.Key }>;

export default function EmployeeScheduleScreen() {
  const { user, role } = useAuth();
  const effectiveRole = role ?? (user ? getPrimaryRoleFromUser(user) : null);
  const { width } = useWindowDimensions();

  const [viewMode, setViewMode] = useState<ViewMode>('weekly');
  const [anchor, setAnchor] = useState(() => new Date());

  const { start: rangeStart, end: rangeEnd } = useMemo(() => getViewRange(viewMode, anchor), [viewMode, anchor]);

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [orgModal, setOrgModal] = useState(false);
  const [companyModal, setCompanyModal] = useState(false);
  const initialLoadDone = useRef(false);

  /** Super admin / admin pick org explicitly; org manager is scoped to their org (no picker). */
  const needsOrgPicker = role === 'super_admin' || role === 'admin';
  const authOrgId = useMemo(() => {
    const from = organizationIdFromAuthUser(user);
    if (from) return from;
    return user?.organization_id != null ? String(user.organization_id).trim() : '';
  }, [user]);
  /** Resolved org for filtering when profile omits top-level `organization_id`. */
  const resolvedOrgScopeId = useMemo(() => {
    if (needsOrgPicker) return selectedOrgId ? String(selectedOrgId) : null;
    if (effectiveRole !== 'operations_manager') return null;
    if (authOrgId) return authOrgId;
    if (organizations.length === 1) {
      const o = organizations[0];
      return String((o as any).id ?? (o as any).pk ?? '').trim() || null;
    }
    const orgIds = new Set(companies.map((c) => companyOrganizationId(c)).filter(Boolean));
    if (orgIds.size === 1) return [...orgIds][0] as string;
    return null;
  }, [needsOrgPicker, selectedOrgId, effectiveRole, authOrgId, organizations, companies]);
  const isOrgManager = effectiveRole === 'operations_manager' && user?.id;
  /** Staff roles (not managers/admins) see only their own row when linked to an employee record. */
  const selfScheduleOnly = ['employee', 'house_keeping', 'maintenance', 'user'].includes(
    effectiveRole || ''
  );

  const companiesFiltered = useMemo(() => {
    if (needsOrgPicker && !selectedOrgId) return [];
    let list = companies;
    list = api.filterCompaniesForCompanyManagerRole(list, effectiveRole, user?.id);
    const oid = needsOrgPicker ? selectedOrgId : resolvedOrgScopeId;
    if (oid) {
      const want = String(oid);
      let filtered = list.filter((c) => {
        const cid = companyOrganizationId(c);
        return cid !== '' && organizationIdsMatch(cid, want);
      });
      if (
        filtered.length === 0 &&
        effectiveRole === 'operations_manager' &&
        list.length > 0
      ) {
        filtered = list;
      }
      return filtered;
    }
    return list;
  }, [companies, effectiveRole, user?.id, selectedOrgId, needsOrgPicker, resolvedOrgScopeId]);

  const selectedOrgName = organizations.find((o) => o.id === selectedOrgId)?.name;
  const implicitOrgName =
    resolvedOrgScopeId && !selectedOrgId
      ? organizations.find((o) =>
          organizationIdsMatch(String((o as any).id ?? (o as any).pk ?? ''), String(resolvedOrgScopeId))
        )?.name
      : undefined;
  const displayOrgName = selectedOrgName || implicitOrgName;
  const selectedCompanyName =
    companiesFiltered.find((c) => String(c.id) === String(selectedCompanyId))?.name ??
    companies.find((c) => String(c.id) === String(selectedCompanyId))?.name;

  const loadMeta = useCallback(async () => {
    try {
      if (isOrgManager) {
        const authOid = organizationIdFromAuthUser(user);
        const orgFromUser = user?.organization_id != null ? String(user.organization_id).trim() : '';
        const oidPreferred = authOid || orgFromUser;

        let orgList: Organization[] = [];
        let compRaw: any[] = [];

        if (oidPreferred) {
          const oid = String(oidPreferred);
          try {
            const one = await api.getOrganization(oid);
            if (one && typeof one === 'object') {
              const id = String((one as any).id ?? (one as any).pk ?? oid);
              orgList = [{ ...(one as object), id } as Organization];
            }
          } catch {
            /* fall through */
          }
          if (orgList.length === 0) {
            // Some backends do not support `organization_manager` filtering (400 Bad Request).
            // Load the list and filter client-side by the org id we already have.
            try {
              const listed = await api.getOrganizations();
              const arr = Array.isArray(listed) ? listed : [];
              orgList = arr.filter((o) => String((o as any).id ?? (o as any).pk) === oid);
              if (orgList.length === 0) orgList = arr;
            } catch {
              orgList = [];
            }
          }
          try {
            compRaw = await api.getCompanies({ organization: oid });
          } catch {
            compRaw = [];
          }
          if (!Array.isArray(compRaw)) compRaw = [];
          if (compRaw.length === 0) {
            try {
              const byId = await api.getCompanies({ organization_id: oid });
              compRaw = Array.isArray(byId) ? byId : [];
            } catch {
              compRaw = [];
            }
          }
          if (compRaw.length === 0) {
            const all = await api.getCompanies().catch(() => []);
            const rows = Array.isArray(all) ? all : [];
            compRaw = rows.filter(
              (c: Company) => companyOrganizationId(c) !== '' && organizationIdsMatch(companyOrganizationId(c), oid)
            );
          }
        } else {
          try {
            // Avoid unsupported filter keys (some APIs 400 on unknown query params).
            const listed = await api.getOrganizations();
            orgList = Array.isArray(listed) ? listed : [];
          } catch {
            orgList = [];
          }
          if (orgList.length === 0) {
            try {
              const listed = await api.getOrganizations();
              orgList = Array.isArray(listed) ? listed : [];
            } catch {
              orgList = [];
            }
          }
          try {
            compRaw = await api.getCompanies();
          } catch {
            compRaw = [];
          }
          if (!Array.isArray(compRaw)) compRaw = [];
          const orgIds = new Set(compRaw.map((c: Company) => companyOrganizationId(c)).filter(Boolean));
          if (orgIds.size === 1) {
            const only = [...orgIds][0] as string;
            compRaw = compRaw.filter(
              (c: Company) => companyOrganizationId(c) !== '' && organizationIdsMatch(companyOrganizationId(c), only)
            );
          }
        }
        setOrganizations(orgList);
        setCompanies(Array.isArray(compRaw) ? compRaw : []);
        return;
      }

      const orgsRaw = await api.getOrganizations(undefined);
      const orgList = Array.isArray(orgsRaw) ? orgsRaw : [];
      setOrganizations(orgList);

      let compRaw: any[] = [];
      if (effectiveRole === 'manager') {
        compRaw = await api.getCompanies();
      } else if (needsOrgPicker) {
        if (selectedOrgId) {
          const oid = String(selectedOrgId);
          try {
            compRaw = await api.getCompanies({ organization: oid });
          } catch {
            compRaw = [];
          }
          if (!Array.isArray(compRaw)) compRaw = [];
          if (compRaw.length === 0) {
            try {
              const byId = await api.getCompanies({ organization_id: oid });
              compRaw = Array.isArray(byId) ? byId : [];
            } catch {
              compRaw = [];
            }
          }
          if (compRaw.length === 0) {
            const all = await api.getCompanies();
            const rows = Array.isArray(all) ? all : [];
            compRaw = rows.filter(
              (c: Company) => companyOrganizationId(c) !== '' && organizationIdsMatch(companyOrganizationId(c), oid)
            );
          }
        } else {
          compRaw = [];
        }
      } else {
        compRaw = await api.getCompanies();
      }
      setCompanies(Array.isArray(compRaw) ? compRaw : []);
    } catch (e) {
      console.warn(e);
    }
  }, [isOrgManager, effectiveRole, user, needsOrgPicker, selectedOrgId]);

  const loadEmployeesAndShifts = useCallback(async () => {
    if (selfScheduleOnly && user?.id) {
      try {
        const emp = await api.findSchedulerEmployeeForAuthUser(user);
        if (!emp) {
          setEmployees([]);
          setShifts([]);
          return;
        }
        const eid = String(emp.id ?? (emp as any).pk ?? (emp as any).user_id ?? '').trim();
        if (!eid) {
          setEmployees([]);
          setShifts([]);
          return;
        }
        const companyId =
          String(
            (emp as any).company_id ??
              (emp as any).company ??
              user?.company_id ??
              user?.assigned_company ??
              selectedCompanyId ??
              ''
          ).trim() || undefined;
        if (companyId) setSelectedCompanyId((prev) => prev || companyId);
        const single: Employee = { ...(emp as Employee), id: eid };
        const empUserId = String((emp as any).user_id ?? (emp as any).user?.id ?? user?.id ?? '').trim() || undefined;
        const shiftRaw = await api.getShiftsForEmployeeInRange({
          employeeId: eid,
          employeeUserId: empUserId,
          rangeStart,
          rangeEnd,
          companyId,
        });
        setEmployees([single]);
        setShifts(Array.isArray(shiftRaw) ? shiftRaw : []);
      } catch (e) {
        console.warn(e);
        setEmployees([]);
        setShifts([]);
      }
      return;
    }

    if (!selectedCompanyId) {
      setEmployees([]);
      setShifts([]);
      return;
    }
    try {
      const cid = String(selectedCompanyId);
      const [empRaw, shiftRaw] = await Promise.all([
        api.getEmployeesForCompany(cid),
        api.getShiftsForCompanyInRange({
          companyId: cid,
          rangeStart,
          rangeEnd,
        }),
      ]);
      const normalizedEmployees = (Array.isArray(empRaw) ? empRaw : [])
        .map((e: any) => {
          const fromRecord =
            e?.id ??
            e?.pk ??
            e?.uuid ??
            e?.employee_id ??
            (e?.employee && typeof e.employee === 'object' ? (e.employee as any).id : null);
          let id = String(fromRecord ?? '').trim();
          if (!id && e?.user_id != null) id = String(e.user_id).trim();
          return { ...e, id };
        })
        .filter((e: any) => String(e.id || '').trim() !== '');
      // Defensive: ensure the UI only renders employees for the selected company.
      const companyFilteredEmployees = normalizedEmployees.filter((e: any) => employeeCompanyId(e) === cid);
      setEmployees(companyFilteredEmployees);
      // Defensive: ensure the UI only renders shifts for the selected company.
      const companyFilteredShifts = (Array.isArray(shiftRaw) ? shiftRaw : []).filter((s: any) => {
        const c = s?.company_id ?? s?.company;
        const raw =
          c && typeof c === 'object'
            ? (c as any).id ?? (c as any).pk ?? (c as any).uuid
            : c;
        return String(raw ?? '').trim() === cid;
      });
      setShifts(companyFilteredShifts);
    } catch (e) {
      console.warn(e);
      setEmployees([]);
      setShifts([]);
    }
  }, [selfScheduleOnly, user?.id, user?.company_id, user?.assigned_company, selectedCompanyId, rangeStart, rangeEnd]);

  const load = useCallback(async () => {
    if (!initialLoadDone.current) setLoading(true);
    await loadMeta();
    initialLoadDone.current = true;
    setLoading(false);
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!needsOrgPicker || selectedOrgId || organizations.length !== 1) return;
    const o = organizations[0];
    const id = String((o as any).id ?? (o as any).pk ?? '').trim();
    if (id) setSelectedOrgId(id);
  }, [needsOrgPicker, selectedOrgId, organizations]);

  useEffect(() => {
    if (needsOrgPicker && !selectedOrgId) return;
    if (companiesFiltered.length > 0 && !selectedCompanyId) {
      const first = companiesFiltered[0];
      const id = String((first as any).id ?? (first as any).pk ?? '').trim();
      if (id) setSelectedCompanyId(id);
    }
  }, [needsOrgPicker, selectedOrgId, companiesFiltered, selectedCompanyId]);

  useEffect(() => {
    if (needsOrgPicker && !selectedOrgId) {
      setSelectedCompanyId(null);
      return;
    }
    if (!selectedCompanyId || companiesFiltered.length === 0) return;
    const stillValid = companiesFiltered.some((c) => String(c.id) === String(selectedCompanyId));
    if (!stillValid) setSelectedCompanyId(null);
  }, [needsOrgPicker, selectedOrgId, selectedCompanyId, companiesFiltered]);

  useEffect(() => {
    loadEmployeesAndShifts();
  }, [loadEmployeesAndShifts]);

  const onRefresh = () => {
    setRefreshing(true);
    loadMeta()
      .then(() => loadEmployeesAndShifts())
      .finally(() => setRefreshing(false));
  };

  const goPrev = () => {
    const d = new Date(anchor);
    if (viewMode === 'daily') d.setDate(d.getDate() - 1);
    else d.setDate(d.getDate() - 7);
    setAnchor(d);
  };

  const goNext = () => {
    const d = new Date(anchor);
    if (viewMode === 'daily') d.setDate(d.getDate() + 1);
    else d.setDate(d.getDate() + 7);
    setAnchor(d);
  };

  const goToday = () => setAnchor(new Date());

  const orgOptions = useMemo(() => organizations.map((o) => ({ id: String(o.id), label: String(o.name || 'Organization') })), [organizations]);
  const companyOptions = useMemo(() => {
    const seen = new Set<string>();
    const rows: { id: string; label: string }[] = [];
    for (const c of [...companiesFiltered].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
    )) {
      const id = String((c as any).id ?? (c as any).pk ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, label: String(c.name || 'Company').trim() || 'Company' });
    }
    return rows;
  }, [companiesFiltered]);

  const employeeStats = useMemo(() => {
    return employees.map((emp) => {
      const id = String(emp.id);
      const mine = shifts.filter(
        (s) => shiftEmployeeId(s) === id && shiftStartsInRange(s, rangeStart, rangeEnd)
      );
      const count = mine.length;
      const hours = mine.reduce((sum, s) => sum + shiftDurationHours(s), 0);
      return { emp, count, hours };
    });
  }, [employees, shifts, rangeStart, rangeEnd]);

  const rangeLabel = formatRangeLabel(viewMode, rangeStart, rangeEnd);
  const viewLabelCapital = viewMode === 'daily' ? 'Daily' : 'Weekly';

  const isWide = width >= 900;
  const colWidth = isWide ? 112 : 96;
  const empColWidth = isWide ? 200 : 160;
  const weekDays = useMemo(() => {
    if (viewMode !== 'weekly') return [];
    return Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i));
  }, [viewMode, rangeStart]);
  const tableMinWidth = empColWidth + colWidth * 7;

  const numCols = width >= 900 ? 3 : width >= 560 ? 2 : 1;
  const gridGap = 12;
  const horizontalPad = 20;
  const cardWidth = Math.floor((width - horizontalPad * 2 - gridGap * (numCols - 1)) / numCols);

  const onDownloadReport = async () => {
    if (!selectedCompanyId) {
      Alert.alert('Select company', 'Choose a company before exporting.');
      return;
    }
    setExporting(true);
    try {
      const csv = buildScheduleCsv({
        orgName: displayOrgName || '—',
        companyName: selectedCompanyName || '—',
        viewLabel: viewLabelCapital,
        rangeStart,
        rangeEnd,
        employees,
        shifts,
      });
      const safe = (selectedCompanyName || 'schedule').replace(/[^a-z0-9-_]+/gi, '_');
      const d = rangeStart.toISOString().slice(0, 10);
      const filename = `employee_schedule_${safe}_${d}.csv`;
      await saveAndShareCsv(filename, csv);
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not create CSV.');
    } finally {
      setExporting(false);
    }
  };

  const today = new Date();

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <MaterialCommunityIcons name="calendar-month" size={28} color="#2563eb" />
            <View style={styles.headerTitles}>
              <Text style={styles.pageTitle}>Employee Schedule</Text>
              <Text style={styles.pageSubtitle}>Monitor employee schedules, shifts, and attendance</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.downloadBtn, exporting && styles.downloadBtnDisabled]}
            onPress={onDownloadReport}
            disabled={exporting}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="download" size={18} color="#0f172a" />
            <Text style={styles.downloadBtnText}>{exporting ? '…' : 'Download Report'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.filtersBlock}>
            <View style={styles.filtersLabelRow}>
              <MaterialCommunityIcons name="filter-variant" size={18} color="#64748b" />
              <Text style={styles.filtersLabel}>Filters:</Text>
            </View>
            <View style={styles.filterDropdowns}>
              {needsOrgPicker && (
                <TouchableOpacity style={styles.filterSelect} onPress={() => setOrgModal(true)} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="office-building-outline" size={18} color="#64748b" />
                  <Text style={styles.filterSelectText} numberOfLines={1}>
                    {selectedOrgId ? selectedOrgName || 'Organization' : 'Select organization'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.filterSelect, needsOrgPicker && !selectedOrgId && styles.filterSelectMuted]}
                onPress={() => {
                  if (needsOrgPicker && !selectedOrgId) return;
                  setCompanyModal(true);
                }}
                activeOpacity={0.85}
                disabled={needsOrgPicker && !selectedOrgId}
              >
                <MaterialCommunityIcons name="office-building-outline" size={18} color="#64748b" />
                <Text
                  style={[styles.filterSelectText, needsOrgPicker && !selectedOrgId && styles.mutedText]}
                  numberOfLines={1}
                >
                  {needsOrgPicker && !selectedOrgId
                    ? 'Select organization first'
                    : companiesFiltered.length === 0 && (selectedOrgId || resolvedOrgScopeId)
                      ? 'No companies'
                      : selectedCompanyId
                        ? selectedCompanyName || 'Company'
                        : 'Select company'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.viewDateRow}>
            <View style={styles.segment}>
              {(['weekly', 'daily'] as ViewMode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.segmentBtn, viewMode === m && styles.segmentBtnActive]}
                  onPress={() => setViewMode(m)}
                >
                  <Text style={[styles.segmentText, viewMode === m && styles.segmentTextActive]}>
                    {m === 'weekly' ? 'Weekly' : 'Daily'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.dateNav}>
              <TouchableOpacity onPress={goPrev} style={styles.iconBtn} hitSlop={8}>
                <MaterialCommunityIcons name="chevron-left" size={22} color="#0f172a" />
              </TouchableOpacity>
              <Text style={styles.dateRangeText} numberOfLines={2}>
                {rangeLabel}
              </Text>
              <TouchableOpacity onPress={goNext} style={styles.iconBtn} hitSlop={8}>
                <MaterialCommunityIcons name="chevron-right" size={22} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity onPress={goToday} style={styles.todayBtn} hitSlop={4}>
                <Text style={styles.todayBtnText}>Today</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {!selectedCompanyId ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {needsOrgPicker && !selectedOrgId
                ? 'Select an organization and company to view employee schedules.'
                : 'Select a company to view employee schedules.'}
            </Text>
          </View>
        ) : employees.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No employees in this company.</Text>
          </View>
        ) : viewMode === 'weekly' ? (
          <View style={styles.scheduleTableCard}>
            <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled style={styles.tableScroll}>
              <View style={{ minWidth: Math.max(tableMinWidth, width - 40) }}>
                <View style={[styles.tr, styles.trHeader]}>
                  <View style={[styles.thEmp, { width: empColWidth }]}>
                    <Text style={styles.thText}>Employee</Text>
                  </View>
                  {weekDays.map((day, idx) => {
                    const isToday = sameCalendarDay(day, today);
                    return (
                      <KeyedFragment key={`h-${idx}`}>
                        <View style={[styles.thDay, { width: colWidth }, isToday && styles.colToday]}>
                          <Text style={[styles.thDayMain, isToday && styles.thDayMainToday]}>
                            {day.toLocaleDateString(undefined, { weekday: 'short' })} {day.getDate()}
                          </Text>
                        </View>
                      </KeyedFragment>
                    );
                  })}
                </View>
                {employees.map((emp) => (
                  <KeyedView key={emp.id} style={styles.tr}>
                    <View style={[styles.tdEmp, { width: empColWidth }]}>
                      <View style={styles.tableAvatar}>
                        <Text style={styles.tableAvatarText}>{initials(emp)}</Text>
                      </View>
                      <View style={styles.empMeta}>
                        <Text style={styles.tableEmpName} numberOfLines={1}>
                          {employeeDisplayName(emp)}
                        </Text>
                        <Text style={styles.empRole} numberOfLines={1}>
                          {employeeRoleLabel(emp)}
                        </Text>
                      </View>
                    </View>
                    {weekDays.map((day, idx) => {
                      const isToday = sameCalendarDay(day, today);
                      const cell = cellContentForDay(emp, day, shifts);
                      return (
                        <KeyedFragment key={`${emp.id}-${idx}`}>
                          <View style={[styles.tdCell, { width: colWidth }, isToday && styles.colToday]}>
                            <Text style={styles.cellText}>{cell}</Text>
                          </View>
                        </KeyedFragment>
                      );
                    })}
                  </KeyedView>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : (
          <View style={[styles.grid, { gap: gridGap }]}>
            {employeeStats.map(({ emp, count, hours }) => (
              <KeyedView key={emp.id} style={[styles.empCard, { width: cardWidth }]}>
                <View style={styles.empCardLeft}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(emp)}</Text>
                  </View>
                  <Text style={styles.empName} numberOfLines={2}>
                    {employeeDisplayName(emp)}
                  </Text>
                </View>
                <View style={styles.empCardRight}>
                  <Text style={styles.shiftCount}>
                    {count} shift{count === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.hoursTotal}>{hours.toFixed(1)} hrs</Text>
                </View>
              </KeyedView>
            ))}
          </View>
        )}
      </ScrollView>

      <PickerModal
        visible={orgModal}
        title="Organization"
        options={orgOptions}
        onSelect={(id) => {
          setSelectedOrgId(id);
          setSelectedCompanyId(null);
        }}
        onClose={() => setOrgModal(false)}
      />
      <PickerModal
        visible={companyModal}
        title={effectiveRole === 'operations_manager' ? 'Companies (your organization)' : 'Company'}
        options={companyOptions}
        onSelect={(id) => setSelectedCompanyId(String(id))}
        onClose={() => setCompanyModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40, paddingHorizontal: 20, paddingTop: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, minWidth: 200, gap: 10 },
  headerTitles: { flex: 1, minWidth: 0 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  pageSubtitle: { fontSize: 14, color: '#64748b', marginTop: 4, lineHeight: 20 },

  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  downloadBtnDisabled: { opacity: 0.6 },
  downloadBtnText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  filtersBlock: { marginBottom: 16 },
  filtersLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  filtersLabel: { fontSize: 14, fontWeight: '600', color: '#475569' },
  filterDropdowns: { gap: 10 },
  filterSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
  },
  filterSelectMuted: { opacity: 0.65 },
  filterSelectText: { flex: 1, fontSize: 15, color: '#0f172a', fontWeight: '500' },
  mutedText: { color: '#94a3b8' },

  viewDateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
  },
  segmentBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  segmentBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  segmentTextActive: { color: '#2563eb' },

  dateNav: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  iconBtn: { padding: 6 },
  dateRangeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    maxWidth: 220,
    textAlign: 'center',
  },
  todayBtn: {
    marginLeft: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
  },
  todayBtnText: { fontSize: 13, fontWeight: '600', color: '#2563eb' },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  empCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 72,
  },
  empCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#2563eb' },
  empName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#0f172a' },
  empCardRight: { alignItems: 'flex-end', marginLeft: 8 },
  shiftCount: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  hoursTotal: { fontSize: 13, color: '#64748b', marginTop: 2 },

  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 28,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  emptyText: { fontSize: 15, color: '#64748b', textAlign: 'center', lineHeight: 22 },

  scheduleTableCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  tableScroll: { marginHorizontal: 0 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  trHeader: { backgroundColor: '#f8fafc', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  thEmp: { padding: 12, justifyContent: 'center', borderRightWidth: 1, borderColor: '#e2e8f0' },
  thText: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  thDay: { padding: 12, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: '#e2e8f0' },
  colToday: { backgroundColor: '#eff6ff' },
  thDayMain: { fontSize: 13, fontWeight: '600', color: '#0f172a', textAlign: 'center' },
  thDayMainToday: { color: '#1d4ed8', fontWeight: '700' },
  tdEmp: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
    borderRightWidth: 1,
    borderColor: '#e2e8f0',
  },
  tableAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableAvatarText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  empMeta: { flex: 1, minWidth: 0 },
  tableEmpName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  empRole: { fontSize: 12, color: '#64748b', marginTop: 2 },
  tdCell: {
    padding: 10,
    borderRightWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    minHeight: 64,
  },
  cellText: { fontSize: 13, color: '#64748b', textAlign: 'center' },
});
