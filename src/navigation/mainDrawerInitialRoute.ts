import type { UserRole } from '../types/auth';

/** First screen when the main drawer mounts — aligned with web (no Home / Company Dashboard placeholders). */
export function getMainDrawerInitialRoute(role: UserRole | null | undefined): string {
  if (!role) return 'Calendar';
  if (role === 'super_admin' || role === 'admin') return 'SuperAdminDashboard';
  if (role === 'operations_manager') return 'Companies';
  if (role === 'manager') return 'Calendar';
  if (role === 'employee' || role === 'house_keeping' || role === 'maintenance') return 'EmployeeDashboard';
  return 'Calendar';
}
