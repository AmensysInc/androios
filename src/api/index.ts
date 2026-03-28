import apiClient, { HttpError } from '../lib/api-client';

const DEFAULT_COMPANY_TYPE = 'General';

/** Dev-only traces for shift POST debugging (Metro / Xcode / Logcat). */
const SCHEDULER_SHIFT_DEBUG = typeof __DEV__ !== 'undefined' && __DEV__;

function logSchedulerShift(phase: string, data: Record<string, unknown>) {
  if (!SCHEDULER_SHIFT_DEBUG) return;
  try {
    const s = JSON.stringify(data);
    console.log(`[scheduler/shift] ${phase}`, s.length > 2800 ? `${s.slice(0, 2800)}…` : s);
  } catch {
    console.log(`[scheduler/shift] ${phase}`, data);
  }
}

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

/** Largest user list for admin pickers (company/org manager). Tries common DRF pagination params. */
export async function getAuthUsersForAdminPicker(): Promise<any[]> {
  const attempts: Record<string, any>[] = [
    { page_size: 1000 },
    { page_size: 500 },
    { limit: 1000 },
    { limit: 500 },
    {},
  ];
  let best: any[] = [];
  for (const params of attempts) {
    try {
      const rows = await getUsers(params);
      if (Array.isArray(rows) && rows.length > best.length) best = rows;
    } catch {
      /* next */
    }
  }
  return best;
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

const READ_ONLY_USER_KEYS = new Set([
  'id',
  'pk',
  'uuid',
  'last_login',
  'date_joined',
  'created_at',
  'is_superuser',
  'is_staff',
  'is_active',
  'permissions',
  'groups',
  'roles',
  'user_permissions',
]);

/** Merge GET /auth/users/:id/ with admin PATCH fields for PUT fallback serializers. */
function mergeAuthUserWritePayload(current: Record<string, any> | null | undefined, patch: Record<string, any>): Record<string, any> {
  const cur = current && typeof current === 'object' ? current : {};
  const prof =
    typeof cur.profile === 'object' && cur.profile
      ? { ...cur.profile }
      : typeof cur.user_profile === 'object' && cur.user_profile
        ? { ...cur.user_profile }
        : {};
  const out: Record<string, any> = {
    username: patch.username ?? cur.username,
    email: patch.email ?? cur.email,
    first_name: patch.first_name ?? cur.first_name,
    last_name: patch.last_name ?? cur.last_name,
    full_name: patch.full_name ?? cur.full_name ?? prof.full_name,
    phone: patch.phone ?? cur.phone ?? prof.phone,
    employee_pin: patch.employee_pin ?? prof.employee_pin ?? prof.pin,
    hourly_rate: patch.hourly_rate ?? prof.hourly_rate,
    organization_id: patch.organization_id ?? cur.organization_id ?? prof.organization_id,
    organization: patch.organization ?? patch.organization_id ?? cur.organization ?? cur.organization_id,
    company_id: patch.company_id ?? cur.company_id ?? prof.company_id,
    company: patch.company ?? patch.company_id ?? cur.company ?? cur.company_id,
    assigned_company: patch.assigned_company ?? patch.company_id ?? cur.assigned_company,
  };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (READ_ONLY_USER_KEYS.has(k)) continue;
    out[k] = v;
  }
  if (patch.profile && typeof patch.profile === 'object') {
    out.profile = { ...prof, ...patch.profile };
  } else if (Object.keys(prof).length) {
    out.profile = prof;
  }
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(out)) {
    if (READ_ONLY_USER_KEYS.has(k)) continue;
    if (v === undefined) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

/**
 * PATCH user; on failure GET + PUT merged body so strict / partial-update backends still persist.
 */
export async function updateUserWithFallbacks(id: string, data: Record<string, any>): Promise<any> {
  const uid = String(id || '').trim();
  if (!uid) throw new Error('User id is required');
  let lastErr: unknown = null;
  try {
    return await updateUser(uid, data);
  } catch (e) {
    lastErr = e;
  }
  try {
    const current = await getUser(uid);
    const body = mergeAuthUserWritePayload(current, data);
    return await apiClient.put<any>(`/auth/users/${encodeURIComponent(uid)}/`, body);
  } catch (e2) {
    lastErr = e2;
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to update user on server');
}

/** Push organization / company FKs on the auth user (common for RBAC + profile scoping). */
export async function syncAuthUserOrgCompany(userId: string, organizationId: string, companyId: string): Promise<boolean> {
  const uid = String(userId || '').trim();
  const oid = String(organizationId || '').trim();
  const cid = String(companyId || '').trim();
  if (!uid) return false;
  const tries: Record<string, any>[] = [];
  if (oid && cid) {
    tries.push(
      { organization_id: oid, company_id: cid, assigned_company: cid },
      { organization: oid, company: cid, company_id: cid },
      { organization_id: oid, company_id: cid }
    );
  } else if (oid) {
    tries.push({ organization_id: oid }, { organization: oid });
  } else if (cid) {
    tries.push({ company_id: cid, assigned_company: cid }, { company: cid });
  }
  for (const body of tries) {
    try {
      await updateUserWithFallbacks(uid, body);
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/**
 * PATCH scheduler employee; retries slimmer bodies when the server rejects unknown fields.
 */
export async function updateSchedulerEmployeeWithFallbacks(
  employeeId: string,
  bodies: Record<string, any>[]
): Promise<any> {
  const eid = String(employeeId || '').trim();
  if (!eid) throw new Error('Employee id is required');
  const strip = (o: Record<string, any>) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      if (v === null && k !== 'department' && k !== 'team') continue;
      if (v === '' && !['department', 'team'].includes(k)) continue;
      out[k] = v;
    }
    return out;
  };
  let lastErr: unknown = null;
  for (const raw of bodies) {
    const b = strip(raw);
    if (Object.keys(b).length === 0) continue;
    try {
      return await updateEmployee(eid, b);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to update employee on server');
}

/**
 * Save job title on a user after core PATCH — tries flat fields, nested profile shapes, and common
 * sub-URLs (dj-rest-auth / custom). Returns whether at least one request succeeded.
 */
export async function updateAuthUserJobTitleWithFallbacks(userId: string, jobTitle: string): Promise<boolean> {
  const uid = String(userId || '').trim();
  const jt = String(jobTitle || '').trim();
  if (!uid || !jt) return false;

  let current: any = null;
  try {
    current = await getUser(uid);
  } catch {
    current = null;
  }
  if (current && typeof current === 'object') {
    const prevProf = {
      ...(typeof current.profile === 'object' && current.profile ? current.profile : {}),
      ...(typeof current.user_profile === 'object' && current.user_profile ? current.user_profile : {}),
    };
    const merged = { ...prevProf, job_title: jt, title: jt };
    const mergedAttempts: Record<string, any>[] = [
      { profile: merged },
      { user_profile: merged },
      { profile: { job_title: jt, title: jt } },
    ];
    for (const body of mergedAttempts) {
      try {
        await updateUserWithFallbacks(uid, body);
        return true;
      } catch {
        /* next */
      }
    }
    try {
      await apiClient.put<any>(`/auth/users/${encodeURIComponent(uid)}/`, {
        username: current.username,
        email: current.email,
        first_name: current.first_name,
        last_name: current.last_name,
        full_name: current.full_name,
        profile: merged,
      });
      return true;
    } catch {
      /* next */
    }
  }

  const userBodies: Record<string, any>[] = [
    { job_title: jt },
    { title: jt },
    { job_title: jt, title: jt },
    { profile: { job_title: jt } },
    { profile: { title: jt } },
    { user_profile: { job_title: jt, title: jt } },
    { employee_profile: { job_title: jt } },
    { extra: { job_title: jt } },
  ];

  for (const body of userBodies) {
    try {
      await updateUserWithFallbacks(uid, body);
      return true;
    } catch {
      /* try next shape */
    }
  }

  const profilePayload = { job_title: jt, title: jt };
  const paths = [
    `/auth/users/${encodeURIComponent(uid)}/profile/`,
    `/auth/users/${encodeURIComponent(uid)}/profile`,
  ];
  for (const path of paths) {
    try {
      await apiClient.patch<any>(path, profilePayload);
      return true;
    } catch {
      /* next */
    }
  }

  return false;
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

/** Single org — use for Organization Manager instead of list filters that may 400 (e.g. unknown query keys). */
export async function getOrganization(id: string) {
  const enc = encodeURIComponent(String(id || '').trim());
  return apiClient.get<any>(`/scheduler/organizations/${enc}/`);
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
export async function resolveEmployeeForUser(
  user?: {
    id?: string | null;
    email?: string | null;
    company_id?: string | null;
    assigned_company?: string | null;
  } | null
) {
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

  // Prefer Django-style FK filters. Do not send `user=…` here — common DRF setups reject it with 400.
  if (userId) {
    const paramAttempts: Record<string, any>[] = [
      { user_id: userId },
      { user__id: userId },
      { owner: userId },
    ];
    for (const p of paramAttempts) {
      const rows = await tryFetch(p);
      if (rows.length > 0) return rows[0];
    }
  }

  const all = await tryFetch();
  if (all.length === 0) return null;

  const rowUserId = (e: any): string =>
    String(e?.user_id ?? (typeof e?.user === 'object' && e?.user != null ? (e.user as any).id : e?.user) ?? '').trim();

  const rowEmail = (e: any): string => {
    const linked = e?.user;
    const linkedEmail =
      (typeof linked === 'object' && linked ? (linked as any).email : null) ??
      e?.email ??
      e?.user_email ??
      '';
    return String(linkedEmail).trim().toLowerCase();
  };

  const hintCo = String(user?.company_id ?? user?.assigned_company ?? '').trim();

  const byUser = all.find((e: any) => rowUserId(e) === userId);
  if (byUser) return byUser;

  if (userEmail) {
    const byEmail = all.find((e: any) => rowEmail(e) === userEmail);
    if (byEmail) return byEmail;
  }

  if (hintCo) {
    const pool = all.filter((e: any) => String(e?.company_id ?? e?.company ?? '').trim() === hintCo);
    const u = pool.find((e: any) => rowUserId(e) === userId);
    if (u) return u;
    if (userEmail) {
      const em = pool.find((e: any) => rowEmail(e) === userEmail);
      if (em) return em;
    }
  }

  return null;
}

/**
 * Find scheduler employee for an auth user — same as resolveEmployeeForUser, then scans
 * `getEmployees()` when list filters return nothing (common RBAC / query-param mismatch).
 */
export async function findSchedulerEmployeeForAuthUser(user?: {
  id?: string | null;
  email?: string | null;
  company_id?: string | null;
  assigned_company?: string | null;
} | null): Promise<any | null> {
  const direct = await resolveEmployeeForUser(user);
  if (direct) return direct;
  const userId = user?.id != null ? String(user.id).trim() : '';
  const userEmail = user?.email != null ? String(user.email).trim().toLowerCase() : '';
  let all: any[] = [];
  try {
    all = await getEmployees();
  } catch {
    return null;
  }
  if (!Array.isArray(all) || all.length === 0) return null;
  const rowUserId = (e: any): string =>
    String(e?.user_id ?? (typeof e?.user === 'object' && e?.user != null ? (e.user as any).id : e?.user) ?? '').trim();
  const rowEmail = (e: any): string =>
    String(
      (typeof e?.user === 'object' && e?.user && (e.user as any).email ? (e.user as any).email : null) ??
        e?.email ??
        e?.user_email ??
        ''
    )
      .trim()
      .toLowerCase();
  if (userId) {
    const m = all.find((e) => rowUserId(e) === userId);
    if (m) return m;
  }
  if (userEmail) {
    const m = all.find((e) => rowEmail(e) === userEmail);
    if (m) return m;
  }
  return null;
}

/** Resolve `employee` / nested employee id on a shift row for filtering. */
function shiftRowEmployeeId(s: any): string {
  const v =
    s?.employee_id ??
    (typeof s?.employee === 'object' && s?.employee != null ? (s.employee as any).id : s?.employee);
  return String(v ?? '').trim();
}

/**
 * Load shifts for one employee in [rangeStart, rangeEnd]. Tries several query shapes, then
 * company-wide fetch + client filter (matches getShiftsForCompanyInRange behavior).
 */
export async function getShiftsForEmployeeInRange(params: {
  employeeId: string;
  rangeStart: Date;
  rangeEnd: Date;
  companyId?: string | null;
}): Promise<any[]> {
  const eid = String(params.employeeId || '').trim();
  if (!eid) return [];

  const rangeLo = params.rangeStart.getTime();
  const rangeHi = params.rangeEnd.getTime();
  const eidNorm = eid.toLowerCase();

  const employeeMatches = (s: any): boolean => shiftRowEmployeeId(s).toLowerCase() === eidNorm;

  const inRange = (s: any): boolean => {
    const stRaw = s?.start_time ?? s?.start ?? s?.start_at ?? s?.time_in ?? s?.start_datetime;
    const st = stRaw ? new Date(stRaw) : null;
    if (!st || Number.isNaN(st.getTime())) return false;
    const t = st.getTime();
    return t >= rangeLo - 60_000 && t <= rangeHi + 60_000;
  };

  const tryQ = async (q: Record<string, any>) => {
    try {
      const rows = await getShifts(q);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  const rs = params.rangeStart.toISOString();
  const re = params.rangeEnd.toISOString();
  const rsDate = rs.slice(0, 10);
  const reDate = re.slice(0, 10);
  const cid = String(params.companyId || '').trim();

  const queries: Record<string, any>[] = [];
  if (cid) {
    queries.push(
      { company: cid, employee: eid, start_time__gte: rs, start_time__lte: re },
      { company_id: cid, employee_id: eid, start_time__gte: rs, start_time__lte: re },
      { company: cid, employee_id: eid, start_time__gte: rs, start_time__lte: re },
      { company: cid, employee: eid, start_date: rs, end_date: re },
      { company: cid, employee: eid, start_date: rsDate, end_date: reDate },
      { company: cid, employee: eid }
    );
  }
  queries.push(
    { employee: eid, start_time__gte: rs, start_time__lte: re },
    { employee_id: eid, start_time__gte: rs, start_time__lte: re },
    { employee: eid, start_date: rs, end_date: re },
    { employee: eid }
  );

  for (const q of queries) {
    const rows = await tryQ(q);
    const filtered = rows.filter((s) => employeeMatches(s) && inRange(s));
    if (filtered.length > 0) return filtered;
  }

  if (cid) {
    const broad = await getShiftsForCompanyInRange({
      companyId: cid,
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
    });
    const filtered = broad.filter(employeeMatches);
    if (filtered.length > 0) return filtered;
  }

  const timeOnly = await tryQ({ start_time__gte: rs, start_time__lte: re });
  const ft = timeOnly.filter((s) => employeeMatches(s) && inRange(s));
  if (ft.length > 0) return ft;

  return [];
}
export async function getEmployee(id: string) {
  return apiClient.get<any>(`/scheduler/employees/${id}/`);
}
export async function createEmployee(data: any) {
  return apiClient.post<any>('/scheduler/employees/', data);
}

/**
 * Link an auth user to a company as a scheduler employee. Tries common DRF FK field names.
 */
export async function createEmployeeLinkedToUser(input: {
  companyId: string;
  userId: string;
  first_name: string;
  last_name: string;
  email?: string;
  job_title?: string;
  status?: string;
}): Promise<any> {
  const cid = String(input.companyId || '').trim();
  const uid = String(input.userId || '').trim();
  if (!cid || !uid) throw new Error('companyId and userId are required');
  const strip = (o: Record<string, any>) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }
    return out;
  };
  const core = strip({
    first_name: input.first_name,
    last_name: input.last_name,
    email: input.email,
    job_title: input.job_title,
    position: input.job_title,
    status: input.status || 'active',
  });
  const uidNum = /^\d+$/.test(uid) ? parseInt(uid, 10) : NaN;
  const bodies: Record<string, any>[] = [
    { ...core, company: cid, user: uid },
    { ...core, company_id: cid, user_id: uid },
    { ...core, company: cid, user_id: uid },
    { ...core, company_id: cid, user: uid },
    { ...core, company: cid, auth_user: uid },
    { ...core, company_id: cid, auth_user_id: uid },
    { ...core, company: cid, account: uid },
  ];
  if (!Number.isNaN(uidNum)) {
    bodies.push(
      { ...core, company: cid, user: uidNum },
      { ...core, company_id: cid, user_id: uidNum }
    );
  }
  let lastErr: unknown = null;
  for (const body of bodies) {
    if (Object.keys(body).length < 3) continue;
    try {
      return await createEmployee(body);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not create employee for user');
}

/** Create scheduler employee for user, or update existing row (e.g. duplicate / already linked). */
export async function assignSchedulerEmployeeToCompany(input: {
  companyId: string;
  userId: string;
  first_name: string;
  last_name: string;
  email?: string;
  job_title?: string;
  status?: string;
}): Promise<any> {
  try {
    return await createEmployeeLinkedToUser(input);
  } catch (firstErr) {
    const resolved = await findSchedulerEmployeeForAuthUser({
      id: input.userId,
      email: input.email,
      company_id: input.companyId,
      assigned_company: input.companyId,
    });
    if (!resolved?.id) {
      throw firstErr instanceof Error ? firstErr : new Error('Could not assign user to company');
    }
    const eid = String(resolved.id).trim();
    const cid = String(input.companyId || '').trim();
    const strip = (o: Record<string, any>) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(o)) {
        if (v === undefined || v === null || v === '') continue;
        out[k] = v;
      }
      return out;
    };
    const variants = [
      strip({
        company_id: cid,
        company: cid,
        first_name: input.first_name,
        last_name: input.last_name,
        email: input.email,
        job_title: input.job_title,
        position: input.job_title,
        title: input.job_title,
        status: input.status || 'active',
      }),
      strip({
        company_id: cid,
        first_name: input.first_name,
        last_name: input.last_name,
        email: input.email,
        job_title: input.job_title,
        position: input.job_title,
      }),
      strip({
        company: cid,
        first_name: input.first_name,
        last_name: input.last_name,
        job_title: input.job_title,
        position: input.job_title,
      }),
      strip({ company_id: cid, job_title: input.job_title, position: input.job_title }),
      strip({ company: cid, job_title: input.job_title, position: input.job_title }),
    ];
    let lastUp: unknown = null;
    for (const body of variants) {
      if (Object.keys(body).length === 0) continue;
      try {
        return await updateEmployee(eid, body);
      } catch (e) {
        lastUp = e;
      }
    }
    throw lastUp instanceof Error ? lastUp : new Error('Could not update employee assignment');
  }
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

  const normId = (v: any): string => {
    if (v == null || v === '') return '';
    if (typeof v === 'object' && (v as any).id != null) return String((v as any).id).trim().toLowerCase();
    return String(v).trim().toLowerCase();
  };
  const cidNorm = normId(cid);
  const companyMatches = (s: any): boolean => {
    const c = s?.company_id ?? s?.company;
    if (c == null || c === '') return true;
    return normId(c) === cidNorm;
  };
  const rangeLo = params.rangeStart.getTime();
  const rangeHi = params.rangeEnd.getTime();
  const inRange = (s: any): boolean => {
    const stRaw = s?.start_time ?? s?.start ?? s?.start_at ?? s?.time_in ?? s?.start_datetime;
    const st = stRaw ? new Date(stRaw) : null;
    if (!st || Number.isNaN(st.getTime())) return false;
    const t = st.getTime();
    // Small slack for timezone / DST edge cases around range boundaries.
    return t >= rangeLo - 60_000 && t <= rangeHi + 60_000;
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

/**
 * When POST returns 201 with an empty body, the created id may only appear in `Location`.
 * Also matches nested DRF shapes: `{ data: { id } }`.
 */
function parseShiftIdFromLocationUrl(location: string | null | undefined): string {
  if (!location || typeof location !== 'string') return '';
  try {
    const pathPart = location.includes('://') ? new URL(location).pathname : location;
    const m =
      pathPart.match(/\/(?:shifts|scheduled-shifts|schedule-shifts)\/([0-9a-fA-F-]{36})\/?$/i) ||
      pathPart.match(/\/(?:shifts|scheduled-shifts|schedule-shifts)\/(\d+)\/?$/);
    return m ? String(m[1]) : '';
  } catch {
    return '';
  }
}

function normalizeShiftCreateResponse(body: any, location: string | null | undefined): any {
  const fromNested = (b: any): any => {
    if (b == null || typeof b !== 'object') return b;
    if (b.id != null || b.pk != null || b.uuid != null) return attachId({ ...b });
    for (const key of ['data', 'shift', 'result', 'object', 'item']) {
      const inner = (b as any)[key];
      if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
        const r = fromNested(inner);
        if (r && (r.id != null || r.pk != null || r.uuid != null)) return attachId({ ...r });
      }
    }
    return b;
  };
  let out = fromNested(body);
  const idFromLoc = parseShiftIdFromLocationUrl(location);
  if (idFromLoc && (!out || typeof out !== 'object' || (out as any).id == null || String((out as any).id).trim() === '')) {
    out = { ...(out && typeof out === 'object' ? out : {}), id: idFromLoc };
  }
  return out;
}

/** Last resort when POST body is `{}` and Location is missing — match by employee + start/end. */
async function findShiftIdAfterCreate(params: {
  companyId: string;
  employeeId: string;
  startTimeIso: string;
  endTimeIso: string;
}): Promise<string | undefined> {
  const { companyId, employeeId, startTimeIso, endTimeIso } = params;
  const startMs = new Date(startTimeIso).getTime();
  const endMs = new Date(endTimeIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return undefined;
  const eid = String(employeeId).trim();
  const tryQueries = [
    async () => getShifts({ company: companyId, employee: eid }),
    async () => getShifts({ company_id: companyId, employee_id: eid }),
    async () => getShifts({ company: companyId, employee_id: eid }),
  ];
  let rows: any[] = [];
  for (const q of tryQueries) {
    try {
      const r = await q();
      rows = Array.isArray(r) ? r : [];
      if (rows.length) break;
    } catch {
      /* ignore */
    }
  }
  if (rows.length === 0) {
    rows = await getShiftsForCompanyInRange({
      companyId,
      rangeStart: new Date(startMs - 86_400_000),
      rangeEnd: new Date(endMs + 86_400_000),
    });
  }
  const match = (s: any): boolean => {
    const se =
      s?.employee_id ??
      (typeof s?.employee === 'object' && s?.employee != null ? (s.employee as any).id : s?.employee);
    if (String(se ?? '').trim() !== eid) return false;
    const st = s?.start_time ?? s?.start;
    if (!st) return false;
    const tS = new Date(st).getTime();
    if (Number.isNaN(tS) || Math.abs(tS - startMs) > 120_000) return false;
    const et = s?.end_time ?? s?.end;
    if (!et) return true;
    const tE = new Date(et).getTime();
    return !Number.isNaN(tE) && Math.abs(tE - endMs) <= 120_000;
  };
  for (const s of rows) {
    if (!match(s)) continue;
    const id = String(s.id ?? s.pk ?? s.uuid ?? '').trim();
    if (id) return id;
  }
  return undefined;
}

async function findShiftIdAfterCreateWithRetry(params: Parameters<typeof findShiftIdAfterCreate>[0]): Promise<string | undefined> {
  for (let i = 0; i < 4; i++) {
    const id = await findShiftIdAfterCreate(params);
    if (id) return id;
    await new Promise((r) => setTimeout(r, 350));
  }
  return undefined;
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
  /** Some tenants require organization on shift POST. */
  organizationId?: string | null;
}): Promise<any> {
  const { companyId, employeeId, startTimeIso, endTimeIso, extras = {}, organizationId } = data;
  const cid0 = String(companyId || '').trim();
  const eid0 = String(employeeId || '').trim();
  if (!cid0) throw new Error('Shift create: companyId is missing.');
  if (!eid0) throw new Error('Shift create: employeeId is missing.');
  if (!startTimeIso || !endTimeIso) throw new Error('Shift create: start_time / end_time are missing.');
  logSchedulerShift('createShiftWithFallbacks:input', {
    companyId: cid0,
    employeeId: eid0,
    startTimeIso,
    endTimeIso,
    organizationId: organizationId ?? null,
    extrasKeys: extras ? Object.keys(extras) : [],
  });
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
  let x = strip(extras);
  if (x.shift_type != null) {
    const mapped = mapShiftTypeLabelForApi(x.shift_type);
    if (mapped) x.shift_type = mapped;
    else delete x.shift_type;
  }
  if (x.break_duration_minutes != null && x.break_duration != null) delete x.break_duration;

  const cid = String(companyId).trim();
  const eid = String(employeeId).trim();
  const oid = organizationId != null && String(organizationId).trim() !== '' ? String(organizationId).trim() : '';

  const minimalCore = [
    strip({ company: cid, employee: eid, ...t }),
    strip({ company_id: cid, employee_id: eid, ...t }),
    strip({ company: cid, employee_id: eid, ...t }),
    strip({ company_id: cid, employee: eid, ...t }),
  ];
  if (oid) {
    minimalCore.push(
      strip({ company: cid, employee: eid, organization: oid, ...t }),
      strip({ company_id: cid, employee_id: eid, organization: oid, ...t }),
      strip({ company: cid, employee: eid, organization_id: oid, ...t })
    );
  }
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

  /** Fewer variants → fewer failing POSTs in logs; enums are included in full `x` pass. */
  const ordered: Record<string, any>[] = [
    ...minimalCore,
    ...minimalCore.map((b) => strip({ ...b, ...xLight })),
    ...minimalCore.map((b) => strip({ ...b, ...x })),
  ];

  const bodies = dedupeShiftCreateBodies(ordered);

  let lastErr: unknown;
  for (const body of bodies) {
    if (Object.keys(body).length === 0) continue;
    try {
      const created = await postSchedulerShiftCreate(body, cid);
      let nid = String(created?.id ?? created?.pk ?? created?.uuid ?? '').trim();
      if (!nid) {
        nid =
          (await findShiftIdAfterCreateWithRetry({
            companyId: cid,
            employeeId: eid,
            startTimeIso,
            endTimeIso,
          })) ?? '';
      }
      if (nid) {
        const merged = { ...created, ...attachId({ ...created, id: nid }) };
        logSchedulerShift('createShiftWithFallbacks:ok', {
          shiftId: nid,
          source: String(created?.id ?? '').trim() ? 'response' : 'refetch',
        });
        return merged;
      }
      logSchedulerShift('createShiftWithFallbacks:fail_no_id', {
        createdKeys: created && typeof created === 'object' ? Object.keys(created) : [],
        employeeId: eid,
        startTimeIso,
        endTimeIso,
      });
      throw new Error(
        'Shift create: server returned success but no shift id was found. ' +
          'The POST may have been dropped (e.g. URL redirect), the response body may be empty, or list filters may not match. ' +
          'Check Metro logs for [scheduler/shift].'
      );
    } catch (e: unknown) {
      lastErr = e;
      if (e instanceof HttpError) {
        logSchedulerShift('createShiftWithFallbacks:http_error', {
          status: e.status,
          body: e.body,
        });
      } else if (e instanceof Error) {
        logSchedulerShift('createShiftWithFallbacks:error', { message: e.message });
      }
      const st = e instanceof HttpError ? e.status : (e as any)?.status;
      if (st === 401 || st === 403) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not create shift');
}

export async function createShift(data: any) {
  const hint = String(data?.company ?? data?.company_id ?? '').trim();
  return postSchedulerShiftCreate(data, hint);
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
/**
 * Flat list routes — **keep short**: each failed probe hits the server. Rare routers are tried only
 * after these (see `scheduleTemplateFallbackPrefixes`).
 */
const SCHEDULE_TEMPLATE_PATH_PREFIXES = [
  '/scheduler/schedule-templates',
  '/scheduler/schedule_templates',
];
const SCHEDULE_TEMPLATE_PATH_PREFIXES_FALLBACK = [
  '/scheduler/week-templates',
  '/scheduler/week_templates',
  '/scheduler/saved-schedule-templates',
  '/scheduler/saved_schedule_templates',
];

// Remember which schedule-template base path worked for GET so DELETE can mirror it.
let lastScheduleTemplatesApiPath: string | null = null;
let lastScheduleTemplatesCreateApiPath: string | null = null;
let lastScheduleTemplatesCompanyParamIndex: number | null = null;
/** Full company list URL (e.g. `/scheduler/companies/<id>/schedule-templates/`) — avoids 7×N GET discovery on every load. */
let lastCompanyScheduleTemplatesListPath: string | null = null;

/** In-memory: company nested list URL returned 404 (backend has no such route). */
const companyNestedScheduleTemplatesList404 = new Set<string>();
const SCHEDULER_NESTED_TEMPLATES_404_KEY = 'scheduler_company_nested_schedule_templates_list_404';

function readNestedTemplatesList404FromStorage(): Set<string> {
  try {
    if (typeof sessionStorage === 'undefined') return new Set();
    const raw = sessionStorage.getItem(SCHEDULER_NESTED_TEMPLATES_404_KEY);
    if (!raw) return new Set();
    const o = JSON.parse(raw) as { companies?: string[] };
    if (o && Array.isArray(o.companies)) return new Set(o.companies.map((x) => String(x)));
  } catch {
    /* ignore */
  }
  return new Set();
}

function persistNestedTemplatesList404(companyId: string) {
  const cid = String(companyId || '').trim();
  if (!cid) return;
  companyNestedScheduleTemplatesList404.add(cid);
  try {
    if (typeof sessionStorage === 'undefined') return;
    const merged = new Set([...readNestedTemplatesList404FromStorage(), cid]);
    sessionStorage.setItem(SCHEDULER_NESTED_TEMPLATES_404_KEY, JSON.stringify({ companies: [...merged] }));
  } catch {
    /* ignore */
  }
}

/** True when GET `/scheduler/companies/<id>/schedule-templates/` is known to 404 — skip it (survives web refresh). */
function shouldSkipCompanyNestedScheduleTemplatesList(companyId: string): boolean {
  const cid = String(companyId || '').trim();
  if (!cid) return false;
  if (companyNestedScheduleTemplatesList404.has(cid)) return true;
  const fromStorage = readNestedTemplatesList404FromStorage();
  if (fromStorage.has(cid)) {
    companyNestedScheduleTemplatesList404.add(cid);
    return true;
  }
  return false;
}

function clearCompanyNestedScheduleTemplatesList404(companyId: string) {
  const cid = String(companyId || '').trim();
  if (!cid) return;
  companyNestedScheduleTemplatesList404.delete(cid);
  try {
    if (typeof sessionStorage === 'undefined') return;
    const merged = readNestedTemplatesList404FromStorage();
    merged.delete(cid);
    sessionStorage.setItem(SCHEDULER_NESTED_TEMPLATES_404_KEY, JSON.stringify({ companies: [...merged] }));
  } catch {
    /* ignore */
  }
}

function withTrailingSlash(path: string): string {
  const p = String(path || '').trim();
  if (!p) return '/';
  return p.endsWith('/') ? p : `${p}/`;
}

/** Strip `/api` so paths match `apiClient` endpoints (`/scheduler/...`). */
function normalizeApiResourcePathFromLocation(location: string | null | undefined): string | null {
  const raw = String(location || '').trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const u = new URL(raw);
      const p = u.pathname.replace(/^\/api\/?/, '/');
      return withTrailingSlash(p.startsWith('/') ? p : `/${p}`);
    }
    const stripped = raw.replace(/^\/api\/?/, '/');
    return withTrailingSlash(stripped.startsWith('/') ? stripped : `/${stripped}`);
  } catch {
    return null;
  }
}

/** One POST target per save — do not default to company-nested URL if that list route is known to 404. */
function pickScheduleTemplateCreatePostPath(companyId: string): string {
  const cid = String(companyId || '').trim();
  const cenc = cid ? encodeURIComponent(cid) : '';
  if (lastScheduleTemplatesCreateApiPath) {
    return withTrailingSlash(lastScheduleTemplatesCreateApiPath);
  }
  if (lastCompanyScheduleTemplatesListPath && !shouldSkipCompanyNestedScheduleTemplatesList(cid)) {
    return withTrailingSlash(lastCompanyScheduleTemplatesListPath);
  }
  if (lastScheduleTemplatesApiPath) {
    return withTrailingSlash(lastScheduleTemplatesApiPath);
  }
  if (cenc && !shouldSkipCompanyNestedScheduleTemplatesList(cid)) {
    return `/scheduler/companies/${cenc}/schedule-templates/`;
  }
  return '/scheduler/schedule-templates/';
}

/** POST targets for create — try in order on 404 (list vs create base can disagree). */
function scheduleTemplateCreatePostPathCandidates(companyId: string): string[] {
  const cid = String(companyId || '').trim();
  const cenc = cid ? encodeURIComponent(cid) : '';
  const primary = pickScheduleTemplateCreatePostPath(cid);
  const candidates: string[] = [
    primary,
    '/scheduler/schedule-templates/',
    '/scheduler/schedule_templates/',
  ];
  if (cenc && !shouldSkipCompanyNestedScheduleTemplatesList(cid)) {
    candidates.push(`/scheduler/companies/${cenc}/schedule-templates/`);
    candidates.push(`/scheduler/companies/${cenc}/schedule_templates/`);
  }
  return dedupePaths(candidates);
}

/** Hyperlinked `url` / `self` from list or `Location` — normalize to `/scheduler/.../` for `apiClient`. */
function normalizeHyperlinkRowUrlToPath(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    if (s.startsWith('http://') || s.startsWith('https://')) {
      const u = new URL(s);
      const p = u.pathname.replace(/^\/api\/?/, '/');
      return withTrailingSlash(p.startsWith('/') ? p : `/${p}`);
    }
  } catch {
    /* ignore */
  }
  const stripped = s.replace(/^\/api\/?/, '/');
  return withTrailingSlash(stripped.startsWith('/') ? stripped : `/${stripped}`);
}

/**
 * GET/PATCH detail paths in **priority** order. List base must come **before** create base: POST often
 * nests under `/companies/.../schedule-templates/` while retrieve lives at `/scheduler/schedule-templates/{id}/`.
 */
function orderedScheduleTemplateDetailPaths(
  templateId: string,
  companyId: string | null | undefined,
  templateRow?: any
): string[] {
  const enc = encodeURIComponent(String(templateId || '').trim());
  if (!enc) return [];

  const candidates: string[] = [];

  const rowUrl = templateRow?.url ?? templateRow?.self ?? templateRow?.href ?? templateRow?.detail_url;
  if (typeof rowUrl === 'string' && rowUrl.trim()) {
    const p = normalizeHyperlinkRowUrlToPath(rowUrl);
    if (p) candidates.push(p);
  }

  const listBase = lastScheduleTemplatesApiPath?.replace(/\/+$/, '');
  const createBase = lastScheduleTemplatesCreateApiPath?.replace(/\/+$/, '');
  const c0 = companyId != null ? String(companyId).trim() : '';
  const cenc = c0 ? encodeURIComponent(c0) : '';

  if (listBase) {
    candidates.push(withTrailingSlash(`${listBase}/${enc}`));
  }

  candidates.push(withTrailingSlash(`/scheduler/schedule-templates/${enc}`));
  candidates.push(withTrailingSlash(`/scheduler/schedule_templates/${enc}`));

  if (createBase && createBase !== listBase) {
    candidates.push(withTrailingSlash(`${createBase}/${enc}`));
  }

  if (cenc && !shouldSkipCompanyNestedScheduleTemplatesList(c0)) {
    candidates.push(withTrailingSlash(`/scheduler/companies/${cenc}/schedule-templates/${enc}`));
    candidates.push(withTrailingSlash(`/scheduler/companies/${cenc}/schedule_templates/${enc}`));
  }

  for (const p of SCHEDULE_TEMPLATE_PATH_PREFIXES_FALLBACK) {
    const base = String(p || '').replace(/\/+$/, '');
    if (base) candidates.push(withTrailingSlash(`${base}/${enc}`));
  }
  if (cenc) {
    for (const seg of [
      'week-templates',
      'week_templates',
      'saved-schedule-templates',
      'saved_schedule_templates',
    ]) {
      candidates.push(withTrailingSlash(`/scheduler/companies/${cenc}/${seg}/${enc}`));
    }
  }

  return dedupePaths(candidates);
}

/** One PATCH target — first path likely to respond (same ordering as {@link orderedScheduleTemplateDetailPaths}). */
function pickScheduleTemplateDetailPatchPath(
  templateId: string,
  templateRow: any | undefined,
  companyId: string | null
): string {
  const ordered = orderedScheduleTemplateDetailPaths(templateId, companyId, templateRow);
  if (ordered.length) return ordered[0];
  const enc = encodeURIComponent(String(templateId || '').trim());
  return withTrailingSlash(`/scheduler/schedule-templates/${enc}`);
}

/** Single company list URL — probing both kebab and snake doubles GETs; pick one convention. */
function companyScheduleTemplateListUrl(companyId: string): string {
  const enc = encodeURIComponent(String(companyId || '').trim());
  return `/scheduler/companies/${enc}/schedule-templates/`;
}

export async function getScheduleTemplates(params?: Record<string, any>) {
  const bustHttpCache =
    params != null && Object.prototype.hasOwnProperty.call(params as object, '_');
  const add = (p: string, bucket: string[]) => {
    const n = String(p || '').trim();
    if (!n) return;
    const withSlash = n.endsWith('/') ? n : `${n}/`;
    if (!bucket.includes(withSlash)) bucket.push(withSlash);
  };
  const primary: string[] = [];
  if (lastScheduleTemplatesApiPath) {
    add(lastScheduleTemplatesApiPath, primary);
  }
  for (const p of SCHEDULE_TEMPLATE_PATH_PREFIXES) {
    add(p.startsWith('/') ? p : `/${p}`, primary);
  }
  const fallback: string[] = [];
  for (const p of SCHEDULE_TEMPLATE_PATH_PREFIXES_FALLBACK) {
    add(p.startsWith('/') ? p : `/${p}`, fallback);
  }

  const tryPaths = async (paths: string[]) => {
    let lastErr: unknown;
    for (const path of paths) {
      try {
        const raw = await apiClient.get<any>(
          path,
          params,
          bustHttpCache ? { cache: 'no-store' } : undefined
        );
        lastScheduleTemplatesApiPath = String(path || '').replace(/\/+$/, '');
        return normalizePaginatedList(raw);
      } catch (e: any) {
        lastErr = e;
        const st = typeof e?.status === 'number' ? e.status : e?.response?.status;
        if (st === 404) continue;
        throw e;
      }
    }
    return { err: lastErr };
  };

  const first = await tryPaths(primary);
  if (Array.isArray(first)) return first;
  const second = await tryPaths(fallback);
  if (Array.isArray(second)) return second;
  const err = 'err' in second && second.err ? second.err : ('err' in first ? first.err : null);
  throw err instanceof Error ? err : new Error('Failed to load schedule templates');
}

function templateRowCompanyId(row: any): string {
  const c = row?.company_id ?? row?.company;
  if (c != null && typeof c === 'object' && (c as any).id != null) return String((c as any).id).trim();
  if (c != null && c !== '') return String(c).trim();
  return '';
}

/**
 * Load schedule templates for one company. Uses a **remembered** company list URL (1 GET) when possible;
 * otherwise a small discovery pass (few paths × few param shapes), then flat `getScheduleTemplates`.
 * @param bustCache - append `_` timestamp so browsers/CDNs don't serve a stale list after create/delete (web).
 */
export async function getScheduleTemplatesForCompany(
  companyId: string,
  organizationId?: string | null,
  bustCache?: boolean
): Promise<any[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];

  const cacheBust = bustCache ? { _: Date.now() } : {};
  const bustHttpCache = bustCache === true;

  const tryList = async (params: Record<string, any>) => {
    try {
      const rows = await getScheduleTemplates({ ...params, ...cacheBust });
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  /** `null` = route 404; otherwise normalized list (possibly empty) from a single GET. */
  const tryListAtPath = async (path: string, params: Record<string, any>): Promise<any[] | null> => {
    try {
      const raw = await apiClient.get<any>(
        path,
        { ...params, ...cacheBust },
        bustHttpCache ? { cache: 'no-store' } : undefined
      );
      const rows = normalizePaginatedList(raw);
      return Array.isArray(rows) ? rows : [];
    } catch (e: any) {
      const st = typeof e?.status === 'number' ? e.status : e?.response?.status;
      if (st === 404) return null;
      throw e;
    }
  };

  /** One query object for company-nested list (avoid `company` + `company_id` double GET). */
  const companyListQuery = (): Record<string, any> => {
    const q: Record<string, any> = { company: cid };
    if (organizationId) q.organization = organizationId;
    return q;
  };

  /** Flat list — when org is required, try `company`+`organization` first (matches typical DRF filters). */
  const flatListParamSets = (): Record<string, any>[] => {
    const out: Record<string, any>[] = [];
    if (organizationId) {
      out.push({ company: cid, organization: organizationId });
    }
    out.push({ company: cid }, { company_id: cid });
    return out;
  };

  const keepCompanyRows = (rows: any[]): any[] => {
    const hasCompanyInfo = rows.some((r: any) => String(r?.company_id ?? r?.company ?? '').trim() !== '');
    const matched = rows.filter((r: any) => templateRowCompanyId(r) === cid);
    if (matched.length > 0) return matched;
    return hasCompanyInfo ? [] : rows;
  };

  const rememberListBase = (path: string) => {
    lastScheduleTemplatesApiPath = String(path || '').replace(/\/+$/, '');
  };

  const flatParamSets = flatListParamSets();
  const flatIndexOrder = (): number[] => {
    const idxs: number[] = [];
    if (
      lastScheduleTemplatesCompanyParamIndex != null &&
      lastScheduleTemplatesCompanyParamIndex >= 0 &&
      lastScheduleTemplatesCompanyParamIndex < flatParamSets.length
    ) {
      idxs.push(lastScheduleTemplatesCompanyParamIndex);
    }
    for (let i = 0; i < flatParamSets.length; i++) {
      if (!idxs.includes(i)) idxs.push(i);
    }
    return idxs;
  };

  const companyParams = { ...companyListQuery(), ...cacheBust };

  // Company-nested list — many backends have **no** `/companies/<id>/schedule-templates/` route (404).
  // Once we see 404, skip forever for this company (sessionStorage on web) so refresh does not repeat the error.
  const skipNested = shouldSkipCompanyNestedScheduleTemplatesList(cid);

  if (!skipNested) {
    const nestedListUrl = lastCompanyScheduleTemplatesListPath || companyScheduleTemplateListUrl(cid);
    const nestedRows = await tryListAtPath(nestedListUrl, companyParams);
    if (nestedRows === null) {
      lastCompanyScheduleTemplatesListPath = null;
      persistNestedTemplatesList404(cid);
    } else if (nestedRows.length > 0) {
      const filtered = keepCompanyRows(nestedRows);
      if (filtered.length > 0) {
        rememberListBase(nestedListUrl);
        lastCompanyScheduleTemplatesListPath = withTrailingSlash(nestedListUrl);
        lastScheduleTemplatesCompanyParamIndex = 0;
        clearCompanyNestedScheduleTemplatesList404(cid);
        return filtered;
      }
    }
  } else {
    lastCompanyScheduleTemplatesListPath = null;
  }

  // Flat routes — getScheduleTemplates tries remembered path first, then primary prefixes.
  const idxOrder = flatIndexOrder();
  for (const idx of idxOrder) {
    const p = { ...flatParamSets[idx], ...cacheBust };
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

/**
 * Single POST per call — remembers working path. Tries a few URLs on **404** (wrong remembered base).
 * Uses `postWithLocation` so DRF's `Location` header becomes `url` when the body is empty.
 */
export async function createScheduleTemplate(data: Record<string, any>) {
  const cid = String(data.company ?? data.company_id ?? '').trim();
  const paths = scheduleTemplateCreatePostPathCandidates(cid);
  let lastErr: unknown;
  for (const path of paths) {
    try {
      const { json, location } = await apiClient.postWithLocation<any>(path, data);
      const base = String(path || '').replace(/\/+$/, '');
      lastScheduleTemplatesCreateApiPath = base;
      if (
        cid &&
        !shouldSkipCompanyNestedScheduleTemplatesList(cid) &&
        /\/companies\/[^/]+\//.test(base) &&
        /schedule[-_]templates/i.test(base)
      ) {
        lastCompanyScheduleTemplatesListPath = withTrailingSlash(base);
      }

      const urlFromLoc = normalizeApiResourcePathFromLocation(location);
      const merged: Record<string, any> = { ...(json && typeof json === 'object' ? json : {}) };
      if (urlFromLoc && !merged.url && !merged.self) {
        merged.url = urlFromLoc;
      }
      const idFromPath = (() => {
        if (merged.id != null || merged.pk != null || merged.uuid != null) return null;
        const p = urlFromLoc || '';
        const seg = p.replace(/\/+$/, '').split('/').filter(Boolean).pop();
        if (seg && (/^[0-9a-f-]{36}$/i.test(seg) || /^\d+$/.test(seg))) return seg;
        return null;
      })();
      if (idFromPath != null && merged.id == null) merged.id = idFromPath;

      return merged;
    } catch (e: unknown) {
      lastErr = e;
      const st = e instanceof HttpError ? e.status : (e as any)?.status;
      if (st === 404) continue;
      throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new HttpError('Could not create schedule template (all POST paths failed)', 404, { lastError: String(lastErr ?? '') });
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

/** DRF DateTimeField expects ISO 8601 strings in JSON. */
function toIsoDateTime(v: any): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return String(v);
}

function stripCompanyKeysFromShiftBody(b: Record<string, any>): Record<string, any> {
  const o = { ...b };
  delete o.company;
  delete o.company_id;
  return o;
}

/** Map UI labels (e.g. "Morning (6am - 2pm)") to short enum values many Django serializers expect. */
function mapShiftTypeLabelForApi(raw: any): string | undefined {
  if (raw == null || raw === '') return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower.includes('morning') || lower.includes('6am')) return 'morning';
  if (lower.includes('afternoon') || lower.includes('evening') || lower.includes('2pm')) return 'afternoon';
  if (lower.includes('night') || lower.includes('10pm')) return 'night';
  if (lower.includes('day') && lower.includes('9')) return 'day';
  if (lower === 'custom') return undefined;
  return s.length <= 48 ? s : undefined;
}

/** DRF `PrimaryKeyRelatedField(many=True)` often expects integers, not `"123"` strings — linking fails silently → empty template. */
function normalizePkForApi(id: string): string | number {
  const s = String(id ?? '').trim();
  if (!s) return s;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return s;
}

function normalizeShiftPkList(ids: string[]): (string | number)[] {
  return ids.map((id) => normalizePkForApi(id));
}

function errorInformativeness(e: unknown): number {
  if (!(e instanceof HttpError)) return 0;
  if (e.status === 400 || e.status === 422) return 4;
  if (e.status === 403) return 3;
  if (e.status === 409) return 2;
  if (e.status === 404 || e.status === 405) return 0;
  return 1;
}

/** Surfaces DRF validation bodies in UI (HttpError.body). */
export function formatSchedulerApiError(e: unknown): string {
  if (e instanceof HttpError) {
    const msg = e.message || 'Request failed';
    const b = e.body;
    if (b != null && typeof b === 'object' && !Array.isArray(b)) {
      try {
        return `${msg}\n${JSON.stringify(b).slice(0, 800)}`;
      } catch {
        return msg;
      }
    }
    return msg;
  }
  if (e instanceof Error) return e.message;
  return String(e ?? 'Unknown error');
}


async function postSchedulerShiftCreate(body: Record<string, any>, companyId: string): Promise<any> {
  const cid = String(companyId || '').trim();
  const enc = cid ? encodeURIComponent(cid) : '';
  /**
   * Django APPEND_SLASH: POST to `/scheduler/shifts` (no trailing slash) often 301/302-redirects.
   * `fetch` follow can turn the retried request into GET — body never hits the create view → nothing saved.
   * Only use trailing-slash URLs here.
   */
  /** Flat `/scheduler/shifts/` first, then nested `companies/.../shifts/` (no extra phantom routes → fewer POST errors in logs). */
  const attempts: Array<{ path: string; body: Record<string, any> }> = [
    { path: '/scheduler/shifts/', body },
  ];
  if (enc) {
    attempts.push(
      { path: `/scheduler/companies/${enc}/shifts/`, body },
      { path: `/scheduler/companies/${enc}/shifts/`, body: stripCompanyKeysFromShiftBody(body) },
      { path: `/scheduler/company/${enc}/shifts/`, body },
      { path: `/scheduler/company/${enc}/shifts/`, body: stripCompanyKeysFromShiftBody(body) }
    );
  }
  let lastErr: unknown;
  let bestErr: unknown;
  for (const { path, body: payload } of attempts) {
    try {
      logSchedulerShift('POST_attempt', {
        path,
        keys: Object.keys(payload),
        employee: payload.employee ?? payload.employee_id,
        start_time: payload.start_time,
        end_time: payload.end_time,
      });
      const { json, location, status } = await apiClient.postWithLocation<any>(path, payload);
      const normalized = normalizeShiftCreateResponse(json, location);
      logSchedulerShift('POST_response', {
        path,
        httpStatus: status,
        location: location ?? null,
        normalizedId: normalized?.id ?? normalized?.pk ?? null,
        jsonKeys: json && typeof json === 'object' ? Object.keys(json) : [],
      });
      return normalized;
    } catch (e: unknown) {
      lastErr = e;
      if (!bestErr || errorInformativeness(e) > errorInformativeness(bestErr)) bestErr = e;
      if (e instanceof HttpError) {
        logSchedulerShift('POST_attempt_failed', { path, status: e.status, body: e.body });
      }
      const st = e instanceof HttpError ? e.status : (e as any)?.status;
      if (st === 401 || st === 403) throw e;
    }
  }
  const err = bestErr && errorInformativeness(bestErr) >= errorInformativeness(lastErr!) ? bestErr : lastErr;
  throw err instanceof Error ? err : new Error('Could not create shift');
}

function resolvePersistEmployeeId(s: any): string {
  const emp =
    s?.employee_id ??
    (typeof s?.employee === 'object' && s?.employee != null && (s.employee as any).id != null
      ? (s.employee as any).id
      : s?.employee);
  return String(emp ?? '').trim();
}

function resolvePersistStartEnd(s: any): { start: string; end: string } | null {
  const start = toIsoDateTime(
    s?.start_time ?? s?.start ?? s?.startAt ?? s?.start_at ?? s?.time_in ?? s?.start_datetime
  );
  if (!start) return null;
  let end = toIsoDateTime(s?.end_time ?? s?.end ?? s?.endAt ?? s?.end_at ?? s?.time_out ?? s?.end_datetime);
  if (!end) {
    const d = new Date(start);
    if (Number.isNaN(d.getTime())) return null;
    d.setTime(d.getTime() + 8 * 60 * 60 * 1000);
    end = d.toISOString();
  }
  return { start, end };
}

/**
 * Ensures each shift row has a server id by POSTing any row that only exists in UI state.
 * Weekly templates often require `shift_ids`; empty templates happen when nested JSON is ignored.
 */
export async function ensureSchedulerShiftsPersisted(params: {
  companyId: string;
  organizationId?: string | null;
  shifts: any[];
}): Promise<any[]> {
  const cid = String(params.companyId || '').trim();
  if (!cid) throw new Error('companyId is required');
  const oid =
    params.organizationId != null && String(params.organizationId).trim() !== ''
      ? String(params.organizationId).trim()
      : null;

  const out: any[] = [];
  for (const raw of params.shifts) {
    const existing = String(raw?.id ?? raw?.pk ?? raw?.uuid ?? '').trim();
    if (existing) {
      out.push(raw);
      continue;
    }
    const eid = resolvePersistEmployeeId(raw);
    const se = resolvePersistStartEnd(raw);
    if (!eid || !se) {
      throw new Error(
        'A shift in this week is missing a saved employee id or valid start/end times. Edit and save each shift, then try again.'
      );
    }
    const br = Number(raw?.break_duration_minutes ?? raw?.break_minutes ?? 0) || 0;
    const extras: Record<string, any> = {};
    if (br > 0) extras.break_duration_minutes = br;
    if (raw?.notes != null && String(raw.notes).trim() !== '') extras.notes = String(raw.notes).trim();
    const mappedType = mapShiftTypeLabelForApi(raw?.shift_type);
    if (mappedType) extras.shift_type = mappedType;
    if (raw?.hourly_rate != null && String(raw.hourly_rate).trim() !== '') extras.hourly_rate = String(raw.hourly_rate);

    const created = await createShiftWithFallbacks({
      companyId: cid,
      employeeId: eid,
      startTimeIso: se.start,
      endTimeIso: se.end,
      extras,
      organizationId: oid,
    });
    const nid = String(created?.id ?? created?.pk ?? created?.uuid ?? '').trim();
    if (!nid) {
      throw new Error(
        'Shift was created but the server did not return an id. Check POST /scheduler/shifts/ response shape.'
      );
    }
    out.push({ ...raw, id: nid, ...created });
  }
  return out;
}

/** Count nested shifts on a schedule-template row (serializer / list / detail shapes differ). */
function countShiftsOnTemplateRow(row: any): number {
  if (!row || typeof row !== 'object') return 0;
  const idOnly =
    row.shift_ids ??
    row.linked_shift_ids ??
    row.schedule_shift_ids ??
    row.linked_shifts ??
    row.template_shift_ids ??
    row.scheduled_shift_ids ??
    row.m2m_shift_ids ??
    row.shift_pks;
  if (Array.isArray(idOnly) && idOnly.length > 0) return idOnly.length;
  const embedded =
    row.template_shifts ??
    row.shifts ??
    row.shift_templates ??
    row.schedule_shifts ??
    row.scheduled_shifts ??
    row.lines ??
    row.items;
  if (Array.isArray(embedded) && embedded.length > 0) return embedded.length;
  const sc =
    row.shift_count ??
    row.shifts_count ??
    row.template_shift_count ??
    row.num_shifts ??
    row.shift_set_count;
  if (typeof sc === 'number' && Number.isFinite(sc) && sc >= 0) return sc;
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

/**
 * True only when the row **actually** indicates linked shifts (non-empty arrays or count &gt; 0).
 * Do **not** treat `shifts: []` or `shift_count: 0` as signal — serializers often echo empty keys and
 * that used to pair with count===0 → false "empty template" cleanup → DELETE on the server.
 */
function hasTemplateShiftSignal(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  const countKeys = ['shift_count', 'shifts_count', 'template_shift_count', 'num_shifts', 'shift_set_count'];
  for (const k of countKeys) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
    const v = (row as any)[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return true;
  }
  for (const k of ['shift_ids', 'linked_shift_ids', 'schedule_shift_ids', 'linked_shifts']) {
    const arr = (row as any)[k];
    if (Array.isArray(arr) && arr.length > 0) return true;
  }
  const embeddedKeys = [
    'template_shifts',
    'shifts',
    'shift_templates',
    'schedule_shifts',
    'scheduled_shifts',
    'lines',
    'items',
  ];
  for (const k of embeddedKeys) {
    const v = (row as any)[k];
    if (Array.isArray(v) && v.length > 0) return true;
  }
  return false;
}

/**
 * First GET that returns 200 — also yields the path used so PATCH targets the same router as GET.
 */
async function fetchScheduleTemplateDetailFirst(
  id: string,
  companyId?: string | null,
  hintRow?: any
): Promise<{ row: any; path: string } | null> {
  const cid = companyId != null ? String(companyId).trim() : '';
  const paths = orderedScheduleTemplateDetailPaths(id, cid || null, hintRow);
  for (const p of paths) {
    try {
      const row = await apiClient.get<any>(p);
      if (row) return { row, path: p };
    } catch (e: any) {
      const st = e instanceof HttpError ? e.status : e?.status;
      if (st === 404) continue;
      throw e;
    }
  }
  return null;
}

/**
 * GET template detail — tries paths in {@link orderedScheduleTemplateDetailPaths} order (stops at first 200).
 */
async function getScheduleTemplateDetail(
  id: string,
  companyId?: string | null,
  hintRow?: any
): Promise<any | null> {
  const hit = await fetchScheduleTemplateDetailFirst(id, companyId, hintRow);
  return hit?.row ?? null;
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
    const detail = await getScheduleTemplateDetail(id, companyId, createdRaw);
    if (detail) return detail;
    return createdRaw;
  }
  const byName = await findScheduleTemplateRowByName(companyId, label);
  if (!byName) return createdRaw || {};
  const tid = String(byName.id ?? byName.pk ?? byName.uuid ?? '').trim();
  if (!tid) return byName;
  const detail = await getScheduleTemplateDetail(tid, companyId, byName);
  return detail ?? byName;
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const k = String(p || '')
      .trim()
      .replace(/\/+$/, '/');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k.endsWith('/') ? k : `${k}/`);
  }
  return out;
}

function templateIdMatchesFkValue(v: any, templateId: string): boolean {
  const tid = String(templateId).trim();
  if (v == null) return false;
  if (typeof v === 'object' && (v as any).id != null) return String((v as any).id).trim() === tid;
  return String(v).trim() === tid;
}

/** Whether a shift row’s FK fields point at the given schedule-template id (read after PATCH). */
function shiftRowReferencesScheduleTemplate(shiftRow: any, templateId: string): boolean {
  if (!shiftRow || typeof shiftRow !== 'object') return false;
  const tid = String(templateId).trim();
  const keys = [
    'schedule_template',
    'schedule_template_id',
    'weekly_schedule_template',
    'weekly_schedule_template_id',
    'week_template',
    'week_template_id',
    'saved_schedule_template',
    'saved_schedule_template_id',
    'saved_week_template',
    'saved_week_template_id',
    'schedule_week_template',
    'schedule_week_template_id',
    'week_schedule_template',
    'week_schedule_template_id',
  ];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(shiftRow, k) && templateIdMatchesFkValue((shiftRow as any)[k], tid)) {
      return true;
    }
  }
  for (const k of Object.keys(shiftRow)) {
    if (!/template/i.test(k)) continue;
    if (templateIdMatchesFkValue((shiftRow as any)[k], tid)) return true;
  }
  return false;
}

/** Writable FK shapes for PATCH `/scheduler/shifts/<id>/` — backend may store the link on Shift, not on template M2M. */
function shiftTemplateFkWriteBodies(templateId: string): Record<string, any>[] {
  const tid = normalizePkForApi(templateId);
  const s = String(templateId).trim();
  return [
    { schedule_template: tid },
    { schedule_template_id: tid },
    { schedule_template: s },
    { weekly_schedule_template: tid },
    { weekly_schedule_template_id: tid },
    { week_template: tid },
    { week_template_id: tid },
    { saved_schedule_template: tid },
    { saved_schedule_template_id: tid },
    { saved_week_template: tid },
    { saved_week_template_id: tid },
    { schedule_week_template: tid },
    { week_schedule_template: tid },
    { schedule_template: { id: tid } },
    { weekly_schedule_template: { id: tid } },
  ];
}

/**
 * Approach B (client-only): set `schedule_template` (or alias) on each shift row after the template exists.
 * Verifies the first shift with GET so we don’t accept a 200 that ignored unknown fields.
 */
async function linkShiftsToScheduleTemplateViaShiftFk(templateId: string, shiftIds: string[]): Promise<boolean> {
  const ids = shiftIds.map((x) => String(x).trim()).filter(Boolean);
  if (!ids.length) return false;

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[schedule-template] linkShiftsToScheduleTemplateViaShiftFk', {
      templateId,
      shiftCount: ids.length,
    });
  }

  let chosen: Record<string, any> | null = null;
  for (const body of shiftTemplateFkWriteBodies(templateId)) {
    const w = scrubWrite(body);
    if (Object.keys(w).length === 0) continue;
    try {
      await apiClient.patch<any>(`/scheduler/shifts/${encodeURIComponent(ids[0])}/`, w);
    } catch (e: any) {
      const st = e instanceof HttpError ? e.status : e?.status;
      if (st === 400) continue;
      if (st === 404) return false;
      throw e;
    }
    const verify = await apiClient.get<any>(`/scheduler/shifts/${encodeURIComponent(ids[0])}/`).catch(() => null);
    if (verify && shiftRowReferencesScheduleTemplate(verify, templateId)) {
      chosen = w;
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[schedule-template] shift FK write verified', { keys: Object.keys(w) });
      }
      break;
    }
  }

  if (!chosen) return false;

  for (let i = 1; i < ids.length; i++) {
    try {
      await apiClient.patch<any>(`/scheduler/shifts/${encodeURIComponent(ids[i])}/`, chosen);
    } catch {
      return false;
    }
  }
  return true;
}

/** How many of the expected shift PKs appear when filtering by template FK (confirms DB link even if template GET omits nested shifts). */
async function countShiftsLinkedViaShiftListFilter(templateId: string, expectedShiftIds: string[]): Promise<number> {
  const tid = String(templateId).trim();
  const expected = new Set(expectedShiftIds.map((x) => String(x).trim()));
  const paramSets: Record<string, any>[] = [
    { schedule_template: tid },
    { schedule_template_id: tid },
    { weekly_schedule_template: tid },
    { week_template: tid },
    { saved_schedule_template: tid },
    { saved_week_template: tid },
    { schedule_week_template: tid },
    { schedule_template__id: tid },
    { schedule_template__exact: tid },
  ];
  for (const params of paramSets) {
    try {
      const rows = await getShifts(params);
      const arr = Array.isArray(rows) ? rows : [];
      const n = arr.filter((r: any) => expected.has(String(r?.id ?? r?.pk ?? '').trim())).length;
      if (n > 0) return n;
    } catch {
      /* ignore */
    }
  }
  return 0;
}

/**
 * Link persisted Shift PKs: **one** GET to find the real detail URL (same as browser), then ≤2 PATCH,
 * one GET refresh, ≤2 POST `set_shifts`, final GET — no grid of failing URLs.
 */
async function patchTemplateShiftsOnce(
  templateId: string,
  shiftIds: string[],
  templateRow: any | undefined,
  companyId: string | null
): Promise<{ linked: boolean; detail: any | null }> {
  if (!String(templateId || '').trim() || shiftIds.length === 0) {
    return { linked: false, detail: null };
  }
  const shiftIdsNum = normalizeShiftPkList(shiftIds);
  const ids = shiftIdsNum.length ? shiftIdsNum : shiftIds;

  const hit = await fetchScheduleTemplateDetailFirst(templateId, companyId, templateRow);
  if (!hit) {
    return { linked: false, detail: null };
  }
  let { row, path: detailPath } = hit;
  if (countShiftsOnTemplateRow(row) > 0) {
    return { linked: true, detail: row };
  }

  const patchBodies: Record<string, any>[] = [
    { shift_ids: ids },
    { shifts: ids },
    { schedule_shift_ids: ids },
    { scheduled_shift_ids: ids },
    { template_shift_ids: ids },
    { scheduled_shifts: ids },
    {
      template_shifts: ids.map((id) => ({
        shift: typeof id === 'number' ? id : normalizePkForApi(String(id)),
      })),
    },
  ];

  for (const body of patchBodies) {
    const w = scrubWrite(body);
    if (Object.keys(w).length === 0) continue;
    try {
      const patched = await apiClient.patch<any>(detailPath, w);
      if (patched && typeof patched === 'object' && countShiftsOnTemplateRow(patched)) {
        return { linked: true, detail: patched };
      }
    } catch (e: any) {
      const st = e instanceof HttpError ? e.status : e?.status;
      if (st === 400) continue;
      if (st === 404 || st === 405) break;
      throw e;
    }
  }

  try {
    const refreshed = await apiClient.get<any>(detailPath);
    if (refreshed && countShiftsOnTemplateRow(refreshed)) {
      return { linked: true, detail: refreshed };
    }
  } catch {
    /* ignore */
  }

  const root = detailPath.replace(/\/+$/, '');
  const postActions = [
    `${root}/set_shifts/`,
    `${root}/link_shifts/`,
    `${root}/link-shifts/`,
    `${root}/sync_shifts/`,
    `${root}/add_shifts/`,
  ];
  const postBodies: Record<string, any>[] = [
    scrubWrite({ shift_ids: ids }),
    scrubWrite({ shifts: ids }),
    scrubWrite({ shift_ids: ids.map((id) => normalizePkForApi(String(id))) }),
  ].filter((b) => Object.keys(b).length > 0);

  for (const actionPath of postActions) {
    for (const pb of postBodies) {
      try {
        const posted = await apiClient.post<any>(actionPath, pb);
        if (posted && typeof posted === 'object' && countShiftsOnTemplateRow(posted)) {
          return { linked: true, detail: posted };
        }
      } catch (e: any) {
        const st = e instanceof HttpError ? e.status : e?.status;
        if (st === 400) continue;
        if (st === 404) break;
        throw e;
      }
    }
  }

  try {
    const finalRow = await apiClient.get<any>(detailPath);
    return {
      linked: !!(finalRow && countShiftsOnTemplateRow(finalRow)),
      detail: finalRow ?? null,
    };
  } catch {
    const again = await getScheduleTemplateDetail(templateId, companyId, { ...templateRow, url: detailPath });
    return { linked: !!(again && countShiftsOnTemplateRow(again)), detail: again };
  }
}

/**
 * Creates a schedule template: one POST (numeric shift_ids + template_shifts), then at most one PATCH
 * if the server returns a template row with zero linked shifts.
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
  if (shiftIdsFromApi.length === 0) {
    throw new Error(
      'Cannot save template: shifts must be saved on the server first (no shift ids). Return to the schedule, ensure shifts load, then save again.'
    );
  }
  const shiftIdsNumeric = normalizeShiftPkList(shiftIdsFromApi);

  /**
   * DRF variance: M2M may be `shifts` or `shift_ids`; FKs may be `company` or `company_id` (never both).
   * Try several POST shapes, then shell-only, before PATCH linking.
   */
  const metaCompany = scrubWrite({
    company: cid,
    name: label,
    week_start: rsDate,
    week_end: reDate,
    ...(oid ? { organization: oid } : {}),
  });
  const metaCompanyId = scrubWrite({
    company_id: cid,
    name: label,
    week_start: rsDate,
    week_end: reDate,
    ...(oid ? { organization_id: oid } : {}),
  });
  const createAttempts: Record<string, any>[] = [
    { ...metaCompany, shifts: shiftIdsNumeric },
    { ...metaCompany, shift_ids: shiftIdsNumeric },
    { ...metaCompanyId, shifts: shiftIdsNumeric },
    { ...metaCompanyId, shift_ids: shiftIdsNumeric },
    metaCompany,
    metaCompanyId,
  ];

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

    let linkEndpointsSucceeded = false;
    if (count === 0 && shiftsIn.length > 0 && tid && shiftIdsFromApi.length > 0) {
      const { linked, detail } = await patchTemplateShiftsOnce(tid, shiftIdsFromApi, resolved, cid);
      linkEndpointsSucceeded = linked;
      if (linked && detail) {
        resolved = detail;
        count = countShiftsOnTemplateRow(detail);
        hasSignal = hasTemplateShiftSignal(detail);
      } else {
        const listRow = await getScheduleTemplateRowFromList(tid);
        if (listRow) {
          resolved = listRow;
          count = countShiftsOnTemplateRow(listRow);
          hasSignal = hasTemplateShiftSignal(listRow);
        }
      }
    }

    // Many backends store the link on Shift (`schedule_template` FK), not template M2M — template PATCH can 200 without linking.
    if (count === 0 && tid && shiftIdsFromApi.length > 0) {
      const fkOk = await linkShiftsToScheduleTemplateViaShiftFk(tid, shiftIdsFromApi);
      if (fkOk) {
        linkEndpointsSucceeded = true;
        const detailAfter = await getScheduleTemplateDetail(tid, cid, resolved);
        if (detailAfter) {
          resolved = detailAfter;
          count = countShiftsOnTemplateRow(detailAfter);
          hasSignal = hasTemplateShiftSignal(detailAfter);
        }
        if (count === 0) {
          const n = await countShiftsLinkedViaShiftListFilter(tid, shiftIdsFromApi);
          if (n > 0) {
            count = n;
            hasSignal = true;
            resolved = {
              ...resolved,
              shift_ids: shiftIdsFromApi,
              shift_count: n,
            };
          }
        }
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log('[schedule-template] finalize after shift FK', {
            templateId: tid,
            count,
            hasSignal,
          });
        }
      }
    }

    // Keep the template row even when server-side M2M/FK linking cannot be confirmed — deleting made it look like "template not created".
    if (count === 0 && shiftIdsFromApi.length > 0 && tid && !linkEndpointsSucceeded) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(
          '[schedule-template] Keeping template; shift link not confirmed on server',
          { templateId: tid, shiftCount: shiftIdsFromApi.length }
        );
      }
      resolved = {
        ...resolved,
        shift_ids: shiftIdsFromApi,
        shift_count: shiftIdsFromApi.length,
      };
      count = shiftIdsFromApi.length;
      hasSignal = true;
    }

    if (hasSignal && count === 0 && shiftsIn.length > 0 && tid) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[schedule-template] Odd template row: shift signal but zero count', { templateId: tid });
      }
    }

    return resolved;
  };

  let createdRaw: any;
  let lastCreateErr: unknown;
  for (const attempt of createAttempts) {
    const body = scrubWrite(attempt);
    if (Object.keys(body).length === 0) continue;
    try {
      createdRaw = await createScheduleTemplate(body);
      lastCreateErr = undefined;
      break;
    } catch (e: unknown) {
      lastCreateErr = e;
      const st = e instanceof HttpError ? e.status : (e as any)?.status;
      if (st === 400) continue;
      throw e;
    }
  }
  if (createdRaw === undefined) {
    throw lastCreateErr instanceof Error
      ? lastCreateErr
      : new HttpError('Could not create schedule template', 400, { lastError: String(lastCreateErr ?? '') });
  }

  return await finalizeTemplate(createdRaw);
}

export async function updateScheduleTemplate(id: string, data: Record<string, any>) {
  const cid = String(data.company ?? data.company_id ?? '').trim() || null;
  const path = pickScheduleTemplateDetailPatchPath(id, undefined, cid);
  return await apiClient.patch<any>(path, data);
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


function scheduleTemplateDeleteUrls(
  id: string,
  deleteEndpoint?: string | null,
  companyId?: string | null
): string[] {
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

  const cid = companyId != null ? String(companyId).trim() : '';
  const cenc = cid ? encodeURIComponent(cid) : '';
  if (cenc) {
    add(`/scheduler/companies/${cenc}/schedule-templates/${enc}`);
    add(`/scheduler/companies/${cenc}/schedule_templates/${enc}`);
    add(`/scheduler/companies/${cenc}/week-templates/${enc}`);
    add(`/scheduler/companies/${cenc}/week_templates/${enc}`);
    add(`/scheduler/companies/${cenc}/saved-schedule-templates/${enc}`);
    add(`/scheduler/company/${cenc}/schedule-templates/${enc}`);
  }

  for (const p of SCHEDULE_TEMPLATE_PATH_PREFIXES) {
    const base = String(p || '').replace(/\/+$/, '');
    if (base) add(`${base}/${enc}`);
  }

  return out;
}

/**
 * DELETE one schedule template. Tries hyperlink + preferred list base + company-scoped + known routers.
 * `companyId` enables `/scheduler/companies/<company>/…/<id>/` fallbacks when the flat router 404s.
 */
export async function deleteScheduleTemplate(
  id: string,
  companyId?: string | null,
  deleteEndpoint?: string
) {
  const raw = String(id || '').trim();
  if (!raw) throw new Error('Template id is required');

  const urls = scheduleTemplateDeleteUrls(raw, deleteEndpoint, companyId);
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
