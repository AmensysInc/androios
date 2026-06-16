import type { TFunction } from 'i18next';
import {
  classifyTaskType,
  taskWorkflowStatus,
  type TaskWorkflowType,
} from './tasksWorkflow';

export type TaskPriorityId = 'low' | 'medium' | 'high' | 'critical';

export function priorityLabel(t: TFunction, priority: string | null | undefined): string {
  const p = String(priority || 'medium').toLowerCase();
  const key = `tasks.priority.${p}`;
  const translated = t(key);
  return translated === key ? String(priority || t('tasks.priority.medium')) : translated;
}

export function priorityOptions(t: TFunction, includeAll = false): { id: string; label: string }[] {
  const opts = [
    { id: 'low', label: priorityLabel(t, 'low') },
    { id: 'medium', label: priorityLabel(t, 'medium') },
    { id: 'high', label: priorityLabel(t, 'high') },
    { id: 'critical', label: priorityLabel(t, 'critical') },
  ];
  if (!includeAll) return opts;
  return [{ id: 'all', label: t('tasks.filters.allPriorities') }, ...opts];
}

export function statusFilterOptions(t: TFunction): { id: string; label: string }[] {
  return [
    { id: 'pending', label: t('tasks.status.pending') },
    { id: 'in_progress', label: t('tasks.status.inProgress') },
    { id: 'completed', label: t('tasks.status.completed') },
    { id: 'all', label: t('tasks.filters.allStatuses') },
  ];
}

export function dateFilterOptions(t: TFunction): { id: string; label: string }[] {
  return [
    { id: 'today', label: t('tasks.filters.today') },
    { id: 'week', label: t('tasks.filters.thisWeek') },
    { id: 'month', label: t('tasks.filters.thisMonth') },
    { id: 'all', label: t('tasks.filters.allDates') },
  ];
}

export function localizedWorkflowStatus(t: TFunction, status: string): string {
  const s = status.toLowerCase();
  const key = `tasks.status.${s === 'in_progress' ? 'inProgress' : s}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function localizedTaskStatusForItem(t: TFunction, task: any): string {
  return localizedWorkflowStatus(t, taskWorkflowStatus(task));
}

export function localizedTaskType(t: TFunction, task: any): string {
  const k = classifyTaskType(task) as TaskWorkflowType;
  const key = `tasks.type.${k === 'checklist_template' ? 'checklistTemplate' : k === 'checklist_assigned' ? 'checklistAssigned' : 'manual'}`;
  return t(key);
}

export function localizedReviewStatus(t: TFunction, raw: string | null | undefined): string {
  const s = String(raw || 'pending')
    .toLowerCase()
    .replace(/\s+/g, '_');
  const map: Record<string, string> = {
    pending: 'tasks.review.pendingReview',
    pending_review: 'tasks.review.pendingReview',
    approved: 'tasks.review.approved',
    rejected: 'tasks.review.rejected',
    needs_rework: 'tasks.review.needsRework',
  };
  const key = map[s];
  return key ? t(key) : String(raw || t('tasks.review.pendingReview'));
}

export function assignmentStatusLabel(t: TFunction, assigned: boolean, selfAssigned = false): string {
  if (selfAssigned) return t('tasks.assignment.selfAssigned');
  if (assigned) return t('tasks.assignment.assigned');
  return t('tasks.assignment.unassigned');
}

export function checklistProgressStatus(t: TFunction, status: string): string {
  const s = status.toLowerCase().replace(/\s+/g, '_');
  if (s === 'completed') return t('tasks.checklistStatus.completed');
  if (s === 'in_progress') return t('tasks.checklistStatus.inProgress');
  return t('tasks.checklistStatus.notStarted');
}
