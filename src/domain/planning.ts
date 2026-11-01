import { addDays, type LocalDate } from './dates';

export type ObligationSource = 'recurring' | 'installment' | 'debt';

/** A money commitment that has not happened yet. Nothing here is ever treated as paid. */
export type Obligation = {
  key: string;
  source: ObligationSource;
  label: string;
  dueDate: LocalDate;
  amountMinor: number;
  currency: string;
  direction: 'in' | 'out';
  overdue: boolean;
  ruleId?: string;
  debtId?: string;
  /** Days of notice wanted. Null means no reminder, as chosen on a recurring rule. */
  reminderDaysBefore: number | null;
};

export type PlannedReminder = { obligation: Obligation; on: LocalDate };

const DEFAULT_MAX_REMINDERS = 50;

/**
 * Which reminders to schedule, soonest first. Anything already overdue or whose reminder day has
 * passed is left out: a reminder only helps if it arrives before the payment is due.
 */
export function planReminders(obligations: Obligation[], date: LocalDate, max = DEFAULT_MAX_REMINDERS): PlannedReminder[] {
  return obligations
    .flatMap((obligation) => {
      if (obligation.overdue || obligation.reminderDaysBefore === null) return [];
      const on = addDays(obligation.dueDate, -obligation.reminderDaysBefore);
      return on >= date ? [{ obligation, on }] : [];
    })
    .sort((a, b) => a.on.localeCompare(b.on))
    .slice(0, max);
}

export type AvailableToSpend = {
  currency: string;
  liquidMinor: number;
  obligationsMinor: number;
  goalAllocationsMinor: number;
  availableMinor: number;
  horizonDays: number;
};

/**
 * Liquid money minus outgoing obligations in the horizon and money earmarked for goals.
 * Budgets are not subtracted (a budget is a limit, not a commitment, and subtracting one would
 * count the same dirham as an obligation twice) and expected income is not added.
 */
export function computeAvailable(params: {
  currency: string;
  liquidMinor: number;
  obligations: Obligation[];
  goalAllocationsMinor: number;
  horizonDays: number;
}): AvailableToSpend {
  const obligationsMinor = params.obligations
    .filter((o) => o.direction === 'out' && o.currency === params.currency)
    .reduce((sum, o) => sum + o.amountMinor, 0);
  return {
    currency: params.currency,
    liquidMinor: params.liquidMinor,
    obligationsMinor,
    goalAllocationsMinor: params.goalAllocationsMinor,
    availableMinor: params.liquidMinor - obligationsMinor - params.goalAllocationsMinor,
    horizonDays: params.horizonDays,
  };
}
