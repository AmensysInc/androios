import type { TFunction } from 'i18next';
import type { MotelRoomRow } from '../api';
import type { MotelCleaningPhotoStepKey } from './motelCleaningPhotoSteps';
import { getEmployeeRoomStatusLabel, getEmployeeRoomCleaningBadge } from './motelRoomDisplay';

const PHOTO_KEY_MAP: Record<MotelCleaningPhotoStepKey, string> = {
  door: 'housekeeping.photos.door',
  bathroom: 'housekeeping.photos.bathroom',
  bed: 'housekeeping.photos.bed',
  tables: 'housekeeping.photos.table',
  whole_room: 'housekeeping.photos.wholeRoom',
};

export function localizedPhotoStepLabel(t: TFunction, key: MotelCleaningPhotoStepKey): string {
  return t(PHOTO_KEY_MAP[key]);
}

/** UI-only status labels — does not change room business logic. */
export function localizedEmployeeRoomStatus(t: TFunction, room: MotelRoomRow): string {
  const rs = String((room as any).status ?? '').toLowerCase();
  if (rs === 'available') return t('housekeeping.roomStatus.available');
  if ((room as any).approved === true) return t('housekeeping.workflow.approved');
  if ((room as any).cleaning_completed === true) return t('housekeeping.inspection.pendingInspection');
  const cs = String((room as any).cleaning_status ?? '').toLowerCase();
  if (cs === 'pending_approval' || cs === 'awaiting_approval' || cs === 'submitted') {
    return t('housekeeping.inspection.pendingInspection');
  }
  if (cs === 'approved') return t('housekeeping.workflow.completed');
  if (rs === 'vacated') return t('housekeeping.roomStatus.available');
  if (rs === 'booked' || (room as any).is_occupied === true) return t('housekeeping.roomStatus.occupied');
  if (rs === 'dirty') return t('housekeeping.roomStatus.dirty');
  if (rs === 'clean') return t('housekeeping.roomStatus.clean');
  if (rs === 'inspected') return t('housekeeping.roomStatus.inspected');
  if (rs === 'out_of_service') return t('housekeeping.roomStatus.outOfService');
  return t('housekeeping.roomStatus.available');
}

export function localizedCleaningBadgeLabel(t: TFunction, room: MotelRoomRow): string {
  const badge = getEmployeeRoomCleaningBadge(room);
  const raw = badge.label;
  const map: Record<string, string> = {
    'Pending Approval': 'housekeeping.inspection.pendingInspection',
    'Approved': 'housekeeping.workflow.approved',
    'Completed': 'housekeeping.workflow.completed',
    'Available': 'housekeeping.roomStatus.available',
  };
  const key = map[raw];
  return key ? t(key) : localizedEmployeeRoomStatus(t, room);
}

export function localizedFloorLabel(t: TFunction, floor: string): string {
  if (!floor || floor === '—' || floor === 'Other') return t('housekeeping.otherFloor');
  return t('housekeeping.floor', { floor });
}

export function localizedAdminStatus(t: TFunction, raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '_');
  const key = `housekeeping.adminStatus.${s}`;
  const translated = t(key);
  return translated === key ? raw : translated;
}

export function localizedCleaningSubStatus(t: TFunction, room: MotelRoomRow): string {
  const rs = String((room as any).status ?? '').trim().toLowerCase();
  if (rs === 'available') return '';
  const s = String((room as any).cleaning_status ?? '').trim().toLowerCase();
  if (s === 'pending') return t('housekeeping.roomStatus.needsCleaning');
  return '';
}

/** Fallback when mapping English label from legacy helper. */
export function localizedStatusFromEnglish(t: TFunction, label: string): string {
  const map: Record<string, string> = {
    Available: 'housekeeping.roomStatus.available',
    'Pending Approval': 'housekeeping.inspection.pendingInspection',
    Approved: 'housekeeping.workflow.approved',
    Completed: 'housekeeping.workflow.completed',
    Occupied: 'housekeeping.roomStatus.occupied',
  };
  const key = map[label];
  return key ? t(key) : label;
}

export function legacyStatusLabelForCompare(room: MotelRoomRow): string {
  return getEmployeeRoomStatusLabel(room);
}
