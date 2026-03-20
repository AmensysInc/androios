import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

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

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const [employee, setEmployee] = useState<any>(null);
  const [shifts, setShifts] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
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

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const empList = await api.getEmployees({ user: user.id });
      const emp = Array.isArray(empList) ? empList[0] : null;
      setEmployee(emp);
      if (!emp) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const today = new Date();
      const weekStart = startOfWeek(today);
      const weekEnd = endOfWeek(today);
      const [shiftList, entryList] = await Promise.all([
        api.getShifts({ employee: emp.id, start_time__gte: weekStart.toISOString(), start_time__lte: weekEnd.toISOString() }),
        api.getTimeClockEntries({ employee: emp.id }),
      ]);
      setShifts(Array.isArray(shiftList) ? shiftList : []);
      const list = Array.isArray(entryList) ? entryList : [];
      setEntries(list);
      const active = list.find((e: any) => e.clock_in && !e.clock_out) || null;
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
  }, [user?.id]);

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

  const todayShift = shifts.find((s) => isToday(new Date(s.start_time))) || null;

  const handleClockIn = async () => {
    if (!employee?.id) return;
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
    if (!activeEntry?.id) return;
    setActionLoading(true);
    try {
      await api.clockOut({ time_clock_entry_id: activeEntry.id });
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Clock out failed');
    } finally {
      setActionLoading(false);
    }
  };
  const handleStartBreak = async () => {
    if (!activeEntry?.id) return;
    setActionLoading(true);
    try {
      await api.startBreak(activeEntry.id);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Start break failed');
    } finally {
      setActionLoading(false);
    }
  };
  const handleEndBreak = async () => {
    if (!activeEntry?.id) return;
    setActionLoading(true);
    try {
      await api.endBreak(activeEntry.id);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'End break failed');
    } finally {
      setActionLoading(false);
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

  const todayEntries = entries.filter((e) => e.clock_in && isToday(new Date(e.clock_in)));
  const weekEntries = entries.filter((e) => {
    if (!e.clock_in) return false;
    const d = new Date(e.clock_in).getTime();
    return d >= startOfWeek(new Date()).getTime() && d <= endOfWeek(new Date()).getTime();
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.card}>
        <Text style={styles.clock}>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</Text>
        <Text style={styles.date}>{new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.name}>{[employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Employee'}</Text>
        {todayShift && (
          <Text style={styles.shiftText}>
            Today: {formatTime(new Date(todayShift.start_time).getTime())} – {todayShift.end_time ? formatTime(new Date(todayShift.end_time).getTime()) : '—'}
          </Text>
        )}
      </View>
      <View style={styles.kpiRow}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Today</Text>
          <Text style={styles.kpiValue}>{formatDuration(todayHours)}</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>This week</Text>
          <Text style={styles.kpiValue}>{formatDuration(weekHours)}</Text>
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
      {!clockedIn && (
        <View style={styles.statusBox}>
          <Text style={styles.statusTitle}>{todayShift ? 'Ready to clock in' : 'No shift today'}</Text>
          <TouchableOpacity style={styles.buttonGreen} onPress={handleClockIn} disabled={actionLoading}>
            <Text style={styles.buttonText}>{actionLoading ? '…' : 'Clock in'}</Text>
          </TouchableOpacity>
        </View>
      )}
      {shifts.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Upcoming shifts</Text>
          {shifts.slice(0, 7).map((s) => (
            <Text key={s.id} style={styles.shiftRow}>
              {new Date(s.start_time).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} – {formatTime(new Date(s.start_time).getTime())}
              {s.end_time ? ` – ${formatTime(new Date(s.end_time).getTime())}` : ''}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
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
  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  kpiLabel: { fontSize: 12, color: '#64748b' },
  kpiValue: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginTop: 4 },
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
});
