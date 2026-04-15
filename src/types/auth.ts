/**
 * Canonical app roles (mobile UI + guards). Backend may still send aliases
 * (`operations_manager`, `manager`, `house_keeping`, etc.); map them here only.
 */
export type UserRole = 'super_admin' | 'organization_manager' | 'company_manager' | 'employee';

/** Normalize a single role string from API or `user.role` (lowercase, underscores). */
export function normalizeUserRoleToken(s: string | null | undefined): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Maps any backend / legacy token to one of the four canonical `UserRole` values. */
export function canonicalUserRoleFromToken(token: string | null | undefined): UserRole {
  const t = normalizeUserRoleToken(token);
  if (t === 'super_admin' || t === 'admin') return 'super_admin';
  if (t === 'operations_manager' || t === 'organization_manager') return 'organization_manager';
  if (t === 'company_manager' || t === 'manager') return 'company_manager';
  if (
    t === 'employee' ||
    t === 'house_keeping' ||
    t === 'maintenance' ||
    t === 'user' ||
    t === 'front_desk' ||
    t === 'frontdesk'
  ) {
    return 'employee';
  }
  return 'employee';
}

export function isSuperAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'super_admin';
}

export function isOrganizationManagerRole(role: UserRole | null | undefined): boolean {
  return role === 'organization_manager';
}

/** Company manager (canonical); backend may still send `manager`. */
export function isCompanyManagerRole(role: UserRole | null | undefined): boolean {
  return role === 'company_manager';
}

/** @deprecated Use `isCompanyManagerRole` */
export function isManagerRole(role: UserRole | null | undefined): boolean {
  return role === 'company_manager';
}

export function isEmployeeRole(role: UserRole | null | undefined): boolean {
  return role === 'employee';
}

export interface LoginResponse {
  user?: any;
  access?: string;
  access_token?: string;
  refresh?: string;
  refresh_token?: string;
}

function normalizeRoleToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function tokenFromRoleEntry(r: { role?: string; name?: string } | string | null | undefined): string {
  if (r == null) return '';
  if (typeof r === 'string') return normalizeRoleToken(r);
  return normalizeRoleToken((r.role ?? r.name) ?? '');
}

/**
 * `/auth/user/` may nest profile on `user` while `roles[]` / `role` sit on the outer object.
 * Merge so role resolution matches the web app and the drawer (same as User Management `resolveUserPayloadForRole`).
 */
export function mergeNestedAuthUserPayload(user: any): any {
  if (!user || typeof user !== 'object') return user;
  const inner = user.user;
  if (!inner || typeof inner !== 'object') return user;
  return {
    ...inner,
    ...user,
    roles: Array.isArray(user.roles) && user.roles.length ? user.roles : inner.roles,
  };
}

/** Resolve role from `/auth/user/` — supports `roles[]`, string roles, and top-level `role` / `role_name` / `primary_role`. */
export function getPrimaryRoleFromUser(user: any): UserRole {
  if (!user) return 'employee';
  const u = mergeNestedAuthUserPayload(user);
  if (u.is_superuser === true) return 'super_admin';
  const fromArray = Array.isArray(u.roles) && u.roles.length ? u.roles : undefined;
  if (fromArray) return resolvePrimaryRoleFromNames(fromArray);
  const fallbacks: string[] = [];
  if (typeof u.role === 'string') fallbacks.push(u.role);
  if (typeof u.role_name === 'string') fallbacks.push(u.role_name);
  if (typeof u.primary_role === 'string') fallbacks.push(u.primary_role);
  if (fallbacks.length) return resolvePrimaryRoleFromNames(fallbacks as any);
  return 'employee';
}

/** Legacy: role list only (no top-level `role` field). Prefer `getPrimaryRoleFromUser` for session payloads. */
export function getPrimaryRole(roles: { role?: string; name?: string }[] | undefined): UserRole {
  return resolvePrimaryRoleFromNames(roles as any);
}

/**
 * Priority order for users with multiple role names in `roles[]`.
 * Output is always one of the four canonical roles.
 */
function resolvePrimaryRoleFromNames(roles: any[] | undefined): UserRole {
  if (!roles?.length) return 'employee';
  const roleNames = roles.map((r) => tokenFromRoleEntry(r)).filter(Boolean);
  if (roleNames.includes('super_admin') || roleNames.includes('admin')) return 'super_admin';
  if (roleNames.includes('operations_manager') || roleNames.includes('organization_manager')) {
    return 'organization_manager';
  }
  if (roleNames.includes('company_manager') || roleNames.includes('manager')) return 'company_manager';
  if (
    roleNames.includes('employee') ||
    roleNames.includes('house_keeping') ||
    roleNames.includes('maintenance') ||
    roleNames.includes('user') ||
    roleNames.includes('front_desk')
  ) {
    return 'employee';
  }
  return 'employee';
}

/** Display label for role in UI. */
export function getRoleDisplayLabel(role: UserRole | null | undefined): string {
  if (!role) return 'User';
  switch (role) {
    case 'super_admin':
      return 'Super Admin';
    case 'organization_manager':
      return 'Organization Manager';
    case 'company_manager':
      return 'Company Manager';
    case 'employee':
      return 'Employee';
    default:
      return 'User';
  }
}
