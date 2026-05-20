import { fetchEmployeeTasksPage, type TasksPageFetchOpts } from './tasksPageFetch';

/** One or two calendar list calls for the signed-in employee — no template catalog rows. */
export async function fetchEmployeeTaskEventsInRange(opts: {
  rangeStart: Date;
  rangeEnd: Date;
  userId: string;
}): Promise<any[]> {
  const uid = String(opts.userId).trim();
  if (!uid) return [];

  return fetchEmployeeTasksPage({
    rangeStart: opts.rangeStart,
    rangeEnd: opts.rangeEnd,
    role: 'employee',
    userId: uid,
    canViewAllMembers: false,
  });
}

export type { TasksPageFetchOpts };
