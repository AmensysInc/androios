import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as api from '../../api';
import { HttpError } from '../../lib/api-client';

export type ShiftTasksModalEmployee = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  company_id?: string;
};

function displayName(emp: ShiftTasksModalEmployee): string {
  const fn = (emp.first_name || '').trim();
  const ln = (emp.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return emp.email || 'Employee';
}

function shiftIdOf(shift: any): string {
  const id = shift?.id ?? shift?.pk;
  return id != null ? String(id) : '';
}

function shiftTaskId(t: any): string {
  const id = t?.id ?? t?.pk;
  return id != null ? String(id) : '';
}

function shiftTaskTitle(t: any): string {
  return String(t?.title ?? t?.task_name ?? 'Task').trim() || 'Task';
}

function formatShiftTimeRange(shift: any): string {
  const st = shift?.start_time ? new Date(shift.start_time) : null;
  const et = shift?.end_time ? new Date(shift.end_time) : null;
  if (!st || Number.isNaN(st.getTime())) return '—';
  const t1 = st.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const t2 = et && !Number.isNaN(et.getTime())
    ? et.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '';
  return t2 ? `${t1} - ${t2}` : t1;
}

function templateCompanyId(t: any): string {
  const c = t?.company_id ?? t?.company;
  if (c != null && typeof c === 'object') return String((c as any).id ?? '').trim();
  return c != null ? String(c).trim() : '';
}

function templateRowId(t: any): string {
  const id = t?.id ?? t?.pk;
  return id != null ? String(id) : '';
}

function templateTaskTitle(tk: any): string {
  return String(tk?.title ?? tk?.task_name ?? tk?.name ?? '').trim();
}

function isChecklistShiftTask(t: any): boolean {
  return !!(t?.template_name || t?.checklist_template_name);
}

function isHovered(state: { pressed: boolean; hovered?: boolean }): boolean {
  return !!state.pressed || !!(Platform.OS === 'web' && state.hovered);
}

function formatApiError(e: unknown): string {
  if (e instanceof HttpError) {
    const b = e.body as Record<string, unknown> | null | undefined;
    if (b?.detail && typeof b.detail === 'string') return b.detail;
  }
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

/** Create shift tasks from checklist template rows when apply-checklist has no calendar masters. */
async function ensureShiftTasksFromTemplatePreview(
  shiftId: string,
  previewTasks: any[],
  existingRows: any[]
): Promise<number> {
  const existing = new Set(
    existingRows.map((t) => shiftTaskTitle(t).toLowerCase()).filter(Boolean)
  );
  let added = 0;
  for (const tk of previewTasks) {
    const title = templateTaskTitle(tk);
    if (!title) continue;
    const key = title.toLowerCase();
    if (existing.has(key)) continue;
    await api.createShiftTask(shiftId, title);
    existing.add(key);
    added += 1;
  }
  return added;
}

type Props = {
  visible: boolean;
  shift: any | null;
  employee: ShiftTasksModalEmployee | null;
  companyId: string;
  onClose: () => void;
  onTasksChanged?: () => void;
};

export default function ShiftTasksModal({
  visible,
  shift,
  employee,
  companyId,
  onClose,
  onTasksChanged,
}: Props) {
  const { width, height } = useWindowDimensions();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [templateTasksCache, setTemplateTasksCache] = useState<Record<string, any[]>>({});
  const [templateTasksLoading, setTemplateTasksLoading] = useState<string | null>(null);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const [appliedTemplateName, setAppliedTemplateName] = useState<string | null>(null);

  const sid = shift ? shiftIdOf(shift) : '';

  const loadShiftTasks = useCallback(async () => {
    if (!sid) return [];
    setLoading(true);
    try {
      const rows = await api.getShiftTasks(sid);
      const list = Array.isArray(rows) ? rows : [];
      setTasks(list);
      return list;
    } catch (e) {
      setTasks([]);
      Alert.alert('Error', formatApiError(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [sid]);

  const loadCompanyTemplates = useCallback(async () => {
    const cid = String(companyId).trim();
    if (!cid) {
      setTemplates([]);
      return;
    }
    setTemplatesLoading(true);
    try {
      const raw = await api.getTemplates({ company_id: cid, company: cid });
      const list = (Array.isArray(raw) ? raw : []).filter((t) => {
        const tc = templateCompanyId(t);
        return !tc || tc === cid;
      });
      setTemplates(list);
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!visible || !sid) return;
    setChecklistOpen(false);
    setExpandedTemplateId(null);
    setAppliedTemplateId(null);
    setAppliedTemplateName(null);
    setNewTitle('');
    void loadShiftTasks();
    void loadCompanyTemplates();
  }, [visible, sid, loadShiftTasks, loadCompanyTemplates]);

  const loadTemplateTasksPreview = async (templateId: string) => {
    if (templateTasksCache[templateId]) return templateTasksCache[templateId];
    setTemplateTasksLoading(templateId);
    try {
      const rows = await api.getChecklistTemplateTasks({ templateId });
      setTemplateTasksCache((prev) => ({ ...prev, [templateId]: rows }));
      return rows;
    } catch {
      setTemplateTasksCache((prev) => ({ ...prev, [templateId]: [] }));
      return [];
    } finally {
      setTemplateTasksLoading(null);
    }
  };

  const toggleTemplateExpand = (templateId: string) => {
    if (expandedTemplateId === templateId) {
      setExpandedTemplateId(null);
      return;
    }
    setExpandedTemplateId(templateId);
    void loadTemplateTasksPreview(templateId);
  };

  const checklistHeaderName = useMemo(() => {
    const fromTask = tasks.find((t) => t?.template_name)?.template_name;
    return (
      String(fromTask || appliedTemplateName || '').trim() || null
    );
  }, [tasks, appliedTemplateName]);

  const addManualTask = async () => {
    const title = newTitle.trim();
    if (!title || !sid) return;
    setSaving(true);
    try {
      await api.createShiftTask(sid, title);
      setNewTitle('');
      await loadShiftTasks();
      onTasksChanged?.();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const removeTask = (task: any) => {
    const id = shiftTaskId(task);
    if (!id) return;
    Alert.alert('Remove task', `Remove "${shiftTaskTitle(task)}" from this shift?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await api.deleteShiftTask(id);
              await loadShiftTasks();
              onTasksChanged?.();
            } catch (e) {
              Alert.alert('Error', formatApiError(e));
            }
          })();
        },
      },
    ]);
  };

  const applyTemplate = async (templateId: string, templateName: string) => {
    if (!sid) return;
    setApplyingTemplateId(templateId);
    try {
      let preview =
        templateTasksCache[templateId] ??
        (await loadTemplateTasksPreview(templateId));

      const res = await api.applyChecklistTemplateToShift(sid, templateId);
      let rows = await api.getShiftTasks(sid);

      if ((res?.created ?? 0) === 0 && rows.length === 0 && preview.length > 0) {
        await ensureShiftTasksFromTemplatePreview(sid, preview, rows);
        rows = await api.getShiftTasks(sid);
      } else if ((res?.created ?? 0) === 0 && preview.length > 0) {
        const added = await ensureShiftTasksFromTemplatePreview(sid, preview, rows);
        if (added > 0) rows = await api.getShiftTasks(sid);
      }

      setTasks(rows);
      setAppliedTemplateId(templateId);
      setAppliedTemplateName(templateName);
      setExpandedTemplateId(null);
      setChecklistOpen(true);
      onTasksChanged?.();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally {
      setApplyingTemplateId(null);
    }
  };

  if (!visible || !shift || !employee) return null;

  const timeLabel = formatShiftTimeRange(shift);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.card,
            {
              width: Math.min(width - 32, 520),
              maxHeight: Math.min(height * 0.88, 640),
            },
          ]}
        >
          <View style={styles.head}>
            <Text style={styles.title}>Shift tasks</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.empLine}>
              {displayName(employee)} · {timeLabel}
            </Text>
            <Text style={styles.hint}>These tasks will be shown to the employee when they clock in.</Text>

            <View style={styles.tasksBox}>
              {loading ? (
                <ActivityIndicator color="#2563eb" style={{ marginVertical: 16 }} />
              ) : tasks.length === 0 ? (
                <Text style={styles.emptyTasks}>
                  No tasks yet. Pick a checklist below or add one manually.
                </Text>
              ) : (
                <>
                  {checklistHeaderName ? (
                    <Text style={styles.checklistGroupLabel}>
                      Checklist: {checklistHeaderName}
                    </Text>
                  ) : null}
                  {tasks.map((t, index) => {
                    const tid = shiftTaskId(t) || `row-${index}`;
                    const fromChecklist =
                      isChecklistShiftTask(t) || (!!appliedTemplateName && tasks.length > 0);
                    return (
                      <View
                        key={tid}
                        style={[
                          styles.taskRow,
                          index === tasks.length - 1 && styles.taskRowLast,
                        ]}
                      >
                        <Text style={styles.taskRowTitle} numberOfLines={2}>
                          {shiftTaskTitle(t)}
                        </Text>
                        {fromChecklist ? (
                          <View style={styles.checklistBadge}>
                            <Text style={styles.checklistBadgeText}>Checklist</Text>
                          </View>
                        ) : null}
                        <TouchableOpacity
                          onPress={() => removeTask(t)}
                          hitSlop={10}
                          accessibilityLabel="Delete task"
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={20} color="#dc2626" />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </>
              )}
            </View>

            <View style={styles.checklistHead}>
              <Text style={styles.sectionLabel}>Company checklists</Text>
              <Pressable
                style={(state) => [styles.checklistBtn, isHovered(state) && styles.checklistBtnHover]}
                onPress={() => setChecklistOpen((o) => !o)}
              >
                <Text style={styles.checklistBtnText}>
                  {checklistOpen ? 'Hide checklists' : '+ checklist'}
                </Text>
              </Pressable>
            </View>

            {checklistOpen ? (
              <View style={styles.checklistPanel}>
                {templatesLoading ? (
                  <ActivityIndicator color="#2563eb" style={{ marginVertical: 12 }} />
                ) : templates.length === 0 ? (
                  <Text style={styles.emptyChecklist}>
                    No checklist templates for this company. Create them on the Check Lists page.
                  </Text>
                ) : (
                  templates.map((tpl) => {
                    const tplId = templateRowId(tpl);
                    const name = tpl.name || tpl.title || 'Checklist';
                    const expanded = expandedTemplateId === tplId;
                    const isApplied = appliedTemplateId === tplId;
                    const preview = templateTasksCache[tplId] ?? [];
                    const loadingPreview = templateTasksLoading === tplId;
                    return (
                      <View key={tplId} style={styles.tplCard}>
                        <View style={styles.tplHead}>
                          <TouchableOpacity
                            style={styles.tplHeadMain}
                            onPress={() => toggleTemplateExpand(tplId)}
                            activeOpacity={0.85}
                          >
                            <MaterialCommunityIcons
                              name={expanded ? 'chevron-down' : 'chevron-right'}
                              size={20}
                              color="#64748b"
                            />
                            <View style={styles.tplHeadText}>
                              <Text style={styles.tplName} numberOfLines={1}>
                                {name}
                              </Text>
                              {isApplied && !expanded ? (
                                <Text style={styles.tplAppliedHint}>
                                  Click to show tasks above
                                </Text>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.applyBtn,
                              applyingTemplateId === tplId && styles.applyBtnDisabled,
                            ]}
                            onPress={() => void applyTemplate(tplId, name)}
                            disabled={!!applyingTemplateId}
                            activeOpacity={0.85}
                          >
                            {applyingTemplateId === tplId ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <Text style={styles.applyBtnText}>Apply</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                        {expanded ? (
                          <View style={styles.tplTasks}>
                            {loadingPreview ? (
                              <ActivityIndicator size="small" color="#64748b" />
                            ) : preview.length === 0 ? (
                              <Text style={styles.tplTaskEmpty}>No tasks in this template.</Text>
                            ) : (
                              preview.map((tk, i) => (
                                <Text key={`${tplId}-${i}`} style={styles.tplTaskLine}>
                                  · {templateTaskTitle(tk) || 'Task'}
                                </Text>
                              ))
                            )}
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </View>
            ) : null}

            <Text style={styles.addSectionTitle}>Add shift task</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="New task (e.g. Stock shelves, Clean restroom)"
              placeholderTextColor="#94a3b8"
            />
            <Pressable
              style={(state) => [
                styles.addTaskBtn,
                (saving || !newTitle.trim()) && styles.addTaskBtnDisabled,
                !saving && newTitle.trim() && isHovered(state) && styles.addTaskBtnHover,
              ]}
              onPress={() => void addManualTask()}
              disabled={saving || !newTitle.trim()}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.addTaskBtnText}>Add task</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    zIndex: 2,
    ...Platform.select({
      web: { boxShadow: '0 16px 48px rgba(15,23,42,0.2)' },
      default: {
        elevation: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
    }),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  scroll: { flexGrow: 0 },
  scrollContent: { padding: 18, paddingBottom: 24 },
  empLine: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  hint: { fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 14, lineHeight: 18 },
  tasksBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    padding: 14,
    minHeight: 72,
    marginBottom: 16,
  },
  emptyTasks: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20 },
  checklistGroupLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563eb',
    marginBottom: 10,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  taskRowLast: { borderBottomWidth: 0 },
  taskRowTitle: { flex: 1, fontSize: 14, fontWeight: '500', color: '#0f172a' },
  checklistBadge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  checklistBadgeText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  checklistHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  checklistBtn: {
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  checklistBtnHover: { backgroundColor: '#2563eb' },
  checklistBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checklistPanel: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden',
  },
  emptyChecklist: { fontSize: 13, color: '#64748b', padding: 14, lineHeight: 18 },
  tplCard: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tplHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  tplHeadMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  tplHeadText: { flex: 1, minWidth: 0 },
  tplName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  tplAppliedHint: { fontSize: 12, color: '#64748b', marginTop: 2 },
  applyBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 64,
    alignItems: 'center',
  },
  applyBtnDisabled: { opacity: 0.7 },
  applyBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  tplTasks: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
    backgroundColor: '#f8fafc',
  },
  tplTaskEmpty: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic' },
  tplTaskLine: { fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 18 },
  addSectionTitle: { fontSize: 14, fontWeight: '700', color: '#2563eb', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  addTaskBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addTaskBtnHover: { backgroundColor: '#1d4ed8' },
  addTaskBtnDisabled: { opacity: 0.55 },
  addTaskBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
