const TTL_MS = 5 * 60 * 1000;

type Entry<T> = { value: T; at: number };

let employeeByUserKey: Entry<any | null> | null = null;

function userCacheKey(user?: { id?: string | null; email?: string | null } | null): string {
  const id = String(user?.id ?? '').trim();
  const email = String(user?.email ?? '').trim().toLowerCase();
  return `${id}|${email}`;
}

export function getCachedSchedulerEmployeeForUser(
  user?: { id?: string | null; email?: string | null } | null
): any | null | undefined {
  const key = userCacheKey(user);
  if (!key || key === '|') return undefined;
  if (!employeeByUserKey || Date.now() - employeeByUserKey.at > TTL_MS) return undefined;
  if ((employeeByUserKey as any)._key !== key) return undefined;
  return employeeByUserKey.value;
}

export function setCachedSchedulerEmployeeForUser(
  user: { id?: string | null; email?: string | null } | null | undefined,
  emp: any | null
): void {
  const key = userCacheKey(user);
  if (!key || key === '|') return;
  employeeByUserKey = { value: emp, at: Date.now() };
  (employeeByUserKey as any)._key = key;
}

export function clearSchedulerEmployeeCache(): void {
  employeeByUserKey = null;
}
