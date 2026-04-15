import type { User } from '../context/AuthContext';
import type { UserRole } from '../types/auth';
import { mergeNestedAuthUserPayload } from '../types/auth';
import { inferOrganizationKind } from './departmentOptions';

/**
 * Shallow org-type hint from session user (for motel-only hotel admin access).
 * Aligns with: `organization_type` + nested `organization.type` / `name`.
 */
export function hotelOrgTypeHintFromUser(user: User | null): string {
  if (!user || typeof user !== 'object') return '';
  const u = user as Record<string, any>;
  const org = u.organization;
  const fromNested =
    org != null && typeof org === 'object' && !Array.isArray(org)
      ? [String((org as any).type ?? ''), String((org as any).organization_type ?? ''), String((org as any).name ?? '')]
          .filter((s) => s.trim())
          .join(' ')
      : typeof org === 'string'
        ? org.trim()
        : '';
  return [String(u.organization_type ?? ''), String(u.org_type ?? ''), fromNested, getSimpleOrgTypeString(user)]
    .filter((s) => String(s).trim())
    .join(' ')
    .trim();
}

/** Super Admin, Organization Manager, Company Manager. */
export function isHotelManagementRole(role: UserRole | null): boolean {
  return role === 'super_admin' || role === 'organization_manager' || role === 'company_manager';
}

/** Managers that require a motel org scope (not super_admin). */
export function isHotelMotelScopedManagerRole(role: UserRole | null): boolean {
  return role === 'organization_manager' || role === 'company_manager';
}

/** Scheduler org/company row: name/type suggests motel (for async verify after `getOrganization` / `getCompany`). */
export function recordLooksMotelRow(row: Record<string, any> | null | undefined): boolean {
  if (!row || typeof row !== 'object') return false;
  const name = String(row.name ?? '');
  const type = String(row.type ?? row.organization_type ?? row.category ?? row.kind ?? '');
  const blob = `${name} ${type}`.trim();
  if (!blob) return false;
  const low = blob.toLowerCase();
  if (low.includes('motel') || low.includes('hotel')) return true;
  return inferOrganizationKind(blob, name, type || undefined) === 'motel';
}

function userAsRecord(user: User | null): Record<string, unknown> | null {
  return user ? (user as unknown as Record<string, unknown>) : null;
}

/** Canonical employee role; legacy `user.role` strings handled in `isHotelEmployeeRole`. */
export const HOTEL_SIDEBAR_ROLES: UserRole[] = ['employee'];

const LEGACY_EMPLOYEE_ROLE_STRINGS = new Set([
  'employee',
  'house_keeping',
  'maintenance',
  'user',
  'front_desk',
  'frontdesk',
]);

/** Optional top-level role string some backends send on `/auth/user/`. */
function userTopLevelRoleString(user: User | null): string {
  const u = userAsRecord(user);
  if (!u) return '';
  const raw = u.role;
  return typeof raw === 'string' ? raw.trim() : '';
}

function normalizeRoleToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Hotel cleaning: canonical `employee`, or legacy floor-staff strings on `user.role` from the API.
 */
export function isHotelEmployeeRole(user: User | null, role: UserRole | null): boolean {
  if (role === 'employee') return true;
  const ur = userTopLevelRoleString(user);
  if (!ur) return false;
  const n = normalizeRoleToken(ur);
  return LEGACY_EMPLOYEE_ROLE_STRINGS.has(n);
}

function pushStr(out: string[], v: unknown) {
  if (typeof v === 'string' && v.trim()) out.push(v.trim());
}

function pullFromOrgLike(out: string[], org: unknown) {
  if (org == null) return;
  if (typeof org === 'string') {
    pushStr(out, org);
    return;
  }
  if (typeof org !== 'object' || Array.isArray(org)) return;
  const o = org as Record<string, unknown>;
  pushStr(out, o.type);
  pushStr(out, o.organization_type);
  pushStr(out, o.name);
  pushStr(out, o.slug);
  pushStr(out, o.category);
  pushStr(out, o.kind);
  pushStr(out, o.label);
}

/**
 * Collects org-related strings from `/auth/user/` (top-level, nested `organization`, profile).
 */
export function collectOrgMotelHintStrings(user: User | null): string[] {
  if (!user) return [];
  const u = userAsRecord(user)!;
  const out: string[] = [];
  pushStr(out, u.organization_type);
  pushStr(out, u.org_type);
  pushStr(out, u.organization_category);
  pushStr(out, u.industry);
  pullFromOrgLike(out, u.organization);
  pullFromOrgLike(out, u.company);

  for (const p of [user.profile, user.user_profile]) {
    if (!p || typeof p !== 'object') continue;
    const pr = p as Record<string, unknown>;
    pushStr(out, pr.organization_type);
    pushStr(out, pr.org_type);
    pushStr(out, pr.organization_category);
    pullFromOrgLike(out, pr.organization);
    pullFromOrgLike(out, pr.company);
    pushStr(out, pr.company_name);
    pushStr(out, pr.organization_name);
  }

  return out;
}

/** Spec-style primary org string chain (first non-empty). */
export function getSimpleOrgTypeString(user: User | null): string {
  const u = userAsRecord(user);
  if (!u) return '';
  const top = u.organization_type;
  if (typeof top === 'string' && top.trim()) return top.trim();
  const org = u.organization;
  if (org != null && typeof org === 'object' && !Array.isArray(org)) {
    const o = org as Record<string, unknown>;
    const t = o.type;
    if (typeof t === 'string' && t.trim()) return t.trim();
    const n = o.name;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  if (typeof org === 'string' && org.trim()) return org.trim();
  return '';
}

/** Joined hints for logs / debugging. */
export function getOrgTypeForMotelCheck(user: User | null): string {
  const simple = getSimpleOrgTypeString(user);
  const hints = collectOrgMotelHintStrings(user).join(' | ');
  if (simple && hints) return `${simple} || ${hints}`;
  return simple || hints || '';
}

function hardMotelEquality(user: User | null): boolean {
  const u = userAsRecord(user);
  if (!u) return false;
  const eq = (v: unknown) => typeof v === 'string' && v.trim().toLowerCase() === 'motel';
  if (eq(u.organization_type) || eq(u.org_type)) return true;
  const org = u.organization;
  if (org != null && typeof org === 'object' && !Array.isArray(org)) {
    const o = org as Record<string, unknown>;
    if (eq(o.type) || eq(o.organization_type) || eq(o.name)) return true;
  }
  return false;
}

/**
 * Robust motel org detection: substring "motel"/"hotel", hard `=== "motel"`, and name heuristics.
 */
export function userOrganizationLooksMotel(user: User | null): boolean {
  if (!user) return false;
  if (hardMotelEquality(user)) return true;

  const simple = getSimpleOrgTypeString(user);
  const parts = collectOrgMotelHintStrings(user);
  const blob = [simple, ...parts].filter(Boolean).join(' ');
  if (!blob.trim()) return false;

  const lower = blob.toLowerCase();
  if (lower.includes('motel')) return true;
  if (lower.includes('hotel')) return true;

  return inferOrganizationKind(blob, blob, blob) === 'motel';
}

/** Sync-only: employee role + motel org from user JSON. */
export function isMotelEmployee(user: User | null, role: UserRole | null): boolean {
  return isHotelEmployeeRole(user, role) && userOrganizationLooksMotel(user);
}

/**
 * Shallow motel/hotel hint for employees when `userOrganizationLooksMotel` misses (sparse payloads).
 * Matches common spec: organization.type / name / organization_type / profile org strings.
 */
export function employeeOrgFieldsMentionMotelOrHotel(user: User | null): boolean {
  if (!user) return false;
  const u = user as Record<string, any>;
  const bits: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) bits.push(v);
  };
  push(u.organization_type);
  push(u.org_type);
  const org = u.organization;
  if (org && typeof org === 'object' && !Array.isArray(org)) {
    push((org as any).type);
    push((org as any).name);
    push((org as any).organization_type);
  } else if (typeof org === 'string') push(org);
  for (const p of [u.profile, u.user_profile]) {
    if (!p || typeof p !== 'object') continue;
    const pr = p as Record<string, unknown>;
    push(pr.organization_type);
    push(pr.organization_name);
    push(pr.company_name);
    const po = pr.organization;
    if (po && typeof po === 'object' && !Array.isArray(po)) {
      push((po as any).type);
      push((po as any).name);
    }
  }
  const blob = bits.join(' ').toLowerCase();
  return blob.includes('motel') || blob.includes('hotel');
}

/**
 * Sidebar / screen gate without waiting on async motel probes: merged `/auth/user/` org hints only.
 * Keeps non-motel employees from seeing Rooms when payload has no motel signals.
 */
export function employeeMotelSidebarSync(user: User | null): boolean {
  if (!user) return false;
  const u = mergeNestedAuthUserPayload(user) as User;
  if (userOrganizationLooksMotel(u)) return true;
  if (employeeOrgFieldsMentionMotelOrHotel(u)) return true;
  const blob = getOrgTypeForMotelCheck(u as any).toLowerCase();
  if (blob.includes('motel') || blob.includes('hotel')) return true;
  return inferOrganizationKind(blob, blob, blob) === 'motel';
}

/**
 * Dev-only: logs structure the backend actually sends (Step 1 / force test).
 */
export function logHotelAccessDebug(
  user: User | null,
  role: UserRole | null,
  flags: { syncMotelOrg: boolean; isMotelEmployee: boolean }
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const u = userAsRecord(user);
  try {
    console.log('[Hotel] FULL USER OBJECT:', JSON.stringify(user, null, 2));
  } catch {
    console.log('[Hotel] FULL USER OBJECT:', user);
  }
  console.log('[Hotel] ROLE (context):', role);
  console.log('[Hotel] ROLE (user.role):', u?.role);
  console.log('[Hotel] ORG TYPE (top):', u?.organization_type);
  console.log('[Hotel] ORG OBJECT:', u?.organization);
  console.log('[Hotel] simple org string:', getSimpleOrgTypeString(user));
  console.log('[Hotel] all org hints:', getOrgTypeForMotelCheck(user));
  console.log('[Hotel] sync motel org (payload):', flags.syncMotelOrg);
  console.log('[Hotel] isMotelEmployee (sync):', flags.isMotelEmployee);
}
