import type { UserRole } from '../types/auth';

/** First screen when the main drawer mounts — aligned with web (no Home / Company Dashboard placeholders). */
export function getMainDrawerInitialRoute(role: UserRole | null | undefined): string {
  if (!role) return 'Calendar';
  if (role === 'super_admin') return 'SuperAdminDashboard';
  if (role === 'organization_manager') return 'Companies';
  if (role === 'company_manager') return 'Calendar';
  if (role === 'employee') {
    return 'EmployeeDashboard';
  }
  return 'Calendar';
}
