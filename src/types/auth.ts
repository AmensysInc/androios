export type UserRole =
  | 'super_admin'
  | 'operations_manager'
  | 'manager'
  | 'admin'
  | 'employee'
  | 'house_keeping'
  | 'maintenance'
  | 'user';

export interface LoginResponse {
  user?: any;
  access?: string;
  access_token?: string;
  refresh?: string;
  refresh_token?: string;
}

/** Backend may send `super_admin`, `Super Admin`, `SUPER_ADMIN`, etc. */
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

/** Resolve role from `/auth/user/` — supports `roles[]`, string roles, and top-level `role` / `role_name` / `primary_role`. */
export function getPrimaryRoleFromUser(user: any): UserRole {
  if (!user) return 'user';
  if (user.is_superuser === true) return 'super_admin';
  const fromArray = Array.isArray(user.roles) && user.roles.length
    ? user.roles
    : undefined;
  if (fromArray) return resolvePrimaryRoleFromNames(fromArray);
  const fallbacks: string[] = [];
  if (typeof user.role === 'string') fallbacks.push(user.role);
  if (typeof user.role_name === 'string') fallbacks.push(user.role_name);
  if (typeof user.primary_role === 'string') fallbacks.push(user.primary_role);
  if (fallbacks.length) return resolvePrimaryRoleFromNames(fallbacks as any);
  return 'user';
}

/** Legacy: role list only (no top-level `role` field). Prefer `getPrimaryRoleFromUser` for session payloads. */
export function getPrimaryRole(roles: { role?: string; name?: string }[] | undefined): UserRole {
  return resolvePrimaryRoleFromNames(roles as any);
}

/** Maps Django `user_roles.role` to UI `UserRole` (same rules as web `getPrimaryRole`). */
function resolvePrimaryRoleFromNames(roles: any[] | undefined): UserRole {
  if (!roles?.length) return 'user';
  const roleNames = roles.map((r) => tokenFromRoleEntry(r)).filter(Boolean);
  if (roleNames.includes('super_admin')) return 'super_admin';
  if (roleNames.includes('operations_manager') || roleNames.includes('organization_manager')) {
    return 'operations_manager';
  }
  if (roleNames.includes('company_manager')) return 'manager';
  if (roleNames.includes('manager')) return 'manager';
  if (roleNames.includes('admin')) return 'admin';
  if (roleNames.includes('employee')) return 'employee';
  if (roleNames.includes('house_keeping')) return 'house_keeping';
  if (roleNames.includes('maintenance')) return 'maintenance';
  if (roleNames.includes('user')) return 'user';
  return 'user';
}

/** Display label for role in UI – matches web (house_keeping/maintenance shown as "Employee"). */
export function getRoleDisplayLabel(role: UserRole | null | undefined): string {
  if (!role) return 'User';
  switch (role) {
    case 'super_admin': return 'Super Admin';
    case 'operations_manager': return 'Organization Manager';
    case 'manager': return 'Company Manager';
    case 'admin': return 'Admin';
    case 'employee':
    case 'house_keeping':
    case 'maintenance':
      return 'Employee';
    default: return 'User';
  }
}
