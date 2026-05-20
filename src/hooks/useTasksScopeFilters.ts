import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '../context/AuthContext';
import type { UserRole } from '../types/auth';
import * as api from '../api';
import { companyIdHintsFromAuthUser, organizationIdHintsFromAuthUser } from '../api';

export type ScopePickerOption = { id: string; label: string };

export function useTasksScopeFilters(user: User | null, role: UserRole | null) {
  const isSuperAdmin = role === 'super_admin';
  const isOrgManager = role === 'organization_manager';
  const isCompanyManager = role === 'company_manager';
  const showOrgFilter = isSuperAdmin || isOrgManager;
  const showCompanyFilter = isSuperAdmin || isOrgManager || isCompanyManager;

  const [organizations, setOrganizations] = useState<ScopePickerOption[]>([{ id: 'all', label: 'All organizations' }]);
  const [companies, setCompanies] = useState<ScopePickerOption[]>([{ id: 'all', label: 'All companies' }]);
  const [filterOrgId, setFilterOrgId] = useState('all');
  const [filterCompanyId, setFilterCompanyId] = useState('all');
  const [scopeReady, setScopeReady] = useState(false);

  const loadOrganizations = useCallback(async () => {
    if (!showOrgFilter) {
      setOrganizations([{ id: 'all', label: 'All organizations' }]);
      return;
    }
    try {
      const raw = await api.getOrganizations();
      const list = Array.isArray(raw) ? raw : [];
      const opts: ScopePickerOption[] = [{ id: 'all', label: 'All organizations' }];
      for (const o of list) {
        const id = String((o as any).id ?? '').trim();
        if (!id) continue;
        opts.push({ id, label: String((o as any).name ?? id) });
      }
      setOrganizations(opts);
    } catch {
      setOrganizations([{ id: 'all', label: 'All organizations' }]);
    }
  }, [showOrgFilter]);

  const loadCompanies = useCallback(async () => {
    if (!showCompanyFilter) {
      setCompanies([{ id: 'all', label: 'All companies' }]);
      return;
    }
    try {
      const orgId = filterOrgId !== 'all' ? filterOrgId : '';
      const raw = await api.getCompanies(orgId ? { organization: orgId } : undefined);
      let list = Array.isArray(raw) ? raw : [];
      if (orgId) {
        list = list.filter((c: any) => {
          const oid =
            (c as any).organization_id ??
            ((c as any).organization && typeof (c as any).organization === 'object'
              ? (c as any).organization.id
              : (c as any).organization);
          return String(oid ?? '').trim() === orgId;
        });
      }
      if (isCompanyManager && user) {
        const hints = new Set(companyIdHintsFromAuthUser(user as any));
        if (hints.size > 0) {
          list = list.filter((c: any) => hints.has(String((c as any).id ?? '').trim()));
        }
      }
      const opts: ScopePickerOption[] = [{ id: 'all', label: 'All companies' }];
      for (const c of list) {
        const id = String((c as any).id ?? '').trim();
        if (!id) continue;
        opts.push({ id, label: String((c as any).name ?? id) });
      }
      setCompanies(opts);
    } catch {
      setCompanies([{ id: 'all', label: 'All companies' }]);
    }
  }, [showCompanyFilter, filterOrgId, isCompanyManager, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadOrganizations();
      if (cancelled) return;
      if (isOrgManager && user) {
        const hints = organizationIdHintsFromAuthUser(user as any);
        if (hints.length === 1 && filterOrgId === 'all') {
          setFilterOrgId(hints[0]);
        }
      }
      if (isCompanyManager && user && filterOrgId === 'all') {
        const coHints = companyIdHintsFromAuthUser(user as any);
        if (coHints.length === 1) setFilterCompanyId(coHints[0]);
      }
      setScopeReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOrganizations, isOrgManager, isCompanyManager, user, filterOrgId]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  const onSelectOrganization = useCallback((id: string) => {
    setFilterOrgId(id);
    setFilterCompanyId('all');
  }, []);

  const companyOptions = useMemo(() => companies, [companies]);
  const organizationOptions = useMemo(() => organizations, [organizations]);

  return {
    showOrgFilter,
    showCompanyFilter,
    organizationOptions,
    companyOptions,
    filterOrgId,
    filterCompanyId,
    setFilterCompanyId,
    onSelectOrganization,
    scopeReady,
  };
}
