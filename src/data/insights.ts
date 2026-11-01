import { addDays, addMonths, comparableRanges, daysBetween, endOfMonth, startOfMonth, today, type DateRange, type LocalDate } from '../domain/dates';
import { buildInsights, findUnusual, type CategorySpend, type Insight } from '../domain/insights';
import { monthlyFactor } from '../domain/recurrence';
import { listBudgetStatuses } from './budgets';
import { getAvailableToSpend, getCashFlow, getMonthlyTrend, getObligations, getPositions, spendingByCategory, type CategoryTotal } from './finance';
import { listRules } from './recurring';
import type { Db } from './sql';

type Namer = (category: { key: string | null; name: string | null }) => string;

const toSpend = (items: CategoryTotal[], nameOf: Namer): CategorySpend[] =>
  items.map((c) => ({ categoryId: c.categoryId, name: nameOf(c), minor: c.minor, discretionary: c.nature === 'discretionary' }));

async function unusualExpenses(db: Db, range: DateRange, currency: string, nameOf: Namer) {
  const rows = await db.all<{ id: string; category_id: string; amount_minor: number; occurred_at: string; description: string | null; key: string | null; name: string | null }>(
    `SELECT t.id, t.category_id, t.amount_minor, t.occurred_at, t.description, c.key, c.name
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type = 'expense' AND t.deleted_at IS NULL AND t.currency = ? AND t.occurred_at < ?
       AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversal_of_id = t.id AND r.deleted_at IS NULL)
     ORDER BY t.occurred_at`,
    [currency, `${range.to}U`],
  );
  const seen = new Map<string, number[]>();
  const found: { transactionId: string; label: string; amountMinor: number; typicalMinor: number }[] = [];
  for (const row of rows) {
    const history = seen.get(row.category_id) ?? [];
    if (row.occurred_at >= range.from) {
      const unusual = findUnusual({ amountMinor: row.amount_minor }, history);
      if (unusual) {
        found.push({ transactionId: row.id, label: row.description ?? nameOf(row), amountMinor: row.amount_minor, typicalMinor: unusual.typicalMinor });
      }
    }
    history.push(row.amount_minor);
    seen.set(row.category_id, history);
  }
  return found.sort((a, b) => b.amountMinor - a.amountMinor);
}

const USUAL_MONTHS = 3;
const ABOVE_USUAL = 1.3;

/** Each category against its own average over the last complete months. */
async function aboveUsual(db: Db, range: DateRange, currency: string, nameOf: Namer) {
  const months = await Promise.all(
    Array.from({ length: USUAL_MONTHS }, (_, i) => {
      const anchor = addMonths(range.from, -(i + 1), 1);
      return spendingByCategory(db, { from: startOfMonth(anchor), to: endOfMonth(anchor) }, currency);
    }),
  );
  if (months.filter((m) => m.length > 0).length < 2) return [];
  const now = await spendingByCategory(db, range, currency);
  return now
    .map((category) => {
      const past = months.map((m) => m.find((c) => c.categoryId === category.categoryId)?.minor ?? 0);
      const usualMinor = Math.round(past.reduce((sum, value) => sum + value, 0) / USUAL_MONTHS);
      return { name: nameOf(category), nowMinor: category.minor, usualMinor };
    })
    .filter((c) => c.usualMinor > 0 && c.nowMinor > c.usualMinor * ABOVE_USUAL)
    .sort((a, b) => b.nowMinor - b.usualMinor - (a.nowMinor - a.usualMinor));
}

export async function getInsights(db: Db, range: DateRange, currency: string, nameOf: Namer, date: LocalDate = today()): Promise<Insight[]> {
  const { current, previous } = comparableRanges(range, date);
  const flow = (await getCashFlow(db, current)).find((f) => f.currency === currency);
  const previousFlow = (await getCashFlow(db, previous)).find((f) => f.currency === currency);
  const spending = toSpend(await spendingByCategory(db, current, currency), nameOf);
  const previousSpending = toSpend(await spendingByCategory(db, previous, currency), nameOf);
  const position = (await getPositions(db)).find((p) => p.currency === currency);

  const rules = (await listRules(db, { activeOnly: true })).filter((r) => r.currency === currency && r.kind === 'expense');
  const monthlyRecurringOutMinor = Math.round(rules.reduce((sum, r) => sum + r.amountMinor * monthlyFactor(r.frequency, r.intervalCount), 0));

  const obligations = (await getObligations(db, 30, date)).filter((o) => o.currency === currency && o.direction === 'out' && o.dueDate <= addDays(date, 30));
  const budgets = await listBudgetStatuses(db, date);
  const trend = await getMonthlyTrend(db, currency, 4, date);

  const monthEnd = endOfMonth(date);
  const untilMonthEnd = await getAvailableToSpend(db, currency, daysBetween(date, monthEnd), date);
  const liquidAfterCommitments = untilMonthEnd.liquidMinor - untilMonthEnd.obligationsMinor;

  const inMonth = range.from === startOfMonth(date) && range.to === monthEnd;
  const elapsed = daysBetween(range.from, date) + 1;
  const monthDays = daysBetween(range.from, range.to) + 1;
  const spent = flow?.expenseMinor ?? 0;
  // A forecast from the first few days would be noise dressed as a number.
  const forecastMinor = inMonth && elapsed >= 7 && elapsed < monthDays && spent > 0 ? Math.round((spent / elapsed) * monthDays) : undefined;

  return buildInsights({
    currency,
    incomeMinor: flow?.incomeMinor ?? 0,
    expenseMinor: spent,
    spending,
    previousSpending,
    hasPreviousData: Boolean(previousFlow),
    previousIncomeMinor: previousFlow?.incomeMinor,
    previousExpenseMinor: previousFlow?.expenseMinor,
    aboveUsual: await aboveUsual(db, current, currency, nameOf),
    shortfallMinor: liquidAfterCommitments < 0 ? -liquidAfterCommitments : undefined,
    forecastMinor,
    monthlyRecurringOutMinor,
    debtIOweMinor: position?.liabilityMinor ?? 0,
    debtOwedToMeMinor: position?.receivableMinor ?? 0,
    upcomingCount: obligations.length,
    upcomingMinor: obligations.reduce((sum, o) => sum + o.amountMinor, 0),
    overBudget: budgets
      .filter((b) => b.budget.currency === currency && b.status.remainingMinor < 0)
      .map((b) => ({ name: b.budget.name, overMinor: -b.status.remainingMinor })),
    unusual: await unusualExpenses(db, range, currency, nameOf),
    // The current month is incomplete, so only finished months form a trend.
    monthEndBalances: trend.slice(0, -1).map((p) => p.closingMinor),
  });
}
