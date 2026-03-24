import type { UserRole } from '../types/auth';

/** First screen when the main drawer mounts — matches HomeScreen redirect logic without a flash on Home. */
export function getMainDrawerInitialRoute(role: UserRole | null | undefined): string {
  if (!role) return 'Home';
  if (role === 'super_admin' || role === 'admin') return 'SuperAdminDashboard';
  if (role === 'operations_manager') return 'OrganizationDashboard';
  if (role === 'manager') return 'CompanyDashboard';
  if (role === 'employee' || role === 'house_keeping' || role === 'maintenance') return 'EmployeeDashboard';
  return 'Calendar';
}
