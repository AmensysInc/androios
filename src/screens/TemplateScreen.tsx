import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
  ScrollView,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import { HttpError } from '../lib/api-client';

function templateRowId(t: any): string {
  const id = t?.id ?? t?.pk ?? t?.uuid;
  return id != null ? String(id) : '';
}

function taskRowId(t: any): string {
  const id = t?.id ?? t?.pk ?? t?.uuid;
  return id != null ? String(id) : '';
}

function formatTemplateError(e: unknown): string {
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

const PRIORITY_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function sameCalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WD_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WHEEL_H = 36;
const WHEEL_VISIBLE = 5;

function TemplateDueDateTimePanel({
  initialMs,
  onCommit,
  allowClear,
}: {
  initialMs: number;
  onCommit: (isoLocal: string | null) => void;
  allowClear?: boolean;
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
        {allowClear ? (
          <TouchableOpacity onPress={() => onCommit(null)}>
            <Text style={dueStyles.link}>Clear</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
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
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 4,
    flexWrap: 'wrap',
    gap: 8,
  },
  link: { fontSize: 14, fontWeight: '600', color: '#2563eb' },
  doneBtn: { backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 18, borderRadius: 8 },
  doneTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
});

function parseTaskDue(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

function defaultDueStr(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TemplateScreen() {
  const { user, role } = useAuth();
  const [templates, setTemplates] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ user_id: string; full_name: string | null; email: string }[]>([]);
  const [templateTasks, setTemplateTasks] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menuForId, setMenuForId] = useState<string | null>(null);

  const [assignModal, setAssignModal] = useState<{ templateId: string; templateName: string } | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignChecked, setAssignChecked] = useState<Record<string, boolean>>({});
  const [assigning, setAssigning] = useState(false);

  const [createModal, setCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const [editModal, setEditModal] = useState<{ id: string; name: string; description: string; technology: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [taskModal, setTaskModal] = useState<{ templateId: string; templateName: string } | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');
  const [taskDueStr, setTaskDueStr] = useState('');
  const [taskAssignChecked, setTaskAssignChecked] = useState<Record<string, boolean>>({});
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskPicker, setTaskPicker] = useState<'priority' | null>(null);
  const [taskDueOpen, setTaskDueOpen] = useState(false);

  const isAdmin =
    role === 'super_admin' || role === 'admin' || role === 'operations_manager' || role === 'manager';

  const norm = (v: any) => (v != null ? String(v) : '');

  const loadTemplates = useCallback(async () => {
    try {
      const raw = await api.getTemplates();
      setTemplates(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    try {
      const raw = await api.getTemplateAssignments();
      setAssignments(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const loadTasksForTemplates = useCallback(async (list: any[]) => {
    const next: Record<string, any[]> = {};
    await Promise.all(
      list.map(async (t) => {
        const id = templateRowId(t);
        if (!id) return;
        try {
          const tasks = await api.getTemplateTasks(id);
          next[id] = Array.isArray(tasks) ? tasks : [];
        } catch {
          next[id] = [];
        }
      })
    );
    setTemplateTasks(next);
  }, []);

  const loadTeamMembers = useCallback(async () => {
    if (!user || !isAdmin) return;
    try {
      if (role === 'super_admin' || role === 'admin') {
        const users = await api.getUsers();
        setTeamMembers(
          (users || []).map((u: any) => ({
            user_id: String(u.id),
            full_name: u.profile?.full_name || u.full_name || null,
            email: u.email || '',
          }))
        );
        return;
      }
      const companies = await api.getCompanies();
      const list = Array.isArray(companies) ? companies : [];
      const companyIds = list.map((c: any) => c?.id).filter(Boolean);
      const seen = new Set<string>();
      const members: { user_id: string; full_name: string | null; email: string }[] = [];
      for (const cid of companyIds) {
        const emps = await api.getEmployees({ company: cid, status: 'active' });
        (Array.isArray(emps) ? emps : []).forEach((emp: any) => {
          const uid = emp.user || emp.user_id;
          if (uid && !seen.has(String(uid))) {
            seen.add(String(uid));
            members.push({
              user_id: String(uid),
              full_name: `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || null,
              email: emp.email || '',
            });
          }
        });
      }
      setTeamMembers(members);
    } catch (e) {
      console.warn(e);
    }
  }, [user, role, isAdmin]);

  const load = useCallback(async () => {
    await loadTemplates();
    await loadAssignments();
    await loadTeamMembers();
    setLoading(false);
    setRefreshing(false);
  }, [loadTemplates, loadAssignments, loadTeamMembers]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (templates.length === 0) {
      setTemplateTasks({});
      return;
    }
    void loadTasksForTemplates(templates);
  }, [templates, loadTasksForTemplates]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const assignedUserIds = (templateId: string) =>
    assignments
      .filter((a) => norm(a.template_id || a.template?.id || a.template) === norm(templateId))
      .map((a) => norm(a.user_id || a.user?.id || a.user));

  const openCreateModal = () => {
    setNewName('');
    setNewDescription('');
    setNewCategory('');
    setCreateModal(true);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('Validation', 'Enter a template name');
      return;
    }
    setSaving(true);
    try {
      await api.createTemplate(
        stripFields({
          name,
          description: newDescription.trim() || undefined,
          category: newCategory.trim() || undefined,
        })
      );
      setCreateModal(false);
      await loadTemplates();
      await loadAssignments();
    } catch (e: unknown) {
      Alert.alert('Error', formatTemplateError(e));
    } finally {
      setSaving(false);
    }
  };

  function stripFields(o: Record<string, any>) {
    const out: Record<string, any> = { ...o };
    Object.keys(out).forEach((k) => (out[k] === undefined || out[k] === '') && delete out[k]);
    return out;
  }

  const openAssign = (templateId: string, templateName: string) => {
    setAssignSearch('');
    setAssignChecked({});
    setAssignModal({ templateId, templateName });
  };

  const filteredForAssign = useMemo(() => {
    if (!assignModal) return [];
    const taken = new Set(assignedUserIds(assignModal.templateId));
    const q = assignSearch.trim().toLowerCase();
    return teamMembers.filter((m) => {
      if (taken.has(m.user_id)) return false;
      if (!q) return true;
      const n = (m.full_name || '').toLowerCase();
      const e = (m.email || '').toLowerCase();
      return n.includes(q) || e.includes(q);
    });
  }, [assignModal, assignSearch, teamMembers, assignments]);

  const submitBatchAssign = async () => {
    if (!assignModal) return;
    const ids = Object.entries(assignChecked)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (ids.length === 0) {
      Alert.alert('Assign', 'Select at least one user');
      return;
    }
    setAssigning(true);
    try {
      for (const uid of ids) {
        await api.assignTemplate(assignModal.templateId, uid);
      }
      await loadAssignments();
      setAssignModal(null);
      setAssignChecked({});
    } catch (e: unknown) {
      Alert.alert('Error', formatTemplateError(e));
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = (templateId: string, userId: string) => {
    const run = async () => {
      try {
        await api.unassignTemplate(templateId, userId);
        await loadAssignments();
      } catch (e: unknown) {
        Alert.alert('Error', formatTemplateError(e));
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm('Remove this user from the checklist?')) void run();
      return;
    }
    Alert.alert('Remove user', 'Remove this user from the checklist?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const deleteTemplate = (t: any) => {
    const id = templateRowId(t);
    if (!id) return;
    const name = t.name || t.title || 'this checklist';
    const run = async () => {
      try {
        await api.deleteTemplate(id);
        await load();
      } catch (e: unknown) {
        Alert.alert('Error', formatTemplateError(e));
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm(`Delete "${name}"?`)) void run();
      return;
    }
    Alert.alert('Delete', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const openEdit = (t: any) => {
    const id = templateRowId(t);
    if (!id) return;
    setMenuForId(null);
    setEditModal({
      id,
      name: String(t.name || t.title || ''),
      description: String(t.description || ''),
      technology: String(t.category || t.technology || ''),
    });
  };

  const submitEdit = async () => {
    if (!editModal) return;
    const name = editModal.name.trim();
    if (!name) {
      Alert.alert('Validation', 'Name is required');
      return;
    }
    setEditSaving(true);
    try {
      await api.updateTemplate(
        editModal.id,
        stripFields({
          name,
          description: editModal.description.trim() || undefined,
          category: editModal.technology.trim() || undefined,
        })
      );
      setEditModal(null);
      await loadTemplates();
    } catch (e: unknown) {
      Alert.alert('Error', formatTemplateError(e));
    } finally {
      setEditSaving(false);
    }
  };

  const openTaskModal = (templateId: string, templateName: string) => {
    setTaskTitle('');
    setTaskDescription('');
    setTaskPriority('medium');
    setTaskDueStr(defaultDueStr());
    setTaskAssignChecked({});
    setTaskPicker(null);
    setTaskDueOpen(false);
    setTaskModal({ templateId, templateName });
  };

  const submitTask = async () => {
    if (!taskModal) return;
    const title = taskTitle.trim();
    if (!title) {
      Alert.alert('Validation', 'Task title is required');
      return;
    }
    const dueIso = parseTaskDue(taskDueStr);
    const assignees = Object.entries(taskAssignChecked)
      .filter(([, v]) => v)
      .map(([k]) => k);

    setTaskSaving(true);
    try {
      await api.createTemplateTask(
        taskModal.templateId,
        stripFields({
          title,
          description: taskDescription.trim() || undefined,
          priority: taskPriority,
          due_date: dueIso || undefined,
          assigned_users: assignees.length ? assignees : undefined,
          user_ids: assignees.length ? assignees : undefined,
        })
      );
      setTaskModal(null);
      await loadTasksForTemplates(templates);
    } catch (e: unknown) {
      Alert.alert('Error', formatTemplateError(e));
    } finally {
      setTaskSaving(false);
    }
  };

  const taskDueMs = useMemo(() => {
    const d = new Date(taskDueStr);
    return Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
  }, [taskDueStr]);

  const labelPriority = (id: string) => PRIORITY_OPTIONS.find((p) => p.id === id)?.label ?? id;

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const taskCompleted = (t: any) => !!(t.completed || t.is_done || t.done);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={templates}
        keyExtractor={(item, index) => templateRowId(item) || `tpl-${index}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        removeClippedSubviews={false}
        contentContainerStyle={templates.length === 0 ? styles.listEmpty : styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.headerTop}>
              <View style={styles.headerTitles}>
                <Text style={styles.pageTitle}>Check Lists</Text>
                <Text style={styles.pageSubtitle}>Create and manage Check List with tasks and assignments</Text>
              </View>
              {isAdmin && (
                <TouchableOpacity style={styles.primaryBtn} onPress={openCreateModal} activeOpacity={0.9}>
                  <Text style={styles.primaryBtnText}>+ New Checklist</Text>
                </TouchableOpacity>
              )}
            </View>

            {templates.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialCommunityIcons name="book-open-page-variant-outline" size={64} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>No templates created yet</Text>
                <Text style={styles.emptySubtitle}>Get started by creating your first Check-List</Text>
                {isAdmin && (
                  <TouchableOpacity style={styles.emptyBtn} onPress={openCreateModal} activeOpacity={0.9}>
                    <Text style={styles.emptyBtnText}>+ Create Your First Template</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const tid = templateRowId(item);
          const assigned = assignedUserIds(tid);
          const tasks = templateTasks[tid] || [];
          const doneCount = tasks.filter(taskCompleted).length;
          const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
          const isOpen = !!expanded[tid];
          const showMenu = menuForId === tid;

          return (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <View style={styles.bookIcon}>
                  <MaterialCommunityIcons name="book-open-variant" size={22} color="#fff" />
                </View>
                <View style={styles.cardTitleBlock}>
                  <Text style={styles.cardTitle}>{item.name || item.title || 'Checklist'}</Text>
                  {item.description ? <Text style={styles.cardDesc}>{item.description}</Text> : null}
                  {(item.category || item.technology) ? (
                    <View style={styles.tagBadge}>
                      <Text style={styles.tagBadgeText}>{item.category || item.technology}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.cardMeta}>
                    {assigned.length} users · {doneCount}/{tasks.length} completed
                  </Text>
                </View>
                <View style={styles.cardActions}>
                  {isAdmin && (
                    <TouchableOpacity style={styles.assignUsersBtn} onPress={() => openAssign(tid, item.name || item.title || 'Checklist')}>
                      <MaterialCommunityIcons name="account-plus-outline" size={18} color="#2563eb" />
                      <Text style={styles.assignUsersBtnText}>Assign Users</Text>
                    </TouchableOpacity>
                  )}
                  {isAdmin && (
                    <View style={styles.gearWrap}>
                      <TouchableOpacity
                        onPress={() => setMenuForId(showMenu ? null : tid)}
                        hitSlop={10}
                        style={styles.iconHit}
                      >
                        <MaterialCommunityIcons name="cog-outline" size={22} color="#64748b" />
                      </TouchableOpacity>
                      {showMenu ? (
                        <View style={styles.dropdownMenu}>
                          <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => {
                              openEdit(item);
                            }}
                          >
                            <Text style={styles.dropdownItemText}>Edit Template</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.dropdownItemDanger}
                            onPress={() => {
                              setMenuForId(null);
                              deleteTemplate(item);
                            }}
                          >
                            <Text style={styles.dropdownItemDangerText}>Delete Template</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  )}
                  <TouchableOpacity onPress={() => toggleExpanded(tid)} hitSlop={8} style={styles.iconHit}>
                    <MaterialCommunityIcons name={isOpen ? 'chevron-up' : 'chevron-down'} size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.progressBlock}>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressLabel}>Progress</Text>
                  <Text style={styles.progressPct}>{progress}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
              </View>

              {isOpen ? (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Assigned Users ({assigned.length})</Text>
                    {assigned.length === 0 ? (
                      <Text style={styles.sectionEmpty}>No users assigned yet</Text>
                    ) : (
                      <View style={styles.userChips}>
                        {assigned.map((uid) => {
                          const m = teamMembers.find((t) => t.user_id === uid);
                          return (
                            <TouchableOpacity
                              key={uid}
                              style={styles.userChip}
                              onPress={() => isAdmin && handleUnassign(tid, uid)}
                              disabled={!isAdmin}
                            >
                              <View style={styles.avatar}>
                                <Text style={styles.avatarTxt}>
                                  {(m?.full_name || m?.email || '?').charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <View>
                                <Text style={styles.userChipName}>{m?.full_name || m?.email || uid}</Text>
                                {m?.email ? <Text style={styles.userChipEmail}>{m.email}</Text> : null}
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  <View style={styles.section}>
                    <View style={styles.sectionHeadRow}>
                      <Text style={styles.sectionTitle}>Tasks ({tasks.length})</Text>
                      {isAdmin && (
                        <TouchableOpacity style={styles.addTaskBtn} onPress={() => openTaskModal(tid, item.name || item.title || 'Checklist')}>
                          <MaterialCommunityIcons name="plus" size={18} color="#fff" />
                          <Text style={styles.addTaskBtnText}>Add Task</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {tasks.length === 0 ? (
                      <View style={styles.tasksEmpty}>
                        <MaterialCommunityIcons name="calendar-blank-outline" size={48} color="#cbd5e1" />
                        <Text style={styles.tasksEmptyText}>No tasks created yet</Text>
                      </View>
                    ) : (
                      tasks.map((tk, idx) => (
                        <View key={taskRowId(tk) ? `${tid}-${taskRowId(tk)}` : `task-${tid}-${idx}`} style={styles.taskRow}>
                          <MaterialCommunityIcons
                            name={taskCompleted(tk) ? 'check-circle' : 'checkbox-blank-circle-outline'}
                            size={22}
                            color={taskCompleted(tk) ? '#22c55e' : '#94a3b8'}
                          />
                          <View style={styles.taskBody}>
                            <Text style={styles.taskTitle}>{tk.title || tk.name || 'Task'}</Text>
                            {tk.description ? <Text style={styles.taskDesc}>{tk.description}</Text> : null}
                            {(tk.due_date || tk.due_at) ? (
                              <Text style={styles.taskDue}>
                                Due: {new Date(tk.due_date || tk.due_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                </>
              ) : null}
            </View>
          );
        }}
      />

      {/* Assign users — single modal; high z-index box */}
      <Modal visible={!!assignModal} transparent animationType="fade" onRequestClose={() => setAssignModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlayDim}>
          <View style={styles.assignRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                setAssignModal(null);
                setAssignChecked({});
              }}
            />
            <View style={styles.assignBox}>
              <View style={styles.assignHeader}>
                <Text style={styles.assignTitle}>Assign Users to {assignModal?.templateName}</Text>
                <TouchableOpacity
                  onPress={() => {
                    setAssignModal(null);
                    setAssignChecked({});
                  }}
                  hitSlop={12}
                >
                  <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                </TouchableOpacity>
              </View>
              <View style={styles.searchRow}>
                <MaterialCommunityIcons name="magnify" size={22} color="#94a3b8" />
                <TextInput
                  style={styles.searchInput}
                  value={assignSearch}
                  onChangeText={setAssignSearch}
                  placeholder="Search users..."
                  placeholderTextColor="#94a3b8"
                />
              </View>
              <FlatList
                data={filteredForAssign}
                keyExtractor={(m) => m.user_id}
                style={styles.assignList}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={styles.assignEmpty}>No users match</Text>}
                renderItem={({ item: m }) => {
                  const checked = !!assignChecked[m.user_id];
                  return (
                    <TouchableOpacity
                      style={[styles.assignUserRow, checked && styles.assignUserRowOn]}
                      onPress={() => setAssignChecked((prev) => ({ ...prev, [m.user_id]: !checked }))}
                    >
                      <MaterialCommunityIcons
                        name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={24}
                        color={checked ? '#2563eb' : '#94a3b8'}
                      />
                      <View style={styles.assignAvatar}>
                        <Text style={styles.assignAvatarTxt}>{(m.full_name || m.email || '?').charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.assignName}>{m.full_name || m.email || 'User'}</Text>
                        {m.email ? <Text style={styles.assignEmail}>{m.email}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
              <View style={styles.assignFooter}>
                <TouchableOpacity
                  style={styles.cancelOutline}
                  onPress={() => {
                    setAssignModal(null);
                    setAssignChecked({});
                  }}
                >
                  <Text style={styles.cancelOutlineText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.assignPrimary, assigning && styles.disabled]}
                  onPress={() => void submitBatchAssign()}
                  disabled={assigning}
                >
                  <MaterialCommunityIcons name="account-plus" size={20} color="#fff" />
                  <Text style={styles.assignPrimaryText}>{assigning ? 'Assigning…' : 'Assign'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Create checklist */}
      <Modal
        visible={createModal}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlayDim}>
          <View style={styles.modalRoot}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setCreateModal(false)} />
            <ScrollView
              style={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createScroll}
            >
              <Pressable style={styles.createBox} onPress={(e) => e.stopPropagation?.()}>
                <View style={styles.createHeader}>
                  <View style={styles.createTitleBlock}>
                    <Text style={styles.createTitle}>Create New Check-List</Text>
                    <Text style={styles.createSubtitle}>Create a new Check-List template to organize tasks and assignments.</Text>
                  </View>
                  <TouchableOpacity onPress={() => setCreateModal(false)} hitSlop={12}>
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.fieldLabel, styles.fieldLabelFirst]}>Template Name</Text>
                <TextInput
                  style={styles.inputCreate}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="e.g., React Development"
                  placeholderTextColor="#94a3b8"
                />
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.inputCreate, styles.textArea]}
                  value={newDescription}
                  onChangeText={setNewDescription}
                  placeholder="Brief description"
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                />
                <Text style={styles.fieldLabel}>Technology/Category</Text>
                <TextInput
                  style={styles.inputCreate}
                  value={newCategory}
                  onChangeText={setNewCategory}
                  placeholder="e.g., React, Python"
                  placeholderTextColor="#94a3b8"
                />
                <View style={styles.createActions}>
                  <TouchableOpacity style={styles.cancelOutline} onPress={() => setCreateModal(false)}>
                    <Text style={styles.cancelOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.saveBlue, saving && styles.disabled]} onPress={() => void submitCreate()} disabled={saving}>
                    <Text style={styles.saveBlueText}>{saving ? 'Creating…' : 'Create Template'}</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit template */}
      <Modal
        visible={!!editModal}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModal(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlayDim}>
          <View style={styles.modalRoot}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditModal(null)} />
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.createScroll}>
              <Pressable style={styles.createBox} onPress={(e) => e.stopPropagation?.()}>
                <View style={styles.createHeader}>
                  <View style={styles.createTitleBlock}>
                    <Text style={styles.createTitle}>Edit Template</Text>
                    <Text style={styles.createSubtitle}>Update the learning template details.</Text>
                  </View>
                  <TouchableOpacity onPress={() => setEditModal(null)} hitSlop={12}>
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>
                {editModal ? (
                  <>
                    <Text style={[styles.fieldLabel, styles.fieldLabelFirst]}>Template Name</Text>
                    <TextInput
                      style={styles.inputCreate}
                      value={editModal.name}
                      onChangeText={(t) => setEditModal({ ...editModal, name: t })}
                    />
                    <Text style={styles.fieldLabel}>Description</Text>
                    <TextInput
                      style={[styles.inputCreate, styles.textArea]}
                      value={editModal.description}
                      onChangeText={(t) => setEditModal({ ...editModal, description: t })}
                      multiline
                      textAlignVertical="top"
                    />
                    <Text style={styles.fieldLabel}>Technology/Category</Text>
                    <TextInput
                      style={styles.inputCreate}
                      value={editModal.technology}
                      onChangeText={(t) => setEditModal({ ...editModal, technology: t })}
                    />
                  </>
                ) : null}
                <View style={styles.createActions}>
                  <TouchableOpacity style={styles.cancelOutline} onPress={() => setEditModal(null)}>
                    <Text style={styles.cancelOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBlue, editSaving && styles.disabled]}
                    onPress={() => void submitEdit()}
                    disabled={editSaving}
                  >
                    <Text style={styles.saveBlueText}>{editSaving ? 'Saving…' : 'Update Template'}</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Create task */}
      <Modal
        visible={!!taskModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setTaskModal(null);
          setTaskPicker(null);
          setTaskDueOpen(false);
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlayDim}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (taskPicker || taskDueOpen) {
                  setTaskPicker(null);
                  setTaskDueOpen(false);
                } else setTaskModal(null);
              }}
            />
            <ScrollView
              style={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createScroll}
            >
              <Pressable style={styles.createBox} onPress={(e) => e.stopPropagation?.()}>
                <View style={styles.createHeader}>
                  <View style={styles.createTitleBlock}>
                    <Text style={styles.createTitle}>Create Task</Text>
                    <Text style={styles.createSubtitle}>
                      Create a new task for the &quot;{taskModal?.templateName}&quot; template.
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setTaskModal(null);
                      setTaskPicker(null);
                      setTaskDueOpen(false);
                    }}
                    hitSlop={12}
                  >
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabel, styles.fieldLabelFirst]}>Task Title</Text>
                <TextInput
                  style={styles.inputCreate}
                  value={taskTitle}
                  onChangeText={setTaskTitle}
                  placeholder="Enter task title"
                  placeholderTextColor="#94a3b8"
                />
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.inputCreate, styles.textArea]}
                  value={taskDescription}
                  onChangeText={setTaskDescription}
                  placeholder="Enter task description"
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.fieldLabel}>Priority</Text>
                <TouchableOpacity
                  style={styles.selectField}
                  onPress={() => {
                    setTaskDueOpen(false);
                    setTaskPicker('priority');
                  }}
                >
                  <Text style={styles.selectText}>{labelPriority(taskPriority)}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>Due date & time</Text>
                <View style={styles.dateRow}>
                  <TextInput
                    style={[styles.inputCreate, styles.inputFlex]}
                    value={taskDueStr}
                    onChangeText={setTaskDueStr}
                    placeholder="YYYY-MM-DDTHH:mm"
                    placeholderTextColor="#94a3b8"
                  />
                  <TouchableOpacity
                    onPress={() => {
                      setTaskPicker(null);
                      setTaskDueOpen(true);
                    }}
                    style={styles.calBtn}
                  >
                    <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabelSmall}>
                  Assign to users (optional) — leave unchecked for a general template task.
                </Text>
                <ScrollView style={styles.assignPickScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {teamMembers.map((m) => {
                    const c = !!taskAssignChecked[m.user_id];
                    return (
                      <TouchableOpacity
                        key={m.user_id}
                        style={styles.assignPickRow}
                        onPress={() => setTaskAssignChecked((p) => ({ ...p, [m.user_id]: !c }))}
                      >
                        <MaterialCommunityIcons
                          name={c ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={c ? '#7c3aed' : '#94a3b8'}
                        />
                        <Text style={styles.assignPickText} numberOfLines={1}>
                          {m.full_name || m.email}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <View style={styles.createActions}>
                  <TouchableOpacity
                    style={styles.cancelOutline}
                    onPress={() => {
                      setTaskModal(null);
                      setTaskPicker(null);
                      setTaskDueOpen(false);
                    }}
                  >
                    <Text style={styles.cancelOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.savePurple, taskSaving && styles.disabled]}
                    onPress={() => void submitTask()}
                    disabled={taskSaving}
                  >
                    <Text style={styles.saveBlueText}>{taskSaving ? 'Saving…' : 'Create Task'}</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </ScrollView>

            {taskPicker ? (
              <View style={[styles.inlineLayer, { pointerEvents: 'box-none' }]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setTaskPicker(null)} />
                <View style={styles.inlineBox}>
                  <Text style={styles.inlineTitle}>Priority</Text>
                  <FlatList
                    data={PRIORITY_OPTIONS}
                    keyExtractor={(p) => p.id}
                    keyboardShouldPersistTaps="handled"
                    style={{ maxHeight: 200 }}
                    renderItem={({ item: p }) => (
                      <TouchableOpacity
                        style={styles.inlineRow}
                        onPress={() => {
                          setTaskPriority(p.id);
                          setTaskPicker(null);
                        }}
                      >
                        <Text style={styles.inlineRowText}>{p.label}</Text>
                        {taskPriority === p.id ? (
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

            {taskDueOpen ? (
              <View style={[styles.inlineLayer, { zIndex: 120, pointerEvents: 'box-none' }]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setTaskDueOpen(false)} />
                <View style={[styles.inlineBox, { maxWidth: 400 }]}>
                  <Text style={styles.inlineTitle}>Due date & time</Text>
                  <TemplateDueDateTimePanel
                    initialMs={taskDueMs}
                    allowClear
                    onCommit={(isoLocal) => {
                      if (isoLocal) setTaskDueStr(isoLocal);
                      else setTaskDueStr('');
                      setTaskDueOpen(false);
                    }}
                  />
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
  root: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  listEmpty: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 40 },

  headerBlock: { marginBottom: 8 },
  headerTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 20,
  },
  headerTitles: { flex: 1, minWidth: 200 },
  pageTitle: { fontSize: 28, fontWeight: '700', color: '#2563eb' },
  pageSubtitle: { fontSize: 15, color: '#64748b', marginTop: 8, lineHeight: 22 },
  primaryBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#334155', marginTop: 16 },
  emptySubtitle: { fontSize: 15, color: '#94a3b8', marginTop: 8, textAlign: 'center' },
  emptyBtn: {
    marginTop: 24,
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
  },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'visible',
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15,23,42,0.06)' },
      default: { elevation: 2 },
    }),
  },
 
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    position: 'relative',
    zIndex: 50,
    elevation: 8,
  },
  bookIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1e40af',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleBlock: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  cardDesc: { fontSize: 14, color: '#64748b', marginTop: 6 },
  tagBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  tagBadgeText: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
  cardMeta: { fontSize: 13, color: '#64748b', marginTop: 8 },
  cardActions: { alignItems: 'flex-end', gap: 8, position: 'relative', zIndex: 51 },
  assignUsersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  assignUsersBtnText: { fontSize: 13, fontWeight: '600', color: '#2563eb' },
  gearWrap: { position: 'relative', zIndex: 52 },
  iconHit: { padding: 4 },
  dropdownMenu: {
    position: 'absolute',
    top: 36,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minWidth: 160,
    zIndex: 9999,
    elevation: 24,
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(15,23,42,0.12)' },
      default: {},
    }),
  },
  dropdownItem: { paddingVertical: 12, paddingHorizontal: 14 },
  dropdownItemText: { fontSize: 15, color: '#0f172a', fontWeight: '500' },
  dropdownItemDanger: { paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  dropdownItemDangerText: { fontSize: 15, color: '#dc2626', fontWeight: '600' },

  progressBlock: { marginTop: 14, position: 'relative', zIndex: 0 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 13, fontWeight: '600', color: '#475569' },
  progressPct: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  progressTrack: { height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: '#6366f1', borderRadius: 4 },

  section: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  sectionHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  sectionEmpty: { fontSize: 14, color: '#94a3b8' },
  userChips: { gap: 10 },
  userChip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#c7d2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { fontSize: 16, fontWeight: '700', color: '#3730a3' },
  userChipName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  userChipEmail: { fontSize: 13, color: '#64748b', marginTop: 2 },

  addTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#6366f1',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  addTaskBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  tasksEmpty: { alignItems: 'center', paddingVertical: 28 },
  tasksEmptyText: { marginTop: 10, fontSize: 14, color: '#94a3b8' },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  taskBody: { flex: 1 },
  taskTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  taskDesc: { fontSize: 13, color: '#64748b', marginTop: 4 },
  taskDue: { fontSize: 12, color: '#6366f1', marginTop: 4 },

  overlayDim: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
  },
  assignRoot: { flex: 1, justifyContent: 'center', padding: 16, position: 'relative' },
  assignBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    maxHeight: '85%',
    zIndex: 2,
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(15,23,42,0.2)' },
      default: { elevation: 8 },
    }),
  },
  assignHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  assignTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#2563eb', paddingRight: 8 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    backgroundColor: '#f8fafc',
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 16, color: '#0f172a' },
  assignList: { maxHeight: 320 },
  assignEmpty: { textAlign: 'center', color: '#94a3b8', padding: 20 },
  assignUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  assignUserRowOn: { backgroundColor: '#eff6ff' },
  assignAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignAvatarTxt: { fontSize: 16, fontWeight: '700', color: '#4338ca' },
  assignName: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  assignEmail: { fontSize: 13, color: '#64748b', marginTop: 2 },
  assignFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  assignPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  assignPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  modalRoot: { flex: 1, justifyContent: 'center', padding: 16, position: 'relative' },
  modalScroll: { zIndex: 1, ...Platform.select({ web: { position: 'relative' as const }, default: {} }) },
  createScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  createBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    ...Platform.select({
      web: { boxShadow: '0 10px 40px rgba(15,23,42,0.15)' },
      default: { elevation: 8 },
    }),
  },
  createHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  createTitleBlock: { flex: 1, paddingRight: 8, minWidth: 0 },
  createTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  createSubtitle: { fontSize: 14, color: '#64748b', marginTop: 8, lineHeight: 20 },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 8, marginTop: 16 },
  fieldLabelFirst: { marginTop: 4 },
  fieldLabelSmall: { fontSize: 12, color: '#64748b', marginTop: 12, marginBottom: 8, lineHeight: 18 },
  inputCreate: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  inputFlex: { flex: 1, minWidth: 0 },
  textArea: { minHeight: 100, paddingTop: 12 },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
  },
  selectText: { flex: 1, fontSize: 16, color: '#0f172a' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calBtn: { padding: 10 },
  assignPickScroll: { maxHeight: 160, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, marginTop: 4 },
  assignPickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  assignPickText: { flex: 1, fontSize: 15, color: '#0f172a' },

  createActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 24 },
  cancelOutline: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  cancelOutlineText: { fontSize: 15, fontWeight: '600', color: '#334155' },
  saveBlue: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  savePurple: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
  },
  saveBlueText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  disabled: { opacity: 0.65 },

  inlineLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 20,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  inlineBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    width: '100%',
    maxWidth: 360,
    paddingVertical: 8,
    zIndex: 101,
    elevation: 21,
    ...Platform.select({
      web: { boxShadow: '0 12px 48px rgba(15,23,42,0.25)' },
      default: {},
    }),
  },
  inlineTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', paddingHorizontal: 16, paddingBottom: 8 },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  inlineRowText: { flex: 1, fontSize: 16, color: '#0f172a' },
});
