import { daysBetween, monthsUntil, type LocalDate } from './dates';

export type GoalStatus = {
  currentMinor: number;
  remainingMinor: number;
  percent: number;
  /** Null without a future target date: no estimate is invented. */
  suggestedMonthlyMinor: number | null;
  monthsLeft: number | null;
  /**
   * Compares the suggested contribution with the user's measured average monthly net.
   * 'unknown' when there is no target date or no history to compare against.
   */
  realism: 'reached' | 'realistic' | 'stretch' | 'past_due' | 'unknown';
};

export function computeGoalStatus(
  goal: { targetMinor: number; targetDate: LocalDate | null },
  currentMinor: number,
  date: LocalDate,
  averageMonthlyNetMinor: number | null,
): GoalStatus {
  const current = Math.max(0, currentMinor);
  const remainingMinor = Math.max(0, goal.targetMinor - current);
  const percent = goal.targetMinor === 0 ? 100 : Math.min(100, (current / goal.targetMinor) * 100);

  if (remainingMinor === 0) {
    return { currentMinor: current, remainingMinor, percent, suggestedMonthlyMinor: 0, monthsLeft: null, realism: 'reached' };
  }
  if (!goal.targetDate) {
    return { currentMinor: current, remainingMinor, percent, suggestedMonthlyMinor: null, monthsLeft: null, realism: 'unknown' };
  }
  if (daysBetween(date, goal.targetDate) < 0) {
    return { currentMinor: current, remainingMinor, percent, suggestedMonthlyMinor: null, monthsLeft: 0, realism: 'past_due' };
  }

  const monthsLeft = Math.max(1, monthsUntil(date, goal.targetDate));
  const suggestedMonthlyMinor = Math.ceil(remainingMinor / monthsLeft);
  const realism: GoalStatus['realism'] =
    averageMonthlyNetMinor === null ? 'unknown' : suggestedMonthlyMinor <= averageMonthlyNetMinor ? 'realistic' : 'stretch';
  return { currentMinor: current, remainingMinor, percent, suggestedMonthlyMinor, monthsLeft, realism };
}
