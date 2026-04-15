import AsyncStorage from '@react-native-async-storage/async-storage';

const LEAVE_KEY = '@scheduler_pending_leave_requests_v1';
const SWAP_KEY = '@scheduler_pending_swap_requests_v1';
const MAX = 100;

async function readJson(key: string): Promise<any[]> {
  try {
    const s = await AsyncStorage.getItem(key);
    if (!s) return [];
    const p = JSON.parse(s);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

async function writeJson(key: string, list: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* ignore */
  }
}

export function isLocalPendingId(id: unknown): boolean {
  return String(id ?? '').startsWith('local-');
}

export async function getPendingLocalLeaveRequests(): Promise<any[]> {
  return readJson(LEAVE_KEY);
}

export async function addPendingLocalLeaveRequest(row: any): Promise<void> {
  const list = await readJson(LEAVE_KEY);
  list.unshift(row);
  await writeJson(LEAVE_KEY, list);
}

export async function removePendingLocalLeaveRequest(id: string): Promise<void> {
  const list = await readJson(LEAVE_KEY);
  await writeJson(
    LEAVE_KEY,
    list.filter((x) => String(x?.id ?? '') !== String(id))
  );
}

export async function getPendingLocalSwapRequests(): Promise<any[]> {
  return readJson(SWAP_KEY);
}

export async function addPendingLocalSwapRequest(row: any): Promise<void> {
  const list = await readJson(SWAP_KEY);
  list.unshift(row);
  await writeJson(SWAP_KEY, list);
}

export async function removePendingLocalSwapRequest(id: string): Promise<void> {
  const list = await readJson(SWAP_KEY);
  await writeJson(
    SWAP_KEY,
    list.filter((x) => String(x?.id ?? '') !== String(id))
  );
}
