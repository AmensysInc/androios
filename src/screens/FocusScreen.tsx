import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthContext';
import { type UserRole } from '../types/auth';
import * as api from '../api';

/** Section header gradients (matches web reference: blue→purple, purple→pink, blue→cyan) */
const GRAD_TIMER = ['#2196F3', '#9C27B0'] as const;
const GRAD_SESSIONS = ['#8E24AA', '#D81B60'] as const;
const GRAD_ADMIN = ['#0288D1', '#00BCD4'] as const;

/** Accents tied to each section’s gradient */
const TIMER_ACCENT = '#9C27B0';
const SESSIONS_PURPLE = '#8E24AA';
const SESSIONS_PINK = '#D81B60';

const PURPLE = '#7E57C2';
const GREEN = '#4CAF50';
const PAGE_BG = '#F5F7F9';

type PickerOption = { id: string; label: string };

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
  const t = s.start_time ?? s.started_at ?? s.start ?? s.planned_start;
  if (t == null || t === '') return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sessionEnd(s: any): Date | null {
  const t = s.end_time ?? s.ended_at ?? s.end;
  if (t == null || t === '') return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sessionId(s: any): string {
  const id = s?.id ?? s?.pk ?? s?.uuid;
  return id != null ? String(id) : '';
}

function inferStatus(s: any): 'completed' | 'planned' | 'active' {
  const st = String(s.status ?? s.session_status ?? '').toLowerCase();
  if (st.includes('plan')) return 'planned';
  if (st.includes('complete') || st.includes('done')) return 'completed';
  if (st.includes('active') || st.includes('progress') || st.includes('running')) return 'active';
  if (sessionEnd(s)) return 'completed';
  if (sessionStart(s)) {
    const now = Date.now();
    if (sessionStart(s)!.getTime() > now) return 'planned';
    return 'active';
  }
  return 'completed';
}

/** Matches web filters: task-based vs free-form vs planned */
function sessionKind(s: any): 'task' | 'freeform' | 'planned' {
  if (inferStatus(s) === 'planned') return 'planned';
  const st = String(s.session_type ?? s.type ?? '').toLowerCase();
  if (st.includes('task')) return 'task';
  if (st.includes('free')) return 'freeform';
  const hasTaskLink =
    s.calendar_event != null ||
    s.event != null ||
    s.task_id != null ||
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
  const start = sessionStart(s);
  if (!start) return '—';
  const end = sessionEnd(s);
  if (end) {
    return `${start.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} – ${end.toLocaleString([], { timeStyle: 'short' })}`;
  }
  return start.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
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

function canViewUserFocusSessions(role: UserRole | null): boolean {
  if (!role) return false;
  return ['super_admin', 'admin', 'operations_manager', 'manager'].includes(role);
}

export default function FocusScreen() {
  const { user, role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mySessions, setMySessions] = useState<any[]>([]);
  const [adminSessions, setAdminSessions] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<{ id: string; label: string }[]>([]);

  const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'all'>('week');
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'freeform' | 'planned'>('all');
  const [timePicker, setTimePicker] = useState(false);
  const [typePicker, setTypePicker] = useState(false);

  const [adminUserId, setAdminUserId] = useState<string>('self');
  const [adminUserPicker, setAdminUserPicker] = useState(false);

  const [tick, setTick] = useState(0);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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

  const showAdmin = canViewUserFocusSessions(role);

  const loadMySessions = useCallback(async () => {
    if (!user?.id) return;
    try {
      const raw = await api.getFocusSessions({ user: user.id });
      setMySessions(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.warn(e);
    }
  }, [user?.id]);

  const loadAdminSessions = useCallback(async () => {
    if (!showAdmin || !user?.id) return;
    const uid = adminUserId === 'self' ? user.id : adminUserId;
    try {
      const raw = await api.getFocusSessions({ user: uid });
      setAdminSessions(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.warn(e);
    }
  }, [showAdmin, user?.id, adminUserId]);

  const loadAdminUsers = useCallback(async () => {
    if (!showAdmin) return;
    try {
      const raw = await api.getUsers({}).catch(() => []);
      const list = (Array.isArray(raw) ? raw : [])
        .filter((u: any) => (u.profile?.status ?? u.status) !== 'deleted')
        .map((u: any) => ({
          id: String(u.id),
          label: u.profile?.full_name || u.full_name || u.email || u.username || String(u.id),
        }));
      setAdminUsers(list);
    } catch (e) {
      console.warn(e);
    }
  }, [showAdmin]);

  const load = useCallback(async () => {
    await Promise.all([loadMySessions(), loadAdminSessions(), loadAdminUsers()]);
    setLoading(false);
    setRefreshing(false);
  }, [loadMySessions, loadAdminSessions, loadAdminUsers]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadAdminSessions();
  }, [adminUserId, loadAdminSessions]);

  useEffect(() => {
    if (!runningSince) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [runningSince]);

  const elapsedSec = useMemo(() => {
    void tick;
    return runningSince ? Math.floor((Date.now() - runningSince) / 1000) : 0;
  }, [runningSince, tick]);

  const filterSessions = useCallback(
    (list: any[]) => {
      let out = [...list];
      const now = new Date();
      if (timeFilter === 'week') {
        const start = startOfWeekMonday(now);
        out = out.filter((s) => {
          const st = sessionStart(s);
          return st && st >= start;
        });
      } else if (timeFilter === 'month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        out = out.filter((s) => {
          const st = sessionStart(s);
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
        const ta = sessionStart(a)?.getTime() ?? 0;
        const tb = sessionStart(b)?.getTime() ?? 0;
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

  const adminUserOptions: PickerOption[] = useMemo(() => {
    return [{ id: 'self', label: 'My Sessions' }, ...adminUsers.map((u) => ({ id: u.id, label: u.label }))];
  }, [adminUsers]);

  const adminUserLabel =
    adminUserId === 'self' ? 'My Sessions' : adminUsers.find((u) => u.id === adminUserId)?.label ?? 'Select user';

  const endRunningSession = async () => {
    if (!runningSince || !user?.id) return;
    const endIso = new Date().toISOString();
    const startIso = new Date(runningSince).toISOString();
    setSaving(true);
    try {
      if (activeSessionId) {
        await api.updateFocusSession(activeSessionId, {
          end_time: endIso,
          status: 'completed',
        });
      } else {
        await api.createFocusSession({
          user: user.id,
          start_time: startIso,
          end_time: endIso,
          title: 'Productive session',
          status: 'completed',
        });
      }
      setRunningSince(null);
      setActiveSessionId(null);
      await loadMySessions();
      Alert.alert('Session saved', 'Your focus session was recorded.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save session');
    } finally {
      setSaving(false);
    }
  };

  const beginProductiveSession = async () => {
    if (runningSince) {
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
    if (!user?.id) return;
    setSaving(true);
    const startIso = new Date().toISOString();
    try {
      const created = await api.createFocusSession({
        user: user.id,
        start_time: startIso,
        title: 'Productive session',
        status: 'in_progress',
      });
      const sid = sessionId(created);
      setActiveSessionId(sid || null);
      setRunningSince(Date.now());
    } catch {
      try {
        const created = await api.createFocusSession({
          user: user.id,
          start_time: startIso,
          title: 'Productive session',
        });
        const sid = sessionId(created);
        setActiveSessionId(sid || null);
        setRunningSince(Date.now());
      } catch (e2: any) {
        Alert.alert('Error', e2?.message || 'Could not start session');
        setRunningSince(null);
        setActiveSessionId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const openTaskModal = async () => {
    if (runningSince) {
      Alert.alert('Session active', 'End your current session before starting one on a task.');
      return;
    }
    setSelectedTask(null);
    setTaskModal(true);
    setTasksLoading(true);
    try {
      const raw = await api.getCalendarEvents({});
      setTasks(Array.isArray(raw) ? raw : []);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  };

  const startSessionForTask = async (ev: any) => {
    if (!user?.id || !ev) return;
    const eid = ev?.id ?? ev?.pk;
    const title = String(ev?.title || ev?.name || 'Task focus').slice(0, 200);
    setTaskModal(false);
    setSelectedTask(null);
    setSaving(true);
    const startIso = new Date().toISOString();
    const body: Record<string, any> = {
      user: user.id,
      start_time: startIso,
      title,
      status: 'in_progress',
    };
    if (eid != null) {
      body.calendar_event = String(eid);
      body.event = String(eid);
      body.task_id = String(eid);
    }
    try {
      const created = await api.createFocusSession(body);
      setActiveSessionId(sessionId(created) || null);
      setRunningSince(Date.now());
    } catch {
      delete body.calendar_event;
      delete body.event;
      delete body.task_id;
      try {
        const created = await api.createFocusSession(body);
        setActiveSessionId(sessionId(created) || null);
        setRunningSince(Date.now());
      } catch (e2: any) {
        Alert.alert('Error', e2?.message || 'Could not start task session');
      }
    } finally {
      setSaving(false);
    }
  };

  const submitPlan = async () => {
    if (!user?.id) return;
    const start = planStartStr.trim() ? new Date(planStartStr.trim()) : null;
    if (!start || Number.isNaN(start.getTime())) {
      Alert.alert('Validation', 'Enter a valid planned date and time.');
      return;
    }
    setSaving(true);
    const body: Record<string, any> = {
      user: user.id,
      start_time: start.toISOString(),
      title: planTitle.trim() || 'Planned session',
      description: planDescription.trim() || undefined,
      status: 'planned',
      planned_duration_minutes: parseInt(planDurationMin, 10) || 25,
      duration_minutes: parseInt(planDurationMin, 10) || 25,
    };
    if (planLinkedEventId) {
      body.calendar_event = planLinkedEventId;
      body.event = planLinkedEventId;
      body.task_id = planLinkedEventId;
    }
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
      try {
        const minimal = {
          user: user.id,
          start_time: start.toISOString(),
          title: planTitle.trim() || 'Planned session',
          status: 'planned',
        };
        await api.createFocusSession(minimal);
        setPlanModal(false);
        setPlanTitle('');
        setPlanDescription('');
        setPlanStartStr('');
        setPlanLinkedEventId(null);
        await loadMySessions();
        Alert.alert('Planned', 'Session added (basic fields only).');
      } catch (e2: any) {
        Alert.alert('Error', e2?.message || e?.message || 'Could not plan session');
      }
    } finally {
      setSaving(false);
    }
  };

  const openPlanModal = () => {
    if (runningSince) {
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
        const raw = await api.getCalendarEvents({});
        if (Array.isArray(raw) && raw.length) setTasks(raw);
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
            <CardHeaderGradient colors={GRAD_TIMER} />
            <View style={styles.timerHeaderInner}>
              <MaterialCommunityIcons name="timer-outline" size={26} color="#fff" />
              <View style={styles.timerHeaderTextCol}>
                <Text style={styles.timerHeaderTitle}>Focus Timer</Text>
                <Text style={styles.timerHeaderSub}>Begin a focus session to track your efficiency</Text>
              </View>
            </View>
          </View>
          <View style={styles.timerBody}>
            <Text style={[styles.timerDigits, { color: TIMER_ACCENT }]}>{formatTimer(elapsedSec)}</Text>
            <View style={styles.timerBtnRow}>
              <View style={styles.timerBtnWrap}>
                {runningSince ? (
                  <TouchableOpacity
                    style={[styles.timerActionBtn, styles.btnTimerPrimary, saving && styles.btnDisabled]}
                    onPress={() => void endRunningSession()}
                    disabled={saving}
                    activeOpacity={0.9}
                  >
                    <MaterialCommunityIcons name="stop" size={18} color="#fff" />
                    <Text style={styles.timerActionBtnLabelLight} numberOfLines={2}>
                      End & save
                    </Text>
                  </TouchableOpacity>
                ) : (
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
                )}
              </View>
              <View style={styles.timerBtnWrap}>
                <TouchableOpacity
                  style={[styles.timerActionBtn, styles.btnOutlineTimer]}
                  onPress={() => void openTaskModal()}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="target" size={18} color={TIMER_ACCENT} />
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
          </View>
        </View>

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
              filteredMySessions.map((s, i) => (
                <View key={sessionId(s) || `my-${i}`} style={styles.sessionRow}>
                  <View style={styles.sessionRowMain}>
                    <Text style={styles.sessionTitle}>{s.title || 'Focus session'}</Text>
                    <Text style={styles.sessionMeta}>{formatSessionWhen(s)}</Text>
                    <Text style={[styles.sessionBadge, { color: SESSIONS_PINK }]}>{inferStatus(s)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>

        {/* Admin: view other users */}
        {showAdmin ? (
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
                  <Text style={styles.adminRoleBadgeText}>Admin: {role ?? '—'}</Text>
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
                  <Text style={styles.emptySub}>No sessions for this user with the current filters.</Text>
                </View>
              ) : (
                filteredAdminSessions.slice(0, 50).map((s, i) => (
                  <View key={sessionId(s) ? `adm-${sessionId(s)}` : `adm-i-${i}`} style={styles.sessionRow}>
                    <Text style={styles.sessionTitle}>{s.title || 'Focus session'}</Text>
                    <Text style={styles.sessionMeta}>{formatSessionWhen(s)}</Text>
                  </View>
                ))
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  timerHeaderWrap: { position: 'relative', minHeight: 76 },
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
  timerDigits: { fontSize: 56, fontWeight: '800', color: PURPLE, marginBottom: 20 },
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
  btnTimerPrimary: { backgroundColor: TIMER_ACCENT },
  btnOutlineTimer: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: TIMER_ACCENT,
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
    color: TIMER_ACCENT,
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
  sessionRowMain: { gap: 4 },
  sessionTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  sessionMeta: { fontSize: 13, color: '#64748b' },
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
