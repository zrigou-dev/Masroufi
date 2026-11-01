import type { LocalDate } from './dates';
import type { Debt, DebtClosure, DebtStatus, Installment } from './types';

export type InstallmentState = Installment & {
  paidMinor: number;
  remainingMinor: number;
  state: 'paid' | 'partial' | 'unpaid' | 'overdue';
};

export type DebtState = {
  totalDueMinor: number;
  paidMinor: number;
  /** What is still owed, never negative. */
  remainingMinor: number;
  /** Paid beyond the total due; the other party now owes this amount back. */
  overpaidMinor: number;
  status: DebtStatus;
  overdueMinor: number;
  nextDueDate: LocalDate | null;
  nextDueMinor: number;
  progress: number;
  installments: InstallmentState[];
};

/**
 * Payments are not attached to installments. They are allocated oldest-first each time this
 * runs, so rewriting a schedule can never alter or lose a recorded payment.
 */
export function allocateInstallments(
  installments: Installment[],
  paidMinor: number,
  todayDate: LocalDate,
): InstallmentState[] {
  let pool = paidMinor;
  return [...installments]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
    .map((item) => {
      const paid = Math.min(pool, item.amountMinor);
      pool -= paid;
      const remainingMinor = item.amountMinor - paid;
      const state: InstallmentState['state'] =
        remainingMinor === 0
          ? 'paid'
          : item.dueDate < todayDate
            ? 'overdue'
            : paid > 0
              ? 'partial'
              : 'unpaid';
      return { ...item, paidMinor: paid, remainingMinor, state };
    });
}

function closedStatus(closure: DebtClosure): DebtStatus | null {
  return closure === 'active' ? null : closure;
}

export function computeDebtState(
  debt: Pick<Debt, 'principalMinor' | 'feesMinor' | 'dueDate' | 'closure'>,
  paidMinor: number,
  installments: Installment[],
  todayDate: LocalDate,
): DebtState {
  const totalDueMinor = debt.principalMinor + debt.feesMinor;
  const closed = closedStatus(debt.closure);
  const overpaidMinor = Math.max(0, paidMinor - totalDueMinor);
  const rawRemaining = Math.max(0, totalDueMinor - paidMinor);
  const remainingMinor = closed ? 0 : rawRemaining;
  const items = allocateInstallments(installments, paidMinor, todayDate);
  const open = items.filter((item) => item.remainingMinor > 0);

  let overdueMinor = 0;
  let nextDueDate: LocalDate | null = null;
  let nextDueMinor = 0;

  if (remainingMinor > 0) {
    if (items.length > 0) {
      overdueMinor = open.filter((i) => i.dueDate < todayDate).reduce((sum, i) => sum + i.remainingMinor, 0);
      const upcoming = open[0];
      if (upcoming) {
        nextDueDate = upcoming.dueDate;
        nextDueMinor = upcoming.remainingMinor;
      }
    } else if (debt.dueDate) {
      nextDueDate = debt.dueDate;
      nextDueMinor = remainingMinor;
      if (debt.dueDate < todayDate) overdueMinor = remainingMinor;
    }
  }

  const status: DebtStatus =
    closed ?? (remainingMinor === 0 ? 'settled' : overdueMinor > 0 ? 'overdue' : paidMinor > 0 ? 'partial' : 'open');

  return {
    totalDueMinor,
    paidMinor,
    remainingMinor,
    overpaidMinor,
    status,
    overdueMinor,
    nextDueDate,
    nextDueMinor,
    progress: totalDueMinor === 0 ? 1 : Math.min(1, paidMinor / totalDueMinor),
    installments: items,
  };
}

export type RepaymentStrategy = 'avalanche' | 'snowball' | 'due_date' | 'priority';

export type PlanDebt = {
  id: string;
  remainingMinor: number;
  monthlyRateBps: number;
  minimumMinor: number;
  dueDate: LocalDate | null;
  priority: number;
};

export type PlanResult = {
  strategy: RepaymentStrategy;
  months: number;
  interestMinor: number;
  order: string[];
  /** False when the budget cannot outpace interest within the horizon. */
  completes: boolean;
};

const MAX_MONTHS = 600;

function ordering(strategy: RepaymentStrategy): (a: PlanDebt, b: PlanDebt) => number {
  switch (strategy) {
    case 'avalanche':
      return (a, b) => b.monthlyRateBps - a.monthlyRateBps || a.remainingMinor - b.remainingMinor;
    case 'snowball':
      return (a, b) => a.remainingMinor - b.remainingMinor;
    case 'due_date':
      return (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
    case 'priority':
      return (a, b) => b.priority - a.priority || a.remainingMinor - b.remainingMinor;
  }
}

/** Month-by-month estimate: interest accrues, minimums are paid, the rest goes to the first debt in order. */
export function simulateRepayment(debts: PlanDebt[], monthlyBudgetMinor: number, strategy: RepaymentStrategy): PlanResult {
  const sorted = [...debts].filter((d) => d.remainingMinor > 0).sort(ordering(strategy));
  const balances = new Map(sorted.map((d) => [d.id, d.remainingMinor]));
  const order: string[] = [];
  let interestMinor = 0;
  let months = 0;

  while ([...balances.values()].some((b) => b > 0) && months < MAX_MONTHS) {
    months += 1;
    for (const debt of sorted) {
      const balance = balances.get(debt.id) ?? 0;
      if (balance <= 0) continue;
      const interest = Math.round((balance * debt.monthlyRateBps) / 10_000);
      interestMinor += interest;
      balances.set(debt.id, balance + interest);
    }
    let budget = monthlyBudgetMinor;
    for (const debt of sorted) {
      const balance = balances.get(debt.id) ?? 0;
      const pay = Math.min(balance, debt.minimumMinor, budget);
      balances.set(debt.id, balance - pay);
      budget -= pay;
    }
    for (const debt of sorted) {
      const balance = balances.get(debt.id) ?? 0;
      const pay = Math.min(balance, budget);
      balances.set(debt.id, balance - pay);
      budget -= pay;
      if ((balances.get(debt.id) ?? 0) === 0 && !order.includes(debt.id)) order.push(debt.id);
    }
  }

  return {
    strategy,
    months,
    interestMinor,
    order,
    completes: ![...balances.values()].some((b) => b > 0),
  };
}
