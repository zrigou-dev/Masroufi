import { computeBudgetStatus, budgetRange, type BudgetStatus } from '../domain/budgets';
import { addDays, addMonths, comparableRanges, endOfMonth, startOfMonth, today, type DateRange, type LocalDate } from '../domain/dates';
import { addTo, type MoneyByCurrency } from '../domain/money';
import { computeAvailable, type AvailableToSpend, type Obligation } from '../domain/planning';
import type { Account, AccountType, Budget, Id } from '../domain/types';
import { listAccounts } from './accounts';
import { listDebts } from './debts';
import { pendingOccurrences } from './recurring';
import type { Db, SqlValue } from './sql';

/**
 * The authoritative calculation layer. Screens never add up money themselves: they call these
 * functions, which read the SQL views defined in migrations.ts.
 */

export type CurrencyPosition = {
  currency: string;
  byType: Record<AccountType, number>;
  ownedMinor: number;
  receivableMinor: number;
  liabilityMinor: number;
  netMinor: number;
};

const emptyPosition = (currency: string): CurrencyPosition => ({
  currency,
  byType: { bank: 0, cash: 0, savings: 0, other: 0 },
  ownedMinor: 0,
  receivableMinor: 0,
  liabilityMinor: 0,
  netMinor: 0,
});

/**
 * Net position = money in accounts + receivables - liabilities, one figure per currency.
 * Archived accounts still count: archiving hides an account, it does not make money vanish.
 * Receivables never enter "owned": money owed to me is not money I have. An overpaid debt
 * counts on the opposite side, because the excess is now owed back.
 */
export async function getPositions(db: Db): Promise<CurrencyPosition[]> {
  const positions = new Map<string, CurrencyPosition>();
  const at = (currency: string) => {
    if (!positions.has(currency)) positions.set(currency, emptyPosition(currency));
    return positions.get(currency) as CurrencyPosition;
  };

  for (const account of await listAccounts(db, { includeArchived: true })) {
    const position = at(account.currency);
    position.byType[account.type] += account.balanceMinor;
    position.ownedMinor += account.balanceMinor;
  }
  for (const debt of await listDebts(db)) {
    const position = at(debt.currency);
    const { remainingMinor, overpaidMinor } = debt.state;
    if (debt.direction === 'i_owe') {
      position.liabilityMinor += remainingMinor;
      position.receivableMinor += overpaidMinor;
    } else {
      position.receivableMinor += remainingMinor;
      position.liabilityMinor += overpaidMinor;
    }
  }
  for (const position of positions.values()) {
    position.netMinor = position.ownedMinor + position.receivableMinor - position.liabilityMinor;
  }
  return [...positions.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export type CashFlow = { currency: string; incomeMinor: number; expenseMinor: number; netMinor: number };

export async function getCashFlow(db: Db, range: DateRange): Promise<CashFlow[]> {
  const rows = await db.all<{ currency: string; income: number; expense: number }>(
    `SELECT currency, SUM(income_minor) AS income, SUM(expense_minor) AS expense
     FROM v_cash_flow WHERE day >= ? AND day <= ? GROUP BY currency ORDER BY currency`,
    [range.from, range.to],
  );
  return rows.map((r) => ({ currency: r.currency, incomeMinor: r.income, expenseMinor: r.expense, netMinor: r.income - r.expense }));
}

export type CategoryTotal = {
  categoryId: Id | null;
  key: string | null;
  name: string | null;
  icon: string | null;
  color: string | null;
  nature: string | null;
  minor: number;
};

type CategoryRow = { category_id: string | null; key: string | null; name: string | null; icon: string | null; color: string | null; nature: string | null; minor: number };

/** Totals roll up to the top-level category, which is where a person thinks about their money. */
async function totalsByCategory(db: Db, range: DateRange, currency: string, column: 'expense_minor' | 'income_minor'): Promise<CategoryTotal[]> {
  const rows = await db.all<CategoryRow>(
    `SELECT top.id AS category_id, top.key, top.name, top.icon, top.color, top.nature, SUM(f.${column}) AS minor
     FROM v_cash_flow f
     LEFT JOIN categories c ON c.id = f.category_id
     LEFT JOIN categories top ON top.id = COALESCE(c.parent_id, c.id)
     WHERE f.day >= ? AND f.day <= ? AND f.currency = ?
     GROUP BY top.id HAVING SUM(f.${column}) <> 0 ORDER BY minor DESC`,
    [range.from, range.to, currency],
  );
  return rows.map((r) => ({ categoryId: r.category_id, key: r.key, name: r.name, icon: r.icon, color: r.color, nature: r.nature, minor: r.minor }));
}

export const spendingByCategory = (db: Db, range: DateRange, currency: string) => totalsByCategory(db, range, currency, 'expense_minor');

export const incomeByCategory = (db: Db, range: DateRange, currency: string) => totalsByCategory(db, range, currency, 'income_minor');

export async function spendingByAccount(db: Db, range: DateRange, currency: string): Promise<{ accountId: Id; name: string; minor: number }[]> {
  const rows = await db.all<{ account_id: string; name: string; minor: number }>(
    `SELECT f.account_id, a.name, SUM(f.expense_minor) AS minor
     FROM v_cash_flow f JOIN accounts a ON a.id = f.account_id
     WHERE f.day >= ? AND f.day <= ? AND f.currency = ?
     GROUP BY f.account_id HAVING SUM(f.expense_minor) <> 0 ORDER BY minor DESC`,
    [range.from, range.to, currency],
  );
  return rows.map((r) => ({ accountId: r.account_id, name: r.name, minor: r.minor }));
}

export type MovementTotals = {
  transfersMinor: number;
  transferCount: number;
  repaidMinor: number;
  collectedMinor: number;
  borrowedMinor: number;
  lentMinor: number;
};

/** Money that moved without being income or spending. Reversals subtract from what they undo. */
export async function getMovements(db: Db, range: DateRange, currency: string): Promise<MovementTotals> {
  const rows = await db.all<{ type: string; minor: number; n: number }>(
    `SELECT CASE WHEN t.type = 'reversal' THEN o.type ELSE t.type END AS type,
            SUM(CASE WHEN t.type = 'reversal' THEN -t.amount_minor ELSE t.amount_minor END) AS minor,
            SUM(CASE WHEN t.type = 'reversal' THEN -1 ELSE 1 END) AS n
     FROM transactions t LEFT JOIN transactions o ON o.id = t.reversal_of_id
     WHERE t.deleted_at IS NULL AND t.currency = ? AND substr(t.occurred_at, 1, 10) BETWEEN ? AND ?
     GROUP BY 1`,
    [currency, range.from, range.to],
  );
  const pick = (type: string) => rows.find((r) => r.type === type);
  return {
    transfersMinor: pick('transfer')?.minor ?? 0,
    transferCount: pick('transfer')?.n ?? 0,
    repaidMinor: pick('debt_repayment')?.minor ?? 0,
    collectedMinor: pick('debt_collection')?.minor ?? 0,
    borrowedMinor: pick('debt_borrowed')?.minor ?? 0,
    lentMinor: pick('debt_lent')?.minor ?? 0,
  };
}

export type MonthPoint = { month: string; incomeMinor: number; expenseMinor: number; closingMinor: number };

/** Month-end owned balance and flows for the last `months` months, in one currency. */
export async function getMonthlyTrend(db: Db, currency: string, months: number, date: LocalDate = today()): Promise<MonthPoint[]> {
  const firstMonth = startOfMonth(addMonths(date, -(months - 1), 1));
  const before = await db.get<{ total: number }>(
    `SELECT COALESCE(SUM(e.amount_minor), 0) AS total FROM ledger_entries e JOIN transactions t ON t.id = e.transaction_id
     WHERE t.deleted_at IS NULL AND e.currency = ? AND t.occurred_at < ?`,
    [currency, firstMonth],
  );
  const movement = await db.all<{ month: string; total: number }>(
    `SELECT substr(t.occurred_at, 1, 7) AS month, SUM(e.amount_minor) AS total
     FROM ledger_entries e JOIN transactions t ON t.id = e.transaction_id
     WHERE t.deleted_at IS NULL AND e.currency = ? AND t.occurred_at >= ? GROUP BY 1`,
    [currency, firstMonth],
  );
  const flows = await db.all<{ month: string; income: number; expense: number }>(
    `SELECT substr(day, 1, 7) AS month, SUM(income_minor) AS income, SUM(expense_minor) AS expense
     FROM v_cash_flow WHERE currency = ? AND day >= ? GROUP BY 1`,
    [currency, firstMonth],
  );

  let running = before?.total ?? 0;
  const points: MonthPoint[] = [];
  for (let i = 0; i < months; i += 1) {
    const month = addMonths(firstMonth, i, 1).slice(0, 7);
    running += movement.find((m) => m.month === month)?.total ?? 0;
    const flow = flows.find((f) => f.month === month);
    points.push({ month, incomeMinor: flow?.income ?? 0, expenseMinor: flow?.expense ?? 0, closingMinor: running });
  }
  return points;
}

/** Average of complete past months only; null when no complete month has any activity. */
export async function averageMonthlyNet(db: Db, currency: string, months = 3, date: LocalDate = today()): Promise<number | null> {
  const end = endOfMonth(addMonths(date, -1, 1));
  const start = startOfMonth(addMonths(date, -months, 1));
  const row = await db.get<{ net: number | null; active: number }>(
    `SELECT SUM(income_minor - expense_minor) AS net, COUNT(DISTINCT substr(day, 1, 7)) AS active
     FROM v_cash_flow WHERE currency = ? AND day >= ? AND day <= ?`,
    [currency, start, end],
  );
  if (!row || row.net === null || row.active === 0) return null;
  return Math.round(row.net / row.active);
}

async function spentForBudget(db: Db, budget: Budget, range: DateRange): Promise<number> {
  const params: SqlValue[] = [range.from, range.to, budget.currency];
  let filter = '';
  if (budget.categoryId) {
    // A budget on a parent covers everything filed under it.
    filter += ' AND (category_id = ? OR category_id IN (SELECT id FROM categories WHERE parent_id = ?))';
    params.push(budget.categoryId, budget.categoryId);
  }
  if (budget.accountId) {
    filter += ' AND account_id = ?';
    params.push(budget.accountId);
  }
  const row = await db.get<{ total: number }>(
    `SELECT COALESCE(SUM(expense_minor), 0) AS total FROM v_cash_flow WHERE day >= ? AND day <= ? AND currency = ?${filter}`,
    params,
  );
  return row?.total ?? 0;
}

export async function getBudgetStatus(db: Db, budget: Budget, date: LocalDate = today()): Promise<BudgetStatus> {
  const range = budgetRange(budget, date);
  return computeBudgetStatus(budget, range, await spentForBudget(db, budget, range), date);
}

const DEBT_REMINDER_DAYS = 1;

/**
 * Everything still due up to the horizon, including anything already overdue. Debts with a
 * schedule contribute their installments and no due-date line, so nothing appears twice.
 */
export async function getObligations(db: Db, horizonDays: number, date: LocalDate = today()): Promise<Obligation[]> {
  const until = addDays(date, horizonDays);
  const obligations: Obligation[] = [];

  for (const { rule, dueDate, overdue } of await pendingOccurrences(db, until)) {
    obligations.push({
      key: `recurring:${rule.id}:${dueDate}`,
      source: 'recurring',
      label: rule.name,
      dueDate,
      amountMinor: rule.amountMinor,
      currency: rule.currency,
      direction: rule.kind === 'expense' ? 'out' : 'in',
      overdue,
      ruleId: rule.id,
      reminderDaysBefore: rule.reminderDaysBefore,
    });
  }

  for (const debt of await listDebts(db)) {
    if (debt.state.remainingMinor === 0) continue;
    const direction = debt.direction === 'i_owe' ? 'out' : 'in';
    if (debt.state.installments.length > 0) {
      for (const item of debt.state.installments) {
        if (item.remainingMinor === 0 || item.dueDate > until) continue;
        obligations.push({
          key: `installment:${item.id}`,
          source: 'installment',
          label: debt.counterparty,
          dueDate: item.dueDate,
          amountMinor: item.remainingMinor,
          currency: debt.currency,
          direction,
          overdue: item.dueDate < date,
          debtId: debt.id,
          reminderDaysBefore: direction === 'out' ? DEBT_REMINDER_DAYS : null,
        });
      }
    } else if (debt.dueDate && debt.dueDate <= until) {
      obligations.push({
        key: `debt:${debt.id}`,
        source: 'debt',
        label: debt.counterparty,
        dueDate: debt.dueDate,
        amountMinor: debt.state.remainingMinor,
        currency: debt.currency,
        direction,
        overdue: debt.dueDate < date,
        debtId: debt.id,
        reminderDaysBefore: direction === 'out' ? DEBT_REMINDER_DAYS : null,
      });
    }
  }
  return obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export async function getGoalAllocations(db: Db): Promise<MoneyByCurrency> {
  const rows = await db.all<{ currency: string; total: number }>(
    `SELECT g.currency, SUM(a.amount_minor) AS total FROM goal_allocations a
     JOIN savings_goals g ON g.id = a.goal_id
     WHERE g.mode = 'manual' AND g.archived_at IS NULL GROUP BY g.currency`,
  );
  const totals: MoneyByCurrency = {};
  for (const row of rows) addTo(totals, row.currency, row.total);
  return totals;
}

export function liquidAccounts(accounts: Account[], linkedAccountIds: Id[]): Account[] {
  return accounts.filter((a) => a.isLiquid && !a.archivedAt && !linkedAccountIds.includes(a.id));
}

export async function getAvailableToSpend(db: Db, currency: string, horizonDays: number, date: LocalDate = today()): Promise<AvailableToSpend & { accounts: Account[]; obligations: Obligation[] }> {
  const linked = await db.all<{ linked_account_id: string }>(
    `SELECT linked_account_id FROM savings_goals WHERE linked_account_id IS NOT NULL AND archived_at IS NULL`,
  );
  const accounts = liquidAccounts(await listAccounts(db), linked.map((l) => l.linked_account_id)).filter((a) => a.currency === currency);
  const obligations = (await getObligations(db, horizonDays, date)).filter((o) => o.currency === currency && o.direction === 'out');
  const allocations = await getGoalAllocations(db);
  const result = computeAvailable({
    currency,
    liquidMinor: accounts.reduce((sum, a) => sum + a.balanceMinor, 0),
    obligations,
    goalAllocationsMinor: allocations[currency] ?? 0,
    horizonDays,
  });
  return { ...result, accounts, obligations };
}

export type MoneyFlow = {
  /** Paid by a recurring rule, or filed under Salary. */
  regularIncomeMinor: number;
  extraIncomeMinor: number;
  collectedMinor: number;
  borrowedMinor: number;
  /** Bills and subscriptions: spending that repeats by itself. */
  recurringMinor: number;
  everydayMinor: number;
  occasionalMinor: number;
  repaidMinor: number;
  lentMinor: number;
};

/** Where money came from and where it went: every dirham in or out, in one place. */
export async function getMoneyFlow(db: Db, range: DateRange, currency: string): Promise<MoneyFlow> {
  const row = await db.get<{ regular: number | null; extra: number | null; recurring: number | null; occasional: number | null; everyday: number | null }>(
    `SELECT
       SUM(CASE WHEN f.rule_id IS NOT NULL OR c.key = 'salary' THEN f.income_minor ELSE 0 END) AS regular,
       SUM(CASE WHEN f.rule_id IS NULL AND COALESCE(c.key, '') <> 'salary' THEN f.income_minor ELSE 0 END) AS extra,
       SUM(CASE WHEN f.rule_id IS NOT NULL THEN f.expense_minor ELSE 0 END) AS recurring,
       SUM(CASE WHEN f.rule_id IS NULL AND f.occasional = 1 THEN f.expense_minor ELSE 0 END) AS occasional,
       SUM(CASE WHEN f.rule_id IS NULL AND f.occasional = 0 THEN f.expense_minor ELSE 0 END) AS everyday
     FROM v_cash_flow f LEFT JOIN categories c ON c.id = f.category_id
     WHERE f.day >= ? AND f.day <= ? AND f.currency = ?`,
    [range.from, range.to, currency],
  );
  const movements = await getMovements(db, range, currency);
  return {
    regularIncomeMinor: row?.regular ?? 0,
    extraIncomeMinor: row?.extra ?? 0,
    collectedMinor: movements.collectedMinor,
    borrowedMinor: movements.borrowedMinor,
    recurringMinor: row?.recurring ?? 0,
    everydayMinor: row?.everyday ?? 0,
    occasionalMinor: row?.occasional ?? 0,
    repaidMinor: movements.repaidMinor,
    lentMinor: movements.lentMinor,
  };
}

export type DailySpend = { day: LocalDate; minor: number };

export async function getDailySpending(db: Db, range: DateRange, currency: string): Promise<DailySpend[]> {
  const rows = await db.all<{ day: string; minor: number }>(
    `SELECT day, SUM(expense_minor) AS minor FROM v_cash_flow
     WHERE day >= ? AND day <= ? AND currency = ? GROUP BY day ORDER BY day`,
    [range.from, range.to, currency],
  );
  return rows.map((r) => ({ day: r.day, minor: r.minor }));
}

export type Comparison = {
  current: DateRange;
  previous: DateRange;
  incomeNowMinor: number;
  incomeBeforeMinor: number;
  spentNowMinor: number;
  spentBeforeMinor: number;
  /** Largest moves first, in either direction. */
  changes: { categoryId: Id | null; key: string | null; name: string | null; color: string | null; nowMinor: number; beforeMinor: number }[];
  hasPrevious: boolean;
};

export async function getComparison(db: Db, range: DateRange, currency: string, date: LocalDate = today()): Promise<Comparison> {
  const { current, previous } = comparableRanges(range, date);
  const flow = async (r: DateRange) => (await getCashFlow(db, r)).find((f) => f.currency === currency);
  const [now, before] = [await flow(current), await flow(previous)];
  const [spendNow, spendBefore] = [await spendingByCategory(db, current, currency), await spendingByCategory(db, previous, currency)];
  const ids = new Set([...spendNow, ...spendBefore].map((c) => c.categoryId));
  const changes = [...ids]
    .map((id) => {
      const a = spendNow.find((c) => c.categoryId === id);
      const b = spendBefore.find((c) => c.categoryId === id);
      const source = a ?? b;
      return { categoryId: id, key: source?.key ?? null, name: source?.name ?? null, color: source?.color ?? null, nowMinor: a?.minor ?? 0, beforeMinor: b?.minor ?? 0 };
    })
    .sort((x, y) => Math.abs(y.nowMinor - y.beforeMinor) - Math.abs(x.nowMinor - x.beforeMinor));
  return {
    current,
    previous,
    incomeNowMinor: now?.incomeMinor ?? 0,
    incomeBeforeMinor: before?.incomeMinor ?? 0,
    spentNowMinor: now?.expenseMinor ?? 0,
    spentBeforeMinor: before?.expenseMinor ?? 0,
    changes,
    hasPrevious: before !== undefined,
  };
}

export type BudgetSummary = { limitMinor: number; spentMinor: number; remainingMinor: number; count: number };

export type SavedSummary = { savingsAccountsMinor: number; setAsideMinor: number; totalMinor: number };

/** Savings accounts plus money earmarked elsewhere; linked goals are the savings accounts themselves. */
export async function getSaved(db: Db, currency: string): Promise<SavedSummary> {
  const accounts = await listAccounts(db, { includeArchived: true });
  const linked = await db.all<{ linked_account_id: string }>(
    `SELECT linked_account_id FROM savings_goals WHERE linked_account_id IS NOT NULL AND archived_at IS NULL`,
  );
  const savingsAccountsMinor = accounts
    .filter((a) => a.currency === currency && (a.type === 'savings' || linked.some((l) => l.linked_account_id === a.id)))
    .reduce((sum, a) => sum + a.balanceMinor, 0);
  const setAsideMinor = (await getGoalAllocations(db))[currency] ?? 0;
  return { savingsAccountsMinor, setAsideMinor, totalMinor: savingsAccountsMinor + setAsideMinor };
}

export type SpendingSplit = { essentialMinor: number; discretionaryMinor: number; unclassifiedMinor: number };

export async function getSpendingSplit(db: Db, range: DateRange, currency: string): Promise<SpendingSplit> {
  const categories = await spendingByCategory(db, range, currency);
  const sum = (nature: string | null) => categories.filter((c) => c.nature === nature).reduce((total, c) => total + c.minor, 0);
  return { essentialMinor: sum('essential'), discretionaryMinor: sum('discretionary'), unclassifiedMinor: sum(null) };
}
