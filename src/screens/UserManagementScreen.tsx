import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
import { getPrimaryRoleFromUser, getRoleDisplayLabel, type UserRole } from '../types/auth';
import * as api from '../api';
import {
  loadDepartmentOptions,
  persistEmployeeDepartment,
  type DepartmentOption,
} from '../lib/departmentOptions';
import {
  departmentNameFromCatalog,
  departmentPrimaryId,
  isLikelyUuid,
  normalizeDeptIdsEqual,
} from '../lib/departmentEmployeeMatch';

const BLUE = '#2563eb';

function normalizeRoleToken(r: any): string {
  if (r == null) return '';
  const s = typeof r === 'string' ? r : r?.role || r?.name || '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * `/auth/user/` may return a nested `{ user: {...} }` shape or top-level `roles` / `is_superuser`
 * (same cases as `getPrimaryRoleFromUser`). Merge before role checks so super admins are not denied.
 */
function resolveUserPayloadForRole(userPayload: any): any {
  if (!userPayload || typeof userPayload !== 'object') return userPayload;
  const inner = userPayload.user;
  if (inner && typeof inner === 'object') {
    return { ...inner, ...userPayload, roles: userPayload.roles ?? inner.roles };
  }
  return userPayload;
}

/** Same id notion as scheduler screens use for `filterOrganizationsForOperationsManager` (FK matching). */
function schedulerViewerUserId(viewerPayload: any): string {
  const u = resolveUserPayloadForRole(viewerPayload);
  if (!u || typeof u !== 'object') return '';
  const nested = (u as any).user;
  const nestedId =
    nested && typeof nested === 'object'
      ? (nested as any).id ?? (nested as any).pk ?? (nested as any).user_id
      : '';
  return String(
    (u as any).id ??
      (u as any).pk ??
      (u as any).user_id ??
      nestedId ??
      (u as any).django_id ??
      (u as any).uuid ??
      (u as any).sub ??
      ''
  ).trim();
}

/** User Management: super admins, organization managers, and company managers. */
function canAccessUserManagement(userPayload: any): boolean {
  const u = resolveUserPayloadForRole(userPayload);
  if (!u || typeof u !== 'object') return false;
  const r = getPrimaryRoleFromUser(u);
  return r === 'super_admin' || r === 'organization_manager' || r === 'company_manager';
}

type RowUser = {
  id: string;
  username: string;
  email: string;
  full_name: string;
  phone: string;
  title: string;
  /** Squad / internal team label only (not org or company). */
  team: string;
  /** Company and/or organization display for admins (see web "Organization / Company" column). */
  organizationCompany: string;
  department: string;
  pin: string;
  dateAdded: string;
  lastLogin: string;
  addedBy: string;
  roles: any[];
  raw: any;
};

/**
 * Admins tab: elevated roles (same resolution as session / web sidebar).
 * Uses full `raw` user so list APIs that omit `roles[]` but send `role` / `primary_role` still classify correctly.
 * Users tab: everyone not classified as admins (canonical role `employee` includes legacy API staff roles).
 */
const ADMIN_TAB_PRIMARY_ROLES = new Set<UserRole>(['super_admin', 'organization_manager', 'company_manager']);

function rowBelongsToAdminsTab(r: RowUser): boolean {
  const u = r.raw;
  if (!u || typeof u !== 'object') return false;
  if ((u as any).is_superuser === true) return true;
  const primary = getPrimaryRoleFromUser(u);
  return ADMIN_TAB_PRIMARY_ROLES.has(primary);
}

/**
 * Organization Manager: Admins tab lists only their own row plus company managers in scope.
 * Super Admin / Django superuser rows are hidden (no API or model changes).
 */
function filterAdminTabRowsForOrganizationManagerViewer(adminRows: RowUser[], viewerPayload: any): RowUser[] {
  const u = resolveUserPayloadForRole(viewerPayload);
  if (!u || typeof u !== 'object') return adminRows;
  if (getPrimaryRoleFromUser(u) !== 'organization_manager') return adminRows;

  const meId = String(u.id ?? u.pk ?? (u as any).user_id ?? '').trim();

  return adminRows.filter((r) => {
    const raw = r.raw;
    if (!raw || typeof raw !== 'object') return false;
    if ((raw as any).is_superuser === true) return false;
    const primary = getPrimaryRoleFromUser(raw);
    if (primary === 'super_admin') return false;
    const titleLow = String(r.title || '').toLowerCase();
    if (titleLow.includes('super admin')) return false;

    if (primary === 'organization_manager') {
      if (!meId) return false;
      return String(r.id ?? '').trim() === meId;
    }
    if (primary === 'company_manager') return true;
    return false;
  });
}

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

/** Auth user id linked to a scheduler employee row (`user` may be a nested object). */
function employeeSchedulerUserId(e: any): string {
  const raw = e?.user_id ?? e?.user;
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object' && (raw as any).id != null) return String((raw as any).id).trim();
  const s = String(raw).trim();
  if (s === '[object Object]') return '';
  return s;
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


function phoneDigitsForApi(phone: string | undefined): string | undefined {
  let d = digitsOnly(String(phone || ''));
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length === 10) return d;
  return undefined;
}

function parseHourlyRateForApi(raw: string | undefined): number | string | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  const n = parseFloat(s.replace(/,/g, ''));
  if (!Number.isNaN(n) && n >= 0) return n;
  return undefined;
}

/** Django username: avoid characters that commonly break validation. */
function sanitizeUsername(input: string, fallback: string): string {
  const base = String(input || '').trim().toLowerCase();
  const s = base.replace(/[^a-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^\.+|\.+$/g, '').replace(/^_|_$/g, '');
  const out = s.slice(0, 150);
  return out || fallback;
}

function roleAliasCandidates(desired: string): string[] {
  switch (desired) {
    case 'company_manager':
      return ['company_manager', 'manager'];
    case 'organization_manager':
      return ['organization_manager', 'operations_manager'];
    case 'super_admin':
      return ['super_admin', 'admin'];
    default:
      return ['employee', 'user'];
  }
}

/** Try common auth user PATCH shapes until one succeeds (backend field names vary). */
async function persistAuthUserRole(userId: string, desiredRole: string): Promise<boolean> {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  for (const r of roleAliasCandidates(desiredRole)) {
    const payloads: Record<string, any>[] = [
      { role: r },
      { role_name: r },
      { primary_role: r },
      { user_role: r },
      { role: r, role_name: r },
    ];
    for (const p of payloads) {
      try {
        await api.updateUserWithFallbacks(uid, p);
        return true;
      } catch {
        /* next */
      }
    }
  }
  return false;
}

function userRowDisplayName(u: any): string {
  if (!u || typeof u !== 'object') return '';
  const profile = u.profile || u.user_profile || {};
  const emp = u.employee || u.employee_details || {};
  const combinedFromProfile = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  const combinedFromRoot = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  const combinedFromEmployee = [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim();
  /** When both first and last exist, use them first — `full_name` often holds only a first name. */
  const bothFromProfile =
    Boolean(String(profile.first_name ?? '').trim()) && Boolean(String(profile.last_name ?? '').trim());
  const bothFromRoot =
    Boolean(String(u.first_name ?? '').trim()) && Boolean(String(u.last_name ?? '').trim());
  const bothFromEmployee =
    Boolean(String(emp.first_name ?? '').trim()) && Boolean(String(emp.last_name ?? '').trim());
  const preferCombined = bothFromProfile || bothFromRoot || bothFromEmployee;
  let combined = '';
  if (bothFromProfile) combined = combinedFromProfile;
  else if (bothFromRoot) combined = combinedFromRoot;
  else if (bothFromEmployee) combined = combinedFromEmployee;
  else combined = combinedFromProfile || combinedFromRoot || combinedFromEmployee;
  if (preferCombined) {
    return pickFirstNonEmpty(combined, profile.full_name, u.full_name, u.username, u.email);
  }
  return pickFirstNonEmpty(profile.full_name, u.full_name, combined, u.username, u.email);
}

function registerNameLookup(acc: Map<string, string>, idRaw: string, name: string) {
  const id = String(idRaw || '').trim();
  const nm = String(name || '').trim();
  if (!id || !nm) return;
  acc.set(id, nm);
  acc.set(id.replace(/-/g, '').toLowerCase(), nm);
}

function buildUserAddedByLookup(users: any[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of users) {
    const id = String(u?.id ?? u?.pk ?? u?.uuid ?? '').trim();
    if (!id) continue;
    const nm = userRowDisplayName(u);
    if (nm) registerNameLookup(m, id, nm);
  }
  return m;
}

function nestedCreatorDisplayName(obj: any): string {
  if (!obj || typeof obj !== 'object') return '';
  return pickFirstNonEmpty(
    obj.full_name,
    [obj.first_name, obj.last_name].filter(Boolean).join(' '),
    obj.name,
    obj.username,
    obj.email
  );
}

function lookupName(nameById: Map<string, string>, rawId: string): string {
  const s = String(rawId || '').trim();
  if (!s) return '';
  return nameById.get(s) || nameById.get(s.replace(/-/g, '').toLowerCase()) || '';
}

/** Resolve "Added by" from nested objects, string ids, or *_id fields against the user list. */
function resolveAddedByDisplay(u: any, nameById: Map<string, string>): string {
  const fromNested =
    nestedCreatorDisplayName(
      u.created_by && typeof u.created_by === 'object' ? u.created_by : null
    ) ||
    nestedCreatorDisplayName(u.added_by && typeof u.added_by === 'object' ? u.added_by : null);
  if (fromNested) return fromNested;

  const idCandidates: any[] = [
    u.created_by_id,
    u.added_by_id,
    typeof u.created_by === 'string' || typeof u.created_by === 'number' ? u.created_by : null,
    typeof u.added_by === 'string' || typeof u.added_by === 'number' ? u.added_by : null,
    u.invited_by_id,
    u.invited_by,
    u.inviter_id,
    u.inviter,
    u.owner_id,
  ];

  for (const raw of idCandidates) {
    if (raw == null || raw === '') continue;
    if (typeof raw === 'object') {
      const n = nestedCreatorDisplayName(raw);
      if (n) return n;
      const oid = String((raw as any).id ?? (raw as any).pk ?? '').trim();
      if (oid) {
        const hit = lookupName(nameById, oid);
        if (hit) return hit;
      }
      continue;
    }
    const hit = lookupName(nameById, String(raw));
    if (hit) return hit;
  }

  return pickFirstNonEmpty(
    u.added_by_name,
    u.added_by_display,
    u.creator_name,
    u.created_by_name,
    u.created_by_email,
    u.added_by_email
  );
}

/** Strip empty values; recurse into plain objects (for nested profile payloads). */
function stripPayloadForApi(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const inner = stripPayloadForApi(v as Record<string, any>);
      if (Object.keys(inner).length > 0) out[k] = inner;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * After `createUser` the server often persists only email/username/password.
 * PATCH user + scheduler employee so full name, phone, and employee PIN appear in User Management.
 */
async function hydrateCreatedUserDisplayFields(
  userId: string,
  email: string,
  fullName: string,
  firstName: string,
  lastName: string,
  phoneDigits: string | undefined,
  companyId: string,
  role: string,
  employeePin: string | undefined,
  hourlyRate: number | string | undefined
): Promise<void> {
  const uid = String(userId || '').trim();
  if (!uid) return;
  const phone = phoneDigits && String(phoneDigits).trim() ? String(phoneDigits).trim() : undefined;
  const pin = employeePin && String(employeePin).trim() ? String(employeePin).trim() : undefined;
  const namesOnly = stripPayloadForApi({
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
  });
  const nameBody = stripPayloadForApi({
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    phone,
    mobile_number: phone,
    mobile: phone,
    employee_pin: pin,
    pin,
  });
  const profileNested = stripPayloadForApi({
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    phone,
    mobile_number: phone,
    mobile: phone,
    employee_pin: pin,
    pin,
  });
  const userAttempts: Record<string, any>[] = [
    namesOnly,
    nameBody,
    stripPayloadForApi({ name: fullName, first_name: firstName, last_name: lastName }),
    stripPayloadForApi({ profile: profileNested }),
    stripPayloadForApi({ user_profile: profileNested }),
    stripPayloadForApi({ employee_profile: profileNested }),
  ];
  for (const body of userAttempts) {
    if (Object.keys(body).length === 0) continue;
    try {
      await api.updateUserWithFallbacks(uid, body);
    } catch {
      /* try next shape — backends differ on flat vs nested profile and phone field names */
    }
  }

  if (role !== 'employee') return;
  const cid = String(companyId || '').trim();
  if (!cid) return;
  try {
    let linked: any = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      linked = await api.findSchedulerEmployeeForAuthUser({
        id: uid,
        email,
        company_id: cid,
        assigned_company: cid,
      });
      if (linked?.id) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const eid = linked?.id ? String(linked.id).trim() : '';
    if (!eid) return;
    const hr =
      hourlyRate != null && hourlyRate !== '' && !Number.isNaN(Number(hourlyRate))
        ? Number(hourlyRate)
        : undefined;
    await api.updateSchedulerEmployeeWithFallbacks(eid, [
      stripPayloadForApi({
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        mobile_number: phone,
        mobile: phone,
        employee_pin: pin,
        pin,
        clock_pin: pin,
        hourly_rate: hr,
      }),
      stripPayloadForApi({
        first_name: firstName,
        last_name: lastName,
        email,
        employee_pin: pin,
        pin,
      }),
      stripPayloadForApi({ first_name: firstName, last_name: lastName, email }),
    ]);
  } catch {
    /* optional — user row may still have profile after PATCH */
  }
}

function resolveDepartmentDisplay(employee: any, profile: any, deptCatalog: any[]): string {
  const deptObj = employee?.department;
  if (deptObj && typeof deptObj === 'object' && (deptObj as any).name) {
    return String((deptObj as any).name);
  }
  const profDep = profile?.department;
  if (profDep && typeof profDep === 'object' && (profDep as any).name) {
    return String((profDep as any).name);
  }

  const stringCandidates = [
    typeof profDep === 'string' ? profDep : null,
    profile?.department_name,
    employee?.department_name,
    typeof deptObj === 'string' ? deptObj : null,
  ];
  for (const c of stringCandidates) {
    if (c == null || String(c).trim() === '') continue;
    const s = String(c).trim();
    if (isLikelyUuid(s)) {
      const hit = departmentNameFromCatalog(deptCatalog, s);
      if (hit) return hit;
      continue;
    }
    return s;
  }

  const id = departmentPrimaryId({
    department: employee?.department,
    department_id: employee?.department_id ?? profile?.department_id,
  });
  if (id) {
    const hit = departmentNameFromCatalog(deptCatalog, id);
    if (hit) return hit;
  }
  return '—';
}

function lookupEntityName(catalog: any[], idRaw: string): string | null {
  const tid = String(idRaw || '').trim();
  if (!tid) return null;
  const row = catalog.find((r) =>
    normalizeDeptIdsEqual(String(r?.id ?? r?.pk ?? r?.uuid ?? ''), tid)
  );
  if (row && typeof row === 'object') {
    const n = String((row as any).name ?? '').trim();
    if (n) return n;
  }
  return null;
}

function collectCompanyIdCandidates(employee: any, profile: any, u: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (v == null || v === '') return;
    if (typeof v === 'object') {
      const id = (v as any).id ?? (v as any).pk ?? (v as any).uuid;
      if (id != null && String(id).trim() !== '') out.push(String(id).trim());
      return;
    }
    const s = String(v).trim();
    if (s) out.push(s);
  };
  push(employee?.company_id);
  push(employee?.company);
  push(profile?.company_id);
  push(profile?.company);
  push(employee?.assigned_company);
  push(profile?.assigned_company);
  push((u as any)?.company_id);
  push((u as any)?.company);
  push((u as any)?.assigned_company);
  return [...new Set(out)];
}

function pushOrgFromNestedCompany(push: (v: any) => void, companyField: any) {
  if (!companyField || typeof companyField !== 'object' || Array.isArray(companyField)) return;
  push((companyField as any).organization_id);
  push((companyField as any).organization);
}

function collectOrganizationIdCandidates(employee: any, profile: any, u: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (v == null || v === '') return;
    if (typeof v === 'object') {
      const id = (v as any).id ?? (v as any).pk ?? (v as any).uuid;
      if (id != null && String(id).trim() !== '') out.push(String(id).trim());
      return;
    }
    const s = String(v).trim();
    if (s) out.push(s);
  };
  push(employee?.organization_id);
  push(employee?.organization);
  push(profile?.organization_id);
  push(profile?.organization);
  push(profile?.org_id);
  push((u as any)?.organization_id);
  push((u as any)?.organization);
  push((u as any)?.org_id);
  push((u as any)?.assigned_organization);
  pushOrgFromNestedCompany(push, employee?.company);
  pushOrgFromNestedCompany(push, profile?.company);
  pushOrgFromNestedCompany(push, (u as any)?.company);
  return [...new Set(out)];
}

type OrgCompanyOption = { id: string; name: string };

/** Auth hints first; then org rows where this user is assigned organization manager (same client filter as Schedule). */
function organizationIdsForOperationsManagerViewer(viewerPayload: any, organizationRows: any[]): string[] {
  const u = resolveUserPayloadForRole(viewerPayload);
  const hints = api.organizationIdHintsFromAuthUser(u);
  const dedupe = (xs: string[]) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];
  if (hints.length > 0) return dedupe(hints as string[]);
  const uid = schedulerViewerUserId(u);
  if (!uid || !Array.isArray(organizationRows)) return [];
  const filtered = api.filterOrganizationsForOperationsManager(organizationRows, uid);
  return dedupe(
    filtered.map((o: any) => String(o?.id ?? o?.pk ?? '').trim()).filter(Boolean)
  );
}

/** Auth hints first; then company rows where this user is the company manager. */
function companyIdsForManagerViewer(viewerPayload: any, companyRows: any[]): string[] {
  const u = resolveUserPayloadForRole(viewerPayload);
  const hints = api.companyIdHintsFromAuthUser(u);
  const dedupe = (xs: string[]) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];
  if (hints.length > 0) return dedupe(hints as string[]);
  const uid = schedulerViewerUserId(u);
  if (!uid || !Array.isArray(companyRows)) return [];
  const found: string[] = [];
  for (const c of companyRows) {
    const mid = String(api.resolveCompanyManagerUserId(c) ?? '').trim();
    if (mid && mid === uid) {
      const id = String((c as any).id ?? (c as any).pk ?? '').trim();
      if (id) found.push(id);
    }
  }
  return dedupe(found);
}

function companyIdsUnderOrganizations(orgIds: string[], companyRows: any[]): Set<string> {
  const oid = new Set(orgIds.map((x) => String(x).trim()).filter(Boolean));
  const out = new Set<string>();
  if (oid.size === 0 || !Array.isArray(companyRows)) return out;
  for (const c of companyRows) {
    const orgRaw = (c as any).organization_id ?? (c as any).organization;
    let orgId = '';
    if (orgRaw != null && typeof orgRaw === 'object' && (orgRaw as any).id != null) {
      orgId = String((orgRaw as any).id).trim();
    } else if (orgRaw != null && orgRaw !== '') {
      orgId = String(orgRaw).trim();
    }
    if (orgId && oid.has(orgId)) {
      const cid = String((c as any).id ?? (c as any).pk ?? '').trim();
      if (cid) out.add(cid);
    }
  }
  return out;
}

function filterRowsForViewerScope(
  list: RowUser[],
  viewerPayload: any,
  viewerRole: UserRole,
  companyRows: any[],
  organizationRows: any[]
): RowUser[] {
  if (viewerRole === 'super_admin') return list;

  if (viewerRole === 'organization_manager') {
    const orgIds = organizationIdsForOperationsManagerViewer(viewerPayload, organizationRows);
    const oidSet = new Set(orgIds);
    const companiesInScope = companyIdsUnderOrganizations(orgIds, companyRows);
    if (oidSet.size === 0 && companiesInScope.size === 0) {
      if (__DEV__) {
        console.warn('[UserManagement] organization_manager: no org scope from hints or catalog; list not filtered.');
      }
      return list;
    }
    return list.filter((row) => {
      const raw = row.raw || {};
      const profile = raw.profile || {};
      const employee = raw.employee || raw.employee_details || {};
      const orgCand = collectOrganizationIdCandidates(employee, profile, raw);
      const compCand = collectCompanyIdCandidates(employee, profile, raw);
      if (orgCand.some((id) => oidSet.has(String(id).trim()))) return true;
      if (compCand.some((id) => companiesInScope.has(String(id).trim()))) return true;
      return false;
    });
  }

  if (viewerRole === 'company_manager') {
    const companyIds = companyIdsForManagerViewer(viewerPayload, companyRows);
    const cidSet = new Set(companyIds);
    if (cidSet.size === 0) {
      if (__DEV__) {
        console.warn('[UserManagement] manager: no company scope from hints or catalog; list not filtered.');
      }
      return list;
    }
    return list.filter((row) => {
      const raw = row.raw || {};
      const profile = raw.profile || {};
      const employee = raw.employee || raw.employee_details || {};
      const ids = collectCompanyIdCandidates(employee, profile, raw);
      return ids.some((id) => cidSet.has(String(id).trim()));
    });
  }

  return [];
}

function dedupeOrgCompanyOptions(items: OrgCompanyOption[]): OrgCompanyOption[] {
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** Normalize FK fields that may be uuid strings or nested `{ id }` objects. */
function normalizeEntityId(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && !Array.isArray(v) && v !== null) {
    const id = (v as { id?: unknown }).id ?? (v as { pk?: unknown }).pk;
    if (id != null && String(id).trim() !== '') return String(id).trim();
    return '';
  }
  return String(v).trim();
}

function organizationIdFromCompanyRow(c: any): string {
  const orgRaw = c?.organization_id ?? c?.organization;
  if (orgRaw != null && typeof orgRaw === 'object' && !Array.isArray(orgRaw)) {
    const nid = (orgRaw as any).id ?? (orgRaw as any).pk;
    if (nid != null) return String(nid).trim();
  }
  return String(orgRaw ?? '').trim();
}

/**
 * Loads companies for a single organization — same fallbacks as create-user (no new API shapes).
 * Filters client-side when only `getCompanies()` is available (handles nested organization FK).
 */
async function loadCompanyOptionsForOrganization(organizationId: string): Promise<OrgCompanyOption[]> {
  const oid = String(organizationId || '').trim();
  if (!oid) return [];
  const mapRows = (arr: any[]) =>
    (Array.isArray(arr) ? arr : []).map((c: any) => ({
      id: String(c.id),
      name: c.name || '—',
    }));
  const fetchCompanies = async (params: Record<string, any>): Promise<any[]> => {
    try {
      const r = await api.getCompanies({ page_size: 500, ...params });
      return Array.isArray(r) ? r : [];
    } catch {
      try {
        const r2 = await api.getCompanies(params);
        return Array.isArray(r2) ? r2 : [];
      } catch {
        return [];
      }
    }
  };
  let comps = await fetchCompanies({ organization: oid });
  if (comps.length === 0) comps = await fetchCompanies({ organization_id: oid });
  if (comps.length === 0) {
    const all = await fetchCompanies({});
    comps = all.filter((c: any) => organizationIdFromCompanyRow(c) === oid);
  }
  return mapRows(comps);
}

function optById<T extends { id: string }>(list: T[], id: string | undefined): T | undefined {
  const sid = String(id ?? '').trim();
  if (!sid) return undefined;
  return list.find((x) => String(x.id) === sid);
}

/** When to load department options — shared by Create and Edit (matches working Edit behavior). */
function shouldLoadDepartmentOptionsForUserForm(
  viewerRole: UserRole,
  role: string,
  companyId: string | undefined
): boolean {
  const cid = String(companyId || '').trim();
  if (!cid) return false;
  return (
    role === 'employee' ||
    viewerRole === 'company_manager' ||
    (viewerRole === 'organization_manager' && role === 'employee')
  );
}

async function loadDepartmentOptionsFromCatalogs(
  organizationId: string | undefined,
  companyId: string | undefined,
  orgList: { id: string; name: string }[],
  companyList: { id: string; name: string }[]
): Promise<DepartmentOption[]> {
  const orgName = optById(orgList, organizationId)?.name;
  const compName = optById(companyList, companyId)?.name;
  return loadDepartmentOptions(api, {
    organizationId,
    companyId,
    organizationName: orgName,
    companyName: compName,
  });
}

/** Org/company pickers for create, edit, and assign — scoped for org and company managers. */
async function loadScopedOrgCompanyForViewer(
  viewerPayload: any,
  viewerRole: UserRole,
  opts?: { organizationRows?: any[]; companyRows?: any[] }
): Promise<{ orgs: OrgCompanyOption[]; companies: OrgCompanyOption[] }> {
  const u = resolveUserPayloadForRole(viewerPayload);

  if (viewerRole === 'super_admin') {
    try {
      const orgsRaw = await api.getOrganizations();
      const orgs = (Array.isArray(orgsRaw) ? orgsRaw : []).map((o: any) => ({
        id: String(o.id),
        name: o.name || '—',
      }));
      let companies: OrgCompanyOption[] = [];
      try {
        const compsRaw = await api.getCompanies();
        companies = (Array.isArray(compsRaw) ? compsRaw : []).map((c: any) => ({
          id: String(c.id),
          name: c.name || '—',
        }));
      } catch {
        companies = [];
      }
      return { orgs, companies };
    } catch {
      return { orgs: [], companies: [] };
    }
  }

  if (viewerRole === 'organization_manager') {
    let orgRows = opts?.organizationRows;
    /** Many DRF backends do not filter `/scheduler/organizations/` by manager FK — those params return 400. */
    if (!Array.isArray(orgRows) || orgRows.length === 0) {
      try {
        orgRows = await api.getOrganizations({ page_size: 500 });
      } catch {
        try {
          orgRows = await api.getOrganizations();
        } catch {
          orgRows = [];
        }
      }
    }
    orgRows = Array.isArray(orgRows) ? orgRows : [];
    let orgIdList = organizationIdsForOperationsManagerViewer(viewerPayload, orgRows);
    /** Company hints / employee resolution do not require a numeric `user.id` (email-only auth still resolves). */
    if (orgIdList.length === 0) {
      const seen = new Set(orgIdList);
      for (const cid of api.companyIdHintsFromAuthUser(u)) {
        if (!cid) continue;
        try {
          const c = await api.getCompany(String(cid).trim());
          const oid = organizationIdFromCompanyRow(c);
          if (oid && !seen.has(oid)) {
            seen.add(oid);
            orgIdList.push(oid);
          }
        } catch {
          /* ignore */
        }
      }
    }
    if (orgIdList.length === 0) {
      const seen = new Set(orgIdList);
      try {
        const emp = await api.resolveEmployeeForUser(u);
        if (emp && typeof emp === 'object') {
          let oid = normalizeEntityId((emp as any).organization_id ?? (emp as any).organization);
          if (!oid) {
            const cid = normalizeEntityId((emp as any).company_id ?? (emp as any).company);
            if (cid) {
              try {
                const c = await api.getCompany(cid);
                oid = organizationIdFromCompanyRow(c);
              } catch {
                /* ignore */
              }
            }
          }
          if (oid && !seen.has(oid)) {
            seen.add(oid);
            orgIdList.push(oid);
          }
        }
      } catch {
        /* ignore */
      }
    }

    const orgs: OrgCompanyOption[] = [];
    const companies: OrgCompanyOption[] = [];
    let allCompaniesCache: any[] | null = null;
    const getAllCompaniesOnce = async () => {
      if (allCompaniesCache) return allCompaniesCache;
      let all: any[] = [];
      try {
        all = await api.getCompanies({ page_size: 500 });
      } catch {
        try {
          all = await api.getCompanies();
        } catch {
          all = [];
        }
      }
      allCompaniesCache = Array.isArray(all) ? all : [];
      return allCompaniesCache;
    };
    for (const oid of orgIdList) {
      if (!oid) continue;
      try {
        const o = await api.getOrganization(oid);
        if (o?.id != null) orgs.push({ id: String(o.id), name: o.name || '—' });
      } catch {
        orgs.push({ id: String(oid), name: '—' });
      }
      let loaded = false;
      try {
        const cs = await api.getCompanies({ organization_id: oid, page_size: 500 });
        const arr = Array.isArray(cs) ? cs : [];
        for (const c of arr) {
          companies.push({ id: String(c.id), name: c.name || '—' });
        }
        loaded = arr.length > 0;
      } catch {
        /* try alternate param */
      }
      if (!loaded) {
        try {
          const cs2 = await api.getCompanies({ organization: oid, page_size: 500 });
          const arr = Array.isArray(cs2) ? cs2 : [];
          for (const c of arr) {
            companies.push({ id: String(c.id), name: c.name || '—' });
          }
          loaded = arr.length > 0;
        } catch {
          /* ignore */
        }
      }
      if (!loaded) {
        try {
          const rows = await getAllCompaniesOnce();
          for (const c of rows) {
            if (organizationIdFromCompanyRow(c) === oid) {
              companies.push({ id: String(c.id), name: c.name || '—' });
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return { orgs: dedupeOrgCompanyOptions(orgs), companies: dedupeOrgCompanyOptions(companies) };
  }

  if (viewerRole === 'company_manager') {
    let compRows = opts?.companyRows;
    if (!Array.isArray(compRows) || compRows.length === 0) {
      try {
        compRows = await api.getCompanies();
      } catch {
        compRows = [];
      }
    }
    compRows = Array.isArray(compRows) ? compRows : [];
    const companyIdList = companyIdsForManagerViewer(viewerPayload, compRows);

    const orgs: OrgCompanyOption[] = [];
    const companies: OrgCompanyOption[] = [];
    for (const cid of companyIdList) {
      if (!cid) continue;
      try {
        const c = await api.getCompany(cid);
        if (!c?.id) continue;
        companies.push({ id: String(c.id), name: c.name || '—' });
        const orgRef = c.organization_id ?? c.organization;
        const orgId =
          orgRef != null && typeof orgRef === 'object' && (orgRef as any).id != null
            ? String((orgRef as any).id)
            : String(orgRef || '').trim();
        if (orgId) {
          try {
            const o = await api.getOrganization(orgId);
            if (o?.id != null) orgs.push({ id: String(o.id), name: o.name || '—' });
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }
    return { orgs: dedupeOrgCompanyOptions(orgs), companies: dedupeOrgCompanyOptions(companies) };
  }

  return { orgs: [], companies: [] };
}

/**
 * Resolves the viewer organization id for an organization_manager when auth hints and row data are sparse.
 * Pass `preScoped` when `loadScopedOrgCompanyForViewer` was already awaited to avoid duplicate work.
 */
async function resolveOrganizationIdForOrganizationManagerUser(
  me: any,
  preScoped?: { orgs: OrgCompanyOption[]; companies: OrgCompanyOption[] }
): Promise<string> {
  const u = resolveUserPayloadForRole(me);
  const oh = api.organizationIdHintsFromAuthUser(u);
  if (oh[0]) return String(oh[0]).trim();
  const scoped =
    preScoped ?? (await loadScopedOrgCompanyForViewer(u, 'organization_manager'));
  if (scoped.orgs[0]?.id) return String(scoped.orgs[0].id).trim();
  if (scoped.companies[0]?.id) {
    try {
      const c = await api.getCompany(String(scoped.companies[0].id).trim());
      const oid = organizationIdFromCompanyRow(c);
      if (oid) return oid;
    } catch {
      /* ignore */
    }
  }
  const ch = api.companyIdHintsFromAuthUser(u);
  if (ch[0]) {
    try {
      const c = await api.getCompany(String(ch[0]).trim());
      const oid = organizationIdFromCompanyRow(c);
      if (oid) return oid;
    } catch {
      /* ignore */
    }
  }
  try {
    const emp = await api.resolveEmployeeForUser(u);
    if (emp && typeof emp === 'object') {
      let oid = normalizeEntityId((emp as any).organization_id ?? (emp as any).organization);
      if (oid) return oid;
      const cid = normalizeEntityId((emp as any).company_id ?? (emp as any).company);
      if (cid) {
        try {
          const c = await api.getCompany(cid);
          oid = organizationIdFromCompanyRow(c);
          if (oid) return oid;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const rows = await api.getOrganizations({ page_size: 500 }).catch(() => [] as any[]);
    const ids = organizationIdsForOperationsManagerViewer(me, Array.isArray(rows) ? rows : []);
    if (ids[0]) return String(ids[0]).trim();
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * Replace raw company/org UUIDs with names from loaded catalogs (Users + Admins tables).
 */
function polishOrganizationCompanyLabel(
  primary: string,
  employee: any,
  profile: any,
  u: any,
  companies: any[],
  orgs: any[]
): string {
  const raw = String(primary || '').trim();
  const companyIds = collectCompanyIdCandidates(employee, profile, u);
  const orgIds = collectOrganizationIdCandidates(employee, profile, u);

  const namesFromIds = (): string => {
    const cNames = companyIds.map((id) => lookupEntityName(companies, id)).filter(Boolean) as string[];
    const oNames = orgIds.map((id) => lookupEntityName(orgs, id)).filter(Boolean) as string[];
    if (oNames.length && cNames.length) return `${oNames[0]} · ${cNames[0]}`;
    if (cNames.length) return cNames[0];
    if (oNames.length) return oNames[0];
    return '';
  };

  const hasHumanLabel = raw && raw !== '—' && !isLikelyUuid(raw);
  if (hasHumanLabel) return raw;

  if (raw && isLikelyUuid(raw)) {
    const asCompany = lookupEntityName(companies, raw);
    if (asCompany) return asCompany;
    const asOrg = lookupEntityName(orgs, raw);
    if (asOrg) return asOrg;
  }

  const built = namesFromIds();
  if (built) return built;

  return '—';
}

function mapApiUser(
  u: any,
  ctx: {
    deptCatalog: any[];
    userNameById: Map<string, string>;
    companyRows: any[];
    organizationRows: any[];
  }
): RowUser {
  const profile = u.profile || u.user_profile || u.employee_profile || {};
  const employee = u.employee || u.employee_details || {};
  const title =
    pickFirstNonEmpty(
      profile.job_title,
      profile.title,
      employee.job_title,
      employee.position,
      employee.title
    ) ||
    getRoleDisplayLabel(getPrimaryRoleFromUser(u)) ||
    '—';
  const phone = pickFirstNonEmpty(
    profile.phone,
    profile.mobile_number,
    profile.phone_number,
    employee.phone,
    employee.mobile_number,
    employee.phone_number,
    u.phone,
    u.mobile_number,
    u.phone_number
  );
  const team = pickFirstNonEmpty(
    profile.team,
    employee.team,
    profile.team_name,
    employee.team_name
  );
  const organizationCompanyRaw = pickFirstNonEmpty(
    profile.organization_name,
    employee.organization_name,
    (u as any).organization_name,
    (u as any).company_name,
    typeof (u as any)?.assigned_company === 'object' && (u as any).assigned_company?.name
      ? String((u as any).assigned_company.name)
      : null,
    typeof (u as any)?.assigned_organization === 'object' && (u as any).assigned_organization?.name
      ? String((u as any).assigned_organization.name)
      : null,
    typeof employee?.organization === 'object' && (employee.organization as any)?.name
      ? String((employee.organization as any).name)
      : null,
    typeof u?.organization === 'object' && (u.organization as any)?.name
      ? String((u.organization as any).name)
      : null,
    typeof (employee as any)?.company === 'object' &&
      (employee as any).company &&
      typeof (employee as any).company.organization === 'object' &&
      (employee as any).company.organization?.name
      ? String((employee as any).company.organization.name)
      : null,
    typeof employee?.company === 'object' && (employee.company as any)?.name
      ? String((employee.company as any).name)
      : null,
    typeof employee?.company === 'string' && String(employee.company).trim()
      ? String(employee.company).trim()
      : null,
    profile.company_name,
    employee.company_name,
    typeof u?.company === 'object' && (u.company as any)?.name ? String((u.company as any).name) : null,
    typeof u?.company === 'string' && String(u.company).trim() ? String(u.company).trim() : null,
    profile.org_name
  );
  const organizationCompany = polishOrganizationCompanyLabel(
    organizationCompanyRaw || '—',
    employee,
    profile,
    u,
    ctx.companyRows,
    ctx.organizationRows
  );
  const department = resolveDepartmentDisplay(employee, profile, ctx.deptCatalog);
  const pin = pickFirstNonEmpty(
    profile.employee_pin,
    profile.pin,
    employee.employee_pin,
    employee.pin,
    (employee as any)?.clock_pin,
    u.employee_pin,
    u.pin,
    (u as any)?.scheduler_pin
  );
  const addedBy = resolveAddedByDisplay(u, ctx.userNameById);
  return {
    id: String(u.id),
    username: u.username || (u.email ? String(u.email).split('@')[0] : '') || '—',
    email: u.email || profile.email || '—',
    full_name: userRowDisplayName(u) || '—',
    phone: phone || '—',
    title: title || '—',
    team: team || '—',
    organizationCompany: organizationCompany || '—',
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
  orgCompany: 148,
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
  | 'orgCompany'
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
  orgCompany: COL.orgCompany,
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
  orgCompany: true,
  team: false,
  department: true,
  pin: true,
  dateAdded: true,
  lastLogin: false,
  addedBy: true,
};

const COL_LABELS: Record<ColumnKey, string> = {
  username: 'Username',
  email: 'Email',
  fullName: 'Full name',
  phone: 'Phone',
  title: 'Title',
  orgCompany: 'Organization / Company',
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

const FULL_ROLE_PICKER_OPTIONS: { id: string; label: string }[] = [
  { id: 'employee', label: 'Employee' },
  { id: 'company_manager', label: 'Company Manager' },
  { id: 'organization_manager', label: 'Organization Manager' },
  { id: 'super_admin', label: 'Super Admin' },
];

export default function UserManagementScreen() {
  const { user, role: sessionRole } = useAuth();
  /**
   * Prefer auth `sessionRole` when it is an elevated role; otherwise derive from `user` so Organization
   * Manager / Company Manager still get scoped pickers when `/auth/user/` and session disagree.
   */
  const viewerRoleForUi = useMemo((): UserRole => {
    if (
      sessionRole === 'super_admin' ||
      sessionRole === 'organization_manager' ||
      sessionRole === 'company_manager'
    ) {
      return sessionRole as UserRole;
    }
    if (user) return getPrimaryRoleFromUser(resolveUserPayloadForRole(user as any));
    return 'employee';
  }, [sessionRole, user]);

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

  /** Web UI: Admins table uses Organization / Company (not a separate Team column), and omits Department + PIN. */
  const effectiveVisibleCols = useMemo((): Record<ColumnKey, boolean> => {
    if (tab !== 'admins') return visibleCols;
    return { ...visibleCols, department: false, pin: false, team: false };
  }, [tab, visibleCols]);

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
    department_id: '',
  });
  const [editForm, setEditForm] = useState({
    username: '',
    email: '',
    full_name: '',
    phone: '',
    job_title: '',
    role: 'employee' as string,
    organization_id: '',
    company_id: '',
    department_id: '',
    employee_pin: '',
    hourly_rate: '',
  });

  const handleCreatePhoneChange = useCallback((text: string) => {
    setForm((f) => ({ ...f, phone: formatUsPhoneDisplay(digitsOnly(text)) }));
  }, []);

  const handleEditPhoneChange = useCallback((text: string) => {
    setEditForm((f) => ({ ...f, phone: formatUsPhoneDisplay(digitsOnly(text)) }));
  }, []);

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
  const [deptCreateOptions, setDeptCreateOptions] = useState<DepartmentOption[]>([]);
  const [deptEditOptions, setDeptEditOptions] = useState<DepartmentOption[]>([]);
  const [createDeptPicker, setCreateDeptPicker] = useState(false);
  const [editDeptPicker, setEditDeptPicker] = useState(false);
  const editDeptNameHintRef = useRef<string | null>(null);
  const prevCreateCompanyIdRef = useRef<string>('');
  const prevEditCompanyIdRef = useRef<string>('');
  /** Incremented on each open so stale async hydration does not overwrite state after close/reopen. */
  const createModalHydrateGenRef = useRef(0);

  const createEditRolePickerOptions = useMemo(() => {
    if (viewerRoleForUi === 'company_manager') {
      return FULL_ROLE_PICKER_OPTIONS.filter((o) => o.id === 'employee');
    }
    if (viewerRoleForUi === 'organization_manager') {
      return FULL_ROLE_PICKER_OPTIONS.filter((o) => o.id !== 'super_admin' && o.id !== 'organization_manager');
    }
    return FULL_ROLE_PICKER_OPTIONS;
  }, [viewerRoleForUi]);

  const assignRolePickerOptions = useMemo(() => {
    if (viewerRoleForUi === 'company_manager') {
      return FULL_ROLE_PICKER_OPTIONS.filter((o) => o.id === 'employee');
    }
    if (viewerRoleForUi === 'organization_manager') {
      return FULL_ROLE_PICKER_OPTIONS.filter((o) => o.id !== 'super_admin');
    }
    return FULL_ROLE_PICKER_OPTIONS;
  }, [viewerRoleForUi]);

  /** Show / load org–company–department fields consistently (avoid hiding rows when role string drifts). */
  const showCreateDepartmentSection =
    viewerRoleForUi === 'company_manager' ||
    viewerRoleForUi === 'organization_manager' ||
    form.role === 'employee';
  const createDeptPickerInteractive = shouldLoadDepartmentOptionsForUserForm(
    viewerRoleForUi,
    form.role,
    form.company_id
  );
  const showEditDepartmentSection =
    viewerRoleForUi === 'company_manager' ||
    viewerRoleForUi === 'organization_manager' ||
    editForm.role === 'employee';
  const editDeptPickerInteractive = shouldLoadDepartmentOptionsForUserForm(
    viewerRoleForUi,
    editForm.role,
    editForm.company_id
  );

  const createOrgPickerLocked =
    viewerRoleForUi === 'company_manager' || (viewerRoleForUi === 'organization_manager' && createOrgList.length <= 1);
  const createCompanyPickerLocked = viewerRoleForUi === 'company_manager';
  const editOrgPickerLocked =
    viewerRoleForUi === 'company_manager' || (viewerRoleForUi === 'organization_manager' && editOrgList.length <= 1);
  const editCompanyPickerLocked = viewerRoleForUi === 'company_manager';
  const assignOrgPickerLocked = viewerRoleForUi === 'company_manager';
  const assignCompanyPickerLocked = viewerRoleForUi === 'company_manager';

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const userData = (await api.getCurrentUser()) as any;
      if (!canAccessUserManagement(userData)) {
        setAuthorized(false);
        setLoading(false);
        return;
      }
      setAuthorized(true);
      const [rawUsers, rawEmployees, rawOrgs, rawCompanies] = await Promise.all([
        api.getUsers({}).catch(() => []),
        api.getEmployees({}).catch(() => []),
        api.getOrganizations().catch(() => []),
        api.getCompanies().catch(() => []),
      ]);
      const users = Array.isArray(rawUsers) ? rawUsers : [];
      const employees = Array.isArray(rawEmployees) ? rawEmployees : [];
      const organizationRows = Array.isArray(rawOrgs) ? rawOrgs : [];
      const companyRows = Array.isArray(rawCompanies) ? rawCompanies : [];
      const userNameById = buildUserAddedByLookup(users);

      const companyIdSet = new Set<string>();
      for (const e of employees) {
        const c = e?.company_id ?? e?.company;
        const cid =
          c != null && typeof c === 'object' && (c as any).id != null
            ? String((c as any).id).trim()
            : String(c ?? '').trim();
        if (cid) companyIdSet.add(cid);
      }
      const deptCatalog: any[] = [];
      const seenDeptKey = new Set<string>();
      const pushDepts = (rows: any[]) => {
        for (const d of rows) {
          const id = String(d?.id ?? d?.pk ?? d?.uuid ?? '').trim();
          const key = id || `n:${String(d?.name ?? '').toLowerCase()}`;
          if (!key || key === 'n:') continue;
          if (!seenDeptKey.has(key)) {
            seenDeptKey.add(key);
            deptCatalog.push(d);
          }
        }
      };
      await Promise.all(
        [...companyIdSet].map(async (cid) => {
          try {
            const dr = await api.getDepartments({ company: cid });
            if (Array.isArray(dr)) pushDepts(dr);
          } catch {
            /* ignore */
          }
          try {
            const dr2 = await api.getDepartments({ company_id: cid });
            if (Array.isArray(dr2)) pushDepts(dr2);
          } catch {
            /* ignore */
          }
        })
      );

      // Fill sparse auth-user rows with scheduler employee details where available.
      const employeeByUserId = new Map<string, any>();
      const employeeByEmail = new Map<string, any>();
      for (const e of employees) {
        const uid = employeeSchedulerUserId(e);
        if (uid && !employeeByUserId.has(uid)) {
          employeeByUserId.set(uid, e);
        }
        const em = normalizeEmail(e?.email);
        if (em && !employeeByEmail.has(em)) employeeByEmail.set(em, e);
      }

      const enrichedUsers = users.map((u: any) => {
        const uid = String(u?.id ?? '');
        const em = normalizeEmail(u?.email ?? u?.profile?.email);
        const employee = employeeByUserId.get(uid) || (em ? employeeByEmail.get(em) : undefined);
        if (!employee) return u;
        const pDep = u?.profile?.department;
        const empDep = employee?.department;
        const mergedDept = pickFirstNonEmpty(
          typeof pDep === 'object' && pDep && (pDep as any).name ? String((pDep as any).name) : null,
          typeof pDep === 'string' ? pDep : null,
          employee?.department_name,
          typeof empDep === 'object' && empDep && (empDep as any).name ? String((empDep as any).name) : null,
          typeof empDep === 'string' ? empDep : null
        );
        return {
          ...u,
          employee,
          employee_details: employee,
          // Keep existing profile values; use employee as fallback.
          profile: {
            ...(u?.profile || {}),
            phone: pickFirstNonEmpty(u?.profile?.phone, employee?.phone, employee?.mobile_number),
            employee_pin: pickFirstNonEmpty(u?.profile?.employee_pin, employee?.employee_pin, employee?.pin),
            department: mergedDept || u?.profile?.department,
            team: pickFirstNonEmpty(u?.profile?.team, employee?.team_name, employee?.team),
            job_title: pickFirstNonEmpty(
              u?.profile?.job_title,
              u?.profile?.title,
              employee?.job_title,
              employee?.position,
              employee?.title
            ),
          },
        };
      });

      const list = enrichedUsers
        .filter((u: any) => (u.profile?.status ?? u.status) !== 'deleted')
        .map((u: any) =>
          mapApiUser(u, {
            deptCatalog,
            userNameById,
            companyRows,
            organizationRows,
          })
        );
      const viewerRole = getPrimaryRoleFromUser(userData);
      const scopedList = filterRowsForViewerScope(list, userData, viewerRole, companyRows, organizationRows);
      if (__DEV__) {
        console.log('Current User (User Management):', userData);
        console.log('Users List (scoped):', scopedList);
      }
      setRows(scopedList);
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
        let emps: any[] = [];
        try {
          emps = await api.getEmployees({ company: assignCompanyId });
        } catch {
          emps = [];
        }
        if (!Array.isArray(emps) || emps.length === 0) {
          try {
            const byId = await api.getEmployees({ company_id: assignCompanyId });
            emps = Array.isArray(byId) ? byId : [];
          } catch {
            emps = [];
          }
        }
        if (emps.length === 0) {
          const all = await api.getEmployees().catch(() => []);
          const rows = Array.isArray(all) ? all : [];
          const cid = String(assignCompanyId);
          emps = rows.filter((e: any) => String(e?.company_id ?? e?.company ?? '').trim() === cid);
        }
        const next = new Set<string>();
        for (const e of emps) {
          const uid = employeeSchedulerUserId(e);
          if (uid) next.add(uid);
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
        let comps: any[] = [];
        try {
          comps = await api.getCompanies({ organization: assignOrgId });
        } catch {
          comps = [];
        }
        if (!Array.isArray(comps) || comps.length === 0) {
          try {
            const byOid = await api.getCompanies({ organization_id: assignOrgId });
            comps = Array.isArray(byOid) ? byOid : [];
          } catch {
            comps = [];
          }
        }
        if (!Array.isArray(comps) || comps.length === 0) {
          const all = await api.getCompanies().catch(() => []);
          const oid = String(assignOrgId);
          comps = (Array.isArray(all) ? all : []).filter(
            (c: any) => String(c?.organization_id ?? c?.organization ?? '').trim() === oid
          );
        }
        const list = comps.map((c: any) => ({
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
    if (!createModal) return;
    if (!form.organization_id) {
      /**
       * Org / company managers often resolve `organization_id` after companies are prefetched — or
       * company managers only have `company_id` on the session until `getCompany` fills org.
       * Clearing the catalog here would wipe options and leave the Company row stuck on "Resolving…".
       */
      const keepCompanyList =
        viewerRoleForUi === 'organization_manager' ||
        (viewerRoleForUi === 'company_manager' &&
          (!!String(form.company_id || '').trim() || createCompanyList.length > 0));
      if (!keepCompanyList) {
        setCreateCompanyList([]);
      }
      if (viewerRoleForUi !== 'company_manager' && viewerRoleForUi !== 'organization_manager') {
        setForm((f) => ({ ...f, company_id: '', department_id: '' }));
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let list = await loadCompanyOptionsForOrganization(form.organization_id);
        const hintedComp = String(form.company_id || '').trim();
        if (list.length === 0 && viewerRoleForUi === 'company_manager' && hintedComp) {
          try {
            const c = await api.getCompany(hintedComp);
            list = [{ id: String(c.id), name: c.name || '—' }];
          } catch {
            /* keep list as []; preserve path below may still use prev */
          }
        }
        if (!cancelled) {
          setCreateCompanyList((prev) => {
            if (
              (viewerRoleForUi === 'organization_manager' ||
                viewerRoleForUi === 'company_manager') &&
              list.length === 0 &&
              prev.length > 0
            ) {
              return prev;
            }
            return list;
          });
        }
      } catch {
        if (!cancelled) {
          setCreateCompanyList((prev) =>
            (viewerRoleForUi === 'organization_manager' ||
              viewerRoleForUi === 'company_manager') &&
            prev.length > 0
              ? prev
              : []
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createModal, form.organization_id, form.company_id, viewerRoleForUi, createCompanyList.length]);

  /** When form has a company id not yet in the catalog (scoped list empty, timing), resolve label and optionally derive organization_id. */
  useEffect(() => {
    if (!createModal) return;
    const cid = String(form.company_id || '').trim();
    if (!cid) return;
    if (createCompanyList.some((c) => String(c.id) === cid)) return;
    let cancelled = false;
    (async () => {
      try {
        const co = await api.getCompany(cid);
        if (cancelled || !co?.id) return;
        const row = { id: String(co.id), name: co.name || '—' };
        setCreateCompanyList((prev) =>
          prev.some((p) => String(p.id) === row.id) ? prev : [...prev, row]
        );
        setForm((f) => {
          if (f.organization_id) return f;
          const orgRef = co?.organization_id ?? co?.organization;
          const oid =
            orgRef != null && typeof orgRef === 'object' && (orgRef as any).id != null
              ? String((orgRef as any).id).trim()
              : String(orgRef ?? '').trim();
          return oid ? { ...f, organization_id: oid } : f;
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createModal, form.company_id, createCompanyList, form.organization_id]);

  /** When org managers cannot pick company explicitly (or OM opens with empty company), keep form.company_id in sync with loaded companies so department loading runs. */
  useEffect(() => {
    if (!createModal) return;
    if (createCompanyList.length === 0) return;
    /** Company managers may have a single scoped company before `organization_id` is hydrated. */
    /** Organization managers: allow implicit first company once scoped companies loaded (org id may hydrate later). */
    if (!form.organization_id && viewerRoleForUi !== 'company_manager') {
      if (viewerRoleForUi !== 'organization_manager') return;
    }
    const cid = String(form.company_id || '').trim();
    const match = createCompanyList.some((c) => String(c.id) === cid);
    if (match) return;
    const firstId = String(createCompanyList[0].id).trim();
    if (!firstId) return;
    const needsImplicitCompany = viewerRoleForUi === 'company_manager' || viewerRoleForUi === 'organization_manager';
    if (!cid && !needsImplicitCompany) return;
    setForm((f) => ({ ...f, company_id: firstId, department_id: '' }));
  }, [createModal, createCompanyList, form.company_id, form.organization_id, viewerRoleForUi]);

  /** Company managers: no org/company pickers in UI — re-apply auth scope if openCreateUserModal left ids empty. */
  useEffect(() => {
    if (!createModal || viewerRoleForUi !== 'company_manager') return;
    if (form.organization_id && form.company_id) return;
    let cancelled = false;
    (async () => {
      try {
        const me = (await api.getCurrentUser()) as any;
        let nextOrg = String(form.organization_id || '').trim();
        let nextComp = String(form.company_id || '').trim();
        if (!nextComp) {
          const ch = api.companyIdHintsFromAuthUser(me);
          if (ch[0]) nextComp = String(ch[0]).trim();
        }
        if (!nextOrg) {
          const oh = api.organizationIdHintsFromAuthUser(me);
          if (oh[0]) nextOrg = String(oh[0]).trim();
        }
        if (!nextComp || !nextOrg) {
          try {
            const scoped = await loadScopedOrgCompanyForViewer(me, 'company_manager');
            if (!nextComp && scoped.companies[0]?.id) {
              nextComp = String(scoped.companies[0].id).trim();
            }
            if (!nextOrg && scoped.orgs[0]?.id) {
              nextOrg = String(scoped.orgs[0].id).trim();
            }
          } catch {
            /* ignore */
          }
        }
        if (nextComp && !nextOrg) {
          try {
            const c = await api.getCompany(nextComp);
            const orgRef = c?.organization_id ?? c?.organization;
            const oid =
              orgRef != null && typeof orgRef === 'object' && (orgRef as any).id != null
                ? String((orgRef as any).id).trim()
                : String(orgRef ?? '').trim();
            if (oid) nextOrg = oid;
          } catch {
            /* ignore */
          }
        }
        if (cancelled) return;
        setForm((f) => {
          const o = (f.organization_id || nextOrg || '').trim();
          const c = (f.company_id || nextComp || '').trim();
          if ((!o && !c) || (f.organization_id === o && f.company_id === c)) return f;
          return { ...f, organization_id: o || f.organization_id, company_id: c || f.company_id };
        });
        if (!cancelled && nextComp) {
          try {
            const c = await api.getCompany(String(nextComp).trim());
            if (cancelled || !c?.id) return;
            const row = { id: String(c.id), name: c.name || '—' };
            setCreateCompanyList((prev) =>
              prev.some((p) => String(p.id) === row.id) ? prev : [row]
            );
          } catch {
            if (!cancelled) {
              setCreateCompanyList([{ id: String(nextComp).trim(), name: '—' }]);
            }
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createModal, viewerRoleForUi, form.organization_id, form.company_id]);

  /**
   * Organization managers (create): hydrate org + companies whenever the modal is open and the company
   * catalog is still empty. Do NOT bail out only because `organization_id` is already set — `openCreateUserModal`
   * / auth hints can set org before companies load, which previously skipped this effect forever.
   */
  useEffect(() => {
    if (!createModal || viewerRoleForUi !== 'organization_manager') return;
    if (createCompanyList.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const me = (await api.getCurrentUser()) as any;
        const scoped = await loadScopedOrgCompanyForViewer(me, 'organization_manager');
        let nextOrg = String(form.organization_id || '').trim();
        if (!nextOrg) {
          nextOrg = await resolveOrganizationIdForOrganizationManagerUser(me, scoped);
          if (nextOrg && !cancelled) {
            setForm((f) => (f.organization_id ? f : { ...f, organization_id: nextOrg }));
          }
        }
        if (!nextOrg || cancelled) return;
        try {
          let cos = await loadCompanyOptionsForOrganization(nextOrg);
          if (cos.length === 0 && scoped.companies.length > 0) cos = scoped.companies;
          if (!cancelled) setCreateCompanyList(cos);
        } catch {
          if (!cancelled) setCreateCompanyList(scoped.companies.length ? scoped.companies : []);
        }
        try {
          const o = await api.getOrganization(nextOrg);
          if (cancelled) return;
          setCreateOrgList((prev) => {
            const id = String((o as any)?.id ?? nextOrg);
            const name = (o as any)?.name || '—';
            if (prev.some((p) => String(p.id) === id)) return prev;
            return dedupeOrgCompanyOptions([...prev, { id, name }]);
          });
        } catch {
          if (cancelled) return;
          setCreateOrgList((prev) => {
            if (prev.some((p) => String(p.id) === nextOrg)) return prev;
            return dedupeOrgCompanyOptions([...prev, { id: nextOrg, name: '—' }]);
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createModal, viewerRoleForUi, form.organization_id, createCompanyList.length]);

  useEffect(() => {
    if (!editModal) return;
    if (!editForm.organization_id) {
      const keepEditCompanies =
        viewerRoleForUi === 'organization_manager' ||
        (viewerRoleForUi === 'company_manager' && !!String(editForm.company_id || '').trim());
      if (!keepEditCompanies) {
        setEditCompanyList([]);
      }
      if (viewerRoleForUi !== 'company_manager' && viewerRoleForUi !== 'organization_manager') {
        setEditForm((f) => ({ ...f, company_id: '', department_id: '' }));
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await loadCompanyOptionsForOrganization(editForm.organization_id);
        if (!cancelled) {
          setEditCompanyList((prev) => {
            if (
              viewerRoleForUi === 'organization_manager' &&
              list.length === 0 &&
              prev.length > 0
            ) {
              return prev;
            }
            return list;
          });
        }
      } catch {
        if (!cancelled) {
          setEditCompanyList((prev) =>
            viewerRoleForUi === 'organization_manager' && prev.length > 0 ? prev : []
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editForm.organization_id, editModal, viewerRoleForUi]);

  /** Edit: merge company row from getCompany when list is missing the selected id (same as create hydration). */
  useEffect(() => {
    if (!editModal) return;
    const cid = String(editForm.company_id || '').trim();
    if (!cid) return;
    if (editCompanyList.some((c) => String(c.id) === cid)) return;
    let cancelled = false;
    (async () => {
      try {
        const co = await api.getCompany(cid);
        if (cancelled || !co?.id) return;
        const row = { id: String(co.id), name: co.name || '—' };
        setEditCompanyList((prev) =>
          prev.some((p) => String(p.id) === row.id) ? prev : [...prev, row]
        );
        setEditForm((f) => {
          if (f.organization_id) return f;
          const orgRef = co?.organization_id ?? co?.organization;
          const oid =
            orgRef != null && typeof orgRef === 'object' && (orgRef as any).id != null
              ? String((orgRef as any).id).trim()
              : String(orgRef ?? '').trim();
          return oid ? { ...f, organization_id: oid } : f;
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editModal, editForm.company_id, editCompanyList, editForm.organization_id]);

  /** Edit: when implicit company scope (OM/CM), pick first company if current id not in loaded list. */
  useEffect(() => {
    if (!editModal) return;
    if (editCompanyList.length === 0) return;
    if (!editForm.organization_id && viewerRoleForUi !== 'company_manager') {
      if (viewerRoleForUi !== 'organization_manager') return;
    }
    const cid = String(editForm.company_id || '').trim();
    const match = editCompanyList.some((c) => String(c.id) === cid);
    if (match) return;
    const firstId = String(editCompanyList[0].id).trim();
    if (!firstId) return;
    const needsImplicitCompany = viewerRoleForUi === 'company_manager' || viewerRoleForUi === 'organization_manager';
    if (!cid && !needsImplicitCompany) return;
    setEditForm((f) => ({ ...f, company_id: firstId, department_id: '' }));
  }, [editModal, editCompanyList, editForm.company_id, editForm.organization_id, viewerRoleForUi]);

  /** Edit: company managers — fill org/company from auth scope when row data is incomplete. */
  useEffect(() => {
    if (!editModal || viewerRoleForUi !== 'company_manager') return;
    if (editForm.organization_id && editForm.company_id) return;
    let cancelled = false;
    (async () => {
      try {
        const me = (await api.getCurrentUser()) as any;
        let nextOrg = String(editForm.organization_id || '').trim();
        let nextComp = String(editForm.company_id || '').trim();
        if (!nextComp) {
          const ch = api.companyIdHintsFromAuthUser(me);
          if (ch[0]) nextComp = String(ch[0]).trim();
        }
        if (!nextOrg) {
          const oh = api.organizationIdHintsFromAuthUser(me);
          if (oh[0]) nextOrg = String(oh[0]).trim();
        }
        if (nextComp && !nextOrg) {
          try {
            const c = await api.getCompany(nextComp);
            const orgRef = c?.organization_id ?? c?.organization;
            const oid =
              orgRef != null && typeof orgRef === 'object' && (orgRef as any).id != null
                ? String((orgRef as any).id).trim()
                : String(orgRef ?? '').trim();
            if (oid) nextOrg = oid;
          } catch {
            /* ignore */
          }
        }
        if (cancelled) return;
        setEditForm((f) => {
          const o = (f.organization_id || nextOrg || '').trim();
          const c = (f.company_id || nextComp || '').trim();
          if ((!o && !c) || (f.organization_id === o && f.company_id === c)) return f;
          return { ...f, organization_id: o || f.organization_id, company_id: c || f.company_id };
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editModal, viewerRoleForUi, editForm.organization_id, editForm.company_id]);

  /** Edit: organization managers — same guard as create (org id can exist before company rows hydrate). */
  useEffect(() => {
    if (!editModal || viewerRoleForUi !== 'organization_manager') return;
    if (editCompanyList.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const me = (await api.getCurrentUser()) as any;
        const scoped = await loadScopedOrgCompanyForViewer(me, 'organization_manager');
        let nextOrg = String(editForm.organization_id || '').trim();
        if (!nextOrg) {
          nextOrg = await resolveOrganizationIdForOrganizationManagerUser(me, scoped);
          if (nextOrg && !cancelled) {
            setEditForm((f) => (f.organization_id ? f : { ...f, organization_id: nextOrg }));
          }
        }
        if (!nextOrg || cancelled) return;
        try {
          let cos = await loadCompanyOptionsForOrganization(nextOrg);
          if (cos.length === 0 && scoped.companies.length > 0) cos = scoped.companies;
          if (!cancelled) setEditCompanyList(cos);
        } catch {
          if (!cancelled) setEditCompanyList(scoped.companies.length ? scoped.companies : []);
        }
        try {
          const o = await api.getOrganization(nextOrg);
          if (cancelled) return;
          setEditOrgList((prev) => {
            const id = String((o as any)?.id ?? nextOrg);
            const name = (o as any)?.name || '—';
            if (prev.some((p) => String(p.id) === id)) return prev;
            return dedupeOrgCompanyOptions([...prev, { id, name }]);
          });
        } catch {
          if (cancelled) return;
          setEditOrgList((prev) => {
            if (prev.some((p) => String(p.id) === nextOrg)) return prev;
            return dedupeOrgCompanyOptions([...prev, { id: nextOrg, name: '—' }]);
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editModal, viewerRoleForUi, editForm.organization_id, editCompanyList.length]);

  /** Company managers always create employees; keep role aligned so department section + loaders stay in sync with edit. */
  useEffect(() => {
    if (!createModal || viewerRoleForUi !== 'company_manager') return;
    setForm((f) => (f.role === 'employee' ? f : { ...f, role: 'employee' }));
  }, [createModal, viewerRoleForUi]);

  useEffect(() => {
    if (!createModal) {
      setDeptCreateOptions([]);
      prevCreateCompanyIdRef.current = '';
      return;
    }
    const cid = String(form.company_id || '').trim();
    const shouldLoadDepts = shouldLoadDepartmentOptionsForUserForm(
      viewerRoleForUi,
      form.role,
      form.company_id
    );
    if (!shouldLoadDepts) {
      setDeptCreateOptions([]);
      prevCreateCompanyIdRef.current = '';
      if (!cid) {
        setForm((f) => (f.department_id ? { ...f, department_id: '' } : f));
      } else if (form.role !== 'employee' && viewerRoleForUi === 'organization_manager') {
        setForm((f) => (f.department_id ? { ...f, department_id: '' } : f));
      }
      return;
    }
    const cur = String(form.company_id);
    if (prevCreateCompanyIdRef.current && prevCreateCompanyIdRef.current !== cur) {
      setForm((f) => ({ ...f, department_id: '' }));
    }
    prevCreateCompanyIdRef.current = cur;
    let cancelled = false;
    (async () => {
      const list = await loadDepartmentOptionsFromCatalogs(
        form.organization_id,
        form.company_id,
        createOrgList,
        createCompanyList
      );
      if (__DEV__) {
        console.log('[UserMgmt][userForm] MODE: create');
        console.log('[UserMgmt][userForm] viewerRole:', viewerRoleForUi);
        console.log('[UserMgmt][userForm] org:', form.organization_id, 'company:', form.company_id, 'dept:', form.department_id);
        console.log('[UserMgmt][userForm] companies catalog:', createCompanyList.length, 'dept options:', list.length);
      }
      if (!cancelled) setDeptCreateOptions(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    createModal,
    form.company_id,
    form.organization_id,
    form.role,
    createCompanyList,
    createOrgList,
    viewerRoleForUi,
  ]);

  useEffect(() => {
    if (!editModal) {
      setDeptEditOptions([]);
      prevEditCompanyIdRef.current = '';
      return;
    }
    const cid = String(editForm.company_id || '').trim();
    const shouldLoadDepts = shouldLoadDepartmentOptionsForUserForm(
      viewerRoleForUi,
      editForm.role,
      editForm.company_id
    );
    if (!shouldLoadDepts) {
      setDeptEditOptions([]);
      prevEditCompanyIdRef.current = '';
      return;
    }
    const cur = String(editForm.company_id);
    if (prevEditCompanyIdRef.current && prevEditCompanyIdRef.current !== cur) {
      setEditForm((f) => ({ ...f, department_id: '' }));
    }
    prevEditCompanyIdRef.current = cur;
    let cancelled = false;
    (async () => {
      const list = await loadDepartmentOptionsFromCatalogs(
        editForm.organization_id,
        editForm.company_id,
        editOrgList,
        editCompanyList
      );
      if (__DEV__) {
        console.log('[UserMgmt][userForm] MODE: edit');
        console.log('[UserMgmt][userForm] viewerRole:', viewerRoleForUi);
        console.log('[UserMgmt][userForm] org:', editForm.organization_id, 'company:', editForm.company_id, 'dept:', editForm.department_id);
        console.log('[UserMgmt][userForm] companies catalog:', editCompanyList.length, 'dept options:', list.length);
      }
      if (!cancelled) setDeptEditOptions(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [editModal, editForm.role, editForm.company_id, editForm.organization_id, editCompanyList, editOrgList, viewerRoleForUi]);

  useEffect(() => {
    const hint = editDeptNameHintRef.current;
    if (!editModal || !hint || deptEditOptions.length === 0) return;
    setEditForm((f) => {
      if (f.department_id) {
        editDeptNameHintRef.current = null;
        return f;
      }
      const m = deptEditOptions.find((o) => o.name.trim().toLowerCase() === hint.trim().toLowerCase());
      editDeptNameHintRef.current = null;
      return m ? { ...f, department_id: m.id } : f;
    });
  }, [editModal, deptEditOptions]);

  const assignAvailableUsers = useMemo(() => {
    if (assignRole === 'super_admin' || assignRole === 'organization_manager' || assignRole === 'company_manager') {
      return rows;
    }
    if (!assignCompanyId) return [];
    return rows.filter((r) => !employeeUserIds.has(r.id));
  }, [rows, assignCompanyId, employeeUserIds, assignRole]);

  const assignFormReady = useMemo(() => {
    if (assignSelectedUserIds.size === 0) return false;
    if (assignRole === 'super_admin') return true;
    if (assignRole === 'organization_manager') return !!assignOrgId;
    if (assignRole === 'company_manager' || assignRole === 'employee') {
      return !!assignOrgId && !!assignCompanyId;
    }
    return false;
  }, [assignSelectedUserIds, assignRole, assignOrgId, assignCompanyId]);

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
      const userData = (await api.getCurrentUser()) as any;
      const vr = getPrimaryRoleFromUser(resolveUserPayloadForRole(userData));
      const { orgs, companies } = await loadScopedOrgCompanyForViewer(userData, vr);
      setOrgList(orgs);
      if (vr === 'company_manager') {
        if (orgs[0]) setAssignOrgId(orgs[0].id);
        if (companies[0]) setAssignCompanyId(companies[0].id);
      } else if (vr === 'organization_manager' && orgs.length === 1) {
        setAssignOrgId(orgs[0].id);
      }
    } catch {
      setOrgList([]);
    }
  }, []);

  const openCreateUserModal = useCallback(() => {
    setAddMenuOpen(false);
    prevCreateCompanyIdRef.current = '';
    createModalHydrateGenRef.current += 1;
    const hydrateGen = createModalHydrateGenRef.current;

    const me0 = resolveUserPayloadForRole(user as any);
    const vrApi = getPrimaryRoleFromUser(me0);
    const scopeRole: UserRole =
      viewerRoleForUi === 'organization_manager' ||
      viewerRoleForUi === 'company_manager' ||
      viewerRoleForUi === 'super_admin'
        ? viewerRoleForUi
        : vrApi;

    let quickOrg = '';
    let quickComp = '';
    if (scopeRole === 'company_manager') {
      const ch = api.companyIdHintsFromAuthUser(me0);
      if (ch[0]) quickComp = String(ch[0]).trim();
      const oh = api.organizationIdHintsFromAuthUser(me0);
      if (oh[0]) quickOrg = String(oh[0]).trim();
    } else if (scopeRole === 'organization_manager') {
      const oh = api.organizationIdHintsFromAuthUser(me0);
      if (oh[0]) quickOrg = String(oh[0]).trim();
    }

    setForm({
      email: '',
      username: '',
      full_name: '',
      phone: '',
      password: '',
      employee_pin: '',
      hourly_rate: '',
      role: 'employee',
      organization_id: quickOrg,
      company_id: quickComp,
      department_id: '',
    });
    setCreateOrgList(
      quickOrg ? dedupeOrgCompanyOptions([{ id: quickOrg, name: '—' }]) : []
    );
    if (scopeRole === 'company_manager' && quickComp) {
      let cmName = '—';
      const nest =
        (me0 as any)?.company ??
        (me0 as any)?.profile?.company ??
        (me0 as any)?.assigned_company ??
        (me0 as any)?.selected_company;
      if (nest && typeof nest === 'object' && String((nest as any).id ?? '') === quickComp) {
        cmName = String((nest as any).name ?? '').trim() || '—';
      }
      setCreateCompanyList([{ id: quickComp, name: cmName }]);
      void (async () => {
        try {
          const c = await api.getCompany(quickComp);
          if (createModalHydrateGenRef.current !== hydrateGen) return;
          setCreateCompanyList([{ id: String(c.id), name: c.name || '—' }]);
        } catch {
          /* keep placeholder row */
        }
      })();
    } else {
      setCreateCompanyList([]);
    }
    setCreateModal(true);

    void (async () => {
      let initialOrg = quickOrg;
      let initialCompany = quickComp;
      let orgOptions: OrgCompanyOption[] = [];
      let scopedForOm: { orgs: OrgCompanyOption[]; companies: OrgCompanyOption[] } = { orgs: [], companies: [] };
      try {
        const raw = (await api.getCurrentUser()) as any;
        const me = resolveUserPayloadForRole(
          user && typeof user === 'object' ? { ...(user as object), ...raw } : raw
        );
        const vrApi2 = getPrimaryRoleFromUser(me);
        const scopeRole2: UserRole =
          viewerRoleForUi === 'organization_manager' ||
          viewerRoleForUi === 'company_manager' ||
          viewerRoleForUi === 'super_admin'
            ? viewerRoleForUi
            : vrApi2;

        try {
          const scoped = await loadScopedOrgCompanyForViewer(me, scopeRole2);
          scopedForOm = scoped;
          orgOptions = scoped.orgs;
          if (scopeRole2 === 'company_manager') {
            if (scoped.orgs[0]) initialOrg = initialOrg || scoped.orgs[0].id;
            if (scoped.companies[0]) initialCompany = initialCompany || scoped.companies[0].id;
          } else if (scopeRole2 === 'organization_manager') {
            if (scoped.orgs[0]) initialOrg = initialOrg || scoped.orgs[0].id;
            if (!initialOrg && scoped.companies[0]) {
              try {
                const c = await api.getCompany(String(scoped.companies[0].id).trim());
                const oid = organizationIdFromCompanyRow(c);
                if (oid) initialOrg = oid;
              } catch {
                /* ignore */
              }
            }
          }
        } catch {
          orgOptions = [];
        }

        if (scopeRole2 === 'company_manager') {
          if (!initialCompany) {
            const ch = api.companyIdHintsFromAuthUser(me);
            if (ch[0]) initialCompany = String(ch[0]).trim();
          }
          if (!initialOrg) {
            const oh = api.organizationIdHintsFromAuthUser(me);
            if (oh[0]) initialOrg = String(oh[0]).trim();
          }
          if (initialCompany && !initialOrg) {
            try {
              const c = await api.getCompany(initialCompany);
              const orgRef = c?.organization_id ?? c?.organization;
              const oid =
                orgRef != null && typeof orgRef === 'object' && (orgRef as any).id != null
                  ? String((orgRef as any).id).trim()
                  : String(orgRef ?? '').trim();
              if (oid) initialOrg = oid;
            } catch {
              /* ignore */
            }
          }
        } else if (scopeRole2 === 'organization_manager' && !initialOrg) {
          initialOrg = await resolveOrganizationIdForOrganizationManagerUser(me, scopedForOm);
        }

        if (initialOrg && !orgOptions.some((o) => o.id === initialOrg)) {
          try {
            const o = await api.getOrganization(initialOrg);
            if (o?.id != null) {
              orgOptions = [...orgOptions, { id: String(o.id), name: o.name || '—' }];
            } else {
              orgOptions = [...orgOptions, { id: initialOrg, name: '—' }];
            }
          } catch {
            orgOptions = [...orgOptions, { id: initialOrg, name: '—' }];
          }
        }

        if (hydrateGen !== createModalHydrateGenRef.current) return;

        setCreateOrgList(dedupeOrgCompanyOptions(orgOptions));

        if (initialOrg) {
          try {
            let cos = await loadCompanyOptionsForOrganization(initialOrg);
            if (
              cos.length === 0 &&
              scopeRole2 === 'organization_manager' &&
              scopedForOm.companies.length > 0
            ) {
              cos = scopedForOm.companies;
            }
            if (
              cos.length === 0 &&
              scopeRole2 === 'company_manager' &&
              scopedForOm.companies.length > 0
            ) {
              cos = scopedForOm.companies;
            }
            if (scopeRole2 === 'company_manager' && initialCompany) {
              const want = String(initialCompany).trim();
              const one = cos.filter((x) => String(x.id) === want);
              if (one.length) {
                cos = one;
              } else {
                try {
                  const c = await api.getCompany(want);
                  cos = [{ id: String(c.id), name: c.name || '—' }];
                } catch {
                  cos = [{ id: want, name: '—' }];
                }
              }
            }
            if (hydrateGen !== createModalHydrateGenRef.current) return;
            setCreateCompanyList(cos);
          } catch {
            if (hydrateGen !== createModalHydrateGenRef.current) return;
            setCreateCompanyList(
              scopeRole2 === 'organization_manager' && scopedForOm.companies.length > 0
                ? scopedForOm.companies
                : scopeRole2 === 'company_manager' && scopedForOm.companies.length > 0
                  ? scopedForOm.companies
                  : scopeRole2 === 'company_manager' && initialCompany
                    ? [{ id: String(initialCompany), name: '—' }]
                    : []
            );
          }
        } else if (initialCompany && scopeRole2 === 'company_manager') {
          if (hydrateGen !== createModalHydrateGenRef.current) return;
          try {
            const c = await api.getCompany(String(initialCompany).trim());
            if (hydrateGen !== createModalHydrateGenRef.current) return;
            setCreateCompanyList([{ id: String(c.id), name: c.name || '—' }]);
          } catch {
            setCreateCompanyList([{ id: String(initialCompany).trim(), name: '—' }]);
          }
        } else {
          if (hydrateGen !== createModalHydrateGenRef.current) return;
          if (
            (scopeRole2 === 'organization_manager' || scopeRole2 === 'company_manager') &&
            scopedForOm.companies.length > 0
          ) {
            setCreateCompanyList(scopedForOm.companies);
          } else {
            setCreateCompanyList([]);
          }
        }

        if (hydrateGen !== createModalHydrateGenRef.current) return;
        setForm((f) => {
          const nextOrg = (initialOrg || f.organization_id || '').trim();
          const nextComp = (initialCompany || f.company_id || '').trim();
          const orgChanged = nextOrg && nextOrg !== String(f.organization_id || '').trim();
          const compChanged = nextComp && nextComp !== String(f.company_id || '').trim();
          return {
            ...f,
            organization_id: nextOrg || f.organization_id,
            company_id: nextComp || f.company_id,
            department_id: orgChanged || compChanged ? '' : f.department_id,
          };
        });
      } catch (e) {
        if (hydrateGen !== createModalHydrateGenRef.current) return;
        if (__DEV__) console.warn('[UserManagement] create modal hydrate failed', e);
        setCreateOrgList([]);
        /** Do not clear companies here — a partial failure would strand OM on "Loading companies…". */
      }
    })();
  }, [user, sessionRole, viewerRoleForUi]);

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
    if (!assignFormReady) return;
    const me = resolveUserPayloadForRole((await api.getCurrentUser()) as any);
    const vr = getPrimaryRoleFromUser(me);
    if (vr === 'company_manager' && assignRole !== 'employee') {
      Alert.alert('Error', 'You can only assign the employee role.');
      return;
    }
    if (vr === 'organization_manager' && assignRole === 'super_admin') {
      Alert.alert('Error', 'This role is not available for your account.');
      return;
    }
    const backendRole =
      assignRole === 'organization_manager' || assignRole === 'company_manager' || assignRole === 'super_admin'
        ? assignRole
        : 'employee';
    const orgStr = assignOrgId ? String(assignOrgId) : '';
    const compStr = assignCompanyId ? String(assignCompanyId) : '';
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
          if (assignRole === 'employee' && assignCompanyId) {
            await api.assignSchedulerEmployeeToCompany({
              companyId: assignCompanyId,
              userId: id,
              email: row.email && row.email !== '—' ? row.email : undefined,
              first_name: first,
              last_name: last,
              status: 'active',
              job_title: assignRoleLabel(assignRole),
            });
          }
          if (orgStr || compStr) {
            await api.syncAuthUserOrgCompany(id, orgStr, compStr);
          }
          const roleOk = await persistAuthUserRole(id, backendRole);
          if (!roleOk && backendRole !== 'employee') {
            throw new Error('Role was not accepted by the server');
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

  const adminRows = useMemo(() => rows.filter((r) => rowBelongsToAdminsTab(r)), [rows]);
  const adminRowsForTab = useMemo(
    () => filterAdminTabRowsForOrganizationManagerViewer(adminRows, user),
    [adminRows, user]
  );
  const userRows = useMemo(() => rows.filter((r) => !rowBelongsToAdminsTab(r)), [rows]);

  const tabRows = tab === 'admins' ? adminRowsForTab : userRows;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabRows;
    return tabRows.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.team.toLowerCase().includes(q) ||
        r.organizationCompany.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.addedBy.toLowerCase().includes(q)
    );
  }, [tabRows, search]);

  const tableMinWidth = useMemo(() => {
    let w = COL.check + COL.avatar + COL.gear + COL.actions;
    (Object.keys(COL_WIDTH_BY_KEY) as ColumnKey[]).forEach((key) => {
      if (effectiveVisibleCols[key]) w += COL_WIDTH_BY_KEY[key];
    });
    return w;
  }, [effectiveVisibleCols]);

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
    const canonical = getPrimaryRoleFromUser(raw);
    const role =
      canonical === 'super_admin'
        ? 'super_admin'
        : canonical === 'organization_manager'
          ? 'organization_manager'
          : canonical === 'company_manager'
            ? 'company_manager'
        : 'employee';
    const orgId = normalizeEntityId(
      profile.organization_id ??
        profile.organization ??
        raw.organization_id ??
        raw.organization ??
        employee.organization_id ??
        employee.organization ??
        ''
    );
    const companyId = normalizeEntityId(
      profile.company_id ?? profile.company ?? raw.company_id ?? raw.company ?? employee.company_id ?? employee.company ?? ''
    );
    const jobTitle = pickFirstNonEmpty(
      profile.job_title,
      profile.title,
      employee.job_title,
      employee.position,
      employee.title
    );
    const depRaw = employee.department;
    let departmentId = '';
    if (depRaw && typeof depRaw === 'object' && (depRaw as any).id != null) {
      departmentId = String((depRaw as any).id);
    } else if (employee.department_id != null && String(employee.department_id).trim() !== '') {
      departmentId = String(employee.department_id);
    }
    const deptNameOnly = pickFirstNonEmpty(
      typeof depRaw === 'object' && depRaw && (depRaw as any).name ? String((depRaw as any).name) : '',
      employee.department_name,
      r.department !== '—' ? r.department : ''
    );
    editDeptNameHintRef.current =
      departmentId || !deptNameOnly || deptNameOnly === '—' ? null : deptNameOnly;
    prevEditCompanyIdRef.current = '';
    setEditModal(r);
    const editDepartmentId = role === 'employee' ? departmentId : '';
    setEditForm({
      username: r.username === '—' ? '' : r.username,
      email: r.email === '—' ? '' : r.email,
      full_name: r.full_name === '—' ? '' : r.full_name,
      phone: r.phone === '—' ? '' : r.phone,
      job_title: jobTitle,
      role,
      organization_id: orgId && orgId !== 'undefined' ? orgId : '',
      company_id: companyId && companyId !== 'undefined' ? companyId : '',
      department_id: editDepartmentId,
      employee_pin: r.pin === '—' ? '' : r.pin,
      hourly_rate: String(profile.hourly_rate ?? employee.hourly_rate ?? ''),
    });
    void (async () => {
      try {
        const me = (await api.getCurrentUser()) as any;
        const vr = getPrimaryRoleFromUser(resolveUserPayloadForRole(me));
        let resolvedOrg = orgId;
        const resolvedComp = companyId;
        if (!resolvedOrg && resolvedComp) {
          try {
            const c = await api.getCompany(resolvedComp);
            resolvedOrg = normalizeEntityId(c?.organization_id ?? c?.organization);
          } catch {
            /* ignore */
          }
        }

        const scoped = await loadScopedOrgCompanyForViewer(me, vr);
        setEditOrgList(scoped.orgs);

        if (vr === 'organization_manager' && !resolvedOrg) {
          resolvedOrg = await resolveOrganizationIdForOrganizationManagerUser(me, scoped);
        }

        if (resolvedOrg) {
          setEditForm((f) => ({
            ...f,
            organization_id: f.organization_id || resolvedOrg,
          }));
          try {
            let cos = await loadCompanyOptionsForOrganization(resolvedOrg);
            if (cos.length === 0 && vr === 'organization_manager' && scoped.companies.length > 0) {
              cos = scoped.companies;
            }
            setEditCompanyList(cos);
          } catch {
            setEditCompanyList(
              vr === 'organization_manager' && scoped.companies.length > 0 ? scoped.companies : []
            );
          }
        }
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

    const resolvedMe = resolveUserPayloadForRole((await api.getCurrentUser()) as any);
    const viewerRole = getPrimaryRoleFromUser(resolvedMe);
    if (viewerRole === 'company_manager' && form.role !== 'employee') {
      Alert.alert('Error', 'You can only create employee accounts.');
      return;
    }
    if (viewerRole === 'organization_manager' && form.role === 'super_admin') {
      Alert.alert('Error', 'This role is not available for your account.');
      return;
    }
    if (viewerRole === 'organization_manager' && form.role === 'organization_manager') {
      Alert.alert('Error', 'This role is not available for your account.');
      return;
    }

    let orgId = String(form.organization_id || '').trim();
    let companyId = String(form.company_id || '').trim();
    if (viewerRole === 'company_manager') {
      const cHints = api.companyIdHintsFromAuthUser(resolvedMe);
      const oHints = api.organizationIdHintsFromAuthUser(resolvedMe);
      if (cHints[0]) companyId = cHints[0];
      if (oHints[0]) orgId = oHints[0];
    }
    if (viewerRole === 'organization_manager') {
      const oHints = new Set(api.organizationIdHintsFromAuthUser(resolvedMe));
      if (oHints.size > 0 && orgId && !oHints.has(orgId)) {
        orgId = [...oHints][0];
      }
    }

    if (form.role === 'organization_manager' && !orgId) {
      Alert.alert('Error', 'Organization is required for Organization Manager');
      return;
    }
    if (form.role === 'company_manager' && (!orgId || !companyId)) {
      Alert.alert('Error', 'Organization and company are required for Company Manager');
      return;
    }
    if (form.role === 'employee' && String(companyId || '').trim() && !form.department_id) {
      Alert.alert('Please select a department');
      return;
    }
    setSaving(true);
    try {
      const email = normalizeEmail(form.email);
      const emailLocal = email.includes('@') ? email.split('@')[0] : email;
      const username = sanitizeUsername(
        (form.username || emailLocal || email).trim(),
        `user_${emailLocal.replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'account'}`
      );
      const fullName = (form.full_name || emailLocal || username).trim();
      const parts = fullName.split(/\s+/).filter(Boolean);
      const firstName = parts[0] || username;
      const lastName = parts.slice(1).join(' ') || '';
      const lastNameResolved = lastName.trim() || firstName;
      const desiredRole = form.role;
      const phoneApi = phoneDigitsForApi(form.phone);
      const employeePin = form.employee_pin?.trim();
      const hourlyRateNum = parseHourlyRateForApi(form.hourly_rate);

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
          last_name: lastNameResolved,
        };
        const clean = (obj: Record<string, any>): Record<string, any> => {
          const out: Record<string, any> = {};
          Object.entries(obj).forEach(([k, v]) => {
            if (v != null && v !== '') out[k] = v;
          });
          return out;
        };

        const profileNested = clean({
          phone: phoneApi,
          mobile_number: phoneApi,
          mobile: phoneApi,
          employee_pin: employeePin,
          hourly_rate: hourlyRateNum,
          organization: orgId,
          company: companyId,
          first_name: firstName,
          last_name: lastNameResolved,
          full_name: fullName,
        });
        const profileNestedById = clean({
          phone: phoneApi,
          mobile_number: phoneApi,
          mobile: phoneApi,
          employee_pin: employeePin,
          hourly_rate: hourlyRateNum,
          organization_id: orgId,
          company_id: companyId,
          first_name: firstName,
          last_name: lastNameResolved,
          full_name: fullName,
        });

        const withProfileByRef = clean({
          ...basePayload,
          phone: phoneApi,
          mobile_number: phoneApi,
          mobile: phoneApi,
          employee_pin: employeePin,
          hourly_rate: hourlyRateNum,
          organization: orgId,
          company: companyId,
          role: roleCandidate,
        });
        const withProfileById = clean({
          ...basePayload,
          phone: phoneApi,
          mobile_number: phoneApi,
          mobile: phoneApi,
          employee_pin: employeePin,
          hourly_rate: hourlyRateNum,
          organization_id: orgId,
          company_id: companyId,
          role: roleCandidate,
        });
        const roleNamePayload = clean({ ...basePayload, role_name: roleCandidate });
        const strictMinimal = clean({ email, username, password: form.password });

        const pwd = form.password;
        const withPwdPairs = (p: Record<string, any>) => [
          clean({ ...p, re_password: pwd }),
          clean({ ...p, password_confirm: pwd }),
          clean({ ...p, password2: pwd }),
          clean({ ...p, password1: pwd, password2: pwd }),
        ];

        // Prefer shapes common on Django / DRF user creation (password confirmation + nested profile).
        const hasNestedProfile =
          Object.keys(profileNested).length > 0 || Object.keys(profileNestedById).length > 0;
        const roleFirst: Record<string, any>[] =
          desiredRole !== 'employee'
            ? [
                withProfileByRef,
                withProfileById,
                roleNamePayload,
                ...withPwdPairs(withProfileByRef),
                ...withPwdPairs(withProfileById),
                ...withPwdPairs(roleNamePayload),
                clean({ ...roleNamePayload, re_password: pwd }),
                clean({ ...roleNamePayload, password_confirm: pwd }),
              ]
            : [];
        // Try rich signup bodies first so employees are not created as email-only before profile/names/phone apply.
        const rawAttempts: Record<string, any>[] = [
          ...roleFirst,
          ...(hasNestedProfile
            ? [
                ...withPwdPairs(
                  clean({
                    email,
                    username,
                    password: pwd,
                    profile: profileNested,
                  })
                ),
                ...withPwdPairs(
                  clean({
                    email,
                    username,
                    password: pwd,
                    user_profile: profileNested,
                  })
                ),
                ...withPwdPairs(
                  clean({
                    email,
                    username,
                    password: pwd,
                    profile: profileNestedById,
                  })
                ),
                ...withPwdPairs(
                  clean({
                    email,
                    username,
                    password: pwd,
                    user_profile: profileNestedById,
                  })
                ),
              ]
            : []),
          withProfileByRef,
          withProfileById,
          ...withPwdPairs(withProfileByRef),
          ...withPwdPairs(withProfileById),
          roleNamePayload,
          clean({ ...roleNamePayload, re_password: pwd }),
          clean({ ...roleNamePayload, password_confirm: pwd }),
          ...withPwdPairs(strictMinimal),
          clean({ email, username, password: pwd, password1: pwd, password2: pwd }),
          clean({ email, username: email, password: pwd, password_confirm: pwd }),
          strictMinimal,
          clean({ ...strictMinimal, re_password: pwd }),
          clean({ ...strictMinimal, password2: pwd }),
          clean({ ...strictMinimal, confirm_password: pwd }),
          clean({ email, password: pwd, re_password: pwd }),
          clean({ email, username, password: pwd }),
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
      if (createdUserId) {
        const roleOk = await persistAuthUserRole(createdUserId, desiredRole);
        if (!roleOk && desiredRole !== 'employee') {
          throw new Error(
            'User was created but the server did not accept the selected role. Edit the user to set role, or check API permissions.'
          );
        }
      }
      if (createdUserId) {
        const o = String(orgId || '').trim();
        const c = String(companyId || '').trim();
        if (o || c) {
          try {
            await api.syncAuthUserOrgCompany(createdUserId, o, c);
          } catch {
            /* backend may store org/company only on employee */
          }
        }
        if (desiredRole === 'employee' && c) {
          try {
            await api.assignSchedulerEmployeeToCompany({
              companyId: c,
              userId: createdUserId,
              email,
              first_name: firstName,
              last_name: lastNameResolved || '—',
              status: 'active',
              phone: phoneApi,
              employee_pin: employeePin,
            });
          } catch {
            /* employee row may already exist */
          }
          const deptOpt = optById(deptCreateOptions, form.department_id);
          if (deptOpt && form.department_id) {
            try {
              const linked = await api.findSchedulerEmployeeForAuthUser({
                id: createdUserId,
                email,
                company_id: c,
                assigned_company: c,
              });
              const eid = linked?.id ? String(linked.id) : '';
              if (eid) await persistEmployeeDepartment(api, eid, deptOpt);
            } catch {
              /* ignore */
            }
          }
        }
        try {
          await hydrateCreatedUserDisplayFields(
            createdUserId,
            email,
            fullName,
            firstName,
            lastNameResolved,
            phoneApi,
            companyId,
            desiredRole,
            employeePin,
            hourlyRateNum
          );
        } catch {
          /* best-effort: user exists even if PATCH shapes differ */
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
        department_id: '',
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

    const resolvedMe = resolveUserPayloadForRole((await api.getCurrentUser()) as any);
    const viewerRole = getPrimaryRoleFromUser(resolvedMe);
    if (viewerRole === 'company_manager' && editForm.role !== 'employee') {
      Alert.alert('Error', 'You can only assign the employee role.');
      return;
    }
    if (viewerRole === 'organization_manager' && editForm.role === 'super_admin') {
      Alert.alert('Error', 'This role is not available for your account.');
      return;
    }

    let orgId = String(editForm.organization_id || '').trim();
    let compId = String(editForm.company_id || '').trim();
    if (viewerRole === 'company_manager') {
      const cHints = api.companyIdHintsFromAuthUser(resolvedMe);
      const oHints = api.organizationIdHintsFromAuthUser(resolvedMe);
      if (cHints[0]) compId = cHints[0];
      if (oHints[0]) orgId = oHints[0];
    }
    if (viewerRole === 'organization_manager') {
      const oHints = new Set(api.organizationIdHintsFromAuthUser(resolvedMe));
      if (oHints.size > 0 && orgId && !oHints.has(orgId)) {
        orgId = [...oHints][0];
      }
    }

    if (editForm.role === 'organization_manager' && !orgId) {
      Alert.alert('Error', 'Organization is required for Organization Manager');
      return;
    }
    if (editForm.role === 'company_manager' && (!orgId || !compId)) {
      Alert.alert('Error', 'Organization and company are required for Company Manager');
      return;
    }
    if (editForm.role === 'employee' && (!orgId || !compId)) {
      Alert.alert('Error', 'Organization and company are required for employees');
      return;
    }
    if (editForm.role === 'employee' && String(compId || '').trim() && !editForm.department_id) {
      Alert.alert('Please select a department');
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
      const jt = editForm.job_title.trim();
      // Avoid nested profile / job_title on core PATCH (often rejected); title saved in a second pass.
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
          organization_id: orgId,
          company_id: compId,
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
          organization: orgId,
          company: compId,
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
          await api.updateUserWithFallbacks(editModal.id, payload);
          userUpdated = true;
          break;
        } catch (e: any) {
          lastErr = e;
        }
      }
      if (!userUpdated) throw lastErr || new Error('Failed to update user');

      const roleOk = await persistAuthUserRole(editModal.id, editForm.role);
      if (!roleOk && editForm.role !== 'employee') {
        throw new Error('Could not update role on the server. Check permissions or try a different role label in the API.');
      }

      if (orgId || compId) {
        await api.syncAuthUserOrgCompany(editModal.id, orgId, compId);
      }

      // Scheduler employee row holds company assignment; resolve id if enrich missed it.
      let employeeId = String(editModal.raw?.employee?.id ?? editModal.raw?.employee_details?.id ?? '').trim();
      if (!employeeId) {
        const resolved = await api.findSchedulerEmployeeForAuthUser({
          id: editModal.id,
          email: editForm.email.trim(),
          company_id: compId || undefined,
          assigned_company: compId || undefined,
        });
        if (resolved?.id) employeeId = String(resolved.id).trim();
      }
      if (editForm.role === 'employee') {
        const nextCompany = String(compId ?? '').trim();
        if (!employeeId) {
          try {
            const created = await api.createEmployeeLinkedToUser({
              companyId: nextCompany,
              userId: editModal.id,
              email: editForm.email.trim(),
              first_name: firstName,
              last_name: lastName || '—',
              job_title: jt || undefined,
              status: 'active',
            });
            employeeId = String(created?.id ?? created?.pk ?? created?.uuid ?? '').trim();
          } catch (createErr: any) {
            throw new Error(
              createErr?.message ||
                'Could not create employee for this user. Check company selection and API permissions.'
            );
          }
        }
        if (!employeeId) {
          throw new Error('No employee record for this user; company cannot be updated.');
        }
        const rawEmp = editModal.raw?.employee ?? editModal.raw?.employee_details ?? {};
        const prevCompany = String(
          rawEmp.company_id ?? (typeof rawEmp.company === 'object' ? rawEmp.company?.id : rawEmp.company) ?? ''
        ).trim();
        const companyChanged = nextCompany !== '' && prevCompany !== nextCompany;
        const deptOpt = optById(deptEditOptions, editForm.department_id);

        const empPayload: Record<string, any> = {
          email: editForm.email.trim(),
          first_name: firstName,
          last_name: lastName || undefined,
          company_id: nextCompany,
          company: nextCompany,
          phone: editForm.phone.trim() || undefined,
          employee_pin: editForm.employee_pin.trim() || undefined,
          hourly_rate: editForm.hourly_rate.trim() || undefined,
          job_title: jt || undefined,
          position: jt || undefined,
          title: jt || undefined,
        };
        if (deptOpt) {
          const isFb = deptOpt.isFallback === true || String(deptOpt.id).startsWith('__fb__');
          if (!isFb) {
            empPayload.department_id = deptOpt.id;
            empPayload.department = deptOpt.id;
          } else {
            empPayload.department = deptOpt.name;
            empPayload.department_name = deptOpt.name;
          }
        }
        const empBody = clean(empPayload);
        if (companyChanged) {
          empBody.team = null;
          if (!deptOpt) empBody.department = null;
        }
        await api.updateSchedulerEmployeeWithFallbacks(employeeId, [
          empBody,
          clean({
            company_id: nextCompany,
            company: nextCompany,
            first_name: firstName,
            last_name: lastName || undefined,
            job_title: jt || undefined,
            position: jt || undefined,
            email: editForm.email.trim() || undefined,
          }),
          clean({ company_id: nextCompany, first_name: firstName, last_name: lastName || undefined }),
        ]);

        // If the backend created a NEW employee row on reassignment (instead of moving the old one),
        // remove any lingering previous-company employee record so the user doesn't appear in both.
        if (companyChanged && prevCompany) {
          try {
            let prevRows: any[] = [];
            try {
              prevRows = await api.getEmployees({ company: prevCompany });
            } catch {
              prevRows = [];
            }
            if (!Array.isArray(prevRows) || prevRows.length === 0) {
              try {
                prevRows = await api.getEmployees({ company_id: prevCompany });
              } catch {
                prevRows = [];
              }
            }
            if (!Array.isArray(prevRows) || prevRows.length === 0) {
              const all = await api.getEmployees().catch(() => []);
              prevRows = Array.isArray(all)
                ? all.filter((e: any) => String(e?.company_id ?? e?.company ?? '').trim() === String(prevCompany).trim())
                : [];
            }
            const uid = String(editModal.id).trim();
            const emailNorm = String(editForm.email || '').trim().toLowerCase();
            for (const e of prevRows) {
              const eid = String(e?.id ?? e?.pk ?? '').trim();
              if (!eid) continue;
              if (String(employeeId).trim() === eid) continue;
              const linkedUid = employeeSchedulerUserId(e);
              const linkedEmail = String(
                (typeof e?.user === 'object' && e?.user && (e.user as any).email ? (e.user as any).email : null) ??
                  e?.email ??
                  e?.user_email ??
                  ''
              )
                .trim()
                .toLowerCase();
              const matches = (linkedUid && linkedUid === uid) || (emailNorm && linkedEmail && linkedEmail === emailNorm);
              if (!matches) continue;
              try {
                await api.deleteEmployee(eid);
              } catch {
                try {
                  await api.updateEmployee(eid, { status: 'inactive' });
                } catch {
                  /* ignore cleanup failures */
                }
              }
            }
          } catch {
            /* optional cleanup */
          }
        }
      } else if (employeeId && jt) {
        try {
          await api.updateSchedulerEmployeeWithFallbacks(employeeId, [
            clean({ job_title: jt, position: jt, title: jt }),
            { job_title: jt, position: jt },
          ]);
        } catch {
          /* title may only exist on auth profile */
        }
      } else if (!employeeId && jt) {
        const linked = await api.findSchedulerEmployeeForAuthUser({
          id: editModal.id,
          email: editForm.email.trim(),
        });
        if (linked?.id) {
          try {
            await api.updateSchedulerEmployeeWithFallbacks(String(linked.id), [
              clean({ job_title: jt, position: jt, title: jt }),
              { job_title: jt, position: jt },
            ]);
          } catch {
            /* ignore */
          }
        }
      }

      if (jt) {
        await api.updateAuthUserJobTitleWithFallbacks(editModal.id, jt);
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
      if (!effectiveVisibleCols[key]) return;
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
    push('orgCompany', COL.orgCompany, 'Organization / Company');
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
      if (!effectiveVisibleCols[key]) return;
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
    pushVal('orgCompany', COL.orgCompany, <Text style={styles.tdText}>{r.organizationCompany}</Text>);
    pushVal('team', COL.team, <Text style={styles.tdText}>{r.team}</Text>);
    pushVal('department', COL.department, <Text style={styles.tdText}>{r.department}</Text>);
    pushVal('pin', COL.pin, <Text style={styles.tdText}>{r.pin}</Text>);
    pushVal('dateAdded', COL.dateAdded, <Text style={styles.tdText}>{r.dateAdded}</Text>);
    pushVal(
      'lastLogin',
      COL.lastLogin,
      <Text style={[styles.tdText, styles.tdMutedSmall]} numberOfLines={2}>
        {r.lastLogin}
      </Text>
    );
    pushVal(
      'addedBy',
      COL.addedBy,
      <View style={styles.addedByBadge}>
        <Text style={styles.addedByBadgeText}>{r.addedBy}</Text>
      </View>
    );
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
  const adminsTabLabel = `Admins (${adminRowsForTab.length}/${rows.length})`;

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
              placeholder="Search employees..."
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#94a3b8"
        />
          </View>
          <View style={styles.addWrap}>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => {
                if (viewerRoleForUi === 'organization_manager' || viewerRoleForUi === 'company_manager') {
                  void openCreateUserModal();
                } else {
                  setAddMenuOpen((o) => !o);
                }
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.addBtnText}>+ Add users</Text>
              {viewerRoleForUi !== 'organization_manager' && viewerRoleForUi !== 'company_manager' ? (
                <MaterialCommunityIcons name="chevron-down" size={22} color="#fff" />
              ) : null}
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
                  {viewerRoleForUi === 'company_manager'
                    ? 'Create a new user for your company and assign a department.'
                    : viewerRoleForUi === 'organization_manager'
                      ? 'Create a new user — select a company and department, and assign a role.'
                      : 'Create a new user account and assign a role.'}
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
                placeholder="John Doe"
                value={form.full_name}
                onChangeText={(t) => setForm((f) => ({ ...f, full_name: t }))}
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="(555) 123-4567"
                value={form.phone}
                onChangeText={handleCreatePhoneChange}
                placeholderTextColor="#94a3b8"
                keyboardType="phone-pad"
                maxLength={14}
              />
              <Text style={styles.fieldLabel}>Password</Text>
              <TextInput
                style={styles.inputOutlined}
                placeholder="Temporary password"
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
              {viewerRoleForUi === 'company_manager' ? (
                <View style={[styles.selectField, styles.selectFieldDisabled]} pointerEvents="none">
                  <Text style={styles.selectFieldText}>Employee</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.selectField}
                  onPress={() => setCreateRolePicker(true)}
                  disabled={saving}
                >
                  <Text style={styles.selectFieldText}>{createFormRoleLabel(form.role)}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>
              )}
              {viewerRoleForUi === 'company_manager' ? (
                <>
                  <Text style={styles.fieldLabel}>Company</Text>
                  <View style={[styles.selectField, styles.selectFieldDisabled]} pointerEvents="none">
                    <Text style={[styles.selectFieldText, !form.company_id && styles.selectPlaceholder]}>
                      {optById(createCompanyList, form.company_id)?.name ||
                        (createCompanyList.length === 1 ? createCompanyList[0].name : '') ||
                        (form.company_id ? String(form.company_id) : '') ||
                        'Resolving your company…'}
                    </Text>
                  </View>
                </>
              ) : viewerRoleForUi === 'organization_manager' ? (
                <>
                  <Text style={styles.fieldLabel}>Company</Text>
                  <TouchableOpacity
                    style={[
                      styles.selectField,
                      (saving || createCompanyList.length === 0) && styles.selectFieldDisabled,
                    ]}
                    onPress={() => createCompanyList.length > 0 && setCreateCompanyPicker(true)}
                    disabled={saving || createCompanyList.length === 0}
                  >
                    <Text style={[styles.selectFieldText, !form.company_id && styles.selectPlaceholder]}>
                      {createCompanyList.length === 0
                        ? 'Loading companies…'
                        : form.company_id
                          ? optById(createCompanyList, form.company_id)?.name || 'Select company'
                          : 'Select company'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Organization</Text>
                  <TouchableOpacity
                    style={[styles.selectField, createOrgPickerLocked && styles.selectFieldDisabled]}
                    onPress={() => !createOrgPickerLocked && setCreateOrgPicker(true)}
                    disabled={saving || createOrgPickerLocked}
                  >
                    <Text style={[styles.selectFieldText, !form.organization_id && styles.selectPlaceholder]}>
                      {form.organization_id
                        ? optById(createOrgList, form.organization_id)?.name || 'Select organization'
                        : 'Select organization'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>
                  <Text style={styles.fieldLabel}>Company</Text>
                  <TouchableOpacity
                    style={[
                      styles.selectField,
                      (!form.organization_id || createCompanyPickerLocked) && styles.selectFieldDisabled,
                    ]}
                    onPress={() => form.organization_id && !createCompanyPickerLocked && setCreateCompanyPicker(true)}
                    disabled={saving || !form.organization_id || createCompanyPickerLocked}
                  >
                    <Text style={[styles.selectFieldText, !form.company_id && styles.selectPlaceholder]}>
                      {!form.organization_id
                        ? 'Select organization first'
                        : form.company_id
                          ? optById(createCompanyList, form.company_id)?.name || 'Select company'
                          : 'Select company'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>
                </>
              )}
              {showCreateDepartmentSection ? (
                <>
                  <Text style={styles.fieldLabel}>Department</Text>
                  <TouchableOpacity
                    style={[
                      styles.selectField,
                      (saving || !createDeptPickerInteractive) && styles.selectFieldDisabled,
                    ]}
                    onPress={() => createDeptPickerInteractive && setCreateDeptPicker(true)}
                    disabled={saving || !createDeptPickerInteractive}
                  >
                    <Text style={[styles.selectFieldText, !form.department_id && styles.selectPlaceholder]}>
                      {!form.company_id
                        ? 'Select company first'
                        : form.role !== 'employee'
                          ? 'Set role to Employee to choose a department'
                          : form.department_id
                            ? optById(deptCreateOptions, form.department_id)?.name || 'Department'
                            : 'Select department'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>
                </>
              ) : null}
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

              <Text style={styles.fieldLabel}>Title / Job title</Text>
              <TextInput
                style={styles.inputOutlined}
                value={editForm.job_title}
                onChangeText={(t) => setEditForm((f) => ({ ...f, job_title: t }))}
                placeholder="e.g. Front desk, Supervisor"
                placeholderTextColor="#94a3b8"
              />

              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                style={styles.inputOutlined}
                value={editForm.phone}
                onChangeText={handleEditPhoneChange}
                placeholder="(555) 123-4567"
                placeholderTextColor="#94a3b8"
                keyboardType="phone-pad"
                maxLength={14}
                autoCapitalize="none"
              />

              <Text style={styles.fieldLabel}>Role</Text>
              {viewerRoleForUi === 'company_manager' ? (
                <View style={[styles.selectField, styles.selectFieldDisabled]} pointerEvents="none">
                  <Text style={styles.selectFieldText}>{createFormRoleLabel(editForm.role)}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.selectField}
                  onPress={() => setEditRolePicker(true)}
                  disabled={saving}
                >
                  <Text style={styles.selectFieldText}>{createFormRoleLabel(editForm.role)}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>
              )}

              {viewerRoleForUi === 'company_manager' ? (
                <>
                  <Text style={styles.fieldLabel}>Company</Text>
                  <View style={[styles.selectField, styles.selectFieldDisabled]} pointerEvents="none">
                    <Text style={[styles.selectFieldText, !editForm.company_id && styles.selectPlaceholder]}>
                      {optById(editCompanyList, editForm.company_id)?.name ||
                        (editCompanyList.length === 1 ? editCompanyList[0].name : '') ||
                        (editForm.company_id ? String(editForm.company_id) : '') ||
                        ''}
                    </Text>
                  </View>
                </>
              ) : viewerRoleForUi === 'organization_manager' ? (
                <>
                  <Text style={styles.fieldLabel}>Company</Text>
                  <TouchableOpacity
                    style={[
                      styles.selectField,
                      (saving || editCompanyList.length === 0) && styles.selectFieldDisabled,
                    ]}
                    onPress={() => editCompanyList.length > 0 && setEditCompanyPicker(true)}
                    disabled={saving || editCompanyList.length === 0}
                  >
                    <Text style={[styles.selectFieldText, !editForm.company_id && styles.selectPlaceholder]}>
                      {editCompanyList.length === 0
                        ? ''
                        : editForm.company_id
                          ? optById(editCompanyList, editForm.company_id)?.name || 'Select company'
                          : 'Select company'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Organization</Text>
                  <TouchableOpacity
                    style={[styles.selectField, editOrgPickerLocked && styles.selectFieldDisabled]}
                    onPress={() => !editOrgPickerLocked && setEditOrgPicker(true)}
                    disabled={saving || editOrgPickerLocked}
                  >
                    <Text style={[styles.selectFieldText, !editForm.organization_id && styles.selectPlaceholder]}>
                      {editForm.organization_id
                        ? optById(editOrgList, editForm.organization_id)?.name || 'Select organization'
                        : 'Select organization'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>

                  <Text style={styles.fieldLabel}>Company</Text>
                  <TouchableOpacity
                    style={[
                      styles.selectField,
                      (!editForm.organization_id || editCompanyPickerLocked) && styles.selectFieldDisabled,
                    ]}
                    onPress={() => editForm.organization_id && !editCompanyPickerLocked && setEditCompanyPicker(true)}
                    disabled={saving || !editForm.organization_id || editCompanyPickerLocked}
                  >
                    <Text style={[styles.selectFieldText, !editForm.company_id && styles.selectPlaceholder]}>
                      {!editForm.organization_id
                        ? 'Select organization first'
                        : editForm.company_id
                          ? optById(editCompanyList, editForm.company_id)?.name || 'Select company'
                          : 'Select company'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>
                </>
              )}

              {showEditDepartmentSection ? (
                <>
                  <Text style={styles.fieldLabel}>Department</Text>
                  <TouchableOpacity
                    style={[
                      styles.selectField,
                      (saving || !editDeptPickerInteractive) && styles.selectFieldDisabled,
                    ]}
                    onPress={() => editDeptPickerInteractive && setEditDeptPicker(true)}
                    disabled={saving || !editDeptPickerInteractive}
                  >
                    <Text style={[styles.selectFieldText, !editForm.department_id && styles.selectPlaceholder]}>
                      {!editForm.company_id
                        ? 'Select company first'
                        : editForm.role !== 'employee'
                          ? 'Only employees use departments — switch role to Employee'
                          : editForm.department_id
                            ? optById(deptEditOptions, editForm.department_id)?.name || 'Department'
                            : 'Select department'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                  </TouchableOpacity>
                </>
              ) : null}

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

      <OptionPickerModal
        visible={createDeptPicker}
        title="Select department"
        options={deptCreateOptions.map((d) => ({ id: d.id, label: d.name }))}
        onSelect={(id) => setForm((f) => ({ ...f, department_id: String(id) }))}
        onClose={() => setCreateDeptPicker(false)}
      />
      <OptionPickerModal
        visible={editDeptPicker}
        title="Select department"
        options={deptEditOptions.map((d) => ({ id: d.id, label: d.name }))}
        onSelect={(id) => setEditForm((f) => ({ ...f, department_id: String(id) }))}
        onClose={() => setEditDeptPicker(false)}
      />

      <Modal visible={addMenuOpen} transparent animationType="fade" onRequestClose={() => setAddMenuOpen(false)}>
        <Pressable style={styles.addMenuOverlay} onPress={() => setAddMenuOpen(false)}>
          <View style={[styles.addMenuOuter, { pointerEvents: 'box-none' }]}>
            <Pressable style={styles.addMenu} onPress={(e) => e.stopPropagation()}>
              <TouchableOpacity style={styles.addMenuItem} onPress={() => void openCreateUserModal()}>
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
                  style={[styles.textLinkBtn, assignAvailableUsers.length === 0 && styles.textLinkBtnDisabled]}
                  onPress={selectAllAssign}
                  disabled={assignAvailableUsers.length === 0}
                >
                  <Text style={styles.textLinkBtnText}>Select All</Text>
              </TouchableOpacity>
                <TouchableOpacity style={styles.textLinkBtn} onPress={clearAllAssign}>
                  <Text style={styles.textLinkBtnText}>Clear All</Text>
              </TouchableOpacity>
            </View>
            </View>

            <ScrollView style={styles.assignUserListBox} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {assignRole === 'employee' && !assignCompanyId ? (
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

            <Text style={styles.fieldLabel}>
              Organization{assignRole === 'super_admin' ? ' (optional)' : ''}
            </Text>
            <TouchableOpacity
              style={[styles.selectField, assignOrgPickerLocked && styles.selectFieldDisabled]}
              onPress={() => !assignOrgPickerLocked && setAssignOrgPicker(true)}
              disabled={saving || assignOrgPickerLocked}
            >
              <Text style={[styles.selectFieldText, !assignOrgId && styles.selectPlaceholder]}>
                {assignOrgId ? orgList.find((o) => o.id === assignOrgId)?.name : 'Select an organization'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>
              Company
              {assignRole === 'super_admin' || assignRole === 'organization_manager'
                ? ' (optional)'
                : ''}
            </Text>
            <TouchableOpacity
              style={[
                styles.selectField,
                (assignRole !== 'super_admin' && !assignOrgId) || assignCompanyPickerLocked
                  ? styles.selectFieldDisabled
                  : null,
              ]}
              onPress={() =>
                !assignCompanyPickerLocked &&
                (assignRole === 'super_admin' || assignOrgId) &&
                setAssignCompanyPicker(true)
              }
              disabled={saving || assignCompanyPickerLocked || (assignRole !== 'super_admin' && !assignOrgId)}
            >
              <Text style={[styles.selectFieldText, !assignCompanyId && styles.selectPlaceholder]}>
                {assignRole !== 'super_admin' && !assignOrgId
                  ? 'Select organization first'
                  : assignCompanyId
                    ? companyList.find((c) => c.id === assignCompanyId)?.name
                    : assignRole === 'super_admin' || assignRole === 'organization_manager'
                      ? 'Optional — select to scope to a company'
                      : 'Select a company'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Role</Text>
            <TouchableOpacity
              style={styles.selectField}
              onPress={() => setAssignRolePicker(true)}
              disabled={saving || (viewerRoleForUi === 'company_manager' && assignRolePickerOptions.length <= 1)}
            >
              <Text style={styles.selectFieldText}>{assignRoleLabel(assignRole)}</Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.assignSubmitBtn, (saving || !assignFormReady) && styles.assignSubmitBtnDisabled]}
              onPress={() => void handleAssignSubmit()}
              disabled={saving || !assignFormReady}
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
        options={createEditRolePickerOptions}
        onSelect={(id) =>
          setForm((f) => ({
            ...f,
            role: id,
            department_id: id === 'employee' ? f.department_id : '',
          }))
        }
        onClose={() => setCreateRolePicker(false)}
      />
      <OptionPickerModal
        visible={createOrgPicker}
        title="Organization"
        options={createOrgList.map((o) => ({ id: o.id, label: o.name }))}
        onSelect={(id) => setForm((f) => ({ ...f, organization_id: String(id), company_id: '' }))}
        onClose={() => setCreateOrgPicker(false)}
      />
      <OptionPickerModal
        visible={createCompanyPicker}
        title="Company"
        options={createCompanyList.map((c) => ({ id: c.id, label: c.name }))}
        onSelect={(id) => setForm((f) => ({ ...f, company_id: String(id) }))}
        onClose={() => setCreateCompanyPicker(false)}
      />
      <OptionPickerModal
        visible={editRolePicker}
        title="Role"
        options={createEditRolePickerOptions}
        onSelect={(id) =>
          setEditForm((f) => ({
            ...f,
            role: id,
            department_id: id === 'employee' ? f.department_id : '',
          }))
        }
        onClose={() => setEditRolePicker(false)}
      />
      <OptionPickerModal
        visible={editOrgPicker}
        title="Organization"
        options={editOrgList.map((o) => ({ id: o.id, label: o.name }))}
        onSelect={(id) => setEditForm((f) => ({ ...f, organization_id: String(id), company_id: '' }))}
        onClose={() => setEditOrgPicker(false)}
      />
      <OptionPickerModal
        visible={editCompanyPicker}
        title="Company"
        options={editCompanyList.map((c) => ({ id: c.id, label: c.name }))}
        onSelect={(id) => setEditForm((f) => ({ ...f, company_id: String(id) }))}
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
        options={assignRolePickerOptions}
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
    ...Platform.select({
      web: { boxShadow: '0 10px 26px rgba(15, 23, 42, 0.12)' },
      default: {
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
    }),
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
  fieldHint: { fontSize: 13, color: '#64748b', marginBottom: 10, marginTop: 4 },
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
  /** Match web: pill chip with dark label (not low-contrast grey). */
  addedByBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  addedByBadgeText: { fontSize: 14, color: '#0f172a', fontWeight: '500' },

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
