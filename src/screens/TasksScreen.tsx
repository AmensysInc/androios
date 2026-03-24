import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  Switch,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import { HttpError } from '../lib/api-client';


type PickerOption = { id: string; label: string };

type PickerModalProps = {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

function PickerModal({ visible, title, options, selectedId, onSelect, onClose }: PickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={modalStyles.box}>
          <Text style={modalStyles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={modalStyles.row}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={modalStyles.rowText}>{item.label}</Text>
                {selectedId === item.id ? (
                  <MaterialCommunityIcons name="check" size={22} color="#2563eb" />
                ) : (
                  <View style={{ width: 22 }} />
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
    zIndex: 2000,
    elevation: 2000,
  },
  box: {
    backgroundColor: '#fff',
    borderRadius: 14,
    maxHeight: '70%',
    paddingVertical: 8,
    zIndex: 2001,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#0f172a', paddingHorizontal: 16, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rowText: { flex: 1, fontSize: 16, color: '#0f172a', marginRight: 8 },
});

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getDateRangeForPreset(preset: string): { start: Date; end: Date } {
  const now = new Date();
  if (preset === 'today') {
    const s = new Date(now);
    s.setHours(0, 0, 0, 0);
    const e = new Date(now);
    e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (preset === 'week') {
    const s = startOfWeekMonday(now);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (preset === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    s.setHours(0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: s, end: e };
  }
  const s = new Date(now);
  s.setFullYear(s.getFullYear() - 1);
  s.setHours(0, 0, 0, 0);
  const e = new Date(now);
  e.setFullYear(e.getFullYear() + 1);
  e.setHours(23, 59, 59, 999);
  return { start: s, end: e };
}

/** Stable id for calendar event rows (delete / patch / list keys). */
function eventId(ev: any): string {
  const id = ev?.id ?? ev?.pk ?? ev?.uuid;
  if (id == null || id === '') return '';
  return String(id);
}

function taskUserId(t: any): string {
  const userLike =
    t?.user_id ??
    t?.assigned_user_id ??
    t?.assignee_id ??
    t?.owner_id ??
    (typeof t?.user === 'object' ? t?.user?.id : t?.user) ??
    (typeof t?.assigned_user === 'object' ? t?.assigned_user?.id : t?.assigned_user) ??
    (typeof t?.assignee === 'object' ? t?.assignee?.id : t?.assignee) ??
    (typeof t?.owner === 'object' ? t?.owner?.id : t?.owner);
  return userLike == null ? '' : String(userLike);
}

/** Display name from task payload only (no email — email is resolved via member directory). */
function taskAssignedNameOnly(t: any): string {
  const candidates = [
    t?.assigned_user?.full_name,
    t?.assigned_user?.name,
    t?.assignee?.full_name,
    t?.assignee?.name,
    t?.user?.full_name,
    t?.user?.name,
    t?.owner?.full_name,
    t?.owner?.name,
    t?.assigned_user_name,
    t?.assignee_name,
    t?.user_name,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function taskAssigneeEmails(t: any): string[] {
  const raw: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.includes('@')) raw.push(v.trim().toLowerCase());
  };
  push(t?.assigned_user_email);
  push(t?.assignee_email);
  push(t?.user_email);
  push(t?.owner_email);
  push(typeof t?.assigned_user === 'string' ? t.assigned_user : undefined);
  push(typeof t?.assignee === 'string' ? t.assignee : undefined);
  push(typeof t?.user === 'string' ? t.user : undefined);
  if (typeof t?.assigned_user === 'object') push(t?.assigned_user?.email);
  if (typeof t?.assignee === 'object') push(t?.assignee?.email);
  if (typeof t?.user === 'object') push(t?.user?.email);
  if (typeof t?.owner === 'object') push(t?.owner?.email);
  return [...new Set(raw)];
}

function taskPriority(t: any): string {
  const p = String(t.priority ?? '').toLowerCase();
  if (['high', 'urgent'].includes(p)) return 'high';
  if (p === 'medium' || p === 'normal') return 'medium';
  if (p === 'low') return 'low';
  return '';
}

type TaskScope = 'personal' | 'admin_assigned' | 'template';

function taskScopeCategory(t: any): TaskScope {
  if (t.template_id != null && String(t.template_id).trim() !== '') return 'template';
  if (t.template && typeof t.template === 'object') return 'template';
  const et = String(t.event_subtype ?? t.task_category ?? t.category ?? '').toLowerCase();
  if (et.includes('template')) return 'template';
  if (t.assigned_by_admin || t.is_admin_assigned || et.includes('admin')) return 'admin_assigned';
  const src = String(t.source ?? '').toLowerCase();
  if (src.includes('template')) return 'template';
  if (src.includes('admin')) return 'admin_assigned';
  return 'personal';
}

function formatDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseUserDateTime(s: string): Date | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}

function taskParentId(t: any): string | null {
  const p = t?.parent_event ?? t?.parent ?? t?.parent_task ?? t?.parent_id;
  if (p == null || p === '') return null;
  if (typeof p === 'object' && p.id != null) return String(p.id);
  return String(p);
}

function taskNotesText(t: any): string {
  const n = t?.notes ?? t?.description;
  return typeof n === 'string' ? n.trim() : '';
}

function taskCreatedLine(t: any): string {
  const raw = t?.created_at ?? t?.created ?? t?.date_created ?? t?.start_time;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `Created ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function taskIsCompleted(t: any): boolean {
  if (t?.completed === true || t?.is_completed === true) return true;
  const st = String(t?.status ?? '').toLowerCase();
  return st === 'completed' || st === 'done';
}

function displayLocalFromStr(s: string): string {
  const d = parseUserDateTime(s);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function sameCalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WD_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WHEEL_H = 36;
const WHEEL_VISIBLE = 5;

function TaskDueDateTimePanel({
  initialMs,
  onCommit,
}: {
  initialMs: number;
  onCommit: (isoLocal: string) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const [dayDraft, setDayDraft] = useState(() => new Date());
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);

  useEffect(() => {
    const d = new Date(initialMs);
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    setDayDraft(safe);
    setCursor(new Date(safe.getFullYear(), safe.getMonth(), 1));
    setHour(safe.getHours());
    setMinute(safe.getMinutes());
  }, [initialMs]);

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const firstWd = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const now = new Date();
  const monthTitle = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const commit = () => {
    const dt = new Date(dayDraft.getFullYear(), dayDraft.getMonth(), dayDraft.getDate(), hour, minute, 0, 0);
    const iso = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
    onCommit(iso);
  };

  return (
    <View style={dueStyles.wrap}>
      <View style={dueStyles.split}>
        <View style={dueStyles.calSide}>
          <View style={dueStyles.monthRow}>
            <TouchableOpacity onPress={() => setCursor(new Date(y, m - 1, 1))} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-left" size={22} color="#0f172a" />
            </TouchableOpacity>
            <Text style={dueStyles.monthTitle}>{monthTitle}</Text>
            <TouchableOpacity onPress={() => setCursor(new Date(y, m + 1, 1))} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-right" size={22} color="#0f172a" />
            </TouchableOpacity>
          </View>
          <View style={dueStyles.weekRow}>
            {WD_LABELS.map((w) => (
              <Text key={w} style={dueStyles.wdCell}>
                {w}
              </Text>
            ))}
          </View>
          <View style={dueStyles.grid}>
            {cells.map((cell, idx) => {
              if (cell == null) return <View key={`e-${idx}`} style={dueStyles.cell} />;
              const cd = new Date(y, m, cell);
              const sel = sameCalDay(cd, dayDraft);
              const isToday = sameCalDay(cd, now);
              return (
                <TouchableOpacity
                  key={idx}
                  style={[dueStyles.cell, sel && dueStyles.cellSel, isToday && !sel && dueStyles.cellToday]}
                  onPress={() => setDayDraft(cd)}
                >
                  <Text style={[dueStyles.cellTxt, sel && dueStyles.cellTxtSel]}>{cell}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={dueStyles.timeSide}>
          <Text style={dueStyles.timeLabel}>Time</Text>
          <View style={dueStyles.wheels}>
            <ScrollView style={dueStyles.wheel} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {Array.from({ length: 24 }, (_, h) => (
                <TouchableOpacity key={h} style={dueStyles.wheelItem} onPress={() => setHour(h)}>
                  <Text style={[dueStyles.wheelTxt, hour === h && dueStyles.wheelTxtOn]}>{pad2(h)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView style={dueStyles.wheel} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {Array.from({ length: 60 }, (_, mm) => (
                <TouchableOpacity key={mm} style={dueStyles.wheelItem} onPress={() => setMinute(mm)}>
                  <Text style={[dueStyles.wheelTxt, minute === mm && dueStyles.wheelTxtOn]}>{pad2(mm)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </View>
      <View style={dueStyles.footer}>
        <TouchableOpacity
          onPress={() => {
            const t = new Date();
            setDayDraft(t);
            setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
            setHour(t.getHours());
            setMinute(t.getMinutes());
          }}
        >
          <Text style={dueStyles.link}>Now</Text>
        </TouchableOpacity>
        <TouchableOpacity style={dueStyles.doneBtn} onPress={commit}>
          <Text style={dueStyles.doneTxt}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const dueStyles = StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingBottom: 8 },
  split: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  calSide: { flex: 1, minWidth: 220 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  monthTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  wdCell: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600', color: '#64748b' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', height: 32, alignItems: 'center', justifyContent: 'center' },
  cellSel: { borderWidth: 2, borderColor: '#2563eb', borderRadius: 6 },
  cellToday: { backgroundColor: '#e2e8f0', borderRadius: 999 },
  cellTxt: { fontSize: 13, color: '#0f172a' },
  cellTxtSel: { fontWeight: '700' },
  timeSide: { width: 120 },
  timeLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', textAlign: 'center', marginBottom: 4 },
  wheels: { flexDirection: 'row', gap: 6 },
  wheel: {
    flex: 1,
    height: WHEEL_H * WHEEL_VISIBLE,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
  },
  wheelItem: { height: WHEEL_H, alignItems: 'center', justifyContent: 'center' },
  wheelTxt: { fontSize: 15, color: '#94a3b8' },
  wheelTxtOn: { color: '#0f172a', fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 12,
    paddingHorizontal: 4,
    flexWrap: 'wrap',
    gap: 16,
  },
  link: { fontSize: 14, fontWeight: '600', color: '#2563eb' },
  doneBtn: { backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8 },
  doneTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

function formatTaskApiError(e: unknown): string {
  if (e instanceof HttpError) {
    const b = e.body as Record<string, unknown> | null | undefined;
    if (b && typeof b === 'object') {
      const d = b.detail;
      if (typeof d === 'string' && d.trim()) return d;
      const parts: string[] = [];
      for (const [k, v] of Object.entries(b)) {
        if (k === 'detail') continue;
        if (Array.isArray(v)) parts.push(`${k}: ${v.map(String).join(', ')}`);
        else if (v != null && typeof v === 'object') parts.push(`${k}: ${JSON.stringify(v)}`);
        else if (v != null) parts.push(`${k}: ${String(v)}`);
      }
      if (parts.length) return parts.join('\n');
    }
    return e.message || 'Request failed';
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

export default function TasksScreen() {
  const { user, role } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createAssignKey, setCreateAssignKey] = useState<string>('self');
  const [createPriority, setCreatePriority] = useState<string>('medium');
  const [allDay, setAllDay] = useState(false);
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [createPicker, setCreatePicker] = useState<'assign' | 'priority' | 'start' | 'end' | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [editTask, setEditTask] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editAllDay, setEditAllDay] = useState(false);
  const [editStartStr, setEditStartStr] = useState('');
  const [editEndStr, setEditEndStr] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editPicker, setEditPicker] = useState<'priority' | 'start' | 'end' | null>(null);

  const [assignTask, setAssignTask] = useState<any | null>(null);
  const [assignToId, setAssignToId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignUserPicker, setAssignUserPicker] = useState(false);

  const [subtaskParent, setSubtaskParent] = useState<any | null>(null);
  const [subTitle, setSubTitle] = useState('');
  const [subDescription, setSubDescription] = useState('');
  const [subAssignKey, setSubAssignKey] = useState('same_parent');
  const [subPriority, setSubPriority] = useState('medium');
  const [subAllDay, setSubAllDay] = useState(false);
  const [subStartStr, setSubStartStr] = useState('');
  const [subEndStr, setSubEndStr] = useState('');
  const [subSaving, setSubSaving] = useState(false);
  const [subPicker, setSubPicker] = useState<'assign' | 'priority' | 'start' | 'end' | null>(null);

  const [filterScope, setFilterScope] = useState('all');
  const [filterMember, setFilterMember] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterDate, setFilterDate] = useState('today');
  const [filterStatus, setFilterStatus] = useState('pending');

  const [memberOptions, setMemberOptions] = useState<PickerOption[]>([{ id: 'all', label: 'All Members' }]);
  /** Resolve calendar assignee id/email to display name (from getUsers). */
  const [memberDisplayById, setMemberDisplayById] = useState<Record<string, string>>({});
  const [memberDisplayByEmail, setMemberDisplayByEmail] = useState<Record<string, string>>({});
  const [memberIdByEmail, setMemberIdByEmail] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<'scope' | 'member' | 'priority' | 'date' | 'status' | null>(null);

  const canViewAllMembers = ['super_admin', 'admin', 'operations_manager', 'manager'].includes(role || '');

  const scopeOptions: PickerOption[] = useMemo(
    () => [
      { id: 'all', label: 'All Tasks' },
      { id: 'personal', label: 'Personal' },
      { id: 'admin_assigned', label: 'Admin Assigned' },
      { id: 'template', label: 'Template' },
    ],
    []
  );

  const priorityOptions: PickerOption[] = useMemo(
    () => [
      { id: 'all', label: 'All Priorities' },
      { id: 'high', label: 'High' },
      { id: 'medium', label: 'Medium' },
      { id: 'low', label: 'Low' },
    ],
    []
  );

  const createPriorityOptions: PickerOption[] = useMemo(
    () => [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
    []
  );

  const dateOptions: PickerOption[] = useMemo(
    () => [
      { id: 'today', label: 'Today' },
      { id: 'week', label: 'This week' },
      { id: 'month', label: 'This month' },
      { id: 'all', label: 'All dates' },
    ],
    []
  );

  const statusOptions: PickerOption[] = useMemo(
    () => [
      { id: 'pending', label: 'Pending' },
      { id: 'all', label: 'All' },
      { id: 'completed', label: 'Completed' },
    ],
    []
  );

  const assignCreateOptions: PickerOption[] = useMemo(() => {
    const base: PickerOption[] = [{ id: 'self', label: 'Assign to myself' }];
    if (!canViewAllMembers) return base;
    const rest = memberOptions.filter((o) => o.id !== 'all');
    return [...base, ...rest];
  }, [canViewAllMembers, memberOptions]);

  const assignMemberPickOptions: PickerOption[] = useMemo(() => {
    if (!canViewAllMembers) {
      return user?.id ? [{ id: String(user.id), label: 'Me' }] : [];
    }
    return memberOptions.filter((o) => o.id !== 'all');
  }, [canViewAllMembers, memberOptions, user?.id]);

  const subtaskAssignOptions: PickerOption[] = useMemo(() => {
    const base: PickerOption[] = [{ id: 'same_parent', label: 'Same as parent task' }];
    if (!canViewAllMembers) return base;
    const rest = memberOptions.filter((o) => o.id !== 'all');
    return [...base, ...rest];
  }, [canViewAllMembers, memberOptions]);

  const loadMembers = useCallback(async () => {
    if (!canViewAllMembers) {
      setMemberOptions([{ id: 'all', label: 'All Members' }]);
      setMemberDisplayById({});
      setMemberDisplayByEmail({});
      setMemberIdByEmail({});
      return;
    }
    try {
      const raw = await api.getUsers();
      const list = Array.isArray(raw) ? raw : [];
      const opts: PickerOption[] = [{ id: 'all', label: 'All Members' }];
      const byId: Record<string, string> = {};
      const byEmail: Record<string, string> = {};
      const idByEmail: Record<string, string> = {};
      for (const u of list) {
        const id = u.id != null ? String(u.id) : '';
        if (!id) continue;
        const displayName = (
          u.profile?.full_name ||
          u.full_name ||
          [u.first_name, u.last_name].filter(Boolean).join(' ') ||
          ''
        ).trim();
        const label = displayName || u.email || id;
        opts.push({ id, label: String(label) });
        byId[id] = String(label);
        if (typeof u.email === 'string' && u.email.trim()) {
          const ek = u.email.trim().toLowerCase();
          idByEmail[ek] = id;
          byEmail[ek] = displayName || String(label);
        }
      }
      setMemberOptions(opts);
      setMemberDisplayById(byId);
      setMemberDisplayByEmail(byEmail);
      setMemberIdByEmail(idByEmail);
    } catch {
      setMemberOptions([{ id: 'all', label: 'All Members' }]);
      setMemberDisplayById({});
      setMemberDisplayByEmail({});
      setMemberIdByEmail({});
    }
  }, [canViewAllMembers]);

  const load = useCallback(async () => {
    try {
      const { start, end } = getDateRangeForPreset(filterDate);
      const baseParams: Record<string, any> = {
        event_type: 'task',
        start_time__gte: start.toISOString(),
        end_time__lte: end.toISOString(),
      };
      const mergeUnique = (items: any[]) => {
        const seen = new Set<string>();
        const out: any[] = [];
        for (const t of items) {
          const key = eventId(t) || `${String(t?.title || t?.name || '')}|${String(t?.start_time || t?.created_at || '')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(t);
        }
        return out;
      };
      const fetchBy = async (extra?: Record<string, any>) => {
        const res = await api.getCalendarEvents({ ...baseParams, ...(extra || {}) });
        return Array.isArray(res) ? res : [];
      };

      let raw: any[] = [];
      try {
        if (canViewAllMembers && filterMember !== 'all') {
          const [byUser, byAssigned, byAssignee] = await Promise.all([
            fetchBy({ user: filterMember }),
            fetchBy({ assigned_user: filterMember }),
            fetchBy({ assignee: filterMember }),
          ]);
          raw = mergeUnique([...byUser, ...byAssigned, ...byAssignee]);
        } else if (!canViewAllMembers) {
          const uid = user?.id;
          if (!uid) {
            raw = [];
          } else {
            const [byUser, byAssigned, byAssignee] = await Promise.all([
              fetchBy({ user: uid }),
              fetchBy({ assigned_user: uid }),
              fetchBy({ assignee: uid }),
            ]);
            raw = mergeUnique([...byUser, ...byAssigned, ...byAssignee]);
          }
        } else {
          raw = await fetchBy();
        }
      } catch {
        const fallback = await fetchBy(user?.id ? { user: user.id } : undefined);
        raw = mergeUnique(fallback);
      }

      setTasks(raw);
    } catch (e) {
      console.warn(e);
      setTasks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, canViewAllMembers, filterMember, filterDate]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const done = taskIsCompleted(t);
      if (filterStatus === 'pending' && done) return false;
      if (filterStatus === 'completed' && !done) return false;

      if (filterPriority !== 'all') {
        const pr = taskPriority(t);
        const normalized = pr || 'medium';
        if (normalized !== filterPriority) return false;
      }

      if (filterScope !== 'all') {
        const cat = taskScopeCategory(t);
        if (filterScope === 'personal' && cat !== 'personal') return false;
        if (filterScope === 'admin_assigned' && cat !== 'admin_assigned') return false;
        if (filterScope === 'template' && cat !== 'template') return false;
      }

      if (canViewAllMembers && filterMember !== 'all') {
        const tid = taskUserId(t);
        if (tid && tid !== filterMember) return false;
      }

      return true;
    });
  }, [tasks, filterStatus, filterPriority, filterScope, filterMember, canViewAllMembers]);

  const listTasks = useMemo(() => filteredTasks.filter((t) => !taskParentId(t)), [filteredTasks]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const resetCreateForm = useCallback(() => {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    setStartStr(formatDatetimeLocal(now));
    setEndStr(formatDatetimeLocal(end));
    setNewTitle('');
    setNewDescription('');
    setCreatePriority('medium');
    setAllDay(false);
    setCreateAssignKey('self');
    setCreatePicker(null);
  }, []);

  const openNewTask = () => {
    resetCreateForm();
    setModalOpen(true);
  };

  const createTask = async () => {
    const title = newTitle.trim();
    if (!title) {
      Alert.alert('Validation', 'Title is required');
      return;
    }
    let start = parseUserDateTime(startStr);
    if (!start) {
      Alert.alert('Validation', allDay ? 'Select a valid date' : 'Enter a valid start date/time');
      return;
    }
    let end = parseUserDateTime(endStr);
    if (allDay) {
      const d = new Date(start);
      d.setHours(0, 0, 0, 0);
      const e = new Date(d);
      e.setHours(23, 59, 59, 999);
      start = d;
      end = e;
    } else {
      if (!end) {
        Alert.alert('Validation', 'Enter valid start and end date/time');
        return;
      }
      if (end.getTime() < start.getTime()) {
        Alert.alert('Validation', 'End time must be after start time');
        return;
      }
    }

    const targetUser = createAssignKey === 'self' ? user?.id : createAssignKey;
    if (!targetUser) {
      Alert.alert('Validation', 'Select a user to assign');
      return;
    }

    setSaving(true);
    try {
      await api.createTaskEvent({
        title,
        description: newDescription.trim() || undefined,
        priority: createPriority,
        isAllDay: allDay,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        assigneeUserId: String(targetUser),
      });
      setModalOpen(false);
      setCreatePicker(null);
      resetCreateForm();
      load();
    } catch (e: unknown) {
      Alert.alert('Error', formatTaskApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleComplete = async (task: any) => {
    const id = eventId(task);
    if (!id) {
      Alert.alert('Error', 'Cannot update this task (missing id).');
      return;
    }
    const next = !taskIsCompleted(task);
    try {
      try {
        await api.updateTaskCompleted(id, next);
      } catch {
        const fallbacks = [
          { completed: next },
          { is_completed: next },
          { done: next },
          { is_done: next },
          { status: next ? 'completed' : 'pending' },
        ];
        let updated = false;
        for (const body of fallbacks) {
          try {
            await api.updateCalendarEvent(id, body);
            updated = true;
            break;
          } catch {
            // try next body
          }
        }
        if (!updated) throw new Error('Unable to update completion state');
      }
      load();
    } catch (e: unknown) {
      Alert.alert('Error', formatTaskApiError(e));
    }
  };

  const toggleExpanded = (taskId: string) => {
    setExpanded((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const openEdit = (task: any) => {
    const id = eventId(task);
    if (!id) return;
    setEditPicker(null);
    setEditTask(task);
    setEditTitle(String(task.title || '').trim());
    setEditDescription(String(task.description || task.notes || ''));
    setEditPriority(taskPriority(task) || 'medium');
    const st = task.start_time ? formatDatetimeLocal(new Date(task.start_time)) : formatDatetimeLocal(new Date());
    const en = task.end_time ? formatDatetimeLocal(new Date(task.end_time)) : formatDatetimeLocal(new Date(Date.now() + 3600000));
    setEditStartStr(st);
    setEditEndStr(en);
    setEditAllDay(!!task.all_day || !!task.is_all_day);
  };

  const submitEdit = async () => {
    if (!editTask) return;
    const id = eventId(editTask);
    const title = editTitle.trim();
    if (!id || !title) {
      Alert.alert('Validation', 'Title is required');
      return;
    }
    let start = parseUserDateTime(editStartStr);
    if (!start) {
      Alert.alert('Validation', editAllDay ? 'Select a valid date' : 'Enter a valid start date/time');
      return;
    }
    let end = parseUserDateTime(editEndStr);
    if (editAllDay) {
      const d = new Date(start);
      d.setHours(0, 0, 0, 0);
      const e = new Date(d);
      e.setHours(23, 59, 59, 999);
      start = d;
      end = e;
    } else {
      if (!end) {
        Alert.alert('Validation', 'Enter valid start and end date/time');
        return;
      }
      if (end.getTime() < start.getTime()) {
        Alert.alert('Validation', 'End time must be after start time');
        return;
      }
    }
    setEditSaving(true);
    try {
      await api.updateTaskEvent(id, {
        title,
        description: editDescription.trim() || undefined,
        priority: editPriority,
        isAllDay: editAllDay,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
      });
      setEditTask(null);
      setEditPicker(null);
      load();
    } catch (e: unknown) {
      Alert.alert('Error', formatTaskApiError(e));
    } finally {
      setEditSaving(false);
    }
  };

  const openAssign = (task: any) => {
    setAssignUserPicker(false);
    setAssignTask(task);
    const cur = taskUserId(task);
    const pickIds = new Set(assignMemberPickOptions.map((o) => o.id));
    let resolved = '';
    if (cur && pickIds.has(cur)) resolved = cur;
    else if (cur) {
      const hit = assignMemberPickOptions.find((o) => String(o.id) === String(cur));
      if (hit) resolved = hit.id;
    }
    if (!resolved) {
      for (const em of taskAssigneeEmails(task)) {
        const idMatch = memberIdByEmail[em];
        if (idMatch && pickIds.has(idMatch)) {
          resolved = idMatch;
          break;
        }
      }
    }
    setAssignToId(resolved);
  };

  const submitAssign = async () => {
    if (!assignTask || !assignToId) {
      Alert.alert('Assign', 'Select a user');
      return;
    }
    const id = eventId(assignTask);
    if (!id) return;
    setAssignSaving(true);
    try {
      await api.assignTaskEvent(id, assignToId);
      setAssignTask(null);
      load();
    } catch (e: unknown) {
      Alert.alert('Error', formatTaskApiError(e));
    } finally {
      setAssignSaving(false);
    }
  };

  const openSubtask = (parent: any) => {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    setSubtaskParent(parent);
    setSubTitle('');
    setSubDescription('');
    setSubAssignKey('same_parent');
    setSubPriority('medium');
    setSubAllDay(false);
    setSubStartStr(formatDatetimeLocal(now));
    setSubEndStr(formatDatetimeLocal(end));
    setSubPicker(null);
  };

  const submitSubtask = async () => {
    if (!subtaskParent) return;
    const parentId = eventId(subtaskParent);
    const title = subTitle.trim();
    if (!parentId || !title) {
      Alert.alert('Validation', 'Title is required');
      return;
    }
    let start = parseUserDateTime(subStartStr);
    if (!start) {
      Alert.alert('Validation', subAllDay ? 'Select a valid date' : 'Enter a valid start date/time');
      return;
    }
    let end = parseUserDateTime(subEndStr);
    if (subAllDay) {
      const d = new Date(start);
      d.setHours(0, 0, 0, 0);
      const e = new Date(d);
      e.setHours(23, 59, 59, 999);
      start = d;
      end = e;
    } else {
      if (!end) {
        Alert.alert('Validation', 'Enter valid start and end date/time');
        return;
      }
      if (end.getTime() < start.getTime()) {
        Alert.alert('Validation', 'End time must be after start time');
        return;
      }
    }
    const targetUser =
      subAssignKey === 'same_parent' ? taskUserId(subtaskParent) : subAssignKey;
    if (!targetUser) {
      Alert.alert('Validation', 'Select assignee');
      return;
    }
    setSubSaving(true);
    try {
      await api.createSubtaskEvent(parentId, {
        title,
        description: subDescription.trim() || undefined,
        priority: subPriority,
        isAllDay: subAllDay,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        assigneeUserId: String(targetUser),
      });
      setSubtaskParent(null);
      setSubPicker(null);
      load();
    } catch (e: unknown) {
      Alert.alert('Error', formatTaskApiError(e));
    } finally {
      setSubSaving(false);
    }
  };

  const priorityBadgeStyle = (pr: string) => {
    if (pr === 'high') return { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' };
    if (pr === 'low') return { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
    return { bg: '#fef3c7', text: '#b45309', border: '#fde68a' };
  };

  const deleteTask = (task: any) => {
    const id = eventId(task);
    if (!id) {
      Alert.alert('Error', 'This task cannot be deleted (missing id).');
      return;
    }

    const title = task.title || 'this task';
    const run = async () => {
      try {
        await api.deleteCalendarEvent(id);
        load();
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to delete');
      }
    };

    if (Platform.OS === 'web' && typeof globalThis !== 'undefined') {
      const w = globalThis as unknown as { confirm?: (m: string) => boolean };
      if (typeof w.confirm === 'function') {
        if (w.confirm(`Delete "${title}"?`)) void run();
        return;
      }
    }

    Alert.alert('Delete', `Delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const labelFor = (options: PickerOption[], id: string, fallback: string) =>
    options.find((o) => o.id === id)?.label ?? fallback;

  const pickerConfig = useMemo(() => {
    switch (picker) {
      case 'scope':
        return { title: 'Tasks', options: scopeOptions, selectedId: filterScope };
      case 'member':
        return { title: 'Member', options: memberOptions, selectedId: filterMember };
      case 'priority':
        return { title: 'Priority', options: priorityOptions, selectedId: filterPriority };
      case 'date':
        return { title: 'Date', options: dateOptions, selectedId: filterDate };
      case 'status':
        return { title: 'Status', options: statusOptions, selectedId: filterStatus };
      default:
        return { title: '', options: [] as PickerOption[], selectedId: undefined };
    }
  }, [picker, scopeOptions, memberOptions, priorityOptions, dateOptions, statusOptions, filterScope, filterMember, filterPriority, filterDate, filterStatus]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const filterChip = (key: typeof picker, label: string) => (
    <TouchableOpacity style={styles.filterChip} onPress={() => setPicker(key)} activeOpacity={0.85}>
      <Text style={styles.filterChipText} numberOfLines={1}>
        {label}
      </Text>
      <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
    </TouchableOpacity>
  );

  const currentAssigneeName = (task: any) => {
    const named = taskAssignedNameOnly(task);
    if (named) return named;
    const uid = taskUserId(task);
    if (uid) {
      const fromMap = memberDisplayById[uid] || memberDisplayById[String(uid)];
      if (fromMap) return fromMap;
      const m = memberOptions.find((o) => String(o.id) === String(uid));
      if (m?.label) return m.label;
    }
    for (const em of taskAssigneeEmails(task)) {
      const fromEmail = memberDisplayByEmail[em];
      if (fromEmail) return fromEmail;
    }
    const firstEmail = taskAssigneeEmails(task)[0];
    if (firstEmail) return firstEmail;
    return uid || '—';
  };

  return (
    <View style={styles.root}>
      <FlatList
        data={listTasks}
        keyExtractor={(item, index) => {
          const id = eventId(item);
          return id ? id : `task-row-${index}`;
        }}
        extraData={{ filterStatus, expanded }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={listTasks.length === 0 ? styles.listContentEmpty : styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.topRow}>
              <View style={styles.titleBlock}>
                <View style={styles.titleIconRow}>
                  <View style={styles.titleIconSquare}>
                    <MaterialCommunityIcons name="target" size={22} color="#fff" />
                  </View>
                  <Text style={styles.pageTitle}>Tasks</Text>
                </View>
                <Text style={styles.pageSubtitle}>Manage your tasks and events in one place</Text>
              </View>
              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="refresh" size={20} color="#475569" />
                  <Text style={styles.refreshBtnText}>Refresh</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.newTaskBtn} onPress={openNewTask} activeOpacity={0.9}>
                  <Text style={styles.newTaskBtnText}>+ New Task</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.filtersCard}>
              <View style={styles.filtersLabelRow}>
                <MaterialCommunityIcons name="filter-variant" size={18} color="#64748b" />
                <Text style={styles.filtersLabel}>Filters:</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                {filterChip('scope', labelFor(scopeOptions, filterScope, 'All Tasks'))}
                {filterChip('member', labelFor(memberOptions, filterMember, 'All Members'))}
                {filterChip('priority', labelFor(priorityOptions, filterPriority, 'All Priorities'))}
                {filterChip('date', labelFor(dateOptions, filterDate, 'Today'))}
                {filterChip('status', labelFor(statusOptions, filterStatus, 'Pending'))}
              </ScrollView>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.contentCard}>
            <View style={styles.emptyInner}>
              <View style={styles.emptyIconCircle}>
                <MaterialCommunityIcons name="format-list-checks" size={40} color="#2563eb" />
              </View>
              <Text style={styles.emptyTitle}>No tasks found</Text>
              <Text style={styles.emptySubtitle}>Get started by creating your first task.</Text>
              <TouchableOpacity style={styles.createTaskBtn} onPress={openNewTask} activeOpacity={0.9}>
                <Text style={styles.createTaskBtnText}>+ Create Task</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const tid = eventId(item);
          const isOpen = tid ? !!expanded[tid] : false;
          const pr = taskPriority(item) || 'medium';
          const pb = priorityBadgeStyle(pr);
          const subs = tid ? tasks.filter((t) => taskParentId(t) === tid) : [];
          const notes = taskNotesText(item);
          const itemDone = taskIsCompleted(item);
          return (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <TouchableOpacity onPress={() => toggleComplete(item)} activeOpacity={0.75} hitSlop={6}>
                  <View style={[styles.checkbox, itemDone && styles.checkboxDone]}>
                    {itemDone ? <MaterialCommunityIcons name="check" size={16} color="#fff" /> : null}
                  </View>
                </TouchableOpacity>
                <View style={styles.cardMain}>
                  <Text style={[styles.taskTitle, itemDone && styles.taskTitleDone]} numberOfLines={2}>
                    {item.title || 'Task'}
                  </Text>
                  <Text style={styles.taskMeta}>{taskCreatedLine(item)}</Text>
                </View>
                <View style={[styles.priorityPill, { backgroundColor: pb.bg, borderColor: pb.border }]}>
                  <Text style={[styles.priorityPillText, { color: pb.text }]}>{pr}</Text>
                </View>
                <TouchableOpacity onPress={() => tid && toggleExpanded(tid)} hitSlop={8} style={styles.chevronHit}>
                  <MaterialCommunityIcons name={isOpen ? 'chevron-up' : 'chevron-down'} size={24} color="#64748b" />
                </TouchableOpacity>
              </View>

              {isOpen ? (
                <View style={styles.cardExpanded}>
                  <View style={styles.expandedHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.expandedTitle}>{item.title || 'Task'}</Text>
                      <View style={[styles.priorityPill, styles.priorityPillSm, { backgroundColor: pb.bg, borderColor: pb.border }]}>
                        <Text style={[styles.priorityPillText, { color: pb.text }]}>{pr}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.actionOutlineBtn} onPress={() => openAssign(item)} activeOpacity={0.85}>
                      <MaterialCommunityIcons name="account-outline" size={18} color="#475569" />
                      <Text style={styles.actionOutlineText}>Assign</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionOutlineBtn} onPress={() => openEdit(item)} activeOpacity={0.85}>
                      <MaterialCommunityIcons name="pencil-outline" size={18} color="#475569" />
                      <Text style={styles.actionOutlineText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionOutlineBtn} onPress={() => openSubtask(item)} activeOpacity={0.85}>
                      <Text style={styles.actionOutlineText}>+ Add Subtask</Text>
                    </TouchableOpacity>
                    {!itemDone ? (
                      <TouchableOpacity style={styles.markDoneBtn} onPress={() => toggleComplete(item)} activeOpacity={0.9}>
                        <MaterialCommunityIcons name="check" size={18} color="#fff" />
                        <Text style={styles.markDoneText}>Mark Complete</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <Text style={styles.notesLabel}>Notes</Text>
                  <View style={styles.notesBox}>
                    {notes ? (
                      <Text style={styles.notesBody}>{notes}</Text>
                    ) : (
                      <View style={styles.notesPlaceholderRow}>
                        <MaterialCommunityIcons name="text-box-outline" size={20} color="#94a3b8" />
                        <Text style={styles.notesPlaceholder}>No notes</Text>
                      </View>
                    )}
                  </View>

                  {subs.length > 0 ? (
                    <View style={styles.subtasksBlock}>
                      <Text style={styles.subtasksTitle}>Subtasks ({subs.length})</Text>
                      {subs.map((st, si) => (
                        <View key={eventId(st) || `sub-${si}`} style={styles.subtaskRow}>
                          <MaterialCommunityIcons
                            name={taskIsCompleted(st) ? 'check-circle' : 'checkbox-blank-circle-outline'}
                            size={18}
                            color={taskIsCompleted(st) ? '#22c55e' : '#94a3b8'}
                          />
                          <Text style={[styles.subtaskTitle, taskIsCompleted(st) && styles.taskTitleDone]}>{st.title || 'Subtask'}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <TouchableOpacity style={styles.deleteTaskRow} onPress={() => deleteTask(item)} activeOpacity={0.8}>
                    <MaterialCommunityIcons name="trash-can-outline" size={20} color="#dc2626" />
                    <Text style={styles.deleteTaskText}>Delete Task</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        }}
      />

      <PickerModal
        visible={picker != null}
        title={pickerConfig.title}
        options={pickerConfig.options}
        selectedId={pickerConfig.selectedId}
        onSelect={(id) => {
          if (picker === 'scope') setFilterScope(id);
          if (picker === 'member') setFilterMember(id);
          if (picker === 'priority') setFilterPriority(id);
          if (picker === 'date') setFilterDate(id);
          if (picker === 'status') setFilterStatus(id);
        }}
        onClose={() => setPicker(null)}
      />

      <Modal
        visible={modalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setCreatePicker(null);
          setModalOpen(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.createModalRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (createPicker) setCreatePicker(null);
                else setModalOpen(false);
              }}
            />
            <ScrollView
              style={styles.createModalScrollView}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createModalScroll}
              showsVerticalScrollIndicator={false}
            >
              <Pressable style={styles.createModalBox} onPress={(e) => e.stopPropagation?.()}>
                <View style={styles.createModalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createModalTitle}>Create New Task</Text>
                  <Text style={styles.createModalSubtitle}>Add a new task to your calendar. Fill in the details below.</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setCreatePicker(null);
                    setModalOpen(false);
                  }}
                  hitSlop={12}
                  style={styles.closeBtn}
                >
                  <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                </TouchableOpacity>
                </View>

              <Text style={styles.fieldLabel}>Assign to User</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setCreatePicker('assign')} activeOpacity={0.85}>
                  <Text style={styles.selectFieldText} numberOfLines={1}>
                    {labelFor(assignCreateOptions, createAssignKey, 'Assign to myself')}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>Title *</Text>
                <TextInput
                  style={styles.input}
                  value={newTitle}
                  onChangeText={setNewTitle}
                  placeholder="Enter task title"
                  placeholderTextColor="#94a3b8"
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={newDescription}
                  onChangeText={setNewDescription}
                  placeholder="Enter task description"
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.fieldLabel}>Priority</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setCreatePicker('priority')} activeOpacity={0.85}>
                  <Text style={styles.selectFieldText}>{labelFor(createPriorityOptions, createPriority, 'Medium')}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <View style={styles.switchRow}>
                  <Text style={styles.fieldLabel}>All day</Text>
                  <Switch value={allDay} onValueChange={setAllDay} trackColor={{ false: '#e2e8f0', true: '#93c5fd' }} thumbColor={allDay ? '#2563eb' : '#f4f4f5'} />
                </View>

                {allDay ? (
                  <>
                    <Text style={styles.fieldLabel}>Date</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setCreatePicker('start')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(startStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(startStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>Start Time</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setCreatePicker('start')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(startStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(startStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>End Time</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setCreatePicker('end')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(endStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(endStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>
                  </>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelOutlineBtn}
                    onPress={() => {
                      setCreatePicker(null);
                      setModalOpen(false);
                    }}
                  >
                    <Text style={styles.cancelOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} onPress={() => void createTask()} disabled={saving}>
                    <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Create Task'}</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </ScrollView>

            {createPicker ? (
              <View style={styles.createModalPickerLayer} pointerEvents="box-none">
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setCreatePicker(null)} />
                <View
                  style={[
                    styles.createModalPickerBox,
                    (createPicker === 'start' || createPicker === 'end') && styles.createModalPickerWide,
                  ]}
                  pointerEvents="auto"
                >
                  {createPicker === 'start' || createPicker === 'end' ? (
                    <>
                      <Text style={styles.createModalPickerTitle}>
                        {createPicker === 'start' ? 'Start time' : 'End time'}
                      </Text>
                      <TaskDueDateTimePanel
                        key={createPicker}
                        initialMs={
                          parseUserDateTime(createPicker === 'start' ? startStr : endStr)?.getTime() ?? Date.now()
                        }
                        onCommit={(iso) => {
                          if (createPicker === 'start') setStartStr(iso);
                          else setEndStr(iso);
                          setCreatePicker(null);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.createModalPickerTitle}>
                        {createPicker === 'assign' ? 'Assign to User' : 'Priority'}
                      </Text>
                      <FlatList
                        data={createPicker === 'assign' ? assignCreateOptions : createPriorityOptions}
                        keyExtractor={(i) => i.id}
                        keyboardShouldPersistTaps="handled"
                        style={styles.createModalPickerList}
                        renderItem={({ item: opt }) => {
                          const selectedId = createPicker === 'assign' ? createAssignKey : createPriority;
                          return (
                            <TouchableOpacity
                              style={modalStyles.row}
                              onPress={() => {
                                if (createPicker === 'assign') setCreateAssignKey(opt.id);
                                else setCreatePriority(opt.id);
                                setCreatePicker(null);
                              }}
                            >
                              <Text style={modalStyles.rowText}>{opt.label}</Text>
                              {selectedId === opt.id ? (
                                <MaterialCommunityIcons name="check" size={22} color="#2563eb" />
                              ) : (
                                <View style={{ width: 22 }} />
                              )}
                            </TouchableOpacity>
                          );
                        }}
                      />
                    </>
                  )}
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!editTask}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setEditPicker(null);
          setEditTask(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.createModalRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (editPicker) setEditPicker(null);
                else setEditTask(null);
              }}
            />
            <ScrollView
              style={styles.createModalScrollView}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createModalScroll}
              showsVerticalScrollIndicator={false}
            >
              <Pressable style={styles.createModalBox} onPress={(e) => e.stopPropagation?.()}>
                <View style={styles.createModalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.createModalTitle}>Edit Task</Text>
                    <Text style={styles.createModalSubtitle}>Update the task details below.</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setEditPicker(null);
                      setEditTask(null);
                    }}
                    hitSlop={12}
                    style={styles.closeBtn}
                  >
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="Task title"
                  placeholderTextColor="#94a3b8"
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={editDescription}
                  onChangeText={setEditDescription}
                  placeholder="Description"
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.fieldLabel}>Priority</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setEditPicker('priority')} activeOpacity={0.85}>
                  <Text style={styles.selectFieldText}>{labelFor(createPriorityOptions, editPriority, 'Medium')}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <View style={styles.switchRow}>
                  <Text style={styles.fieldLabel}>All day</Text>
                  <Switch
                    value={editAllDay}
                    onValueChange={setEditAllDay}
                    trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
                    thumbColor={editAllDay ? '#2563eb' : '#f4f4f5'}
                  />
                </View>

                {editAllDay ? (
                  <>
                    <Text style={styles.fieldLabel}>Date</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setEditPicker('start')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(editStartStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(editStartStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>Start Time</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setEditPicker('start')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(editStartStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(editStartStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>End Time</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setEditPicker('end')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(editEndStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(editEndStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>
                  </>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelOutlineBtn}
                    onPress={() => {
                      setEditPicker(null);
                      setEditTask(null);
                    }}
                  >
                    <Text style={styles.cancelOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, editSaving && styles.disabled]}
                    onPress={() => void submitEdit()}
                    disabled={editSaving}
                  >
                    <Text style={styles.saveButtonText}>{editSaving ? 'Saving…' : 'Update Task'}</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </ScrollView>

            {editPicker ? (
              <View style={styles.createModalPickerLayer} pointerEvents="box-none">
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditPicker(null)} />
                <View
                  style={[
                    styles.createModalPickerBox,
                    (editPicker === 'start' || editPicker === 'end') && styles.createModalPickerWide,
                  ]}
                  pointerEvents="auto"
                >
                  {editPicker === 'start' || editPicker === 'end' ? (
                    <>
                      <Text style={styles.createModalPickerTitle}>
                        {editPicker === 'start' ? 'Start time' : 'End time'}
                      </Text>
                      <TaskDueDateTimePanel
                        key={editPicker}
                        initialMs={
                          parseUserDateTime(editPicker === 'start' ? editStartStr : editEndStr)?.getTime() ?? Date.now()
                        }
                        onCommit={(iso) => {
                          if (editPicker === 'start') setEditStartStr(iso);
                          else setEditEndStr(iso);
                          setEditPicker(null);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.createModalPickerTitle}>Priority</Text>
                      <FlatList
                        data={createPriorityOptions}
                        keyExtractor={(i) => i.id}
                        keyboardShouldPersistTaps="handled"
                        style={styles.createModalPickerList}
                        renderItem={({ item: opt }) => (
                          <TouchableOpacity
                            style={modalStyles.row}
                            onPress={() => {
                              setEditPriority(opt.id);
                              setEditPicker(null);
                            }}
                          >
                            <Text style={modalStyles.rowText}>{opt.label}</Text>
                            {editPriority === opt.id ? (
                              <MaterialCommunityIcons name="check" size={22} color="#2563eb" />
                            ) : (
                              <View style={{ width: 22 }} />
                            )}
                          </TouchableOpacity>
                        )}
                      />
                    </>
                  )}
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!assignTask}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setAssignUserPicker(false);
          setAssignTask(null);
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.createModalRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (assignUserPicker) setAssignUserPicker(false);
                else setAssignTask(null);
              }}
            />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createModalScroll}
              showsVerticalScrollIndicator={false}
            >
              <Pressable style={styles.createModalBox} onPress={(e) => e.stopPropagation?.()}>
                <View style={styles.createModalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.createModalTitle}>Assign Task to User</Text>
                    <Text style={styles.createModalSubtitle}>Select a user to assign this task to</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setAssignUserPicker(false);
                      setAssignTask(null);
                    }}
                    hitSlop={12}
                    style={styles.closeBtn}
                  >
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Current Assignment</Text>
                <View style={styles.assignCurrentBox}>
                  <Text style={styles.assignCurrentText}>
                    {assignTask ? currentAssigneeName(assignTask) : '—'}
                  </Text>
                </View>

                <Text style={styles.fieldLabel}>Assign to User</Text>
                <TouchableOpacity
                  style={styles.selectField}
                  onPress={() => setAssignUserPicker(true)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.selectFieldText, !assignToId && styles.datetimeTriggerPh]} numberOfLines={1}>
                    {assignToId
                      ? labelFor(assignMemberPickOptions, assignToId, assignToId)
                      : 'Select a user...'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelOutlineBtn}
                    onPress={() => {
                      setAssignUserPicker(false);
                      setAssignTask(null);
                    }}
                  >
                    <Text style={styles.cancelOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, assignSaving && styles.disabled]}
                    onPress={() => void submitAssign()}
                    disabled={assignSaving}
                  >
                    <Text style={styles.saveButtonText}>{assignSaving ? 'Saving…' : 'Assign Task'}</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </ScrollView>

            {assignUserPicker ? (
              <View style={styles.createModalPickerLayer} pointerEvents="box-none">
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setAssignUserPicker(false)} />
                <View style={styles.createModalPickerBox} pointerEvents="auto">
                  <Text style={styles.createModalPickerTitle}>Assign to User</Text>
                  <FlatList
                    data={assignMemberPickOptions}
                    keyExtractor={(i) => i.id}
                    keyboardShouldPersistTaps="handled"
                    style={styles.createModalPickerList}
                    renderItem={({ item: opt }) => (
                      <TouchableOpacity
                        style={modalStyles.row}
                        onPress={() => {
                          setAssignToId(opt.id);
                          setAssignUserPicker(false);
                        }}
                      >
                        <Text style={modalStyles.rowText}>{opt.label}</Text>
                        {assignToId === opt.id ? (
                          <MaterialCommunityIcons name="check" size={22} color="#2563eb" />
                        ) : (
                          <View style={{ width: 22 }} />
                        )}
                      </TouchableOpacity>
                    )}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!subtaskParent}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setSubPicker(null);
          setSubtaskParent(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.createModalRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (subPicker) setSubPicker(null);
                else setSubtaskParent(null);
              }}
            />
            <ScrollView
              style={styles.createModalScrollView}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createModalScroll}
              showsVerticalScrollIndicator={false}
            >
              <Pressable style={styles.createModalBox} onPress={(e) => e.stopPropagation?.()}>
                <View style={styles.createModalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.createModalTitle}>Create Sub Task</Text>
                    <Text style={styles.createModalSubtitle}>
                      Add a sub-task to {subtaskParent?.title || subtaskParent?.name || 'task'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setSubPicker(null);
                      setSubtaskParent(null);
                    }}
                    hitSlop={12}
                    style={styles.closeBtn}
                  >
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Assign to User</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setSubPicker('assign')} activeOpacity={0.85}>
                  <Text style={styles.selectFieldText} numberOfLines={1}>
                    {labelFor(subtaskAssignOptions, subAssignKey, 'Same as parent task')}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>Title *</Text>
                <TextInput
                  style={styles.input}
                  value={subTitle}
                  onChangeText={setSubTitle}
                  placeholder="Enter sub-task title"
                  placeholderTextColor="#94a3b8"
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={subDescription}
                  onChangeText={setSubDescription}
                  placeholder="Enter sub-task description"
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.fieldLabel}>Priority</Text>
                <TouchableOpacity style={styles.selectField} onPress={() => setSubPicker('priority')} activeOpacity={0.85}>
                  <Text style={styles.selectFieldText}>{labelFor(createPriorityOptions, subPriority, 'Medium')}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <View style={styles.switchRow}>
                  <Text style={styles.fieldLabel}>All day</Text>
                  <Switch
                    value={subAllDay}
                    onValueChange={setSubAllDay}
                    trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
                    thumbColor={subAllDay ? '#2563eb' : '#f4f4f5'}
                  />
                </View>

                {subAllDay ? (
                  <>
                    <Text style={styles.fieldLabel}>Date</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setSubPicker('start')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(subStartStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(subStartStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>Start Time</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setSubPicker('start')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(subStartStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(subStartStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>End Time</Text>
                    <TouchableOpacity style={styles.datetimeTrigger} onPress={() => setSubPicker('end')} activeOpacity={0.85}>
                      <Text style={[styles.datetimeTriggerText, !displayLocalFromStr(subEndStr) && styles.datetimeTriggerPh]}>
                        {displayLocalFromStr(subEndStr) || 'dd-mm-yyyy --:--'}
                      </Text>
                      <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                    </TouchableOpacity>
                  </>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelOutlineBtn}
                    onPress={() => {
                      setSubPicker(null);
                      setSubtaskParent(null);
                    }}
                  >
                    <Text style={styles.cancelOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, subSaving && styles.disabled]}
                    onPress={() => void submitSubtask()}
                    disabled={subSaving}
                  >
                    <Text style={styles.saveButtonText}>{subSaving ? 'Saving…' : 'Create Sub Task'}</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </ScrollView>

            {subPicker ? (
              <View style={styles.createModalPickerLayer} pointerEvents="box-none">
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setSubPicker(null)} />
                <View
                  style={[
                    styles.createModalPickerBox,
                    (subPicker === 'start' || subPicker === 'end') && styles.createModalPickerWide,
                  ]}
                  pointerEvents="auto"
                >
                  {subPicker === 'start' || subPicker === 'end' ? (
                    <>
                      <Text style={styles.createModalPickerTitle}>
                        {subPicker === 'start' ? 'Start time' : 'End time'}
                      </Text>
                      <TaskDueDateTimePanel
                        key={subPicker}
                        initialMs={
                          parseUserDateTime(subPicker === 'start' ? subStartStr : subEndStr)?.getTime() ?? Date.now()
                        }
                        onCommit={(iso) => {
                          if (subPicker === 'start') setSubStartStr(iso);
                          else setSubEndStr(iso);
                          setSubPicker(null);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.createModalPickerTitle}>
                        {subPicker === 'assign' ? 'Assign to User' : 'Priority'}
                      </Text>
                      <FlatList
                        data={subPicker === 'assign' ? subtaskAssignOptions : createPriorityOptions}
                        keyExtractor={(i) => i.id}
                        keyboardShouldPersistTaps="handled"
                        style={styles.createModalPickerList}
                        renderItem={({ item: opt }) => {
                          const selectedId = subPicker === 'assign' ? subAssignKey : subPriority;
                          return (
                            <TouchableOpacity
                              style={modalStyles.row}
                              onPress={() => {
                                if (subPicker === 'assign') setSubAssignKey(opt.id);
                                else setSubPriority(opt.id);
                                setSubPicker(null);
                              }}
                            >
                              <Text style={modalStyles.rowText}>{opt.label}</Text>
                              {selectedId === opt.id ? (
                                <MaterialCommunityIcons name="check" size={22} color="#2563eb" />
                              ) : (
                                <View style={{ width: 22 }} />
                              )}
                            </TouchableOpacity>
                          );
                        }}
                      />
                    </>
                  )}
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  listContent: { paddingHorizontal: 20, paddingBottom: 40 },
  listContentEmpty: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 40 },

  headerBlock: { paddingTop: 8 },
  topRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 16,
  },
  titleBlock: { flex: 1, minWidth: 200 },
  titleIconRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleIconSquare: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: { fontSize: 26, fontWeight: '700', color: '#0f172a' },
  pageSubtitle: { fontSize: 14, color: '#64748b', marginTop: 6, lineHeight: 20 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  refreshBtnText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  newTaskBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(37, 99, 235, 0.25)' },
      default: { elevation: 2 },
    }),
  },
  newTaskBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 16,
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)' },
      default: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 2,
      },
    }),
  },
  filtersLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  filtersLabel: { fontSize: 14, fontWeight: '600', color: '#475569' },
  filterScroll: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 8 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    maxWidth: 200,
  },
  filterChipText: { flexShrink: 1, fontSize: 14, fontWeight: '500', color: '#0f172a' },

  contentCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 320,
    marginBottom: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)' },
      default: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 2,
      },
    }),
  },
  emptyInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  emptySubtitle: { fontSize: 15, color: '#64748b', textAlign: 'center', marginBottom: 24 },
  createTaskBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  createTaskBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  card: {
    flexDirection: 'column',
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 10,
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)' },
      default: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 2,
      },
    }),
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priorityPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  priorityPillSm: { marginTop: 8, alignSelf: 'flex-start' },
  priorityPillText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  chevronHit: { padding: 4, marginLeft: 4 },
  cardExpanded: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  expandedHead: { marginBottom: 12 },
  expandedTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    marginBottom: 16,
  },
  actionOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  actionOutlineText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  markDoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  markDoneText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  notesLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 8 },
  notesBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#f8fafc',
    minHeight: 72,
    marginBottom: 16,
  },
  notesBody: { fontSize: 14, color: '#334155', lineHeight: 20 },
  notesPlaceholderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notesPlaceholder: { fontSize: 14, color: '#94a3b8' },
  subtasksBlock: { marginBottom: 12 },
  subtasksTitle: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8 },
  subtaskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  subtaskTitle: { fontSize: 14, color: '#0f172a', flex: 1 },
  deleteTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  deleteTaskText: { fontSize: 15, fontWeight: '600', color: '#dc2626' },
  assignCurrentBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f1f5f9',
  },
  assignCurrentText: { fontSize: 16, color: '#64748b' },
  datetimeTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f8fafc',
  },
  datetimeTriggerText: { flex: 1, fontSize: 16, color: '#0f172a' },
  datetimeTriggerPh: { color: '#94a3b8' },
  checkRow: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#2563eb',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  cardMain: { flex: 1, minWidth: 0 },
  taskTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  taskTitleDone: { textDecorationLine: 'line-through', color: '#94a3b8' },
  taskMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  deleteBtn: { padding: 8, marginLeft: 4 },
  deleteBtnPressed: { opacity: 0.7 },

  disabled: { opacity: 0.65 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  createModalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    position: 'relative',
  },
  createModalScrollView: {
    zIndex: 1,
    ...Platform.select({
      web: { position: 'relative' as const },
      default: {},
    }),
  },
  createModalScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  createModalPickerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 24,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  createModalPickerBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    paddingVertical: 8,
    overflow: 'hidden',
    zIndex: 101,
    elevation: 25,
    ...Platform.select({
      web: {
        boxShadow: '0 12px 48px rgba(15, 23, 42, 0.25)',
      },
      default: {},
    }),
  },
  createModalPickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  createModalPickerList: { maxHeight: 320 },
  createModalPickerWide: { maxWidth: 520 },
  createModalBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    ...Platform.select({
      web: { boxShadow: '0 10px 40px rgba(15, 23, 42, 0.15)' },
      default: { elevation: 8 },
    }),
  },
  createModalHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20, gap: 8 },
  createModalTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  createModalSubtitle: { fontSize: 14, color: '#64748b', marginTop: 6, lineHeight: 20 },
  closeBtn: { padding: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6, marginTop: 12 },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f8fafc',
  },
  selectFieldText: { flex: 1, fontSize: 16, color: '#0f172a' },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  textArea: { minHeight: 100, paddingTop: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 4,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelOutlineBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  cancelOutlineText: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  saveButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  saveButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
