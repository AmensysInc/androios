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
      raw.organizations ??
      raw.companies ??
      raw.items ??
      (Array.isArray(raw.data) ? raw.data : undefined);
    if (Array.isArray(list)) return list.map((x) => attachId(x));
    if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
      const inner = raw.data.results ?? raw.data.items ?? raw.data.organizations;
      if (Array.isArray(inner)) return inner.map((x) => attachId(x));
    }
  }
  return [attachId(raw as T)];
}

/** Row shapes for scheduler list endpoints (matches screen `Organization` / `Company` / `Employee` types). */
export type SchedulerOrganization = { id: string; name: string; [k: string]: any };
export type SchedulerCompany = { id: string; name: string; [k: string]: any };
export type SchedulerEmployee = { id: string; [k: string]: any };

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
    { status: completed ? 'completed' : 'pending' },
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
  return normalizePaginatedList<SchedulerCompany>(raw);
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
export async function getScheduleTemplates(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/schedule-templates/', params);
  return normalizePaginatedList(raw);
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
  const raw = await apiClient.get<any>('/focus/sessions/', params);
  return normalizePaginatedList(raw);
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
/** Display labels for category slugs (match HabitsScreen `CATEGORY_OPTIONS`). */
const HABIT_CATEGORY_DISPLAY: Record<string, string> = {
  health_fitness: 'Health & Fitness',
  personal_growth: 'Personal Growth',
  work: 'Work',
  social: 'Social',
  other: 'Other',
};

/** List habits; optional query e.g. `{ user }` — scope may depend on role/JWT. */
export async function getHabits(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/habits/habits/', params);
  return normalizePaginatedList(raw);
}
/**
 * Create habit. Sends `/habits/habits/` with fallbacks on 400: category slug vs label, `name` vs `title`,
 * `frequency` vs `recurrence`, with/without `user` (many backends set owner from JWT).
 */
export async function createHabit(data: Record<string, any>) {
  const name = String(data.name ?? data.title ?? '').trim();
  if (!name) throw new Error('Habit name is required');

  const catRaw = data.category;
  const catSlug = typeof catRaw === 'string' ? catRaw : String(catRaw ?? '');
  const catTitle =
    HABIT_CATEGORY_DISPLAY[catSlug] ??
    (catSlug && catSlug.includes('_')
      ? catSlug
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ')
      : catSlug);

  const freq = data.frequency ?? data.recurrence;
  const stripUndefined = (o: Record<string, any>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

  const cores: Record<string, any>[] = [
    { name, category: catSlug, frequency: freq },
    { name, category: catTitle, frequency: freq },
    { title: name, category: catSlug, frequency: freq },
    { title: name, category: catTitle, frequency: freq },
    { name, category: catSlug, recurrence: freq },
    { name, category: catTitle, recurrence: freq },
    { title: name, category: catSlug, recurrence: freq },
  ];

  const extras: Record<string, any> = {};
  if (data.description) extras.description = data.description;
  if (data.start_date) extras.start_date = data.start_date;
  if (data.end_date) extras.end_date = data.end_date;
  if (data.notes) extras.notes = data.notes;
  if (data.color) extras.color = data.color;

  const uid = data.user != null ? String(data.user) : '';
  const bodies: Record<string, any>[] = [];
  for (const c of cores) {
    const base = stripUndefined({ ...extras, ...c });
    bodies.push(base);
    if (uid) bodies.push(stripUndefined({ ...base, user: uid }));
  }

  let last: unknown;
  for (const body of bodies) {
    try {
      return await apiClient.post<any>('/habits/habits/', body);
    } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status === 400) continue;
      throw e;
    }
  }
  throw last;
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
export async function createHabitCompletion(data: any) {
  return apiClient.post<any>('/habits/completions/', data);
}
export async function updateHabitCompletion(id: string, data: any) {
  return apiClient.patch<any>(`/habits/completions/${id}/`, data);
}
export async function deleteHabitCompletion(id: string) {
  return apiClient.delete(`/habits/completions/${id}/`);
}
