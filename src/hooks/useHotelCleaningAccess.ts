import { useState, useEffect, useMemo } from 'react';
import type { User } from '../context/AuthContext';
import type { UserRole } from '../types/auth';
import { getPrimaryRoleFromUser, mergeNestedAuthUserPayload } from '../types/auth';
import * as api from '../api';
import {
  isHotelEmployeeRole,
  isHotelManagementRole,
  isHotelMotelScopedManagerRole,
  userOrganizationLooksMotel,
  recordLooksMotelRow,
  logHotelAccessDebug,
  employeeOrgFieldsMentionMotelOrHotel,
} from '../lib/motelEmployeeAccess';

export type HotelAccessVariant = 'employee_cleaning' | 'admin_rooms' | null;

/** Company row or its parent organization must classify as motel/hotel. */
async function rowIsMotelCompany(row: Record<string, any>): Promise<boolean> {
  if (recordLooksMotelRow(row)) return true;
  const nested = row.organization;
  if (nested && typeof nested === 'object' && recordLooksMotelRow(nested as Record<string, any>)) {
    return true;
  }
  const orgId =
    nested && typeof nested === 'object' && (nested as any).id != null
      ? String((nested as any).id)
      : String(row.organization_id ?? '').trim();
  if (!orgId) return false;
  try {
    const org = (await api.getOrganization(orgId)) as Record<string, any>;
    return recordLooksMotelRow(org);
  } catch {
    return false;
  }
}

/** Same as `HotelCleaningScreen` — resolve `organization_id` from a company row. */
function companyRowOrganizationId(c: Record<string, any> | null | undefined): string {
  if (!c || typeof c !== 'object') return '';
  const v = c.organization_id ?? c.organization;
  if (v != null && typeof v === 'object' && (v as any).id != null) return String((v as any).id).trim();
  return v != null ? String(v).trim() : '';
}

/**
 * Org / company managers: only when **all** resolved orgs & assigned companies are motel-scoped
 * (not gas station, car wash, etc.). Super admin is handled separately (always allowed).
 */
async function verifyMotelContextForManagers(merged: User, managerRole: UserRole | null): Promise<boolean> {
  if (userOrganizationLooksMotel(merged)) return true;

  const oIds = api.organizationIdHintsFromAuthUser(merged);
  const cIds = api.companyIdHintsFromAuthUser(merged);

  /**
   * Organization rows on `/auth/user/` often don’t “look motel” for **company** managers
   * (generic parent org name/type). Gate them via assigned companies under motel orgs instead.
   */
  if (managerRole === 'organization_manager' && oIds.length > 0) {
    for (const oid of oIds) {
      try {
        const org = (await api.getOrganization(oid)) as Record<string, any>;
        if (!recordLooksMotelRow(org)) return false;
      } catch {
        return false;
      }
    }
  }

  if (cIds.length > 0) {
    for (const cid of cIds) {
      try {
        const company = (await api.getCompany(cid)) as Record<string, any>;
        if (!(await rowIsMotelCompany(company))) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  if (managerRole === 'organization_manager' && oIds.length > 0) return true;

  if (managerRole === 'organization_manager') {
    try {
      const orgs = await api.getOrganizations();
      if (!Array.isArray(orgs) || orgs.length === 0) return false;
      return orgs.every((o) => recordLooksMotelRow(o as Record<string, any>));
    } catch {
      return false;
    }
  }

  if (managerRole === 'company_manager') {
    try {
      const [orgsRaw, compsRaw] = await Promise.all([
        api.getOrganizations().catch(() => []),
        api.getCompanies().catch(() => []),
      ]);
      const orgs = Array.isArray(orgsRaw) ? orgsRaw : [];
      const companies = Array.isArray(compsRaw) ? compsRaw : [];
      if (!companies.length) return false;

      const motelOrgIds = new Set(
        orgs
          .filter((o: any) => recordLooksMotelRow(o))
          .map((o: any) => String(o?.id ?? '').trim())
          .filter(Boolean)
      );

      const underMotels = companies.filter((c: any) => {
        const oid = companyRowOrganizationId(c);
        if (oid && motelOrgIds.has(oid)) return true;
        const nested = c.organization;
        return nested && typeof nested === 'object' && recordLooksMotelRow(nested);
      });
      /**
       * Some roles get an empty org list; company rows may only expose `organization_id`.
       * `rowIsMotelCompany` loads the parent org when needed — use the full company list as pool then.
       */
      const pool = underMotels.length > 0 ? underMotels : companies;

      const uid = String(merged.id ?? '').trim();
      if (!uid) return false;

      const strict = api.filterCompaniesStrictlyForCompanyManager(pool, uid);
      const assignee =
        strict.length > 0
          ? strict
          : api.filterCompaniesForCompanyManagerRole(pool, 'company_manager', uid);
      if (!assignee.length) return false;

      for (const c of assignee) {
        if (!(await rowIsMotelCompany(c as Record<string, any>))) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function roomRowCompanyId(r: any): string {
  const c = r?.company_id ?? r?.company;
  if (c != null && typeof c === 'object' && (c as any).id != null) return String((c as any).id).trim();
  return c != null && c !== '' ? String(c).trim() : '';
}

/**
 * Many motel employees have thin `/auth/user/` org fields or a broken `resolveEmployeeForUser` link,
 * but `/motel/rooms/` is already scoped to their company/session. Use it as a probe (no new endpoints).
 */
async function verifyMotelContextForEmployee(merged: User): Promise<boolean> {
  if (userOrganizationLooksMotel(merged)) return true;
  if (employeeOrgFieldsMentionMotelOrHotel(merged)) return true;

  const hints = api.companyIdHintsFromAuthUser(merged as any);
  const myCid = String(hints[0] ?? (merged as any).company_id ?? '').trim();

  const paramSets: Array<Record<string, any> | undefined> = [];
  if (myCid) {
    paramSets.push(
      { company_id: myCid },
      { company: myCid },
      { companyId: myCid },
      { company__id: myCid }
    );
  }
  paramSets.push(undefined);

  for (const params of paramSets) {
    try {
      const list = await api.getMotelRooms(params);
      const arr = Array.isArray(list) ? list : [];
      if (arr.length === 0) continue;
      if (!myCid) return true;
      if (arr.some((r) => roomRowCompanyId(r) === myCid)) return true;
      return true;
    } catch {
      /* next */
    }
  }

  try {
    const emp = await api.resolveEmployeeForUser(merged);
    const cid = api.companyIdFromSchedulerEmployee(emp, merged);
    if (!cid) return false;
    const company = (await api.getCompany(cid)) as Record<string, any>;
    return rowIsMotelCompany(company);
  } catch {
    return false;
  }
}

/**
 * Hotel drawer + screen:
 * - **super_admin**: always
 * - **organization_manager** / **company_manager**: only when every scoped org/assigned company is motel/hotel (via API), not gas station / car wash / etc.
 * - **employee** (and legacy floor-staff `user.role` strings): only when their scheduler company resolves to a motel org
 */
export function useHotelCleaningAccess(
  user: User | null,
  role: UserRole | null
): {
  allowed: boolean;
  resolved: boolean;
  variant: HotelAccessVariant;
  isMotelEmployeeSync: boolean;
} {
  const [gateUser, setGateUser] = useState<User | null>(null);
  const [employeeAllow, setEmployeeAllow] = useState(false);
  const [adminAllow, setAdminAllow] = useState(false);
  const [probeDone, setProbeDone] = useState(false);

  useEffect(() => {
    if (!user) {
      setGateUser(null);
      setEmployeeAllow(false);
      setAdminAllow(false);
      setProbeDone(true);
      return;
    }

    const normalizedUser = mergeNestedAuthUserPayload(user) as User;
    setGateUser(normalizedUser);
    setEmployeeAllow(false);
    setAdminAllow(false);
    setProbeDone(false);

    let cancelled = false;
    (async () => {
      let merged: User = normalizedUser;
      try {
        const fresh = await api.getCurrentUser();
        if (!cancelled && fresh && typeof fresh === 'object') {
          merged = mergeNestedAuthUserPayload({ ...(user as any), ...(fresh as any) }) as User;
          setGateUser(merged);
        }
      } catch {
        /* keep merged */
      }
      if (cancelled) return;

      /** Context `role` can be null on first paint; `/auth/user/` roles must still drive motel admin access. */
      const effectiveRole = role ?? getPrimaryRoleFromUser(merged);

      let empOk = false;
      let admOk = false;

      if (effectiveRole === 'super_admin') {
        admOk = true;
      } else if (isHotelMotelScopedManagerRole(effectiveRole)) {
        admOk = await verifyMotelContextForManagers(merged, effectiveRole);
      } else if (isHotelEmployeeRole(merged, effectiveRole)) {
        empOk = await verifyMotelContextForEmployee(merged);
      }

      if (!cancelled) {
        setEmployeeAllow(empOk);
        setAdminAllow(admOk);
        setProbeDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, role]);

  const effectiveUser = gateUser ?? user;

  const effectiveRole = useMemo(
    () => role ?? getPrimaryRoleFromUser(effectiveUser as any),
    [role, effectiveUser]
  );

  const syncMotelOrg = useMemo(() => userOrganizationLooksMotel(effectiveUser), [effectiveUser]);
  const isMotelEmployeeSync = useMemo(
    () => Boolean(effectiveUser && isHotelEmployeeRole(effectiveUser, effectiveRole) && syncMotelOrg),
    [effectiveUser, effectiveRole, syncMotelOrg]
  );

  const allowed = Boolean(employeeAllow || adminAllow);

  const needsProbe =
    Boolean(user) &&
    (isHotelEmployeeRole(effectiveUser, effectiveRole) || isHotelManagementRole(effectiveRole));

  const resolved = Boolean(!user || !needsProbe || probeDone);

  const variant = useMemo((): HotelAccessVariant => {
    if (!allowed || !effectiveUser) return null;
    if (adminAllow && isHotelManagementRole(effectiveRole)) return 'admin_rooms';
    if (employeeAllow && isHotelEmployeeRole(effectiveUser, effectiveRole)) return 'employee_cleaning';
    if (adminAllow) return 'admin_rooms';
    if (employeeAllow) return 'employee_cleaning';
    return null;
  }, [allowed, effectiveUser, effectiveRole, adminAllow, employeeAllow]);

  useEffect(() => {
    logHotelAccessDebug(effectiveUser, effectiveRole, {
      syncMotelOrg,
      isMotelEmployee: isMotelEmployeeSync,
    });
  }, [effectiveUser, effectiveRole, syncMotelOrg, isMotelEmployeeSync]);

  useEffect(() => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    console.log('[Hotel] employeeAllow:', employeeAllow, 'adminAllow:', adminAllow, 'variant:', variant);
  }, [employeeAllow, adminAllow, variant]);

  return { allowed, resolved, variant, isMotelEmployeeSync };
}
