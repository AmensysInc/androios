/** Task list normalization — calendar `/calendar/events/` rows (no per-row detail fetches). */

export type TaskWorkflowType = 'manual' | 'checklist_assigned' | 'checklist_template';
export type TaskWorkflowStatus = 'pending' | 'in_progress' | 'completed';

export function eventId(ev: any): string {
  const id = ev?.id ?? ev?.pk ?? ev?.uuid;
  if (id == null || id === '') return '';
  return String(id);
}

export function taskUserId(t: any): string {
  const userLike =
    t?.user_id ??
    t?.assigned_user_id ??
    t?.assignee_id ??
    t?.owner_id ??
    (typeof t?.user === 'object' ? t?.user?.id : t?.user) ??
    (typeof t?.assigned_user === 'object' ? t?.assigned_user?.id : t?.assigned_user) ??
    (typeof t?.assigned_to === 'object' && !Array.isArray(t?.assigned_to)
      ? t?.assigned_to?.id
      : null) ??
    (typeof t?.assignee === 'object' ? t?.assignee?.id : t?.assignee) ??
    (typeof t?.owner === 'object' ? t?.owner?.id : t?.owner);
  return userLike == null ? '' : String(userLike);
}

/** True when task is owned by or assigned to the given user (matches backend employee scope). */
export function isTaskVisibleToUser(t: any, userId: string): boolean {
  const uid = String(userId).trim();
  if (!uid) return false;
  if (taskUserId(t) === uid) return true;
  const ownerId =
    typeof t?.user === 'object' && t?.user?.id != null ? String(t.user.id) : t?.user != null ? String(t.user) : '';
  if (ownerId === uid) return true;
  const summary = t?.assigned_to_summary;
  if (Array.isArray(summary) && summary.some((u: any) => String(u?.id ?? '') === uid)) return true;
  const details = t?.assigned_to_details;
  if (Array.isArray(details) && details.some((u: any) => String(u?.id ?? '') === uid)) return true;
  return false;
}

export function isTaskLikeEvent(t: any): boolean {
  if (!t || typeof t !== 'object') return false;
  if (t.is_task === true || t.for_task === true) return true;
  const etRaw = t.event_type ?? t.type ?? t.kind;
  if (etRaw && typeof etRaw === 'object') {
    const nested = String(
      (etRaw as any).name ?? (etRaw as any).slug ?? (etRaw as any).label ?? ''
    ).toLowerCase();
    if (nested.includes('task')) return true;
  }
  const et = String(etRaw ?? '').toLowerCase();
  if (et.includes('task')) return true;
  const sub = String(t.event_subtype ?? t.task_category ?? t.category ?? '').toLowerCase();
  if (sub.includes('task')) return true;
  if (t.priority != null && String(t.priority).trim() !== '') return true;
  if (t.completed === true || t.is_completed === true || t.done === true || t.is_done === true) return true;
  const hasAssignee =
    t.assigned_user_id != null ||
    t.assignee_id != null ||
    (typeof t.assigned_user === 'object' && t.assigned_user != null) ||
    (typeof t.assignee === 'object' && t.assignee != null);
  const title = String(t.title ?? t.name ?? '').trim();
  if (title && hasAssignee) {
    const avoid = (s: string) =>
      s.includes('meeting') || s.includes('focus') || s.includes('habit') || s.includes('routine');
    if (typeof etRaw === 'object' && etRaw != null) {
      const nest = String((etRaw as any).name ?? (etRaw as any).slug ?? '').toLowerCase();
      if (avoid(nest)) return false;
    }
    if (avoid(et) || avoid(sub)) return false;
    return true;
  }
  return false;
}

/** Master checklist catalog row (managers only) — not shown on employee Tasks page. */
export function isMasterChecklistTemplateTask(t: any): boolean {
  const tid = t?.template_id ?? t?.checklist_template_id ?? t?.templateId;
  if (tid == null || String(tid).trim() === '') return false;
  if (t.is_assigned === true || t.isAssigned === true) return false;
  if (t.shift != null || t.shift_id != null) return false;
  return true;
}

export function classifyTaskType(t: any): TaskWorkflowType {
  const apiType = String(t?.task_type ?? '').toLowerCase();
  if (apiType === 'manual') return 'manual';
  if (apiType === 'assigned') return 'checklist_assigned';
  if (isMasterChecklistTemplateTask(t)) return 'checklist_template';
  const tid = t?.template_id ?? t?.checklist_template_id;
  if (tid != null && String(tid).trim() !== '') {
    if (t.is_assigned === true || t.shift != null || t.shift_id != null) return 'checklist_assigned';
  }
  if (t.is_assigned === true) return 'checklist_assigned';
  return 'manual';
}

export function taskIsCompleted(t: any): boolean {
  if (t?.completed === true || t?.is_completed === true) return true;
  if (t?.done === true || t?.is_done === true) return true;
  if (t?.completed_at || t?.completed_on || t?.completed_date) return true;
  const raw = t?.status ?? t?.task_status ?? t?.event_status ?? t?.state ?? '';
  const st = String(raw).toLowerCase().replace(/[\s-]+/g, '_');
  if (['completed', 'complete', 'done', 'closed', 'resolved', 'cancelled'].includes(st)) return true;
  if (st === 'todo') return false;
  if (st.endsWith('_completed')) return true;
  return false;
}

export function taskIsInProgress(t: any): boolean {
  if (taskIsCompleted(t)) return false;
  const raw = t?.status ?? t?.task_status ?? '';
  const st = String(raw).toLowerCase().replace(/[\s-]+/g, '_');
  return st === 'in_progress' || st === 'inprogress' || st === 'in progress';
}

export function taskWorkflowStatus(t: any): TaskWorkflowStatus {
  if (taskIsCompleted(t)) return 'completed';
  if (taskIsInProgress(t)) return 'in_progress';
  return 'pending';
}

export function taskStatusLabel(t: any): 'Completed' | 'In Progress' | 'Pending' {
  const s = taskWorkflowStatus(t);
  if (s === 'completed') return 'Completed';
  if (s === 'in_progress') return 'In Progress';
  return 'Pending';
}

export function taskTypeLabel(t: any): string {
  const k = classifyTaskType(t);
  if (k === 'checklist_template') return 'Checklist template';
  if (k === 'checklist_assigned') return 'Assigned checklist';
  return 'Manual Task';
}

/** Map tasks.Task row for date-range overlap (due_date or created_at). */
export function taskRowForRangeCheck(t: any): any {
  const anchor = t?.due_date ?? t?.created_at ?? t?.start_time ?? t?.start;
  return { ...t, start_time: anchor, end_time: t?.due_date ?? t?.end_time ?? anchor };
}

export function isWorkTaskRow(t: any): boolean {
  if (!t || typeof t !== 'object') return false;
  if (t.is_template === true) return false;
  if (isTasksApiRow(t)) return true;
  const tt = String(t?.task_type ?? '').toLowerCase();
  if (tt === 'manual' || tt === 'assigned') return true;
  if (tt === 'template') return false;
  const id = eventId(t);
  const hasTitle = String(t?.title ?? t?.task_name ?? t?.name ?? '').trim() !== '';
  if (id && hasTitle && !isMasterChecklistTemplateTask(t)) return true;
  return isTaskLikeEvent(t);
}

/** Tasks without due/start dates stay visible when date filter is "All dates". */
export function taskHasSchedulableDate(t: any): boolean {
  return !!(
    t?.due_date ??
    t?.start_time ??
    t?.start ??
    t?.end_time ??
    t?.end ??
    t?.scheduled_at ??
    t?.created_at ??
    t?.created
  );
}

export function organizationIdFromTask(t: any): string {
  const o = t?.organization_id ?? t?.organization;
  if (o != null && typeof o === 'object') return String((o as any).id ?? '').trim();
  return o != null ? String(o).trim() : '';
}

export function companyIdFromTask(t: any): string {
  const c = t?.company_id ?? t?.company;
  if (c != null && typeof c === 'object') return String((c as any).id ?? '').trim();
  return c != null ? String(c).trim() : '';
}

export function organizationNameFromTask(t: any): string {
  const o = t?.organization;
  if (o != null && typeof o === 'object') {
    return String((o as any).name ?? (o as any).title ?? '').trim();
  }
  return String(t?.organization_name ?? '').trim();
}

export function companyNameFromTask(t: any): string {
  const c = t?.company;
  if (c != null && typeof c === 'object') {
    return String((c as any).name ?? (c as any).title ?? '').trim();
  }
  return String(t?.company_name ?? '').trim();
}

export function taskDueDisplay(t: any): string {
  const raw = t?.due_date ?? t?.end_time ?? t?.end ?? t?.start_time ?? t?.start;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function eventOverlapsRange(ev: any, start: Date, end: Date): boolean {
  const stRaw =
    ev?.start_time ??
    ev?.start ??
    ev?.scheduled_at ??
    ev?.date ??
    ev?.start_date ??
    ev?.created_at ??
    ev?.created;
  if (!stRaw) {
    const enOnly = ev?.end_time ?? ev?.end ?? ev?.end_date;
    if (!enOnly) return false;
    const en = new Date(enOnly);
    if (Number.isNaN(en.getTime())) return false;
    return en.getTime() >= start.getTime() && en.getTime() <= end.getTime();
  }
  const st = new Date(stRaw);
  if (Number.isNaN(st.getTime())) return false;
  const enRaw = ev?.end_time ?? ev?.end ?? ev?.end_date;
  const en = enRaw ? new Date(enRaw) : null;
  if (en && !Number.isNaN(en.getTime())) {
    return st.getTime() <= end.getTime() && en.getTime() >= start.getTime();
  }
  return st.getTime() >= start.getTime() && st.getTime() <= end.getTime();
}

/** Employees: assigned work only — no master checklist catalog rows. */
export function isVisibleToEmployee(t: any, employeeUserId: string): boolean {
  if (isMasterChecklistTemplateTask(t)) return false;
  if (!isWorkTaskRow(t) && !isTaskLikeEvent(t)) return false;
  return isTaskVisibleToUser(t, employeeUserId);
}

function calendarEventIdFromWorkTask(t: any): string {
  const src = t?.source_calendar_event ?? t?.source_calendar_event_id ?? t?.calendar_event_id;
  if (src == null || src === '') return '';
  if (typeof src === 'object' && src.id != null) return String(src.id);
  return String(src).trim();
}

/** True when row came from GET /api/tasks/ (tasks.Task), not calendar-only. */
export function isTasksApiRow(t: any): boolean {
  if (!t || typeof t !== 'object') return false;
  const tt = String(t?.task_type ?? '').toLowerCase();
  if (tt === 'manual' || tt === 'assigned') return true;
  if (t?.due_date != null || t?.task_name != null) return true;
  if (t?.source_calendar_event != null || t?.source_calendar_event_id != null) return true;
  if (t?.checklist_template_task != null) return true;
  return false;
}

/**
 * Merge GET /tasks/ + GET /calendar/events/ — work rows first so manual tasks.Task rows
 * win over calendar duplicates (backend often uses the same UUID for both).
 */
export function mergeWorkAndCalendarTaskLists(workTasks: any[], calendar: any[]): any[] {
  const work = (Array.isArray(workTasks) ? workTasks : []).filter(Boolean);
  const cal = (Array.isArray(calendar) ? calendar : []).filter(Boolean);
  const workIds = new Set(work.map((w) => eventId(w)).filter(Boolean));
  const linkedCalIds = new Set(
    work.map((w) => calendarEventIdFromWorkTask(w)).filter(Boolean)
  );

  const calOnly = cal.filter((c) => {
    const cid = eventId(c);
    if (!cid) return true;
    if (workIds.has(cid)) return false;
    if (linkedCalIds.has(cid)) return false;
    return true;
  });

  return dedupeTasks([...work, ...calOnly]);
}

export function dedupeTasks(items: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const t of items) {
    if (!t || typeof t !== 'object') continue;
    const id = eventId(t);
    const key =
      id ||
      `${String(t.title ?? t.task_name ?? '')}|${taskUserId(t)}|${String(
        t.due_date ?? t.start_time ?? ''
      )}|${String(t.template_id ?? '')}|${String(t.task_type ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function mergeUniqueTaskLists(batches: any[][]): any[] {
  return dedupeTasks(batches.flat());
}

/** Checklist template catalog row — never on Tasks page. */
export function isTasksPageRow(t: any, opts: { employeeUserId?: string }): boolean {
  if (!t || typeof t !== 'object') return false;
  if (classifyTaskType(t) === 'checklist_template' || isMasterChecklistTemplateTask(t)) return false;
  if (t.is_template === true) return false;
  if (!isWorkTaskRow(t) && !isTaskLikeEvent(t)) return false;

  const uid = String(opts.employeeUserId ?? '').trim();
  if (uid) {
    if (!isVisibleToEmployee(t, uid)) return false;
    const tt = classifyTaskType(t);
    if (tt === 'manual' && !isTaskVisibleToUser(t, uid)) return false;
    return true;
  }
  return true;
}

export function taskChecklistSourceName(t: any): string {
  if (classifyTaskType(t) !== 'checklist_assigned') return '';
  const nested =
    typeof t?.checklist_template_task === 'object' && t.checklist_template_task != null
      ? t.checklist_template_task
      : null;
  return String(
    t?.template_name ??
      t?.checklist_template_name ??
      nested?.template_name ??
      nested?.name ??
      ''
  ).trim();
}

export function taskHasAssignee(t: any): boolean {
  if (taskUserId(t)) return true;
  const summary = t?.assigned_to_summary;
  if (Array.isArray(summary) && summary.length > 0) return true;
  if (typeof summary === 'string' && summary.trim()) return true;
  if (t?.is_assigned === true || t?.isAssigned === true) return true;
  return false;
}

export function filterTasksPageList(rows: any[], opts: { employeeUserId?: string }): any[] {
  return dedupeTasks(rows.filter((t) => isTasksPageRow(t, opts)));
}
