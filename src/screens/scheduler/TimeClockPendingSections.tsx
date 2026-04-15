import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';

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

function employeeDisplayName(emp: any): string {
  const fn = (emp?.first_name || '').trim();
  const ln = (emp?.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return emp?.email || emp?.nickname || '—';
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

function employeeDepartmentDisplay(emp: any): string {
  if (!emp || typeof emp !== 'object') return '—';
  const d = emp.department;
  if (d && typeof d === 'object' && (d as any).name) return String((d as any).name);
  const n = emp.department_name ?? (typeof emp.department === 'string' ? emp.department : '');
  return n ? String(n) : '—';
}

function rowDepartmentOrCompany(row: any, emp: any, companyList: any[]): string {
  const dep = employeeDepartmentDisplay(emp);
  if (dep && dep !== '—') return dep;
  return requestCompanyLabel(row, companyList);
}

function leaveRequestId(l: any): string {
  return String(l?.id ?? l?.pk ?? l?.uuid ?? '').trim();
}

function leaveEmployeeRecord(l: any): any {
  const e = l?.employee;
  if (e && typeof e === 'object') return e;
  return {};
}

function leaveEmployeeId(l: any): string {
  const e = l?.employee;
  if (e && typeof e === 'object') return String(e.id ?? e.pk ?? '');
  return String(l?.employee_id ?? '').trim();
}

function leaveStartIso(l: any): string | undefined {
  const v =
    l?.start_datetime ??
    l?.start_time ??
    l?.start_at ??
    l?.from ??
    (l?.start_date && l?.start_time == null ? l.start_date : null) ??
    l?.start_date;
  return v != null && String(v) !== '' ? String(v) : undefined;
}

function leaveEndIso(l: any): string | undefined {
  const v =
    l?.end_datetime ??
    l?.end_time ??
    l?.end_at ??
    l?.to ??
    (l?.end_date && l?.end_time == null ? l.end_date : null) ??
    l?.end_date;
  return v != null && String(v) !== '' ? String(v) : undefined;
}

function leaveDurationHours(l: any): number {
  const s = leaveStartIso(l);
  const e = leaveEndIso(l);
  if (s && e) {
    const t1 = new Date(s).getTime();
    const t2 = new Date(e).getTime();
    if (!Number.isNaN(t1) && !Number.isNaN(t2) && t2 >= t1) return (t2 - t1) / 3600000;
  }
  const n = Number(l?.duration_hours ?? l?.hours ?? l?.total_hours);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function replacementShift(r: any): any {
  return r?.original_shift ?? r?.shift ?? r?.target_shift ?? null;
}

function replacementPrimaryEmployee(r: any): any {
  const e = r?.requesting_employee ?? r?.employee ?? r?.created_by ?? r?.user;
  return e && typeof e === 'object' ? e : {};
}

function replacementEmployeeId(r: any): string {
  const e = replacementPrimaryEmployee(r);
  if (e?.id != null) return String(e.id);
  return String(r?.employee_id ?? r?.requesting_employee_id ?? '').trim();
}

function swapRequestId(r: any): string {
  return String(r?.id ?? r?.pk ?? '').trim();
}

function shiftDurationHours(shift: any): number {
  if (!shift) return 0;
  const s = shift.start_time ?? shift.start ?? shift.start_at;
  const e = shift.end_time ?? shift.end ?? shift.end_at;
  if (!s || !e) return 0;
  const t1 = new Date(s).getTime();
  const t2 = new Date(e).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2) || t2 < t1) return 0;
  return (t2 - t1) / 3600000;
}

function replacementDepartmentOrCompany(r: any, emp: any, companies: any[]): string {
  const dep = employeeDepartmentDisplay(emp);
  if (dep && dep !== '—') return dep;
  const lab = requestCompanyLabel(r, companies);
  if (lab !== '—') return lab;
  const sh = replacementShift(r);
  const fake = {
    company: sh?.company,
    company_id: sh?.company_id ?? sh?.company,
  };
  return requestCompanyLabel(fake, companies);
}

type SectionBase = {
  employeeById: Map<string, any>;
  companies: any[];
  actionLoading: boolean;
};

export function LeaveRequestsSection({
  items,
  employeeById,
  companies,
  actionLoading,
  onApprove,
}: SectionBase & {
  items: any[];
  onApprove: (row: any) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Leave Requests</Text>
      {items.length === 0 ? (
        <Text style={styles.plainEmpty}>No pending leave requests</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
          <View style={styles.table}>
            <View style={styles.trHead}>
              {['Employee', 'Department', 'Start', 'End', 'Duration', 'Action'].map((h) => (
                <Text key={h} style={h === 'Action' ? styles.thAction : styles.th}>
                  {h}
                </Text>
              ))}
            </View>
            {items.map((row, ri) => {
              const eid = leaveEmployeeId(row);
              const emp = (eid ? employeeById.get(eid) : null) || leaveEmployeeRecord(row);
              const start = leaveStartIso(row);
              const end = leaveEndIso(row);
              const hrs = leaveDurationHours(row);
              const id = leaveRequestId(row);
              return (
                <View key={id || `leave-${ri}`} style={styles.tr}>
                  <Text style={styles.td}>{employeeDisplayName(emp)}</Text>
                  <Text style={styles.td}>{rowDepartmentOrCompany(row, emp, companies)}</Text>
                  <Text style={styles.td}>
                    {start ? `${formatDateShort(start)} ${formatHm(start)}` : '—'}
                  </Text>
                  <Text style={styles.td}>{end ? `${formatDateShort(end)} ${formatHm(end)}` : '—'}</Text>
                  <Text style={styles.td}>{hrs.toFixed(2)}</Text>
                  <View style={styles.tdAction}>
                    <TouchableOpacity
                      style={styles.approveBtn}
                      onPress={() => onApprove(row)}
                      disabled={actionLoading || !id}
                    >
                      <Text style={styles.approveBtnText}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export function SwapRequestsSection({
  items,
  employeeById,
  companies,
  actionLoading,
  onApprove,
}: SectionBase & {
  items: any[];
  onApprove: (row: any) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Swap Requests</Text>
      {items.length === 0 ? (
        <Text style={styles.plainEmpty}>No pending swap requests</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
          <View style={styles.table}>
            <View style={styles.trHead}>
              {['Employee', 'Department', 'Start', 'End', 'Duration', 'Action'].map((h) => (
                <Text key={h} style={h === 'Action' ? styles.thAction : styles.th}>
                  {h}
                </Text>
              ))}
            </View>
            {items.map((row, ri) => {
              const eid = replacementEmployeeId(row);
              const emp = (eid ? employeeById.get(eid) : null) || replacementPrimaryEmployee(row);
              const sh = replacementShift(row);
              const s = sh?.start_time ?? sh?.start ?? sh?.start_at;
              const e = sh?.end_time ?? sh?.end ?? sh?.end_at;
              const hrs = shiftDurationHours(sh);
              const id = swapRequestId(row);
              return (
                <View key={id || `swap-${ri}`} style={styles.tr}>
                  <Text style={styles.td}>{employeeDisplayName(emp)}</Text>
                  <Text style={styles.td}>{replacementDepartmentOrCompany(row, emp, companies)}</Text>
                  <Text style={styles.td}>
                    {s ? `${formatDateShort(s)} ${formatHm(s)}` : '—'}
                  </Text>
                  <Text style={styles.td}>{e ? `${formatDateShort(e)} ${formatHm(e)}` : '—'}</Text>
                  <Text style={styles.td}>{hrs.toFixed(2)}</Text>
                  <View style={styles.tdAction}>
                    <TouchableOpacity
                      style={styles.approveBtn}
                      onPress={() => onApprove(row)}
                      disabled={actionLoading || !id}
                    >
                      <Text style={styles.approveBtnText}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  plainEmpty: {
    fontSize: 14,
    color: '#94a3b8',
    paddingVertical: 20,
  },
  table: { minWidth: 720 },
  trHead: { flexDirection: 'row', backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  th: {
    width: 120,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  thAction: {
    width: 100,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', alignItems: 'center' },
  td: {
    width: 120,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#0f172a',
  },
  tdAction: { width: 100, paddingHorizontal: 8, paddingVertical: 8 },
  approveBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
