import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api';

type Company = { id: string; name: string; company_manager_id?: string; [k: string]: any };

function getWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export default function ScheduleScreen() {
  const { user, role } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const filteredCompanies = React.useMemo(() => {
    if (role === 'manager' && user?.id) {
      return companies.filter((c) => c.company_manager_id === user.id);
    }
    return companies;
  }, [companies, role, user?.id]);

  const loadCompanies = useCallback(async () => {
    try {
      const list = await api.getCompanies(
        role === 'operations_manager' && user?.id ? { organization_manager: user.id } : undefined
      );
      setCompanies(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn(e);
    }
  }, [role, user?.id]);

  const loadShifts = useCallback(async () => {
    if (!selectedCompanyId) {
      setShifts([]);
      return;
    }
    const { start, end } = getWeekRange();
    try {
      const raw = await api.getShifts({
        company: selectedCompanyId,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
      });
      setShifts(Array.isArray(raw) ? raw : []);
    } catch (e) {
      console.warn(e);
      setShifts([]);
    }
  }, [selectedCompanyId]);

  const load = useCallback(async () => {
    setLoading(true);
    await loadCompanies();
    setLoading(false);
  }, [loadCompanies]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (filteredCompanies.length > 0 && !selectedCompanyId) {
      setSelectedCompanyId(filteredCompanies[0].id);
    }
  }, [filteredCompanies, selectedCompanyId]);

  useEffect(() => {
    if (selectedCompanyId) loadShifts();
    else setShifts([]);
  }, [selectedCompanyId, loadShifts]);

  const onRefresh = () => {
    setRefreshing(true);
    loadCompanies().then(() => loadShifts()).finally(() => setRefreshing(false));
  };

  const { start } = getWeekRange();
  const weekLabel = `Week of ${start.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;

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
        <Text style={styles.title}>Schedule</Text>
        <Text style={styles.weekLabel}>{weekLabel}</Text>
      </View>
      {filteredCompanies.length > 0 && (
        <ScrollView horizontal style={styles.tabs} contentContainerStyle={styles.tabsContent} showsHorizontalScrollIndicator={false}>
          {filteredCompanies.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.tab, selectedCompanyId === c.id && styles.tabActive]}
              onPress={() => setSelectedCompanyId(c.id)}
            >
              <Text style={[styles.tabText, selectedCompanyId === c.id && styles.tabTextActive]} numberOfLines={1}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <FlatList
        data={shifts}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>{selectedCompanyId ? 'No shifts this week' : 'Select a company'}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {new Date(item.start_time).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
            <Text style={styles.cardSub}>End: {item.end_time ? new Date(item.end_time).toLocaleTimeString([], { timeStyle: 'short' }) : '-'}</Text>
            {item.employee_name && <Text style={styles.cardMeta}>{item.employee_name}</Text>}
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
  weekLabel: { fontSize: 13, color: '#64748b', marginTop: 4 },
  tabs: { maxHeight: 48, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tabsContent: { paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, marginRight: 8 },
  tabActive: { backgroundColor: '#3b82f6' },
  tabText: { fontSize: 14, color: '#64748b' },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  listContent: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  cardSub: { fontSize: 13, color: '#64748b', marginTop: 4 },
  cardMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  empty: { padding: 24, textAlign: 'center', color: '#64748b' },
});
