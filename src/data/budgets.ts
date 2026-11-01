import { budgetRange, type BudgetStatus } from '../domain/budgets';
import { isValidDate, nowIso, today, type LocalDate } from '../domain/dates';
import { fail } from '../domain/errors';
import { assertValidAmount, isSupportedCurrency } from '../domain/money';
import type { Budget, BudgetPeriod, Id } from '../domain/types';
import { getBudgetStatus, type BudgetSummary } from './finance';
import { newId } from './ids';
import type { Db } from './sql';

type Row = {
  id: string;
  name: string;
  period: BudgetPeriod;
  start_date: string | null;
  end_date: string | null;
  amount_minor: number;
  currency: string;
  category_id: string | null;
  account_id: string | null;
  thresholds: string;
  active: number;
};

const toBudget = (r: Row): Budget => ({
  id: r.id,
  name: r.name,
  period: r.period,
  startDate: r.start_date,
  endDate: r.end_date,
  amountMinor: r.amount_minor,
  currency: r.currency,
  categoryId: r.category_id,
  accountId: r.account_id,
  thresholds: JSON.parse(r.thresholds) as number[],
  active: r.active === 1,
});

export async function listBudgets(db: Db, options: { activeOnly?: boolean } = {}): Promise<Budget[]> {
  const rows = await db.all<Row>(`SELECT * FROM budgets ${options.activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, name`);
  return rows.map(toBudget);
}

export async function getBudget(db: Db, id: Id): Promise<Budget | null> {
  const row = await db.get<Row>('SELECT * FROM budgets WHERE id = ?', [id]);
  return row ? toBudget(row) : null;
}

export type BudgetInput = Omit<Budget, 'id'>;

function validate(input: BudgetInput): void {
  if (!input.name.trim()) fail('invalid_name');
  assertValidAmount(input.amountMinor);
  if (!isSupportedCurrency(input.currency)) fail('invalid_currency');
  if (input.period === 'custom') {
    if (!input.startDate || !input.endDate) fail('invalid_date');
    if (!isValidDate(input.startDate) || !isValidDate(input.endDate) || input.startDate > input.endDate) fail('invalid_date');
  }
  if (input.thresholds.some((t) => !Number.isInteger(t) || t <= 0 || t > 200)) fail('threshold_invalid');
}

export async function saveBudget(db: Db, id: Id | null, input: BudgetInput): Promise<Id> {
  validate(input);
  const time = nowIso();
  const values = [input.name.trim(), input.period, input.period === 'custom' ? input.startDate : null, input.period === 'custom' ? input.endDate : null,
    input.amountMinor, input.currency, input.categoryId, input.accountId, JSON.stringify([...input.thresholds].sort((a, b) => a - b)), input.active ? 1 : 0];
  if (id) {
    const { changes } = await db.run(
      `UPDATE budgets SET name = ?, period = ?, start_date = ?, end_date = ?, amount_minor = ?, currency = ?, category_id = ?,
        account_id = ?, thresholds = ?, active = ?, updated_at = ? WHERE id = ?`,
      [...values, time, id],
    );
    if (changes === 0) fail('not_found');
    return id;
  }
  const created = newId();
  await db.run(
    `INSERT INTO budgets (id, name, period, start_date, end_date, amount_minor, currency, category_id, account_id, thresholds, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [created, ...values, time, time],
  );
  return created;
}

export async function deleteBudget(db: Db, id: Id): Promise<void> {
  await db.run('DELETE FROM budgets WHERE id = ?', [id]);
}

export type BudgetWithStatus = { budget: Budget; status: BudgetStatus };

export async function listBudgetStatuses(db: Db, date: LocalDate = today()): Promise<BudgetWithStatus[]> {
  const budgets = await listBudgets(db, { activeOnly: true });
  const result: BudgetWithStatus[] = [];
  for (const budget of budgets) result.push({ budget, status: await getBudgetStatus(db, budget, date) });
  return result;
}

/**
 * One figure for "how much of this month's budget is left". An overall budget, when there is one,
 * already contains the category budgets, so adding them too would count the same money twice.
 */
export function summarizeBudgets(items: BudgetWithStatus[], currency: string): BudgetSummary | null {
  const monthly = items.filter((i) => i.budget.currency === currency && i.budget.period === 'monthly' && !i.budget.accountId);
  const overall = monthly.filter((i) => !i.budget.categoryId);
  const counted = overall.length > 0 ? overall : monthly;
  if (counted.length === 0) return null;
  const limitMinor = counted.reduce((sum, i) => sum + i.budget.amountMinor, 0);
  const spentMinor = counted.reduce((sum, i) => sum + i.status.spentMinor, 0);
  return { limitMinor, spentMinor, remainingMinor: limitMinor - spentMinor, count: counted.length };
}

export type BudgetAlert = { budget: Budget; threshold: number; percentUsed: number };

/**
 * Returns thresholds newly crossed in the current period and records them, so each warning
 * fires at most once per budget period however many expenses follow.
 */
export async function collectBudgetAlerts(db: Db, date: LocalDate = today()): Promise<BudgetAlert[]> {
  const alerts: BudgetAlert[] = [];
  for (const { budget, status } of await listBudgetStatuses(db, date)) {
    if (status.crossedThreshold === null) continue;
    const periodKey = budgetRange(budget, date).from;
    const { changes } = await db.run(
      'INSERT OR IGNORE INTO budget_alerts (budget_id, period_key, threshold, at) VALUES (?, ?, ?, ?)',
      [budget.id, periodKey, status.crossedThreshold, nowIso()],
    );
    if (changes > 0) alerts.push({ budget, threshold: status.crossedThreshold, percentUsed: status.percentUsed });
  }
  return alerts;
}
