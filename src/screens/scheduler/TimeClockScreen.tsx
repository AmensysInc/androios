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
  FlatList,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api';

const GREEN = '#22c55e';
const ORANGE = '#f59e0b';

type TabKey = 'clock' | 'hours' | 'tasks' | 'requests';

type PickerOption = { id: string; label: string };

function parseMs(iso: string | null | undefined): number | null {
  if (iso == null || iso === '') return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function entryId(e: any): string {
  return api.timeClockEntryId(e);
}

function employeeIdOf(e: any): string {
  if (e == null) return '';
  if (typeof e === 'object') return String(e.id ?? e.pk ?? '');
  return String(e);
}

function entryEmployeeId(entry: any): string {
  return employeeIdOf(entry.employee ?? entry.employee_id);
}

function formatHm(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' });
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `DD-MM-YYYY HH:mm` for edit modal (matches web reference). */
function formatDateTimeForEdit(input: string | Date | null | undefined): string {
  if (input == null || input === '') return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const DT_PICKER_ITEM_H = 40;
const DT_PICKER_VISIBLE = 5;
const DT_PICKER_PAD = ((DT_PICKER_VISIBLE - 1) / 2) * DT_PICKER_ITEM_H;
const DT_HOURS = Array.from({ length: 24 }, (_, i) => i);
const DT_MINUTES = Array.from({ length: 60 }, (_, i) => i);
const DT_WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function ClockEditDateTimePickerModal({
  visible,
  initialTimeMs,
  target,
  onClose,
  onConfirm,
  onClearField,
}: {
  visible: boolean;
  initialTimeMs: number;
  target: 'clockIn' | 'clockOut' | null;
  onClose: () => void;
  onConfirm: (d: Date) => void;
  onClearField?: () => void;
}) {
  const [draft, setDraft] = useState(() => new Date());
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const hourScrollRef = useRef<ScrollView>(null);
  const minScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    const d = new Date(initialTimeMs);
    const base = Number.isNaN(d.getTime()) ? new Date() : d;
    setDraft(new Date(base.getTime()));
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    const t = setTimeout(() => {
      hourScrollRef.current?.scrollTo({ y: base.getHours() * DT_PICKER_ITEM_H, animated: false });
      minScrollRef.current?.scrollTo({ y: base.getMinutes() * DT_PICKER_ITEM_H, animated: false });
    }, 60);
    return () => clearTimeout(t);
  }, [visible, initialTimeMs]);

  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const calendarCells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);
  while (calendarCells.length < 42) calendarCells.push(null);

  const selectDay = (day: number) => {
    setDraft((prev) => new Date(y, m, day, prev.getHours(), prev.getMinutes(), 0, 0));
  };

  const now = new Date();
  const monthTitle = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const snapScrollStyle = Platform.select({
    web: { scrollSnapType: 'y mandatory' as const },
    default: {},
  });
  const snapItemStyle = Platform.select({
    web: { scrollSnapAlign: 'center' as const },
    default: {},
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={dtStyles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={dtStyles.box}>
          <View style={dtStyles.splitRow}>
            <View style={dtStyles.calCol}>
              <View style={dtStyles.monthRow}>
                <TouchableOpacity
                  onPress={() => setViewMonth(new Date(y, m - 1, 1))}
                  hitSlop={8}
                  style={dtStyles.monthNav}
                >
                  <MaterialCommunityIcons name="chevron-left" size={22} color="#0f172a" />
                </TouchableOpacity>
                <Text style={dtStyles.monthTitle}>{monthTitle}</Text>
                <TouchableOpacity
                  onPress={() => setViewMonth(new Date(y, m + 1, 1))}
                  hitSlop={8}
                  style={dtStyles.monthNav}
                >
                  <MaterialCommunityIcons name="chevron-right" size={22} color="#0f172a" />
                </TouchableOpacity>
              </View>
              <View style={dtStyles.weekHead}>
                {DT_WEEKDAYS.map((w) => (
                  <Text key={w} style={dtStyles.weekHeadCell}>
                    {w}
                  </Text>
                ))}
              </View>
              <View style={dtStyles.grid}>
                {calendarCells.map((cell, idx) => {
                  if (cell == null) return <View key={`e-${idx}`} style={dtStyles.cell} />;
                  const cellDate = new Date(y, m, cell);
                  const isSel = sameCalendarDay(cellDate, draft);
                  const isToday = sameCalendarDay(cellDate, now);
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[dtStyles.cell, isSel && dtStyles.cellSelected, isToday && !isSel && dtStyles.cellToday]}
                      onPress={() => selectDay(cell)}
                    >
                      <Text style={[dtStyles.cellText, isSel && dtStyles.cellTextSelected]}>{cell}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={dtStyles.calFooter}>
                {target === 'clockOut' && onClearField ? (
                  <TouchableOpacity
                    onPress={() => {
                      onClearField();
                      onClose();
                    }}
                  >
                    <Text style={dtStyles.footerLink}>Clear</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => {
                      const t0 = new Date();
                      setDraft(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate(), 0, 0, 0, 0));
                      setViewMonth(new Date(t0.getFullYear(), t0.getMonth(), 1));
                    }}
                  >
                    <Text style={dtStyles.footerLink}>Clear</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => {
                    const t0 = new Date();
                    setDraft(
                      new Date(t0.getFullYear(), t0.getMonth(), t0.getDate(), draft.getHours(), draft.getMinutes(), 0, 0)
                    );
                    setViewMonth(new Date(t0.getFullYear(), t0.getMonth(), 1));
                  }}
                >
                  <Text style={dtStyles.footerLink}>Today</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={dtStyles.timeCol}>
              <Text style={dtStyles.timeColTitle}>Time</Text>
              <View style={dtStyles.timeWheels}>
                <ScrollView
                  ref={hourScrollRef}
                  style={dtStyles.wheel}
                  contentContainerStyle={{ paddingTop: DT_PICKER_PAD, paddingBottom: DT_PICKER_PAD }}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={DT_PICKER_ITEM_H}
                  decelerationRate="fast"
                  nestedScrollEnabled
                  {...(snapScrollStyle as object)}
                  onMomentumScrollEnd={(e) => {
                    const row = Math.round(e.nativeEvent.contentOffset.y / DT_PICKER_ITEM_H);
                    const h = Math.min(23, Math.max(0, row));
                    setDraft((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate(), h, prev.getMinutes(), 0, 0));
                  }}
                >
                  {DT_HOURS.map((h) => (
                    <TouchableOpacity
                      key={h}
                      style={[dtStyles.wheelItem, snapItemStyle as object]}
                      onPress={() => {
                        setDraft((prev) =>
                          new Date(prev.getFullYear(), prev.getMonth(), prev.getDate(), h, prev.getMinutes(), 0, 0)
                        );
                        hourScrollRef.current?.scrollTo({ y: h * DT_PICKER_ITEM_H, animated: true });
                      }}
                    >
                      <Text style={[dtStyles.wheelText, draft.getHours() === h && dtStyles.wheelTextActive]}>{pad2(h)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <ScrollView
                  ref={minScrollRef}
                  style={dtStyles.wheel}
                  contentContainerStyle={{ paddingTop: DT_PICKER_PAD, paddingBottom: DT_PICKER_PAD }}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={DT_PICKER_ITEM_H}
                  decelerationRate="fast"
                  nestedScrollEnabled
                  {...(snapScrollStyle as object)}
                  onMomentumScrollEnd={(e) => {
                    const row = Math.round(e.nativeEvent.contentOffset.y / DT_PICKER_ITEM_H);
                    const mm = Math.min(59, Math.max(0, row));
                    setDraft((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate(), prev.getHours(), mm, 0, 0));
                  }}
                >
                  {DT_MINUTES.map((mm) => (
                    <TouchableOpacity
                      key={mm}
                      style={[dtStyles.wheelItem, snapItemStyle as object]}
                      onPress={() => {
                        setDraft((prev) =>
                          new Date(prev.getFullYear(), prev.getMonth(), prev.getDate(), prev.getHours(), mm, 0, 0)
                        );
                        minScrollRef.current?.scrollTo({ y: mm * DT_PICKER_ITEM_H, animated: true });
                      }}
                    >
                      <Text style={[dtStyles.wheelText, draft.getMinutes() === mm && dtStyles.wheelTextActive]}>{pad2(mm)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </View>
          <View style={dtStyles.doneRow}>
            <TouchableOpacity style={dtStyles.doneBtn} onPress={() => onConfirm(draft)}>
              <Text style={dtStyles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dtStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  box: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    ...Platform.select({
      web: { boxShadow: '0 12px 48px rgba(15, 23, 42, 0.2)' },
      default: { elevation: 12 },
    }),
  },
  splitRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  calCol: { flex: 1, minWidth: 260 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthNav: { padding: 4 },
  monthTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  weekHead: { flexDirection: 'row', marginBottom: 6 },
  weekHeadCell: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#64748b' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '14.28%',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  cellSelected: { borderWidth: 2, borderColor: '#0f172a', borderRadius: 8 },
  cellToday: { backgroundColor: '#e2e8f0', borderRadius: 999 },
  cellText: { fontSize: 14, color: '#0f172a', fontWeight: '500' },
  cellTextSelected: { fontWeight: '700' },
  calFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 4 },
  footerLink: { fontSize: 14, fontWeight: '600', color: '#2563eb' },
  timeCol: { width: 120, minHeight: 280 },
  timeColTitle: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 8, textAlign: 'center' },
  timeWheels: { flexDirection: 'row', gap: 4, flex: 1 },
  wheel: {
    flex: 1,
    height: DT_PICKER_VISIBLE * DT_PICKER_ITEM_H,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
  },
  wheelItem: {
    height: DT_PICKER_ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelText: { fontSize: 16, color: '#94a3b8', fontWeight: '500' },
  wheelTextActive: { color: '#0f172a', fontWeight: '700', fontSize: 17 },
  doneRow: { marginTop: 16, alignItems: 'flex-end' },
  doneBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

function parseEditDateTime(v: string): Date | null {
  const m = v.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const HH = Number(m[4]);
  const MM = Number(m[5]);
  if (![dd, mm, yyyy, HH, MM].every((x) => Number.isFinite(x))) return null;
  if (HH < 0 || HH > 23 || MM < 0 || MM > 59) return null;
  const d = new Date(yyyy, mm - 1, dd, HH, MM, 0, 0);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
}

function durationHours(entry: any): number {
  const ci = parseMs(entry.clock_in);
  if (!ci) return 0;
  const co = parseMs(entry.clock_out) ?? Date.now();
  let sec = Math.max(0, Math.floor((co - ci) / 1000));
  const bs = parseMs(entry.break_start);
  const be = parseMs(entry.break_end);
  if (bs && be) sec -= Math.max(0, Math.floor((be - bs) / 1000));
  return sec / 3600;
}

function overtimeHours(entry: any): number {
  const v = entry.overtime_hours ?? entry.overtime ?? entry.overtime_duration;
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function breakLabel(entry: any): string {
  if (entry.break_start && entry.break_end) {
    const m = Math.round((parseMs(entry.break_end)! - parseMs(entry.break_start)!) / 60000);
    return `${m}m`;
  }
  if (entry.break_start && !entry.break_end) return 'On break';
  return '—';
}

function entryStatusLabel(entry: any): string {
  const s = entry?.status;
  if (s != null && String(s).trim() !== '') return String(s);
  return entry?.clock_out ? 'Complete' : 'Active';
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function periodRange(period: 'today' | 'week' | 'month'): { start: Date; end: Date } {
  const now = new Date();
  if (period === 'today') return { start: startOfDay(now), end: endOfDay(now) };
  if (period === 'week') {
    const start = startOfWeekMonday(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function entryClockInInRange(entry: any, start: Date, end: Date): boolean {
  const t = parseMs(entry.clock_in);
  if (!t) return false;
  return t >= start.getTime() && t <= end.getTime();
}

function employeeDisplayName(emp: any): string {
  const fn = (emp?.first_name || '').trim();
  const ln = (emp?.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return emp?.email || emp?.nickname || '—';
}

function taskEventId(t: any): string {
  const id = t?.id ?? t?.pk ?? t?.uuid;
  return id != null && id !== '' ? String(id) : '';
}

function taskAssigneeUserId(t: any): string {
  return String(t?.user ?? t?.user_id ?? t?.owner_id ?? (t?.user && typeof t.user === 'object' ? t.user.id : '') ?? '');
}

function requestCompanyLabel(req: any, companyList: any[]): string {
  const c = req?.company;
  if (c && typeof c === 'object' && c.name) return String(c.name);
  const cid = req?.company_id ?? (typeof c === 'string' ? c : '');
  if (cid) {
    const row = companyList.find((x) => String(x.id) === String(cid));
    if (row?.name) return String(row.name);
  }
  return '—';
}

function departmentKey(emp: any): string {
  const d = emp?.department;
  if (d && typeof d === 'object' && d.id != null) return String(d.id);
  if (emp?.department_id != null) return String(emp.department_id);
  return '';
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
      <View style={pm.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={pm.box}>
          <Text style={pm.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={pm.row}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={pm.rowText}>{item.label}</Text>
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

const pm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: '#fff', borderRadius: 14, maxHeight: '70%', paddingVertical: 8 },
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

export default function TimeClockScreen() {
  const { user, role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [reportEntries, setReportEntries] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [overviewTasks, setOverviewTasks] = useState<any[]>([]);

  const [hoursReportPeriod, setHoursReportPeriod] = useState<'today' | 'week' | 'month'>('week');
  const [hoursDeptFilter, setHoursDeptFilter] = useState<string>('all');
  const [hoursEmpFilter, setHoursEmpFilter] = useState<string>('all');
  const [tasksEmpFilter, setTasksEmpFilter] = useState<string>('all');

  const [hoursReportPeriodPicker, setHoursReportPeriodPicker] = useState(false);
  const [hoursDeptPicker, setHoursDeptPicker] = useState(false);
  const [hoursEmpPicker, setHoursEmpPicker] = useState(false);
  const [tasksEmpPicker, setTasksEmpPicker] = useState(false);

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('all');
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [tab, setTab] = useState<TabKey>('clock');

  const [companyPicker, setCompanyPicker] = useState(false);
  const [locationPicker, setLocationPicker] = useState(false);
  const [periodPicker, setPeriodPicker] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [editEntry, setEditEntry] = useState<any | null>(null);
  const [editClockInText, setEditClockInText] = useState('');
  const [editClockOutText, setEditClockOutText] = useState('');
  const [editOvertimeText, setEditOvertimeText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editDatePickerOpen, setEditDatePickerOpen] = useState(false);
  const [editDatePickerTarget, setEditDatePickerTarget] = useState<'clockIn' | 'clockOut' | null>(null);
  const [editDatePickerSeedMs, setEditDatePickerSeedMs] = useState(() => Date.now());

  const isManager = role === 'manager';
  const canSeeAllTasks = ['super_admin', 'admin', 'operations_manager', 'manager'].includes(role || '');
  const scopedCompanies = api.filterCompaniesForCompanyManagerRole(companies, role, user?.id);
  const managerCompanyId = isManager
    ? scopedCompanies[0]?.id ?? companies[0]?.id
    : undefined;

  const effectiveCompanyId = isManager
    ? managerCompanyId
    : selectedCompanyId === 'all'
      ? undefined
      : selectedCompanyId;

  const load = useCallback(async () => {
    try {
      const compRaw = await api.getCompanies();
      const compList = Array.isArray(compRaw) ? compRaw : [];
      setCompanies(compList);

      let companyForData = effectiveCompanyId;
      if (isManager && companyForData == null && compList[0]?.id) {
        companyForData = String(compList[0].id);
      }

      const deptRaw = companyForData
        ? await api.getDepartments({ company: companyForData }).catch(() => [])
        : [];
      setDepartments(Array.isArray(deptRaw) ? deptRaw : []);

      const empParams: Record<string, any> = { status: 'active' };
      if (companyForData) empParams.company = companyForData;
      const empRaw = await api.getEmployees(companyForData ? empParams : { status: 'active' }).catch(() => []);
      setEmployees(Array.isArray(empRaw) ? empRaw : []);

      const empIds = new Set((Array.isArray(empRaw) ? empRaw : []).map((e: any) => String(e.id)));

      const entryParams: Record<string, any> = {};
      if (companyForData) entryParams.company = companyForData;
      const { start, end } = periodRange(period);
      entryParams.clock_in__gte = start.toISOString();
      entryParams.clock_in__lte = end.toISOString();

      let entryRaw: any[] = [];
      try {
        const raw = await api.getTimeClockEntries(entryParams);
        entryRaw = Array.isArray(raw) ? raw : [];
      } catch {
        const raw = await api.getTimeClockEntries(companyForData ? { company: companyForData } : {});
        entryRaw = Array.isArray(raw) ? raw : [];
        entryRaw = entryRaw.filter((e) => entryClockInInRange(e, start, end));
      }

      if (companyForData) {
        entryRaw = entryRaw.filter((e) => {
          const eid = entryEmployeeId(e);
          return !eid || empIds.has(eid);
        });
      }

      setEntries(entryRaw);

      const reportRange = periodRange(hoursReportPeriod);
      const repParams: Record<string, any> = {};
      if (companyForData) repParams.company = companyForData;
      repParams.clock_in__gte = reportRange.start.toISOString();
      repParams.clock_in__lte = reportRange.end.toISOString();
      let repRaw: any[] = [];
      try {
        const rawRep = await api.getTimeClockEntries(repParams);
        repRaw = Array.isArray(rawRep) ? rawRep : [];
      } catch {
        const rawRep = await api.getTimeClockEntries(companyForData ? { company: companyForData } : {});
        repRaw = Array.isArray(rawRep) ? rawRep : [];
        repRaw = repRaw.filter((e) => entryClockInInRange(e, reportRange.start, reportRange.end));
      }
      if (companyForData) {
        repRaw = repRaw.filter((e) => {
          const eid = entryEmployeeId(e);
          return !eid || empIds.has(eid);
        });
      }
      setReportEntries(repRaw);

      try {
        const tr = periodRange('month');
        const tp: Record<string, any> = {
          event_type: 'task',
          start_time__gte: tr.start.toISOString(),
          end_time__lte: tr.end.toISOString(),
        };
        if (!canSeeAllTasks && user?.id) tp.user = user.id;
        let tasksRaw = await api.getCalendarEvents(tp).catch(() => []);
        if (!Array.isArray(tasksRaw)) tasksRaw = [];
        if (companyForData) {
          const empUserIds = new Set(
            (Array.isArray(empRaw) ? empRaw : [])
              .map((e: any) => String(e.user ?? e.user_id ?? '').trim())
              .filter(Boolean)
          );
          if (empUserIds.size > 0) {
            tasksRaw = tasksRaw.filter((t: any) => {
              const uid = taskAssigneeUserId(t);
              return !uid || empUserIds.has(uid);
            });
          }
        }
        setOverviewTasks(tasksRaw);
      } catch {
        setOverviewTasks([]);
      }

      const reqRaw = await api.getUnscheduledClockRequests().catch(() => []);
      setRequests(Array.isArray(reqRaw) ? reqRaw : []);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [effectiveCompanyId, hoursReportPeriod, isManager, canSeeAllTasks, period, role, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isManager || selectedCompanyId !== 'all') return;
    const id = managerCompanyId;
    if (id) setSelectedCompanyId(String(id));
  }, [isManager, managerCompanyId, selectedCompanyId]);

  useEffect(() => {
    setSelectedLocationId('all');
  }, [effectiveCompanyId]);

  const locationOptions: PickerOption[] = useMemo(() => {
    const opts: PickerOption[] = [{ id: 'all', label: 'All Locations' }];
    const seen = new Set<string>();
    for (const d of departments) {
      const id = d.id != null ? String(d.id) : '';
      const name = d.name || id;
      if (id && !seen.has(id)) {
        seen.add(id);
        opts.push({ id, label: name });
      }
    }
    return opts;
  }, [departments]);

  const scopedEmployees = useMemo(() => {
    if (selectedLocationId === 'all') return employees;
    return employees.filter((e) => departmentKey(e) === selectedLocationId);
  }, [employees, selectedLocationId]);

  const employeeById = useMemo(() => {
    const m = new Map<string, any>();
    for (const e of employees) m.set(String(e.id), e);
    return m;
  }, [employees]);

  const reportEntriesScoped = useMemo(() => {
    const ids = new Set(scopedEmployees.map((e) => String(e.id)));
    return reportEntries.filter((en) => {
      const eid = entryEmployeeId(en);
      return !eid || ids.has(eid);
    });
  }, [reportEntries, scopedEmployees]);

  const hoursReportFiltered = useMemo(() => {
    let list = reportEntriesScoped;
    if (hoursDeptFilter !== 'all') {
      const empIds = new Set(
        scopedEmployees.filter((e) => departmentKey(e) === hoursDeptFilter).map((e) => String(e.id))
      );
      list = list.filter((en) => empIds.has(entryEmployeeId(en)));
    }
    if (hoursEmpFilter !== 'all') {
      list = list.filter((en) => entryEmployeeId(en) === hoursEmpFilter);
    }
    return list;
  }, [reportEntriesScoped, scopedEmployees, hoursDeptFilter, hoursEmpFilter]);

  const hoursReportStats = useMemo(() => {
    const empIds = new Set<string>();
    let totalH = 0;
    let ot = 0;
    let cost = 0;
    for (const e of hoursReportFiltered) {
      const id = entryEmployeeId(e);
      if (id) empIds.add(id);
      const h = durationHours(e);
      totalH += h;
      ot += overtimeHours(e);
      const emp = employeeById.get(id);
      const rate = parseFloat(String(emp?.hourly_rate ?? emp?.rate ?? 0)) || 0;
      cost += h * rate;
    }
    return {
      employeeCount: empIds.size,
      totalHours: Math.round(totalH * 10) / 10,
      overtime: Math.round(ot * 10) / 10,
      estCost: Math.round(cost),
    };
  }, [hoursReportFiltered, employeeById]);

  const tasksScoped = useMemo(() => {
    if (tasksEmpFilter === 'all') return overviewTasks;
    return overviewTasks.filter((t) => taskAssigneeUserId(t) === tasksEmpFilter);
  }, [overviewTasks, tasksEmpFilter]);

  const taskStats = useMemo(() => {
    const now = Date.now();
    const total = tasksScoped.length;
    const completed = tasksScoped.filter((t) => t.completed).length;
    const pending = tasksScoped.filter((t) => !t.completed).length;
    const overdue = tasksScoped.filter((t) => {
      if (t.completed) return false;
      const end = parseMs(t.end_time ?? t.due_date ?? t.start_time);
      return end != null && end < now;
    }).length;
    return { total, pending, completed, overdue };
  }, [tasksScoped]);

  const hoursDeptOptions: PickerOption[] = useMemo(() => {
    const opts: PickerOption[] = [{ id: 'all', label: 'All Departments' }];
    for (const d of departments) {
      const id = d.id != null ? String(d.id) : '';
      if (id) opts.push({ id, label: d.name || id });
    }
    return opts;
  }, [departments]);

  const hoursEmpOptions: PickerOption[] = useMemo(() => {
    const opts: PickerOption[] = [{ id: 'all', label: 'All Employees' }];
    for (const emp of scopedEmployees) {
      opts.push({ id: String(emp.id), label: employeeDisplayName(emp) });
    }
    return opts;
  }, [scopedEmployees]);

  const tasksEmployeeOptions: PickerOption[] = useMemo(() => {
    const opts: PickerOption[] = [{ id: 'all', label: 'All Employees' }];
    const seen = new Set<string>();
    for (const emp of scopedEmployees) {
      const uid = String(emp.user ?? emp.user_id ?? '').trim();
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      opts.push({ id: uid, label: employeeDisplayName(emp) });
    }
    return opts;
  }, [scopedEmployees]);

  const filteredEntries = useMemo(() => {
    const ids = new Set(scopedEmployees.map((e) => String(e.id)));
    return entries.filter((en) => {
      const eid = entryEmployeeId(en);
      return !eid || ids.has(eid);
    });
  }, [entries, scopedEmployees]);

  const openEntries = useMemo(
    () => filteredEntries.filter((e) => e.clock_in && !e.clock_out),
    [filteredEntries]
  );

  const todayStart = startOfDay(new Date()).getTime();
  const todayEnd = endOfDay(new Date()).getTime();

  const entriesToday = useMemo(
    () =>
      filteredEntries.filter((e) => {
        const t = parseMs(e.clock_in);
        return t != null && t >= todayStart && t <= todayEnd;
      }),
    [filteredEntries, todayStart, todayEnd]
  );

  const stats = useMemo(() => {
    const clockedIn = openEntries.length;
    let totalToday = 0;
    let overtimeSum = 0;
    for (const e of entriesToday) {
      if (e.clock_out) totalToday += durationHours(e);
      else totalToday += durationHours(e);
      overtimeSum += overtimeHours(e);
    }
    const closedToday = entriesToday.filter((e) => e.clock_out);
    const avg = closedToday.length ? totalToday / closedToday.length : 0;
    return {
      clockedIn,
      totalToday: Math.round(totalToday * 10) / 10,
      avgHours: Math.round(avg * 10) / 10,
      overtime: Math.round(overtimeSum * 10) / 10,
    };
  }, [openEntries, entriesToday]);

  const companyLabel =
    selectedCompanyId === 'all'
      ? isManager
        ? companies[0]?.name || 'Company'
        : 'All companies'
      : companies.find((c) => String(c.id) === selectedCompanyId)?.name || 'Company';

  const locationLabel = locationOptions.find((o) => o.id === selectedLocationId)?.label ?? 'All Locations';
  const periodLabel = period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month';

  const companyOptions: PickerOption[] = useMemo(() => {
    if (isManager) {
      return companies.map((c) => ({ id: String(c.id), label: c.name || String(c.id) }));
    }
    return [{ id: 'all', label: 'All companies' }, ...companies.map((c) => ({ id: String(c.id), label: c.name || String(c.id) }))];
  }, [companies, isManager]);

  const employeesNotClockedIn = useMemo(() => {
    const openEmp = new Set(openEntries.map((e) => entryEmployeeId(e)).filter(Boolean));
    return scopedEmployees.filter((e) => !openEmp.has(String(e.id)));
  }, [scopedEmployees, openEntries]);

  const handleClockInEmployee = async (emp: any) => {
    setActionLoading(true);
    try {
      await api.clockIn({ employee_id: String(emp.id) });
      await load();
      Alert.alert('Clock in', `${employeeDisplayName(emp)} clocked in.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Clock in failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOutEntry = async (entry: any) => {
    const id = entryId(entry);
    if (!id) return;
    const run = async () => {
      setActionLoading(true);
      try {
        await api.clockOut({
          time_clock_entry_id: id,
          employee_id: entryEmployeeId(entry) || undefined,
        });
        await load();
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Clock out failed');
      } finally {
        setActionLoading(false);
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm('Clock out this entry?')) void run();
      return;
    }
    Alert.alert('Clock out', 'End this time entry?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clock out', onPress: () => void run() },
    ]);
  };

  const openEditEntryModal = (en: any) => {
    setEditEntry(en);
    setEditClockInText(formatDateTimeForEdit(en.clock_in));
    setEditClockOutText(en.clock_out ? formatDateTimeForEdit(en.clock_out) : '');
    setEditOvertimeText(
      Number.isFinite(overtimeHours(en)) ? String(overtimeHours(en)) : '0'
    );
    setEditDatePickerOpen(false);
    setEditDatePickerTarget(null);
  };

  const closeEditEntryModal = () => {
    setEditEntry(null);
    setEditClockInText('');
    setEditClockOutText('');
    setEditOvertimeText('');
    setEditDatePickerOpen(false);
    setEditDatePickerTarget(null);
  };

  const openEditDateTimePicker = (target: 'clockIn' | 'clockOut') => {
    let parsed: Date | null = parseEditDateTime(
      (target === 'clockIn' ? editClockInText : editClockOutText).trim()
    );
    if (!parsed && target === 'clockOut') {
      parsed = parseEditDateTime(editClockInText.trim());
    }
    setEditDatePickerSeedMs((parsed ?? new Date()).getTime());
    setEditDatePickerTarget(target);
    setEditDatePickerOpen(true);
  };

  const confirmEditDateTimePicker = (d: Date) => {
    const s = formatDateTimeForEdit(d);
    if (editDatePickerTarget === 'clockIn') setEditClockInText(s);
    else if (editDatePickerTarget === 'clockOut') setEditClockOutText(s);
    setEditDatePickerOpen(false);
    setEditDatePickerTarget(null);
  };

  const closeEditDateTimePicker = () => {
    setEditDatePickerOpen(false);
    setEditDatePickerTarget(null);
  };

  const saveEditedEntry = async () => {
    const id = editEntry ? entryId(editEntry) : '';
    if (!id) return;
    const inParsed = parseEditDateTime(editClockInText);
    if (!inParsed) {
      Alert.alert('Invalid time', 'Clock In must be DD-MM-YYYY HH:mm (e.g. 14-03-2026 01:21).');
      return;
    }
    const outTrim = editClockOutText.trim();
    let outParsed: Date | null = null;
    if (outTrim) {
      outParsed = parseEditDateTime(outTrim);
      if (!outParsed) {
        Alert.alert('Invalid time', 'Clock Out must be DD-MM-YYYY HH:mm or left empty.');
        return;
      }
      if (outParsed.getTime() < inParsed.getTime()) {
        Alert.alert('Invalid range', 'Clock out must be on or after clock in.');
        return;
      }
    }
    const clockInIso = inParsed.toISOString();
    const clockOutIso = outParsed ? outParsed.toISOString() : null;

    const otTrim = editOvertimeText.trim().replace(',', '.');
    const otVal = parseFloat(otTrim);
    if (!Number.isFinite(otVal) || otVal < 0) {
      Alert.alert('Invalid overtime', 'Enter overtime hours as a number (e.g. 0 or 1.5).');
      return;
    }

    const tryPatch = async (body: Record<string, unknown>) => api.updateTimeClockEntry(id, body);

    setEditSaving(true);
    try {
      const baseClock =
        clockOutIso != null
          ? { clock_in: clockInIso, clock_out: clockOutIso, overtime_hours: otVal }
          : { clock_in: clockInIso, clock_out: null, overtime_hours: otVal };
      const altClock =
        clockOutIso != null
          ? { clock_in_time: clockInIso, clock_out_time: clockOutIso, overtime_hours: otVal }
          : { clock_in_time: clockInIso, clock_out_time: null, overtime_hours: otVal };
      const baseOvertimeAlias =
        clockOutIso != null
          ? { clock_in: clockInIso, clock_out: clockOutIso, overtime: otVal }
          : { clock_in: clockInIso, clock_out: null, overtime: otVal };
      try {
        await tryPatch(baseClock);
      } catch (e1: any) {
        try {
          await tryPatch(altClock);
        } catch {
          try {
            await tryPatch(baseOvertimeAlias);
          } catch {
            try {
              await tryPatch(
                clockOutIso != null
                  ? { clock_in_time: clockInIso, clock_out_time: clockOutIso, overtime: otVal }
                  : { clock_in_time: clockInIso, clock_out_time: null, overtime: otVal }
              );
            } catch {
              throw e1;
            }
          }
        }
      }
      await load();
      closeEditEntryModal();
      Alert.alert('Saved', 'Time entry updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const handleApproveRequest = async (req: any) => {
    const id = entryId(req);
    if (!id) return;
    setActionLoading(true);
    try {
      await api.approveUnscheduled(id);
      await load();
      Alert.alert('Approved', 'Clock-in request approved.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Approve failed');
    } finally {
      setActionLoading(false);
    }
  };

  const hoursReportPeriodLabel =
    hoursReportPeriod === 'today' ? 'Today' : hoursReportPeriod === 'week' ? 'This Week' : 'This Month';

  const exportHoursReportCsv = () => {
    const q = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ['Employee', 'Date', 'Clock In', 'Clock Out', 'Break', 'Hours', 'Overtime', 'Status'].join(','),
    ];
    const sorted = hoursReportFiltered
      .slice()
      .sort((a, b) => (parseMs(b.clock_in) ?? 0) - (parseMs(a.clock_in) ?? 0));
    for (const en of sorted) {
      const eid = entryEmployeeId(en);
      const emp = employeeById.get(eid);
      lines.push(
        [
          q(employeeDisplayName(emp || {})),
          q(formatDateShort(en.clock_in)),
          q(formatHm(en.clock_in)),
          q(en.clock_out ? formatHm(en.clock_out) : '—'),
          q(breakLabel(en)),
          durationHours(en).toFixed(2),
          overtimeHours(en).toFixed(1),
          en.clock_out ? 'Complete' : 'Active',
        ].join(',')
      );
    }
    const csv = lines.join('\n');
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hours_report_${hoursReportPeriod}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      Alert.alert('Export', 'CSV export is available in the web app.');
    }
  };

  const taskAssigneeDisplay = (t: any) => {
    const uid = taskAssigneeUserId(t);
    if (!uid) return '—';
    const emp = scopedEmployees.find((e) => String(e.user ?? e.user_id) === uid);
    return emp ? employeeDisplayName(emp) : uid;
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Time Clock</Text>
        <Text style={styles.pageSubtitle}>Track employee time and manage attendance</Text>

        <View style={styles.filterRow}>
          <TouchableOpacity style={styles.filterChip} onPress={() => !isManager && setCompanyPicker(true)} disabled={isManager}>
            <Text style={styles.filterChipText} numberOfLines={1}>
              {companyLabel}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip} onPress={() => setLocationPicker(true)}>
            <Text style={styles.filterChipText} numberOfLines={1}>
              {locationLabel}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip} onPress={() => setPeriodPicker(true)}>
            <Text style={styles.filterChipText} numberOfLines={1}>
              {periodLabel}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
          </TouchableOpacity>
        </View>

        <View style={styles.tabs}>
          {(
            [
              { key: 'clock' as const, label: 'Time Clock', icon: 'clock-outline' as const, badge: 0 },
              { key: 'hours' as const, label: 'Hours Report', icon: 'file-document-outline' as const, badge: 0 },
              { key: 'tasks' as const, label: 'Tasks Overview', icon: 'view-grid-outline' as const, badge: 0 },
              {
                key: 'requests' as const,
                label: 'Clock-in Requests',
                icon: 'account-clock-outline' as const,
                badge: requests.length,
              },
            ] as const
          ).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <MaterialCommunityIcons name={t.icon} size={18} color={tab === t.key ? '#0f172a' : '#64748b'} />
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]} numberOfLines={1}>
                {t.label}
              </Text>
              {t.badge > 0 ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{t.badge > 99 ? '99+' : t.badge}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'clock' ? (
          <>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Currently Clocked In</Text>
                <Text style={[styles.statValue, { color: GREEN }]}>{stats.clockedIn}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Total Hours Today</Text>
                <Text style={styles.statValue}>{stats.totalToday}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Average Hours</Text>
                <Text style={styles.statValue}>{stats.avgHours}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Overtime Hours</Text>
                <Text style={[styles.statValue, { color: ORANGE }]}>{stats.overtime}</Text>
              </View>
            </View>

            <View style={styles.twoCol}>
              <View style={styles.halfCard}>
                <View style={styles.cardHead}>
                  <MaterialCommunityIcons name="clock-outline" size={22} color="#0f172a" />
                  <Text style={styles.cardHeadTitle}>Currently Active</Text>
                </View>
                <View style={openEntries.length === 0 ? styles.cardBodyEmpty : styles.cardBodyList}>
                  {openEntries.length === 0 ? (
                    <>
                      <MaterialCommunityIcons name="clock-outline" size={48} color="#e2e8f0" />
                      <Text style={styles.emptyText}>No employees currently clocked in</Text>
                    </>
                  ) : (
                    openEntries.map((en) => {
                      const emp = employeeById.get(entryEmployeeId(en));
                      return (
                        <View key={entryId(en)} style={styles.activeRow}>
                          <Text style={styles.activeName}>{employeeDisplayName(emp || {}) || 'Employee'}</Text>
                          <Text style={styles.activeSub}>In: {formatHm(en.clock_in)}</Text>
                          <TouchableOpacity
                            style={styles.smallBtn}
                            onPress={() => void handleClockOutEntry(en)}
                            disabled={actionLoading}
                          >
                            <Text style={styles.smallBtnText}>Clock out</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}
                </View>
              </View>
              <View style={styles.halfCard}>
                <View style={styles.cardHead}>
                  <MaterialCommunityIcons name="play-circle-outline" size={22} color="#0f172a" />
                  <Text style={styles.cardHeadTitle}>Quick Clock In</Text>
                </View>
                <View style={employeesNotClockedIn.length === 0 ? styles.cardBodyEmpty : styles.cardBodyList}>
                  {employeesNotClockedIn.length === 0 ? (
                    <>
                      <MaterialCommunityIcons name="account-outline" size={48} color="#e2e8f0" />
                      <Text style={styles.emptyText}>No active employees available</Text>
                    </>
                  ) : (
                    employeesNotClockedIn.slice(0, 12).map((emp) => (
                      <TouchableOpacity
                        key={String(emp.id)}
                        style={styles.quickRow}
                        onPress={() => void handleClockInEmployee(emp)}
                        disabled={actionLoading}
                      >
                        <MaterialCommunityIcons name="account" size={20} color="#64748b" />
                        <Text style={styles.quickName}>{employeeDisplayName(emp)}</Text>
                        <MaterialCommunityIcons name="chevron-right" size={20} color="#94a3b8" />
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              </View>
            </View>

            <View style={styles.entriesCard}>
              <Text style={styles.entriesTitle}>Time Entries</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                <View style={styles.table}>
                  <View style={styles.trHead}>
                    {['Employee', 'Date', 'Clock In', 'Clock Out', 'Total Hours', 'Actions'].map((h) => (
                      <Text key={h} style={[styles.th, h === 'Actions' && styles.thWide]}>
                        {h}
                      </Text>
                    ))}
                  </View>
                  {filteredEntries.length === 0 ? (
                    <View style={styles.tableEmpty}>
                      <MaterialCommunityIcons name="clock-outline" size={40} color="#cbd5e1" />
                      <Text style={styles.tableEmptyText}>No time entries found.</Text>
                    </View>
                  ) : (
                    filteredEntries
                      .slice()
                      .sort((a, b) => (parseMs(b.clock_in) ?? 0) - (parseMs(a.clock_in) ?? 0))
                      .map((en) => {
                        const eid = entryEmployeeId(en);
                        const emp = employeeById.get(eid);
                        const hrs = durationHours(en);
                        return (
                          <View key={entryId(en)} style={styles.tr}>
                            <Text style={styles.td}>{employeeDisplayName(emp || {})}</Text>
                            <Text style={styles.td}>{formatDateShort(en.clock_in)}</Text>
                            <Text style={styles.td}>{formatHm(en.clock_in)}</Text>
                            <Text style={styles.td}>{en.clock_out ? formatHm(en.clock_out) : '—'}</Text>
                            <Text style={styles.td}>{hrs.toFixed(2)}</Text>
                            <View style={[styles.td, styles.tdActions, styles.tdActionsCol]}>
                              <TouchableOpacity
                                style={styles.editEntryBtn}
                                onPress={() => openEditEntryModal(en)}
                                disabled={actionLoading || editSaving}
                              >
                                <MaterialCommunityIcons name="pencil-outline" size={16} color="#2563eb" />
                                <Text style={styles.editEntryBtnText}>Edit</Text>
                              </TouchableOpacity>
                              {!en.clock_out ? (
                                <TouchableOpacity onPress={() => void handleClockOutEntry(en)} disabled={actionLoading}>
                                  <Text style={styles.linkAction}>Clock out</Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          </View>
                        );
                      })
                  )}
                </View>
              </ScrollView>
            </View>
          </>
        ) : null}

        {tab === 'hours' ? (
          <View style={styles.hoursMainCard}>
            <View style={styles.hoursCardHeader}>
              <Text style={styles.hoursCardTitle}>Employee Hours Report</Text>
              <TouchableOpacity style={styles.exportBtn} onPress={exportHoursReportCsv} activeOpacity={0.85}>
                <MaterialCommunityIcons name="microsoft-excel" size={18} color="#fff" />
                <Text style={styles.exportBtnText}>Export to Excel</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.hoursFilterRow}>
              <TouchableOpacity style={styles.hoursFilterChip} onPress={() => setHoursReportPeriodPicker(true)}>
                <Text style={styles.hoursFilterText} numberOfLines={1}>
                  {hoursReportPeriodLabel}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.hoursFilterChip} onPress={() => setHoursDeptPicker(true)}>
                <Text style={styles.hoursFilterText} numberOfLines={1}>
                  {hoursDeptOptions.find((o) => o.id === hoursDeptFilter)?.label ?? 'All Departments'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.hoursFilterChip} onPress={() => setHoursEmpPicker(true)}>
                <Text style={styles.hoursFilterText} numberOfLines={1}>
                  {hoursEmpOptions.find((o) => o.id === hoursEmpFilter)?.label ?? 'All Employees'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>
            <View style={styles.hoursStatsRow}>
              <View style={styles.hoursStatCard}>
                <Text style={styles.hoursStatLabel}>Employees</Text>
                <Text style={styles.hoursStatValue}>{hoursReportStats.employeeCount}</Text>
              </View>
              <View style={styles.hoursStatCard}>
                <Text style={styles.hoursStatLabel}>Total Hours</Text>
                <Text style={styles.hoursStatValue}>{hoursReportStats.totalHours}h</Text>
              </View>
              <View style={styles.hoursStatCard}>
                <Text style={styles.hoursStatLabel}>Overtime</Text>
                <Text style={styles.hoursStatValue}>{hoursReportStats.overtime}h</Text>
              </View>
              <View style={styles.hoursStatCard}>
                <Text style={styles.hoursStatLabel}>Est. Cost</Text>
                <Text style={styles.hoursStatValue}>${hoursReportStats.estCost}</Text>
              </View>
            </View>
            {hoursReportFiltered.length === 0 ? (
              <View style={styles.hoursEmpty}>
                <MaterialCommunityIcons name="account-group-outline" size={48} color="#cbd5e1" />
                <Text style={styles.hoursEmptyText}>No time entries found for this period.</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                <View style={styles.hoursTable}>
                  <View style={styles.hoursTrHead}>
                    {['Employee', 'Date', 'Clock In', 'Clock Out', 'Break', 'Hours', 'Overtime', 'Status'].map((h) => (
                      <Text key={h} style={styles.hoursTh}>
                        {h}
                      </Text>
                    ))}
                  </View>
                  {hoursReportFiltered
                    .slice()
                    .sort((a, b) => (parseMs(b.clock_in) ?? 0) - (parseMs(a.clock_in) ?? 0))
                    .map((en) => {
                      const eid = entryEmployeeId(en);
                      const emp = employeeById.get(eid);
                      const hrs = durationHours(en);
                      const ot = overtimeHours(en);
                      const status = en.clock_out ? 'Complete' : 'Active';
                      return (
                        <View key={entryId(en)} style={styles.hoursTr}>
                          <Text style={styles.hoursTd}>{employeeDisplayName(emp || {})}</Text>
                          <Text style={styles.hoursTd}>{formatDateShort(en.clock_in)}</Text>
                          <Text style={styles.hoursTd}>{formatHm(en.clock_in)}</Text>
                          <Text style={styles.hoursTd}>{en.clock_out ? formatHm(en.clock_out) : '—'}</Text>
                          <Text style={styles.hoursTd}>{breakLabel(en)}</Text>
                          <Text style={styles.hoursTd}>{hrs.toFixed(2)}</Text>
                          <Text style={[styles.hoursTd, ot > 0 && { color: ORANGE }]}>{ot.toFixed(1)}</Text>
                          <Text style={styles.hoursTd}>{status}</Text>
                        </View>
                      );
                    })}
                </View>
              </ScrollView>
            )}
          </View>
        ) : null}

        {tab === 'tasks' ? (
          <View style={styles.hoursMainCard}>
            <View style={styles.tasksOverviewHeader}>
              <Text style={styles.hoursCardTitle}>All Employee Tasks</Text>
              <TouchableOpacity style={styles.tasksEmpChip} onPress={() => setTasksEmpPicker(true)}>
                <Text style={styles.hoursFilterText} numberOfLines={1}>
                  {tasksEmployeeOptions.find((o) => o.id === tasksEmpFilter)?.label ?? 'All Employees'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>
            <View style={styles.taskStatsRow}>
              <View style={[styles.taskStatCard, styles.taskStatCardPrimary]}>
                <Text style={styles.taskStatValueLight}>{taskStats.total}</Text>
                <Text style={styles.taskStatLabelLight}>Total</Text>
              </View>
              <View style={styles.taskStatCard}>
                <Text style={styles.taskStatValueDark}>{taskStats.pending}</Text>
                <Text style={styles.taskStatLabelDark}>Pending</Text>
              </View>
              <View style={styles.taskStatCard}>
                <Text style={styles.taskStatValueDark}>{taskStats.completed}</Text>
                <Text style={styles.taskStatLabelDark}>Completed</Text>
              </View>
              <View style={styles.taskStatCard}>
                <Text style={[styles.taskStatValueDark, taskStats.overdue > 0 && { color: '#dc2626' }]}>
                  {taskStats.overdue}
                </Text>
                <Text style={styles.taskStatLabelDark}>Overdue</Text>
              </View>
            </View>
            {tasksScoped.length === 0 ? (
              <View style={styles.hoursEmpty}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={48} color="#cbd5e1" />
                <Text style={styles.hoursEmptyText}>No tasks in this view.</Text>
              </View>
            ) : (
              <View style={styles.taskList}>
                {tasksScoped
                  .slice()
                  .sort((a, b) => {
                    const ta = parseMs(a.start_time ?? a.end_time) ?? 0;
                    const tb = parseMs(b.start_time ?? b.end_time) ?? 0;
                    return tb - ta;
                  })
                  .map((t, tix) => {
                    const due = t.end_time ?? t.due_date ?? t.start_time;
                    const overdue =
                      !t.completed &&
                      (() => {
                        const end = parseMs(due);
                        return end != null && end < Date.now();
                      })();
                    return (
                      <View key={taskEventId(t) || `task-${tix}`} style={styles.taskRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.taskRowTitle} numberOfLines={2}>
                            {t.title || 'Task'}
                          </Text>
                          <Text style={styles.taskRowMeta}>
                            {taskAssigneeDisplay(t)}
                            {due ? ` · Due ${formatDateShort(due)}` : ''}
                            {overdue ? ' · Overdue' : ''}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.taskStatusPill,
                            t.completed ? styles.taskPillDone : overdue ? styles.taskPillOverdue : styles.taskPillPending,
                          ]}
                        >
                          <Text style={styles.taskPillText}>{t.completed ? 'Done' : overdue ? 'Overdue' : 'Pending'}</Text>
                        </View>
                      </View>
                    );
                  })}
              </View>
            )}
          </View>
        ) : null}

        {tab === 'requests' ? (
          <View style={styles.hoursMainCard}>
            <View style={styles.requestsTitleRow}>
              <MaterialCommunityIcons name="account-clock-outline" size={22} color="#0f172a" />
              <Text style={styles.hoursCardTitle}>Clock-in Requests</Text>
            </View>
            <Text style={styles.requestsHelp}>
              Employees who clocked in without a scheduled shift. Approve to add the shift to their schedule (shows in
              reports).
            </Text>
            {requests.length === 0 ? (
              <View style={styles.hoursEmpty}>
                <MaterialCommunityIcons name="check-circle-outline" size={48} color="#cbd5e1" />
                <Text style={styles.hoursEmptyText}>No pending requests.</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                <View style={styles.reqTable}>
                  <View style={styles.reqTrHead}>
                    {['Employee', 'Company', 'Clock In', 'Clock Out', 'Hours', 'Action'].map((h) => (
                      <Text key={h} style={h === 'Action' ? styles.reqThAction : styles.reqTh}>
                        {h}
                      </Text>
                    ))}
                  </View>
                  {requests.map((req, ri) => {
                    const eid = entryEmployeeId(req);
                    const emp =
                      (eid ? employeeById.get(eid) : null) ||
                      (typeof req.employee === 'object' && req.employee ? req.employee : {}) ||
                      {};
                    const hrs = durationHours(req);
                    return (
                      <View key={entryId(req) || `req-${ri}`} style={styles.reqTr}>
                        <Text style={styles.reqTd}>{employeeDisplayName(emp)}</Text>
                        <Text style={styles.reqTd}>{requestCompanyLabel(req, companies)}</Text>
                        <Text style={styles.reqTd}>
                          {formatDateShort(req.clock_in)} {formatHm(req.clock_in)}
                        </Text>
                        <Text style={styles.reqTd}>
                          {req.clock_out ? `${formatDateShort(req.clock_out)} ${formatHm(req.clock_out)}` : '—'}
                        </Text>
                        <Text style={styles.reqTd}>{hrs.toFixed(2)}</Text>
                        <View style={styles.reqTdAction}>
                          <TouchableOpacity
                            style={styles.approveBtnPrimary}
                            onPress={() => void handleApproveRequest(req)}
                            disabled={actionLoading}
                          >
                            <Text style={styles.approveBtnPrimaryText}>Approve</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </View>
        ) : null}
      </ScrollView>

      <PickerModal
        visible={companyPicker}
        title="Select Company"
        options={companyOptions}
        selectedId={selectedCompanyId}
        onSelect={setSelectedCompanyId}
        onClose={() => setCompanyPicker(false)}
      />
      <PickerModal
        visible={locationPicker}
        title="Select Location"
        options={locationOptions}
        selectedId={selectedLocationId}
        onSelect={setSelectedLocationId}
        onClose={() => setLocationPicker(false)}
      />
      <PickerModal
        visible={periodPicker}
        title="Time Period"
        options={[
          { id: 'today', label: 'Today' },
          { id: 'week', label: 'This Week' },
          { id: 'month', label: 'This Month' },
        ]}
        selectedId={period}
        onSelect={(id) => setPeriod(id as typeof period)}
        onClose={() => setPeriodPicker(false)}
      />
      <PickerModal
        visible={hoursReportPeriodPicker}
        title="Report timeframe"
        options={[
          { id: 'today', label: 'Today' },
          { id: 'week', label: 'This Week' },
          { id: 'month', label: 'This Month' },
        ]}
        selectedId={hoursReportPeriod}
        onSelect={(id) => setHoursReportPeriod(id as typeof hoursReportPeriod)}
        onClose={() => setHoursReportPeriodPicker(false)}
      />
      <PickerModal
        visible={hoursDeptPicker}
        title="Department"
        options={hoursDeptOptions}
        selectedId={hoursDeptFilter}
        onSelect={setHoursDeptFilter}
        onClose={() => setHoursDeptPicker(false)}
      />
      <PickerModal
        visible={hoursEmpPicker}
        title="Employee"
        options={hoursEmpOptions}
        selectedId={hoursEmpFilter}
        onSelect={setHoursEmpFilter}
        onClose={() => setHoursEmpPicker(false)}
      />
      <PickerModal
        visible={tasksEmpPicker}
        title="Filter by employee"
        options={tasksEmployeeOptions}
        selectedId={tasksEmpFilter}
        onSelect={setTasksEmpFilter}
        onClose={() => setTasksEmpPicker(false)}
      />

      <Modal visible={editEntry != null} transparent animationType="fade" onRequestClose={closeEditEntryModal}>
        <KeyboardAvoidingView
          style={styles.editModalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !editSaving && closeEditEntryModal()} />
          <View style={styles.editModalBox}>
            <View style={styles.editModalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.editModalTitle}>Edit clock in / out</Text>
                <Text style={styles.editModalSubtitle}>
                  {editEntry
                    ? employeeDisplayName(employeeById.get(entryEmployeeId(editEntry)) || {}) || 'Employee'
                    : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => !editSaving && closeEditEntryModal()} disabled={editSaving} hitSlop={12}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={styles.editFieldLabel}>Clock In</Text>
            <View style={styles.editFieldInputWrap}>
              <TextInput
                style={[styles.editFieldInput, styles.editFieldInputFlex]}
                value={editClockInText}
                onChangeText={setEditClockInText}
                placeholder="DD-MM-YYYY HH:mm"
                placeholderTextColor="#94a3b8"
                editable={!editSaving}
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.editFieldIconBtn}
                onPress={() => openEditDateTimePicker('clockIn')}
                disabled={editSaving}
                accessibilityLabel="Open calendar and time picker for clock in"
              >
                <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={[styles.editFieldLabel, { marginTop: 14 }]}>Clock Out (leave empty if still clocked in)</Text>
            <View style={styles.editFieldInputWrap}>
              <TextInput
                style={[styles.editFieldInput, styles.editFieldInputFlex]}
                value={editClockOutText}
                onChangeText={setEditClockOutText}
                placeholder="DD-MM-YYYY HH:mm"
                placeholderTextColor="#94a3b8"
                editable={!editSaving}
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.editFieldIconBtn}
                onPress={() => openEditDateTimePicker('clockOut')}
                disabled={editSaving}
                accessibilityLabel="Open calendar and time picker for clock out"
              >
                <MaterialCommunityIcons name="calendar-clock" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            {editEntry ? (
              <>
                <Text style={[styles.editFieldLabel, { marginTop: 14 }]}>Break</Text>
                <Text style={styles.editReadonlyValue}>{breakLabel(editEntry)}</Text>
                <Text style={[styles.editFieldLabel, { marginTop: 14 }]}>Overtime (hours)</Text>
                <View style={styles.editFieldInputWrap}>
                  <TextInput
                    style={[styles.editFieldInput, styles.editFieldInputFlex]}
                    value={editOvertimeText}
                    onChangeText={setEditOvertimeText}
                    placeholder="0"
                    placeholderTextColor="#94a3b8"
                    editable={!editSaving}
                    keyboardType="decimal-pad"
                    autoCorrect={false}
                  />
                </View>
                <Text style={[styles.editFieldLabel, { marginTop: 14 }]}>Status</Text>
                <Text style={styles.editReadonlyValue}>{entryStatusLabel(editEntry)}</Text>
              </>
            ) : null}
            <View style={styles.editModalActions}>
              <TouchableOpacity
                style={styles.editCancelBtn}
                onPress={closeEditEntryModal}
                disabled={editSaving}
              >
                <Text style={styles.editCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editSaveBtn, editSaving && { opacity: 0.7 }]}
                onPress={() => void saveEditedEntry()}
                disabled={editSaving}
              >
                {editSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.editSaveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ClockEditDateTimePickerModal
        visible={editDatePickerOpen}
        initialTimeMs={editDatePickerSeedMs}
        target={editDatePickerTarget}
        onClose={closeEditDateTimePicker}
        onConfirm={confirmEditDateTimePicker}
        onClearField={editDatePickerTarget === 'clockOut' ? () => setEditClockOutText('') : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  scroll: { padding: 16, paddingBottom: 40 },

  pageTitle: { fontSize: 26, fontWeight: '800', color: '#0f172a' },
  pageSubtitle: { fontSize: 15, color: '#64748b', marginTop: 6, marginBottom: 16 },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexGrow: 1,
    minWidth: 100,
    maxWidth: '100%',
  },
  filterChipText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0f172a' },

  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: '#e2e8f0',
    padding: 6,
    borderRadius: 12,
    marginBottom: 16,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'transparent',
    flex: 1,
    minWidth: 120,
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  tabText: { fontSize: 12, fontWeight: '600', color: '#64748b', flexShrink: 1 },
  tabTextActive: { color: '#0f172a' },
  tabBadge: {
    marginLeft: 4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  tabBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  hoursMainCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 16,
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)' },
      default: { elevation: 2 },
    }),
  },
  hoursCardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  hoursCardTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', flex: 1, minWidth: 160 },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  exportBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  hoursFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  hoursFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 120,
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
  },
  hoursFilterText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0f172a' },
  hoursStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  hoursStatCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    alignItems: 'center',
  },
  hoursStatLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', marginBottom: 6 },
  hoursStatValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  hoursEmpty: { alignItems: 'center', paddingVertical: 40 },
  hoursEmptyText: { marginTop: 12, fontSize: 15, color: '#64748b', textAlign: 'center' },
  hoursTable: { minWidth: 880 },
  hoursTrHead: { flexDirection: 'row', backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  hoursTh: {
    width: 104,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  hoursTr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', alignItems: 'center' },
  hoursTd: {
    width: 104,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#0f172a',
  },

  tasksOverviewHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  tasksEmpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
    minWidth: 160,
    maxWidth: 280,
  },
  taskStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  taskStatCard: {
    flex: 1,
    minWidth: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  taskStatCardPrimary: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  taskStatValueLight: { fontSize: 28, fontWeight: '800', color: '#fff' },
  taskStatLabelLight: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.9)', marginTop: 4 },
  taskStatValueDark: { fontSize: 28, fontWeight: '800', color: '#0f172a' },
  taskStatLabelDark: { fontSize: 11, fontWeight: '600', color: '#64748b', marginTop: 4 },
  taskList: { gap: 0 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  taskRowTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  taskRowMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  taskStatusPill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  taskPillDone: { backgroundColor: '#dcfce7' },
  taskPillPending: { backgroundColor: '#f1f5f9' },
  taskPillOverdue: { backgroundColor: '#fee2e2' },
  taskPillText: { fontSize: 12, fontWeight: '700', color: '#0f172a' },

  requestsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  requestsHelp: { fontSize: 14, color: '#64748b', lineHeight: 20, marginBottom: 16 },
  reqTable: { minWidth: 720 },
  reqTrHead: { flexDirection: 'row', backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  reqTh: {
    width: 120,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  reqThAction: {
    width: 100,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  reqTr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', alignItems: 'center' },
  reqTd: {
    width: 120,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#0f172a',
  },
  reqTdAction: { width: 100, paddingHorizontal: 8, paddingVertical: 8 },
  approveBtnPrimary: {
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  statLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 8 },
  statValue: { fontSize: 28, fontWeight: '800', color: '#0f172a' },

  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  halfCard: {
    flex: 1,
    minWidth: 280,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  cardHeadTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  cardBodyEmpty: { minHeight: 160, padding: 16, alignItems: 'center', justifyContent: 'center' },
  cardBodyList: { minHeight: 160, padding: 12, alignItems: 'stretch', width: '100%' },
  emptyText: { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center' },
  activeRow: {
    alignSelf: 'stretch',
    width: '100%',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  activeName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  activeSub: { fontSize: 13, color: '#64748b', marginTop: 4 },
  smallBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#eff6ff', borderRadius: 6 },
  smallBtnText: { fontSize: 13, fontWeight: '600', color: '#2563eb' },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  quickName: { flex: 1, fontSize: 15, color: '#0f172a', fontWeight: '500' },

  entriesCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  entriesTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  table: { minWidth: 720 },
  trHead: { flexDirection: 'row', backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  th: {
    width: 100,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  thWide: { width: 120 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', alignItems: 'center' },
  td: {
    width: 100,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#0f172a',
  },
  tdActions: { width: 120 },
  tdActionsCol: { flexDirection: 'column', alignItems: 'flex-start', gap: 8, justifyContent: 'center' },
  editEntryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editEntryBtnText: { color: '#2563eb', fontWeight: '600', fontSize: 13 },
  tdMuted: { color: '#94a3b8' },
  linkAction: { color: '#2563eb', fontWeight: '600', fontSize: 13 },

  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  editModalBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
    ...Platform.select({
      web: { boxShadow: '0 10px 40px rgba(15, 23, 42, 0.15)' },
      default: { elevation: 8 },
    }),
  },
  editModalHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  editModalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  editModalSubtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  editReadonlyValue: {
    fontSize: 15,
    color: '#0f172a',
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    overflow: 'hidden',
  },
  editFieldLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  editFieldInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  editFieldInputFlex: { flex: 1, borderWidth: 0, minWidth: 0 },
  editFieldIconBtn: { paddingVertical: 12, paddingHorizontal: 14 },
  editFieldInput: {
    borderWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: 'transparent',
  },
  editModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 22,
  },
  editCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  editCancelBtnText: { fontSize: 15, fontWeight: '600', color: '#2563eb' },
  editSaveBtn: {
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  editSaveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  tableEmpty: { paddingVertical: 48, alignItems: 'center', width: 720 },
  tableEmptyText: { marginTop: 12, fontSize: 15, color: '#64748b' },

  panelCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 16,
  },
  panelTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  panelSub: { fontSize: 14, color: '#64748b', marginTop: 6, marginBottom: 16, lineHeight: 20 },
  panelEmpty: { alignItems: 'center', paddingVertical: 32 },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  reportName: { fontSize: 15, color: '#0f172a', fontWeight: '500' },
  reportHrs: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f0',
  },
  requestTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  requestMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  approveBtn: { backgroundColor: '#22c55e', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
