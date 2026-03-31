import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
  Alert,
  FlatList,
  Platform,
  KeyboardAvoidingView,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getPrimaryRoleFromUser, getRoleDisplayLabel, type UserRole } from '../types/auth';
import * as api from '../api';

/** Section header gradients (sessions / admin cards) */
const GRAD_SESSIONS = ['#8E24AA', '#D81B60'] as const;
const GRAD_ADMIN = ['#0288D1', '#00BCD4'] as const;

/** Focus timer — solid purple header & digits (matches web reference) */
const FOCUS_PURPLE = '#7C3AED';
const TIMER_ACCENT = FOCUS_PURPLE;
const SESSIONS_PURPLE = '#8E24AA';
const SESSIONS_PINK = '#D81B60';

const PURPLE = '#7E57C2';
const GREEN = '#22C55E';
const STOP_ROSE = '#F43F5E';
const PEACH_BG = '#FFEDD5';
const PEACH_BORDER = '#FDBA74';
const PEACH_TEXT = '#C2410C';
const PAGE_BG = '#F5F7F9';

type PickerOption = { id: string; label: string };

type AdminSelectableUser = { id: string; label: string; primaryRole: UserRole };

function CardHeaderGradient({ colors }: { colors: readonly [string, string] }) {
  return (
    <LinearGradient
      colors={[colors[0], colors[1]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={StyleSheet.absoluteFillObject}
    />
  );
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sessionStart(s: any): Date | null {
  const t =
    s.start_time ??
    s.starts_at ??
    s.session_start ??
    s.focus_start ??
    s.started_at ??
    s.start ??
    s.planned_start ??
    s.clock_in_time ??
    s.clocked_in_at ??
    s.clock_in ??
    s.check_in_time ??
    s.check_in ??
    s.begin_time ??
    s.began_at;
  if (t == null || t === '') return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** When the API omits start_time but has created_at, still show/filter sessions in “This week”. */
function effectiveSessionStart(s: any): Date | null {
  const st = sessionStart(s);
  if (st) return st;
  const raw = s?.created_at ?? s?.created ?? s?.updated_at;
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function durationMinutesFromRaw(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'string' ? parseFloat(raw.trim()) : Number(raw);
  if (Number.isNaN(n)) return null;
  if (n > 1000) return Math.max(0, Math.round(n / 60));
  return Math.max(0, Math.round(n));
}

function sessionDurationMinutes(s: any): number | null {
  const fromFields = durationMinutesFromRaw(
    s.actual_duration ?? s.duration_minutes ?? s.duration_mins ?? s.duration ?? s.total_duration_minutes
  );
  if (fromFields != null) return fromFields;

  const fromSeconds = s.actual_duration_seconds ?? s.duration_seconds ?? s.total_duration_seconds ?? s.seconds;
  if (typeof fromSeconds === 'number' && !Number.isNaN(fromSeconds)) {
    return Math.max(0, Math.round(fromSeconds / 60));
  }

  const start = sessionStart(s) ?? effectiveSessionStart(s);
  const end = sessionEnd(s);
  if (start && end) {
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  // In progress (no end): show elapsed minutes like the web list.
  if (start && !end) {
    const st = sessionStatusRaw(s);
    if (
      st === 'in_progress' ||
      st === 'active' ||
      st === 'running' ||
      st === 'paused' ||
      st.includes('pause')
    ) {
      return Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
    }
  }

  return null;
}

function sessionDurationLabel(s: any): string {
  const n = sessionDurationMinutes(s);
  if (n == null) return '—';
  if (n < 1) return '0m';
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function sessionDistractionCount(s: any): number {
  const v = s.distractions ?? s.interruptions ?? s.interruption_count ?? 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const p = parseInt(String(v), 10);
  return Number.isNaN(p) ? 0 : p;
}

function sessionDateTimeBadges(s: any): { date: string; time: string } {
  const start = sessionStart(s) ?? effectiveSessionStart(s);
  if (!start) return { date: '—', time: '' };
  return {
    date: start.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: 'numeric' }),
    time: start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
  };
}

function sessionEnd(s: any): Date | null {
  const t =
    s.end_time ??
    s.ended_at ??
    s.end ??
    s.clock_out_time ??
    s.clocked_out_at ??
    s.clock_out ??
    s.check_out_time ??
    s.check_out ??
    s.finish_time ??
    s.finished_at;
  if (t == null || t === '') return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sessionId(s: any): string {
  const id = s?.id ?? s?.pk ?? s?.uuid;
  return id != null ? String(id) : '';
}

/** Owning user id for a focus session. `null` = API did not expose owner (only acceptable on JWT-scoped “my” lists). */
function sessionOwnerId(s: any): string | null {
  const u = s?.user;
  if (u != null && typeof u === 'object') {
    if (u.id != null) return String(u.id);
    if (u.pk != null) return String(u.pk);
    if (u.uuid != null) return String(u.uuid);
  }
  const raw =
    u ??
    s?.user_id ??
    s?.owner ??
    s?.created_by ??
    s?.member ??
    s?.assigned_user;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && raw?.id != null) return String(raw.id);
  if (typeof raw === 'string' || typeof raw === 'number') {
    const str = String(raw).trim();
    return str.length ? str : null;
  }
  return null;
}

function filterSessionsForSelf(list: any[], uid: string): any[] {
  const id = String(uid);
  return (Array.isArray(list) ? list : []).filter((s) => {
    const oid = sessionOwnerId(s);
    if (oid == null) return true;
    return oid === id;
  });
}

/** Team view: never show a row unless it clearly belongs to the selected user. */
function filterSessionsForOtherUser(list: any[], uid: string): any[] {
  const id = String(uid);
  return (Array.isArray(list) ? list : []).filter((s) => {
    const oid = sessionOwnerId(s);
    if (oid == null) return false;
    return oid === id;
  });
}

function sessionStatusRaw(s: any): string {
  return String(s?.status ?? s?.session_status ?? '').toLowerCase().replace(/-/g, '_');
}

/** Elapsed time while paused (when backend exposes it). */
function elapsedMsFromServerSession(s: any): number | null {
  const sec = s.elapsed_seconds ?? s.total_elapsed_seconds;
  if (typeof sec === 'number' && !Number.isNaN(sec)) return Math.round(sec * 1000);
  const ms = s.elapsed_ms ?? s.total_elapsed_ms;
  if (typeof ms === 'number' && !Number.isNaN(ms)) return ms;
  const pa = s.paused_at ?? s.pause_time ?? s.paused_at_time;
  const start = effectiveSessionStart(s);
  if (start && pa) {
    const pt = new Date(pa).getTime();
    if (!Number.isNaN(pt)) return Math.max(0, pt - start.getTime());
  }
  return null;
}

/** Open session started elsewhere (e.g. web): no end_time, in progress or paused. */
function findActiveSessionFromList(list: any[]): any | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const open = list.filter((s) => {
    if (sessionEnd(s)) return false;
    const st = sessionStatusRaw(s);
    if (st.includes('complete') || st.includes('done') || st.includes('cancel')) return false;
    if (st === 'planned') return false;
    if (
      st === 'in_progress' ||
      st === 'active' ||
      st === 'running' ||
      st === 'paused' ||
      st.includes('pause')
    ) {
      return true;
    }
    if (!st) {
      const start = effectiveSessionStart(s);
      return !!(start && start.getTime() <= Date.now());
    }
    return false;
  });
  if (open.length === 0) return null;
  open.sort(
    (a, b) => (effectiveSessionStart(b)?.getTime() ?? 0) - (effectiveSessionStart(a)?.getTime() ?? 0)
  );
  return open[0];
}

function findSessionById(list: any[], id: string): any | undefined {
  return list.find((s) => sessionId(s) === id);
}

function inferStatus(s: any): 'completed' | 'planned' | 'active' {
  const st = String(s.status ?? s.session_status ?? '').toLowerCase().replace(/-/g, '_');
  if (st === 'planned') return 'planned';
  if (st === 'in_progress') return 'active';
  if (st === 'completed' || st.includes('complete') || st.includes('done')) return 'completed';
  if (st.includes('plan')) return 'planned';
  if (st.includes('active') || st.includes('progress') || st.includes('running')) return 'active';
  if (sessionEnd(s)) return 'completed';
  const start = effectiveSessionStart(s);
  if (start) {
    const now = Date.now();
    if (start.getTime() > now) return 'planned';
    return 'active';
  }
  return 'completed';
}

/** Matches web filters: task-based vs free-form vs planned */
function sessionKind(s: any): 'task' | 'freeform' | 'planned' {
  if (inferStatus(s) === 'planned') return 'planned';
  if (s.task_id != null && String(s.task_id).trim() !== '') return 'task';
  const st = String(s.session_type ?? s.type ?? '').toLowerCase();
  if (st.includes('task')) return 'task';
  if (st.includes('free')) return 'freeform';
  const hasTaskLink =
    s.calendar_event != null ||
    s.event != null ||
    (typeof s.calendar_event === 'object' && s.calendar_event != null);
  if (hasTaskLink) return 'task';
  const title = String(s.title || '').toLowerCase();
  if (title.includes('task') && !title.includes('productive')) return 'task';
  if (title === 'productive session' || title.startsWith('productive')) return 'freeform';
  return 'freeform';
}

function formatTimer(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatSessionWhen(s: any): string {
  const start = sessionStart(s) ?? effectiveSessionStart(s);
  if (!start) return '—';
  const end = sessionEnd(s);
  if (end) {
    return `${start.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} – ${end.toLocaleString([], { timeStyle: 'short' })}`;
  }
  return start.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function isTaskLikeEvent(ev: any): boolean {
  if (!ev || typeof ev !== 'object') return false;
  const et = String(ev.event_type ?? ev.type ?? ev.kind ?? '').toLowerCase();
  if (et.includes('task')) return true;
  const sub = String(ev.event_subtype ?? ev.task_category ?? ev.category ?? '').toLowerCase();
  if (sub.includes('task')) return true;
  if (ev.priority != null) return true;
  if (ev.completed === true || ev.is_completed === true || ev.done === true || ev.is_done === true) return true;
  return false;
}

function taskStartMs(ev: any): number | null {
  const raw = ev?.start_time ?? ev?.start ?? ev?.created_at ?? ev?.created;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function PickerModal({
  visible,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={pmStyles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={pmStyles.box}>
          <Text style={pmStyles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={pmStyles.row}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={pmStyles.rowText}>{item.label}</Text>
                {selectedId === item.id ? (
                  <MaterialCommunityIcons name="check" size={22} color={PURPLE} />
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

const pmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  overlayDark: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  box: {
    backgroundColor: '#fff',
    borderRadius: 14,
    maxHeight: '70%',
    paddingVertical: 8,
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

/** Team focus panel: Super Admin, Organization Manager, Company Manager only (not generic admin). */
function canViewTeamFocusSessions(role: UserRole | null): boolean {
  if (!role) return false;
  return ['super_admin', 'operations_manager', 'manager'].includes(role);
}

export default function FocusScreen() {
  const { user, role, isLoading: authLoading } = useAuth();
  const isFocused = useIsFocused();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mySessions, setMySessions] = useState<any[]>([]);
  const [adminSessions, setAdminSessions] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminSelectableUser[]>([]);

  const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'freeform' | 'planned'>('all');
  const [timePicker, setTimePicker] = useState(false);
  const [typePicker, setTypePicker] = useState(false);

  /** Selected team member only (never the logged-in user). */
  const [adminUserId, setAdminUserId] = useState<string>('');
  const [adminUserPicker, setAdminUserPicker] = useState(false);

  const [tick, setTick] = useState(0);
  /** Elapsed milliseconds accumulated while paused (and final segments). */
  const [accumulatedMs, setAccumulatedMs] = useState(0);
  /** When non-null, timer is running and we add (now - runStart) to accumulatedMs. */
  const [runStart, setRunStart] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [interruptions, setInterruptions] = useState(0);
  const [sessionNotes, setSessionNotes] = useState('');

  const [taskModal, setTaskModal] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);

  const [planModal, setPlanModal] = useState(false);
  const [planTitle, setPlanTitle] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planStartStr, setPlanStartStr] = useState('');
  const [planLinkedEventId, setPlanLinkedEventId] = useState<string | null>(null);
  const [planDurationMin, setPlanDurationMin] = useState('25');
  const [planTaskPicker, setPlanTaskPicker] = useState(false);
  const [durationPicker, setDurationPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const showTeamPanel = canViewTeamFocusSessions(role);

  /**
   * Self: JWT-scoped list first, then `?user=` variants. Rows are filtered to `uid` when `user` is set.
   *
   * Team (other user): only `?user=`-style requests — never unfiltered JWT (that is the viewer’s
   * data). Every row must have `sessionOwnerId === uid` or it is dropped (no wrong data).
   */
  const fetchSessionsForUser = useCallback(async (uid: string, mode: 'self' | 'other'): Promise<any[]> => {
    const userQueryVariants: Array<Record<string, any>> = [
      { user: uid },
      { user_id: uid },
      { userId: uid },
      { owner: uid },
      { created_by: uid },
    ];

    let last: unknown;

    const tryGet = async (extra?: Record<string, any>) => {
      return api.getFocusSessions(extra ? { ...extra } : {});
    };

    if (mode === 'self') {
      const attempts: Array<Record<string, any> | undefined> = [undefined, ...userQueryVariants];
      let jwtScopedList: any[] | null = null;
      for (const extra of attempts) {
        try {
          const raw = await tryGet(extra);
          const list = Array.isArray(raw) ? raw : [];
          if (list.length === 0) continue;
          if (!extra) jwtScopedList = list;
          const filtered = filterSessionsForSelf(list, uid);
          if (filtered.length > 0) return filtered;
        } catch (e) {
          last = e;
        }
      }
      // JWT-scoped list is already limited to the current user; if rows omit `user` or use a shape
      // we don't match, filtering can drop everything — still show the list.
      if (jwtScopedList && jwtScopedList.length > 0) return jwtScopedList;
    } else {
      for (const extra of userQueryVariants) {
        try {
          const raw = await tryGet(extra);
          const list = Array.isArray(raw) ? raw : [];
          if (list.length === 0) continue;
          const filtered = filterSessionsForOtherUser(list, uid);
          if (filtered.length > 0) return filtered;
        } catch (e) {
          last = e;
        }
      }
    }
    if (last) throw last;
    return [];
  }, []);

  const loadMySessions = useCallback(async () => {
    if (!user?.id) return;
    try {
      const list = await fetchSessionsForUser(String(user.id), 'self');
      setMySessions(list);
    } catch (e) {
      console.warn(e);
    }
  }, [user?.id, fetchSessionsForUser]);

  const loadAdminSessions = useCallback(async () => {
    if (!showTeamPanel || !user?.id) return;
    if (!adminUserId || String(adminUserId) === String(user.id)) {
      setAdminSessions([]);
      return;
    }
    try {
      const list = await fetchSessionsForUser(String(adminUserId), 'other');
      setAdminSessions(list);
    } catch (e) {
      console.warn(e);
    }
  }, [showTeamPanel, user?.id, adminUserId, fetchSessionsForUser]);

  const loadAdminUsers = useCallback(async () => {
    if (!showTeamPanel) return;
    const myId = user?.id != null ? String(user.id) : '';
    const viewerIsSuperAdmin = role === 'super_admin';
    try {
      const raw = await api.getUsers({}).catch(() => []);
      const list = (Array.isArray(raw) ? raw : [])
        .filter((u: any) => (u.profile?.status ?? u.status) !== 'deleted')
        .map((u: any) => {
          const id = String(u.id);
          const primaryRole = getPrimaryRoleFromUser(u);
          return {
            id,
            label: u.profile?.full_name || u.full_name || u.email || u.username || id,
            primaryRole,
          };
        })
        .filter((u) => myId && u.id !== myId)
        .filter((u) => !(viewerIsSuperAdmin && u.primaryRole === 'super_admin'));
      setAdminUsers(list);
    } catch (e) {
      console.warn(e);
    }
  }, [showTeamPanel, user?.id, role]);

  const load = useCallback(async () => {
    if (authLoading) return;
    await Promise.all([loadMySessions(), loadAdminSessions(), loadAdminUsers()]);
    setLoading(false);
    setRefreshing(false);
  }, [authLoading, loadMySessions, loadAdminSessions, loadAdminUsers]);

  useEffect(() => {
    load();
  }, [load]);

  // If you clock in on web, then return to this screen, we need to refetch.
  useEffect(() => {
    if (!isFocused) return;
    load();
  }, [isFocused, load]);

  useEffect(() => {
    loadAdminSessions();
  }, [adminUserId, loadAdminSessions]);

  const resetLocalSession = useCallback(() => {
    setAccumulatedMs(0);
    setRunStart(null);
    setActiveSessionId(null);
    setInterruptions(0);
    setSessionNotes('');
  }, []);

  /** Apply server `start_time` + status (session started on web / another client). Only call when session id differs from local. */
  const syncActiveFromBackendRow = useCallback((s: any) => {
    const sid = sessionId(s);
    if (!sid) return;
    setActiveSessionId(sid);
    setInterruptions(sessionDistractionCount(s));
    setSessionNotes(String(s.notes ?? s.notes_text ?? '').trim());
    const st = sessionStatusRaw(s);
    const start = effectiveSessionStart(s);
    const startMs = start ? start.getTime() : Date.now();
    if (st === 'paused' || st.includes('pause')) {
      const pausedMs = elapsedMsFromServerSession(s);
      setAccumulatedMs(pausedMs ?? 0);
      setRunStart(null);
    } else {
      setAccumulatedMs(0);
      setRunStart(startMs);
    }
  }, []);

  /** Pick up an in-progress session started on web; align timer to server `start_time` (full sync only when session id changes). */
  useEffect(() => {
    if (!user?.id || loading) return;
    const active = findActiveSessionFromList(mySessions);
    if (active) {
      const sid = sessionId(active);
      if (sid !== activeSessionId) {
        syncActiveFromBackendRow(active);
      } else {
        setInterruptions(sessionDistractionCount(active));
      }
      return;
    }
    if (activeSessionId) {
      const row = findSessionById(mySessions, activeSessionId);
      if (row && (sessionEnd(row) || sessionStatusRaw(row).includes('complete'))) {
        resetLocalSession();
      }
    }
  }, [mySessions, loading, user?.id, activeSessionId, syncActiveFromBackendRow, resetLocalSession]);

  /** Poll + refresh single session so timer stays consistent while another client updates the session. */
  useEffect(() => {
    if (!isFocused || !user?.id) return;
    const id = setInterval(() => {
      void loadMySessions();
      const sid = activeSessionId;
      if (!sid) return;
      void (async () => {
        try {
          const one = await api.getFocusSession(sid);
          if (one && !sessionEnd(one) && !sessionStatusRaw(one).includes('complete')) {
            setInterruptions(sessionDistractionCount(one));
          }
          if (one && (sessionEnd(one) || sessionStatusRaw(one).includes('complete'))) {
            resetLocalSession();
          }
        } catch {
          /* ignore */
        }
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [isFocused, user?.id, activeSessionId, loadMySessions, resetLocalSession]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void load();
    });
    return () => sub.remove();
  }, [load]);

  /** Default team selection when the list loads (never includes the logged-in user). */
  useEffect(() => {
    if (!showTeamPanel) return;
    const ids = adminUsers.map((u) => u.id);
    if (ids.length === 0) {
      setAdminUserId('');
      return;
    }
    if (!adminUserId || !ids.includes(adminUserId)) {
      setAdminUserId(ids[0]);
    }
  }, [showTeamPanel, adminUsers, adminUserId]);

  useEffect(() => {
    if (!runStart) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [runStart]);

  const elapsedMsLive = useMemo(() => {
    void tick;
    return accumulatedMs + (runStart != null ? Date.now() - runStart : 0);
  }, [accumulatedMs, runStart, tick]);

  const elapsedSec = useMemo(() => Math.max(0, Math.floor(elapsedMsLive / 1000)), [elapsedMsLive]);

  const hasActiveSession = activeSessionId != null;

  const filterSessions = useCallback(
    (list: any[]) => {
      let out = [...list];
      const now = new Date();
      if (timeFilter === 'week') {
        const start = startOfWeekMonday(now);
        out = out.filter((s) => {
          const st = effectiveSessionStart(s);
          return st && st >= start;
        });
      } else if (timeFilter === 'month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        out = out.filter((s) => {
          const st = effectiveSessionStart(s);
          return st && st >= start;
        });
      }
      if (typeFilter === 'task') {
        out = out.filter((s) => sessionKind(s) === 'task');
      } else if (typeFilter === 'freeform') {
        out = out.filter((s) => sessionKind(s) === 'freeform');
      } else if (typeFilter === 'planned') {
        out = out.filter((s) => sessionKind(s) === 'planned');
      }
      return out.sort((a, b) => {
        const ta = effectiveSessionStart(a)?.getTime() ?? 0;
        const tb = effectiveSessionStart(b)?.getTime() ?? 0;
        return tb - ta;
      });
    },
    [timeFilter, typeFilter]
  );

  const filteredMySessions = useMemo(() => filterSessions(mySessions), [mySessions, filterSessions]);
  const filteredAdminSessions = useMemo(() => filterSessions(adminSessions), [adminSessions, filterSessions]);

  const timeOptions: PickerOption[] = useMemo(
    () => [
      { id: 'week', label: 'This Week' },
      { id: 'month', label: 'This Month' },
      { id: 'all', label: 'All Time' },
    ],
    []
  );

  const typeOptions: PickerOption[] = useMemo(
    () => [
      { id: 'all', label: 'All Sessions' },
      { id: 'task', label: 'Task-based' },
      { id: 'freeform', label: 'Free-form' },
      { id: 'planned', label: 'Planned' },
    ],
    []
  );

  const timeLabel = timeOptions.find((o) => o.id === timeFilter)?.label ?? 'This Week';
  const typeLabel = typeOptions.find((o) => o.id === typeFilter)?.label ?? 'All Sessions';

  const adminUserOptions: PickerOption[] = useMemo(
    () => adminUsers.map((u) => ({ id: u.id, label: u.label })),
    [adminUsers]
  );

  const adminUserLabel = adminUsers.find((u) => u.id === adminUserId)?.label ?? 'Select a team member';

  const endRunningSession = async () => {
    if (!activeSessionId) return;
    const endMs = accumulatedMs + (runStart != null ? Date.now() - runStart : 0);
    const elapsedSeconds = Math.max(0, Math.floor(endMs / 1000));
    const endIso = new Date().toISOString();
    const minutes = Math.max(1, Math.floor(elapsedSeconds / 60));
    setSaving(true);
    try {
      await api.updateFocusSession(activeSessionId, {
        end_time: endIso,
        actual_duration: minutes,
        status: 'completed',
        distractions: interruptions,
        notes: sessionNotes.trim() || '',
      });
      resetLocalSession();
      await loadMySessions();
      Alert.alert('Session saved', 'Your focus session was recorded.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save session');
    } finally {
      setSaving(false);
    }
  };

  const pauseSession = async () => {
    if (!activeSessionId || runStart == null) return;
    const now = Date.now();
    setAccumulatedMs((a) => a + (now - runStart));
    setRunStart(null);
    try {
      await api.updateFocusSession(activeSessionId, { status: 'paused' });
    } catch {
      /* optional field */
    }
  };

  const resumeSession = async () => {
    if (!activeSessionId || runStart != null) return;
    setRunStart(Date.now());
    try {
      await api.updateFocusSession(activeSessionId, { status: 'in_progress' });
    } catch {
      /* optional field */
    }
  };

  const addInterruption = async () => {
    if (!activeSessionId) return;
    const next = interruptions + 1;
    setInterruptions(next);
    try {
      await api.updateFocusSession(activeSessionId, { distractions: next });
    } catch {
      /* keep local count */
    }
  };

  const beginProductiveSession = async () => {
    if (hasActiveSession) {
      if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
        if ((globalThis as any).confirm('End current session and save?')) void endRunningSession();
        return;
      }
      Alert.alert('Session active', 'End and save your current session first?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End & save', onPress: () => void endRunningSession() },
      ]);
      return;
    }
    setSaving(true);
    try {
      const startIso = new Date().toISOString();
      const created = await api.createFocusSession({
        title: 'Productive session',
        start_time: startIso,
        end_time: null,
        planned_duration: 25,
        status: 'in_progress',
        distractions: 0,
        notes: '',
      });
      const sid = sessionId(created);
      if (!sid) throw new Error('No session id returned');
      setActiveSessionId(sid);
      setAccumulatedMs(0);
      setRunStart(effectiveSessionStart(created)?.getTime() ?? Date.now());
      setInterruptions(0);
      setSessionNotes('');
      await loadMySessions();
    } catch (e2: any) {
      Alert.alert('Error', e2?.message || 'Could not start session');
      resetLocalSession();
    } finally {
      setSaving(false);
    }
  };

  const openTaskModal = async () => {
    if (hasActiveSession) {
      Alert.alert('Session active', 'End your current session before starting one on a task.');
      return;
    }
    setSelectedTask(null);
    setTaskModal(true);
    setTasksLoading(true);
    try {
      const raw = await api.getCalendarEvents({}).catch(() => []);
      const list = Array.isArray(raw) ? raw : [];
      const tasksOnly = list.filter((t) => isTaskLikeEvent(t));
      tasksOnly.sort((a, b) => (taskStartMs(b) ?? 0) - (taskStartMs(a) ?? 0));
      setTasks(tasksOnly);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  };

  const startSessionForTask = async (ev: any) => {
    if (!ev) return;
    const eid = ev?.id ?? ev?.pk;
    const title = String(ev?.title || ev?.name || 'Task focus').slice(0, 200);
    setTaskModal(false);
    setSelectedTask(null);
    setSaving(true);
    const body: Record<string, any> = {
      title: `Focus: ${title}`,
      start_time: new Date().toISOString(),
      end_time: null,
      planned_duration: 25,
      status: 'in_progress',
      distractions: 0,
      notes: '',
    };
    if (eid != null) body.task_id = String(eid);
    try {
      const created = await api.createFocusSession(body);
      const sid = sessionId(created);
      if (!sid) throw new Error('No session id returned');
      setActiveSessionId(sid);
      setAccumulatedMs(0);
      setRunStart(effectiveSessionStart(created)?.getTime() ?? Date.now());
      setInterruptions(0);
      setSessionNotes('');
      await loadMySessions();
    } catch (e2: any) {
      Alert.alert('Error', e2?.message || 'Could not start task session');
      resetLocalSession();
    } finally {
      setSaving(false);
    }
  };

  const submitPlan = async () => {
    const start = planStartStr.trim() ? new Date(planStartStr.trim()) : null;
    if (!start || Number.isNaN(start.getTime())) {
      Alert.alert('Validation', 'Enter a valid planned date and time.');
      return;
    }
    const durationMins = parseInt(planDurationMin, 10) || 25;
    if (durationMins < 1) {
      Alert.alert('Validation', 'Choose a valid duration in minutes.');
      return;
    }
    const title = planTitle.trim();
    if (!title) {
      Alert.alert('Validation', 'Enter a session title.');
      return;
    }
    setSaving(true);
    const end = new Date(start.getTime() + durationMins * 60 * 1000);
    const body: Record<string, any> = {
      title,
      description: planDescription.trim() || null,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      planned_duration: durationMins,
      status: 'planned',
      distractions: 0,
      notes: 'Planned session - not yet started',
    };
    if (planLinkedEventId) body.task_id = planLinkedEventId;
    try {
      await api.createFocusSession(body);
      setPlanModal(false);
      setPlanTitle('');
      setPlanDescription('');
      setPlanStartStr('');
      setPlanLinkedEventId(null);
      setPlanDurationMin('25');
      await loadMySessions();
      Alert.alert('Planned', 'Session added to your plan.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not plan session');
    } finally {
      setSaving(false);
    }
  };

  const openPlanModal = () => {
    if (hasActiveSession) {
      Alert.alert('Session active', 'End your current session before planning another.');
      return;
    }
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setPlanStartStr(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setPlanTitle('');
    setPlanDescription('');
    setPlanLinkedEventId(null);
    setPlanDurationMin('25');
    setPlanModal(true);
    void (async () => {
      try {
        const raw = await api.getCalendarEvents({}).catch(() => []);
        const list = Array.isArray(raw) ? raw : [];
        const tasksOnly = list.filter((t) => isTaskLikeEvent(t));
        tasksOnly.sort((a, b) => (taskStartMs(b) ?? 0) - (taskStartMs(a) ?? 0));
        if (tasksOnly.length) setTasks(tasksOnly);
      } catch {
        /* keep existing task list */
      }
    })();
  };

  const planLinkedLabel = () => {
    if (!planLinkedEventId) return 'Select a task to link…';
    const ev = tasks.find((t) => String(t?.id ?? t?.pk) === planLinkedEventId);
    return ev ? String(ev.title || ev.name || 'Task') : 'Task linked';
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={PURPLE} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageTitleBlock}>
          <Text style={styles.pageTitle}>Focus Hours</Text>
          <Text style={styles.pageSubtitle}>Track your focus work time and efficiency</Text>
        </View>

        {/* Filters — matches web: above timer & session cards */}
        <View style={styles.filterBar}>
          <View style={styles.filterLeft}>
            <MaterialCommunityIcons name="filter-variant" size={20} color="#64748b" />
            <Text style={styles.filterLabel}>Filters:</Text>
          </View>
          <View style={styles.filterRight}>
            <TouchableOpacity style={styles.filterChip} onPress={() => setTimePicker(true)}>
              <Text style={styles.filterChipText}>{timeLabel}</Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.filterChip} onPress={() => setTypePicker(true)}>
              <Text style={styles.filterChipText}>{typeLabel}</Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Focus Timer */}
        <View style={styles.card}>
          <View style={styles.timerHeaderWrap}>
            <View style={styles.timerHeaderSolid} />
            <View style={styles.timerHeaderInner}>
              <MaterialCommunityIcons name="timer-outline" size={26} color="#fff" />
              <View style={styles.timerHeaderTextCol}>
                <Text style={styles.timerHeaderTitle}>Focus Timer</Text>
                <Text style={styles.timerHeaderSub}>
                  {hasActiveSession
                    ? 'Session in progress—pause, resume, or stop when you are done'
                    : 'Begin a focus session to track your efficiency'}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.timerBody}>
            <Text style={[styles.timerDigits, { color: FOCUS_PURPLE }]}>{formatTimer(elapsedSec)}</Text>
            <View style={styles.timerStatusDotRow}>
              <View
                style={[
                  styles.timerLiveDot,
                  hasActiveSession && runStart != null && styles.timerLiveDotOn,
                  hasActiveSession && runStart == null && styles.timerLiveDotPaused,
                ]}
              />
            </View>

            {hasActiveSession ? (
              <>
                <View style={styles.interruptRow}>
                  <View style={styles.interruptBadge}>
                    <Text style={styles.interruptBadgeText}>Interruptions: {interruptions}</Text>
                  </View>
                  <TouchableOpacity style={styles.interruptAddBtn} onPress={() => void addInterruption()} activeOpacity={0.85}>
                    <Text style={styles.interruptAddBtnText}>+1 Interruption</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.sessionControlRow}>
                  {runStart != null ? (
                    <TouchableOpacity
                      style={[styles.ctrlBtn, styles.ctrlPause]}
                      onPress={() => void pauseSession()}
                      disabled={saving}
                      activeOpacity={0.9}
                    >
                      <MaterialCommunityIcons name="pause" size={20} color="#fff" />
                      <Text style={styles.ctrlBtnTextLight}>Pause</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.ctrlBtn, styles.ctrlResume]}
                      onPress={() => void resumeSession()}
                      disabled={saving}
                      activeOpacity={0.9}
                    >
                      <MaterialCommunityIcons name="play" size={20} color="#fff" />
                      <Text style={styles.ctrlBtnTextLight}>Resume</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.ctrlBtn, styles.ctrlStop]}
                    onPress={() => void endRunningSession()}
                    disabled={saving}
                    activeOpacity={0.9}
                  >
                    <MaterialCommunityIcons name="stop" size={20} color="#fff" />
                    <Text style={styles.ctrlBtnTextLight}>Stop Session</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.timerBtnRow}>
                <View style={styles.timerBtnWrap}>
                  <TouchableOpacity
                    style={[styles.timerActionBtn, styles.btnTimerPrimary, saving && styles.btnDisabled]}
                    onPress={() => void beginProductiveSession()}
                    disabled={saving}
                    activeOpacity={0.9}
                  >
                    <MaterialCommunityIcons name="play" size={18} color="#fff" />
                    <Text style={styles.timerActionBtnLabelLight} numberOfLines={2}>
                      Begin Productive Session
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.timerBtnWrap}>
                  <TouchableOpacity
                    style={[styles.timerActionBtn, styles.btnOutlineTimer]}
                    onPress={() => void openTaskModal()}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="target" size={18} color={FOCUS_PURPLE} />
                    <Text style={styles.timerActionBtnLabelTimer}>Focus on Task</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.timerBtnWrap}>
                  <TouchableOpacity
                    style={[styles.timerActionBtn, styles.btnOutlineGreen]}
                    onPress={openPlanModal}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="calendar-clock" size={18} color={GREEN} />
                    <Text style={styles.timerActionBtnLabelGreen}>Plan Session</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>

        {hasActiveSession ? (
          <View style={styles.notesSection}>
            <Text style={styles.notesSectionLabel}>Session Notes</Text>
            <TextInput
              style={styles.notesSectionInput}
              placeholder="What did you work on? Any insights or challenges?"
              placeholderTextColor="#94a3b8"
              value={sessionNotes}
              onChangeText={setSessionNotes}
              multiline
              textAlignVertical="top"
            />
          </View>
        ) : null}

        {/* Focus Sessions (mine) */}
        <View style={styles.card}>
          <View style={styles.sessionsHeaderWrap}>
            <CardHeaderGradient colors={GRAD_SESSIONS} />
            <View style={styles.timerHeaderInner}>
              <MaterialCommunityIcons name="flower" size={26} color="#fff" />
              <View style={styles.timerHeaderTextCol}>
                <Text style={styles.timerHeaderTitle}>Focus Sessions</Text>
                <Text style={styles.timerHeaderSub}>Your focus session history and planned sessions</Text>
              </View>
            </View>
          </View>
          <View style={styles.sessionsBody}>
            {filteredMySessions.length === 0 ? (
              <View style={styles.emptyBlock}>
                <View
                  style={[styles.emptyIconCircle, { backgroundColor: 'rgba(142,36,170,0.14)' }]}
                >
                  <MaterialCommunityIcons name="target-variant" size={48} color={SESSIONS_PURPLE} />
                </View>
                <Text style={styles.emptyOneLine}>
                  No focus sessions yet. Begin your first session to track your productivity!
                </Text>
              </View>
            ) : (
              filteredMySessions.map((s, i) => {
                const badges = sessionDateTimeBadges(s);
                return (
                  <View key={sessionId(s) || `my-${i}`} style={styles.sessionRow}>
                    <View style={styles.sessionCardInner}>
                      <View style={styles.sessionCardLeft}>
                        <Text style={styles.sessionTitle}>{s.title || 'Focus session'}</Text>
                        <View style={styles.sessionBadgesRow}>
                          <View style={styles.sessionPill}>
                            <Text style={styles.sessionPillText}>{badges.date}</Text>
                          </View>
                          {badges.time ? (
                            <View style={styles.sessionPill}>
                              <Text style={styles.sessionPillText}>{badges.time}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.sessionCardRight}>
                        <View style={styles.sessionStatBlock}>
                          <Text style={styles.sessionStatLabel}>Duration</Text>
                          <Text style={styles.sessionStatValDuration}>{sessionDurationLabel(s)}</Text>
                        </View>
                        <View style={styles.sessionStatBlock}>
                          <Text style={styles.sessionStatLabel}>Interruptions</Text>
                          <Text style={styles.sessionStatValInterruptions}>{sessionDistractionCount(s)}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* Admin: view other users */}
        {showTeamPanel ? (
          <View style={styles.card}>
            <View style={styles.adminHeaderWrap}>
              <CardHeaderGradient colors={GRAD_ADMIN} />
              <View style={styles.adminHeaderRow}>
                <MaterialCommunityIcons name="account-group" size={26} color="#fff" />
                <View style={styles.timerHeaderTextCol}>
                  <Text style={styles.timerHeaderTitle}>View User Focus Sessions</Text>
                  <Text style={styles.timerHeaderSub}>Review focus history for the selected team member</Text>
                </View>
                <View style={styles.adminRoleBadge}>
                  <Text style={styles.adminRoleBadgeText}>{getRoleDisplayLabel(role)}</Text>
                </View>
              </View>
            </View>
            <View style={styles.adminBody}>
              <Text style={styles.selectUserLabel}>Select User:</Text>
              <View style={styles.adminPickerRow}>
                <TouchableOpacity style={styles.adminSelectField} onPress={() => setAdminUserPicker(true)}>
                  <Text style={styles.adminSelectText} numberOfLines={1}>
                    {adminUserLabel}
            </Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>
                <View style={styles.usersLoadedBadge}>
                  <Text style={styles.usersLoadedText}>{adminUsers.length} users loaded</Text>
                </View>
              </View>
              {filteredAdminSessions.length === 0 ? (
                <View style={styles.emptyBlockSmall}>
                  <Text style={styles.emptySub}>
                    No sessions for this team member. Sessions are filtered to the selected user only.
                  </Text>
                </View>
              ) : (
                filteredAdminSessions.slice(0, 50).map((s, i) => {
                  const badges = sessionDateTimeBadges(s);
                  return (
                    <View key={sessionId(s) ? `adm-${sessionId(s)}` : `adm-i-${i}`} style={styles.sessionRow}>
                      <View style={styles.sessionCardInner}>
                        <View style={styles.sessionCardLeft}>
                          <Text style={styles.sessionTitle}>{s.title || 'Focus session'}</Text>
                          <View style={styles.sessionBadgesRow}>
                            <View style={styles.sessionPill}>
                              <Text style={styles.sessionPillText}>{badges.date}</Text>
                            </View>
                            {badges.time ? (
                              <View style={styles.sessionPill}>
                                <Text style={styles.sessionPillText}>{badges.time}</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.sessionCardRight}>
                          <View style={styles.sessionStatBlock}>
                            <Text style={styles.sessionStatLabel}>Duration</Text>
                            <Text style={styles.sessionStatValDuration}>{sessionDurationLabel(s)}</Text>
                          </View>
                          <View style={styles.sessionStatBlock}>
                            <Text style={styles.sessionStatLabel}>Interruptions</Text>
                            <Text style={styles.sessionStatValInterruptions}>{sessionDistractionCount(s)}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <PickerModal
        visible={timePicker}
        title="Time period"
        options={timeOptions}
        selectedId={timeFilter}
        onSelect={(id) => setTimeFilter(id as typeof timeFilter)}
        onClose={() => setTimePicker(false)}
      />
      <PickerModal
        visible={typePicker}
        title="Session Type"
        options={typeOptions}
        selectedId={typeFilter}
        onSelect={(id) => setTypeFilter(id as typeof typeFilter)}
        onClose={() => setTypePicker(false)}
      />
      <PickerModal
        visible={durationPicker}
        title="Duration (minutes)"
        options={['15', '25', '30', '45', '60', '90'].map((m) => ({ id: m, label: `${m} minutes` }))}
        selectedId={planDurationMin}
        onSelect={setPlanDurationMin}
        onClose={() => setDurationPicker(false)}
      />
      <PickerModal
        visible={planTaskPicker}
        title="Link to Task"
        options={[
          { id: '__none__', label: 'None' },
          ...tasks.map((t) => ({
            id: String(t?.id ?? t?.pk ?? ''),
            label: String(t?.title || t?.name || 'Task').slice(0, 60),
          })),
        ]}
        selectedId={planLinkedEventId ?? '__none__'}
        onSelect={(id) => setPlanLinkedEventId(id === '__none__' ? null : id)}
        onClose={() => setPlanTaskPicker(false)}
      />
      <PickerModal
        visible={adminUserPicker}
        title="Select user"
        options={adminUserOptions}
        selectedId={adminUserId}
        onSelect={setAdminUserId}
        onClose={() => setAdminUserPicker(false)}
      />

      <Modal visible={taskModal} transparent animationType="fade" onRequestClose={() => setTaskModal(false)}>
        <View style={pmStyles.overlayDark}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTaskModal(false)} />
          <Pressable style={styles.taskModalBox} onPress={(e) => e.stopPropagation()}>
            <View style={styles.taskModalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.taskModalTitle}>Select Task to Focus On</Text>
                <Text style={styles.taskModalSub}>Choose a task from your list to start a focused work session.</Text>
              </View>
              <TouchableOpacity onPress={() => setTaskModal(false)} hitSlop={12} style={styles.taskModalClose}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>
            <View style={styles.taskDropdown}>
              <Text style={[styles.taskDropdownText, !selectedTask && styles.taskDropdownPlaceholder]} numberOfLines={1}>
                {selectedTask
                  ? String(selectedTask.title || selectedTask.name || 'Task')
                  : 'Select a task…'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
            </View>
            {tasksLoading ? (
              <ActivityIndicator style={{ margin: 24 }} color={PURPLE} />
            ) : (
              <FlatList
                style={styles.taskList}
                data={tasks}
                keyExtractor={(item, i) => String(item?.id ?? item?.pk ?? i)}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={styles.modalEmpty}>No tasks found. Add tasks from the Tasks screen.</Text>}
                renderItem={({ item }) => {
                  const sel = selectedTask && String(selectedTask?.id ?? selectedTask?.pk) === String(item?.id ?? item?.pk);
                  return (
                    <TouchableOpacity
                      style={[styles.taskPickRow, sel && styles.taskPickRowSel]}
                      onPress={() => setSelectedTask(item)}
                    >
                      <Text style={styles.taskPickRowText} numberOfLines={2}>
                        {item.title || item.name || 'Untitled'}
                      </Text>
                      {sel ? <MaterialCommunityIcons name="check" size={22} color={PURPLE} /> : <View style={{ width: 22 }} />}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
            <View style={styles.taskModalFooter}>
              <TouchableOpacity style={styles.taskCancelOutline} onPress={() => setTaskModal(false)} disabled={saving}>
                <Text style={styles.taskCancelOutlineText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.taskStartBtn, (!selectedTask || saving) && styles.btnDisabled]}
                onPress={() => void startSessionForTask(selectedTask)}
                disabled={!selectedTask || saving}
              >
                <Text style={styles.taskStartBtnText}>{saving ? 'Starting…' : 'Start Focus Session'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={planModal} transparent animationType="fade" onRequestClose={() => !saving && setPlanModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={pmStyles.overlayDark}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setPlanModal(false)} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.planScroll}
            showsVerticalScrollIndicator={false}
          >
            <Pressable style={styles.planBox} onPress={(e) => e.stopPropagation()}>
              <View style={styles.taskModalHeader}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.planTitleLg}>Plan a Focus Session</Text>
                  <Text style={styles.planSubLg}>
                    Schedule a focus session for later. You can plan sessions for the week or longer.
                  </Text>
                </View>
                <TouchableOpacity onPress={() => !saving && setPlanModal(false)} hitSlop={12}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                </TouchableOpacity>
              </View>
              <Text style={styles.fieldLblBold}>Session Title</Text>
              <TextInput
                style={styles.planInput}
                placeholder="What will you focus on?"
                value={planTitle}
                onChangeText={setPlanTitle}
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.fieldLblBold}>Description (Optional)</Text>
              <TextInput
                style={[styles.planInput, styles.planTextArea]}
                placeholder="Additional details about this session…"
                value={planDescription}
                onChangeText={setPlanDescription}
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.fieldLblBold}>Link to Task (Optional)</Text>
              <TouchableOpacity style={styles.planSelectField} onPress={() => setPlanTaskPicker(true)}>
                <Text style={[styles.planSelectText, !planLinkedEventId && { color: '#94a3b8' }]} numberOfLines={1}>
                  {planLinkedLabel()}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
              </TouchableOpacity>
              <Text style={styles.fieldLblBold}>Planned Date & Time</Text>
              <View style={styles.planDateRow}>
                <TextInput
                  style={[styles.planInput, { flex: 1 }]}
                  placeholder="YYYY-MM-DDTHH:mm"
                  value={planStartStr}
                  onChangeText={setPlanStartStr}
                  placeholderTextColor="#94a3b8"
                />
                <MaterialCommunityIcons name="calendar" size={22} color="#64748b" style={{ marginLeft: 8 }} />
              </View>
              <Text style={styles.fieldLblBold}>Duration (minutes)</Text>
              <TouchableOpacity style={styles.planSelectField} onPress={() => setDurationPicker(true)}>
                <Text style={styles.planSelectText}>{planDurationMin} minutes</Text>
                <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
              </TouchableOpacity>
              <View style={styles.planActions}>
                <TouchableOpacity style={styles.planCancelOutline} onPress={() => setPlanModal(false)} disabled={saving}>
                  <Text style={styles.planCancelOutlineText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.planCreateGreen} onPress={() => void submitPlan()} disabled={saving}>
                  <Text style={styles.planCreateGreenText}>{saving ? 'Saving…' : 'Create Plan'}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAGE_BG },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: PAGE_BG },
  scrollContent: { paddingBottom: 40, paddingHorizontal: 16, paddingTop: 20 },

  pageTitleBlock: { alignItems: 'center', marginBottom: 20 },
  pageTitle: { fontSize: 30, fontWeight: '800', color: TIMER_ACCENT, textAlign: 'center' },
  pageSubtitle: { fontSize: 15, color: '#64748b', marginTop: 8, textAlign: 'center' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      web: { boxShadow: '0 6px 16px rgba(15, 23, 42, 0.08)' },
      default: {
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
    }),
  },
  timerHeaderWrap: { position: 'relative', minHeight: 76 },
  timerHeaderSolid: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: FOCUS_PURPLE,
  },
  sessionsHeaderWrap: { position: 'relative', minHeight: 76 },
  timerHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  timerHeaderTextCol: { flex: 1, minWidth: 0 },
  timerHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  timerHeaderSub: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 4 },

  timerBody: { padding: 24, alignItems: 'center' },
  timerDigits: { fontSize: 56, fontWeight: '800', color: FOCUS_PURPLE, marginBottom: 8 },
  timerStatusDotRow: { alignItems: 'center', marginBottom: 20 },
  timerLiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#cbd5e1',
  },
  timerLiveDotOn: { backgroundColor: GREEN },
  timerLiveDotPaused: { backgroundColor: '#f59e0b' },
  interruptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    maxWidth: 560,
    marginBottom: 14,
  },
  interruptBadge: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: PEACH_BG,
    borderWidth: 1,
    borderColor: PEACH_BORDER,
  },
  interruptBadgeText: { fontSize: 14, fontWeight: '600', color: PEACH_TEXT },
  interruptAddBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: PEACH_BORDER,
  },
  interruptAddBtnText: { fontSize: 14, fontWeight: '600', color: PEACH_TEXT },
  sessionControlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 10,
    width: '100%',
    maxWidth: 560,
  },
  ctrlBtn: {
    flex: 1,
    minWidth: 140,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 10,
    gap: 8,
  },
  ctrlPause: { backgroundColor: '#64748b' },
  ctrlResume: { backgroundColor: GREEN },
  ctrlStop: { backgroundColor: STOP_ROSE },
  ctrlBtnTextLight: { color: '#fff', fontSize: 15, fontWeight: '700' },
  notesSection: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  notesSectionLabel: { fontSize: 15, fontWeight: '700', color: '#334155', marginBottom: 8 },
  notesSectionInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  timerBtnCol: { width: '100%', gap: 12, maxWidth: 400 },
  timerBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 10,
    width: '100%',
    maxWidth: 560,
  },
  timerBtnWrap: { flex: 1, minWidth: 0, minHeight: 52 },
  timerActionBtn: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 6,
  },
  btnTimerPrimary: { backgroundColor: FOCUS_PURPLE },
  btnOutlineTimer: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: FOCUS_PURPLE,
  },
  btnOutlineGreen: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: GREEN,
  },
  timerActionBtnLabelLight: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  timerActionBtnLabelTimer: {
    color: FOCUS_PURPLE,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  timerActionBtnLabelGreen: {
    color: GREEN,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  btnDisabled: { opacity: 0.6 },

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filterLabel: { fontSize: 15, fontWeight: '600', color: '#334155' },
  filterRight: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    gap: 4,
  },
  filterChipText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },

  sessionsBody: { padding: 16, minHeight: 120 },
  emptyBlock: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16 },
  emptyIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(126,87,194,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#334155', textAlign: 'center' },
  emptyOneLine: { fontSize: 15, color: '#64748b', textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  emptySub: { fontSize: 15, color: '#94a3b8', marginTop: 8, textAlign: 'center', lineHeight: 22 },
  emptyBlockSmall: { paddingVertical: 16 },
  sessionRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  sessionCardInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  sessionCardLeft: { flex: 1, minWidth: 0 },
  sessionCardRight: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  sessionRowMain: { gap: 4 },
  sessionTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  sessionMeta: { fontSize: 13, color: '#64748b' },
  sessionBadgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  sessionPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sessionPillText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  sessionStatBlock: { alignItems: 'flex-end', minWidth: 80 },
  sessionStatLabel: { fontSize: 11, fontWeight: '600', color: '#94a3b8', marginBottom: 2 },
  sessionStatValDuration: { fontSize: 15, fontWeight: '700', color: '#2563eb' },
  sessionStatValInterruptions: { fontSize: 15, fontWeight: '700', color: '#ea580c' },
  sessionBadge: { fontSize: 12, color: SESSIONS_PINK, fontWeight: '600', marginTop: 4, textTransform: 'capitalize' },

  adminHeaderWrap: { position: 'relative', minHeight: 88 },
  adminHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 10,
    flexWrap: 'wrap',
  },
  adminRoleBadge: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  adminRoleBadgeText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  adminBody: { padding: 16 },
  selectUserLabel: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 8 },
  adminPickerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 16 },
  adminSelectField: {
    flex: 1,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  adminSelectText: { flex: 1, fontSize: 15, color: '#0f172a', fontWeight: '500' },
  usersLoadedBadge: {
    borderWidth: 1,
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  usersLoadedText: { fontSize: 13, fontWeight: '600', color: '#1d4ed8' },

  modalHint: { fontSize: 14, color: '#64748b', paddingHorizontal: 16, marginBottom: 8 },
  modalEmpty: { textAlign: 'center', color: '#94a3b8', padding: 24 },

  planScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 20, paddingHorizontal: 16 },
  planBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  planTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  planTitleLg: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  planSubLg: { fontSize: 13, color: '#64748b', marginTop: 6, lineHeight: 18 },
  fieldLbl: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6, marginTop: 10 },
  fieldLblBold: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 8, marginTop: 14 },
  planInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#0f172a',
  },
  planTextArea: { minHeight: 88, paddingTop: 12 },
  planSelectField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  planSelectText: { flex: 1, fontSize: 16, color: '#0f172a', marginRight: 8 },
  planDateRow: { flexDirection: 'row', alignItems: 'center' },
  planActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 24 },
  planCancel: { paddingVertical: 12, paddingHorizontal: 16 },
  planCancelText: { fontSize: 16, color: '#64748b', fontWeight: '600' },
  planCancelOutline: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  planCancelOutlineText: { fontSize: 15, color: '#0f172a', fontWeight: '600' },
  planCreateGreen: {
    backgroundColor: GREEN,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  planCreateGreenText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  planSave: { backgroundColor: GREEN, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  planSaveText: { color: '#fff', fontWeight: '700' },

  taskModalBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    maxHeight: '88%',
  },
  taskModalHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  taskModalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  taskModalSub: { fontSize: 13, color: '#64748b', marginTop: 6, lineHeight: 18 },
  taskModalClose: { padding: 4, marginLeft: 8 },
  taskDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  taskDropdownText: { flex: 1, fontSize: 16, color: '#0f172a', marginRight: 8 },
  taskDropdownPlaceholder: { color: '#94a3b8' },
  taskList: { maxHeight: 240 },
  taskPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  taskPickRowSel: { backgroundColor: 'rgba(126,87,194,0.08)' },
  taskPickRowText: { flex: 1, fontSize: 16, color: '#0f172a', marginRight: 8 },
  taskModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  taskCancelOutline: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  taskCancelOutlineText: { fontSize: 15, color: '#0f172a', fontWeight: '600' },
  taskStartBtn: {
    backgroundColor: PURPLE,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  taskStartBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
