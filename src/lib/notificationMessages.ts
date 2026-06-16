import type { TFunction } from 'i18next';

export type NotificationMessageKey =
  | 'shiftAssigned'
  | 'shiftUpdated'
  | 'requestApproved'
  | 'requestRejected'
  | 'newTaskAssigned'
  | 'newSchedulePublished'
  | 'overtimeApproved'
  | 'leaveApproved'
  | 'leaveRejected'
  | 'taskUpdated'
  | 'taskCompleted'
  | 'taskApproved'
  | 'taskRejected'
  | 'checklistAssigned';

export function notificationMessage(t: TFunction, key: NotificationMessageKey): string {
  return t(`notifications.${key}`);
}

export function notificationTitle(t: TFunction): string {
  return t('notifications.title');
}

export function markAsReadLabel(t: TFunction): string {
  return t('notifications.markAsRead');
}

export function newNotificationLabel(t: TFunction): string {
  return t('notifications.newNotification');
}
