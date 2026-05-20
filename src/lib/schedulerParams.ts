/** Query helpers for `/scheduler/shifts/` — backend accepts `start_date`, `end_date`, `employee`, `company` only. */

const STRIP_KEY_RE =
  /__(gte|lte|gt|lt|icontains|contains|exact|in|isnull|range)$/i;

export const DEFAULT_SCHEDULER_PAGE_SIZE = 100;

export function formatSchedulerDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Drop empty values and Django lookup operators the shift API rejects. */
export function cleanSchedulerParams(params?: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (STRIP_KEY_RE.test(key)) continue;
    if (key.includes('__')) continue;
    out[key] = value as string | number | boolean;
  }
  return out;
}

export function buildShiftRangeParams(opts: {
  rangeStart: Date;
  rangeEnd: Date;
  employeeId?: string | null;
  companyId?: string | null;
  pageSize?: number;
}): Record<string, string | number | boolean> {
  const raw: Record<string, unknown> = {
    start_date: formatSchedulerDateYmd(opts.rangeStart),
    end_date: formatSchedulerDateYmd(opts.rangeEnd),
    page_size: opts.pageSize ?? DEFAULT_SCHEDULER_PAGE_SIZE,
  };
  const eid = String(opts.employeeId ?? '').trim();
  const cid = String(opts.companyId ?? '').trim();
  if (eid) raw.employee = eid;
  if (cid && !cid.toLowerCase().includes('object')) raw.company = cid;
  return cleanSchedulerParams(raw);
}

export function buildCalendarRangeParams(opts: {
  rangeStart: Date;
  rangeEnd: Date;
  userId?: string | null;
}): Record<string, string | number | boolean> {
  // Backend: `start_time__lte=end_date` compares to start-of-day on end_date, so same-day
  // ranges (e.g. Today) omit almost all events. Send the day after rangeEnd as exclusive upper bound.
  const endExclusive = new Date(opts.rangeEnd);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const raw: Record<string, unknown> = {
    start_date: formatSchedulerDateYmd(opts.rangeStart),
    end_date: formatSchedulerDateYmd(endExclusive),
  };
  const uid = String(opts.userId ?? '').trim();
  if (uid) raw.user = uid;
  return cleanSchedulerParams(raw);
}

/**
 * `/scheduler/employees/` uses `pagination_class = None` — `page_size` / `limit` cause 400.
 * Match by auth user on the client after `company` / `email` / `search` list fetches.
 */
const EMPLOYEE_LIST_ALLOWED = new Set([
  'company',
  'company_id',
  'companyId',
  'department',
  'employee_role',
  'team',
  'status',
  'email',
  'organization',
  'organization_id',
  'organizationId',
  'search',
  'ordering',
  'for_shift_swap',
  'coworkers',
  'swap_coworkers',
  'for_tasks',
  'forTasks',
  'members',
]);

export function cleanEmployeeListParams(
  params?: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'page_size' || key === 'limit') continue;
    if (key === 'user' || key === 'user_id') continue;
    if (key.includes('__')) continue;
    if (!EMPLOYEE_LIST_ALLOWED.has(key)) continue;
    out[key] = value as string | number | boolean;
  }
  return out;
}

/** Task events for an employee calendar/dashboard — `start_date` / `end_date` only. */
export function buildTaskCalendarRangeParams(opts: {
  rangeStart: Date;
  rangeEnd: Date;
  userId?: string | null;
  assigneeField?: 'assigned_user' | 'user';
}): Record<string, string | number | boolean> {
  const uid = String(opts.userId ?? '').trim();
  const field = opts.assigneeField ?? 'assigned_user';
  const raw: Record<string, unknown> = {
    ...buildCalendarRangeParams(opts),
    event_type: 'task',
  };
  if (uid) raw[field] = uid;
  return cleanSchedulerParams(raw);
}
