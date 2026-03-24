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
      <View style={pickerStyles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={pickerStyles.box}>
          <Text style={pickerStyles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={pickerStyles.row}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={pickerStyles.rowText}>{item.label}</Text>
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

const pickerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
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

const CATEGORY_OPTIONS: PickerOption[] = [
  { id: 'health_fitness', label: 'Health & Fitness' },
  { id: 'personal_growth', label: 'Personal Growth' },
  { id: 'work', label: 'Work' },
  { id: 'social', label: 'Social' },
  { id: 'other', label: 'Other' },
];

/** Web app uses shorter slugs stored in `icon` — map for display */
const WEB_ICON_LABELS: Record<string, string> = {
  health: 'Health & Fitness',
  productivity: 'Productivity',
  learning: 'Learning',
  mindfulness: 'Mindfulness',
  creative: 'Creative',
};

const FREQUENCY_OPTIONS: PickerOption[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

const COLOR_SWATCHES: { hex: string; label: string }[] = [
  { hex: '#22c55e', label: 'Green' },
  { hex: '#3b82f6', label: 'Blue' },
  { hex: '#a855f7', label: 'Purple' },
  { hex: '#f97316', label: 'Orange' },
  { hex: '#ef4444', label: 'Red' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#14b8a6', label: 'Teal' },
  { hex: '#6366f1', label: 'Indigo' },
  { hex: '#86efac', label: 'Light Green' },
  { hex: '#ea580c', label: 'Dark Orange' },
  { hex: '#06b6d4', label: 'Cyan' },
  { hex: '#c4b5fd', label: 'Lavender' },
];

function habitId(h: any): string {
  const id = h?.id ?? h?.pk ?? h?.uuid;
  return id != null ? String(id) : '';
}

function habitDisplayName(h: any): string {
  return String(h.name ?? h.title ?? 'Habit').trim() || 'Habit';
}

function categoryLabel(id: string): string {
  return (
    CATEGORY_OPTIONS.find((c) => c.id === id)?.label ??
    WEB_ICON_LABELS[id] ??
    id.replace(/_/g, ' ')
  );
}

function frequencyLabel(id: string): string {
  return FREQUENCY_OPTIONS.find((f) => f.id === id)?.label ?? id;
}

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDdMmYyyy(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function parseToIsoDate(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }
  return null;
}

function padHabit2(n: number): string {
  return String(n).padStart(2, '0');
}

function sameHabitDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const HABIT_WD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const habitDateStyles = StyleSheet.create({
  panel: { paddingHorizontal: 8, paddingBottom: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  weekHead: { flexDirection: 'row', marginBottom: 6 },
  weekCell: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#64748b' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', height: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  cellSel: { borderWidth: 2, borderColor: '#1e40af', borderRadius: 8 },
  cellToday: { backgroundColor: '#e2e8f0', borderRadius: 999 },
  cellTxt: { fontSize: 14, color: '#0f172a', fontWeight: '500' },
  cellTxtSel: { fontWeight: '700' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 8 },
  link: { fontSize: 14, fontWeight: '600', color: '#2563eb' },
  doneBtn: { backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  doneTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

function HabitDatePickerPanel({
  initialYmd,
  allowClear,
  onCommit,
}: {
  initialYmd: string;
  allowClear?: boolean;
  onCommit: (ymd: string | null) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const [draft, setDraft] = useState(() => new Date());

  useEffect(() => {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(initialYmd) ? new Date(`${initialYmd}T12:00:00`) : new Date();
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    setDraft(safe);
    setCursor(new Date(safe.getFullYear(), safe.getMonth(), 1));
  }, [initialYmd]);

  const y = cursor.getFullYear();
  const mo = cursor.getMonth();
  const firstWd = (new Date(y, mo, 1).getDay() + 6) % 7;
  const dim = new Date(y, mo + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let day = 1; day <= dim; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const ymd = (dt: Date) => `${dt.getFullYear()}-${padHabit2(dt.getMonth() + 1)}-${padHabit2(dt.getDate())}`;
  const now = new Date();
  const monthTitle = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View style={habitDateStyles.panel}>
      <View style={habitDateStyles.monthRow}>
        <TouchableOpacity onPress={() => setCursor(new Date(y, mo - 1, 1))} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={22} color="#0f172a" />
        </TouchableOpacity>
        <Text style={habitDateStyles.monthTitle}>{monthTitle}</Text>
        <TouchableOpacity onPress={() => setCursor(new Date(y, mo + 1, 1))} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-right" size={22} color="#0f172a" />
        </TouchableOpacity>
      </View>
      <View style={habitDateStyles.weekHead}>
        {HABIT_WD.map((w) => (
          <Text key={w} style={habitDateStyles.weekCell}>
            {w}
          </Text>
        ))}
      </View>
      <View style={habitDateStyles.grid}>
        {cells.map((cell, idx) => {
          if (cell == null) return <View key={`e-${idx}`} style={habitDateStyles.cell} />;
          const cellDate = new Date(y, mo, cell);
          const sel = sameHabitDay(cellDate, draft);
          const isToday = sameHabitDay(cellDate, now);
          return (
            <TouchableOpacity
              key={idx}
              style={[habitDateStyles.cell, sel && habitDateStyles.cellSel, isToday && !sel && habitDateStyles.cellToday]}
              onPress={() => setDraft(cellDate)}
            >
              <Text style={[habitDateStyles.cellTxt, sel && habitDateStyles.cellTxtSel]}>{cell}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={habitDateStyles.footer}>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          {allowClear ? (
            <TouchableOpacity onPress={() => onCommit(null)}>
              <Text style={habitDateStyles.link}>Clear</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => {
              const t = new Date();
              setDraft(t);
              setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
            }}
          >
            <Text style={habitDateStyles.link}>Today</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={habitDateStyles.doneBtn} onPress={() => onCommit(ymd(draft))}>
          <Text style={habitDateStyles.doneTxt}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatHabitApiError(e: unknown): string {
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

export default function HabitsScreen() {
  const { user, role } = useAuth();
  const [habits, setHabits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [picker, setPicker] = useState<'category' | 'frequency' | null>(null);
  const [datePickerFor, setDatePickerFor] = useState<'start' | 'end' | null>(null);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formCategory, setFormCategory] = useState('health_fitness');
  const [formFrequency, setFormFrequency] = useState('daily');
  const [formStartDate, setFormStartDate] = useState(todayIsoDate());
  const [formEndDate, setFormEndDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formColor, setFormColor] = useState(COLOR_SWATCHES[0].hex);
  const [saving, setSaving] = useState(false);

  const canListAll = role === 'super_admin' || role === 'admin';

  const load = useCallback(async () => {
    try {
      let raw: any[] = [];
      try {
        const params = canListAll ? {} : user?.id ? { user: user.id } : {};
        const res = await api.getHabits(params);
        raw = Array.isArray(res) ? res : [];
      } catch {
        const res = await api.getHabits(user?.id ? { user: user.id } : undefined);
        raw = Array.isArray(res) ? res : [];
      }
      setHabits(raw);
    } catch (e) {
      console.warn(e);
      setHabits([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, canListAll]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormDescription('');
    setFormCategory('health_fitness');
    setFormFrequency('daily');
    setFormStartDate(todayIsoDate());
    setFormEndDate('');
    setFormNotes('');
    setFormColor(COLOR_SWATCHES[0].hex);
    setPicker(null);
    setDatePickerFor(null);
  }, []);

  const openCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  const buildCreatePayload = (): Record<string, any> => {
    const name = formTitle.trim();
    const start = formStartDate.slice(0, 10);
    const endIso = formEndDate.trim() ? parseToIsoDate(formEndDate) : null;

    const body: Record<string, any> = {
      name,
      description: formDescription.trim() || undefined,
      icon: formCategory,
      frequency: formFrequency,
      target_count: 1,
      start_date: start,
      color: formColor,
    };
    if (endIso) body.end_date = endIso;
    const notes = formNotes.trim();
    if (notes) body.notes = notes;

    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
    return body;
  };

  const createHabit = async () => {
    if (!formTitle.trim()) {
      Alert.alert('Validation', 'Please enter a title');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formStartDate.slice(0, 10))) {
      Alert.alert('Validation', 'Please enter a valid start date');
      return;
    }
    setSaving(true);
    try {
      const body = buildCreatePayload();
      await api.createHabit(body);
      setModalOpen(false);
      resetForm();
      load();
    } catch (e: unknown) {
      Alert.alert('Error', formatHabitApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteHabit = (h: any) => {
    const id = habitId(h);
    if (!id) {
      Alert.alert('Error', 'Cannot delete this habit (missing id).');
      return;
    }
    const run = async () => {
      try {
        await api.deleteHabit(id);
        load();
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to delete');
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm(`Delete "${habitDisplayName(h)}"?`)) void run();
      return;
    }
    Alert.alert('Delete', `Delete "${habitDisplayName(h)}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const headerGradientStyle = useMemo(
    () =>
      Platform.OS === 'web'
        ? ({
            backgroundColor: '#ede9fe',
            backgroundImage: 'linear-gradient(90deg, #f3e8ff 0%, #dbeafe 50%, #e0e7ff 100%)',
          } as object)
        : { backgroundColor: '#e9e5f5' },
    []
  );

  const dateInputProps =
    Platform.OS === 'web' ? ({ type: 'date' } as Record<string, unknown>) : {};

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={habits}
        keyExtractor={(item, index) => habitId(item) || `habit-${index}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <View style={[styles.heroHeader, headerGradientStyle]}>
              <View style={styles.heroTextBlock}>
                <Text style={styles.heroTitle}>Daily Routines</Text>
                <Text style={styles.heroSubtitle}>Fuel your daily motivation and build powerful routines</Text>
              </View>
              <TouchableOpacity style={styles.newHabitBtn} onPress={openCreate} activeOpacity={0.9}>
                <Text style={styles.newHabitBtnText}>+ New Habit</Text>
              </TouchableOpacity>
            </View>

            {habits.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialCommunityIcons name="target" size={56} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>No habits created yet</Text>
                <Text style={styles.emptySubtitle}>Create your first habit to get started</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const c = item.color || item.colour || COLOR_SWATCHES[0].hex;
          const catSlug = item.icon ?? item.category;
          const catChip = catSlug ? categoryLabel(String(catSlug)) : null;
          const freq = item.frequency || item.recurrence;
          return (
            <View style={styles.habitCard}>
              <View style={[styles.habitColorDot, { backgroundColor: typeof c === 'string' ? c : formColor }]} />
              <View style={styles.habitCardBody}>
                <Text style={styles.habitCardTitle}>{habitDisplayName(item)}</Text>
                {item.description ? (
                  <Text style={styles.habitCardDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                <View style={styles.habitMetaRow}>
                  {catChip ? (
                    <Text style={styles.habitMetaChip}>{catChip}</Text>
                  ) : null}
                  {freq ? <Text style={styles.habitMetaChip}>{String(freq)}</Text> : null}
                </View>
              </View>
              <Pressable onPress={() => deleteHabit(item)} hitSlop={10} style={styles.deleteHit}>
                <MaterialCommunityIcons name="delete-outline" size={22} color="#94a3b8" />
              </Pressable>
            </View>
          );
        }}
      />

      <Modal
        visible={modalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => {
          setPicker(null);
          setDatePickerFor(null);
          setModalOpen(false);
        }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.createModalRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                if (picker || datePickerFor) {
                  setPicker(null);
                  setDatePickerFor(null);
                } else setModalOpen(false);
              }}
            />
            <ScrollView
              style={styles.createModalScrollView}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.createScroll}
              showsVerticalScrollIndicator={false}
            >
              <Pressable style={styles.createBox} onPress={(e) => e.stopPropagation?.()}>
                <View style={styles.createHeader}>
                  <Text style={styles.createTitle}>Create New Habit</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setPicker(null);
                      setDatePickerFor(null);
                      setModalOpen(false);
                    }}
                    hitSlop={12}
                  >
                    <MaterialCommunityIcons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                value={formTitle}
                onChangeText={setFormTitle}
                placeholder="e.g., Morning Exercise"
                placeholderTextColor="#94a3b8"
              />

              <Text style={styles.label}>Description (optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formDescription}
                onChangeText={setFormDescription}
                placeholder="e.g., 30 minutes of cardio"
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
              />

              <View style={styles.rowTwo}>
                <View style={styles.rowTwoCol}>
                  <Text style={styles.label}>Category</Text>
                  <TouchableOpacity
                    style={styles.selectField}
                    onPress={() => {
                      setDatePickerFor(null);
                      setPicker('category');
                    }}
                  >
                    <Text style={styles.selectText} numberOfLines={1}>
                      {categoryLabel(formCategory)}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
                <View style={styles.rowTwoCol}>
                  <Text style={styles.label}>Frequency</Text>
                  <TouchableOpacity
                    style={styles.selectField}
                    onPress={() => {
                      setDatePickerFor(null);
                      setPicker('frequency');
                    }}
                  >
                    <Text style={styles.selectText}>{frequencyLabel(formFrequency)}</Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.rowTwo}>
                <View style={styles.rowTwoCol}>
                  <Text style={styles.label}>Start Date</Text>
                  <View style={styles.dateRow}>
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      value={Platform.OS === 'web' ? formStartDate.slice(0, 10) : formatDdMmYyyy(formStartDate)}
                      onChangeText={(t) => {
                        if (Platform.OS === 'web') {
                          setFormStartDate(t.slice(0, 10));
                          return;
                        }
                        const iso = parseToIsoDate(t);
                        if (iso) setFormStartDate(iso);
                      }}
                      placeholder={Platform.OS === 'web' ? 'YYYY-MM-DD' : 'dd-mm-yyyy'}
                      placeholderTextColor="#94a3b8"
                    />
                    <TouchableOpacity
                      onPress={() => {
                        setPicker(null);
                        setDatePickerFor('start');
                      }}
                      hitSlop={8}
                      accessibilityLabel="Open calendar for start date"
                    >
                      <MaterialCommunityIcons name="calendar-outline" size={22} color="#64748b" style={styles.calIcon} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.rowTwoCol}>
                  <Text style={styles.label}>End Date (optional)</Text>
                  <View style={styles.dateRow}>
                    <TextInput
                      style={[styles.input, styles.inputFlex]}
                      value={
                        !formEndDate
                          ? ''
                          : Platform.OS === 'web'
                            ? formEndDate.slice(0, 10)
                            : formatDdMmYyyy(formEndDate)
                      }
                      onChangeText={(t) => {
                        if (!t.trim()) {
                          setFormEndDate('');
                          return;
                        }
                        if (Platform.OS === 'web') {
                          setFormEndDate(t.slice(0, 10));
                          return;
                        }
                        const iso = parseToIsoDate(t);
                        if (iso) setFormEndDate(iso);
                      }}
                      placeholder={Platform.OS === 'web' ? 'YYYY-MM-DD' : 'dd-mm-yyyy'}
                      placeholderTextColor="#94a3b8"
                    />
                    <TouchableOpacity
                      onPress={() => {
                        setPicker(null);
                        setDatePickerFor('end');
                      }}
                      hitSlop={8}
                      accessibilityLabel="Open calendar for end date"
                    >
                      <MaterialCommunityIcons name="calendar-outline" size={22} color="#64748b" style={styles.calIcon} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formNotes}
                onChangeText={setFormNotes}
                placeholder="Any additional notes about this habit..."
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.label}>Color</Text>
              <View style={styles.swatchGrid}>
                {COLOR_SWATCHES.map((sw) => (
                  <TouchableOpacity
                    key={sw.hex}
                    onPress={() => setFormColor(sw.hex)}
                    style={[
                      styles.swatch,
                      { backgroundColor: sw.hex },
                      formColor === sw.hex && styles.swatchSelected,
                    ]}
                    accessibilityLabel={sw.label}
                  />
                ))}
              </View>

              <TouchableOpacity
                style={[styles.createHabitBtn, saving && styles.disabled]}
                onPress={() => void createHabit()}
                disabled={saving}
              >
                <Text style={styles.createHabitBtnText}>{saving ? 'Saving…' : 'Create Habit'}</Text>
              </TouchableOpacity>
              </Pressable>
            </ScrollView>

            {picker ? (
              <View style={styles.habitInlinePickerLayer} pointerEvents="box-none">
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
                <View style={styles.habitInlinePickerBox} pointerEvents="auto">
                  <Text style={pickerStyles.title}>{picker === 'category' ? 'Category' : 'Frequency'}</Text>
                  <FlatList
                    data={picker === 'category' ? CATEGORY_OPTIONS : FREQUENCY_OPTIONS}
                    keyExtractor={(i) => i.id}
                    keyboardShouldPersistTaps="handled"
                    style={styles.habitInlinePickerList}
                    renderItem={({ item }) => {
                      const selectedId = picker === 'category' ? formCategory : formFrequency;
                      return (
                        <TouchableOpacity
                          style={pickerStyles.row}
                          onPress={() => {
                            if (picker === 'category') setFormCategory(item.id);
                            else setFormFrequency(item.id);
                            setPicker(null);
                          }}
                        >
                          <Text style={pickerStyles.rowText}>{item.label}</Text>
                          {selectedId === item.id ? (
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

            {datePickerFor ? (
              <View style={styles.habitDateLayer} pointerEvents="box-none">
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setDatePickerFor(null)} />
                <View style={styles.habitDateBox} pointerEvents="auto">
                  <Text style={styles.habitDateTitle}>
                    {datePickerFor === 'start' ? 'Start date' : 'End date (optional)'}
                  </Text>
                  <HabitDatePickerPanel
                    key={datePickerFor}
                    initialYmd={
                      datePickerFor === 'start'
                        ? formStartDate.slice(0, 10)
                        : formEndDate.trim()
                          ? formEndDate.slice(0, 10)
                          : formStartDate.slice(0, 10)
                    }
                    allowClear={datePickerFor === 'end'}
                    onCommit={(ymd) => {
                      if (datePickerFor === 'start') {
                        if (ymd) setFormStartDate(ymd);
                      } else {
                        setFormEndDate(ymd || '');
                      }
                      setDatePickerFor(null);
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

  heroHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderRadius: 16,
    marginBottom: 16,
    gap: 14,
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(99, 102, 241, 0.12)' },
      default: {
        shadowColor: '#6366f1',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  heroTextBlock: { flex: 1, minWidth: 200 },
  heroTitle: { fontSize: 26, fontWeight: '700', color: '#1e293b' },
  heroSubtitle: { fontSize: 15, color: '#64748b', marginTop: 8, lineHeight: 22 },
  newHabitBtn: {
    backgroundColor: '#1e40af',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  newHabitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    paddingVertical: 56,
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#475569', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#94a3b8', marginTop: 8, textAlign: 'center' },

  habitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
    marginBottom: 10,
  },
  habitColorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 12,
  },
  habitCardBody: { flex: 1, minWidth: 0 },
  habitCardTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  habitCardDesc: { fontSize: 13, color: '#64748b', marginTop: 4 },
  habitMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  habitMetaChip: {
    fontSize: 12,
    fontWeight: '500',
    color: '#475569',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
    textTransform: 'capitalize',
  },
  deleteHit: { padding: 8 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
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
  createScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  habitInlinePickerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 24,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  habitInlinePickerBox: {
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
      web: { boxShadow: '0 12px 48px rgba(15, 23, 42, 0.25)' },
      default: {},
    }),
  },
  habitInlinePickerList: { maxHeight: 320 },
  habitDateLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 110,
    elevation: 26,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  habitDateBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    width: '100%',
    maxWidth: 360,
    paddingTop: 12,
    zIndex: 111,
    elevation: 27,
    ...Platform.select({
      web: { boxShadow: '0 12px 48px rgba(15, 23, 42, 0.25)' },
      default: {},
    }),
  },
  habitDateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  createBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  createHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  createTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a', flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  inputFlex: { flex: 1 },
  textArea: { minHeight: 88, paddingTop: 12 },
  rowTwo: { flexDirection: 'row', gap: 12, marginTop: 4 },
  rowTwoCol: { flex: 1, minWidth: 140 },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#f8fafc',
  },
  selectText: { flex: 1, fontSize: 15, color: '#0f172a' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calIcon: { marginRight: 4 },

  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: '#1e293b',
  },

  createHabitBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  createHabitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.65 },
});
