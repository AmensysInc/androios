/**
 * Shared helpers for department display, picker options, and filtering employees
 * by department id (tolerant of pk/uuid/hyphen variants) with catalog name fallback.
 */

export function employeeDepartmentDisplay(emp: any): string {
  if (!emp || typeof emp !== 'object') return '—';
  const d = emp.department;
  if (d && typeof d === 'object' && (d as any).name) return String((d as any).name);
  const n = emp.department_name ?? (typeof emp.department === 'string' ? emp.department : '');
  return n ? String(n) : '—';
}

/** Primary department id for building picker options from an employee row. */
export function departmentPrimaryId(emp: any): string {
  const d = emp?.department;
  if (d && typeof d === 'object') {
    const v = (d as any).id ?? (d as any).pk ?? (d as any).uuid;
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  if (emp?.department_id != null && String(emp.department_id).trim() !== '') return String(emp.department_id).trim();
  return '';
}

/** Standard UUID shape — used to avoid showing raw ids when a label is expected. */
export function isLikelyUuid(s: string): boolean {
  const t = String(s || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t);
}

/** Resolve a department row id (any id variant) to its display name. */
export function departmentNameFromCatalog(deptRows: any[], idOrPk: string): string | null {
  const row = deptRows.find((d) =>
    normalizeDeptIdsEqual(String(d?.id ?? d?.pk ?? d?.uuid ?? ''), idOrPk)
  );
  const n = row && typeof row === 'object' ? String((row as any).name ?? '').trim() : '';
  return n || null;
}

export function normalizeDeptIdsEqual(a: string, b: string): boolean {
  const x = String(a).trim();
  const y = String(b).trim();
  if (x === y) return true;
  if (!x || !y) return false;
  const lx = x.toLowerCase();
  const ly = y.toLowerCase();
  if (lx === ly) return true;
  const strip = (s: string) => s.replace(/-/g, '').toLowerCase();
  const sx = strip(x);
  const sy = strip(y);
  if (sx.length >= 8 && sy.length >= 8 && sx === sy) return true;
  return false;
}

/** Collect every id shape the API might send on an employee for their department. */
export function collectEmployeeDepartmentIds(emp: any): string[] {
  const seen = new Set<string>();
  const uuidInStr = (s: string) => {
    const m = s.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i
    );
    return m ? m[1] : null;
  };
  const add = (v: any) => {
    if (v == null || v === '') return;
    if (typeof v === 'object') {
      const id = (v as any).id ?? (v as any).pk ?? (v as any).uuid;
      if (id != null && String(id).trim() !== '') seen.add(String(id).trim());
      return;
    }
    const s = String(v).trim();
    if (!s || s === '[object Object]') return;
    seen.add(s);
    const u = uuidInStr(s);
    if (u) seen.add(u);
    const tail = s.match(/\/(\d+)\/?$/);
    if (tail) seen.add(tail[1]);
  };
  add(emp?.department);
  add(emp?.department_id);
  return [...seen];
}

function departmentCatalogNameById(deptRows: any[], selectedId: string): string {
  const row = deptRows.find((d) =>
    normalizeDeptIdsEqual(String(d?.id ?? d?.pk ?? d?.uuid ?? ''), selectedId)
  );
  const n = row && typeof row === 'object' ? String((row as any).name ?? '').trim().toLowerCase() : '';
  return n;
}

/** True if employee belongs to the selected department (by id variants or by name fallback). */
export function employeeMatchesDepartmentFilter(emp: any, selectedId: string, deptRows: any[]): boolean {
  if (selectedId === 'all') return true;
  for (const id of collectEmployeeDepartmentIds(emp)) {
    if (normalizeDeptIdsEqual(id, selectedId)) return true;
  }
  const targetName = departmentCatalogNameById(deptRows, selectedId);
  if (targetName) {
    const d = emp?.department;
    const nestedName =
      d && typeof d === 'object' && (d as any).name ? String((d as any).name).trim().toLowerCase() : '';
    if (nestedName === targetName) return true;
    if (emp?.department_name && String(emp.department_name).trim().toLowerCase() === targetName) return true;
    const disp = employeeDepartmentDisplay(emp);
    if (disp && disp !== '—' && disp.trim().toLowerCase() === targetName) return true;
  }
  return false;
}

export type DepartmentFilterOption = { id: string; label: string };

export function buildDepartmentFilterOptions(
  departments: any[],
  employees: any[],
  allLabel = 'All'
): DepartmentFilterOption[] {
  const opts: DepartmentFilterOption[] = [{ id: 'all', label: allLabel }];
  const seen = new Set<string>();
  const mark = (id: string) => {
    const k = id.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  for (const d of departments) {
    const raw = (d as any).id ?? (d as any).pk ?? (d as any).uuid;
    const id = raw != null ? String(raw).trim() : '';
    const name = (d as any).name || id;
    if (id && mark(id)) opts.push({ id, label: name });
  }
  if (opts.length <= 1) {
    for (const emp of employees) {
      const id = departmentPrimaryId(emp);
      const label = employeeDepartmentDisplay(emp);
      if (id && label && label !== '—' && mark(id)) opts.push({ id, label });
    }
  }
  return opts;
}
