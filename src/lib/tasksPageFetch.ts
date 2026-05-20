/**
 * Tasks page fetch — one load per refresh (web parity). Filter dropdowns do not call these APIs.
 */

import * as api from '../api';
import {
  buildTaskTreeFromFlatEvents,
  enrichCalendarEventScopeFromCatalog,
  normalizeCalendarTaskEvent,
  shouldDisplayTaskOnTasksPage,
  sortTasksForDisplay,
  type ScopeCatalogEntry,
} from './tasksPageWorkflow';
import { dedupeTasks, mergeWorkAndCalendarTaskLists } from './tasksWorkflow';

const TASKS_PAGE_SIZE = '500';

export type FetchTasksForTasksPageOpts = {
  role: string | null;
  userId: string;
  canViewAllMembers: boolean;
  organizations: ScopeCatalogEntry[];
  companies: ScopeCatalogEntry[];
};

function processFetchedRows(
  rows: any[],
  opts: FetchTasksForTasksPageOpts
): any[] {
  const uid = opts.canViewAllMembers ? undefined : String(opts.userId).trim();
  let out = rows.filter(Boolean).map(normalizeCalendarTaskEvent);
  out = enrichCalendarEventScopeFromCatalog(out, opts.organizations, opts.companies);
  out = out.filter((t) => shouldDisplayTaskOnTasksPage(t, { employeeUserId: uid }));
  out = dedupeTasks(out);
  out = buildTaskTreeFromFlatEvents(out);
  out = sortTasksForDisplay(out);
  return out;
}

async function fetchCalendarTasksRobust(): Promise<any[]> {
  const params = { event_type: 'task', page_size: TASKS_PAGE_SIZE };
  try {
    const res = await api.getCalendarEvents(params);
    if (Array.isArray(res) && res.length > 0) return res;
  } catch {
    /* try broader */
  }
  try {
    const res = await api.getCalendarEvents({ page_size: TASKS_PAGE_SIZE });
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

/**
 * Parallel GET /tasks/ + GET /calendar/events/?event_type=task (page_size=500).
 * Uses first non-empty source; if both empty, broader calendar fallback. No filter query params.
 */
export async function fetchTasksForTasksPage(opts: FetchTasksForTasksPageOpts): Promise<any[]> {
  const listParams = { page_size: TASKS_PAGE_SIZE };
  const calParams = { event_type: 'task', page_size: TASKS_PAGE_SIZE };

  const [workSettled, calSettled] = await Promise.allSettled([
    api.getWorkTasks(listParams),
    api.getCalendarEvents(calParams),
  ]);

  const work = workSettled.status === 'fulfilled' ? workSettled.value : [];
  const cal = calSettled.status === 'fulfilled' ? calSettled.value : [];

  let raw = mergeWorkAndCalendarTaskLists(work, cal);
  if (raw.length === 0) {
    const fallbackCal = await fetchCalendarTasksRobust();
    let fallbackWork: any[] = [];
    if (workSettled.status !== 'fulfilled') {
      try {
        fallbackWork = await api.getWorkTasks(listParams);
      } catch {
        fallbackWork = [];
      }
    }
    raw = mergeWorkAndCalendarTaskLists(
      work.length > 0 ? work : fallbackWork,
      cal.length > 0 ? cal : fallbackCal
    );
  }

  if (raw.length === 0) {
    return [];
  }

  return processFetchedRows(raw, opts);
}

/** @deprecated Use fetchTasksForTasksPage — kept for callers during migration. */
export async function fetchTasksPage(opts: {
  rangeStart: Date;
  rangeEnd: Date;
  role: string | null;
  userId: string;
  canViewAllMembers: boolean;
  filterOrganizationId?: string;
  filterCompanyId?: string;
  filterMemberId?: string;
  useServerDateFilter?: boolean;
  skipClientDateFilter?: boolean;
  organizations?: ScopeCatalogEntry[];
  companies?: ScopeCatalogEntry[];
}): Promise<any[]> {
  return fetchTasksForTasksPage({
    role: opts.role,
    userId: opts.userId,
    canViewAllMembers: opts.canViewAllMembers,
    organizations: opts.organizations ?? [],
    companies: opts.companies ?? [],
  });
}
