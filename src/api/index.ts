/**
 * Central API – same endpoints as web (Zenotimeflow-frontend).
 * All paths and params match the backend used by the web app.
 */
import apiClient from '../lib/api-client';

function ensureArray<T>(raw: T | T[] | null | undefined): T[] {
  if (raw == null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

// —— Auth / users ——
export async function getCurrentUser() {
  return apiClient.get<any>('/auth/user/');
}
export async function getUsers(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/auth/users/', params);
  return ensureArray(raw);
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
  return ensureArray(raw);
}
export async function createCalendarEvent(data: any) {
  return apiClient.post<any>('/calendar/events/', data);
}
export async function updateCalendarEvent(id: string, data: any) {
  return apiClient.patch<any>(`/calendar/events/${id}/`, data);
}
export async function deleteCalendarEvent(id: string) {
  return apiClient.delete(`/calendar/events/${id}/`);
}

// —— Scheduler: organizations ——
export async function getOrganizations(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/organizations/', params);
  return ensureArray(raw);
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
export async function getCompanies(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/companies/', params);
  return ensureArray(raw);
}
export async function getCompany(id: string) {
  return apiClient.get<any>(`/scheduler/companies/${id}/`);
}
export async function createCompany(data: any) {
  return apiClient.post<any>('/scheduler/companies/', data);
}
export async function updateCompany(id: string, data: any) {
  return apiClient.patch<any>(`/scheduler/companies/${id}/`, data);
}
export async function deleteCompany(id: string) {
  return apiClient.delete(`/scheduler/companies/${id}/`);
}

// —— Scheduler: departments ——
export async function getDepartments(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/departments/', params);
  return ensureArray(raw);
}

// —— Scheduler: employees ——
export async function getEmployees(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/scheduler/employees/', params);
  return ensureArray(raw);
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
  return ensureArray(raw);
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
  return ensureArray(raw);
}
export async function getUnscheduledClockRequests() {
  const raw = await apiClient.get<any>('/scheduler/time-clock/unscheduled-requests/');
  return ensureArray(raw);
}
export async function clockIn(data: { employee_id: string; shift_id?: string; notes?: string }) {
  return apiClient.post<any>('/scheduler/time-clock/clock_in/', data);
}
export async function clockOut(data: { time_clock_entry_id: string; notes?: string }) {
  return apiClient.post<any>('/scheduler/time-clock/clock_out/', data);
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
  return ensureArray(raw);
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
  return ensureArray(raw);
}

// —— Templates (check lists / learning) ——
export async function getTemplates(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/templates/', params);
  return ensureArray(raw);
}
export async function createTemplate(data: any) {
  return apiClient.post<any>('/templates/', data);
}
export async function updateTemplate(id: string, data: any) {
  return apiClient.patch<any>(`/templates/${id}/`, data);
}
export async function deleteTemplate(id: string) {
  return apiClient.delete(`/templates/${id}/`);
}
export async function getTemplateAssignments(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/templates/assignments/', params);
  return ensureArray(raw);
}
export async function assignTemplate(templateId: string, userId: string) {
  return apiClient.post<any>('/templates/assignments/', { template_id: templateId, user_id: userId });
}
export async function unassignTemplate(templateId: string, userId: string) {
  return apiClient.delete('/templates/assignments/', { template_id: templateId, user_id: userId });
}

// —— Focus ——
export async function getFocusSessions(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/focus/sessions/', params);
  return ensureArray(raw);
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

// —— Habits ——
export async function getHabits(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/habits/habits/', params);
  return ensureArray(raw);
}
export async function createHabit(data: any) {
  return apiClient.post<any>('/habits/habits/', data);
}
export async function updateHabit(id: string, data: any) {
  return apiClient.patch<any>(`/habits/habits/${id}/`, data);
}
export async function deleteHabit(id: string) {
  return apiClient.delete(`/habits/habits/${id}/`);
}
export async function getHabitCompletions(params?: Record<string, any>) {
  const raw = await apiClient.get<any>('/habits/completions/', params);
  return ensureArray(raw);
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
