export type InsightBasis = 'fact' | 'estimate';
export type InsightTone = 'neutral' | 'positive' | 'attention';

/** Structured so the wording stays in the translation files, one key per insight kind. */
export type Insight = {
  kind:
    | 'top_category'
    | 'category_increase'
    | 'category_decrease'
    | 'income_vs_expense'
    | 'net_negative'
    | 'recurring_load'
    | 'debts_outstanding'
    | 'upcoming_payments'
    | 'savings_opportunity'
    | 'unusual_transaction'
    | 'budget_exceeded'
    | 'balance_trend_up'
    | 'balance_trend_down'
    | 'spending_up'
    | 'spending_down'
    | 'above_usual'
    | 'commitments_shortfall'
    | 'saving_rate_up'
    | 'saving_rate_down'
    | 'month_forecast';
  basis: InsightBasis;
  tone: InsightTone;
  currency: string;
  amounts: Record<string, number>;
  labels: Record<string, string>;
  transactionId?: string;
};

export type CategorySpend = { categoryId: string | null; name: string; minor: number; discretionary: boolean };

export type InsightInput = {
  currency: string;
  incomeMinor: number;
  expenseMinor: number;
  spending: CategorySpend[];
  previousSpending: CategorySpend[];
  /** True only when at least one transaction exists in the previous period. */
  hasPreviousData: boolean;
  monthlyRecurringOutMinor: number;
  debtIOweMinor: number;
  debtOwedToMeMinor: number;
  upcomingCount: number;
  upcomingMinor: number;
  overBudget: { name: string; overMinor: number }[];
  unusual: { transactionId: string; label: string; amountMinor: number; typicalMinor: number }[];
  /** Month-end totals in chronological order. */
  monthEndBalances: number[];
  /** The same stretch of the previous period, so a period in progress compares fairly. */
  previousIncomeMinor?: number;
  previousExpenseMinor?: number;
  /** Categories well above their own three-month average. */
  aboveUsual?: { name: string; nowMinor: number; usualMinor: number }[];
  /** Commitments left before month end that spendable money does not cover. */
  shortfallMinor?: number;
  /** Projected month total at the current pace; present only part-way through a month. */
  forecastMinor?: number;
};

const MEANINGFUL_CHANGE = 0.2;
const MEANINGFUL_RATE_CHANGE = 5;
const SAVINGS_SHARE = 0.1;

export function buildInsights(input: InsightInput): Insight[] {
  const { currency } = input;
  const insights: Insight[] = [];
  const add = (
    kind: Insight['kind'],
    basis: InsightBasis,
    tone: InsightTone,
    amounts: Record<string, number>,
    labels: Record<string, string> = {},
    transactionId?: string,
  ) => insights.push({ kind, basis, tone, currency, amounts, labels, transactionId });

  if (input.shortfallMinor && input.shortfallMinor > 0) {
    add('commitments_shortfall', 'estimate', 'attention', { amount: input.shortfallMinor });
  }
  for (const item of input.overBudget) {
    add('budget_exceeded', 'fact', 'attention', { over: item.overMinor }, { name: item.name });
  }
  if (input.upcomingCount > 0) {
    add('upcoming_payments', 'fact', 'neutral', { total: input.upcomingMinor, count: input.upcomingCount });
  }

  const ranked = [...input.spending].filter((s) => s.minor > 0).sort((a, b) => b.minor - a.minor);
  if (ranked.length > 0 && input.expenseMinor > 0) {
    add('top_category', 'fact', 'neutral', { amount: ranked[0].minor, percent: Math.round((ranked[0].minor / input.expenseMinor) * 100) }, { name: ranked[0].name });
  }

  if (input.incomeMinor > 0 || input.expenseMinor > 0) {
    const net = input.incomeMinor - input.expenseMinor;
    add(net < 0 ? 'net_negative' : 'income_vs_expense', 'fact', net < 0 ? 'attention' : 'positive', {
      income: input.incomeMinor,
      expense: input.expenseMinor,
      net,
    });
  }

  const spentBefore = input.previousExpenseMinor ?? 0;
  if (input.hasPreviousData && spentBefore > 0 && input.expenseMinor > 0) {
    const change = (input.expenseMinor - spentBefore) / spentBefore;
    if (Math.abs(change) >= MEANINGFUL_CHANGE) {
      add(change > 0 ? 'spending_up' : 'spending_down', 'fact', change > 0 ? 'attention' : 'positive', {
        now: input.expenseMinor,
        before: spentBefore,
        percent: Math.round(Math.abs(change) * 100),
      });
    }
  }

  const incomeBefore = input.previousIncomeMinor ?? 0;
  if (input.hasPreviousData && incomeBefore > 0 && input.incomeMinor > 0) {
    const rateNow = Math.round(((input.incomeMinor - input.expenseMinor) / input.incomeMinor) * 100);
    const rateBefore = Math.round(((incomeBefore - spentBefore) / incomeBefore) * 100);
    if (Math.abs(rateNow - rateBefore) >= MEANINGFUL_RATE_CHANGE) {
      add(rateNow > rateBefore ? 'saving_rate_up' : 'saving_rate_down', 'fact', rateNow > rateBefore ? 'positive' : 'attention', { percent: rateNow, percentBefore: rateBefore });
    }
  }

  for (const item of (input.aboveUsual ?? []).slice(0, 2)) {
    add('above_usual', 'fact', 'attention', { now: item.nowMinor, usual: item.usualMinor }, { name: item.name });
  }

  if (input.forecastMinor) {
    add('month_forecast', 'estimate', 'neutral', { amount: input.forecastMinor });
  }

  if (input.hasPreviousData) {
    const previous = new Map(input.previousSpending.map((s) => [s.categoryId, s.minor]));
    const changes = input.spending
      .map((s) => ({ ...s, before: previous.get(s.categoryId) ?? 0 }))
      .filter((s) => s.before > 0 && Math.abs(s.minor - s.before) / s.before >= MEANINGFUL_CHANGE)
      .sort((a, b) => Math.abs(b.minor - b.before) - Math.abs(a.minor - a.before))
      .slice(0, 3);
    for (const change of changes) {
      const rising = change.minor > change.before;
      add(rising ? 'category_increase' : 'category_decrease', 'fact', rising ? 'attention' : 'positive', { now: change.minor, before: change.before }, { name: change.name });
    }
  }

  for (const item of input.unusual.slice(0, 3)) {
    add('unusual_transaction', 'fact', 'attention', { amount: item.amountMinor, typical: item.typicalMinor }, { label: item.label }, item.transactionId);
  }

  if (input.monthlyRecurringOutMinor > 0) {
    add('recurring_load', 'estimate', 'neutral', { amount: input.monthlyRecurringOutMinor });
  }
  if (input.debtIOweMinor > 0 || input.debtOwedToMeMinor > 0) {
    add('debts_outstanding', 'fact', 'neutral', { owe: input.debtIOweMinor, owed: input.debtOwedToMeMinor });
  }

  const flexible = ranked.find((s) => s.discretionary);
  if (flexible) {
    add('savings_opportunity', 'estimate', 'positive', { amount: Math.round(flexible.minor * SAVINGS_SHARE), base: flexible.minor }, { name: flexible.name });
  }

  const balances = input.monthEndBalances;
  if (balances.length >= 3) {
    const recent = balances.slice(-3);
    const rising = recent[0] < recent[1] && recent[1] < recent[2];
    const falling = recent[0] > recent[1] && recent[1] > recent[2];
    if (rising || falling) {
      add(rising ? 'balance_trend_up' : 'balance_trend_down', 'fact', rising ? 'positive' : 'attention', { from: recent[0], to: recent[2] });
    }
  }

  return insights;
}

/**
 * Flags a transaction when at least 5 earlier ones exist in its category and it is at least
 * three times their median, which stays stable when past amounts are skewed.
 */
export function findUnusual<T extends { amountMinor: number }>(candidate: T, history: number[]): { typicalMinor: number } | null {
  if (history.length < 5) return null;
  const sorted = [...history].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  return median > 0 && candidate.amountMinor >= median * 3 ? { typicalMinor: median } : null;
}
