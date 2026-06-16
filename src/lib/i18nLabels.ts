import type { TFunction } from 'i18next';

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const WEEKDAY_SHORT_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export function localizedDayName(t: TFunction, date: Date, style: 'long' | 'short' = 'long'): string {
  const index = date.getDay();
  if (style === 'short') {
    const monIndex = index === 0 ? 6 : index - 1;
    return t(`days.${WEEKDAY_SHORT_KEYS[monIndex]}`);
  }
  return t(`days.${DAY_KEYS[index]}`);
}

export function localizedMonthName(t: TFunction, date: Date): string {
  return t(`months.${MONTH_KEYS[date.getMonth()]}`);
}

export function localizedEmployeeStatus(t: TFunction, raw: string | null | undefined): string {
  const s = String(raw || 'active')
    .toLowerCase()
    .replace(/\s+/g, '_');
  const key = `employee.statusLabels.${s}`;
  const translated = t(key);
  return translated === key ? String(raw || t('employee.statusLabels.active')) : translated;
}

export function localizedRequestStatus(t: TFunction, raw: string | null | undefined): string {
  const s = String(raw || 'pending')
    .toLowerCase()
    .replace(/\s+/g, '_');
  const key = `requests.statusLabels.${s}`;
  const translated = t(key);
  return translated === key ? String(raw || t('requests.statusLabels.pending')) : translated;
}

export function tableHeaders(t: TFunction, keys: string[]): string[] {
  return keys.map((k) => t(`table.${k}`, { defaultValue: k }));
}
