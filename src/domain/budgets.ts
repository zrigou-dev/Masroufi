import { daysBetween, type DateRange, type LocalDate, periodRange } from './dates';
import type { Budget } from './types';

export function budgetRange(budget: Pick<Budget, 'period' | 'startDate' | 'endDate'>, date: LocalDate): DateRange {
  if (budget.period === 'custom' && budget.startDate && budget.endDate) {
    return { from: budget.startDate, to: budget.endDate };
  }
  return periodRange('month', date);
}

export type BudgetStatus = {
  range: DateRange;
  spentMinor: number;
  remainingMinor: number;
  percentUsed: number;
  /** Where spending would be today if it were perfectly even across the period. */
  expectedMinor: number;
  pace: 'under' | 'on_track' | 'ahead' | 'over';
  crossedThreshold: number | null;
};

export function computeBudgetStatus(
  budget: Pick<Budget, 'amountMinor' | 'thresholds'>,
  range: DateRange,
  spentMinor: number,
  date: LocalDate,
): BudgetStatus {
  const totalDays = daysBetween(range.from, range.to) + 1;
  const elapsed = Math.min(totalDays, Math.max(0, daysBetween(range.from, date) + 1));
  const expectedMinor = Math.round((budget.amountMinor * elapsed) / totalDays);
  const percentUsed = budget.amountMinor === 0 ? 0 : (spentMinor / budget.amountMinor) * 100;
  const pace: BudgetStatus['pace'] =
    spentMinor > budget.amountMinor
      ? 'over'
      : spentMinor > expectedMinor * 1.1
        ? 'ahead'
        : spentMinor < expectedMinor * 0.9
          ? 'under'
          : 'on_track';
  const crossed = budget.thresholds.filter((t) => percentUsed >= t);
  return {
    range,
    spentMinor,
    remainingMinor: budget.amountMinor - spentMinor,
    percentUsed,
    expectedMinor,
    pace,
    crossedThreshold: crossed.length ? Math.max(...crossed) : null,
  };
}
