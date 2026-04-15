import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { getPrimaryRoleFromUser } from '../types/auth';
import * as api from '../api';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

type GridCell = {
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
};

function buildMonthGrid(anchorMonth: Date, today: Date): GridCell[][] {
  const first = startOfMonth(anchorMonth);
  const lead = first.getDay();
  const year = first.getFullYear();
  const month = first.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: GridCell[] = [];
  const prevMonthLast = new Date(year, month, 0).getDate();
  for (let i = 0; i < lead; i++) {
    const day = prevMonthLast - lead + i + 1;
    const date = new Date(year, month - 1, day);
    cells.push({ date, inCurrentMonth: false, isToday: isSameDay(date, today) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ date, inCurrentMonth: true, isToday: isSameDay(date, today) });
  }
  const remainder = cells.length % 7;
  const trail = remainder === 0 ? 0 : 7 - remainder;
  for (let i = 1; i <= trail; i++) {
    const date = new Date(year, month + 1, i);
    cells.push({ date, inCurrentMonth: false, isToday: isSameDay(date, today) });
  }

  const rows: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

/** Heuristic: calendar row mirrors a scheduler shift (not a generic task/event). */
function isShiftLikeCalendarEvent(ev: any): boolean {
  const t = String(ev?.event_type ?? ev?.type ?? '').toLowerCase();
  if (t.includes('shift')) return true;
  const title = String(ev?.title ?? '').trim().toLowerCase();
  if (title === 'shift') return true;
  if (ev?.employee != null || ev?.employee_id != null) return true;
  if (ev?.scheduler_shift != null || ev?.shift_id != null || ev?.shift != null) return true;
  return false;
}

function idFromRelation(v: any): string {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && (v as any).id != null) return String((v as any).id).trim();
  return String(v).trim();
}

function calendarEventAssignedToUser(ev: any, userId: string): boolean {
  const uid = String(userId).trim();
  if (!uid) return false;
  const candidates = [
    idFromRelation(ev.user),
    idFromRelation((ev as any).user_id),
    idFromRelation(ev.assigned_user),
    idFromRelation((ev as any).assigned_user_id),
    idFromRelation(ev.assignee),
    idFromRelation((ev as any).assignee_id),
    idFromRelation((ev as any).owner),
  ];
  return candidates.some((c) => c !== '' && c === uid);
}

/** Hide other people’s shift mirrors on calendars that are not meant to be team schedules. */
function filterShiftLikeEventsToAssignee(events: any[], userId: string | undefined, role: string | null): any[] {
  const list = Array.isArray(events) ? events : [];
  if (!userId) return list;
  if (role && ['super_admin', 'organization_manager'].includes(role)) return list;
  const trustApiUserScope = role === 'employee';
  return list.filter((ev) => {
    if (!isShiftLikeCalendarEvent(ev)) return true;
    if (calendarEventAssignedToUser(ev, userId)) return true;
    if (trustApiUserScope) {
      const hasAssigneeHint = [
        idFromRelation(ev.user),
        idFromRelation((ev as any).user_id),
        idFromRelation(ev.assigned_user),
        idFromRelation((ev as any).assigned_user_id),
        idFromRelation(ev.assignee),
        idFromRelation((ev as any).assignee_id),
      ].some((c) => c !== '');
      if (!hasAssigneeHint) return true;
    }
    return false;
  });
}

export default function CalendarScreen() {
  const { user, role } = useAuth();
  const effectiveRole = role ?? (user ? getPrimaryRoleFromUser(user) : null);
  const { width } = useWindowDimensions();
  const [events, setEvents] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  });

  /** Staff + company managers: resolve scheduler employee and load that person’s shifts (not org-wide). */
  const loadOwnEmployeeShifts = ['employee', 'company_manager'].includes(effectiveRole || '');

  const load = useCallback(async () => {
    try {
      let empId: string | null = null;
      let empCompanyId: string | undefined;
      let empUserId: string | undefined;
      if (!loadOwnEmployeeShifts) {
        setEmployeeId(null);
      }
      if (loadOwnEmployeeShifts && user?.id) {
        let emp = await api.findSchedulerEmployeeForAuthUser(user);
        if (!emp) {
          try {
            const fresh = await api.getCurrentUser();
            if (fresh && typeof fresh === 'object') {
              emp = await api.findSchedulerEmployeeForAuthUser({ ...user, ...(fresh as object) });
            }
          } catch {
            /* ignore */
          }
        }
        empId = emp != null ? String((emp as any).id ?? (emp as any).pk ?? '').trim() || null : null;
        empCompanyId = api.companyIdFromSchedulerEmployee(emp, user);
        empUserId = String((emp as any).user_id ?? (emp as any).user?.id ?? user?.id ?? '').trim() || undefined;
        setEmployeeId(empId);
      }
      const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      const monthEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0, 23, 59, 59);
      const [eventsRaw, shiftsRaw] = await Promise.all([
        api.getCalendarEvents({
          user: user?.id,
          start_time__gte: monthStart.toISOString(),
          end_time__lte: monthEnd.toISOString(),
        }),
        empId
          ? api.getShiftsForEmployeeInRange({
              employeeId: empId,
              employeeUserId: empUserId,
              rangeStart: monthStart,
              rangeEnd: monthEnd,
              companyId: empCompanyId,
            })
          : Promise.resolve([]),
      ]);
      setEvents(eventsRaw);
      setShifts(Array.isArray(shiftsRaw) ? shiftsRaw : []);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [
    user?.id,
    user?.email,
    user?.company_id,
    user?.assigned_company,
    loadOwnEmployeeShifts,
    viewMonth,
    effectiveRole,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const today = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);

  const combined = useMemo(
    () =>
      [
        ...events.map((e) => ({ ...e, kind: 'event' as const, start: e.start_time, title: e.title || 'Event' })),
        ...shifts.map((s) => {
          const startRaw = s.start_time ?? s.date ?? s.shift_date ?? s.start;
          const ms = api.shiftStartsAtMs(s);
          return {
            ...s,
            kind: 'shift' as const,
            start: ms != null ? new Date(ms).toISOString() : startRaw,
            title: 'Shift',
          };
        }),
      ].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [events, shifts]
  );

  const countsByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of combined) {
      const d = new Date(item.start);
      const k = toDayKey(d);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [combined]);

  const rows = useMemo(() => buildMonthGrid(viewMonth, today), [viewMonth, today]);

  const selectedKey = toDayKey(selectedDate);
  const itemsForSelectedDay = useMemo(() => {
    return combined.filter((item) => toDayKey(new Date(item.start)) === selectedKey);
  }, [combined, selectedKey]);

  const monthTitle = viewMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const cardMaxWidth = Math.min(width - 32, 720);
  const cellSize = Math.floor((cardMaxWidth - 2) / 7);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Calendar</Text>
      </View>

      <View style={[styles.calendarCard, { width: cardMaxWidth, alignSelf: 'center' }, styles.cardShadow]}>
        <View style={styles.monthNav}>
          <TouchableOpacity
            onPress={() => setViewMonth((m) => addMonths(m, -1))}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Previous month"
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color="#0f172a" />
          </TouchableOpacity>
          <Text style={styles.monthTitle}>{monthTitle}</Text>
          <TouchableOpacity
            onPress={() => setViewMonth((m) => addMonths(m, 1))}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Next month"
          >
            <MaterialCommunityIcons name="chevron-right" size={28} color="#0f172a" />
          </TouchableOpacity>
        </View>

        <View style={styles.weekdayRow}>
          {WEEKDAYS.map((d) => (
            <View key={d} style={[styles.weekdayCell, { width: cellSize }]}>
              <Text style={styles.weekdayText}>{d}</Text>
            </View>
          ))}
        </View>

        {rows.map((row, ri) => (
          <View key={ri} style={styles.gridRow}>
            {row.map((cell, ci) => {
              const key = toDayKey(cell.date);
              const count = countsByDay.get(key) ?? 0;
              const selected = isSameDay(cell.date, selectedDate);
              const dayNum = cell.date.getDate();

              return (
                <TouchableOpacity
                  key={`${ri}-${ci}`}
                  style={[
                    styles.dayCell,
                    { width: cellSize, minHeight: cellSize },
                    cell.isToday && styles.dayCellToday,
                    selected && !cell.isToday && styles.dayCellSelected,
                  ]}
                  onPress={() => setSelectedDate(new Date(cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate()))}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.dayNumWrap,
                      cell.isToday && styles.dayNumWrapToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        !cell.inCurrentMonth && styles.dayNumMuted,
                        cell.isToday && styles.dayNumToday,
                      ]}
                    >
                      {dayNum}
                    </Text>
                  </View>
                  {count > 0 && cell.inCurrentMonth && (
                    <View style={styles.dotRow}>
                      <View style={[styles.dot, count > 1 && styles.dotSecond]} />
                      {count > 2 && <View style={styles.dotMore} />}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <View style={[styles.eventsSection, { maxWidth: cardMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <Text style={styles.eventsSectionTitle}>
          {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        {itemsForSelectedDay.length === 0 ? (
          <Text style={styles.eventsEmpty}>No events or shifts</Text>
        ) : (
          itemsForSelectedDay.map((item) => (
            <View key={`${item.kind}-${item.id}`} style={styles.eventRow}>
              <View style={[styles.eventDot, item.kind === 'shift' ? styles.eventDotShift : styles.eventDotEvent]} />
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle}>{item.title}</Text>
                <Text style={styles.eventTime}>
                  {new Date(item.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {item.end_time
                    ? ` – ${new Date(item.end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                    : ''}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f1f5f9' },
  scrollContent: { paddingBottom: 32, paddingTop: 8 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  pageHeader: { paddingHorizontal: 20, paddingVertical: 12 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  calendarCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  cardShadow:
    Platform.OS === 'web'
      ? { boxShadow: '0 4px 24px rgba(15, 23, 42, 0.08)' } as object
      : {
          shadowColor: '#0f172a',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
          elevation: 4,
        },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  monthTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a' },
  weekdayRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  weekdayCell: { paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  weekdayText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  gridRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  dayCell: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e2e8f0',
    paddingTop: 6,
    paddingLeft: 6,
    paddingRight: 4,
    paddingBottom: 4,
    backgroundColor: '#fff',
  },
  dayCellToday: { backgroundColor: '#eff6ff' },
  dayCellSelected: { backgroundColor: '#eef2ff' },
  dayNumWrap: {
    alignSelf: 'flex-start',
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumWrapToday: { backgroundColor: '#2563eb' },
  dayNum: { fontSize: 13, fontWeight: '500', color: '#0f172a' },
  dayNumMuted: { color: '#cbd5e1' },
  dayNumToday: { color: '#fff', fontWeight: '600' },
  dotRow: { flexDirection: 'row', gap: 3, marginTop: 4, flexWrap: 'wrap' },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#3b82f6' },
  dotSecond: { backgroundColor: '#8b5cf6' },
  dotMore: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#94a3b8' },
  eventsSection: { marginTop: 20, paddingHorizontal: 20 },
  eventsSectionTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a', marginBottom: 12 },
  eventsEmpty: { fontSize: 14, color: '#94a3b8' },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, backgroundColor: '#fff', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, marginRight: 10 },
  eventDotEvent: { backgroundColor: '#3b82f6' },
  eventDotShift: { backgroundColor: '#8b5cf6' },
  eventBody: { flex: 1 },
  eventTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  eventTime: { fontSize: 13, color: '#64748b', marginTop: 2 },
});
