import apiClient, { HttpError } from '../lib/api-client';

const DEFAULT_COMPANY_TYPE = 'General';

function attachId<T extends Record<string, any>>(item: T): T {
  if (!item || typeof item !== 'object') return item;
  const o = { ...item } as T & { id?: string; pk?: string | number; uuid?: string };
  if (o.id == null && o.pk != null) (o as any).id = String(o.pk);
  if (o.id == null && o.uuid != null) (o as any).id = String(o.uuid);
  return o as T;
}

/** POST/PATCH body matches backend: `{ name, type, organization? }` (organization = UUID string). */
function buildCompanyWriteBody(data: Record<string, any>, mode: 'create' | 'patch'): Record<string, any> {
  const body: Record<string, any> = {};
  if (mode === 'create') {
    body.name = String(data.name || '').trim();
    const t = data.type != null ? String(data.type).trim() : '';
    body.type = t || DEFAULT_COMPANY_TYPE;
  } else {
    if (data.name != null) {
      const n = String(data.name).trim();
      if (n) body.name = n;
    }
    if (data.type != null) {
      const t = String(data.type).trim();
      if (t) body.type = t;
    }
  }
  const orgRaw = data.organization ?? data.organization_id;
  if (orgRaw != null && String(orgRaw).trim() !== '') {
    body.organization = String(orgRaw).trim();
  }

  // Optional fields used by CompaniesScreen edit/create dialogs.
  const optionalMap: Array<[string, string]> = [
    ['brand_color', 'brand_color'],
    ['color', 'color'],
    ['address', 'address'],
    ['phone', 'phone'],
    ['email', 'email'],
    ['company_manager', 'company_manager'],
    ['company_manager_id', 'company_manager_id'],
  ];
  for (const [srcKey, dstKey] of optionalMap) {
    const raw = data[srcKey];
    if (raw != null && String(raw).trim() !== '') {
      body[dstKey] = String(raw).trim();
    }
  }
  return body;
}

export function normalizePaginatedList<T extends Record<string, any>>(raw: any): T[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((x) => attachId(x));
  if (typeof raw === 'object') {
    const list =
      raw.results ??
      raw.sessions ??
      raw.focus_sessions ??
      raw.organizations ??
      raw.companies ??
      raw.schedule_templates ??
      raw.templates ??
      raw.shifts ??
      raw.items ??
      raw.records ??
      (Array.isArray(raw.data) ? raw.data : undefined);
    if (Array.isArray(list)) return list.map((x) => attachId(x));
    if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
      const inner =
        raw.data.results ??
        raw.data.sessions ??
        raw.data.items ??
        raw.data.organizations ??
        raw.data.schedule_templates;
      if (Array.isArray(inner)) return inner.map((x) => attachId(x));
    }
  }
  return [attachId(raw as T)];
}

/** Row shapes for scheduler list endpoints (matches screen `Organization` / `Company` / `Employee` types). */
export type SchedulerOrganization = { id: string; name: string; [k: string]: any };
export type SchedulerCompany = { id: string; name: string; [k: string]: any };
export type SchedulerEmployee = { id: string; [k: string]: any };

/** Django may return `company_manager` (PK) without `company_manager_id`; normalize for UI filters. */
export function resolveCompanyManagerUserId(c: Record<string, any> | null | undefined): string {
  if (!c || typeof c !== 'object') return '';
  const raw = c.company_manager_id ?? c.company_manager;
  if (raw != null && raw !== '') {
    if (typeof raw === 'object' && (raw as any).id != null) return String((raw as any).id);
    return String(raw);
  }
  const details = (c as any).company_manager_details;
  if (details?.id != null) return String(details.id);
  return '';
}

/**
 * Optional client filter for company managers. Backend list is already RBAC-scoped; if FK shapes
 * differ and nothing matches, keep the list so the UI still shows the assigned company(ies).
 */
export function filterCompaniesForCompanyManagerRole<T extends Record<string, any>>(
  companies: T[],
  role: string | null | undefined,
  userId: string | null | undefined
): T[] {
  if (role !== 'manager' || userId == null || String(userId) === '') return companies;
  const uid = String(userId);
  const matched = companies.filter((c) => resolveCompanyManagerUserId(c) === uid);
  return matched.length > 0 ? matched : companies;
}

// —— Auth / users ——
export async function getCurrentUser() {
  return apiClient.get<any>('/auth/user/');
}
export async function getUsers(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/auth/users/', params);
  return normalizePaginatedList(raw);
}
export async function getUser(id: string) {
  return apiClient.get<any>(`/auth/users/${id}/`);
}
export async function createUser(data: any) {
  return apiClient.post<any>('/auth/users/', data);
}
export async function updateUser(id: string, data: any) {
  return apiClient.patch<any>(`/auth/users/${id}/`, data);
}
export async function deleteUser(id: string) {
  return apiClient.delete(`/auth/users/${id}/`);
}
export async function updateProfile(data: any) {
  return apiClient.patch<any>('/auth/profile/', data);
}
export async function changePassword(data: { old_password: string; new_password: string }) {
  return apiClient.post<any>('/auth/change-password/', data);
}

// —— Calendar / tasks (events) ——
export async function getCalendarEvents(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/calendar/events/', params);
  return normalizePaginatedList(raw);
}
export async function createCalendarEvent(data: any) {
  return apiClient.post<any>('/calendar/events/', data);
}

/** POST /calendar/events/ with field-name fallbacks (user vs assigned_user, all_day vs is_all_day). */
export async function createTaskEvent(input: {
  title: string;
  description?: string;
  priority: string;
  isAllDay: boolean;
  startIso: string;
  endIso: string;
  assigneeUserId: string;
}) {
  const { title, description, priority, isAllDay, startIso, endIso, assigneeUserId } = input;
  const uid = String(assigneeUserId);
  const core: Record<string, any> = {
    title,
    event_type: 'task',
    start_time: startIso,
    end_time: endIso,
    priority,
  };
  const desc = description?.trim();
  if (desc) core.description = desc;

  const dayA = isAllDay ? { all_day: true } : { all_day: false };
  const dayB = isAllDay ? { is_all_day: true } : { is_all_day: false };
  const dayBoth = { ...dayA, ...dayB };

  const coreName: Record<string, any> = {
    name: title,
    event_type: 'task',
    start_time: startIso,
    end_time: endIso,
    priority,
  };
  if (desc) coreName.description = desc;

  const bodies: Record<string, any>[] = [];
  const titleBases = [core, coreName];
  const withUser = (b: Record<string, any>, day: Record<string, any>) => [
    { ...b, user: uid, ...day },
    { ...b, assigned_user: uid, ...day },
    { ...b, assignee: uid, ...day },
    { ...b, assigned_to: uid, ...day },
    { ...b, user_id: uid, ...day },
    { ...b, owner: uid, ...day },
  ];
  for (const base of titleBases) {
    if (!isAllDay) {
      bodies.push({ ...base, user: uid }, { ...base, assigned_user: uid }, { ...base, assignee: uid });
    }
    for (const b of withUser(base, dayBoth)) bodies.push(b);
    for (const b of withUser(base, dayA)) bodies.push(b);
    for (const b of withUser(base, dayB)) bodies.push(b);
  }

  let last: unknown;
  for (const body of bodies) {
    try {
      return await apiClient.post<any>('/calendar/events/', body);
    } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status === 400) continue;
      throw e;
    }
  }
  throw last;
}

const CAL_EVENT_PATH = (id: string) => {
  const enc = encodeURIComponent(String(id));
  return [`/calendar/events/${id}/`, `/calendar/events/${enc}/`] as const;
};

/** PATCH task event with field fallbacks (all_day, start/end aliases). */
export async function updateTaskEvent(
  id: string,
  input: {
    title: string;
    description?: string;
    priority: string;
    isAllDay: boolean;
    startIso: string;
    endIso: string;
  }
) {
  const { title, description, priority, isAllDay, startIso, endIso } = input;
  const desc = description?.trim();
  const dayA = isAllDay ? { all_day: true } : { all_day: false };
  const dayB = isAllDay ? { is_all_day: true } : { is_all_day: false };
  const dayBoth = { ...dayA, ...dayB };

  const cores: Record<string, any>[] = [];
  const a: Record<string, any> = { title, priority, start_time: startIso, end_time: endIso, ...dayBoth };
  if (desc) a.description = desc;
  cores.push(a);
  cores.push({ name: title, priority, start_time: startIso, end_time: endIso, ...dayBoth });
  cores.push({ title, priority, start_time: startIso, end_time: endIso, ...dayA });
  cores.push({ title, priority, start: startIso, end: endIso, ...dayBoth });
  cores.push({ title, priority, start_time: startIso, end_time: endIso, is_all_day: !!isAllDay });
  if (desc) {
    cores.push({ title, description: desc, priority, start_time: startIso, end_time: endIso });
    cores.push({ name: title, description: desc, priority, start_time: startIso, end_time: endIso });
  }

  let last: unknown;
  for (const path of CAL_EVENT_PATH(id)) {
    for (const body of cores) {
      try {
        return await apiClient.patch<any>(path, body);
      } catch (e) {
        last = e;
        if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;
        throw e;
      }
    }
  }
  throw last;
}

/** PATCH assignee only (user field variants). */
export async function assignTaskEvent(id: string, assigneeUserId: string) {
  const uid = String(assigneeUserId);
  const bodies = [
    { user: uid },
    { assigned_user: uid },
    { assignee: uid },
    { assigned_to: uid },
    { user_id: uid },
  ];
  let last: unknown;
  for (const path of CAL_EVENT_PATH(id)) {
    for (const body of bodies) {
      try {
        return await apiClient.patch<any>(path, body);
      } catch (e) {
        last = e;
        if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;
        throw e;
      }
    }
  }
  throw last;
}

/** Mark calendar task completed (field name fallbacks). */
export async function updateTaskCompleted(id: string, completed: boolean) {
  const bodies = [
    { completed },
    { is_completed: completed },
    { done: completed },
    { is_done: completed },
    { status: completed ? 'completed' : 'pending' },
    { status: completed ? 'done' : 'pending' },
  ];
  let last: unknown;
  const enc = encodeURIComponent(String(id));
  const actionPaths = [
    `/calendar/events/${id}/complete/`,
    `/calendar/events/${enc}/complete/`,
    `/calendar/events/${id}/mark_complete/`,
    `/calendar/events/${enc}/mark_complete/`,
    `/calendar/events/${id}/mark_completed/`,
    `/calendar/events/${enc}/mark_completed/`,
    `/calendar/events/${id}/toggle_complete/`,
    `/calendar/events/${enc}/toggle_complete/`,
    `/calendar/events/${id}/toggle_completed/`,
    `/calendar/events/${enc}/toggle_completed/`,
    `/calendar/events/${id}/mark_done/`,
    `/calendar/events/${enc}/mark_done/`,
  ] as const;

  // 1) Preferred: PATCH the event with field fallbacks.
  for (const path of CAL_EVENT_PATH(id)) {
    for (const body of bodies) {
      try {
        return await apiClient.patch<any>(path, body);
      } catch (e) {
        last = e;
        if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;
        throw e;
      }
    }
  }

  // 2) Fallback: custom action endpoints (common in DRF ViewSets).
  const actionBodies: Record<string, any>[] = [
    { completed },
    { is_completed: completed },
    { done: completed },
    { status: completed ? 'completed' : 'pending' },
    {}, // some endpoints ignore body and just toggle
  ];
  for (const path of actionPaths) {
    for (const body of actionBodies) {
      try {
        return await apiClient.post<any>(path, body);
      } catch (e) {
        last = e;
        if (e instanceof HttpError && (e.status === 400 || e.status === 404 || e.status === 405)) continue;
        throw e;
      }
    }
  }

  throw last;
}

/** POST subtask: same as task event with parent_* field fallbacks. */
export async function createSubtaskEvent(
  parentEventId: string,
  input: {
    title: string;
    description?: string;
    priority: string;
    isAllDay: boolean;
    startIso: string;
    endIso: string;
    assigneeUserId: string;
  }
) {
  const pid = String(parentEventId);
  const parentKeys = [
    { parent_event: pid },
    { parent: pid },
    { parent_id: pid },
    { parent_task: pid },
  ];

  const { title, description, priority, isAllDay, startIso, endIso, assigneeUserId } = input;
  const uid = String(assigneeUserId);
  const desc = description?.trim();
  const core: Record<string, any> = {
    title,
    event_type: 'task',
    start_time: startIso,
    end_time: endIso,
    priority,
  };
  if (desc) core.description = desc;
  const coreName: Record<string, any> = {
    name: title,
    event_type: 'task',
    start_time: startIso,
    end_time: endIso,
    priority,
  };
  if (desc) coreName.description = desc;

  const dayA = isAllDay ? { all_day: true } : { all_day: false };
  const dayB = isAllDay ? { is_all_day: true } : { is_all_day: false };
  const dayBoth = { ...dayA, ...dayB };

  const bases: Record<string, any>[] = [];
  for (const c of [core, coreName]) {
    if (!isAllDay) {
      bases.push({ ...c, user: uid }, { ...c, assigned_user: uid }, { ...c, assignee: uid });
    }
    bases.push(
      { ...c, user: uid, ...dayBoth },
      { ...c, assigned_user: uid, ...dayBoth },
      { ...c, user_id: uid, ...dayBoth }
    );
  }

  let last: unknown;
  for (const pk of parentKeys) {
    for (const b of bases) {
      const body = { ...b, ...pk };
      try {
        return await apiClient.post<any>('/calendar/events/', body);
      } catch (e) {
        last = e;
        if (e instanceof HttpError && e.status === 400) continue;
        throw e;
      }
    }
  }
  throw last;
}

export async function updateCalendarEvent(id: string, data: any) {
  return apiClient.patch<any>(`/calendar/events/${id}/`, data);
}
export async function deleteCalendarEvent(id: string) {
  const enc = encodeURIComponent(String(id));
  const paths = [`/calendar/events/${id}/`, `/calendar/events/${enc}/`];
  let last: unknown;
  for (const p of paths) {
    try {
      return await apiClient.delete(p);
    } catch (e) {
      last = e;
      if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;
      throw e;
    }
  }
  throw last;
}

// —— Scheduler: organizations ——
export async function getOrganizations(
  params?: Record<string, any>
): Promise<SchedulerOrganization[]> {
  const raw = await apiClient.get<any>('/scheduler/organizations/', params);
  return normalizePaginatedList<SchedulerOrganization>(raw);
}
export async function createOrganization(data: any) {
  return apiClient.post<any>('/scheduler/organizations/', data);
}
export async function updateOrganization(id: string, data: any) {
  return apiClient.patch<any>(`/scheduler/organizations/${id}/`, data);
}
export async function deleteOrganization(id: string) {
  return apiClient.delete(`/scheduler/organizations/${id}/`);
}

// —— Scheduler: companies ——
export async function getCompanies(params?: Record<string, any>): Promise<SchedulerCompany[]> {
  const raw = await apiClient.get<any>('/scheduler/companies/', params);
  const list = normalizePaginatedList<SchedulerCompany>(raw);
  return list.map((row) => {
    const c = { ...row } as SchedulerCompany;
    const mid = resolveCompanyManagerUserId(c);
    if (mid) (c as any).company_manager_id = mid;
    return c;
  });
}
export async function getCompany(id: string) {
  return apiClient.get<any>(`/scheduler/companies/${id}/`);
}
export async function createCompany(data: any) {
  const body = buildCompanyWriteBody(data, 'create');
  if (!body.name) throw new Error('Company name is required');
  return apiClient.post<any>('/scheduler/companies/', body);
}

export async function updateCompany(id: string, data: any) {
  const body = buildCompanyWriteBody(data, 'patch');
  return apiClient.patch<any>(`/scheduler/companies/${id}/`, body);
}
export async function deleteCompany(id: string) {
  return apiClient.delete(`/scheduler/companies/${id}/`);
}

// —— Scheduler: departments ——
export async function getDepartments(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/departments/', params);
  return normalizePaginatedList(raw);
}

// —— Scheduler: employees ——
export async function getEmployees(params?: Record<string, any>): Promise<SchedulerEmployee[]> {
  const raw = await apiClient.get<any>('/scheduler/employees/', params);
  return normalizePaginatedList<SchedulerEmployee>(raw);
}
export async function resolveEmployeeForUser(user?: { id?: string | null; email?: string | null } | null) {
  const userId = user?.id != null ? String(user.id) : '';
  const userEmail = user?.email != null ? String(user.email).trim().toLowerCase() : '';
  if (!userId && !userEmail) return null;

  const tryFetch = async (params?: Record<string, any>) => {
    try {
      const rows = await getEmployees(params);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  const byUser = userId ? await tryFetch({ user: userId }) : [];
  if (byUser.length > 0) return byUser[0];

  const byUserId = userId ? await tryFetch({ user_id: userId }) : [];
  if (byUserId.length > 0) return byUserId[0];

  const all = await tryFetch();
  if (all.length === 0) return null;

  return (
    all.find((e: any) => String(e?.user ?? e?.user_id ?? e?.user?.id ?? '') === userId) ||
    all.find((e: any) => {
      const linked = e?.user;
      const linkedEmail =
        (typeof linked === 'object' && linked ? (linked as any).email : null) ??
        e?.email ??
        e?.user_email ??
        '';
      return String(linkedEmail).trim().toLowerCase() === userEmail;
    }) ||
    null
  );
}
export async function getEmployee(id: string) {
  return apiClient.get<any>(`/scheduler/employees/${id}/`);
}
export async function createEmployee(data: any) {
  return apiClient.post<any>('/scheduler/employees/', data);
}
export async function updateEmployee(id: string, data: any) {
  return apiClient.patch<any>(`/scheduler/employees/${id}/`, data);
}
export async function deleteEmployee(id: string) {
  return apiClient.delete(`/scheduler/employees/${id}/`);
}

// —— Scheduler: shifts ——
export async function getShifts(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/shifts/', params);
  return normalizePaginatedList(raw);
}

let lastShiftRangeQueryIndex: number | null = null;
let lastShiftBroadCompanyKey: 'company' | 'company_id' | null = null;

/**
 * Load shifts for a company in [rangeStart, rangeEnd]. Tries common Django filter param names,
 * then falls back to fetching by company and filtering client-side (fixes empty grids when
 * `start_date`/`end_date` are not supported).
 */
export async function getShiftsForCompanyInRange(params: {
  companyId: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<any[]> {
  const cid = String(params.companyId || '').trim();
  if (!cid) return [];

  const rs = params.rangeStart.toISOString();
  const re = params.rangeEnd.toISOString();
  const rsDate = rs.slice(0, 10);
  const reDate = re.slice(0, 10);

  const tryQ = async (q: Record<string, any>) => {
    try {
      const rows = await getShifts(q);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  const queryTries: Record<string, any>[] = [
    { company: cid, start_date: rs, end_date: re },
    { company: cid, start_date: rsDate, end_date: reDate },
    { company_id: cid, start_date: rs, end_date: re },
    { company: cid, start_time__gte: rs, start_time__lte: re },
    { company: cid, date__gte: rsDate, date__lte: reDate },
    { company: cid, from_date: rsDate, to_date: reDate },
    { company: cid, week_start: rsDate, week_end: reDate },
  ];

  const companyMatches = (s: any): boolean => {
    const c = s?.company_id ?? s?.company;
    if (c == null || c === '') return true;
    if (typeof c === 'object' && (c as any).id != null) return String((c as any).id).trim() === cid;
    return String(c).trim() === cid;
  };
  const inRange = (s: any): boolean => {
    const stRaw = s?.start_time ?? s?.start ?? s?.start_at ?? s?.time_in ?? s?.start_datetime;
    const st = stRaw ? new Date(stRaw) : null;
    if (!st || Number.isNaN(st.getTime())) return false;
    const t = st.getTime();
    return t >= params.rangeStart.getTime() && t <= params.rangeEnd.getTime();
  };
  const normalizeRows = (rows: any[]): any[] => rows.filter((s: any) => companyMatches(s) && inRange(s));

  const order: number[] = [];
  if (lastShiftRangeQueryIndex != null && lastShiftRangeQueryIndex >= 0 && lastShiftRangeQueryIndex < queryTries.length) {
    order.push(lastShiftRangeQueryIndex);
  }
  for (let i = 0; i < queryTries.length; i++) {
    if (!order.includes(i)) order.push(i);
  }

  for (const idx of order) {
    const q = queryTries[idx];
    const rows = await tryQ(q);
    if (rows.length > 0) {
      const filtered = normalizeRows(rows);
      if (filtered.length > 0) {
        lastShiftRangeQueryIndex = idx;
        return filtered;
      }
    }
  }

  const broadOrder: Array<'company' | 'company_id'> = [];
  if (lastShiftBroadCompanyKey) broadOrder.push(lastShiftBroadCompanyKey);
  if (!broadOrder.includes('company')) broadOrder.push('company');
  if (!broadOrder.includes('company_id')) broadOrder.push('company_id');

  let broad: any[] = [];
  for (const key of broadOrder) {
    broad = await tryQ({ [key]: cid });
    if (broad.length > 0) {
      lastShiftBroadCompanyKey = key;
      break;
    }
  }
  if (broad.length === 0) return [];
  return normalizeRows(broad);
}

function dedupeShiftCreateBodies(bodies: Record<string, any>[]): Record<string, any>[] {
  const seen = new Set<string>();
  const out: Record<string, any>[] = [];
  for (const body of bodies) {
    const k = JSON.stringify(
      Object.fromEntries(Object.entries(body).sort(([x], [y]) => x.localeCompare(y)))
    );
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(body);
  }
  return out;
}

/**
 * POST /scheduler/shifts/ — minimal bodies first (company/employee/start/end only), then add fields.
 * Duplicate FK keys and unknown enum values on `shift_type` / `status` commonly cause 400.
 */
export async function createShiftWithFallbacks(data: {
  companyId: string;
  employeeId: string;
  startTimeIso: string;
  endTimeIso: string;
  extras?: Record<string, any>;
}): Promise<any> {
  const { companyId, employeeId, startTimeIso, endTimeIso, extras = {} } = data;
  const strip = (o: Record<string, any>) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined || v === null) continue;
      if (v === '') continue;
      out[k] = v;
    }
    return out;
  };
  const t = { start_time: startTimeIso, end_time: endTimeIso };
  const x = strip(extras);
  if (x.break_duration_minutes != null && x.break_duration != null) delete x.break_duration;

  const cid = String(companyId).trim();
  const eid = String(employeeId).trim();

  const minimalCore = [
    strip({ company: cid, employee: eid, ...t }),
    strip({ company_id: cid, employee_id: eid, ...t }),
    strip({ company: cid, employee_id: eid, ...t }),
    strip({ company_id: cid, employee: eid, ...t }),
  ];
  if (/^\d+$/.test(eid)) {
    const n = parseInt(eid, 10);
    minimalCore.push(strip({ company: cid, employee: n, ...t }), strip({ company_id: cid, employee_id: n, ...t }));
  }

  const xNoEnum = strip({ ...x });
  delete xNoEnum.shift_type;
  delete xNoEnum.status;

  const xLight = strip({
    ...xNoEnum,
    ...(x.break_duration_minutes != null ? { break_duration_minutes: Number(x.break_duration_minutes) } : {}),
    ...(x.notes ? { notes: x.notes } : {}),
    ...(x.hourly_rate ? { hourly_rate: x.hourly_rate } : {}),
  });

  const ordered: Record<string, any>[] = [
    ...minimalCore,
    ...minimalCore.map((b) => strip({ ...b, ...xLight })),
    ...minimalCore.map((b) => strip({ ...b, ...(x.shift_type ? { shift_type: x.shift_type } : {}) })),
    ...minimalCore.map((b) => strip({ ...b, ...(x.status ? { status: x.status } : {}) })),
    ...minimalCore.map((b) => strip({ ...b, ...x })),
  ];

  const bodies = dedupeShiftCreateBodies(ordered);

  let lastErr: unknown;
  for (const body of bodies) {
    if (Object.keys(body).length === 0) continue;
    try {
      return await createShift(body);
    } catch (e: unknown) {
      lastErr = e;
      const st = e instanceof HttpError ? e.status : (e as any)?.status;
      if (st === 401 || st === 403) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not create shift');
}

export async function createShift(data: any) {
  return apiClient.post<any>('/scheduler/shifts/', data);
}
export async function updateShift(id: string, data: any) {
  return apiClient.patch<any>(`/scheduler/shifts/${id}/`, data);
}
export async function deleteShift(id: string) {
  return apiClient.delete(`/scheduler/shifts/${id}/`);
}
export async function publishShiftsWeek(data: any) {
  return apiClient.post<any>('/scheduler/shifts/publish_week/', data);
}
export async function markShiftMissed(id: string) {
  return apiClient.post<any>(`/scheduler/shifts/${id}/mark_missed/`, {});
}

// —— Scheduler: time clock ——
export async function getTimeClockEntries(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/time-clock/', params);
  return normalizePaginatedList(raw);
}

export async function getTimeClockEntriesForEmployee(employeeId: string): Promise<any[]> {
  const id = String(employeeId || '').trim();
  if (!id) return [];
  const tryQ = async (params: Record<string, any>) => {
    try {
      const raw = await getTimeClockEntries(params);
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  };
  let rows = await tryQ({ employee: id });
  if (rows.length > 0) return rows;
  rows = await tryQ({ employee_id: id });
  if (rows.length > 0) return rows;
  const all = await tryQ({});
  return all.filter((e: any) => {
    const eid =
      e?.employee_id ?? (typeof e?.employee === 'object' && e.employee != null ? e.employee.id : e?.employee);
    return String(eid ?? '') === id;
  });
}

export function pickActiveTimeClockEntry(list: any[]): any | null {
  const arr = Array.isArray(list) ? list : [];
  const open = arr.filter((e: any) => {
    if (!e?.clock_in) return false;
    const co = e.clock_out;
    return co == null || co === '';
  });
  if (open.length === 0) return null;
  open.sort(
    (a: any, b: any) => new Date(b.clock_in || 0).getTime() - new Date(a.clock_in || 0).getTime()
  );
  return open[0];
}

export async function getUnscheduledClockRequests() {
  const raw = await apiClient.get<any>('/scheduler/time-clock/unscheduled-requests/');
  return normalizePaginatedList(raw);
}
function dedupeJsonBodies(bodies: Record<string, any>[]): Record<string, any>[] {
  const seen = new Set<string>();
  const out: Record<string, any>[] = [];
  for (const b of bodies) {
    const k = JSON.stringify(
      Object.fromEntries(Object.entries(b).sort(([a], [c]) => a.localeCompare(c)))
    );
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

function isClockInAttemptRetryable(e: any): boolean {
  const st = e instanceof HttpError ? e.status : typeof e?.status === 'number' ? e.status : null;
  if (st === 401 || st === 403) return false;
  return st === 400 || st === 404 || st === 405;
}

export async function clockIn(data: { employee_id: string; shift_id?: string; notes?: string }) {
  const emp = String(data.employee_id || '').trim();
  if (!emp) throw new Error('Missing employee id');
  const shift =
    data.shift_id != null && String(data.shift_id).trim() !== '' ? String(data.shift_id).trim() : undefined;
  const notes =
    data.notes != null && String(data.notes).trim() !== '' ? String(data.notes).trim() : undefined;
  const n = notes ? { notes } : {};

  const withShift = shift
    ? [
        { employee_id: emp, shift_id: shift, ...n },
        { employee: emp, shift: shift, ...n },
        { employee_id: emp, shift: shift, ...n },
        { employee: emp, shift_id: shift, ...n },
        { employee_id: emp, employee: emp, shift_id: shift, shift: shift, ...n },
        { employee_id: emp, scheduled_shift: shift, ...n },
      ]
    : [];
  const noShift = [{ employee_id: emp, ...n }, { employee: emp, ...n }, { employee_id: emp, employee: emp, ...n }];

  const bodies = dedupeJsonBodies([...withShift, ...noShift]);

  const attempts: Array<() => Promise<any>> = [
    ...bodies.map((body) => () => apiClient.post<any>('/scheduler/time-clock/clock_in/', body)),
    ...bodies.map(
      (body) => () => apiClient.post<any>(`/scheduler/employees/${encodeURIComponent(emp)}/clock_in/`, body)
    ),
    () => apiClient.post<any>('/scheduler/time-clock/clock-in/', { employee_id: emp, ...(shift ? { shift_id: shift } : {}), ...n }),
    () => apiClient.post<any>('/scheduler/time-clock/clock-in/', { employee: emp, ...(shift ? { shift } : {}), ...n }),
  ];

  let lastErr: any;
  for (const run of attempts) {
    try {
      return await run();
    } catch (e: any) {
      lastErr = e;
      if (!isClockInAttemptRetryable(e)) throw e;
    }
  }
  throw lastErr ?? new Error('Clock in failed');
}

/** Time-clock rows may expose only `pk` or `uuid`; break/clock-out URLs need this id. */
export function timeClockEntryId(entry: any): string {
  if (entry == null || typeof entry !== 'object') return '';
  let v: any =
    entry.id ?? entry.pk ?? entry.uuid ?? entry.time_clock_entry_id ?? entry.time_clock_entry;
  if (v != null && typeof v === 'object') {
    v = v.id ?? v.pk ?? v.uuid;
  }
  if (v == null || v === '') return '';
  return String(v).trim();
}

function isClockOutRouteMissing(e: any): boolean {
  const status =
    e instanceof HttpError ? e.status : typeof e?.status === 'number' ? e.status : null;
  if (status === 404 || status === 405) return true;
  const m = String(e?.message || '');
  return /\b404\b/.test(m) || /\b405\b/.test(m);
}

export async function clockOut(data: {
  time_clock_entry_id: string;
  notes?: string;
  
  employee_id?: string;
}) {
  const id = String(data.time_clock_entry_id || '').trim();
  if (!id) throw new Error('Missing time clock entry id');
  const enc = encodeURIComponent(id);
  const emp = data.employee_id != null ? String(data.employee_id).trim() : '';
  const extras: Record<string, any> = {};
  if (data.notes != null && String(data.notes).trim() !== '') {
    extras.notes = String(data.notes).trim();
  }
  if (emp) {
    extras.employee_id = emp;
    extras.employee = emp;
  }
  const jsonBody = Object.keys(extras).length ? extras : {};

  const patchClockOut = () => {
    const patch: Record<string, any> = {
      clock_out: new Date().toISOString(),
      ...extras,
    };
    return patch;
  };

  const listBody = { time_clock_entry_id: id, entry_id: id, pk: id, ...extras };

  const attempts: Array<() => Promise<any>> = [
    () => apiClient.post<any>(`/scheduler/time-clock/${id}/clock_out/`, jsonBody),
    () => apiClient.post<any>(`/scheduler/time-clock/${id}/clock-out/`, jsonBody),
    () => apiClient.post<any>(`/scheduler/time-clock/${id}/clockout/`, jsonBody),
    () => apiClient.post<any>(`/scheduler/time-clock/${id}/checkout/`, jsonBody),
    () => apiClient.post<any>(`/scheduler/time-clock/${enc}/clock_out/`, jsonBody),
    () => apiClient.post<any>(`/scheduler/time-clock/${enc}/clock-out/`, jsonBody),
    () => apiClient.post<any>('/scheduler/time-clock/clock-out/', listBody),
    () => apiClient.post<any>('/scheduler/time-clock/clock_out/', listBody),
    () => apiClient.post<any>(`/scheduler/time-clock-entries/${id}/clock_out/`, jsonBody),
    () => apiClient.post<any>(`/scheduler/time-clock-entries/${id}/clock-out/`, jsonBody),
    () => apiClient.post<any>(`/scheduler/time_clock_entries/${id}/clock_out/`, jsonBody),
  ];

  if (emp) {
    attempts.push(
      () => apiClient.post<any>(`/scheduler/employees/${emp}/clock_out/`, listBody),
      () => apiClient.post<any>(`/scheduler/employees/${emp}/clock-out/`, listBody),
      () => apiClient.post<any>(`/scheduler/employees/${emp}/clockout/`, listBody)
    );
  }

  attempts.push(
    () => apiClient.patch<any>(`/scheduler/time-clock/${id}/`, patchClockOut()),
    () => apiClient.patch<any>(`/scheduler/time-clock/${enc}/`, patchClockOut()),
    () => apiClient.patch<any>(`/scheduler/time-clock-entries/${id}/`, patchClockOut())
  );

  let lastErr: any;
  for (const run of attempts) {
    try {
      return await run();
    } catch (e: any) {
      lastErr = e;
      if (!isClockOutRouteMissing(e)) throw e;
    }
  }
  throw lastErr ?? new Error('Clock out failed');
}
export async function startBreak(entryId: string) {
  return apiClient.post<any>(`/scheduler/time-clock/${entryId}/start_break/`, {});
}
export async function endBreak(entryId: string) {
  return apiClient.post<any>(`/scheduler/time-clock/${entryId}/end_break/`, {});
}
export async function approveUnscheduled(entryId: string) {
  return apiClient.post<any>(`/scheduler/time-clock/${entryId}/approve-unscheduled/`, {});
}
export async function updateTimeClockEntry(id: string, data: any) {
  return apiClient.patch<any>(`/scheduler/time-clock/${id}/`, data);
}

// —— Scheduler: replacement requests ——
export async function getReplacementRequests(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/replacement-requests/', params);
  return normalizePaginatedList(raw);
}
export async function createReplacementRequest(data: any) {
  return apiClient.post<any>('/scheduler/replacement-requests/', data);
}
export async function approveReplacementRequest(id: string) {
  return apiClient.post<any>(`/scheduler/replacement-requests/${id}/approve/`, {});
}
export async function rejectReplacementRequest(id: string, data?: { notes?: string }) {
  return apiClient.post<any>(`/scheduler/replacement-requests/${id}/reject/`, data || {});
}

// —— Scheduler: schedule templates ——
/** Plausible list/detail base paths (DRF routers differ: kebab vs snake, nested vs flat). */
const SCHEDULE_TEMPLATE_PATH_PREFIXES = [
  '/scheduler/schedule-templates',
  '/scheduler/schedule_templates',
  '/scheduler/schedule-week-templates',
  '/scheduler/schedule_week_templates',
  '/scheduler/saved-schedule-templates',
  '/scheduler/saved_schedule_templates',
  '/scheduler/week-templates',
  '/scheduler/week_templates',
];

// Remember which schedule-template base path worked for GET so DELETE can mirror it.
let lastScheduleTemplatesApiPath: string | null = null;
let lastScheduleTemplatesCreateApiPath: string | null = null;
let lastScheduleTemplatesCompanyParamIndex: number | null = null;

/**
 * Detail URLs for GET/PATCH: same basename as the working list endpoint first, then other known routers.
 * List may be `/scheduler/week-templates/` while a naive client only tried `/scheduler/schedule-templates/<id>/` → 404 → false "empty template" and cleanup.
 */
function scheduleTemplateIdPaths(id: string): string[] {
  const enc = encodeURIComponent(String(id || '').trim());
  if (!enc) return [];
  const bases: string[] = [];
  const seen = new Set<string>();
  const add = (b: string) => {
    const n = String(b || '').replace(/\/+$/, '');
    if (!n || seen.has(n)) return;
    seen.add(n);
    bases.push(n);
  };
  const lb = lastScheduleTemplatesApiPath?.replace(/\/+$/, '');
  if (lb) add(lb);
  for (const p of SCHEDULE_TEMPLATE_PATH_PREFIXES) add(p);
  return bases.map((b) => `${b}/${enc}/`);
}

export async function getScheduleTemplates(params?: Record<string, any>) {
  const paths = SCHEDULE_TEMPLATE_PATH_PREFIXES.map((p) => `${p}/`);
  let lastErr: unknown;
  for (const path of paths) {
    try {
      const raw = await apiClient.get<any>(path, params);
      // Cache the successful base path (strip trailing slash).
      lastScheduleTemplatesApiPath = String(path || '').replace(/\/+$/, '');
      return normalizePaginatedList(raw);
    } catch (e: any) {
      lastErr = e;
      const st = typeof e?.status === 'number' ? e.status : e?.response?.status;
      if (st === 404) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to load schedule templates');
}

function templateRowCompanyId(row: any): string {
  const c = row?.company_id ?? row?.company;
  if (c != null && typeof c === 'object' && (c as any).id != null) return String((c as any).id).trim();
  if (c != null && c !== '') return String(c).trim();
  return '';
}

/**
 * Load schedule templates for one company. Tries several query param shapes, then GET-all + client filter.
 */
export async function getScheduleTemplatesForCompany(
  companyId: string,
  organizationId?: string | null
): Promise<any[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];

  const tryList = async (params: Record<string, any>) => {
    try {
      const rows = await getScheduleTemplates(params);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  const paramSets: Record<string, any>[] = [
    { company: cid },
    { company_id: cid },
    { company: cid, ordering: '-created_at' },
    { company: cid, ordering: '-id' },
  ];
  if (organizationId) {
    paramSets.push(
      { company: cid, organization: organizationId },
      { company: cid, organization_id: organizationId }
    );
  }

  const order: number[] = [];
  if (
    lastScheduleTemplatesCompanyParamIndex != null &&
    lastScheduleTemplatesCompanyParamIndex >= 0 &&
    lastScheduleTemplatesCompanyParamIndex < paramSets.length
  ) {
    order.push(lastScheduleTemplatesCompanyParamIndex);
  }
  for (let i = 0; i < paramSets.length; i++) {
    if (!order.includes(i)) order.push(i);
  }

  const keepCompanyRows = (rows: any[]): any[] => {
    const hasCompanyInfo = rows.some((r: any) => String(r?.company_id ?? r?.company ?? '').trim() !== '');
    const matched = rows.filter((r: any) => templateRowCompanyId(r) === cid);
    if (matched.length > 0) return matched;
    return hasCompanyInfo ? [] : rows;
  };

  for (const idx of order) {
    const p = paramSets[idx];
    const rows = await tryList(p);
    if (rows.length > 0) {
      const filtered = keepCompanyRows(rows);
      if (filtered.length > 0) {
        lastScheduleTemplatesCompanyParamIndex = idx;
        return filtered;
      }
    }
  }

  const all = await tryList({});
  if (all.length === 0) return [];
  return all.filter((r: any) => templateRowCompanyId(r) === cid);
}

export async function createScheduleTemplate(data: Record<string, any>) {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (p: string | null | undefined) => {
    const n = String(p || '').replace(/\/+$/, '');
    if (!n) return;
    const withSlash = `${n}/`;
    if (seen.has(withSlash)) return;
    seen.add(withSlash);
    paths.push(withSlash);
  };
  add(lastScheduleTemplatesCreateApiPath);
  add(lastScheduleTemplatesApiPath);
  for (const p of SCHEDULE_TEMPLATE_PATH_PREFIXES) add(p);

  let lastErr: unknown;
  for (const path of paths) {
    try {
      const created = await apiClient.post<any>(path, data);
      lastScheduleTemplatesCreateApiPath = String(path || '').replace(/\/+$/, '');
      return created;
    } catch (e: any) {
      lastErr = e;
      const st = typeof e?.status === 'number' ? e.status : e?.response?.status;
      if (st === 404) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not create schedule template');
}

function scrubWrite(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === null) continue;
    if (v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out[k] = v.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item) ? scrubWrite(item as Record<string, any>) : item
      );
      continue;
    }
    if (typeof v === 'object' && v !== null && !(v instanceof Date)) {
      const nested = scrubWrite(v as Record<string, any>);
      if (Object.keys(nested).length > 0) out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function dedupeBodies(list: Record<string, any>[]): Record<string, any>[] {
  const seen = new Set<string>();
  const out: Record<string, any>[] = [];
  for (const b of list) {
    const k = JSON.stringify(b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

/** DRF DateTimeField expects ISO 8601 strings in JSON. */
function toIsoDateTime(v: any): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return String(v);
}

/** Count nested shifts on a schedule-template row (serializer / list / detail shapes differ). */
function countShiftsOnTemplateRow(row: any): number {
  if (!row || typeof row !== 'object') return 0;
  const sc =
    row.shift_count ??
    row.shifts_count ??
    row.template_shift_count ??
    row.num_shifts ??
    row.shift_set_count;
  if (typeof sc === 'number' && Number.isFinite(sc) && sc >= 0) return sc;
  const embedded =
    row.template_shifts ??
    row.shifts ??
    row.shift_templates ??
    row.schedule_shifts ??
    row.scheduled_shifts ??
    row.lines ??
    row.items;
  if (Array.isArray(embedded)) return embedded.length;
  const raw = row.shifts_data ?? row.shift_data ?? row.data;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function hasTemplateShiftSignal(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  const countKeys = ['shift_count', 'shifts_count', 'template_shift_count', 'num_shifts', 'shift_set_count'];
  for (const k of countKeys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) return true;
  }
  const embeddedKeys = [
    'template_shifts',
    'shifts',
    'shift_templates',
    'schedule_shifts',
    'scheduled_shifts',
    'lines',
    'items',
    'shift_ids',
  ];
  for (const k of embeddedKeys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) return true;
  }
  return false;
}

async function getScheduleTemplateDetail(id: string): Promise<any | null> {
  const paths = scheduleTemplateIdPaths(id);
  for (const p of paths) {
    try {
      return await apiClient.get<any>(p);
    } catch (e: any) {
      const st = e instanceof HttpError ? e.status : e?.status;
      if (st === 404) continue;
      throw e;
    }
  }
  return null;
}

async function findScheduleTemplateRowByName(companyId: string, label: string): Promise<any | null> {
  const cid = String(companyId || '').trim();
  if (!cid) return null;
  const rows = await getScheduleTemplates({ company: cid, ordering: '-created_at' });
  const list = Array.isArray(rows) ? rows : [];
  const target = label.trim();
  return list.find((r: any) => String(r.name ?? r.title ?? '').trim() === target) ?? null;
}

/**
 * POST often returns `{}` (empty body) on 201; resolve id + nested shifts via GET list/detail.
 */
async function resolveScheduleTemplateAfterCreate(createdRaw: any, companyId: string, label: string): Promise<any> {
  const id = String(createdRaw?.id ?? createdRaw?.pk ?? createdRaw?.uuid ?? '').trim();
  if (id) {
    const detail = await getScheduleTemplateDetail(id);
    if (detail) return detail;
    return createdRaw;
  }
  const byName = await findScheduleTemplateRowByName(companyId, label);
  if (!byName) return createdRaw || {};
  const tid = String(byName.id ?? byName.pk ?? byName.uuid ?? '').trim();
  if (!tid) return byName;
  const detail = await getScheduleTemplateDetail(tid);
  return detail ?? byName;
}

async function tryPatchLinkShiftsToTemplate(
  templateId: string,
  shiftIds: string[],
  nestedMinimal: Record<string, any>[],
  templateRow?: any
): Promise<boolean> {
  if (!String(templateId || '').trim()) return false;
  const enc = encodeURIComponent(String(templateId || '').trim());
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (p: string | null | undefined) => {
    const n = String(p || '').replace(/\/+$/, '');
    if (!n || seen.has(n)) return;
    seen.add(n);
    paths.push(`${n}/`);
  };
  const rowUrl = templateRow?.url ?? templateRow?.self ?? templateRow?.detail_url;
  if (typeof rowUrl === 'string') add(normalizeScheduleTemplateDeleteEndpoint(rowUrl));
  if (lastScheduleTemplatesCreateApiPath) add(`${lastScheduleTemplatesCreateApiPath}/${enc}`);
  if (lastScheduleTemplatesApiPath) add(`${lastScheduleTemplatesApiPath}/${enc}`);
  add(`/scheduler/schedule-templates/${enc}`);
  if (paths.length === 0) return false;

  const patchBodies: Record<string, any>[] = [
    scrubWrite({ shift_ids: shiftIds }),
    scrubWrite({ template_shifts: nestedMinimal }),
    scrubWrite({ shifts: shiftIds }),
  ].filter((b) => Object.keys(b).length > 0);

  for (const path of paths) {
    for (const body of patchBodies) {
      try {
        await apiClient.patch<any>(path, body);
        const detail = await getScheduleTemplateDetail(templateId);
        if (detail && countShiftsOnTemplateRow(detail) > 0) return true;
      } catch (e: any) {
        const st = e instanceof HttpError ? e.status : e?.status;
        if (st === 404 || st === 400 || st === 405) continue;
        throw e;
      }
    }
  }
  return false;
}

/**
 * POST /scheduler/schedule-templates/ — backend serializers vary; try many DRF-friendly shapes.
 * Stops on first success; otherwise throws the last error (usually HttpError with DRF body).
 */
export async function createScheduleTemplateWithFallbacks(params: {
  companyId: string;
  organizationId?: string | null;
  rangeStart: Date;
  rangeEnd: Date;
  shifts: any[];
}): Promise<any> {
  const cid = String(params.companyId || '').trim();
  if (!cid) throw new Error('companyId is required');

  const rsIso = params.rangeStart.toISOString();
  const reIso = params.rangeEnd.toISOString();
  const rsDate = rsIso.slice(0, 10);
  const reDate = reIso.slice(0, 10);
  const oid = params.organizationId ? String(params.organizationId).trim() : '';

  const label = `Schedule ${rsDate} – ${reDate}`;

  const resolveEmployeeId = (s: any): string => {
    const emp =
      s.employee_id ??
      (typeof s.employee === 'object' && s.employee != null && (s.employee as any).id != null
        ? (s.employee as any).id
        : s.employee);
    return String(emp ?? '').trim();
  };

  // Shifts coming from the backend are not always shaped consistently (field names).
  // If we send invalid start/end, the backend often creates an empty template.
  const resolveStartIso = (s: any): string | undefined => {
    const v =
      s.start_time ??
      s.start ??
      s.startAt ??
      s.start_at ??
      s.time_in ??
      s.start_datetime ??
      s.startDate ??
      s.datetime_start;
    return toIsoDateTime(v);
  };

  const resolveEndIso = (s: any): string | undefined => {
    const v =
      s.end_time ??
      s.end ??
      s.endAt ??
      s.end_at ??
      s.time_out ??
      s.end_datetime ??
      s.endDate ??
      s.datetime_end;
    const direct = toIsoDateTime(v);
    if (direct) return direct;
    const st = resolveStartIso(s);
    if (!st) return undefined;
    const d = new Date(st);
    if (Number.isNaN(d.getTime())) return undefined;
    d.setTime(d.getTime() + 8 * 60 * 60 * 1000);
    return d.toISOString();
  };

  const shiftsIn = params.shifts.filter((s) => {
    const eid = resolveEmployeeId(s);
    const st = resolveStartIso(s);
    const et = resolveEndIso(s);
    return eid.length > 0 && !!st && !!et;
  });
  if (shiftsIn.length === 0) {
    throw new Error('No shifts with a valid employee id and start/end times');
  }

  /** Existing Shift rows from the week — backend often links templates via PK list, not nested JSON. */
  const shiftIdsFromApi = shiftsIn
    .map((s: any) => String(s.id ?? s.pk ?? s.uuid ?? '').trim())
    .filter((x: string) => x.length > 0);

  const shiftRowsFull = shiftsIn.map((s) => {
    const eid = resolveEmployeeId(s);
    const st = resolveStartIso(s);
    const et = resolveEndIso(s);
    return scrubWrite({
      employee: eid,
      employee_id: eid,
      start_time: st,
      end_time: et,
      break_duration_minutes: Number(s.break_duration_minutes ?? s.break_minutes ?? 0) || 0,
      break_duration: Number(s.break_duration_minutes ?? s.break_minutes ?? 0) || 0,
      notes: s.notes,
      shift_type: s.shift_type,
      hourly_rate: s.hourly_rate,
      status: s.status,
    });
  });

  const shiftRowsMinimal = shiftsIn.map((s) => {
    const eid = resolveEmployeeId(s);
    const st = resolveStartIso(s);
    const et = resolveEndIso(s);
    return scrubWrite({
      employee: eid,
      start_time: st,
      end_time: et,
    });
  });

  
  const primaryBody = scrubWrite({
    company: cid,
    name: label,
    week_start: rsDate,
    week_end: reDate,
    ...(oid ? { organization: oid } : {}),
    ...(shiftIdsFromApi.length > 0 ? { shift_ids: shiftIdsFromApi } : {}),
    template_shifts: shiftRowsMinimal,
  });

  const fallbackBody = scrubWrite({
    company: cid,
    name: label,
    week_start: rsDate,
    week_end: reDate,
    ...(oid ? { organization: oid } : {}),
    shifts: shiftRowsFull,
  });

  const idsBody = scrubWrite({
    company: cid,
    name: label,
    week_start: rsDate,
    week_end: reDate,
    ...(oid ? { organization: oid } : {}),
    ...(shiftIdsFromApi.length > 0 ? { shifts: shiftIdsFromApi } : {}),
  });

  const primaryCompanyIdBody = scrubWrite({
    company_id: cid,
    name: label,
    week_start: rsDate,
    week_end: reDate,
    ...(oid ? { organization_id: oid } : {}),
    ...(shiftIdsFromApi.length > 0 ? { shift_ids: shiftIdsFromApi } : {}),
    template_shifts: shiftRowsMinimal,
  });

  const tryBodies = dedupeBodies(
    [primaryBody, primaryCompanyIdBody, idsBody, fallbackBody].filter((b) => Object.keys(b).length > 0)
  );

  let lastErr: unknown;

  const cleanupEmptyTemplate = async (row: any) => {
    const tid = String(row?.id ?? row?.pk ?? row?.uuid ?? '').trim();
    const url = row?.url ?? row?.self ?? row?.delete_url;
    if (!tid) return;
    try {
      await deleteScheduleTemplate(tid, cid, typeof url === 'string' ? url : undefined);
    } catch {
      /* ignore */
    }
  };

  const getScheduleTemplateRowFromList = async (templateId: string): Promise<any | null> => {
    const tid = String(templateId || '').trim();
    if (!tid) return null;
    try {
      const rows = await getScheduleTemplatesForCompany(cid, oid || null);
      return rows.find((r: any) => String(r?.id ?? r?.pk ?? r?.uuid ?? '').trim() === tid) ?? null;
    } catch {
      return null;
    }
  };

  const finalizeTemplate = async (createdRaw: any): Promise<any> => {
    let resolved = await resolveScheduleTemplateAfterCreate(createdRaw, cid, label);
    let count = countShiftsOnTemplateRow(resolved);
    let hasSignal = hasTemplateShiftSignal(resolved);
    const tid = String(resolved?.id ?? resolved?.pk ?? resolved?.uuid ?? '').trim();

    if (count === 0 && tid) {
      const listRow = await getScheduleTemplateRowFromList(tid);
      if (listRow) {
        resolved = listRow;
        count = countShiftsOnTemplateRow(listRow);
        hasSignal = hasTemplateShiftSignal(listRow);
      }
    }

    // If count is still zero, attempt one constrained link pass.
    // This runs even when list/detail serializers are sparse (no shift-count fields).
    if (count === 0 && shiftsIn.length > 0 && tid && shiftIdsFromApi.length > 0) {
      const patched = await tryPatchLinkShiftsToTemplate(tid, shiftIdsFromApi, shiftRowsMinimal, resolved);
      if (patched) {
        resolved = (await getScheduleTemplateDetail(tid)) ?? resolved;
        count = countShiftsOnTemplateRow(resolved);
        hasSignal = hasTemplateShiftSignal(resolved);
      } else if (!hasSignal) {
        const listRow = await getScheduleTemplateRowFromList(tid);
        if (listRow) {
          resolved = listRow;
          count = countShiftsOnTemplateRow(listRow);
          hasSignal = hasTemplateShiftSignal(listRow);
        }
      }
    }

    if (hasSignal && count === 0 && shiftsIn.length > 0) {
      await cleanupEmptyTemplate(resolved);
      throw new Error('Template created but contained zero shifts');
    }

    return resolved;
  };

  for (let i = 0; i < tryBodies.length; i++) {
    const body = tryBodies[i];
    if (Object.keys(body).length === 0) continue;
    try {
      const createdRaw = await createScheduleTemplate(body);
      return await finalizeTemplate(createdRaw);
    } catch (e: unknown) {
      lastErr = e;
      const st = e instanceof HttpError ? e.status : (e as any)?.status;
      if (st === 401 || st === 403) throw e;
      if (st === 400 && i < tryBodies.length - 1) continue;
      throw e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Could not create schedule template');
}

export async function updateScheduleTemplate(id: string, data: Record<string, any>) {
  const paths = scheduleTemplateIdPaths(id);
  let lastErr: unknown;
  for (const path of paths) {
    try {
      return await apiClient.patch<any>(path, data);
    } catch (e: any) {
      lastErr = e;
      const st = e instanceof HttpError ? e.status : e?.status;
      if (st === 404) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not update schedule template');
}

function normalizeScheduleTemplateDeleteEndpoint(pathOrUrl: string): string | null {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const u = new URL(raw);
      // apiClient already includes `/api` in baseURL, so remove leading `/api`.
      const p = u.pathname.replace(/^\/api\/?/, '/');
      return p.startsWith('/') ? p : `/${p}`;
    }
  } catch {
    // fall through to best-effort normalization
  }

 
  const stripped = raw.replace(/^\/api\/?/, '/');
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}


function scheduleTemplateDeleteUrls(id: string, deleteEndpoint?: string | null): string[] {
  const raw = String(id || '').trim();
  if (!raw) return [];
  const enc = encodeURIComponent(raw);
  const out: string[] = [];
  const add = (path: string) => {
    const n = path.replace(/\/+$/, '') + '/';
    if (!out.includes(n)) out.push(n);
  };

  const fromHyperlink = deleteEndpoint ? normalizeScheduleTemplateDeleteEndpoint(deleteEndpoint) : null;
  if (fromHyperlink) {
    add(fromHyperlink);
  }

  const preferredBase =
    lastScheduleTemplatesCreateApiPath?.replace(/\/+$/, '') ||
    lastScheduleTemplatesApiPath?.replace(/\/+$/, '');
  if (preferredBase) {
    add(`${preferredBase}/${enc}`);
  }
  add(`/scheduler/schedule-templates/${enc}`);

  return out;
}

/**
 * DELETE one schedule template. Tries at most three URLs to prevent repeated Not Found spam.
 * `companyId` is accepted for call-site compatibility; flat routers do not use it in the path.
 */
export async function deleteScheduleTemplate(
  id: string,
  _companyId?: string | null,
  deleteEndpoint?: string
) {
  const raw = String(id || '').trim();
  if (!raw) throw new Error('Template id is required');

  const urls = scheduleTemplateDeleteUrls(raw, deleteEndpoint);
  let lastErr: unknown;
  let lastTried: string | null = null;

  for (const url of urls) {
    try {
      lastTried = url;
      return await apiClient.delete(url);
    } catch (e: unknown) {
      lastErr = e;
      const st = e instanceof HttpError ? e.status : (e as any)?.status;
      if (st === 401 || st === 403) throw e;
      if (st !== 404 && st !== 405) throw e;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : 'Could not delete schedule template';
  throw new Error(`${msg}${lastTried ? ` (tried ${urls.length} URL(s), last: ${lastTried})` : ''}`);
}

// —— Templates (check lists / learning) ——
export async function getTemplates(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/templates/', params);
  return normalizePaginatedList(raw);
}
function stripWriteFields(o: Record<string, any>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
}

export async function createTemplate(data: Record<string, any>) {
  const name = String(data.name ?? data.title ?? '').trim();
  if (!name) throw new Error('Template name is required');
  const desc = data.description != null ? String(data.description).trim() : '';
  const cat = data.category != null ? String(data.category).trim() : data.technology != null ? String(data.technology).trim() : '';

  const variants = [
    stripWriteFields({ name, description: desc || undefined, category: cat || undefined }),
    stripWriteFields({ title: name, description: desc || undefined, category: cat || undefined }),
    stripWriteFields({ name, description: desc || undefined, technology: cat || undefined }),
    stripWriteFields({ name, description: desc || undefined }),
    stripWriteFields({ title: name, description: desc || undefined }),
  ];
  let last: unknown;
  for (const body of variants) {
    try {
      return await apiClient.post<any>('/templates/', body);
    } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status === 400) continue;
      throw e;
    }
  }
  throw last;
}

export async function updateTemplate(id: string, data: Record<string, any>) {
  const enc = encodeURIComponent(id);
  const name = data.name != null ? String(data.name).trim() : data.title != null ? String(data.title).trim() : '';
  const desc = data.description != null ? String(data.description).trim() : undefined;
  const cat =
    data.category != null
      ? String(data.category).trim()
      : data.technology != null
        ? String(data.technology).trim()
        : undefined;

  const patches = [
    stripWriteFields({ name: name || undefined, title: name || undefined, description: desc, category: cat }),
    stripWriteFields({ name: name || undefined, description: desc, technology: cat }),
    stripWriteFields({ ...data }),
  ];
  const paths = [`/templates/${id}/`, `/templates/${enc}/`];
  let last: unknown;
  for (const path of paths) {
    for (const body of patches) {
      if (Object.keys(body).length === 0) continue;
      try {
        return await apiClient.patch<any>(path, body);
      } catch (e) {
        last = e;
        if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;
        throw e;
      }
    }
  }
  throw last;
}

export async function deleteTemplate(id: string) {
  return apiClient.delete(`/templates/${id}/`);
}

export async function getTemplateAssignments(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/templates/assignments/', params);
  return normalizePaginatedList(raw);
}

export async function assignTemplate(templateId: string, userId: string) {
  const enc = encodeURIComponent(templateId);
  const tries = [
    () => apiClient.post<any>('/templates/assignments/', { template_id: templateId, user_id: userId }),
    () => apiClient.post<any>('/templates/assignments/', { template: templateId, user: userId }),
    () => apiClient.post<any>(`/templates/${templateId}/assign/`, { user_id: userId }),
    () => apiClient.post<any>(`/templates/${enc}/assign/`, { user: userId }),
  ];
  let last: unknown;
  for (const run of tries) {
    try {
      return await run();
    } catch (e) {
      last = e;
      if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;
      throw e;
    }
  }
  throw last;
}

/** Template checklist tasks (best-effort paths for different backends). */
export async function getTemplateTasks(templateId: string): Promise<any[]> {
  const enc = encodeURIComponent(templateId);
  const runs = [
    () => apiClient.get<any>(`/templates/${templateId}/tasks/`),
    () => apiClient.get<any>(`/templates/${enc}/tasks/`),
    () => apiClient.get<any>('/templates/tasks/', { template: templateId }),
    () => apiClient.get<any>('/templates/tasks/', { template_id: templateId }),
  ];
  for (const run of runs) {
    try {
      const raw = await run();
      return normalizePaginatedList(raw);
    } catch {
      /* try next */
    }
  }
  return [];
}

export async function createTemplateTask(templateId: string, data: Record<string, any>) {
  const enc = encodeURIComponent(templateId);
  const title = String(data.title ?? data.name ?? '').trim();
  if (!title) throw new Error('Task title is required');

  const due = data.due_date || data.due_at || data.deadline;
  const cores = [
    stripWriteFields({ title, description: data.description, priority: data.priority, due_date: due }),
    stripWriteFields({ name: title, description: data.description, priority: data.priority, due_date: due }),
    stripWriteFields({ title, description: data.description, priority: data.priority, due_at: due }),
    stripWriteFields({ title, description: data.description, priority: data.priority, deadline: due }),
  ];

  const posts: Array<() => Promise<any>> = [];
  for (const c of cores) {
    posts.push(() => apiClient.post<any>(`/templates/${templateId}/tasks/`, { ...c, template_id: templateId }));
    posts.push(() => apiClient.post<any>(`/templates/${templateId}/tasks/`, c));
    posts.push(() => apiClient.post<any>(`/templates/${enc}/tasks/`, c));
    posts.push(() => apiClient.post<any>('/templates/tasks/', { ...c, template: templateId }));
    posts.push(() => apiClient.post<any>('/templates/tasks/', { ...c, template_id: templateId }));
  }

  let last: unknown;
  for (const run of posts) {
    try {
      return await run();
    } catch (e) {
      last = e;
      if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;
      throw e;
    }
  }
  throw last;
}
export async function unassignTemplate(templateId: string, userId: string) {
  return apiClient.delete('/templates/assignments/', { template_id: templateId, user_id: userId });
}

// —— Focus ——
export async function getFocusSessions(params?: Record<string, any>) {
  const merged = { ...(params || {}) };
  const withPage = { page_size: 100, ...merged };
  let last: unknown;
  for (const q of [withPage, merged]) {
    try {
      const raw = await apiClient.get<any>('/focus/sessions/', q);
      return normalizePaginatedList(raw);
    } catch (e) {
      last = e;
      if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;
      throw e;
    }
  }
  if (last) throw last;
  return [];
}

/** Single focus session (refresh active session / recover when list is stale). */
export async function getFocusSession(id: string) {
  const enc = encodeURIComponent(String(id));
  return apiClient.get<any>(`/focus/sessions/${id}/`);
}

export async function createFocusSession(data: any) {
  return apiClient.post<any>('/focus/sessions/', data);
}
export async function updateFocusSession(id: string, data: any) {
  return apiClient.patch<any>(`/focus/sessions/${id}/`, data);
}
export async function deleteFocusSession(id: string) {
  return apiClient.delete(`/focus/sessions/${id}/`);
}

// —— Habits (Daily Routines) ——
/** List habits; optional query e.g. `{ user }` — scope may depend on role/JWT. */
export async function getHabits(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/habits/habits/', params);
  return normalizePaginatedList(raw);
}
/**
 * Create habit — matches Zenotimeflow-backend `HabitSerializer` (name, icon, notes, user from JWT).
 */
export async function createHabit(data: Record<string, any>) {
  const name = String(data.name ?? data.title ?? '').trim();
  if (!name) throw new Error('Habit name is required');

  const freq = data.frequency ?? data.recurrence ?? 'daily';
  const iconRaw = data.icon ?? data.category;
  const icon = iconRaw != null && String(iconRaw).trim() ? String(iconRaw).trim() : undefined;

  const body: Record<string, any> = {
    name,
    frequency: freq,
    target_count: data.target_count ?? 1,
    start_date: data.start_date,
  };
  if (data.description) body.description = data.description;
  if (data.end_date) body.end_date = data.end_date;
  if (data.color) body.color = data.color;
  if (data.notes) body.notes = data.notes;
  if (icon) body.icon = icon;

  return apiClient.post<any>('/habits/habits/', body);
}
export async function updateHabit(id: string, data: any) {
  return apiClient.patch<any>(`/habits/habits/${id}/`, data);
}
export async function deleteHabit(id: string) {
  return apiClient.delete(`/habits/habits/${id}/`);
}
export async function getHabitCompletions(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/habits/completions/', params);
  return normalizePaginatedList(raw);
}
export async function getHabitCompletionSchema() {
  return apiClient.options<any>('/habits/completions/');
}
export async function createHabitCompletion(data: any) {
  return apiClient.post<any>('/habits/completions/', data);
}
export async function updateHabitCompletion(id: string, data: any) {
  return apiClient.patch<any>(`/habits/completions/${id}/`, data);
}
export async function deleteHabitCompletion(id: string) {
  return apiClient.delete(`/habits/completions/${id}/`);
}
