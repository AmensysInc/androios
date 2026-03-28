import React, { useEffect, useState, useCallback, useMemo, useRef, Fragment } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Modal,
  FlatList,
  Platform,
  useWindowDimensions,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';


const KeyedView = View as React.ComponentType<React.ComponentProps<typeof View> & { key?: React.Key }>;
const KeyedFragment = Fragment as React.ComponentType<{ children?: React.ReactNode; key?: React.Key }>;
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api';

type Organization = { id: string; name: string; [k: string]: any };
type Company = { id: string; name: string; organization_id?: string; company_manager_id?: string; [k: string]: any };

function companyOrganizationId(c: Company): string {
  const v = c.organization_id ?? (c as any).organization;
  return v != null ? String(v) : '';
}
type Employee = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  company_id?: string;
  role?: string;
  [k: string]: any;
};

type SavedWeekTemplate = {
  id: string;
  companyId: string;
  orgName: string;
  companyName: string;
  /**
   * Optional hyperlinked endpoint returned by the backend (DRF often returns `url`).
   * Used to delete a template without trying many fallback routes.
   */
  deleteEndpoint?: string;
  weekStartISO: string;
  weekEndISO: string;
  weekLabel: string;
  shiftCount: number;
  savedAtISO: string;
  published: boolean;
  shifts: Array<{
    employee: string;
    start_time: string;
    end_time?: string;
    break_duration_minutes?: number;
    notes?: string;
    shift_type?: string;
    hourly_rate?: string;
    status?: string;
  }>;
};

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function weekRangeFromStart(weekStart: Date): { start: Date; end: Date } {
  const start = startOfWeekMonday(weekStart);
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function buildInclusiveDays(start: Date, end: Date): Date[] {
  const s = startOfDayLocal(start);
  const e = startOfDayLocal(end);
  if (e.getTime() < s.getTime()) return [new Date(s)];
  const out: Date[] = [];
  const cur = new Date(s);
  while (cur.getTime() <= e.getTime()) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** True when the range is exactly Mon–Sun (same ISO week as start). */
function isStandardMondaySundayWeek(start: Date, end: Date): boolean {
  const s = startOfDayLocal(start);
  const e = startOfDayLocal(end);
  const mon = startOfWeekMonday(s);
  const sun = addDays(mon, 6);
  return mon.getTime() === s.getTime() && sun.getTime() === e.getTime();
}

function formatWeekToolbar(start: Date, end: Date): string {
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, o)} – ${end.toLocaleDateString(undefined, o)}`;
}

/** Map `/scheduler/schedule-templates/` rows into local card model (field names vary by backend). */
function resolveCompanyIdFromRow(row: any, fallback: string): string {
  const c = row?.company_id ?? row?.company;
  if (c != null && typeof c === 'object' && (c as any).id != null) return String((c as any).id).trim();
  if (c != null && c !== '') return String(c).trim();
  return String(fallback || '').trim();
}

/** True for `.../scheduler/<collection>/<pk>/` (detail), not bare list URLs. */
function isSchedulerResourceDetailUrl(u: string): boolean {
  const pathOnly = u.trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
  const parts = pathOnly.split('/').filter(Boolean);
  const si = parts.indexOf('scheduler');
  if (si < 0) return false;
  return parts.length - (si + 1) >= 2;
}

function mapScheduleTemplateApiToSaved(
  row: any,
  orgName: string,
  companyName: string,
  companyIdFallback: string
): SavedWeekTemplate | null {
  const id = String(row?.id ?? row?.pk ?? row?.uuid ?? '').trim();
  if (!id) return null;
  const companyId = resolveCompanyIdFromRow(row, companyIdFallback);
  if (!companyId) return null;

  const deleteEndpointCandidate: any =
    row?.delete_url ??
    row?.destroy_url ??
    row?.remove_url ??
    row?.deletion_url ??
    row?.detail_url ??
    row?.self ??
    row?.url;
  // Prefer the serializer’s detail URL for DELETE (path PK may differ from row.id, e.g. int vs uuid).
  const deleteEndpoint =
    typeof deleteEndpointCandidate === 'string' &&
    deleteEndpointCandidate.includes('/scheduler/') &&
    (deleteEndpointCandidate.includes(id) ||
      deleteEndpointCandidate.endsWith(`${id}/`) ||
      deleteEndpointCandidate.endsWith(id) ||
      isSchedulerResourceDetailUrl(deleteEndpointCandidate))
      ? deleteEndpointCandidate
      : undefined;

  let shiftsRaw =
    row.shifts ??
    row.shift_data ??
    row.shifts_data ??
    row.template_shifts ??
    row.shift_templates ??
    row.data;
  if (typeof shiftsRaw === 'string') {
    try {
      shiftsRaw = JSON.parse(shiftsRaw);
    } catch {
      shiftsRaw = [];
    }
  }
  if (!Array.isArray(shiftsRaw)) shiftsRaw = [];
  /** List serializers often return `shifts: []` while linked PKs live on `shift_ids` — don't treat empty `shifts` as truthy content. */
  if (shiftsRaw.length === 0) {
    const idOnly =
      row.shift_ids ??
      row.linked_shift_ids ??
      row.schedule_shift_ids ??
      row.linked_shifts ??
      row.template_shift_ids ??
      row.scheduled_shift_ids ??
      row.m2m_shift_ids ??
      row.shift_pks;
    if (Array.isArray(idOnly) && idOnly.length > 0) {
      shiftsRaw = idOnly;
    }
  }

  let wsRaw =
    row.week_start ??
    row.week_start_date ??
    row.start_date ??
    row.weekStart ??
    row.range_start ??
    row.template_week_start;
  let weRaw =
    row.week_end ??
    row.week_end_date ??
    row.end_date ??
    row.weekEnd ??
    row.range_end ??
    row.template_week_end;

  /** Infer week bounds from embedded shifts when the API omits week_* fields. */
  if (!wsRaw && shiftsRaw.length > 0) {
    const starts = shiftsRaw
      .map((s: any) => (s?.start_time ? new Date(s.start_time) : null))
      .filter((d: Date | null): d is Date => !!d && !Number.isNaN(d.getTime()));
    if (starts.length > 0) {
      starts.sort((a: Date, b: Date) => a.getTime() - b.getTime());
      const first = starts[0];
      const mon = startOfWeekMonday(startOfDayLocal(first));
      wsRaw = mon.toISOString();
      if (!weRaw) {
        weRaw = endOfDayLocal(addDays(mon, 6)).toISOString();
      }
    }
  }

  /** List endpoints sometimes omit week_*; anchor from created_at so the card still appears. */
  if (!wsRaw) {
    const ca = row.created_at ?? row.updated_at ?? row.saved_at;
    if (ca) {
      const d = new Date(ca);
      if (!Number.isNaN(d.getTime())) {
        const mon = startOfWeekMonday(startOfDayLocal(d));
        wsRaw = mon.toISOString();
        if (!weRaw) weRaw = endOfDayLocal(addDays(mon, 6)).toISOString();
      }
    }
  }

  /** Our save label is `Schedule YYYY-MM-DD – YYYY-MM-DD" — parse when the API only echoes `name`. */
  if (!wsRaw && typeof row.name === 'string') {
    const m = row.name.trim().match(/(\d{4}-\d{2}-\d{2})\s*[–-]\s*(\d{4}-\d{2}-\d{2})/);
    if (m) {
      wsRaw = m[1];
      weRaw = m[2];
    }
  }

  if (!wsRaw) return null;
  const ws = new Date(wsRaw as string);
  if (Number.isNaN(ws.getTime())) return null;

  let we: Date;
  if (!weRaw) {
    we = endOfDayLocal(addDays(startOfDayLocal(ws), 6));
  } else {
    we = new Date(weRaw as string);
    if (Number.isNaN(we.getTime())) return null;
  }

  const shifts = shiftsRaw.map((s: any) => {
    if (typeof s === 'string' || typeof s === 'number') {
      // Some APIs return `shift_ids` only. Keep placeholders so count/UI don't show 0.
      return {
        employee: '',
        start_time: '',
        end_time: undefined,
        break_duration_minutes: 0,
        notes: undefined,
        shift_type: undefined,
        hourly_rate: undefined,
        status: undefined,
      };
    }
    const emp =
      s.employee_id ??
      (typeof s.employee === 'object' && s.employee != null && (s.employee as any).id != null
        ? (s.employee as any).id
        : s.employee);
    return {
      employee: String(emp ?? ''),
      start_time: String(s.start_time ?? ''),
      end_time: s.end_time != null ? String(s.end_time) : undefined,
      break_duration_minutes: Number(s.break_duration_minutes ?? s.break_minutes ?? 0),
      notes: s.notes ? String(s.notes) : undefined,
      shift_type: s.shift_type ? String(s.shift_type) : undefined,
      hourly_rate: s.hourly_rate != null ? String(s.hourly_rate) : undefined,
      status: s.status ? String(s.status) : undefined,
    };
  });

  const savedAtRaw =
    row.saved_at ?? row.created_at ?? row.updated_at ?? row.savedAt ?? new Date().toISOString();
  const savedAtISO =
    typeof savedAtRaw === 'string' ? savedAtRaw : new Date(savedAtRaw as Date | number).toISOString();

  const st = String(row.status ?? '').toLowerCase();
  const published = Boolean(row.published ?? row.is_published ?? st === 'published');

  const idList =
    row.shift_ids ??
    row.linked_shift_ids ??
    row.schedule_shift_ids ??
    row.linked_shifts ??
    row.template_shift_ids ??
    row.scheduled_shift_ids ??
    row.m2m_shift_ids ??
    row.shift_pks;
  const shiftIdsLen = Array.isArray(idList) ? idList.length : 0;
  const sc =
    row.shift_count ??
    row.shifts_count ??
    row.template_shift_count ??
    row.num_shifts ??
    row.shift_set_count;
  /** Prefer FK id lists when `shift_count` is 0 (stale annotation) but M2M ids are present. */
  const shiftCount =
    shiftIdsLen > 0
      ? shiftIdsLen
      : typeof sc === 'number' && Number.isFinite(sc) && sc >= 0
        ? sc
        : shifts.length;

  const weekLabel =
    typeof row.week_label === 'string' && row.week_label.trim()
      ? row.week_label.replace(/ – /g, ' - ')
      : typeof row.name === 'string' && row.name.trim()
        ? row.name.replace(/ – /g, ' - ')
        : typeof row.title === 'string' && row.title.trim()
          ? row.title.replace(/ – /g, ' - ')
          : formatWeekToolbar(startOfDayLocal(ws), startOfDayLocal(we)).replace(/ – /g, ' - ');

  return {
    id,
    companyId,
    orgName,
    companyName,
    deleteEndpoint,
    weekStartISO: startOfDayLocal(ws).toISOString(),
    weekEndISO: endOfDayLocal(we).toISOString(),
    weekLabel,
    shiftCount,
    savedAtISO,
    published,
    shifts,
  };
}

function employeeDisplayName(e: Employee): string {
  const fn = (e.first_name || '').trim();
  const ln = (e.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return e.email || 'Employee';
}

function employeeRoleLabel(emp: Employee): string {
  const r = String(emp.role || '').toLowerCase();
  if (!r || ['employee', 'house_keeping', 'maintenance', 'user'].includes(r)) return 'Employee';
  return emp.role || 'Employee';
}

function initials(e: Employee): string {
  const fn = (e.first_name || '').trim();
  const ln = (e.last_name || '').trim();
  if (fn && ln) return `${fn[0]}${ln[0]}`.toUpperCase();
  if (fn) return fn.slice(0, 2).toUpperCase();
  const em = (e.email || '?').slice(0, 2).toUpperCase();
  return em;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const RANGE_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ScheduleDateRangeModal({
  visible,
  onClose,
  onApply,
  onUseStandardWeek,
  initialCursorMonth,
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (start: Date, end: Date) => void;
  onUseStandardWeek: () => void;
  initialCursorMonth: Date;
}) {
  const [cursor, setCursor] = useState(() => new Date());
  const [from, setFrom] = useState<Date | null>(null);

  useEffect(() => {
    if (visible) {
      setFrom(null);
      setCursor(new Date(initialCursorMonth.getFullYear(), initialCursorMonth.getMonth(), 1));
    }
  }, [visible, initialCursorMonth]);

  const y = cursor.getFullYear();
  const mo = cursor.getMonth();
  const firstWd = (new Date(y, mo, 1).getDay() + 6) % 7;
  const dim = new Date(y, mo + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let day = 1; day <= dim; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);

  const now = new Date();
  const monthTitle = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const onDayPress = (day: number) => {
    const d = startOfDayLocal(new Date(y, mo, day));
    if (!from) {
      setFrom(d);
      return;
    }
    let a = from;
    let b = d;
    if (b.getTime() < a.getTime()) {
      const t = a;
      a = b;
      b = t;
    }
    onApply(a, b);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.rangePickModalBox}>
          <Text style={styles.rangePickTitle}>Date range</Text>
          <Text style={styles.rangePickHint}>{from ? 'Tap end date' : 'Tap start date, then end date'}</Text>
          <View style={styles.rangePickMonthRow}>
            <TouchableOpacity onPress={() => setCursor(new Date(y, mo - 1, 1))} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-left" size={22} color="#0f172a" />
            </TouchableOpacity>
            <Text style={styles.rangePickMonthTitle}>{monthTitle}</Text>
            <TouchableOpacity onPress={() => setCursor(new Date(y, mo + 1, 1))} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-right" size={22} color="#0f172a" />
            </TouchableOpacity>
          </View>
          <View style={styles.rangePickWeekHead}>
            {RANGE_WEEKDAYS.map((w) => (
              <Text key={w} style={styles.rangePickWeekHeadCell}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.rangePickGrid}>
            {cells.map((cell, idx) => {
              if (cell == null) return <View key={`e-${idx}`} style={styles.rangePickCell} />;
              const cellDate = new Date(y, mo, cell);
              const selStart = from && sameCalendarDay(cellDate, from);
              const isToday = sameCalendarDay(cellDate, now);
              return (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.rangePickCell,
                    selStart && styles.rangePickCellSel,
                    isToday && !selStart && styles.rangePickCellToday,
                  ]}
                  onPress={() => onDayPress(cell)}
                >
                  <Text style={[styles.rangePickCellTxt, selStart && styles.rangePickCellTxtSel]}>{cell}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.rangePickFooter}>
            {from ? (
              <TouchableOpacity onPress={() => setFrom(null)}>
                <Text style={styles.rangePickLink}>Reselect start</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ minWidth: 8 }} />
            )}
            <TouchableOpacity
              onPress={() => {
                onUseStandardWeek();
                onClose();
              }}
            >
              <Text style={styles.rangePickLink}>This week (Mon–Sun)</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.rangePickCloseBtn} onPress={onClose}>
            <Text style={styles.rangePickCloseBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function cellContentForDay(employee: Employee, day: Date, shifts: any[]): string {
  const empId = String(employee.id);
  const relevant = shifts.filter((s) => {
    const sid = String(s.employee_id ?? s.employee ?? '');
    if (sid !== empId) return false;
    const st = s.start_time ? new Date(s.start_time) : null;
    if (!st || Number.isNaN(st.getTime())) return false;
    return sameCalendarDay(st, day);
  });
  if (relevant.length === 0) return '-';
  return relevant
    .map((s) => {
      const st = new Date(s.start_time);
      const et = s.end_time ? new Date(s.end_time) : null;
      const t1 = st.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      if (!et) return t1;
      const t2 = et.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return `${t1}–${t2}`;
    })
    .join('\n');
}

function normalizeShiftRowForUi(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const employeeRaw =
    row.employee_id ??
    (typeof row.employee === 'object' && row.employee != null ? (row.employee as any).id : row.employee) ??
    row.employee_pk;
  const startRaw =
    row.start_time ?? row.start ?? row.start_at ?? row.time_in ?? row.start_datetime ?? row.datetime_start;
  const endRaw = row.end_time ?? row.end ?? row.end_at ?? row.time_out ?? row.end_datetime ?? row.datetime_end;
  const toIso = (v: any): string | undefined => {
    if (v == null || v === '') return undefined;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
    if (typeof v === 'number' && Number.isFinite(v)) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (typeof v === 'string') return v;
    return String(v);
  };
  return {
    ...row,
    id: String(row.id ?? row.pk ?? row.uuid ?? '').trim(),
    employee_id: String(employeeRaw ?? '').trim(),
    start_time: toIso(startRaw) ?? '',
    end_time: toIso(endRaw),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseTimeInput(v: string): { hh: number; mm: number } | null {
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function setTimeOnDate(day: Date, time: string): Date | null {
  const p = parseTimeInput(time);
  if (!p) return null;
  const d = new Date(day);
  d.setHours(p.hh, p.mm, 0, 0);
  return d;
}

function toTime24(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDateInput(d: Date): string {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function parseDateInput(v: string): Date | null {
  const m = String(v || '').trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Labels match Add Shift UI: preset windows + Custom (user sets start/end manually). */
const SHIFT_TYPE_OPTIONS = [
  'Morning (6am - 2pm)',
  'Afternoon (2pm - 10pm)',
  'Night (10pm - 6am)',
  'Day (9am - 5pm)',
  'Custom',
];

const SHIFT_TYPE_DEFAULT_TIMES: Record<string, { start: string; end: string }> = {
  'Morning (6am - 2pm)': { start: '06:00', end: '14:00' },
  'Afternoon (2pm - 10pm)': { start: '14:00', end: '22:00' },
  /** Legacy label from older builds — same window as Afternoon */
  'Evening (2pm - 10pm)': { start: '14:00', end: '22:00' },
  'Night (10pm - 6am)': { start: '22:00', end: '06:00' },
  'Day (9am - 5pm)': { start: '09:00', end: '17:00' },
};

function normalizeShiftTypeForUi(raw: string): string {
  const s = String(raw || '').trim();
  if (s === 'Evening (2pm - 10pm)') return 'Afternoon (2pm - 10pm)';
  return s;
}

const TIME_PICKER_HOURS = Array.from({ length: 24 }, (_, i) => i);
const TIME_PICKER_MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** If end time is earlier than start (e.g. night shift), end is stored as the next calendar day. */
function computeStartEndForDay(day: Date, startTime: string, endTime: string): { startAt: Date; endAt: Date } | null {
  const startAt = setTimeOnDate(day, startTime);
  if (!startAt) return null;
  let endAt = setTimeOnDate(day, endTime);
  if (!endAt) return null;
  if (endAt.getTime() <= startAt.getTime()) {
    endAt = new Date(endAt);
    endAt.setDate(endAt.getDate() + 1);
  }
  return { startAt, endAt };
}

const BREAK_OPTIONS = ['No break', '15 minutes', '30 minutes', '45 minutes', '60 minutes'];
const STATUS_OPTIONS = ['Scheduled', 'Published', 'Completed', 'Missed'];

const SHIFT_TYPE_PICKER_OPTIONS = SHIFT_TYPE_OPTIONS.map((label) => ({ id: label, label }));
const BREAK_PICKER_OPTIONS = BREAK_OPTIONS.map((label) => ({ id: label, label }));
const STATUS_PICKER_OPTIONS = STATUS_OPTIONS.map((label) => ({ id: label, label }));

type PickerModalProps = {
  visible: boolean;
  title: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
  onClose: () => void;
};

function PickerModal({ visible, title, options, onSelect, onClose }: PickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.modalRow}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={styles.modalRowText}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

export default function ScheduleScreen() {
  const { user, role } = useAuth();
  const { width, height } = useWindowDimensions();
  const isWide = width >= 900;
  const compactToolbar = width < 760;

  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  /** When set, grid spans from start of `weekAnchor` through this day (inclusive); otherwise Mon–Sun week. */
  const [customRangeEnd, setCustomRangeEnd] = useState<Date | null>(null);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);

  const rangeStart = useMemo(() => {
    if (customRangeEnd) return startOfDayLocal(weekAnchor);
    return startOfWeekMonday(weekAnchor);
  }, [weekAnchor, customRangeEnd]);

  const rangeEnd = useMemo(() => {
    if (customRangeEnd) return endOfDayLocal(customRangeEnd);
    return weekRangeFromStart(startOfWeekMonday(weekAnchor)).end;
  }, [weekAnchor, customRangeEnd]);

  const weekDays = useMemo(() => {
    if (customRangeEnd) return buildInclusiveDays(weekAnchor, customRangeEnd);
    const ws = startOfWeekMonday(weekAnchor);
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [weekAnchor, customRangeEnd]);

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orgModal, setOrgModal] = useState(false);
  const [companyModal, setCompanyModal] = useState(false);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [shiftSaving, setShiftSaving] = useState(false);
  const [publishWeekLoading, setPublishWeekLoading] = useState(false);
  const [saveTemplateLoading, setSaveTemplateLoading] = useState(false);
  const [shiftEmployee, setShiftEmployee] = useState<Employee | null>(null);
  const [shiftDay, setShiftDay] = useState<Date | null>(null);
  const [shiftType, setShiftType] = useState('Morning (6am - 2pm)');
  const [shiftStart, setShiftStart] = useState('06:00');
  const [shiftEnd, setShiftEnd] = useState('14:00');
  const [shiftBreakMin, setShiftBreakMin] = useState('30 minutes');
  const [shiftCopyWeek, setShiftCopyWeek] = useState(false);
  const [shiftNotes, setShiftNotes] = useState('');
  const [shiftTypePickerOpen, setShiftTypePickerOpen] = useState(false);
  const [shiftBreakPickerOpen, setShiftBreakPickerOpen] = useState(false);
  const [shiftStatusPickerOpen, setShiftStatusPickerOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftDateInput, setShiftDateInput] = useState('');
  const [shiftDepartment, setShiftDepartment] = useState('');
  const [shiftHourlyRate, setShiftHourlyRate] = useState('');
  const [shiftStatus, setShiftStatus] = useState('Scheduled');
  const [scheduleEditMode, setScheduleEditMode] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<SavedWeekTemplate[]>([]);
  const initialScheduleLoadDone = useRef(false);
  const [timePickerField, setTimePickerField] = useState<'start' | 'end' | null>(null);
  const [timePickerHour, setTimePickerHour] = useState(6);
  const [timePickerMinute, setTimePickerMinute] = useState(0);

  const needsOrg = role === 'super_admin' || role === 'admin' || role === 'operations_manager';

  useEffect(() => {
    if (!shiftModalOpen) setTimePickerField(null);
  }, [shiftModalOpen]);

  const isOrgManager = role === 'operations_manager' && user?.id;

  const companiesFiltered = useMemo(() => {
    if (needsOrg && !selectedOrgId) return [];
    let list = companies;
    list = api.filterCompaniesForCompanyManagerRole(list, role, user?.id);
    if (selectedOrgId) {
      const oid = String(selectedOrgId);
      list = list.filter((c) => companyOrganizationId(c) === oid);
    }
    return list;
  }, [companies, role, user?.id, selectedOrgId, needsOrg]);

  const selectedOrgName = organizations.find((o) => o.id === selectedOrgId)?.name;
  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  );
  const selectedCompanyName = selectedCompany?.name;

  const resolveOrganizationIdForScheduler = useCallback((): string | null => {
    if (needsOrg && selectedOrgId) return String(selectedOrgId);
    const raw = selectedCompany?.organization_id ?? (selectedCompany as any)?.organization;
    if (raw == null || raw === '') return null;
    if (typeof raw === 'object' && (raw as any).id != null) return String((raw as any).id);
    return String(raw).trim() || null;
  }, [needsOrg, selectedOrgId, selectedCompany]);

  const loadMeta = useCallback(async () => {
    try {
      const orgsRaw = await api.getOrganizations(isOrgManager ? { organization_manager: user?.id } : undefined);
      setOrganizations(Array.isArray(orgsRaw) ? orgsRaw : []);

      let compRaw: any[] = [];
      if (isOrgManager || role === 'manager') {
        compRaw = await api.getCompanies();
      } else if (needsOrg) {
        if (selectedOrgId) {
          const oid = String(selectedOrgId);
          try {
            compRaw = await api.getCompanies({ organization: oid });
          } catch {
            compRaw = [];
          }
          if (!Array.isArray(compRaw)) compRaw = [];
          if (compRaw.length === 0) {
            try {
              const byId = await api.getCompanies({ organization_id: oid });
              compRaw = Array.isArray(byId) ? byId : [];
            } catch {
              compRaw = [];
            }
          }
          if (compRaw.length === 0) {
            const all = await api.getCompanies();
            const rows = Array.isArray(all) ? all : [];
            compRaw = rows.filter((c: Company) => companyOrganizationId(c) === oid);
          }
        } else {
          compRaw = [];
        }
      } else {
        compRaw = await api.getCompanies();
      }
      setCompanies(Array.isArray(compRaw) ? compRaw : []);
    } catch (e) {
      console.warn(e);
    }
  }, [isOrgManager, role, user?.id, needsOrg, selectedOrgId]);

  const loadEmployeesAndShifts = useCallback(async () => {
    if (!selectedCompanyId) {
      setEmployees([]);
      setShifts([]);
      return;
    }
    try {
      const cid = String(selectedCompanyId);
      let empRaw: any[] = [];
      let shiftRaw: any[] = [];

      try {
        empRaw = await api.getEmployees({ company: cid });
      } catch {
        empRaw = [];
      }
      if (!Array.isArray(empRaw) || empRaw.length === 0) {
        try {
          const byId = await api.getEmployees({ company_id: cid });
          empRaw = Array.isArray(byId) ? byId : [];
        } catch {
          empRaw = [];
        }
      }
      if (empRaw.length === 0) {
        try {
          const all = await api.getEmployees();
          const rows = Array.isArray(all) ? all : [];
          empRaw = rows.filter((e: any) => String(e.company_id ?? e.company ?? '') === cid);
        } catch {
          empRaw = [];
        }
      }

      shiftRaw = await api.getShiftsForCompanyInRange({
        companyId: cid,
        rangeStart,
        rangeEnd,
      });

      const normalizedEmployees = (Array.isArray(empRaw) ? empRaw : [])
        .map((e: any) => {
          const fromRecord =
            e?.id ??
            e?.pk ??
            e?.uuid ??
            e?.employee_id ??
            (e?.employee && typeof e.employee === 'object' ? (e.employee as any).id : null);
          let id = String(fromRecord ?? '').trim();
          if (!id && e?.user_id != null) id = String(e.user_id).trim();
          return { ...e, id };
        })
        .filter((e: any) => String(e.id || '').trim() !== '');

      setEmployees(normalizedEmployees);
      setShifts((Array.isArray(shiftRaw) ? shiftRaw : []).map((s: any) => normalizeShiftRowForUi(s)));
    } catch (e) {
      console.warn(e);
      setEmployees([]);
      setShifts([]);
    }
  }, [selectedCompanyId, rangeStart, rangeEnd]);

  const loadScheduleTemplatesFromApi = useCallback(async (opts?: { bustCache?: boolean; dropTemplateIds?: string[] }) => {
    if (!selectedCompanyId) {
      setSavedTemplates([]);
      return;
    }
    const cid = String(selectedCompanyId);
    const orgName = selectedOrgName || 'Organization';
    const companyName = selectedCompanyName || 'Company';
    let rows: any[] = [];
    try {
      rows = await api.getScheduleTemplatesForCompany(cid, needsOrg ? selectedOrgId : null, opts?.bustCache === true);
    } catch (e) {
      console.warn('getScheduleTemplatesForCompany', e);
      rows = [];
    }

    let mapped: SavedWeekTemplate[] = [];
    for (const row of rows) {
      const m = mapScheduleTemplateApiToSaved(row, orgName, companyName, cid);
      if (m) mapped.push(m);
    }
    mapped.sort((a, b) => new Date(b.savedAtISO).getTime() - new Date(a.savedAtISO).getTime());
    if (opts?.dropTemplateIds?.length) {
      const drop = new Set(opts.dropTemplateIds.map((x) => String(x)));
      mapped = mapped.filter((m) => !drop.has(String(m.id)));
    }
    setSavedTemplates(mapped);
  }, [selectedCompanyId, selectedOrgName, selectedCompanyName, selectedOrgId, needsOrg]);

  const load = useCallback(async () => {
    if (!initialScheduleLoadDone.current) setLoading(true);
    await loadMeta();
    initialScheduleLoadDone.current = true;
    setLoading(false);
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!needsOrg || selectedOrgId || organizations.length !== 1) return;
    setSelectedOrgId(organizations[0].id);
  }, [needsOrg, selectedOrgId, organizations]);

  useEffect(() => {
    if (!needsOrg && companiesFiltered.length > 0 && !selectedCompanyId) {
      setSelectedCompanyId(companiesFiltered[0].id);
    }
  }, [needsOrg, companiesFiltered, selectedCompanyId]);

  useEffect(() => {
    if (needsOrg && selectedOrgId && companiesFiltered.length > 0 && !selectedCompanyId) {
      setSelectedCompanyId(companiesFiltered[0].id);
    }
  }, [needsOrg, selectedOrgId, companiesFiltered, selectedCompanyId]);

  useEffect(() => {
    if (needsOrg && !selectedOrgId) {
      setSelectedCompanyId(null);
      return;
    }
    if (!selectedCompanyId || companiesFiltered.length === 0) return;
    const stillValid = companiesFiltered.some((c) => c.id === selectedCompanyId);
    if (!stillValid) setSelectedCompanyId(null);
  }, [needsOrg, selectedOrgId, selectedCompanyId, companiesFiltered]);

  useEffect(() => {
    loadEmployeesAndShifts();
  }, [loadEmployeesAndShifts]);

  useEffect(() => {
    void loadScheduleTemplatesFromApi();
  }, [loadScheduleTemplatesFromApi]);

  const onRefresh = () => {
    setRefreshing(true);
    loadMeta()
      .then(() => Promise.all([loadEmployeesAndShifts(), loadScheduleTemplatesFromApi()]))
      .finally(() => setRefreshing(false));
  };

  const goPrevWeek = () => {
    const dayCount = customRangeEnd ? weekDays.length : 7;
    const d = new Date(weekAnchor);
    d.setDate(d.getDate() - dayCount);
    setWeekAnchor(d);
    if (customRangeEnd) {
      const ne = new Date(customRangeEnd);
      ne.setDate(ne.getDate() - dayCount);
      setCustomRangeEnd(ne);
    }
  };
  const goNextWeek = () => {
    const dayCount = customRangeEnd ? weekDays.length : 7;
    const d = new Date(weekAnchor);
    d.setDate(d.getDate() + dayCount);
    setWeekAnchor(d);
    if (customRangeEnd) {
      const ne = new Date(customRangeEnd);
      ne.setDate(ne.getDate() + dayCount);
      setCustomRangeEnd(ne);
    }
  };
  const goThisWeek = () => {
    setWeekAnchor(new Date());
    setCustomRangeEnd(null);
  };

  const applyDateRange = (start: Date, end: Date) => {
    setWeekAnchor(startOfDayLocal(start));
    setCustomRangeEnd(startOfDayLocal(end));
  };

  const useStandardWeekFromPicker = () => {
    setWeekAnchor(new Date());
    setCustomRangeEnd(null);
  };

  const openAddShift = (emp: Employee, day: Date) => {
    setShiftEmployee(emp);
    setShiftDay(day);
    setEditingShiftId(null);
    setShiftType('Morning (6am - 2pm)');
    const morning = SHIFT_TYPE_DEFAULT_TIMES['Morning (6am - 2pm)'];
    setShiftStart(morning.start);
    setShiftEnd(morning.end);
    setShiftBreakMin('30 minutes');
    setShiftCopyWeek(false);
    setShiftNotes('');
    setShiftDateInput(formatDateInput(day));
    setShiftDepartment(String((emp as any).department_name ?? (emp as any).department?.name ?? emp.department ?? ''));
    setShiftHourlyRate(String((emp as any).hourly_rate ?? ''));
    setShiftStatus('Scheduled');
    setShiftModalOpen(true);
  };

  const openEditShift = (emp: Employee, shift: any) => {
    const st = shift?.start_time ? new Date(shift.start_time) : new Date();
    const et = shift?.end_time ? new Date(shift.end_time) : new Date(st.getTime() + 8 * 60 * 60 * 1000);
    const breakMin = Number(shift?.break_duration_minutes ?? shift?.break_minutes ?? 0);
    setShiftEmployee(emp);
    setShiftDay(st);
    setEditingShiftId(String(shift?.id ?? shift?.pk ?? shift?.uuid ?? ''));
    setShiftType(normalizeShiftTypeForUi(String(shift?.shift_type ?? 'Morning (6am - 2pm)')));
    setShiftStart(toTime24(st));
    setShiftEnd(toTime24(et));
    setShiftBreakMin(breakMin > 0 ? `${breakMin} minutes` : 'No break');
    setShiftCopyWeek(false);
    setShiftNotes(String(shift?.notes ?? ''));
    setShiftDateInput(formatDateInput(st));
    setShiftDepartment(String((emp as any).department_name ?? (emp as any).department?.name ?? emp.department ?? ''));
    setShiftHourlyRate(String(shift?.hourly_rate ?? (emp as any).hourly_rate ?? ''));
    setShiftStatus(String(shift?.status ?? 'Scheduled'));
    setShiftModalOpen(true);
  };

  const openShiftTimePicker = (field: 'start' | 'end') => {
    Keyboard.dismiss();
    const raw = field === 'start' ? shiftStart : shiftEnd;
    const p = parseTimeInput(raw);
    setTimePickerHour(p?.hh ?? 0);
    setTimePickerMinute(p?.mm ?? 0);
    setTimePickerField(field);
  };

  const confirmShiftTimePicker = () => {
    const s = `${pad2(timePickerHour)}:${pad2(timePickerMinute)}`;
    if (timePickerField === 'start') setShiftStart(s);
    else if (timePickerField === 'end') setShiftEnd(s);
    setTimePickerField(null);
  };

  const submitShift = async () => {
    if (!shiftEmployee || !shiftDay || !selectedCompanyId) return;
    const baseDay = parseDateInput(shiftDateInput) || shiftDay;
    const range = computeStartEndForDay(baseDay, shiftStart, shiftEnd);
    if (!range) {
      Alert.alert('Validation', 'Use time format HH:mm for start and end.');
      return;
    }
    const { startAt, endAt } = range;
    const breakMin = parseFloat(String(shiftBreakMin).replace(/[^\d.]/g, '')) || 0;
    setShiftSaving(true);
    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[ScheduleScreen] submitShift', {
          editing: !!editingShiftId,
          companyId: selectedCompanyId,
          employeeId: shiftEmployee?.id,
          day: baseDay?.toISOString?.(),
          start: startAt.toISOString(),
          end: endAt.toISOString(),
        });
      }
      const clean = (obj: Record<string, any>) => {
        const out: Record<string, any> = {};
        Object.entries(obj).forEach(([k, v]) => {
          if (v != null && v !== '') out[k] = v;
        });
        return out;
      };
      const baseWrite = clean({
        company: selectedCompanyId,
        company_id: selectedCompanyId,
        employee: shiftEmployee.id,
        employee_id: shiftEmployee.id,
        start_time: startAt.toISOString(),
        end_time: endAt.toISOString(),
        break_duration_minutes: Number.isFinite(breakMin) ? breakMin : 0,
        break_duration: Number.isFinite(breakMin) ? breakMin : 0,
        notes: shiftNotes.trim() || undefined,
        shift_type: shiftType,
        hourly_rate: shiftHourlyRate.trim() || undefined,
      });
      const statusRaw = String(shiftStatus || '').trim();
      const statusVariants = Array.from(
        new Set([statusRaw, statusRaw.toLowerCase(), statusRaw.toUpperCase()].filter((x) => x))
      );
      const payloadAttempts = [
        baseWrite,
        ...statusVariants.map((s) => clean({ ...baseWrite, status: s })),
      ];

      const runCreateWithFallbacks = async (day: Date) => {
        const dayRange = computeStartEndForDay(day, shiftStart, shiftEnd);
        if (!dayRange) {
          throw new Error(
            'Could not build shift start/end for one of the selected days. Use HH:mm times and a valid date.'
          );
        }
        const { startAt: st, endAt: et } = dayRange;
        const cid = String(selectedCompanyId);
        const extras = clean({
          ...(Number.isFinite(breakMin) && breakMin > 0 ? { break_duration_minutes: breakMin } : {}),
          notes: shiftNotes.trim() || undefined,
          shift_type: shiftType,
          hourly_rate: shiftHourlyRate.trim() || undefined,
        });
        await api.createShiftWithFallbacks({
          companyId: cid,
          employeeId: String(shiftEmployee.id),
          startTimeIso: st.toISOString(),
          endTimeIso: et.toISOString(),
          extras,
          organizationId: resolveOrganizationIdForScheduler(),
        });
      };

      const runUpdateWithFallbacks = async () => {
        if (!editingShiftId) return;
        let lastErr: any = null;
        for (const payload of payloadAttempts) {
          try {
            await api.updateShift(editingShiftId, payload);
            return;
          } catch (e: any) {
            lastErr = e;
          }
        }
        throw lastErr || new Error('Failed to update shift');
      };

      if (editingShiftId) {
        await runUpdateWithFallbacks();
      } else {
        const targets = shiftCopyWeek ? weekDays : [baseDay];
        for (const day of targets) {
          await runCreateWithFallbacks(day);
        }
      }
      setShiftModalOpen(false);
      await loadEmployeesAndShifts();
    } catch (e: any) {
      Alert.alert(
        'Error',
        api.formatSchedulerApiError(e) ||
          (editingShiftId ? 'Failed to update shift' : 'Failed to create shift')
      );
    } finally {
      setShiftSaving(false);
    }
  };

  const deleteEditingShift = () => {
    if (!editingShiftId) return;
    const run = async () => {
      setShiftSaving(true);
      try {
        await api.deleteShift(editingShiftId);
        setShiftModalOpen(false);
        await loadEmployeesAndShifts();
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to delete shift');
      } finally {
        setShiftSaving(false);
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm('Delete this shift?')) void run();
      return;
    }
    Alert.alert('Delete shift', 'Delete this shift?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const today = new Date();
  const orgOptions = useMemo(
    () => organizations.map((o) => ({ id: o.id, label: o.name })),
    [organizations]
  );
  const companyOptions = useMemo(
    () => companiesFiltered.map((c) => ({ id: c.id, label: c.name })),
    [companiesFiltered]
  );

  const colWidth = isWide ? 112 : 96;
  const empColWidth = isWide ? 200 : 160;
  const currentWeekShifts = useMemo(() => {
    return shifts.filter((s) => {
      const st = s.start_time ? new Date(s.start_time) : null;
      if (!st || Number.isNaN(st.getTime())) return false;
      return st >= rangeStart && st <= rangeEnd;
    });
  }, [shifts, rangeStart, rangeEnd]);

  /**
   * Remove shifts from the builder, refresh lists, move date range to the next period (Save / Publish).
   * @param skipServerDelete — when saving a **weekly template**, do NOT DELETE shifts: templates often
   *   store `shift_ids` FKs to those rows; deleting them empties the template in the DB.
   */
  const removeWeekShiftsAndAdvance = async (
    weekShiftsSnapshot: any[],
    opts?: { skipServerDelete?: boolean }
  ): Promise<{ ok: true } | { ok: false; failures: number }> => {
    const deleteFailures: string[] = [];
    if (!opts?.skipServerDelete) {
      for (const s of weekShiftsSnapshot) {
        const sid = String(s.id ?? s.pk ?? s.uuid ?? '').trim();
        if (!sid) continue;
        try {
          await api.deleteShift(sid);
        } catch {
          deleteFailures.push(sid);
        }
      }
    }
    await loadScheduleTemplatesFromApi({ bustCache: true });
    if (!opts?.skipServerDelete && deleteFailures.length > 0) {
      return { ok: false, failures: deleteFailures.length };
    }
    goNextWeek();
    // `weekAnchor` change triggers the standard load effect; avoid duplicate fetches here.
    return { ok: true };
  };

  const handleSaveTemplate = async () => {
    if (!selectedCompanyId || saveTemplateLoading) return;
    if (currentWeekShifts.length === 0) {
      Alert.alert('Nothing to save', 'Add shifts to this week before saving as a template.');
      return;
    }

    const cid = String(selectedCompanyId);
    const weekShiftsSnapshot = currentWeekShifts;

    setSaveTemplateLoading(true);
    try {
      const orgId = resolveOrganizationIdForScheduler();
      const ensured = await api.ensureSchedulerShiftsPersisted({
        companyId: cid,
        organizationId: orgId,
        shifts: weekShiftsSnapshot,
      });
      await loadEmployeesAndShifts();
      await api.createScheduleTemplateWithFallbacks({
        companyId: cid,
        organizationId: orgId,
        rangeStart,
        rangeEnd,
        shifts: ensured,
      });

      await removeWeekShiftsAndAdvance(ensured, { skipServerDelete: true });
      Alert.alert(
        'Saved',
        'Schedule saved as a template. Moved to the next week — your shifts stay in the database for those dates (they are not deleted).'
      );
    } catch (e: any) {
      Alert.alert('Save failed', api.formatSchedulerApiError(e));
    } finally {
      setSaveTemplateLoading(false);
    }
  };

  const handlePublishTemplate = async () => {
    if (!selectedCompanyId || publishWeekLoading) return;
    if (currentWeekShifts.length === 0) {
      Alert.alert('Nothing to publish', 'Add shifts to this week before publishing.');
      return;
    }

    const weekShiftsSnapshot = currentWeekShifts;
    const cid = String(selectedCompanyId);
    const rs = rangeStart.toISOString();
    const re = rangeEnd.toISOString();
    const rsDate = rs.slice(0, 10);
    const reDate = re.slice(0, 10);
    const shiftIds = currentWeekShifts
      .map((s) => String(s.id ?? s.pk ?? s.uuid ?? '').trim())
      .filter(Boolean);

    const clean = (obj: Record<string, any>) => {
      const out: Record<string, any> = {};
      Object.entries(obj).forEach(([k, v]) => {
        if (v != null && v !== '') out[k] = v;
      });
      return out;
    };

    const attempts: Record<string, any>[] = [
      clean({
        company: cid,
        company_id: cid,
        start_date: rs,
        end_date: re,
      }),
      clean({
        company: cid,
        company_id: cid,
        start_date: rsDate,
        end_date: reDate,
      }),
      clean({
        company: cid,
        company_id: cid,
        week_start: rs,
        week_end: re,
      }),
      clean({
        company: cid,
        company_id: cid,
        start_time__gte: rs,
        start_time__lte: re,
      }),
    ];
    if (shiftIds.length) {
      attempts.push(
        clean({ company: cid, company_id: cid, shift_ids: shiftIds }),
        clean({ company: cid, company_id: cid, shifts: shiftIds })
      );
    }

    setPublishWeekLoading(true);
    let lastErr: any = null;
    try {
      for (const body of attempts) {
        if (Object.keys(body).length === 0) continue;
        try {
          await api.publishShiftsWeek(body);
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
        }
      }
      if (lastErr) throw lastErr;

      // Publishing should keep shifts in place so employees dashboards (which read `/scheduler/shifts/`)
      // can immediately reflect the published schedule. We only move the builder forward to the next week.
      Alert.alert(
        'Published',
        'Schedule published. Employees will see these shifts on their dashboard and calendar. The builder is moved to next week — add shifts there.'
      );
      goNextWeek();
    } catch (e: any) {
      const body = e?.body ?? e?.response?.data ?? e?.errors;
      const detail = body && typeof body === 'object' ? `\n${JSON.stringify(body).slice(0, 500)}` : '';
      Alert.alert('Publish failed', `${e?.message || 'Could not publish this week.'}${detail}`);
    } finally {
      setPublishWeekLoading(false);
    }
  };

  const handleClearWeek = async () => {
    if (!selectedCompanyId || currentWeekShifts.length === 0) return;
    const run = async () => {
      setLoading(true);
      try {
        for (const s of currentWeekShifts) {
          const id = String(s.id ?? s.pk ?? s.uuid ?? '');
          if (!id) continue;
          await api.deleteShift(id);
        }
        await loadEmployeesAndShifts();
        Alert.alert('Cleared', 'Week schedule cleared');
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to clear schedule');
      } finally {
        setLoading(false);
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm(`Clear all shifts for ${customRangeEnd ? 'this date range' : 'this week'}?`)) void run();
      return;
    }
    const period = customRangeEnd ? 'this date range' : 'this week';
    Alert.alert('Clear schedule', `Clear all shifts for ${period}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const handlePrint = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  };

  const handleDownload = () => {
    const lines = ['Employee,Start,End,Type,Status'];
    for (const s of currentWeekShifts) {
      lines.push(
        [
          String(s.employee_id ?? s.employee ?? ''),
          String(s.start_time ?? ''),
          String(s.end_time ?? ''),
          String(s.shift_type ?? ''),
          String(s.status ?? ''),
        ].join(',')
      );
    }
    const csv = lines.join('\n');
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schedule_${rangeStart.toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleDeleteSavedTemplate = (template: SavedWeekTemplate) => {
    const label = template.weekLabel || 'this schedule';
    const tid = String(template.id ?? '').trim();
    const run = async () => {
      let err: any = null;
      let deletedOk = false;
      try {
        await api.deleteScheduleTemplate(template.id, template.companyId, template.deleteEndpoint);
        deletedOk = true;
        setSavedTemplates((prev) => prev.filter((t) => String(t.id) !== tid));
      } catch (e: any) {
        // still refresh — template may already be gone, but show error if we can.
        err = e;
      }
      await loadScheduleTemplatesFromApi({
        bustCache: true,
        dropTemplateIds: deletedOk ? [tid] : undefined,
      });
      if (err) {
        Alert.alert('Delete failed', api.formatSchedulerApiError(err) || `Could not delete "${label}".`);
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm(`Delete saved template "${label}"?`)) void run();
      return;
    }
    Alert.alert('Delete saved schedule', `Delete "${label}"? This removes the template from the server.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const handleCopyTemplateToCurrentWeek = async (template: SavedWeekTemplate) => {
    if (!selectedCompanyId) return;
    const src = new Date(template.weekStartISO);
    const dst = new Date(rangeStart);
    const deltaMs = dst.getTime() - src.getTime();
    setLoading(true);
    try {
      for (const s of template.shifts) {
        const st = new Date(s.start_time);
        const et = s.end_time ? new Date(s.end_time) : null;
        const shiftedStart = new Date(st.getTime() + deltaMs);
        const shiftedEnd = et ? new Date(et.getTime() + deltaMs) : new Date(shiftedStart.getTime() + 8 * 60 * 60 * 1000);
        const br = Number(s.break_duration_minutes ?? 0) || 0;
        await api.createShiftWithFallbacks({
          companyId: String(selectedCompanyId),
          employeeId: String(s.employee),
          startTimeIso: shiftedStart.toISOString(),
          endTimeIso: shiftedEnd.toISOString(),
          extras: {
            ...(br > 0 ? { break_duration_minutes: br } : {}),
            notes: s.notes,
            shift_type: s.shift_type,
            hourly_rate: s.hourly_rate != null ? String(s.hourly_rate) : undefined,
          },
          organizationId: resolveOrganizationIdForScheduler(),
        });
      }
      await loadEmployeesAndShifts();
      Alert.alert('Copied', `Template copied to ${formatWeekToolbar(rangeStart, rangeEnd)}`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to copy template');
    } finally {
      setLoading(false);
    }
  };

  const toolbarActionButtons = (
    <>
      <TouchableOpacity style={styles.actionChip} onPress={() => setScheduleEditMode((v) => !v)}>
        <MaterialCommunityIcons name="pencil-outline" size={18} color="#0f172a" />
        <Text style={styles.actionChipText}>{scheduleEditMode ? 'Exit Edit' : 'Edit'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionChipPrimary} onPress={() => {}}>
        <Text style={styles.actionChipPrimaryText}>+ Duplicate</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionPlain} onPress={handlePrint}>
        <Text style={styles.actionPlainText}>Print</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionPlain} onPress={handleDownload}>
        <Text style={styles.actionPlainText}>Download</Text>
      </TouchableOpacity>
      {scheduleEditMode && (
        <>
          <TouchableOpacity style={styles.actionDangerChip} onPress={() => void handleClearWeek()}>
            <MaterialCommunityIcons name="trash-can-outline" size={16} color="#ef4444" />
            <Text style={styles.actionDangerText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionSaveChip, saveTemplateLoading && { opacity: 0.6 }]}
            onPress={() => void handleSaveTemplate()}
            disabled={saveTemplateLoading}
          >
            <MaterialCommunityIcons name="check" size={15} color="#0f172a" />
            <Text style={styles.actionSaveChipText}>{saveTemplateLoading ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionPublishChip, publishWeekLoading && { opacity: 0.6 }]}
            onPress={() => void handlePublishTemplate()}
            disabled={publishWeekLoading}
          >
            <Text style={styles.actionPublishChipText}>{publishWeekLoading ? 'Publishing…' : 'Publish'}</Text>
          </TouchableOpacity>
        </>
      )}
      <TouchableOpacity style={styles.iconBtn} hitSlop={8}>
        <MaterialCommunityIcons name="bell-outline" size={22} color="#0f172a" />
      </TouchableOpacity>
    </>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.mainCard}>
        <View style={styles.titleRow}>
          <View style={styles.titleLeft}>
            <MaterialCommunityIcons name="calendar-month" size={26} color="#2563eb" />
            <Text style={styles.pageTitle}>Schedule</Text>
          </View>
          <View style={styles.filtersRow}>
            {needsOrg && (
              <TouchableOpacity style={styles.selectBtn} onPress={() => setOrgModal(true)} activeOpacity={0.8}>
                <Text style={styles.selectBtnText} numberOfLines={1}>
                  {selectedOrgId ? selectedOrgName || 'Organization' : 'Select organization'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.selectBtn, needsOrg && !selectedOrgId && styles.selectBtnMuted]}
              onPress={() => {
                if (needsOrg && !selectedOrgId) return;
                if (companiesFiltered.length === 0) return;
                setCompanyModal(true);
              }}
              activeOpacity={0.8}
              disabled={needsOrg && !selectedOrgId}
            >
              <Text style={[styles.selectBtnText, needsOrg && !selectedOrgId && styles.mutedText]} numberOfLines={1}>
                {needsOrg && !selectedOrgId
                  ? 'Select organization first'
                  : companiesFiltered.length === 0 && selectedOrgId
                    ? 'No companies in this organization'
                    : selectedCompanyId
                      ? selectedCompanyName || 'Company'
                      : 'Select company'}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.toolbarInner}>
          <View style={[styles.toolbarTop, compactToolbar && styles.toolbarTopCompact]}>
            {compactToolbar ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateNavScroll}>
                <View style={styles.dateNav}>
                  <TouchableOpacity onPress={goPrevWeek} style={styles.iconBtn} hitSlop={8}>
                    <MaterialCommunityIcons name="chevron-left" size={22} color="#0f172a" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dateRangePressable}
                    onPress={() => setRangePickerOpen(true)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="calendar-range" size={18} color="#2563eb" />
                    <Text style={styles.dateRangeText}>{formatWeekToolbar(rangeStart, rangeEnd)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={goNextWeek} style={styles.iconBtn} hitSlop={8}>
                    <MaterialCommunityIcons name="chevron-right" size={22} color="#0f172a" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={goThisWeek} style={styles.iconBtn} hitSlop={8}>
                    <MaterialCommunityIcons name="calendar-today" size={22} color="#2563eb" />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : (
              <View style={styles.dateNav}>
                <TouchableOpacity onPress={goPrevWeek} style={styles.iconBtn} hitSlop={8}>
                  <MaterialCommunityIcons name="chevron-left" size={22} color="#0f172a" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dateRangePressable}
                  onPress={() => setRangePickerOpen(true)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="calendar-range" size={18} color="#2563eb" />
                  <Text style={styles.dateRangeText}>{formatWeekToolbar(rangeStart, rangeEnd)}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={goNextWeek} style={styles.iconBtn} hitSlop={8}>
                  <MaterialCommunityIcons name="chevron-right" size={22} color="#0f172a" />
                </TouchableOpacity>
                <TouchableOpacity onPress={goThisWeek} style={styles.iconBtn} hitSlop={8}>
                  <MaterialCommunityIcons name="calendar-today" size={22} color="#2563eb" />
                </TouchableOpacity>
              </View>
            )}
            {compactToolbar ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.actionBtnsScroll}
                contentContainerStyle={styles.actionBtnsCompact}
              >
                {toolbarActionButtons}
              </ScrollView>
            ) : (
              <View style={styles.actionBtns}>{toolbarActionButtons}</View>
            )}
          </View>
        </View>

        {!selectedCompanyId ? (
          <View style={styles.emptyInner}>
            <Text style={styles.emptyText}>
              {needsOrg && !selectedOrgId
                ? 'Select an organization, then a company, to view and build employee schedules.'
                : 'Select a company to view the schedule.'}
            </Text>
          </View>
        ) : (
          <View style={styles.tableWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
              <View style={styles.table}>
                <View style={[styles.tr, styles.trHeader]}>
                  <View style={[styles.thEmp, { width: empColWidth }]}>
                    <Text style={styles.thText}>Employee</Text>
                  </View>
                  {weekDays.map((day, idx) => {
                    const isToday = sameCalendarDay(day, today);
                    return (
                      <KeyedFragment key={`h-${idx}`}>
                        <View style={[styles.thDay, { width: colWidth }, ...(isToday ? [styles.colToday] : [])]}>
                          <Text style={[styles.thDayMain, ...(isToday ? [styles.thDayMainToday] : [])]}>
                            {day.toLocaleDateString(undefined, { weekday: 'short' })} {day.getDate()}
                          </Text>
                        </View>
                      </KeyedFragment>
                    );
                  })}
                </View>

                {employees.length === 0 ? (
                  <View style={styles.emptyRow}>
                    <Text style={styles.emptyTextBold}>No employees found.</Text>
                    <Text style={styles.emptySubtext}>Add employees to this company to start scheduling shifts.</Text>
                  </View>
                ) : (
                  employees.map((emp) => (
                    <KeyedView key={emp.id} style={styles.tr}>
                      <View style={[styles.tdEmp, { width: empColWidth }]}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>{initials(emp)}</Text>
                        </View>
                        <View style={styles.empMeta}>
                          <Text style={styles.empName} numberOfLines={1}>
                            {employeeDisplayName(emp)}
                          </Text>
                          <Text style={styles.empRole} numberOfLines={1}>
                            {employeeRoleLabel(emp)}
                          </Text>
                        </View>
                      </View>
                      {weekDays.map((day, idx) => {
                        const isToday = sameCalendarDay(day, today);
                        const cellShifts = shifts.filter((s) => {
                          const sid = String(s.employee_id ?? s.employee ?? '');
                          if (sid !== String(emp.id)) return false;
                          const st = s.start_time ? new Date(s.start_time) : null;
                          return !!st && !Number.isNaN(st.getTime()) && sameCalendarDay(st, day);
                        });
                        return (
                          <KeyedFragment key={`${emp.id}-${idx}`}>
                            <View
                              style={[styles.tdCell, { width: colWidth }, ...(isToday ? [styles.colToday] : [])]}
                            >
                              {cellShifts.length === 0 ? (
                                scheduleEditMode ? (
                                  <TouchableOpacity style={styles.addShiftCellBtn} onPress={() => openAddShift(emp, day)}>
                                    <MaterialCommunityIcons name="plus" size={14} color="#0f172a" />
                                    <Text style={styles.addShiftCellText}>Add Shift</Text>
                                  </TouchableOpacity>
                                ) : (
                                  <Text style={styles.cellText}>-</Text>
                                )
                              ) : (
                                <View style={styles.shiftCellStack}>
                                  {cellShifts.map((s, i) => {
                                    const st = s.start_time ? new Date(s.start_time) : null;
                                    const et = s.end_time ? new Date(s.end_time) : null;
                                    const t1 = st
                                      ? st.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                                      : '—';
                                    const t2 = et
                                      ? et.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                                      : '';
                                    return (
                                      <TouchableOpacity
                                        key={`${emp.id}-${idx}-${i}`}
                                        style={styles.shiftCellCard}
                                        activeOpacity={scheduleEditMode ? 0.88 : 1}
                                        onPress={() => scheduleEditMode && openEditShift(emp, s)}
                                      >
                                        <Text style={styles.shiftCellTime}>
                                          {t2 ? `${t1} - ${t2}` : t1}
                                        </Text>
                                        <TouchableOpacity style={styles.shiftAddTaskRow}>
                                          <MaterialCommunityIcons name="format-list-checks" size={12} color="#64748b" />
                                          <Text style={styles.shiftAddTaskText}>Add Task</Text>
                                        </TouchableOpacity>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          </KeyedFragment>
                        );
                      })}
                    </KeyedView>
                  ))
                )}
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      {selectedCompanyId ? (
        <View style={styles.savedCard}>
          <Text style={styles.savedTitle}>
            All Schedules
            {selectedOrgName ? ` — ${selectedOrgName}` : ''} · {selectedCompanyName || 'Company'}
          </Text>
          <Text style={styles.savedSubtitle}>Saved schedules for {selectedCompanyName || 'this company'}.</Text>
          {savedTemplates.filter((t) => t.companyId === String(selectedCompanyId)).length === 0 ? (
            <View style={styles.savedEmpty}>
              <MaterialCommunityIcons name="calendar-blank-outline" size={48} color="#cbd5e1" />
              <Text style={styles.savedEmptyText}>No saved schedules yet.</Text>
              <Text style={styles.savedEmptyHint}>Click Save to create a schedule template card here.</Text>
            </View>
          ) : (
            <View style={styles.savedList}>
              {savedTemplates
                .filter((t) => t.companyId === String(selectedCompanyId))
                .map((t) => (
                  <View key={t.id} style={styles.savedItemCard}>
                    <Text style={styles.savedItemTitle}>{t.weekLabel}</Text>
                    <Text style={styles.savedItemMeta}>{t.published ? 'Published schedule' : 'Saved schedule'}</Text>
                    <Text style={styles.savedItemMeta2}>
                      Saved: {new Date(t.savedAtISO).toLocaleDateString()} · {t.shiftCount} shifts
                    </Text>
                    <View style={styles.savedItemActions}>
                      <View style={styles.savedEditDeleteRow}>
                        <TouchableOpacity
                          style={styles.savedEditBtn}
                          onPress={() => {
                            const ws = new Date(t.weekStartISO);
                            const we = new Date(t.weekEndISO);
                            ws.setHours(0, 0, 0, 0);
                            we.setHours(0, 0, 0, 0);
                            setWeekAnchor(ws);
                            setCustomRangeEnd(isStandardMondaySundayWeek(ws, we) ? null : we);
                            setScheduleEditMode(true);
                          }}
                        >
                          <MaterialCommunityIcons name="pencil-outline" size={14} color="#fff" />
                          <Text style={styles.savedEditBtnText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.savedDeleteBtn}
                          onPress={() => void handleDeleteSavedTemplate(t)}
                          accessibilityLabel="Delete saved schedule"
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#475569" />
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={styles.savedCopyBtn}
                        onPress={() => void handleCopyTemplateToCurrentWeek(t)}
                      >
                        <MaterialCommunityIcons name="content-copy" size={14} color="#334155" />
                        <Text style={styles.savedCopyBtnText}>
                          Copy to {formatWeekToolbar(rangeStart, rangeEnd).replace(' – ', ' - ')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
            </View>
          )}
        </View>
      ) : null}

      <PickerModal
        visible={orgModal}
        title="Select organization"
        options={orgOptions}
        onSelect={(id) => {
          setSelectedOrgId(id);
          setSelectedCompanyId(null);
        }}
        onClose={() => setOrgModal(false)}
      />
      <PickerModal
        visible={companyModal}
        title="Select company"
        options={companyOptions}
        onSelect={(id) => setSelectedCompanyId(id)}
        onClose={() => setCompanyModal(false)}
      />

      <Modal visible={shiftModalOpen} transparent animationType="fade" onRequestClose={() => !shiftSaving && setShiftModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.shiftModalOverlay}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !shiftSaving && setShiftModalOpen(false)} />
          <View
            style={[
              styles.shiftModalCard,
              {
                maxHeight: Math.min(640, height * 0.9),
                width: Math.min(width - 32, 480),
              },
            ]}
          >
            <View style={styles.shiftModalHead}>
              <Text style={styles.modalTitleNoBorder}>{editingShiftId ? 'Edit Shift' : 'Add Shift'}</Text>
              <TouchableOpacity onPress={() => !shiftSaving && setShiftModalOpen(false)} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.shiftModalScroll}
              contentContainerStyle={styles.shiftModalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.shiftMetaBox}>
                <Text style={styles.shiftMetaName}>
                  {shiftEmployee ? `${employeeDisplayName(shiftEmployee)} —` : 'Employee —'}
                </Text>
                <Text style={styles.shiftMetaDate}>
                  {shiftDay
                    ? shiftDay.toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : ''}
                </Text>
              </View>
              <View style={styles.shiftRow2}>
                <View style={styles.shiftCol}>
                  <Text style={styles.shiftLbl}>Employee *</Text>
                  <View style={styles.shiftSelectStatic}>
                    <Text style={styles.shiftSelectText} numberOfLines={1}>
                      {shiftEmployee ? employeeDisplayName(shiftEmployee) : 'Select employee'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color="#94a3b8" />
                  </View>
                </View>
                <View style={styles.shiftCol}>
                  <Text style={styles.shiftLbl}>Department</Text>
                  <View style={styles.shiftSelectStatic}>
                    <Text style={[styles.shiftSelectText, !shiftDepartment && styles.mutedText]} numberOfLines={1}>
                      {shiftDepartment || 'Select department'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={20} color="#94a3b8" />
                  </View>
                </View>
              </View>

              <Text style={styles.shiftLbl}>Date *</Text>
              <View style={styles.timeInputWrap}>
                <TextInput
                  style={styles.timeInput}
                  value={shiftDateInput}
                  onChangeText={setShiftDateInput}
                  placeholder="dd-mm-yyyy"
                />
                <MaterialCommunityIcons name="calendar-month-outline" size={18} color="#94a3b8" />
              </View>

              <Text style={styles.shiftLbl}>Shift Type</Text>
              <TouchableOpacity
                style={styles.shiftSelect}
                onPress={() => !shiftSaving && setShiftTypePickerOpen(true)}
                activeOpacity={0.85}
                disabled={shiftSaving}
              >
                <Text style={styles.shiftSelectText} numberOfLines={1}>
                  {shiftType}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
              </TouchableOpacity>
              <View style={styles.shiftRow2}>
                <View style={styles.shiftCol}>
                  <Text style={styles.shiftLbl}>Start Time</Text>
                  <View style={styles.timeInputWrap}>
                    <TextInput
                      style={styles.timeInput}
                      value={shiftStart}
                      onChangeText={setShiftStart}
                      placeholder="06:00"
                    />
                    <TouchableOpacity
                      onPress={() => !shiftSaving && openShiftTimePicker('start')}
                      disabled={shiftSaving}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Open start time picker"
                    >
                      <MaterialCommunityIcons name="clock-outline" size={18} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.shiftCol}>
                  <Text style={styles.shiftLbl}>End Time</Text>
                  <View style={styles.timeInputWrap}>
                    <TextInput
                      style={styles.timeInput}
                      value={shiftEnd}
                      onChangeText={setShiftEnd}
                      placeholder="14:00"
                    />
                    <TouchableOpacity
                      onPress={() => !shiftSaving && openShiftTimePicker('end')}
                      disabled={shiftSaving}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Open end time picker"
                    >
                      <MaterialCommunityIcons name="clock-outline" size={18} color="#64748b" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              <Text style={styles.shiftLbl}>Break Duration (minutes)</Text>
              <TouchableOpacity
                style={styles.shiftSelect}
                onPress={() => !shiftSaving && setShiftBreakPickerOpen(true)}
                activeOpacity={0.85}
                disabled={shiftSaving}
              >
                <Text style={styles.shiftSelectText} numberOfLines={1}>
                  {shiftBreakMin}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
              </TouchableOpacity>
              {!editingShiftId ? (
                <TouchableOpacity
                  style={styles.copyShiftCard}
                  onPress={() => setShiftCopyWeek((v) => !v)}
                  activeOpacity={0.85}
                  disabled={shiftSaving}
                >
                  <View style={[styles.copyBox, shiftCopyWeek && styles.copyBoxOn]}>
                    {shiftCopyWeek ? <MaterialCommunityIcons name="check" size={12} color="#fff" /> : null}
                  </View>
                  <MaterialCommunityIcons name="content-copy" size={16} color="#64748b" />
                  <Text style={styles.copyShiftText}>Copy this shift to other days</Text>
                </TouchableOpacity>
              ) : null}

              <Text style={styles.shiftLbl}>Hourly Rate</Text>
              <TextInput
                style={styles.shiftInput}
                value={shiftHourlyRate}
                onChangeText={setShiftHourlyRate}
                keyboardType="decimal-pad"
                placeholder="15.00"
              />

              <Text style={styles.shiftLbl}>Status</Text>
              <TouchableOpacity
                style={styles.shiftSelect}
                onPress={() => !shiftSaving && setShiftStatusPickerOpen(true)}
                activeOpacity={0.85}
                disabled={shiftSaving}
              >
                <Text style={styles.shiftSelectText} numberOfLines={1}>
                  {shiftStatus}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
              </TouchableOpacity>
              <Text style={styles.shiftLbl}>Notes (optional)</Text>
              <TextInput
                style={styles.shiftNotesInput}
                value={shiftNotes}
                onChangeText={setShiftNotes}
                placeholder="Any special instructions..."
                placeholderTextColor="#94a3b8"
                multiline
              />
            </ScrollView>
            <View style={styles.shiftModalFooter}>
              {editingShiftId ? (
                <TouchableOpacity style={styles.shiftDeleteBtn} onPress={deleteEditingShift} disabled={shiftSaving}>
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                  <Text style={styles.shiftDeleteText}>Delete</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.shiftCancelBtn}
                onPress={() => !shiftSaving && setShiftModalOpen(false)}
                disabled={shiftSaving}
              >
                <Text style={styles.shiftCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.shiftSaveBtn, shiftSaving && styles.shiftBtnDisabled]}
                onPress={() => void submitShift()}
                disabled={shiftSaving}
              >
                <Text style={styles.shiftSaveText}>
                  {shiftSaving ? 'Saving…' : editingShiftId ? 'Update Shift' : 'Add Shift'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={timePickerField !== null && shiftModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTimePickerField(null)}
      >
        <View style={styles.timePickerOverlay}>
          <Pressable style={styles.timePickerBackdrop} onPress={() => setTimePickerField(null)} />
          <View style={[styles.timePickerCenter, { pointerEvents: 'box-none' }]}>
            <View style={[styles.timePickerSheet, { pointerEvents: 'auto' }]}>
              <Text style={styles.timePickerSheetTitle}>
                {timePickerField === 'start' ? 'Start time' : 'End time'}
              </Text>
              <View style={styles.timePickerColumns}>
                <ScrollView style={styles.timePickerColumn} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
                  {TIME_PICKER_HOURS.map((h) => (
                    <TouchableOpacity
                      key={`h-${h}`}
                      style={[styles.timePickerOption, timePickerHour === h && styles.timePickerOptionSelected]}
                      onPress={() => setTimePickerHour(h)}
                    >
                      <Text
                        style={[
                          styles.timePickerOptionText,
                          timePickerHour === h && styles.timePickerOptionTextSelected,
                        ]}
                      >
                        {pad2(h)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <ScrollView
                  style={[styles.timePickerColumn, styles.timePickerColumnRight]}
                  showsVerticalScrollIndicator
                  keyboardShouldPersistTaps="handled"
                >
                  {TIME_PICKER_MINUTES.map((m) => (
                    <TouchableOpacity
                      key={`m-${m}`}
                      style={[styles.timePickerOption, timePickerMinute === m && styles.timePickerOptionSelected]}
                      onPress={() => setTimePickerMinute(m)}
                    >
                      <Text
                        style={[
                          styles.timePickerOptionText,
                          timePickerMinute === m && styles.timePickerOptionTextSelected,
                        ]}
                      >
                        {pad2(m)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.timePickerFooter}>
                <TouchableOpacity style={styles.timePickerBtnGhost} onPress={() => setTimePickerField(null)}>
                  <Text style={styles.timePickerBtnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.timePickerBtnPrimary} onPress={confirmShiftTimePicker}>
                  <Text style={styles.timePickerBtnPrimaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <PickerModal
        visible={shiftTypePickerOpen}
        title="Shift Type"
        options={SHIFT_TYPE_PICKER_OPTIONS}
        onSelect={(id) => {
          setShiftType(id);
          const def = SHIFT_TYPE_DEFAULT_TIMES[id];
          if (def) {
            setShiftStart(def.start);
            setShiftEnd(def.end);
          }
        }}
        onClose={() => setShiftTypePickerOpen(false)}
      />
      <PickerModal
        visible={shiftBreakPickerOpen}
        title="Break Duration"
        options={BREAK_PICKER_OPTIONS}
        onSelect={(id) => setShiftBreakMin(id)}
        onClose={() => setShiftBreakPickerOpen(false)}
      />
      <PickerModal
        visible={shiftStatusPickerOpen}
        title="Status"
        options={STATUS_PICKER_OPTIONS}
        onSelect={(id) => setShiftStatus(id)}
        onClose={() => setShiftStatusPickerOpen(false)}
      />

      <ScheduleDateRangeModal
        visible={rangePickerOpen}
        onClose={() => setRangePickerOpen(false)}
        onApply={(s, e) => applyDateRange(s, e)}
        onUseStandardWeek={useStandardWeekFromPicker}
        initialCursorMonth={rangeStart}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f1f5f9' },
  pageContent: { paddingBottom: 48, paddingTop: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  mainCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)' },
      default: {
        elevation: 2,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
    }),
  },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  titleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#0f172a', letterSpacing: -0.3 },
  filtersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 140,
    maxWidth: 220,
  },
  selectBtnMuted: { opacity: 0.7 },
  selectBtnText: { flex: 1, fontSize: 13, color: '#0f172a', fontWeight: '500' },
  mutedText: { color: '#94a3b8' },
  toolbarInner: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  toolbarTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toolbarTopCompact: { flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', gap: 8 },
  dateNavScroll: { width: '100%' },
  dateNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateRangePressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    maxWidth: 220,
  },
  dateRangeText: { fontSize: 15, fontWeight: '600', color: '#0f172a', flexShrink: 1 },
  rangePickModalBox: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rangePickTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  rangePickHint: { fontSize: 13, color: '#64748b', marginTop: 6, marginBottom: 12 },
  rangePickMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  rangePickMonthTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  rangePickWeekHead: { flexDirection: 'row', marginBottom: 6 },
  rangePickWeekHeadCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  rangePickGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  rangePickCell: {
    width: '14.28%',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  rangePickCellSel: { borderWidth: 2, borderColor: '#2563eb', borderRadius: 8 },
  rangePickCellToday: { backgroundColor: '#e2e8f0', borderRadius: 999 },
  rangePickCellTxt: { fontSize: 14, color: '#0f172a', fontWeight: '500' },
  rangePickCellTxtSel: { fontWeight: '700' },
  rangePickFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    gap: 8,
  },
  rangePickLink: { fontSize: 14, fontWeight: '600', color: '#2563eb' },
  rangePickCloseBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  rangePickCloseBtnText: { fontSize: 15, fontWeight: '600', color: '#475569' },
  iconBtn: { padding: 4 },
  actionBtns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  actionBtnsScroll: { flexGrow: 0, flexShrink: 1, maxWidth: '100%' },
  actionBtnsCompact: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 6 },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  actionChipText: { fontSize: 13, fontWeight: '500', color: '#0f172a' },
  actionChipPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  actionChipPrimaryText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  actionPlain: { paddingHorizontal: 8, paddingVertical: 6 },
  actionPlainText: { fontSize: 13, fontWeight: '500', color: '#475569' },
  /** Same row layout as actionSaveChip / actionChip so icon + label stay aligned on web. */
  actionDangerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff',
  },
  actionDangerText: { fontSize: 13, fontWeight: '500', color: '#ef4444' },
  actionSaveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  actionSaveChipText: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  actionPublishChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  actionPublishChipText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  tableWrap: { backgroundColor: '#fff' },
  tableScroll: { marginHorizontal: 0 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#e2e8f0' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  trHeader: { backgroundColor: '#f8fafc' },
  thEmp: { padding: 12, justifyContent: 'center', borderRightWidth: 1, borderColor: '#e2e8f0' },
  thText: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  thDay: { padding: 12, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: '#e2e8f0' },
  colToday: { backgroundColor: '#eff6ff' },
  thDayMain: { fontSize: 13, fontWeight: '600', color: '#0f172a', textAlign: 'center' },
  thDayMainToday: { color: '#1d4ed8', fontWeight: '700' },
  tdEmp: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
    borderRightWidth: 1,
    borderColor: '#e2e8f0',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  empMeta: { flex: 1, minWidth: 0 },
  empName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  empRole: { fontSize: 12, color: '#64748b', marginTop: 2 },
  tdCell: {
    padding: 10,
    borderRightWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    minHeight: 64,
  },
  cellText: { fontSize: 13, color: '#64748b', textAlign: 'center' },
  emptyInner: { paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center', minHeight: 200, justifyContent: 'center' },
  emptyRow: { padding: 28, width: '100%', alignItems: 'center' },
  emptyText: { fontSize: 15, color: '#64748b', textAlign: 'center', lineHeight: 22 },
  emptyTextBold: { fontSize: 15, fontWeight: '600', color: '#475569', textAlign: 'center' },
  emptySubtext: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginTop: 6, paddingHorizontal: 16 },
  savedCard: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)' },
      default: { elevation: 1 },
    }),
  },
  savedTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  savedSubtitle: { fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 16 },
  savedEmpty: { alignItems: 'center', paddingVertical: 28 },
  savedEmptyText: { fontSize: 15, fontWeight: '500', color: '#64748b', marginTop: 12 },
  savedEmptyHint: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 6, paddingHorizontal: 12 },
  savedList: { gap: 10, marginTop: 4 },
  savedItemCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
    maxWidth: 320,
  },
  savedItemTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  savedItemMeta: { marginTop: 4, fontSize: 13, color: '#64748b' },
  savedItemMeta2: { marginTop: 4, fontSize: 12, color: '#94a3b8' },
  savedItemActions: { marginTop: 10, gap: 8 },
  savedEditDeleteRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  savedEditBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#3b5bdb',
    borderRadius: 8,
    paddingVertical: 8,
    minHeight: 40,
  },
  savedDeleteBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  savedEditBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  savedCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
  },
  savedCopyBtnText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
    zIndex: 2,
  },
  shiftModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  shiftModalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    zIndex: 2,
    flexDirection: 'column',
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(15, 23, 42, 0.18)' },
      default: {
        elevation: 12,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
    }),
  },
  shiftModalScroll: { flexGrow: 1, flexShrink: 1, minHeight: 80 },
  shiftModalScrollContent: { paddingBottom: 8 },
  shiftCol: { flex: 1, minWidth: 0 },
  modalTitle: { fontSize: 16, fontWeight: '700', padding: 16, borderBottomWidth: 1, borderColor: '#e2e8f0' },
  modalRow: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  modalRowText: { fontSize: 15, color: '#0f172a' },

  shiftCellStack: { width: '100%', gap: 6 },
  shiftCellCard: {
    borderWidth: 1,
    borderColor: '#dbe3f2',
    backgroundColor: '#f5f7ff',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 4,
  },
  shiftCellTime: { fontSize: 11, color: '#334155', textAlign: 'center' },
  shiftAddTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shiftAddTaskText: { fontSize: 11, color: '#64748b' },
  addShiftCellBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4 },
  addShiftCellText: { fontSize: 12, color: '#0f172a', fontWeight: '500' },

  modalTitleNoBorder: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  shiftModalHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  shiftMetaBox: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  shiftMetaName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  shiftMetaDate: { fontSize: 14, color: '#64748b', marginTop: 4 },
  shiftLbl: { marginHorizontal: 16, marginTop: 14, marginBottom: 8, fontSize: 14, fontWeight: '600', color: '#0f172a' },
  shiftSelect: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shiftSelectStatic: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shiftSelectText: { flex: 1, fontSize: 14, color: '#0f172a', marginRight: 8 },
  shiftInput: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  shiftRow2: { flexDirection: 'row', gap: 12, marginHorizontal: 16 },
  timeInputWrap: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  timeInput: { flex: 1, fontSize: 14, color: '#0f172a', paddingVertical: Platform.OS === 'web' ? 8 : 10 },
  copyShiftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    backgroundColor: '#fafafa',
  },
  copyBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  copyBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  copyShiftText: { flex: 1, fontSize: 14, color: '#334155' },
  shiftNotesInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 88,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#fff',
    textAlignVertical: 'top',
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
      default: {},
    }),
  },
  shiftModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  shiftCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  shiftCancelText: { fontSize: 14, color: '#0f172a', fontWeight: '500' },
  shiftSaveBtn: { backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20 },
  shiftSaveText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  shiftDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#ef4444',
  },
  shiftDeleteText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  shiftBtnDisabled: { opacity: 0.6 },

  timePickerOverlay: { flex: 1 },
  timePickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  timePickerCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  timePickerSheet: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    ...Platform.select({
      web: { boxShadow: '0 12px 40px rgba(15, 23, 42, 0.18)' },
      default: {
        elevation: 12,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
    }),
  },
  timePickerSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
    textAlign: 'center',
  },
  timePickerColumns: {
    flexDirection: 'row',
    height: 220,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  timePickerColumn: { flex: 1 },
  timePickerColumnRight: { borderLeftWidth: 1, borderLeftColor: '#e2e8f0' },
  timePickerOption: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePickerOptionSelected: { backgroundColor: '#e2e8f0' },
  timePickerOptionText: { fontSize: 15, color: '#334155' },
  timePickerOptionTextSelected: { fontWeight: '700', color: '#0f172a' },
  timePickerFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    alignItems: 'center',
  },
  timePickerBtnGhost: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  timePickerBtnGhostText: { fontSize: 14, color: '#0f172a', fontWeight: '500' },
  timePickerBtnPrimary: { backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18 },
  timePickerBtnPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
