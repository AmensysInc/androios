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

export function getPrimaryRole(roles: { role?: string; name?: string }[] | undefined): UserRole {
  if (!roles?.length) return 'user';
  const roleNames = roles.map((r) => ((r.role ?? r.name) ?? '').toLowerCase());
  if (roleNames.includes('super_admin')) return 'super_admin';
  if (roleNames.includes('operations_manager')) return 'operations_manager';
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
