import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
  Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import * as api from '../../api';

type Organization = { id: string; name: string; [k: string]: any };
type Company = { id: string; name: string; organization_id?: string; company_manager_id?: string; [k: string]: any };

function companyOrganizationId(c: Company | null | undefined): string {
  if (c == null) return '';
  const v = c.organization_id ?? (c as any).organization;
  return v != null ? String(v) : '';
}

function employeeNameFromShift(s: any): string {
  const e = s.employee;
  if (e && typeof e === 'object') {
    const fn = String(e.first_name || '').trim();
    const ln = String(e.last_name || '').trim();
    if (fn || ln) return `${fn} ${ln}`.trim();
    if (e.email) return String(e.email);
  }
  if (typeof e === 'string' && e) return e;
  const n =
    s.employee_name ||
    s.employee_full_name ||
    (s as any).original_employee_name ||
    (s as any).user_name;
  if (n) return String(n);
  return '(Original)';
}

function shiftCompanyId(s: any): string {
  return String(s.company_id ?? s.company ?? (s as any).company?.id ?? '');
}

function markedAtLabel(s: any): string {
  const raw = s.missed_at ?? s.marked_missed_at ?? s.missed_marked_at ?? s.updated_at;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return `Marked at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function formatShiftWhen(s: any): string {
  const st = s.start_time ? new Date(s.start_time) : null;
  const et = s.end_time ? new Date(s.end_time) : null;
  if (!st || Number.isNaN(st.getTime())) return '—';
  const datePart = st.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const t1 = st.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!et || Number.isNaN(et.getTime())) return `${datePart} ${t1}`;
  const t2 = et.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} ${t1} - ${t2}`;
}

function requestCompanyId(r: any): string {
  return String(
    r.company_id ??
      r.company ??
      r.shift?.company_id ??
      r.shift?.company ??
      r.original_shift?.company_id ??
      ''
  );
}

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
      <View style={modalStyles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={modalStyles.box}>
          <Text style={modalStyles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={modalStyles.row}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <Text style={modalStyles.rowText}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
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
  row: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rowText: { fontSize: 16, color: '#0f172a' },
});

type TabKey = 'missed' | 'replacement';

export default function MissedShiftsScreen() {
  const { user, role } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [orgFilter, setOrgFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [missedShifts, setMissedShifts] = useState<any[]>([]);
  const [replacementRequests, setReplacementRequests] = useState<any[]>([]);
  const [tab, setTab] = useState<TabKey>('missed');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orgModal, setOrgModal] = useState(false);
  const [companyModal, setCompanyModal] = useState(false);
  const initialDone = useRef(false);

  const needsOrg = role === 'super_admin' || role === 'admin' || role === 'operations_manager';
  const isOrgManager = role === 'operations_manager' && user?.id;

  const companiesForOrg = useMemo(() => {
    let list = [...companies];
    list = api.filterCompaniesForCompanyManagerRole(list, role, user?.id);
    if (orgFilter !== 'all') {
      const oid = String(orgFilter);
      list = list.filter((c) => companyOrganizationId(c) === oid);
    }
    return list;
  }, [companies, role, user?.id, orgFilter]);

  const orgOptions = useMemo(() => {
    const base = [{ id: 'all', label: 'All Organizations' }];
    return [...base, ...organizations.map((o) => ({ id: o.id, label: o.name }))];
  }, [organizations]);

  const companyOptions = useMemo(() => {
    const base = [{ id: 'all', label: 'All Companies' }];
    return [...base, ...companiesForOrg.map((c) => ({ id: c.id, label: c.name }))];
  }, [companiesForOrg]);

  const orgFilterLabel = orgOptions.find((o) => o.id === orgFilter)?.label || 'All Organizations';
  const companyFilterLabel = companyOptions.find((o) => o.id === companyFilter)?.label || 'All Companies';

  const loadMeta = useCallback(async () => {
    try {
      const orgsRaw = await api.getOrganizations(isOrgManager ? { organization_manager: user?.id } : undefined);
      setOrganizations(Array.isArray(orgsRaw) ? orgsRaw : []);

      let compRaw: any[] = [];
      if (isOrgManager || role === 'manager') {
        compRaw = await api.getCompanies();
      } else if (needsOrg) {
        try {
          compRaw = await api.getCompanies();
        } catch {
          compRaw = [];
        }
        if (!Array.isArray(compRaw)) compRaw = [];
      } else {
        compRaw = await api.getCompanies();
      }
      setCompanies(Array.isArray(compRaw) ? compRaw : []);
    } catch (e) {
      console.warn(e);
    }
  }, [isOrgManager, role, user?.id, needsOrg]);

  const loadLists = useCallback(async () => {
    try {
      const shiftParams: Record<string, any> = { is_missed: true };
      if (companyFilter !== 'all') {
        shiftParams.company = companyFilter;
      }
      const [shiftRaw, rrRaw] = await Promise.all([
        api.getShifts(shiftParams),
        api.getReplacementRequests(),
      ]);
      let shifts = Array.isArray(shiftRaw) ? shiftRaw : [];
      if (orgFilter !== 'all' && companyFilter === 'all') {
        const allowed = new Set(companiesForOrg.map((c) => c.id));
        shifts = shifts.filter((s) => allowed.has(shiftCompanyId(s)));
      }
      if (role === 'manager' && user?.id && companyFilter === 'all' && orgFilter === 'all') {
        const allowed = new Set(
          api.filterCompaniesForCompanyManagerRole(companies, role, user.id).map((c) => c.id)
        );
        shifts = shifts.filter((s) => allowed.has(shiftCompanyId(s)));
      }
      setMissedShifts(shifts);

      let rr = Array.isArray(rrRaw) ? rrRaw : [];
      if (orgFilter !== 'all' && companyFilter === 'all') {
        const allowed = new Set(companiesForOrg.map((c) => c.id));
        rr = rr.filter((r) => allowed.has(requestCompanyId(r)));
      }
      if (role === 'manager' && user?.id && companyFilter === 'all' && orgFilter === 'all') {
        const allowed = new Set(
          api.filterCompaniesForCompanyManagerRole(companies, role, user.id).map((c) => c.id)
        );
        rr = rr.filter((r) => allowed.has(requestCompanyId(r)));
      }
      setReplacementRequests(rr);
    } catch (e) {
      console.warn(e);
      setMissedShifts([]);
      setReplacementRequests([]);
    }
  }, [companyFilter, orgFilter, companiesForOrg, role, user?.id, companies]);

  const load = useCallback(async () => {
    if (!initialDone.current) setLoading(true);
    await loadMeta();
    await loadLists();
    initialDone.current = true;
    setLoading(false);
    setRefreshing(false);
  }, [loadMeta, loadLists]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (companyFilter === 'all') return;
    const ok = companiesForOrg.some((c) => c.id === companyFilter);
    if (!ok) setCompanyFilter('all');
  }, [companiesForOrg, companyFilter]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const missedSorted = useMemo(() => {
    return [...missedShifts].sort((a, b) => {
      const ta = a.start_time ? new Date(a.start_time).getTime() : 0;
      const tb = b.start_time ? new Date(b.start_time).getTime() : 0;
      return tb - ta;
    });
  }, [missedShifts]);

  const rrSorted = useMemo(() => {
    return [...replacementRequests].sort((a, b) => {
      const ta = new Date(a.created_at ?? a.updated_at ?? 0).getTime();
      const tb = new Date(b.created_at ?? b.updated_at ?? 0).getTime();
      return tb - ta;
    });
  }, [replacementRequests]);

  const listData = tab === 'missed' ? missedSorted : rrSorted;
  const emptyText =
    tab === 'missed'
      ? 'No missed shifts match the current filters.'
      : 'No replacement requests match the current filters.';

  const renderMissedCard = ({ item }: { item: any }) => (
    <View style={styles.missedCard}>
      <View style={styles.missedCardInner}>
        <View style={styles.avatar}>
          <MaterialCommunityIcons name="account-outline" size={22} color="#94a3b8" />
        </View>
        <View style={styles.missedCardBody}>
          <Text style={styles.empName} numberOfLines={1}>
            {employeeNameFromShift(item)}
          </Text>
          <View style={styles.shiftRow}>
            <MaterialCommunityIcons name="clock-outline" size={16} color="#64748b" />
            <Text style={styles.shiftWhen}>{formatShiftWhen(item)}</Text>
          </View>
          <View style={styles.badgeRow}>
            <View style={styles.missedBadge}>
              <Text style={styles.missedBadgeText}>Missed</Text>
            </View>
            {markedAtLabel(item) ? <Text style={styles.markedAt}>{markedAtLabel(item)}</Text> : null}
          </View>
        </View>
      </View>
    </View>
  );

  const renderReplacementCard = ({ item }: { item: any }) => {
    const status = String(item.status || item.state || 'pending');
    const title =
      item.reason ||
      item.notes ||
      `Replacement request · ${status.replace(/_/g, ' ')}`;
    return (
      <View style={styles.missedCard}>
        <View style={styles.missedCardInner}>
          <View style={styles.avatar}>
            <MaterialCommunityIcons name="swap-horizontal" size={22} color="#94a3b8" />
          </View>
          <View style={styles.missedCardBody}>
            <Text style={styles.empName} numberOfLines={2}>
              {title}
            </Text>
            <View style={styles.shiftRow}>
              <MaterialCommunityIcons name="information-outline" size={16} color="#64748b" />
              <Text style={styles.shiftWhen} numberOfLines={2}>
                {item.id ? `Request #${String(item.id).slice(0, 8)}…` : 'Replacement request'}
                {item.created_at
                  ? ` · ${new Date(item.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}`
                  : ''}
              </Text>
            </View>
            <View style={styles.badgeRow}>
              <View style={[styles.missedBadge, styles.reqBadge]}>
                <Text style={styles.missedBadgeText}>{status}</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#dc2626" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={listData}
        extraData={tab}
        keyExtractor={(item, index) => String(item.id ?? index)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View style={styles.titleRow}>
                <MaterialCommunityIcons name="alert-circle-outline" size={28} color="#dc2626" />
                <Text style={styles.title}>Missed Shifts</Text>
              </View>
              <Text style={styles.subtitle}>Manage missed shifts and replacement requests</Text>
            </View>

            <View style={styles.filtersCard}>
              <View style={styles.filtersLabelRow}>
                <MaterialCommunityIcons name="filter-variant" size={18} color="#64748b" />
                <Text style={styles.filtersLabel}>Filters:</Text>
              </View>
              {needsOrg && (
                <TouchableOpacity style={styles.filterSelect} onPress={() => setOrgModal(true)} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="office-building-outline" size={18} color="#64748b" />
                  <Text style={styles.filterSelectText} numberOfLines={1}>
                    {orgFilterLabel}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.filterSelect} onPress={() => setCompanyModal(true)} activeOpacity={0.85}>
                <MaterialCommunityIcons name="office-building-outline" size={18} color="#64748b" />
                <Text style={styles.filterSelectText} numberOfLines={1}>
                  {companyFilterLabel}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.tabs}>
              <TouchableOpacity
                style={[styles.tab, tab === 'missed' && styles.tabActive]}
                onPress={() => setTab('missed')}
                activeOpacity={0.85}
              >
                <Text style={[styles.tabText, tab === 'missed' && styles.tabTextActive]}>Missed Shifts</Text>
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{missedSorted.length}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, tab === 'replacement' && styles.tabActive]}
                onPress={() => setTab('replacement')}
                activeOpacity={0.85}
              >
                <Text style={[styles.tabText, tab === 'replacement' && styles.tabTextActive]}>
                  Replacement Requests
                </Text>
                <View style={[styles.tabBadge, styles.tabBadgeMuted]}>
                  <Text style={styles.tabBadgeTextMuted}>{rrSorted.length}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </>
        }
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        renderItem={tab === 'missed' ? renderMissedCard : renderReplacementCard}
      />

      <PickerModal
        visible={orgModal}
        title="Organization"
        options={orgOptions}
        onSelect={(id) => {
          setOrgFilter(id);
          setCompanyFilter('all');
        }}
        onClose={() => setOrgModal(false)}
      />
      <PickerModal
        visible={companyModal}
        title="Company"
        options={companyOptions}
        onSelect={(id) => setCompanyFilter(id)}
        onClose={() => setCompanyModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  listContent: { paddingBottom: 48 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 8, lineHeight: 20 },

  filtersCard: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  filtersLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  filtersLabel: { fontSize: 14, fontWeight: '600', color: '#475569' },
  filterSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
  },
  filterSelectText: { flex: 1, fontSize: 15, color: '#0f172a', fontWeight: '500' },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 0,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginRight: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#dc2626' },
  tabText: { fontSize: 15, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#0f172a' },
  tabBadge: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  tabBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  tabBadgeMuted: { backgroundColor: '#e2e8f0' },
  tabBadgeTextMuted: { fontSize: 12, fontWeight: '700', color: '#64748b' },

  missedCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    overflow: 'hidden',
  },
  missedCardInner: {
    flexDirection: 'row',
    padding: 14,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missedCardBody: { flex: 1, minWidth: 0 },
  empName: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  shiftWhen: { flex: 1, fontSize: 14, color: '#475569' },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  missedBadge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  reqBadge: { backgroundColor: '#475569' },
  missedBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff', textTransform: 'capitalize' },
  markedAt: { fontSize: 12, color: '#94a3b8' },

  empty: { padding: 32, textAlign: 'center', color: '#64748b', fontSize: 15 },
});
