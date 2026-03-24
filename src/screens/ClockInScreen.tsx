import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Switch,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import {
  isClockBiometricEnabled,
  setClockBiometricEnabled,
  confirmClockBiometricOrAlert,
} from '../lib/biometricAuth';

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}

export default function ClockInScreen() {
  const { user } = useAuth();
  const [employee, setEmployee] = useState<any>(null);
  const [activeEntry, setActiveEntry] = useState<any>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [requireBioForClock, setRequireBioForClock] = useState(false);

  useEffect(() => {
    isClockBiometricEnabled().then(setRequireBioForClock);
  }, []);


  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    try {
      const emp = await api.resolveEmployeeForUser(user);
      setEmployee(emp);
      if (!emp) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const entryList = await api.getTimeClockEntriesForEmployee(emp.id);
      const list = Array.isArray(entryList) ? entryList : [];
      setEntries(list);
      const active = api.pickActiveTimeClockEntry(list);
      setActiveEntry(active);
      if (active) {
        const ci = parseMs(active.clock_in);
        const bs = parseMs(active.break_start);
        const be = parseMs(active.break_end);
        let breakSec = 0;
        if (bs && be) breakSec = Math.floor((be - bs) / 1000);
        setElapsed(Math.max(0, Math.floor((Date.now() - (ci || 0)) / 1000) - breakSec));
      } else {
        setElapsed(0);
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
    if (!activeEntry) return;
    const t = setInterval(() => {
      setNow(Date.now());
      const ci = parseMs(activeEntry.clock_in);
      const bs = parseMs(activeEntry.break_start);
      const be = parseMs(activeEntry.break_end);
      let breakSec = 0;
      if (bs && be) breakSec = Math.floor((be - bs) / 1000);
      setElapsed(Math.max(0, Math.floor((Date.now() - (ci || 0)) / 1000) - breakSec));
    }, 1000);
    return () => clearInterval(t);
  }, [activeEntry]);

  const onClockIn = async () => {
    if (!employee) return;
    if (!(await confirmClockBiometricOrAlert())) return;
    setActionLoading(true);
    try {
      await api.clockIn({ employee_id: employee.id });
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Clock in failed');
    } finally {
      setActionLoading(false);
    }
  };

  const onClockOut = async () => {
    const entryId = api.timeClockEntryId(activeEntry);
    if (!entryId) {
      Alert.alert('Error', 'No active time entry to clock out.');
      return;
    }
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

  const onStartBreak = async () => {
    const entryId = api.timeClockEntryId(activeEntry);
    if (!entryId) return;
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

  const onEndBreak = async () => {
    const entryId = api.timeClockEntryId(activeEntry);
    if (!entryId) return;
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

  const inBreak = activeEntry && activeEntry.break_start && !activeEntry.break_end;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (!employee) {
    return (
      <View style={styles.centered}>
        <Text style={styles.msg}>No employee record linked to your account. Use My Dashboard for time clock.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Clock In</Text>
        <Text style={styles.sub}>{employee.first_name} {employee.last_name}</Text>
      </View>
      <View style={styles.bioRow}>
        <View style={styles.bioTextWrap}>
          <Text style={styles.bioLabel}>Require Face ID / fingerprint for clock actions</Text>
          <Text style={styles.bioHint}>Extra check before clock in, clock out, and breaks</Text>
        </View>
        <Switch
          value={requireBioForClock}
          onValueChange={async (v) => {
            setRequireBioForClock(v);
            await setClockBiometricEnabled(v);
          }}
        />
      </View>
      {activeEntry ? (
        <>
          <View style={styles.card}>
            <Text style={styles.clockLabel}>Currently clocked in</Text>
            <Text style={styles.clockTime}>
              {Math.floor(elapsed / 3600)}h {Math.floor((elapsed % 3600) / 60)}m
            </Text>
          </View>
          {inBreak ? (
            <TouchableOpacity style={styles.btnPrimary} onPress={onEndBreak} disabled={actionLoading}>
              <Text style={styles.btnText}>{actionLoading ? '…' : 'End Break'}</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.btnSecondary} onPress={onStartBreak} disabled={actionLoading}>
                <Text style={styles.btnTextSecondary}>{actionLoading ? '…' : 'Start Break'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnDanger} onPress={onClockOut} disabled={actionLoading}>
                <Text style={styles.btnText}>{actionLoading ? '…' : 'Clock Out'}</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      ) : (
        <TouchableOpacity style={styles.btnPrimary} onPress={onClockIn} disabled={actionLoading}>
          <Text style={styles.btnText}>{actionLoading ? '…' : 'Clock In'}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  msg: { color: '#64748b', padding: 24, textAlign: 'center' },
  header: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  sub: { fontSize: 14, color: '#64748b', marginTop: 4 },
  bioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  bioTextWrap: { flex: 1 },
  bioLabel: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  bioHint: { fontSize: 12, color: '#64748b', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 24, marginBottom: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  clockLabel: { fontSize: 14, color: '#64748b' },
  clockTime: { fontSize: 28, fontWeight: '700', color: '#0f172a', marginTop: 8 },
  btnPrimary: { backgroundColor: '#22c55e', padding: 18, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  btnSecondary: { backgroundColor: '#e2e8f0', padding: 18, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  btnDanger: { backgroundColor: '#ef4444', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  btnTextSecondary: { color: '#0f172a', fontWeight: '600', fontSize: 18 },
});
