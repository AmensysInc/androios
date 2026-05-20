import { useCallback, useState } from 'react';
import type { MotelRoomRow } from '../api';
import * as api from '../api';
import { sanitizeMotelRoomLoadError } from '../lib/motelRoomDisplay';

function roomCompanyId(r: MotelRoomRow): string {
  const anyR = r as any;
  const c = anyR.company_id ?? anyR.company;
  if (c != null && typeof c === 'object' && (c as any).id != null) return String((c as any).id).trim();
  return c != null && c !== '' ? String(c).trim() : '';
}

function naturalRoomMergeKey(r: MotelRoomRow): string {
  const num =
    (r as any).room_number ?? r.number ?? r.name ?? (r.id != null ? String(r.id) : '');
  const f =
    (r as any).floor ??
    (r as any).floor_number ??
    (r as any).floor_id ??
    'Other';
  const floor = f != null && typeof f === 'object' ? String((f as any).number ?? (f as any).id ?? 'Other') : String(f);
  return `${roomCompanyId(r) || '—'}\u0000${floor}\u0000${String(num || '—')}`;
}

function preferRoomRowWithUuid(a: MotelRoomRow, b: MotelRoomRow): MotelRoomRow {
  const au = api.pickMotelRoomUuidId(a as any);
  const bu = api.pickMotelRoomUuidId(b as any);
  if (bu && !au) return b;
  return a;
}

function dedupeRooms(rows: MotelRoomRow[]): MotelRoomRow[] {
  const byNatural = new Map<string, MotelRoomRow>();
  for (const r of rows) {
    const nk = naturalRoomMergeKey(r);
    const prev = byNatural.get(nk);
    if (!prev) byNatural.set(nk, r);
    else byNatural.set(nk, preferRoomRowWithUuid(prev, r));
  }
  const seenUuid = new Set<string>();
  const out: MotelRoomRow[] = [];
  for (const r of byNatural.values()) {
    const uid = api.pickMotelRoomUuidId(r as any);
    if (!uid || seenUuid.has(uid)) continue;
    seenUuid.add(uid);
    out.push(r);
  }
  return out;
}

async function fetchRoomsOnce(params?: Record<string, string>): Promise<MotelRoomRow[]> {
  try {
    const list = await api.getMotelRooms(params);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function useEmployeeMotelRooms(user: unknown) {
  const [rooms, setRooms] = useState<MotelRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = (user as any)?.id != null ? String((user as any).id) : '';
  const userCompanyHint = (user as any)?.company_id != null ? String((user as any).company_id) : '';

  const loadRooms = useCallback(async () => {
    setError(null);
    const u = user as any;
    let lastErr: unknown = null;

    const companyIds: string[] = [];
    const pushCid = (raw: unknown) => {
      const s = String(raw ?? '').trim();
      if (s && !companyIds.includes(s)) companyIds.push(s);
    };
    for (const h of api.companyIdHintsFromAuthUser(u)) pushCid(h);
    pushCid(u?.company_id);
    pushCid(u?.assigned_company);

    try {
      const emp = await api.resolveEmployeeForUser(u);
      pushCid(api.companyIdFromSchedulerEmployee(emp, u));
    } catch {
      /* ignore */
    }

    let merged: MotelRoomRow[] = [];

    try {
      const scoped = await fetchRoomsOnce();
      if (scoped.length > 0) merged = dedupeRooms(scoped);
    } catch (e: unknown) {
      lastErr = e;
    }

    if (merged.length === 0) {
      for (const cid of companyIds) {
        const rows = await fetchRoomsOnce({ company: cid });
        if (rows.length > 0) {
          merged = dedupeRooms(rows);
          break;
        }
      }
    }

    if (merged.length > 0) {
      setRooms(merged);
      setError(null);
      return;
    }

    setRooms([]);
    setError(sanitizeMotelRoomLoadError(lastErr));
  }, [userId, userCompanyHint]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRooms();
    } finally {
      setRefreshing(false);
    }
  }, [loadRooms]);

  const patchRoom = useCallback((roomId: string, patch: Partial<MotelRoomRow>) => {
    setRooms((prev) =>
      prev.map((r) => (api.pickMotelRoomUuidId(r as any) === roomId ? ({ ...r, ...patch } as MotelRoomRow) : r))
    );
  }, []);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    try {
      await loadRooms();
    } finally {
      setLoading(false);
    }
  }, [loadRooms]);

  return {
    rooms,
    setRooms,
    loading,
    refreshing,
    error,
    loadRooms,
    refresh,
    patchRoom,
    initialLoad,
  };
}
