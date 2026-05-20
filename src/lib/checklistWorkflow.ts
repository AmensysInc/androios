/** Checklist template page — reusable blueprints (not employee task list). */

export function canAccessChecklistTemplates(role: string | null | undefined): boolean {
  return role === 'super_admin' || role === 'organization_manager' || role === 'company_manager';
}

export function templateDisplayName(t: any): string {
  return String(t?.name ?? t?.title ?? '').trim();
}

export function templateScopeKey(t: any): string {
  const org =
    t?.organization_id ??
    (typeof t?.organization === 'object' ? (t as any).organization?.id : t?.organization) ??
    '';
  const co =
    t?.company_id ?? (typeof t?.company === 'object' ? (t as any).company?.id : t?.company) ?? '';
  return `${String(org).trim()}|${String(co).trim()}|${templateDisplayName(t).toLowerCase()}`;
}

export function isDuplicateTemplate(
  templates: any[],
  name: string,
  companyId: string,
  organizationId?: string
): boolean {
  const n = name.trim().toLowerCase();
  const co = String(companyId).trim();
  const org = String(organizationId ?? '').trim();
  if (!n || !co) return false;
  return templates.some((t) => {
    const tn = templateDisplayName(t).toLowerCase();
    const tco =
      String(
        t?.company_id ?? (typeof t?.company === 'object' ? t.company?.id : t?.company) ?? ''
      ).trim();
    const torg =
      String(
        t?.organization_id ??
          (typeof t?.organization === 'object' ? t.organization?.id : t?.organization) ??
          ''
      ).trim();
    if (tn !== n || tco !== co) return false;
    if (org && torg && torg !== org) return false;
    return true;
  });
}

export function isDuplicateTemplateTask(tasks: any[], title: string): boolean {
  const n = title.trim().toLowerCase();
  if (!n) return false;
  return tasks.some((t) => {
    const tn = String(t?.title ?? t?.task_name ?? t?.name ?? '')
      .trim()
      .toLowerCase();
    return tn === n;
  });
}
