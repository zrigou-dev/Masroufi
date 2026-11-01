import { addDays, addMonths, type LocalDate } from './dates';
import type { Frequency } from './types';

export type Schedule = {
  frequency: Frequency;
  intervalCount: number;
  startDate: LocalDate;
  endDate: LocalDate | null;
};

/** The nth occurrence, always derived from the start date so month-end clamping never drifts. */
export function occurrenceAt(schedule: Schedule, n: number): LocalDate {
  const step = n * schedule.intervalCount;
  const anchorDay = Number(schedule.startDate.slice(8, 10));
  switch (schedule.frequency) {
    case 'daily':
      return addDays(schedule.startDate, step);
    case 'weekly':
      return addDays(schedule.startDate, step * 7);
    case 'monthly':
      return addMonths(schedule.startDate, step, anchorDay);
    case 'yearly':
      return addMonths(schedule.startDate, step * 12, anchorDay);
  }
}

const MAX_OCCURRENCES = 5000;

export function occurrencesBetween(schedule: Schedule, from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let n = 0; n < MAX_OCCURRENCES; n += 1) {
    const date = occurrenceAt(schedule, n);
    if (date > to || (schedule.endDate && date > schedule.endDate)) break;
    if (date >= from) dates.push(date);
  }
  return dates;
}

/** How many occurrences of this rule fall in an average month; used for monthly totals. */
export function monthlyFactor(frequency: Frequency, intervalCount: number): number {
  const perYear = { daily: 365, weekly: 52, monthly: 12, yearly: 1 }[frequency];
  return perYear / intervalCount / 12;
}
