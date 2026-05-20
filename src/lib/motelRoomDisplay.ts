import type { MotelRoomRow } from '../api';
import * as api from '../api';

export type EmployeeRoomCleaningUiStatus = 'ready_to_clean' | 'pending_approval' | 'completed' | 'approved' | 'other';

export type EmployeeRoomBadge = {
  status: EmployeeRoomCleaningUiStatus;
  label: string;
  bg: string;
  text: string;
};

/** Grid tile background — aligned with web Rooms page legend. */
export function getEmployeeRoomTileColor(room: MotelRoomRow): string {
  const rs = String((room as any).status ?? '').toLowerCase();
  if (rs === 'available') return '#86EFAC';
  const cleaning = String((room as any).cleaning_status ?? '').toLowerCase();
  if ((room as any).approved === true && rs !== 'available') return '#BFDBFE';
  if ((room as any).cleaning_completed === true) return '#DDD6FE';
  if (cleaning === 'pending_approval' || cleaning === 'awaiting_approval' || cleaning === 'submitted') {
    return '#DDD6FE';
  }
  if (cleaning === 'approved') return '#5EEAD4';
  if (cleaning === 'pending' || rs === 'vacated') return '#86EFAC';
  if (rs === 'booked' || (room as any).is_occupied === true) return '#FCA5A5';
  return '#86EFAC';
}

/** Human-readable status for modal (web: "Available", "Pending Approval", …). */
export function getEmployeeRoomStatusLabel(room: MotelRoomRow): string {
  const rs = String((room as any).status ?? '').trim().toLowerCase();
  if (rs === 'available') return 'Available';
  if ((room as any).approved === true) return 'Approved';
  if ((room as any).cleaning_completed === true) return 'Pending Approval';
  const cs = String((room as any).cleaning_status ?? '').trim().toLowerCase();
  if (cs === 'pending_approval' || cs === 'awaiting_approval' || cs === 'submitted') return 'Pending Approval';
  if (cs === 'approved') return 'Completed';
  if (rs === 'vacated') return 'Available';
  if (rs === 'booked' || (room as any).is_occupied === true) return 'Occupied';
  if (rs) return rs.charAt(0).toUpperCase() + rs.slice(1).replace(/_/g, ' ');
  return 'Available';
}

export function motelRoomFloorLabel(room: MotelRoomRow): string {
  const f = motelRoomFloor(room);
  if (!f || f === '—' || f === 'Other') return 'Other';
  return `Floor ${f}`;
}

export function motelRoomUuid(room: MotelRoomRow): string {
  return api.pickMotelRoomUuidId(room as any);
}

export function motelRoomNumber(room: MotelRoomRow): string {
  const n =
    (room as any).room_number ??
    room.number ??
    room.name ??
    (room.id != null ? String(room.id) : '');
  return String(n || '—');
}

export function motelRoomType(room: MotelRoomRow): string {
  const t =
    (room as any).room_type ??
    (room as any).type ??
    (room as any).roomType ??
    (room as any).category;
  return t != null && String(t).trim() !== '' ? String(t).trim() : '—';
}

export function motelRoomFloor(room: MotelRoomRow): string {
  const anyRoom = room as any;
  const f =
    anyRoom.floor ??
    anyRoom.floor_number ??
    anyRoom.floor_id ??
    anyRoom.floor_no ??
    anyRoom.floorNo ??
    anyRoom.floorNumber ??
    anyRoom.floor_level ??
    anyRoom.level;
  if (f != null && typeof f === 'object' && !Array.isArray(f)) {
    const o = f as Record<string, unknown>;
    const nested = o.number ?? o.floor_number ?? o.name ?? o.label ?? o.id;
    if (nested != null && String(nested).trim() !== '') return String(nested).trim();
  }
  if (f != null && String(f).trim() !== '') return String(f).trim();
  return '—';
}

/** Employee cleaning workflow badge (maps existing `/motel/rooms/` fields). */
export function getEmployeeRoomCleaningBadge(room: MotelRoomRow): EmployeeRoomBadge {
  const label = getEmployeeRoomStatusLabel(room);
  const tile = getEmployeeRoomTileColor(room);
  if ((room as any).approved === true) {
    return { status: 'approved', label, bg: '#BFDBFE', text: '#1E3A8A' };
  }
  if ((room as any).cleaning_completed === true) {
    return { status: 'pending_approval', label: 'Pending Approval', bg: '#DDD6FE', text: '#5B21B6' };
  }
  const cs = String((room as any).cleaning_status ?? '').trim().toLowerCase();
  if (cs === 'pending_approval' || cs === 'awaiting_approval' || cs === 'submitted') {
    return { status: 'pending_approval', label: 'Pending Approval', bg: '#DDD6FE', text: '#5B21B6' };
  }
  if (cs === 'approved') {
    return { status: 'completed', label: 'Completed', bg: '#5EEAD4', text: '#115E59' };
  }
  const rs = String((room as any).status ?? '').trim().toLowerCase();
  if (cs === 'pending' || rs === 'vacated' || rs === 'available') {
    return { status: 'ready_to_clean', label: 'Available', bg: '#86EFAC', text: '#166534' };
  }
  return { status: 'other', label, bg: tile, text: '#334155' };
}

export function canEmployeeStartCleaning(room: MotelRoomRow, activeSessionRoomId: string | null): boolean {
  const id = motelRoomUuid(room);
  if (!id) return false;
  if (activeSessionRoomId && activeSessionRoomId !== id) return false;

  const rs = String((room as any).status ?? '').trim().toLowerCase();
  const cs = String((room as any).cleaning_status ?? '').trim().toLowerCase();

  // Submitted work awaiting admin — do not start a parallel session.
  if (
    ((room as any).cleaning_completed === true && (room as any).approved !== true) ||
    cs === 'pending_approval' ||
    cs === 'awaiting_approval' ||
    cs === 'submitted'
  ) {
    return false;
  }

  // Approved / completed — allow a new cleaning session (re-clean).
  if ((room as any).approved === true || cs === 'approved') return true;

  const canClean = rs === 'available' || rs === 'vacated' || cs === 'pending';
  return canClean;
}

/** HH:MM:SS for cleaning timer display. */
export function formatCleaningTimerHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function patchRoomAfterCleaningSubmit(room: MotelRoomRow): MotelRoomRow {
  return {
    ...room,
    cleaning_completed: true,
    cleaning_status: 'pending_approval',
    approved: false,
  } as MotelRoomRow;
}

export function sanitizeMotelRoomLoadError(err: unknown): string | null {
  const msg = String(
    (err as any)?.message ?? (err as any)?.detail ?? (err instanceof Error ? err.message : '') ?? ''
  ).trim();
  if (!msg) return null;
  const low = msg.toLowerCase();
  if (low.includes('super admin') && low.includes('manager')) return null;
  if (low.includes('motel room management')) return null;
  if (low.includes('organization/company managers')) return null;
  return msg;
}

export function sortFloorKeys(keys: string[]): string[] {
  const other = keys.filter((k) => k === 'Other');
  const rest = keys.filter((k) => k !== 'Other').sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [...rest, ...other];
}
