import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

export default function CalendarScreen() {
  const { user, role } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isManager = ['super_admin', 'operations_manager', 'manager'].includes(role || '');
  const isEmployee = ['employee', 'house_keeping', 'maintenance'].includes(role || '');

  const load = useCallback(async () => {
    try {
      let empId: string | null = null;
      if (isEmployee && user?.id) {
        const empList = await api.getEmployees({ user: user.id });
        const emp = Array.isArray(empList) ? empList[0] : null;
        empId = emp?.id || null;
        setEmployeeId(empId);
      }
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      const [eventsRaw, shiftsRaw] = await Promise.all([
        api.getCalendarEvents({ user: user?.id, start_time__gte: monthStart.toISOString(), end_time__lte: monthEnd.toISOString() }),
        empId
          ? api.getShifts({ employee: empId, start_time__gte: monthStart.toISOString(), start_time__lte: monthEnd.toISOString() })
          : isManager
            ? api.getShifts({ start_time__gte: monthStart.toISOString(), start_time__lte: monthEnd.toISOString() })
            : [],
      ]);
      setEvents(eventsRaw);
      setShifts(Array.isArray(shiftsRaw) ? shiftsRaw : []);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, isManager, isEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  const combined = [
    ...events.map((e) => ({ ...e, type: 'event', start: e.start_time, title: e.title || 'Event' })),
    ...shifts.map((s) => ({ ...s, type: 'shift', start: s.start_time, title: 'Shift' })),
  ].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Calendar</Text>
        <Text style={styles.subtitle}>Events and shifts this month</Text>
      </View>
      <FlatList
        data={combined}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>No events or shifts this month</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardDate}>
              {new Date(item.start).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              {item.end_time ? ` – ${new Date(item.end_time).toLocaleTimeString([], { timeStyle: 'short' })}` : ''}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4 },
  listContent: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  cardDate: { fontSize: 13, color: '#64748b', marginTop: 4 },
  empty: { padding: 24, textAlign: 'center', color: '#64748b' },
});
