/**
 * Tasks page workflow — mirrors web Tasks.tsx: fetch once, filter client-side.
 */

import {
  classifyTaskType,
  companyIdFromTask,
  companyNameFromTask,
  dedupeTasks,
  eventId,
  eventOverlapsRange,
  isMasterChecklistTemplateTask,
  isTaskLikeEvent,
  isTaskVisibleToUser,
  isVisibleToEmployee,
  isWorkTaskRow,
  organizationIdFromTask,
  organizationNameFromTask,
  taskIsCompleted,
  taskIsInProgress,
  taskRowForRangeCheck,
  taskUserId,
} from './tasksWorkflow';

export type ScopeCatalogEntry = { id: string; name: string; organizationId?: string };

export type TasksPageClientFilters = {
  organizationId: string;
  companyId: string;
  memberId: string;
  datePreset: string;
  status: string;
  priority: string;
  rangeStart: Date;
  rangeEnd: Date;
  skipDateFilter: boolean;
};

export type ApplyTasksPageFiltersOpts = {
  role: string | null;
  userId: string;
  canViewAllMembers: boolean;
  organizations: ScopeCatalogEntry[];
  companies: ScopeCatalogEntry[];
  /** Company ids the manager can access (company_manager). */
  managerCompanyIds?: Set<string>;
  /** User ids on manager's team for company_manager pass. */
  teamUserIds?: Set<string>;
};

/** Web: shouldDisplayTaskOnTasksPage — no checklist template catalog rows. */
export function shouldDisplayTaskOnTasksPage(
  t: any,
  opts: { employeeUserId?: string }
): boolean {
  if (!t || typeof t !== 'object') return false;
  if (classifyTaskType(t) === 'checklist_template' || isMasterChecklistTemplateTask(t)) return false;
  if (t.is_template === true) return false;
  if (!isWorkTaskRow(t) && !isTaskLikeEvent(t)) return false;

  const uid = String(opts.employeeUserId ?? '').trim();
  if (uid) return isVisibleToEmployee(t, uid);
  return true;
}

/** Normalize API row (tasks + calendar events) to a common calendar-task shape. */
export function normalizeCalendarTaskEvent(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const title = String(row.title ?? row.name ?? row.task_name ?? '').trim();
  const rawStatus = row.status ?? row.task_status ?? row.event_status ?? row.state;
  let status = rawStatus != null ? String(rawStatus).toLowerCase() : '';
  if (status === 'todo') status = 'pending';
  if (row.completed === true || row.is_completed === true || row.done === true) status = 'completed';

  const userRaw =
    row.user_id ??
    (typeof row.user === 'object' ? row.user?.id : row.user) ??
    row.assigned_user_id ??
    (typeof row.assigned_user === 'object' ? row.assigned_user?.id : row.assigned_user);

  const parent =
    row.parent_event ??
    row.parent_task ??
    row.parent_id ??
    (typeof row.parent === 'object' ? row.parent?.id : row.parent);

  const taskType = String(row.task_type ?? '').toLowerCase();
  const resolvedType =
    taskType === 'manual' || taskType === 'assigned'
      ? taskType
      : row.is_assigned === true || row.is_assigned === 'true'
        ? 'assigned'
        : row.is_assigned === false
          ? 'manual'
          : row.task_type;

  return {
    ...row,
    title: title || row.title,
    name: title || row.name,
    task_name: row.task_name ?? title,
    task_type: resolvedType ?? row.task_type,
    status,
    user_id: userRaw != null ? String(userRaw) : row.user_id,
    organization_id:
      row.organization_id ??
      (typeof row.organization === 'object' ? row.organization?.id : row.organization),
    company_id: row.company_id ?? (typeof row.company === 'object' ? row.company?.id : row.company),
    template_id: row.template_id ?? row.checklist_template_id ?? row.templateId,
    parent_event: parent,
    parent_task: parent,
    start_time: row.start_time ?? row.start ?? row.due_date ?? row.scheduled_at,
    end_time: row.end_time ?? row.end ?? row.due_date,
    due_date: row.due_date ?? row.start_time ?? row.start,
    created_at: row.created_at ?? row.created ?? row.date_created,
  };
}

export function enrichCalendarEventScopeFromCatalog(
  rows: any[],
  organizations: ScopeCatalogEntry[],
  companies: ScopeCatalogEntry[]
): any[] {
  const orgById = new Map(organizations.map((o) => [o.id, o.name]));
  const coById = new Map(companies.map((c) => [c.id, { name: c.name, orgId: c.organizationId }]));
  const coByName = new Map(
    companies.map((c) => [c.name.trim().toLowerCase(), { id: c.id, name: c.name, orgId: c.organizationId }])
  );

  return rows.map((row) => {
    const next = { ...row };
    let oid = organizationIdFromTask(next);
    let cid = companyIdFromTask(next);
    let oname = organizationNameFromTask(next);
    let cname = companyNameFromTask(next);

    if (!oid && cid) {
      const meta = coById.get(cid);
      if (meta?.orgId) oid = meta.orgId;
    }
    if (!cname && cid) cname = coById.get(cid)?.name ?? '';
    if (!oname && oid) oname = orgById.get(oid) ?? '';
    if (!cid && cname) {
      const hit = coByName.get(cname.trim().toLowerCase());
      if (hit) {
        cid = hit.id;
        if (!oid && hit.orgId) oid = hit.orgId;
      }
    }

    if (oid) {
      next.organization_id = oid;
      if (!oname) next.organization_name = orgById.get(oid) ?? oname;
    }
    if (cid) {
      next.company_id = cid;
      if (!cname) next.company_name = coById.get(cid)?.name ?? cname;
    }
    if (oname) next.organization_name = oname;
    if (cname) next.company_name = cname;
    return next;
  });
}

/** Sort anchor: start_time → end_time → created_at */
export function getTaskSortDate(t: any): Date | null {
  const raw = t?.start_time ?? t?.end_time ?? t?.created_at ?? t?.created;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Owner + attendee user ids for member filter. */
export function taskAttendeeUserIds(t: any): string[] {
  const ids = new Set<string>();
  const owner = taskUserId(t);
  if (owner) ids.add(owner);
  const add = (v: unknown) => {
    if (v == null) return;
    if (typeof v === 'object' && (v as any).id != null) ids.add(String((v as any).id));
    else if (typeof v === 'string' && v.trim()) ids.add(v.trim());
  };
  add(t.user);
  add(t.assigned_user);
  add(t.assignee);
  const lists = [
    t.attendees,
    t.attendee_ids,
    t.assigned_to_ids,
    t.assigned_to_summary,
    t.assigned_to_details,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const u of list) add(u);
  }
  return [...ids];
}

export function taskMatchesMemberFilter(t: any, memberId: string): boolean {
  const mid = String(memberId).trim();
  if (!mid) return true;
  return taskAttendeeUserIds(t).some((id) => id === mid);
}

function taskMatchesOrganization(
  t: any,
  orgId: string,
  organizations: ScopeCatalogEntry[],
  companies: ScopeCatalogEntry[]
): boolean {
  const oid = organizationIdFromTask(t);
  const oname = organizationNameFromTask(t).trim().toLowerCase();
  const cid = companyIdFromTask(t);
  if (oid && oid === orgId) return true;
  const orgEntry = organizations.find((o) => o.id === orgId);
  const targetOrgName = orgEntry?.name?.trim().toLowerCase() ?? '';
  if (oname && targetOrgName && oname === targetOrgName) return true;
  const underOrg = new Set(
    companies.filter((c) => c.organizationId === orgId).map((c) => c.id)
  );
  if (cid && underOrg.has(cid)) return true;
  const cname = companyNameFromTask(t).trim().toLowerCase();
  if (cname) {
    for (const c of companies) {
      if (c.organizationId === orgId && c.name.trim().toLowerCase() === cname) return true;
    }
  }
  return !oid && !cid && !oname && !cname;
}

function taskMatchesCompany(t: any, companyId: string, companies: ScopeCatalogEntry[]): boolean {
  const cid = companyIdFromTask(t);
  const cname = companyNameFromTask(t).trim().toLowerCase();
  if (cid && cid === companyId) return true;
  const entry = companies.find((c) => c.id === companyId);
  if (cname && entry && cname === entry.name.trim().toLowerCase()) return true;
  return !cid && !cname;
}

function companyManagerSeesTask(
  t: any,
  managerCompanyIds: Set<string>,
  teamUserIds: Set<string>,
  companies: ScopeCatalogEntry[]
): boolean {
  const cid = companyIdFromTask(t);
  if (cid && managerCompanyIds.has(cid)) return true;
  const cname = companyNameFromTask(t).trim().toLowerCase();
  if (cname) {
    for (const c of companies) {
      if (managerCompanyIds.has(c.id) && c.name.trim().toLowerCase() === cname) return true;
    }
  }
  for (const uid of taskAttendeeUserIds(t)) {
    if (teamUserIds.has(uid)) return true;
  }
  return false;
}

/** Client-side filters only — no task list API on change. */
export function applyTasksPageClientFilters(
  events: any[],
  filters: TasksPageClientFilters,
  opts: ApplyTasksPageFiltersOpts
): any[] {
  const orgId = filters.organizationId !== 'all' ? filters.organizationId : '';
  const coId = filters.companyId !== 'all' ? filters.companyId : '';
  const memberId = filters.memberId !== 'all' ? filters.memberId : '';
  const isCompanyManager = opts.role === 'company_manager';
  const managerCo = opts.managerCompanyIds ?? new Set<string>();
  const teamUsers = opts.teamUserIds ?? new Set<string>();

  return events.filter((t) => {
    if (!shouldDisplayTaskOnTasksPage(t, {
      employeeUserId: opts.canViewAllMembers ? undefined : opts.userId,
    })) {
      return false;
    }

    if (!opts.canViewAllMembers && !isTaskVisibleToUser(t, opts.userId)) {
      return false;
    }

    if (isCompanyManager && opts.canViewAllMembers) {
      if (!companyManagerSeesTask(t, managerCo, teamUsers, opts.companies)) return false;
    }

    if (orgId && !taskMatchesOrganization(t, orgId, opts.organizations, opts.companies)) {
      return false;
    }
    if (coId && !taskMatchesCompany(t, coId, opts.companies)) return false;
    if (memberId && !taskMatchesMemberFilter(t, memberId)) return false;

    if (!filters.skipDateFilter) {
      const anchor = getTaskSortDate(t);
      if (anchor) {
        if (!eventOverlapsRange(taskRowForRangeCheck(t), filters.rangeStart, filters.rangeEnd)) {
          return false;
        }
      }
    }

    if (filters.status !== 'all') {
      if (filters.status === 'completed' && !taskIsCompleted(t)) return false;
      if (filters.status === 'pending' && taskIsCompleted(t)) return false;
      if (filters.status === 'in_progress' && !taskIsInProgress(t)) return false;
    }

    if (filters.priority !== 'all') {
      const pr = String(t.priority ?? '').toLowerCase();
      const normalized =
        pr === 'high' || pr === 'urgent'
          ? 'high'
          : pr === 'low'
            ? 'low'
            : 'medium';
      if (normalized !== filters.priority) return false;
    }

    return true;
  });
}

/** Flat list with normalized parent ids (subtasks still in array for expanded UI). */
export function buildTaskTreeFromFlatEvents(rows: any[]): any[] {
  return rows.map((row) => {
    const pid = row.parent_event ?? row.parent_task ?? row.parent_id;
    if (pid == null || pid === '') return row;
    const pstr = typeof pid === 'object' && pid.id != null ? String(pid.id) : String(pid);
    return { ...row, parent_event: pstr, parent_task: pstr };
  });
}

export function sortTasksForDisplay(rows: any[]): any[] {
  return [...rows].sort((a, b) => {
    const da = getTaskSortDate(a)?.getTime() ?? 0;
    const db = getTaskSortDate(b)?.getTime() ?? 0;
    return db - da;
  });
}

export function catalogsFromPickerOptions(
  orgOptions: { id: string; label: string }[],
  companyOptions: { id: string; label: string }[],
  companiesRaw?: any[]
): { organizations: ScopeCatalogEntry[]; companies: ScopeCatalogEntry[] } {
  const organizations: ScopeCatalogEntry[] = [];
  for (const o of orgOptions) {
    if (o.id === 'all') continue;
    organizations.push({ id: o.id, name: o.label });
  }
  const companies: ScopeCatalogEntry[] = [];
  for (const c of companyOptions) {
    if (c.id === 'all') continue;
    let orgId = '';
    if (Array.isArray(companiesRaw)) {
      const raw = companiesRaw.find((x) => String(x?.id ?? '') === c.id);
      if (raw) {
        orgId = String(
          raw.organization_id ??
            (typeof raw.organization === 'object' ? raw.organization?.id : raw.organization) ??
            ''
        ).trim();
      }
    }
    companies.push({ id: c.id, name: c.label, organizationId: orgId || undefined });
  }
  return { organizations, companies };
}
