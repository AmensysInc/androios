type Entry = { at: number; value: unknown };

const store = new Map<string, Entry>();

export async function cachedRequest<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    return hit.value as T;
  }
  const value = await fetcher();
  store.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateRequestCache(key?: string): void {
  if (!key) {
    store.clear();
    return;
  }
  store.delete(key);
}

export function invalidateRequestCachePrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
