import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import { confirmClockBiometricOrAlert } from '../lib/biometricAuth';
import { confirmAccountFaceForClockOrAlert } from '../lib/accountFaceAuth';
import {
  addPendingLocalLeaveRequest,
  addPendingLocalSwapRequest,
} from '../lib/schedulerPendingRequestsLocal';

function formatTime(ms: number) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}
function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}
function hoursOneDecimal(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`;
}
function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}
function isToday(d: Date) {
  const t = new Date();
  return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = x.getDate() - day + (day === 0 ? -6 : 1);
  x.setDate(diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d);
  s.setDate(s.getDate() + 6);
  s.setHours(23, 59, 59, 999);
  return s;
}
function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfMonth(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

function scrubBody(o: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

function isTaskLikeEvent(t: any): boolean {
  if (!t || typeof t !== 'object') return false;
  const etRaw = t.event_type ?? t.type ?? t.kind;
  if (etRaw && typeof etRaw === 'object') {
    const nested = String((etRaw as any).name ?? (etRaw as any).slug ?? (etRaw as any).label ?? '').toLowerCase();
    if (nested.includes('task')) return true;
  }
  const et = String(etRaw ?? '').toLowerCase();
  if (et.includes('task')) return true;
  const sub = String(t.event_subtype ?? t.task_category ?? t.category ?? '').toLowerCase();
  if (sub.includes('task')) return true;
  if (t.is_task === true || t.for_task === true) return true;
  if (t.priority != null && String(t.priority).trim() !== '') return true;
  return false;
}

function eventStartMs(ev: any): number | null {
  const stRaw =
    ev?.start_time ??
    ev?.start ??
    ev?.scheduled_at ??
    ev?.date ??
    ev?.start_date ??
    ev?.created_at ??
    ev?.created;
  if (!stRaw) return null;
  const ms = new Date(stRaw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function shiftLabel(s: any): string {
  const startMs = api.shiftStartsAtMs(s) ?? (s.start_time ? new Date(s.start_time).getTime() : null);
  if (startMs == null || Number.isNaN(startMs)) return 'Shift';
  const d = new Date(startMs);
  const t1 = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const endMs = s.end_time ? new Date(s.end_time).getTime() : null;
  const t2 = endMs != null && !Number.isNaN(endMs) ? new Date(endMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  return t2 ? `${day} ${t1} - ${t2}` : `${day} ${t1}`;
}

function employeeName(e: any): string {
  const fn = (e?.first_name || '').trim();
  const ln = (e?.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return e?.email || 'Employee';
}

/** Shifts often carry company when the employee record does not — needed to load swap peers. */
function companyIdFromSchedulerShift(s: any): string | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const raw = (s as any).company_id ?? (s as any).company;
  if (raw && typeof raw === 'object') {
    const id = String((raw as any).id ?? (raw as any).pk ?? '').trim();
    return id || undefined;
  }
  if (raw != null && raw !== '') {
    const id = String(raw).trim();
    if (id && !id.toLowerCase().includes('object')) return id;
  }
  return undefined;
}

function inferCompanyIdFromShifts(shiftRows: any[]): string | undefined {
  for (const s of shiftRows) {
    const cid = companyIdFromSchedulerShift(s);
    if (cid) return cid;
  }
  return undefined;
}

function schedulerEmployeeRowId(e: any): string {
  return String(e?.id ?? e?.pk ?? e?.employee_id ?? '').trim();
}

export default function EmployeeDashboard() {
  const { width: windowWidth } = useWindowDimensions();
  /** Stack banner actions vertically on phones / narrow web (e.g. devtools device toolbar). */
  const heroCompact = windowWidth < 640;
  const { user } = useAuth();
  const [employee, setEmployee] = useState<any>(null);
  const [coworkers, setCoworkers] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeEntry, setActiveEntry] = useState<any>(null);
  const [clockInTime, setClockInTime] = useState<number | null>(null);
  const [clockOutTime, setClockOutTime] = useState<number | null>(null);
  const [breakStartTime, setBreakStartTime] = useState<number | null>(null);
  const [breakEndTime, setBreakEndTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [totalBreakTime, setTotalBreakTime] = useState(0);
  const [breakDuration, setBreakDuration] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveDateYmd, setLeaveDateYmd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveSending, setLeaveSending] = useState(false);

  const [swapOpen, setSwapOpen] = useState(false);
  const [swapShiftId, setSwapShiftId] = useState<string>('');
  const [swapPeerId, setSwapPeerId] = useState<string>('');
  const [swapPicker, setSwapPicker] = useState<'shift' | 'peer' | null>(null);
  const [swapSending, setSwapSending] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
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
      setEmployee(emp);
      if (!emp) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const today = new Date();
      const weekStart = startOfWeek(today);
      const weekEnd = endOfWeek(today);
      const empId = String(emp.id ?? (emp as any).pk ?? '').trim();
      const empUserId = String((emp as any).user_id ?? (emp as any).user?.id ?? '').trim() || undefined;
      const companyId = api.companyIdFromSchedulerEmployee(emp, user);

      const [shiftList, entryList, tasksList] = await Promise.all([
        api.getShiftsForEmployeeInRange({
          employeeId: empId,
          employeeUserId: empUserId,
          rangeStart: weekStart,
          rangeEnd: weekEnd,
          companyId,
        }),
        api.getTimeClockEntriesForEmployee(empId),
        (async () => {
          const startIso = weekStart.toISOString();
          const endIso = weekEnd.toISOString();
          const uid = empUserId || String(user.id);
          const base = { event_type: 'task', start_time__gte: startIso, start_time__lte: endIso };
          const tries: Record<string, any>[] = [
            { ...base, assigned_user: uid },
            { ...base, assignee: uid },
            { ...base, user: uid },
            { ...base, owner: uid },
            { start_time__gte: startIso, start_time__lte: endIso, assigned_user: uid },
            { start_time__gte: startIso, start_time__lte: endIso, user: uid },
          ];
          for (const params of tries) {
            try {
              const res = await api.getCalendarEvents(params);
              const list = Array.isArray(res) ? res : [];
              const tasksOnly = list.filter(Boolean).filter(isTaskLikeEvent);
              if (tasksOnly.length > 0) return tasksOnly;
            } catch {
              /* try next */
            }
          }
          return [];
        })(),
      ]);
      const shiftsArr = Array.isArray(shiftList) ? shiftList : [];
      setShifts(shiftsArr);

      const effectiveCompanyId = companyId || inferCompanyIdFromShifts(shiftsArr);
      let coworkList: any[] = [];
      if (effectiveCompanyId) {
        try {
          const raw = await api.getEmployees({
            company: effectiveCompanyId,
            page_size: 500,
            status: 'active',
          });
          coworkList = Array.isArray(raw) ? raw : [];
        } catch {
          try {
            const raw2 = await api.getEmployees({ company: effectiveCompanyId, page_size: 500 });
            coworkList = Array.isArray(raw2) ? raw2 : [];
          } catch {
            coworkList = [];
          }
        }
        coworkList = coworkList.filter((e: any) => schedulerEmployeeRowId(e) !== empId);
      }
      setCoworkers(coworkList);

      const list = Array.isArray(entryList) ? entryList : [];
      setEntries(list);
      setTasks(Array.isArray(tasksList) ? tasksList : []);
      const active = api.pickActiveTimeClockEntry(list);
      setActiveEntry(active);
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;
      if (active) {
        const ci = parseMs(active.clock_in);
        const co = parseMs(active.clock_out);
        const bs = parseMs(active.break_start);
        const be = parseMs(active.break_end);
        setClockInTime(ci);
        setClockOutTime(co);
        setBreakStartTime(bs);
        setBreakEndTime(be);
        let breakSec = 0;
        if (bs && be) breakSec = Math.floor((be - bs) / 1000);
        setTotalBreakTime(breakSec);
        if (co) setElapsed(Math.max(0, Math.floor((co - (ci || 0)) / 1000) - breakSec));
        else setElapsed(Math.max(0, Math.floor((Date.now() - (ci || 0)) / 1000) - breakSec));
      } else {
        const lastClosed = list
          .filter((e: any) => e.clock_out && (parseMs(e.clock_in) ?? 0) >= todayStart && (parseMs(e.clock_out) ?? 0) <= todayEnd)
          .sort((a: any, b: any) => (parseMs(b.clock_out) ?? 0) - (parseMs(a.clock_out) ?? 0))[0];
        if (lastClosed) {
          const ci = parseMs(lastClosed.clock_in) || 0;
          const co = parseMs(lastClosed.clock_out) || 0;
          const bs = parseMs(lastClosed.break_start);
          const be = parseMs(lastClosed.break_end);
          let breakSec = 0;
          if (bs && be) breakSec = Math.floor((be - bs) / 1000);
          setClockInTime(ci);
          setClockOutTime(co);
          setElapsed(Math.max(0, Math.floor((co - ci) / 1000) - breakSec));
          setTotalBreakTime(breakSec);
        } else {
          setClockInTime(null);
          setClockOutTime(null);
          setElapsed(0);
          setTotalBreakTime(0);
        }
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, user?.email, user?.company_id, user?.assigned_company]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!clockInTime || clockOutTime) return;
    if (breakStartTime && !breakEndTime) {
      const tick = () => setBreakDuration(Math.floor((Date.now() - breakStartTime) / 1000));
      tick();
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    }
    const tick = () => {
      let workSeconds = Math.floor((Date.now() - clockInTime) / 1000);
      if (totalBreakTime > 0) workSeconds -= totalBreakTime;
      setElapsed(workSeconds);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [clockInTime, breakStartTime, breakEndTime, clockOutTime, totalBreakTime]);

  const todayShift =
    shifts.find((s) => {
      const t = api.shiftStartsAtMs(s);
      if (t == null) return false;
      const d = new Date(t);
      return isToday(d);
    }) || null;

  const scheduledLine = useMemo(() => {
    if (!todayShift) return null;
    const ms =
      api.shiftStartsAtMs(todayShift) ?? (todayShift.start_time ? new Date(todayShift.start_time).getTime() : null);
    const startStr = ms != null && !Number.isNaN(ms) ? formatTime(ms) : '—';
    const endStr = todayShift.end_time ? formatTime(new Date(todayShift.end_time).getTime()) : '—';
    return `Scheduled: ${startStr} - ${endStr}`;
  }, [todayShift]);

  const todayEntries = entries.filter((e) => e.clock_in && isToday(new Date(e.clock_in)));
  const weekEntries = entries.filter((e) => {
    if (!e.clock_in) return false;
    const d = new Date(e.clock_in).getTime();
    return d >= startOfWeek(new Date()).getTime() && d <= endOfWeek(new Date()).getTime();
  });
  const moStart = startOfMonth(new Date());
  const moEnd = endOfMonth(new Date());
  const monthEntries = entries.filter((e) => {
    if (!e.clock_in) return false;
    const d = new Date(e.clock_in).getTime();
    return d >= moStart.getTime() && d <= moEnd.getTime();
  });

  const calcHours = (list: any[]) => {
    return list.reduce((sum, e) => {
      const ci = parseMs(e.clock_in) || 0;
      const co = parseMs(e.clock_out) || Date.now();
      const bs = parseMs(e.break_start);
      const be = parseMs(e.break_end);
      let breakSec = 0;
      if (bs && be) breakSec = Math.floor((be - bs) / 1000);
      return sum + Math.max(0, Math.floor((co - ci) / 1000) - breakSec);
    }, 0);
  };
  const todayHours = calcHours(todayEntries);
  const weekHours = calcHours(weekEntries);
  const monthHours = calcHours(monthEntries);

  const upcomingThisWeekCount = useMemo(() => {
    const ws = startOfWeek(new Date()).getTime();
    const we = endOfWeek(new Date()).getTime();
    return shifts.filter((s) => {
      const t = api.shiftStartsAtMs(s);
      return t != null && t >= ws && t <= we;
    }).length;
  }, [shifts]);

  const shiftOptions = useMemo(() => {
    return shifts.map((s, idx) => {
      let id = String(s.id ?? s.pk ?? s.uuid ?? '').trim();
      if (!id) {
        const ms = api.shiftStartsAtMs(s) ?? (s.start_time ? new Date(s.start_time).getTime() : null);
        const msKey = ms != null && !Number.isNaN(ms) ? ms : 'na';
        id = `virt-shift-${msKey}-${idx}`;
      }
      return { id, label: shiftLabel(s) };
    });
  }, [shifts]);

  const peerOptions = useMemo(() => {
    return coworkers
      .map((e) => ({
        id: schedulerEmployeeRowId(e),
        label: employeeName(e),
      }))
      .filter((o) => o.id);
  }, [coworkers]);

  const handleClockIn = async () => {
    if (!employee?.id) return;
    if (!(await confirmAccountFaceForClockOrAlert())) return;
    if (!(await confirmClockBiometricOrAlert())) return;
    setActionLoading(true);
    try {
      await api.clockIn({ employee_id: employee.id, shift_id: todayShift?.id });
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Clock in failed');
    } finally {
      setActionLoading(false);
    }
  };
  const handleClockOut = async () => {
    const entryId = api.timeClockEntryId(activeEntry);
    if (!entryId) {
      Alert.alert('Error', 'No active time entry to clock out.');
      return;
    }
    if (!(await confirmAccountFaceForClockOrAlert())) return;
    if (!(await confirmClockBiometricOrAlert())) return;
    setActionLoading(true);
    try {
      await api.clockOut({ time_clock_entry_id: entryId, employee_id: employee.id });
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Clock out failed');
    } finally {
      setActionLoading(false);
    }
  };
  const handleStartBreak = async () => {
    const entryId = api.timeClockEntryId(activeEntry);
    if (!entryId) return;
    if (!(await confirmAccountFaceForClockOrAlert())) return;
    if (!(await confirmClockBiometricOrAlert())) return;
    setActionLoading(true);
    try {
      await api.startBreak(entryId);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Start break failed');
    } finally {
      setActionLoading(false);
    }
  };
  const handleEndBreak = async () => {
    const entryId = api.timeClockEntryId(activeEntry);
    if (!entryId) return;
    if (!(await confirmAccountFaceForClockOrAlert())) return;
    if (!(await confirmClockBiometricOrAlert())) return;
    setActionLoading(true);
    try {
      await api.endBreak(entryId);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'End break failed');
    } finally {
      setActionLoading(false);
    }
  };

  const openLeaveModal = () => {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    setLeaveDateYmd(`${y}-${m}-${d}`);
    setLeaveReason('');
    setLeaveOpen(true);
  };

  const submitLeave = async () => {
    if (!employee?.id) return;
    const ymd = leaveDateYmd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      Alert.alert('Leave date', 'Use a valid date (YYYY-MM-DD).');
      return;
    }
    const empId = String(employee.id ?? (employee as any).pk ?? '').trim();
    const companyId = api.companyIdFromSchedulerEmployee(employee, user);
    const noon = new Date(`${ymd}T12:00:00`);
    const endDay = new Date(`${ymd}T17:00:00`);
    const reason = leaveReason.trim();

    setLeaveSending(true);
    try {
      const tries = [
        scrubBody({
          employee: empId,
          employee_id: empId,
          start_date: ymd,
          end_date: ymd,
          reason: reason || undefined,
          notes: reason || undefined,
          status: 'pending',
        }),
        scrubBody({
          employee: empId,
          start_datetime: noon.toISOString(),
          end_datetime: endDay.toISOString(),
          notes: reason || undefined,
          status: 'pending',
        }),
      ];
      let apiOk = false;
      for (const body of tries) {
        if (Object.keys(body).length < 2) continue;
        try {
          await api.createLeaveRequest(body);
          apiOk = true;
          break;
        } catch {
          /* try next */
        }
      }
      if (!apiOk) {
        await addPendingLocalLeaveRequest({
          id: `local-leave-${Date.now()}`,
          employee_id: empId,
          employee: {
            id: empId,
            first_name: employee.first_name,
            last_name: employee.last_name,
            email: employee.email,
          },
          start_date: ymd,
          start_datetime: noon.toISOString(),
          end_datetime: endDay.toISOString(),
          reason,
          notes: reason || undefined,
          status: 'pending',
          company_id: companyId,
          _localPending: true,
        });
        Alert.alert(
          'Request saved',
          'Your leave request was stored for manager review. If your server supports leave requests, it will sync when available.'
        );
      } else {
        Alert.alert('Sent', 'Leave request submitted.');
      }
      setLeaveOpen(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not submit leave request');
    } finally {
      setLeaveSending(false);
    }
  };

  const openSwapModal = () => {
    if (shifts.length === 0) {
      Alert.alert('Request Swap', 'No shifts found for this week. Pull to refresh after your schedule is published.');
      return;
    }
    if (peerOptions.length === 0) {
      Alert.alert('Request Swap', 'No coworkers found in your company to swap with.');
      return;
    }
    setSwapPicker(null);
    setSwapShiftId(shiftOptions[0]?.id ?? '');
    setSwapPeerId(peerOptions[0]?.id ?? '');
    setSwapOpen(true);
  };

  const resolveShiftFromSelection = (selId: string) => {
    return shifts.find((s, idx) => {
      const sid = String(s.id ?? s.pk ?? s.uuid ?? '').trim();
      if (sid && sid === selId) return true;
      const ms = api.shiftStartsAtMs(s) ?? (s.start_time ? new Date(s.start_time).getTime() : null);
      const msKey = ms != null && !Number.isNaN(ms) ? ms : 'na';
      if (`virt-shift-${msKey}-${idx}` === selId) return true;
      if (ms != null && !Number.isNaN(ms) && `virt-shift-${ms}` === selId) return true;
      return `virt-shift-idx-${idx}` === selId;
    });
  };

  const submitSwap = async () => {
    if (!employee?.id) return;
    const empId = String(employee.id ?? (employee as any).pk ?? '').trim();
    const companyId = api.companyIdFromSchedulerEmployee(employee, user);
    let shiftIdUse = swapShiftId;
    let peerIdUse = swapPeerId;
    if ((!shiftIdUse || !shiftOptions.some((o) => o.id === shiftIdUse)) && shiftOptions[0]) shiftIdUse = shiftOptions[0].id;
    if ((!peerIdUse || !peerOptions.some((o) => o.id === peerIdUse)) && peerOptions[0]) peerIdUse = peerOptions[0].id;
    const shift = resolveShiftFromSelection(shiftIdUse);
    const peer = coworkers.find((e) => schedulerEmployeeRowId(e) === peerIdUse);
    if (!shift || !peer) {
      Alert.alert('Swap', 'Select a shift and a coworker.');
      return;
    }
    const shiftPk = String(shift.id ?? shift.pk ?? shift.uuid ?? '').trim();
    const peerPk = String(peer.id ?? peer.pk ?? '').trim();

    setSwapSending(true);
    try {
      const tries: Record<string, any>[] = [];
      const companyScopeRaw = companyId || inferCompanyIdFromShifts([shift]) || inferCompanyIdFromShifts(shifts);
      const companyScope =
        companyScopeRaw != null && String(companyScopeRaw).trim() !== ''
          ? String(companyScopeRaw).trim()
          : undefined;
      if (shiftPk) {
        tries.push(
          scrubBody({
            company: companyScope,
            company_id: companyScope,
            requesting_employee: empId,
            employee: empId,
            employee_id: empId,
            original_shift: shiftPk,
            shift: shiftPk,
            replacement_employee: peerPk,
            replacement_employee_id: peerPk,
            swap_with: peerPk,
            status: 'pending',
          }),
          scrubBody({
            company: companyScope,
            company_id: companyScope,
            employee_id: empId,
            shift_id: shiftPk,
            replacement_employee_id: peerPk,
            status: 'pending',
          })
        );
      }
      tries.push(
        scrubBody({
          company: companyScope,
          company_id: companyScope,
          employee_id: empId,
          requesting_employee: empId,
          replacement_employee_id: peerPk,
          shift_start: shift.start_time,
          shift_end: shift.end_time,
          original_shift_start: shift.start_time,
          original_shift_end: shift.end_time,
          status: 'pending',
        }),
        scrubBody({
          company: companyScope,
          company_id: companyScope,
          requesting_employee_id: empId,
          employee_id: empId,
          proposed_employee_id: peerPk,
          target_employee_id: peerPk,
          covered_shift_id: shiftPk || undefined,
          shift_id: shiftPk || undefined,
          shift_start: shift.start_time,
          shift_end: shift.end_time,
          status: 'pending',
        })
      );
      let apiOk = false;
      for (const body of tries) {
        if (Object.keys(body).length < 2) continue;
        try {
          await api.createReplacementRequest(body);
          apiOk = true;
          break;
        } catch {
          /* try next */
        }
      }
      if (!apiOk) {
        await addPendingLocalSwapRequest({
          id: `local-swap-${Date.now()}`,
          status: 'pending',
          requesting_employee: {
            id: empId,
            first_name: employee.first_name,
            last_name: employee.last_name,
            email: employee.email,
          },
          requesting_employee_id: empId,
          employee_id: empId,
          original_shift: {
            id: shiftPk || undefined,
            start_time: shift.start_time,
            end_time: shift.end_time,
          },
          replacement_employee: peer,
          replacement_employee_id: peerPk,
          company_id: companyScope || companyId,
          _localPending: true,
        });
        Alert.alert(
          'Request saved',
          'Your swap request was stored for manager review. If your server supports swap requests, it will sync when available.'
        );
      } else {
        Alert.alert('Sent', 'Swap request submitted.');
      }
      setSwapPicker(null);
      setSwapOpen(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not submit swap request');
    } finally {
      setSwapSending(false);
    }
  };

  const onBreak = !!(breakStartTime && !breakEndTime && !clockOutTime);
  const clockedIn = !!(clockInTime && !clockOutTime);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  if (!employee) {
    return (
      <View style={styles.centered}>
        <Text style={styles.noEmployeeTitle}>Not an employee</Text>
        <Text style={styles.noEmployeeText}>Your account is not linked to an employee record.</Text>
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.card}>
        <Text style={styles.clock}>
          {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
        </Text>
        <Text style={styles.date}>
          {new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.name}>{[employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Employee'}</Text>
        {todayShift && <Text style={styles.shiftText}>Today: {scheduledLine?.replace('Scheduled: ', '') ?? '—'}</Text>}
      </View>

      {!clockedIn && (
        <View style={[styles.card, heroCompact ? styles.heroBannerCompact : styles.heroBannerWide]}>
          <View style={[styles.heroLeft, heroCompact && styles.heroLeftCompact]}>
            <Text style={styles.heroStatus}>{todayShift ? 'Not Clocked In' : 'No shift today'}</Text>
            {scheduledLine ? <Text style={styles.heroScheduled}>{scheduledLine}</Text> : null}
          </View>
          <View
            style={[
              styles.heroActions,
              heroCompact && styles.heroActionsCompact,
              !heroCompact && styles.heroActionsWide,
            ]}
          >
            <TouchableOpacity
              style={[styles.outlineBtn, heroCompact && styles.heroBtnFull]}
              onPress={openLeaveModal}
            >
              <Text style={styles.outlineBtnText}>Request Leave</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.outlineBtn, heroCompact && styles.heroBtnFull]}
              onPress={openSwapModal}
            >
              <Text style={styles.outlineBtnText}>Request Swap</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.clockInBlue,
                heroCompact && styles.heroBtnFull,
                (!todayShift || actionLoading) && { opacity: 0.5 },
              ]}
              onPress={handleClockIn}
              disabled={!todayShift || actionLoading}
            >
              <MaterialCommunityIcons name="play-circle-outline" size={20} color="#fff" />
              <MaterialCommunityIcons name="map-marker-outline" size={18} color="#fff" style={{ marginLeft: 6 }} />
              <Text style={styles.clockInBlueText}>{actionLoading ? '…' : 'Clock In'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.statGrid}>
        <View style={styles.statCard}>
          <MaterialCommunityIcons name="clock-outline" size={22} color="#64748b" />
          <Text style={styles.statCardTitle}>Today</Text>
          <Text style={styles.statCardValue}>{hoursOneDecimal(todayHours)}</Text>
          <Text style={styles.statCardMeta}>{todayEntries.length} entries</Text>
        </View>
        <View style={styles.statCard}>
          <MaterialCommunityIcons name="calendar-month-outline" size={22} color="#64748b" />
          <Text style={styles.statCardTitle}>This Week</Text>
          <Text style={styles.statCardValue}>{hoursOneDecimal(weekHours)}</Text>
          <Text style={styles.statCardMeta}>{weekEntries.length} entries</Text>
        </View>
        <View style={styles.statCard}>
          <MaterialCommunityIcons name="chart-line" size={22} color="#64748b" />
          <Text style={styles.statCardTitle}>This Month</Text>
          <Text style={styles.statCardValue}>{hoursOneDecimal(monthHours)}</Text>
          <Text style={styles.statCardMeta}>{monthEntries.length} entries</Text>
        </View>
        <View style={styles.statCard}>
          <MaterialCommunityIcons name="check-circle-outline" size={22} color="#64748b" />
          <Text style={styles.statCardTitle}>Upcoming Shifts</Text>
          <Text style={styles.statCardValue}>{upcomingThisWeekCount}</Text>
          <Text style={styles.statCardMeta}>This week</Text>
        </View>
      </View>

      {clockedIn && (
        <View style={[styles.statusBox, onBreak ? styles.statusBreak : styles.statusClockedIn]}>
          <Text style={styles.statusTitle}>{onBreak ? 'ON BREAK' : 'CLOCKED IN'}</Text>
          <Text style={styles.statusTime}>{formatDuration(onBreak ? breakDuration : elapsed)}</Text>
          {onBreak ? (
            <TouchableOpacity style={styles.buttonGreen} onPress={handleEndBreak} disabled={actionLoading}>
              <Text style={styles.buttonText}>{actionLoading ? '…' : 'End break'}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.buttonOrange} onPress={handleStartBreak} disabled={actionLoading}>
                <Text style={styles.buttonTextDark}>Break</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonRed} onPress={handleClockOut} disabled={actionLoading}>
                <Text style={styles.buttonText}>{actionLoading ? '…' : 'Clock out'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {shifts.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Upcoming shifts</Text>
          {shifts.slice(0, 7).map((s) => {
            const startMs =
              api.shiftStartsAtMs(s) ?? (s.start_time ? new Date(s.start_time).getTime() : null);
            return (
              <Text key={String(s.id ?? s.pk ?? startMs)} style={styles.shiftRow}>
                {startMs != null
                  ? `${new Date(startMs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} – ${formatTime(startMs)}`
                  : 'Shift'}
                {s.end_time ? ` – ${formatTime(new Date(s.end_time).getTime())}` : ''}
              </Text>
            );
          })}
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Upcoming tasks</Text>
        {tasks.length === 0 ? (
          <Text style={styles.shiftRow}>No tasks found</Text>
        ) : (
          tasks
            .slice()
            .sort((a, b) => (eventStartMs(a) ?? 0) - (eventStartMs(b) ?? 0))
            .slice(0, 6)
            .map((t) => (
              <Text
                key={String(
                  t?.id ??
                    t?.pk ??
                    t?.uuid ??
                    `${String(t?.title ?? t?.name ?? '')}|${String(t?.start_time ?? t?.created_at ?? '')}`
                )}
                style={styles.shiftRow}
              >
                {String(t?.title ?? t?.name ?? 'Task')}
              </Text>
            ))
        )}
      </View>

    </ScrollView>

    <Modal visible={leaveOpen} transparent animationType="fade" onRequestClose={() => !leaveSending && setLeaveOpen(false)}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.modalOverlay, Platform.OS === 'web' && styles.modalOverlayWeb]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !leaveSending && setLeaveOpen(false)} />
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Request Leave</Text>
            <TouchableOpacity onPress={() => !leaveSending && setLeaveOpen(false)} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>Select leave date to send request for approval.</Text>
          <Text style={styles.modalLabel}>Leave Date</Text>
          <TextInput
            style={styles.modalInput}
            value={leaveDateYmd}
            onChangeText={setLeaveDateYmd}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#94a3b8"
            {...(Platform.OS === 'web'
              ? ({
                  type: 'date',
                } as any)
              : {})}
          />
          <Text style={[styles.modalLabel, { marginTop: 12 }]}>Reason (optional)</Text>
          <TextInput
            style={[styles.modalInput, styles.modalTextArea]}
            value={leaveReason}
            onChangeText={setLeaveReason}
            placeholder="Add a note for your manager"
            placeholderTextColor="#94a3b8"
            multiline
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalGhost} onPress={() => !leaveSending && setLeaveOpen(false)}>
              <Text style={styles.modalGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalPrimary} onPress={() => void submitLeave()} disabled={leaveSending}>
              {leaveSending ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalPrimaryText}>Send Request</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal
      visible={swapOpen}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!swapSending) {
          setSwapPicker(null);
          setSwapOpen(false);
        }
      }}
    >
      <View style={[styles.modalOverlay, Platform.OS === 'web' && styles.modalOverlayWeb]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (swapSending) return;
            if (swapPicker) setSwapPicker(null);
            else setSwapOpen(false);
          }}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalCenterBox}
          pointerEvents="box-none"
        >
          <View style={styles.modalCard} pointerEvents="auto">
            {swapPicker === 'shift' ? (
              <>
                <TouchableOpacity style={styles.pickerBackRow} onPress={() => setSwapPicker(null)} disabled={swapSending}>
                  <MaterialCommunityIcons name="arrow-left" size={22} color="#2563eb" />
                  <Text style={styles.pickerBackText}>Back</Text>
                </TouchableOpacity>
                <Text style={[styles.modalTitle, { marginBottom: 8 }]}>Your Shift</Text>
                <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
                  {shiftOptions.map((o, idx) => (
                    <TouchableOpacity
                      key={`${o.id}-${idx}`}
                      style={styles.pickerRow}
                      onPress={() => {
                        setSwapShiftId(o.id);
                        setSwapPicker(null);
                      }}
                    >
                      <Text style={styles.pickerRowText}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : swapPicker === 'peer' ? (
              <>
                <TouchableOpacity style={styles.pickerBackRow} onPress={() => setSwapPicker(null)} disabled={swapSending}>
                  <MaterialCommunityIcons name="arrow-left" size={22} color="#2563eb" />
                  <Text style={styles.pickerBackText}>Back</Text>
                </TouchableOpacity>
                <Text style={[styles.modalTitle, { marginBottom: 8 }]}>Swap With</Text>
                <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
                  {peerOptions.map((o, idx) => (
                    <TouchableOpacity
                      key={`${o.id}-${idx}`}
                      style={styles.pickerRow}
                      onPress={() => {
                        setSwapPeerId(o.id);
                        setSwapPicker(null);
                      }}
                    >
                      <Text style={styles.pickerRowText}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            ) : (
              <>
                <View style={styles.modalHead}>
                  <Text style={styles.modalTitle}>Request Swap</Text>
                  <TouchableOpacity
                    onPress={() => {
                      if (!swapSending) {
                        setSwapPicker(null);
                        setSwapOpen(false);
                      }
                    }}
                    hitSlop={12}
                  >
                    <MaterialCommunityIcons name="close" size={22} color="#64748b" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalHint}>Select your shift and replacement coworker.</Text>
                <Text style={styles.modalLabel}>Your Shift</Text>
                <TouchableOpacity style={styles.modalSelect} onPress={() => setSwapPicker('shift')} disabled={swapSending}>
                  <Text style={styles.modalSelectText} numberOfLines={2}>
                    {shiftOptions.find((o) => o.id === swapShiftId)?.label ??
                      shiftOptions[0]?.label ??
                      'Select shift'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>
                <Text style={[styles.modalLabel, { marginTop: 12 }]}>Swap With</Text>
                <TouchableOpacity style={styles.modalSelect} onPress={() => setSwapPicker('peer')} disabled={swapSending}>
                  <Text style={styles.modalSelectText} numberOfLines={1}>
                    {peerOptions.find((o) => o.id === swapPeerId)?.label ??
                      peerOptions[0]?.label ??
                      'Select employee'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={22} color="#64748b" />
                </TouchableOpacity>
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalGhost}
                    onPress={() => {
                      if (!swapSending) {
                        setSwapPicker(null);
                        setSwapOpen(false);
                      }
                    }}
                  >
                    <Text style={styles.modalGhostText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalPrimary} onPress={() => void submitSwap()} disabled={swapSending}>
                    {swapSending ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.modalPrimaryText}>Send Request</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 8, color: '#64748b' },
  noEmployeeTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  noEmployeeText: { color: '#64748b', marginTop: 8, textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  clock: { fontSize: 28, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  date: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 4 },
  name: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  shiftText: { fontSize: 13, color: '#64748b', marginTop: 4 },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  statCard: {
    width: '48%',
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statCardTitle: { fontSize: 12, fontWeight: '600', color: '#64748b', marginTop: 6 },
  statCardValue: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginTop: 4 },
  statCardMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  heroBannerCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    /** Space between status text block and action buttons (RN Web avoids overlap). */
    gap: 32,
  },
  heroBannerWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  heroLeft: { flex: 1, minWidth: 160 },
  heroLeftCompact: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    alignSelf: 'stretch',
    width: '100%',
    marginBottom: 0,
    paddingBottom: 2,
  },
  heroStatus: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  heroScheduled: { fontSize: 13, color: '#64748b', marginTop: 6, marginBottom: 2, lineHeight: 20 },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'flex-end',
  },
  heroActionsCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 0,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    gap: 10,
  },
  heroActionsWide: {
    marginTop: 14,
    flexShrink: 0,
    maxWidth: '100%',
    justifyContent: 'flex-end',
  },
  heroBtnFull: {
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  outlineBtnText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  clockInBlue: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  clockInBlueText: { color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 6 },
  statusBox: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 2, borderColor: '#0f172a', alignItems: 'center' },
  statusClockedIn: { borderColor: '#22c55e', backgroundColor: '#ecfdf5' },
  statusBreak: { borderColor: '#f59e0b', backgroundColor: '#fffbeb' },
  statusTitle: { fontSize: 13, fontWeight: '600', color: '#0f172a', marginBottom: 8 },
  statusTime: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  buttonGreen: { backgroundColor: '#22c55e', padding: 14, borderRadius: 8, alignSelf: 'stretch', alignItems: 'center' },
  buttonOrange: { flex: 1, backgroundColor: '#f59e0b', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonRed: { flex: 1, backgroundColor: '#ef4444', padding: 14, borderRadius: 8, alignItems: 'center', marginLeft: 8 },
  buttonRow: { flexDirection: 'row', width: '100%' },
  buttonText: { color: '#fff', fontWeight: '600' },
  buttonTextDark: { color: '#0f172a', fontWeight: '600' },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a', marginBottom: 8 },
  shiftRow: { fontSize: 13, color: '#64748b', marginTop: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  /** Web: ensure swap/leave modals cover the viewport (not clipped by scroll/layout). */
  modalOverlayWeb: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
  },
  modalCenterBox: {
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  pickerBackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  pickerBackText: { fontSize: 16, fontWeight: '600', color: '#2563eb' },
  pickerScroll: { maxHeight: 320 },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  modalHint: { fontSize: 14, color: '#64748b', marginBottom: 14, lineHeight: 20 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0f172a',
  },
  modalTextArea: { minHeight: 88, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  modalGhost: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  modalGhostText: { fontSize: 15, fontWeight: '600', color: '#334155' },
  modalPrimary: {
    minWidth: 120,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  modalSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
  },
  modalSelectText: { flex: 1, fontSize: 15, color: '#0f172a', marginRight: 8 },
  pickerRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  pickerRowText: { fontSize: 16, color: '#0f172a' },
});
