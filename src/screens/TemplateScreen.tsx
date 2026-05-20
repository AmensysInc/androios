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
import { useTasksScopeFilters } from '../hooks/useTasksScopeFilters';
import {
  canAccessChecklistTemplates,
  isDuplicateTemplate,
  isDuplicateTemplateTask,
} from '../lib/checklistWorkflow';
import { devWarn } from '../lib/logger';

type PickerOption = { id: string; label: string };

function templateOrgId(t: any): string {
  const o = t?.organization;
  if (o != null && typeof o === 'object') return String((o as any).id ?? '').trim();
  return String(t?.organization_id ?? t?.organization ?? '').trim();
}

function templateCompanyId(t: any): string {
  const c = t?.company;
  if (c != null && typeof c === 'object') return String((c as any).id ?? '').trim();
  return String(t?.company_id ?? t?.company ?? '').trim();
}

function labelFor(options: PickerOption[], id: string, fallback: string) {
  return options.find((o) => o.id === id)?.label ?? fallback;
}

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

function templateTaskCreatedLine(tk: any): string {
  const raw = tk?.created_at ?? tk?.created;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `Created ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function templateTaskPriority(tk: any): string {
  const p = String(tk?.priority ?? 'medium').toLowerCase();
  if (p === 'high' || p === 'low') return p;
  return 'medium';
}

function templateTaskNotes(tk: any): string {
  return String(tk?.description ?? tk?.notes ?? '').trim();
}

function templateTaskCompanyName(tk: any, templateItem: any): string {
  const fromRow = tk?.company_name ?? (typeof tk?.company === 'object' ? tk?.company?.name : '');
  if (fromRow && String(fromRow).trim()) return String(fromRow).trim();
  return String(templateItem?.company?.name ?? '').trim();
}

function priorityBadgeStyle(pr: string) {
  if (pr === 'high') return { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' };
  if (pr === 'low') return { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
  return { bg: '#dbeafe', text: '#1d4ed8', border: '#bfdbfe' };
}

export default function TemplateScreen() {
  const { user, role } = useAuth();
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateTasks, setTemplateTasks] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [menuForId, setMenuForId] = useState<string | null>(null);

  const [createModal, setCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [createOrgId, setCreateOrgId] = useState('');
  const [createCompanyId, setCreateCompanyId] = useState('');
  const [createCompanyOptions, setCreateCompanyOptions] = useState<PickerOption[]>([]);
  const [createPicker, setCreatePicker] = useState<'organization' | 'company' | null>(null);
  const [filterPicker, setFilterPicker] = useState<'organization' | 'company' | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    showOrgFilter,
    showCompanyFilter,
    organizationOptions,
    companyOptions,
    filterOrgId,
    filterCompanyId,
    setFilterCompanyId,
    onSelectOrganization,
    scopeReady,
  } = useTasksScopeFilters(user, role ?? null);

  const [editModal, setEditModal] = useState<{
    id: string;
    name: string;
    description: string;
    technology: string;
    organizationId: string;
    companyId: string;
  } | null>(null);
  const [editCompanyOptions, setEditCompanyOptions] = useState<PickerOption[]>([]);
  const [editPicker, setEditPicker] = useState<'organization' | 'company' | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [taskModal, setTaskModal] = useState<{ templateId: string; templateName: string } | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskPicker, setTaskPicker] = useState<'priority' | null>(null);

  const [taskExpanded, setTaskExpanded] = useState<Record<string, boolean>>({});
  const [editTaskModal, setEditTaskModal] = useState<{
    id: string;
    templateId: string;
    templateName: string;
    originalTitle: string;
  } | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDescription, setEditTaskDescription] = useState('');
  const [editTaskPriority, setEditTaskPriority] = useState('medium');
  const [editTaskSaving, setEditTaskSaving] = useState(false);
  const [editTaskDeleting, setEditTaskDeleting] = useState(false);
  const [editTaskPicker, setEditTaskPicker] = useState<'priority' | null>(null);

  const canManageChecklists = canAccessChecklistTemplates(role);
  const isAdmin = canManageChecklists;

  const norm = (v: any) => (v != null ? String(v) : '');

  const loadTemplates = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (filterOrgId && filterOrgId !== 'all') params.organization_id = filterOrgId;
      if (filterCompanyId && filterCompanyId !== 'all') params.company_id = filterCompanyId;
      const raw = await api.getTemplates(Object.keys(params).length ? params : undefined);
      setTemplates(Array.isArray(raw) ? raw : []);
    } catch (e) {
      devWarn(e);
    }
  }, [filterOrgId, filterCompanyId]);

  const loadTasksForTemplates = useCallback(async (list: any[]) => {
    const next: Record<string, any[]> = {};
    for (const t of list) {
      const id = templateRowId(t);
      if (id) next[id] = [];
    }
    try {
      const grouped = await api.getChecklistTemplateTasksGrouped();
      for (const id of Object.keys(next)) {
        if (grouped[id]?.length) next[id] = grouped[id];
      }
    } catch (e) {
      devWarn(e);
    }
    setTemplateTasks(next);
  }, []);

  const loadCreateCompanyOptions = useCallback(async (orgId: string) => {
    try {
      const raw = await api.getCompanies();
      const list = Array.isArray(raw) ? raw : [];
      const opts: PickerOption[] = [];
      for (const c of list) {
        const id = String((c as any).id ?? '').trim();
        if (!id) continue;
        const oid = String(
          (c as any).organization_id ??
            ((c as any).organization && typeof (c as any).organization === 'object'
              ? (c as any).organization.id
              : (c as any).organization) ??
            ''
        ).trim();
        if (orgId && orgId !== 'all' && oid !== orgId) continue;
        opts.push({ id, label: String((c as any).name ?? id) });
      }
      setCreateCompanyOptions(opts);
      if (opts.length === 1) setCreateCompanyId(opts[0].id);
    } catch {
      setCreateCompanyOptions([]);
    }
  }, []);

  const [createOrgOptions, setCreateOrgOptions] = useState<PickerOption[]>([]);

  useEffect(() => {
    if ((!createModal && !editModal) || !isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await api.getOrganizations();
        const list = Array.isArray(raw) ? raw : [];
        const opts: PickerOption[] = [];
        for (const o of list) {
          const id = String((o as any).id ?? '').trim();
          if (!id) continue;
          opts.push({ id, label: String((o as any).name ?? id) });
        }
        if (!cancelled) setCreateOrgOptions(opts);
      } catch {
        if (!cancelled) setCreateOrgOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createModal, editModal, isAdmin]);

  useEffect(() => {
    if (!createModal) return;
    void loadCreateCompanyOptions(createOrgId);
  }, [createModal, createOrgId, loadCreateCompanyOptions]);

  const load = useCallback(async () => {
    try {
      await loadTemplates();
    } catch (e) {
      devWarn(e);
    }
    setLoading(false);
    setRefreshing(false);
  }, [loadTemplates]);

  useEffect(() => {
    if (!canManageChecklists) {
      setLoading(false);
      return;
    }
    if (!scopeReady) return;
    load();
  }, [load, scopeReady, canManageChecklists]);

  const displayedTemplates = useMemo(() => {
    let list = templates;
    const orgId = filterOrgId !== 'all' ? filterOrgId : '';
    const coId = filterCompanyId !== 'all' ? filterCompanyId : '';
    if (orgId) {
      list = list.filter((t) => {
        const rowOrg = templateOrgId(t);
        return !rowOrg || rowOrg === orgId;
      });
    }
    if (coId) {
      list = list.filter((t) => {
        const rowCo = templateCompanyId(t);
        return !rowCo || rowCo === coId;
      });
    }
    return list;
  }, [templates, filterOrgId, filterCompanyId]);

  useEffect(() => {
    if (displayedTemplates.length === 0) {
      setTemplateTasks({});
      return;
    }
    void loadTasksForTemplates(displayedTemplates);
  }, [displayedTemplates, loadTasksForTemplates]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const openCreateModal = () => {
    setNewName('');
    setNewDescription('');
    setNewCategory('');
    setCreatePicker(null);
    const defaultOrg =
      filterOrgId && filterOrgId !== 'all'
        ? filterOrgId
        : organizationOptions.find((o) => o.id !== 'all')?.id ?? '';
    const defaultCo =
      filterCompanyId && filterCompanyId !== 'all'
        ? filterCompanyId
        : companyOptions.find((o) => o.id !== 'all')?.id ?? '';
    setCreateOrgId(defaultOrg);
    setCreateCompanyId(defaultCo);
    setCreateModal(true);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) {
      Alert.alert('Validation', 'Enter a template name');
      return;
    }
    const orgId = String(createOrgId ?? '').trim();
    const companyId = String(createCompanyId ?? '').trim();
    if (!companyId) {
      Alert.alert('Validation', 'Select a company');
      return;
    }
    if (isDuplicateTemplate(templates, name, companyId, orgId || undefined)) {
      Alert.alert('Validation', 'A checklist with this name already exists for this company.');
      return;
    }
    setSaving(true);
    try {
      await api.createTemplate(
        stripFields({
          name,
          description: newDescription.trim() || undefined,
          category: newCategory.trim() || undefined,
          organizationId: orgId || undefined,
          companyId,
        })
      );
      setCreateModal(false);
      await loadTemplates();
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

  const loadEditCompanyOptions = useCallback(async (orgId: string) => {
    try {
      const raw = await api.getCompanies();
      const list = Array.isArray(raw) ? raw : [];
      const opts: PickerOption[] = [];
      for (const c of list) {
        const id = String((c as any).id ?? '').trim();
        if (!id) continue;
        const oid = String(
          (c as any).organization_id ??
            ((c as any).organization && typeof (c as any).organization === 'object'
              ? (c as any).organization.id
              : (c as any).organization) ??
            ''
        ).trim();
        if (orgId && orgId !== 'all' && oid !== orgId) continue;
        opts.push({ id, label: String((c as any).name ?? id) });
      }
      setEditCompanyOptions(opts);
    } catch {
      setEditCompanyOptions([]);
    }
  }, []);

  useEffect(() => {
    if (!editModal) return;
    void loadEditCompanyOptions(editModal.organizationId);
  }, [editModal?.organizationId, editModal, loadEditCompanyOptions]);

  const openEdit = (t: any) => {
    const id = templateRowId(t);
    if (!id) return;
    setMenuForId(null);
    setEditPicker(null);
    setEditModal({
      id,
      name: String(t.name || t.title || ''),
      description: String(t.description || ''),
      technology: String(t.category || t.technology || ''),
      organizationId: templateOrgId(t),
      companyId: templateCompanyId(t),
    });
  };

  const submitEdit = async () => {
    if (!editModal) return;
    const name = editModal.name.trim();
    if (!name) {
      Alert.alert('Validation', 'Name is required');
      return;
    }
    if (!editModal.companyId) {
      Alert.alert('Validation', 'Select a company');
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
          organizationId: editModal.organizationId || undefined,
          companyId: editModal.companyId,
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
    setTaskPicker(null);
    setTaskModal({ templateId, templateName });
  };

  const submitTask = async () => {
    if (!taskModal) return;
    const title = taskTitle.trim();
    if (!title) {
      Alert.alert('Validation', 'Task title is required');
      return;
    }
    const existing = templateTasks[taskModal.templateId] || [];
    if (isDuplicateTemplateTask(existing, title)) {
      Alert.alert('Validation', 'A task with this title already exists in this template.');
      return;
    }

    setTaskSaving(true);
    try {
      await api.createTemplateTask(
        taskModal.templateId,
        stripFields({
          title,
          description: taskDescription.trim() || undefined,
          priority: taskPriority,
        })
      );
      setTaskModal(null);
      setTaskPicker(null);
      await loadTasksForTemplates(displayedTemplates.length ? displayedTemplates : templates);
    } catch (e: unknown) {
      Alert.alert('Error', formatTemplateError(e));
    } finally {
      setTaskSaving(false);
    }
  };

  const labelPriority = (id: string) => PRIORITY_OPTIONS.find((p) => p.id === id)?.label ?? id;

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleTaskExpanded = (id: string) => {
    setTaskExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openEditTask = (tk: any, templateId: string, templateName: string) => {
    const id = taskRowId(tk);
    if (!id) {
      Alert.alert('Error', 'This task cannot be edited (missing id).');
      return;
    }
    setEditTaskModal({
      id,
      templateId,
      templateName,
      originalTitle: tk.title || tk.task_name || 'Task',
    });
    setEditTaskTitle(tk.title || tk.task_name || '');
    setEditTaskDescription(templateTaskNotes(tk));
    setEditTaskPriority(templateTaskPriority(tk));
    setEditTaskPicker(null);
  };

  const submitEditTask = async () => {
    if (!editTaskModal) return;
    const title = editTaskTitle.trim();
    if (!title) {
      Alert.alert('Validation', 'Task title is required');
      return;
    }
    setEditTaskSaving(true);
    try {
      await api.updateChecklistTemplateTask(editTaskModal.id, {
        title,
        description: editTaskDescription.trim() || undefined,
        priority: editTaskPriority,
      });
      setEditTaskModal(null);
      setEditTaskPicker(null);
      await loadTasksForTemplates(displayedTemplates.length ? displayedTemplates : templates);
    } catch (e: unknown) {
      Alert.alert('Error', formatTemplateError(e));
    } finally {
      setEditTaskSaving(false);
    }
  };

  const deleteTemplateTaskRow = (tk: any, fromModal?: boolean) => {
    const id = taskRowId(tk);
    if (!id) {
      Alert.alert('Error', 'This task cannot be deleted (missing id).');
      return;
    }
    const title = tk.title || tk.task_name || 'this task';
    Alert.alert('Delete Task', `Delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (fromModal) setEditTaskDeleting(true);
            try {
              await api.deleteChecklistTemplateTask(id);
              if (fromModal) {
                setEditTaskModal(null);
                setEditTaskPicker(null);
              }
              setTaskExpanded((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
              });
              await loadTasksForTemplates(displayedTemplates.length ? displayedTemplates : templates);
            } catch (e: unknown) {
              Alert.alert('Error', formatTemplateError(e));
            } finally {
              if (fromModal) setEditTaskDeleting(false);
            }
          })();
        },
      },
    ]);
  };

  if (!canManageChecklists) {
    return (
      <View style={styles.centered}>
        <MaterialCommunityIcons name="book-lock-outline" size={56} color="#cbd5e1" />
        <Text style={[styles.pageTitle, { marginTop: 16, textAlign: 'center' }]}>Check Lists</Text>
        <Text style={[styles.pageSubtitle, { textAlign: 'center', maxWidth: 320, marginTop: 8 }]}>
          Checklist templates are managed by administrators during shift scheduling. Your assigned work appears on
          the Tasks page.
        </Text>
      </View>
    );
  }

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
        data={displayedTemplates}
        keyExtractor={(item, index) => templateRowId(item) || `tpl-${index}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        removeClippedSubviews={false}
        contentContainerStyle={displayedTemplates.length === 0 ? styles.listEmpty : styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.headerTop}>
              <View style={styles.headerTitles}>
                <Text style={styles.pageTitle}>Check Lists</Text>
                <Text style={styles.pageSubtitle}>
                  Reusable checklist blueprints by organization and company. Assign tasks to employees during shift
                  scheduling — not from this page.
                </Text>
              </View>
              {isAdmin && (
                <TouchableOpacity style={styles.primaryBtn} onPress={openCreateModal} activeOpacity={0.9}>
                  <Text style={styles.primaryBtnText}>+ New Checklist</Text>
                </TouchableOpacity>
              )}
            </View>

            {isAdmin && (showOrgFilter || showCompanyFilter) ? (
              <View style={styles.scopeFilterRow}>
                {showOrgFilter ? (
                  <View style={styles.scopeFilterCol}>
                    <Text style={styles.scopeFilterLabel}>Organization</Text>
                    <TouchableOpacity
                      style={styles.scopeSelect}
                      onPress={() => setFilterPicker('organization')}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.scopeSelectText} numberOfLines={1}>
                        {labelFor(organizationOptions, filterOrgId, 'All organizations')}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                ) : null}
                {showCompanyFilter ? (
                  <View style={styles.scopeFilterCol}>
                    <Text style={styles.scopeFilterLabel}>Company</Text>
                    <TouchableOpacity
                      style={styles.scopeSelect}
                      onPress={() => setFilterPicker('company')}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.scopeSelectText} numberOfLines={1}>
                        {labelFor(companyOptions, filterCompanyId, 'All companies')}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}

            {displayedTemplates.length === 0 ? (
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
          const tasks = templateTasks[tid] || [];
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
                  {item.description ? (
                    <Text style={styles.cardDesc}>{item.description}</Text>
                  ) : (
                    <Text style={styles.cardDescMuted}>No description available</Text>
                  )}
                  <View style={styles.cardScopeBlock}>
                    <View style={styles.cardScopeItem}>
                      <Text style={styles.cardScopeLabel}>ORGANIZATION</Text>
                      <View style={styles.cardScopeValueRow}>
                        <MaterialCommunityIcons name="lock-outline" size={14} color="#94a3b8" />
                        <Text style={styles.cardScopeValue} numberOfLines={1}>
                          {item.organization?.name || '—'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.cardScopeItem}>
                      <Text style={styles.cardScopeLabel}>COMPANY</Text>
                      <View style={styles.cardScopeValueRow}>
                        <MaterialCommunityIcons name="lock-outline" size={14} color="#94a3b8" />
                        <Text style={styles.cardScopeValue} numberOfLines={1}>
                          {item.company?.name || '—'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {(item.category || item.technology) ? (
                    <View style={styles.tagBadge}>
                      <Text style={styles.tagBadgeText}>{item.category || item.technology}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.cardActions}>
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

              {isOpen ? (
                <>
                  <View style={styles.section}>
                    <View style={styles.sectionHeadRow}>
                      <View style={styles.sectionTitleRow}>
                        <MaterialCommunityIcons name="calendar-month-outline" size={20} color="#0f172a" />
                        <Text style={styles.sectionTitle}>Tasks ({tasks.length})</Text>
                      </View>
                      {isAdmin && (
                        <TouchableOpacity
                          style={styles.addTaskBtn}
                          onPress={() => openTaskModal(tid, item.name || item.title || 'Checklist')}
                        >
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
                      tasks.map((tk, idx) => {
                        const kid = taskRowId(tk);
                        const taskOpen = kid ? !!taskExpanded[kid] : false;
                        const pr = templateTaskPriority(tk);
                        const pb = priorityBadgeStyle(pr);
                        const coName = templateTaskCompanyName(tk, item);
                        const created = templateTaskCreatedLine(tk);
                        const notes = templateTaskNotes(tk);
                        const tplName = item.name || item.title || 'Checklist';

                        return (
                          <View
                            key={kid ? `${tid}-${kid}` : `task-${tid}-${idx}`}
                            style={[styles.tplTaskCard, taskOpen && styles.tplTaskCardOpen]}
                          >
                            <TouchableOpacity
                              style={styles.tplTaskCollapsed}
                              onPress={() => kid && toggleTaskExpanded(kid)}
                              activeOpacity={0.85}
                            >
                              <View style={styles.tplTaskCollapsedMain}>
                                <Text style={styles.tplTaskCollapsedTitle} numberOfLines={2}>
                                  {tk.title || tk.name || 'Task'}
                                </Text>
                                {created ? <Text style={styles.tplTaskCreated}>{created}</Text> : null}
                              </View>
                              <View style={styles.tplTaskCollapsedMeta}>
                                {coName ? (
                                  <View style={styles.tplMetaChip}>
                                    <MaterialCommunityIcons name="office-building-outline" size={14} color="#64748b" />
                                    <Text style={styles.tplMetaChipText} numberOfLines={1}>
                                      {coName}
                                    </Text>
                                  </View>
                                ) : null}
                                <View style={[styles.tplPriorityPill, { backgroundColor: pb.bg, borderColor: pb.border }]}>
                                  <Text style={[styles.tplPriorityPillText, { color: pb.text }]}>{pr}</Text>
                                </View>
                                <View style={styles.tplTypePill}>
                                  <MaterialCommunityIcons name="book-open-variant" size={12} color="#475569" />
                                  <Text style={styles.tplTypePillText}>Template</Text>
                                </View>
                                <MaterialCommunityIcons
                                  name={taskOpen ? 'chevron-down' : 'chevron-right'}
                                  size={22}
                                  color="#64748b"
                                />
                              </View>
                            </TouchableOpacity>

                            {taskOpen ? (
                              <View style={styles.tplTaskExpanded}>
                                <View style={styles.tplTaskExpandedHead}>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.tplTaskExpandedTitle}>{tk.title || tk.name || 'Task'}</Text>
                                    <View style={styles.tplTaskExpandedMeta}>
                                      {coName ? (
                                        <View style={styles.tplMetaChip}>
                                          <MaterialCommunityIcons name="office-building-outline" size={14} color="#64748b" />
                                          <Text style={styles.tplMetaChipText}>{coName}</Text>
                                        </View>
                                      ) : null}
                                      <View
                                        style={[styles.tplPriorityPill, { backgroundColor: pb.bg, borderColor: pb.border }]}
                                      >
                                        <Text style={[styles.tplPriorityPillText, { color: pb.text }]}>{pr}</Text>
                                      </View>
                                      <View style={[styles.tplTypePill, styles.tplTypePillBlue]}>
                                        <MaterialCommunityIcons name="book-open-variant" size={12} color="#1d4ed8" />
                                        <Text style={[styles.tplTypePillText, styles.tplTypePillTextBlue]}>Template Task</Text>
                                      </View>
                                    </View>
                                  </View>
                                  {isAdmin ? (
                                    <TouchableOpacity
                                      style={styles.tplEditBtn}
                                      onPress={() => openEditTask(tk, tid, tplName)}
                                      activeOpacity={0.85}
                                    >
                                      <MaterialCommunityIcons name="pencil-outline" size={18} color="#475569" />
                                      <Text style={styles.tplEditBtnText}>Edit</Text>
                                    </TouchableOpacity>
                                  ) : null}
                                </View>

                                <Text style={styles.tplNotesLabel}>Notes</Text>
                                <View style={styles.tplNotesBox}>
                                  {notes ? (
                                    <Text style={styles.tplNotesBody}>{notes}</Text>
                                  ) : (
                                    <View style={styles.tplNotesPlaceholder}>
                                      <MaterialCommunityIcons name="text-box-outline" size={20} color="#94a3b8" />
                                      <Text style={styles.tplNotesPlaceholderText}>No notes</Text>
                                    </View>
                                  )}
                                </View>

                                {isAdmin ? (
                                  <TouchableOpacity
                                    style={styles.tplDeleteTaskBtn}
                                    onPress={() => deleteTemplateTaskRow(tk)}
                                    activeOpacity={0.85}
                                  >
                                    <MaterialCommunityIcons name="trash-can-outline" size={20} color="#dc2626" />
                                    <Text style={styles.tplDeleteTaskText}>Delete Task</Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                        );
                      })
                    )}
                  </View>
                </>
              ) : null}
            </View>
          );
        }}
      />

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
                    <Text style={styles.createSubtitle}>
                      Create a checklist template for a company. Tasks apply to everyone who works at that company.
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setCreateModal(false)} hitSlop={12}>
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                {isAdmin ? (
                  <>
                    <Text style={[styles.fieldLabel, styles.fieldLabelFirst]}>Organization *</Text>
                    <TouchableOpacity
                      style={styles.selectField}
                      onPress={() => setCreatePicker('organization')}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.selectText} numberOfLines={1}>
                        {labelFor(createOrgOptions, createOrgId, 'Select organization')}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>Company *</Text>
                    <TouchableOpacity
                      style={styles.selectField}
                      onPress={() => setCreatePicker('company')}
                      activeOpacity={0.85}
                      disabled={!createOrgId}
                    >
                      <Text style={[styles.selectText, !createOrgId && styles.selectFieldPh]} numberOfLines={1}>
                        {labelFor(createCompanyOptions, createCompanyId, 'Select company')}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                    </TouchableOpacity>
                  </>
                ) : null}

                <Text style={[styles.fieldLabel, isAdmin ? undefined : styles.fieldLabelFirst]}>Template Name</Text>
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
                  placeholder="Brief description of the learning template"
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
                  <TouchableOpacity
                    style={styles.cancelOutline}
                    onPress={() => {
                      setCreatePicker(null);
                      setCreateModal(false);
                    }}
                  >
                    <Text style={styles.cancelOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.saveBlue, saving && styles.disabled]} onPress={() => void submitCreate()} disabled={saving}>
                    <Text style={styles.saveBlueText}>{saving ? 'Creating…' : 'Create Template'}</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            </ScrollView>

            {createPicker ? (
              <View style={styles.createPickerLayer}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setCreatePicker(null)} />
                <View style={styles.createPickerBox}>
                  <Text style={styles.createPickerTitle}>
                    {createPicker === 'organization' ? 'Organization' : 'Company'}
                  </Text>
                  <FlatList
                    data={createPicker === 'organization' ? createOrgOptions : createCompanyOptions}
                    keyExtractor={(i) => i.id}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item: opt }) => {
                      const selectedId = createPicker === 'organization' ? createOrgId : createCompanyId;
                      return (
                        <TouchableOpacity
                          style={styles.createPickerRow}
                          onPress={() => {
                            if (createPicker === 'organization') {
                              setCreateOrgId(opt.id);
                              setCreateCompanyId('');
                            } else {
                              setCreateCompanyId(opt.id);
                            }
                            setCreatePicker(null);
                          }}
                        >
                          <Text style={styles.createPickerRowText}>{opt.label}</Text>
                          {selectedId === opt.id ? (
                            <MaterialCommunityIcons name="check" size={22} color="#2563eb" />
                          ) : (
                            <View style={{ width: 22 }} />
                          )}
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={filterPicker != null} transparent animationType="fade" onRequestClose={() => setFilterPicker(null)}>
        <View style={styles.overlayDim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFilterPicker(null)} />
          <View style={styles.filterPickerBox}>
            <Text style={styles.createPickerTitle}>
              {filterPicker === 'organization' ? 'Organization' : 'Company'}
            </Text>
            <FlatList
              data={filterPicker === 'organization' ? organizationOptions : companyOptions}
              keyExtractor={(i) => i.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: opt }) => {
                const selectedId = filterPicker === 'organization' ? filterOrgId : filterCompanyId;
                return (
                  <TouchableOpacity
                    style={styles.createPickerRow}
                    onPress={() => {
                      if (filterPicker === 'organization') onSelectOrganization(opt.id);
                      else setFilterCompanyId(opt.id);
                      setFilterPicker(null);
                    }}
                  >
                    <Text style={styles.createPickerRowText}>{opt.label}</Text>
                    {selectedId === opt.id ? (
                      <MaterialCommunityIcons name="check" size={22} color="#2563eb" />
                    ) : (
                      <View style={{ width: 22 }} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
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
                    <Text style={styles.createSubtitle}>
                      Update template details and which company it applies to.
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setEditPicker(null);
                      setEditModal(null);
                    }}
                    hitSlop={12}
                  >
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>
                {editModal ? (
                  <>
                    <Text style={[styles.fieldLabel, styles.fieldLabelFirst]}>Organization *</Text>
                    <TouchableOpacity
                      style={styles.selectField}
                      onPress={() => setEditPicker('organization')}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.selectText} numberOfLines={1}>
                        {labelFor(createOrgOptions, editModal.organizationId, 'Select organization')}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>Company *</Text>
                    <TouchableOpacity
                      style={styles.selectField}
                      onPress={() => setEditPicker('company')}
                      activeOpacity={0.85}
                      disabled={!editModal.organizationId}
                    >
                      <Text
                        style={[styles.selectText, !editModal.organizationId && styles.selectFieldPh]}
                        numberOfLines={1}
                      >
                        {labelFor(editCompanyOptions, editModal.companyId, 'Select company')}
                      </Text>
                      <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                    </TouchableOpacity>

                    <Text style={styles.fieldLabel}>Template Name</Text>
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
                      placeholder="Brief description of the learning template"
                      placeholderTextColor="#94a3b8"
                      multiline
                      textAlignVertical="top"
                    />
                    <Text style={styles.fieldLabel}>Technology/Category</Text>
                    <TextInput
                      style={styles.inputCreate}
                      value={editModal.technology}
                      onChangeText={(t) => setEditModal({ ...editModal, technology: t })}
                      placeholder="e.g., React, Python, Java"
                      placeholderTextColor="#94a3b8"
                    />
                  </>
                ) : null}
                <View style={styles.createActions}>
                  <TouchableOpacity
                    style={styles.cancelOutline}
                    onPress={() => {
                      setEditPicker(null);
                      setEditModal(null);
                    }}
                  >
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

            {editModal && editPicker ? (
              <View style={styles.createPickerLayer}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditPicker(null)} />
                <View style={styles.createPickerBox}>
                  <Text style={styles.createPickerTitle}>
                    {editPicker === 'organization' ? 'Organization' : 'Company'}
                  </Text>
                  <FlatList
                    data={editPicker === 'organization' ? createOrgOptions : editCompanyOptions}
                    keyExtractor={(i) => i.id}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item: opt }) => {
                      const selectedId =
                        editPicker === 'organization' ? editModal.organizationId : editModal.companyId;
                      return (
                        <TouchableOpacity
                          style={styles.createPickerRow}
                          onPress={() => {
                            if (editPicker === 'organization') {
                              setEditModal({
                                ...editModal,
                                organizationId: opt.id,
                                companyId: '',
                              });
                            } else {
                              setEditModal({ ...editModal, companyId: opt.id });
                            }
                            setEditPicker(null);
                          }}
                        >
                          <Text style={styles.createPickerRowText}>{opt.label}</Text>
                          {selectedId === opt.id ? (
                            <MaterialCommunityIcons name="check" size={22} color="#2563eb" />
                          ) : (
                            <View style={{ width: 22 }} />
                          )}
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>
              </View>
            ) : null}
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
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlayDim}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (taskPicker) setTaskPicker(null);
                else setTaskModal(null);
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
                  onPress={() => setTaskPicker('priority')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.selectText}>{labelPriority(taskPriority)}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <View style={styles.createActions}>
                  <TouchableOpacity
                    style={styles.cancelOutline}
                    onPress={() => {
                      setTaskModal(null);
                      setTaskPicker(null);
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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit task */}
      <Modal
        visible={!!editTaskModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setEditTaskModal(null);
          setEditTaskPicker(null);
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlayDim}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (editTaskPicker) setEditTaskPicker(null);
                else setEditTaskModal(null);
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
                    <Text style={styles.createTitle}>Edit Task</Text>
                    <Text style={styles.createSubtitle}>
                      Update the task details for &quot;{editTaskModal?.originalTitle}&quot;.
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setEditTaskModal(null);
                      setEditTaskPicker(null);
                    }}
                    hitSlop={12}
                  >
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.fieldLabel, styles.fieldLabelFirst]}>Task Title</Text>
                <TextInput
                  style={styles.inputCreate}
                  value={editTaskTitle}
                  onChangeText={setEditTaskTitle}
                  placeholder="Enter task title"
                  placeholderTextColor="#94a3b8"
                />
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.inputCreate, styles.textArea]}
                  value={editTaskDescription}
                  onChangeText={setEditTaskDescription}
                  placeholder="Enter task description"
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.fieldLabel}>Priority</Text>
                <TouchableOpacity
                  style={styles.selectField}
                  onPress={() => setEditTaskPicker('priority')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.selectText}>{labelPriority(editTaskPriority)}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>

                <View style={styles.editTaskActions}>
                  <TouchableOpacity
                    style={[styles.deleteTaskModalBtn, (editTaskSaving || editTaskDeleting) && styles.disabled]}
                    onPress={() =>
                      editTaskModal &&
                      deleteTemplateTaskRow(
                        { id: editTaskModal.id, title: editTaskTitle, task_name: editTaskTitle },
                        true
                      )
                    }
                    disabled={editTaskSaving || editTaskDeleting}
                  >
                    <Text style={styles.deleteTaskModalText}>
                      {editTaskDeleting ? 'Deleting…' : 'Delete Task'}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.editTaskActionsRight}>
                    <TouchableOpacity
                      style={styles.cancelOutline}
                      onPress={() => {
                        setEditTaskModal(null);
                        setEditTaskPicker(null);
                      }}
                    >
                      <Text style={styles.cancelOutlineText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.saveBlue, (editTaskSaving || editTaskDeleting) && styles.disabled]}
                      onPress={() => void submitEditTask()}
                      disabled={editTaskSaving || editTaskDeleting}
                    >
                      <Text style={styles.saveBlueText}>{editTaskSaving ? 'Saving…' : 'Update Task'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Pressable>
            </ScrollView>

            {editTaskPicker ? (
              <View style={[styles.inlineLayer, { pointerEvents: 'box-none' }]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditTaskPicker(null)} />
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
                          setEditTaskPriority(p.id);
                          setEditTaskPicker(null);
                        }}
                      >
                        <Text style={styles.inlineRowText}>{p.label}</Text>
                        {editTaskPriority === p.id ? (
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
  scopeFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  scopeFilterCol: { minWidth: 160, flexGrow: 1, flexBasis: '45%' },
  scopeFilterLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 8 },
  scopeSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    minHeight: 48,
  },
  scopeSelectText: { flex: 1, fontSize: 15, color: '#0f172a', marginRight: 8 },
  cardDescMuted: { fontSize: 14, color: '#94a3b8', marginTop: 6, fontStyle: 'italic' },
  cardScopeBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  cardScopeItem: { minWidth: 140, flexGrow: 1 },
  cardScopeLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.5, marginBottom: 4 },
  cardScopeValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardScopeValue: { fontSize: 14, fontWeight: '600', color: '#0f172a', flex: 1 },
  selectFieldPh: { color: '#94a3b8' },
  createPickerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    justifyContent: 'center',
    padding: 24,
  },
  createPickerBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    maxHeight: '60%',
    paddingVertical: 8,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 400,
  },
  filterPickerBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    maxHeight: '70%',
    paddingVertical: 8,
    margin: 24,
    alignSelf: 'center',
    width: '90%',
    maxWidth: 400,
  },
  createPickerTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', paddingHorizontal: 16, paddingBottom: 8 },
  createPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  createPickerRowText: { flex: 1, fontSize: 16, color: '#0f172a', marginRight: 8 },
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
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
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

  tplTaskCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 10,
    overflow: 'hidden',
  },
  tplTaskCardOpen: { borderColor: '#cbd5e1' },
  tplTaskCollapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
  },
  tplTaskCollapsedMain: { flex: 1, minWidth: 0 },
  tplTaskCollapsedTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  tplTaskCreated: { fontSize: 13, color: '#64748b', marginTop: 4 },
  tplTaskCollapsedMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, maxWidth: '52%' },
  tplMetaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 120 },
  tplMetaChipText: { fontSize: 12, color: '#64748b', flexShrink: 1 },
  tplPriorityPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  tplPriorityPillText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  tplTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  tplTypePillBlue: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  tplTypePillText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  tplTypePillTextBlue: { color: '#1d4ed8' },
  tplTaskExpanded: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 12,
    backgroundColor: '#fafbfc',
  },
  tplTaskExpandedHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  tplTaskExpandedTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  tplTaskExpandedMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  tplEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  tplEditBtnText: { fontSize: 14, fontWeight: '600', color: '#475569' },
  tplNotesLabel: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  tplNotesBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#fff',
    padding: 14,
    minHeight: 56,
    marginBottom: 12,
  },
  tplNotesBody: { fontSize: 14, color: '#334155', lineHeight: 20 },
  tplNotesPlaceholder: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tplNotesPlaceholderText: { fontSize: 14, color: '#94a3b8' },
  tplDeleteTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  tplDeleteTaskText: { fontSize: 15, fontWeight: '700', color: '#dc2626' },
  editTaskActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 24,
  },
  editTaskActionsRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deleteTaskModalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  deleteTaskModalText: { fontSize: 15, fontWeight: '700', color: '#dc2626' },

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
