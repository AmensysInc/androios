import * as api from '../api';

export type DepartmentOption = {
  id: string;
  name: string;
  /** Synthetic id when API returned nothing — save uses name-style fields. */
  isFallback?: boolean;
};

export type OrgKind = 'motel' | 'gas_station' | 'car_wash';

/** Matches web “organization category” examples when the departments API is empty. */
const STATIC_DEPARTMENTS: Record<OrgKind, string[]> = {
  motel: ['Front Desk', 'House Keeping', 'Maintenance'],
  gas_station: ['Cashier', 'Maintenance'],
  car_wash: ['Detailer', 'Maintenance'],
};

export function inferOrganizationKind(
  organizationName: string,
  companyName: string,
  companyType?: string
): OrgKind | null {
  const t = `${companyType ?? ''} ${organizationName} ${companyName}`.toLowerCase();
  if (/\b(motel|hotel|inn|lodg|resort|hostel|b\s*&\s*b|bnb)\b/.test(t)) return 'motel';
  if (/\b(gas\s*station|petrol|fuel\s*station|gas)\b/.test(t) || /\bgas\b.*\bstation\b/.test(t)) return 'gas_station';
  if (/\b(car\s*wash|carwash|detailer|detail)\b/.test(t)) return 'car_wash';
  return null;
}

function dedupeByIdAndName(rows: DepartmentOption[]): DepartmentOption[] {
  const seen = new Set<string>();
  const out: DepartmentOption[] = [];
  for (const r of rows) {
    const k = `${r.id}::${r.name}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function normalizeApiRow(d: Record<string, any>): DepartmentOption | null {
  if (!d || typeof d !== 'object') return null;
  const id = String(d.id ?? d.pk ?? d.uuid ?? '').trim();
  const name = String(d.name ?? d.title ?? d.label ?? '').trim();
  if (!name) return null;
  return { id: id || name, name };
}

/**
 * Loads departments from the existing scheduler endpoint; merges params; falls back to static lists.
 * Does not modify the API client — only uses `getDepartments` with query params.
 */
export async function loadDepartmentOptions(
  apiMod: typeof api,
  ctx: {
    organizationId?: string;
    companyId?: string;
    organizationName?: string;
    companyName?: string;
    companyType?: string;
  }
): Promise<DepartmentOption[]> {
  const collected: DepartmentOption[] = [];
  const companyId = String(ctx.companyId ?? '').trim();
  const organizationId = String(ctx.organizationId ?? '').trim();

  const tryList = async (params: Record<string, string>) => {
    try {
      const raw = await apiMod.getDepartments(params);
      const list = Array.isArray(raw) ? raw : [];
      for (const row of list) {
        const n = normalizeApiRow(row as any);
        if (n) collected.push(n);
      }
    } catch {
      /* use fallback below */
    }
  };

  if (companyId) {
    await tryList({ company: companyId });
    if (collected.length === 0) await tryList({ company_id: companyId });
  }
  if (collected.length === 0 && organizationId) {
    await tryList({ organization: organizationId });
    if (collected.length === 0) await tryList({ organization_id: organizationId });
  }

  let merged = dedupeByIdAndName(collected);

  if (merged.length === 0) {
    const kind = inferOrganizationKind(ctx.organizationName ?? '', ctx.companyName ?? '', ctx.companyType);
    if (kind) {
      merged = STATIC_DEPARTMENTS[kind].map((name, i) => ({
        id: `__fb__${kind}_${i}`,
        name,
        isFallback: true,
      }));
    }
  }

  if (__DEV__) {
    console.log('[departments] org:', ctx.organizationId, 'company:', ctx.companyId, '→ count', merged.length);
  }
  return merged;
}

export async function persistEmployeeDepartment(
  apiMod: typeof api,
  employeeId: string,
  opt: DepartmentOption | null | undefined
): Promise<void> {
  const eid = String(employeeId || '').trim();
  if (!eid || !opt) return;
  const isFallback = opt.isFallback === true || String(opt.id).startsWith('__fb__');
  if (!isFallback) {
    await apiMod.updateSchedulerEmployeeWithFallbacks(eid, [
      { department_id: opt.id },
      { department: opt.id },
    ]);
    return;
  }
  await apiMod.updateSchedulerEmployeeWithFallbacks(eid, [
    { department: opt.name },
    { department_name: opt.name },
    { department: opt.name, department_id: null },
  ]);
}
