/**
 * Financial dates are local wall-clock strings, compared lexically:
 *   LocalDate     'YYYY-MM-DD'
 *   LocalDateTime 'YYYY-MM-DDTHH:mm'
 * They are never converted through UTC, so a 23:30 expense on the last of the month stays in
 * that month whatever the device time zone or DST state. Calendar maths runs on Date.UTC for
 * the same reason. Only audit timestamps (created_at / updated_at) are UTC instants.
 */
export type LocalDate = string;
export type LocalDateTime = string;
export type DateRange = { from: LocalDate; to: LocalDate };
export type PeriodKind = 'day' | 'week' | 'month' | 'year';

let clock: () => Date = () => new Date();

/** Lets tests pin "now" so date-boundary behaviour is reproducible. */
export function setClock(next: (() => Date) | null): void {
  clock = next ?? (() => new Date());
}

export function now(): Date {
  return clock();
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function today(): LocalDate {
  const d = now();
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowLocal(): LocalDateTime {
  const d = now();
  return `${today()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowIso(): string {
  return now().toISOString();
}

function toUtc(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): LocalDate {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function isValidDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  return isValidDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60;
}

export function dateOf(value: LocalDateTime): LocalDate {
  return value.slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Adds calendar months, clamping the day: Jan 31 + 1 month = Feb 28 (or 29). */
export function addMonths(date: LocalDate, months: number, anchorDay?: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: LocalDate): LocalDate {
  const [y, m] = date.split('-').map(Number);
  return `${date.slice(0, 7)}-${pad(daysInMonth(y, m))}`;
}

/** Weeks start on Monday, the usual convention in Morocco. */
export function startOfWeek(date: LocalDate): LocalDate {
  const weekday = new Date(toUtc(date)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function periodRange(kind: PeriodKind, date: LocalDate): DateRange {
  switch (kind) {
    case 'day':
      return { from: date, to: date };
    case 'week': {
      const from = startOfWeek(date);
      return { from, to: addDays(from, 6) };
    }
    case 'month':
      return { from: startOfMonth(date), to: endOfMonth(date) };
    case 'year':
      return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` };
  }
}

/** The equally shaped period just before: previous calendar month, or same-length days. */
export function previousRange(range: DateRange): DateRange {
  const isWholeMonths = range.from === startOfMonth(range.from) && range.to === endOfMonth(range.to);
  if (isWholeMonths) {
    const months =
      (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 +
      Number(range.to.slice(5, 7)) -
      Number(range.from.slice(5, 7)) +
      1;
    const from = addMonths(range.from, -months);
    return { from, to: endOfMonth(addMonths(range.from, -1)) };
  }
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

/**
 * A period still in progress against the same stretch of the one before: on the 10th, this month
 * so far is compared with the 1st to the 10th of last month, never with all of last month.
 */
export function comparableRanges(range: DateRange, date: LocalDate): { current: DateRange; previous: DateRange } {
  const before = previousRange(range);
  if (date >= range.to || date < range.from) return { current: range, previous: before };
  const elapsed = daysBetween(range.from, date);
  return {
    current: { from: range.from, to: date },
    previous: { from: before.from, to: minDate(addDays(before.from, elapsed), before.to) },
  };
}

const minDate = (a: LocalDate, b: LocalDate): LocalDate => (a < b ? a : b);

export function monthsUntil(from: LocalDate, to: LocalDate): number {
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  return Number(to.slice(8, 10)) >= Number(from.slice(8, 10)) ? months : months - 1;
}

const LOCALES: Record<string, string> = { ar: 'ar-MA', fr: 'fr-MA', en: 'en-GB' };

export function localeTag(language: string): string {
  return LOCALES[language] ?? 'en-GB';
}

export function formatDate(date: LocalDate, language: string, style: 'short' | 'long' | 'month' = 'short'): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : style === 'month'
        ? { month: 'long', year: 'numeric' }
        : { day: 'numeric', month: 'short', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat(localeTag(language), { ...options, timeZone: 'UTC' }).format(new Date(toUtc(date)));
  } catch {
    return date;
  }
}
