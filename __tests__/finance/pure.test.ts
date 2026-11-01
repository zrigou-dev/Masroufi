import { computeBudgetStatus } from '../../src/domain/budgets';
import { csvCell, toCsv } from '../../src/domain/csv';
import { addDays, addMonths, endOfMonth, isValidDate, isValidDateTime, periodRange, previousRange, setClock, startOfWeek, today, nowLocal } from '../../src/domain/dates';
import { allocateInstallments, computeDebtState, simulateRepayment, type PlanDebt } from '../../src/domain/debts';
import { computeGoalStatus } from '../../src/domain/goals';
import { buildInsights, findUnusual, type InsightInput } from '../../src/domain/insights';
import { buildLegs } from '../../src/domain/ledger';
import { addMinor, formatMoney, parseAmount, splitEvenly, toDecimalString } from '../../src/domain/money';
import { computeAvailable, planReminders, type Obligation } from '../../src/domain/planning';
import { occurrenceAt, occurrencesBetween } from '../../src/domain/recurrence';

const strip = (s: string) => s.replace(/[⁦⁩]/g, '');

describe('parseAmount', () => {
  test.each([
    ['1250', 125_000],
    ['1250.5', 125_050],
    ['1250,50', 125_050],
    ['1,250.50', 125_050],
    ['1.250,50', 125_050],
    ['1 250,50', 125_050],
    ['1,250', 125_000],
    ['0.01', 1],
    ['.5', 50],
    ['١٢٣٤٫٥٠', 123_450],
    ['۱۲۳', 12_300],
    ['1,234,567.89', 123_456_789],
  ])('reads %s', (input, expected) => {
    expect(parseAmount(input, 'MAD')).toBe(expected);
  });

  test.each(['', 'abc', '12a', '1.2.3', '-5', '12.345', '1.250', '1e5', '99999999999999999'])('rejects %s', (input) => {
    expect(parseAmount(input, 'MAD')).toBeNull();
  });

  test('does not suffer binary rounding', () => {
    expect(parseAmount('0.07', 'MAD')).toBe(7);
    expect(parseAmount('19.99', 'MAD')).toBe(1999);
    expect(parseAmount('1.15', 'MAD')).toBe(115);
    expect(parseAmount('4.35', 'MAD')).toBe(435);
  });

  test('respects each currency’s decimals', () => {
    expect(parseAmount('100', 'JPY')).toBe(100);
    expect(parseAmount('100.5', 'JPY')).toBeNull();
    expect(parseAmount('1.234', 'TND')).toBe(1234);
  });
});

describe('formatting', () => {
  test('per language', () => {
    expect(strip(formatMoney(125_050, 'MAD', 'en'))).toBe('1,250.50 MAD');
    expect(strip(formatMoney(125_050, 'MAD', 'fr'))).toBe('1 250,50 DH');
    expect(strip(formatMoney(125_050, 'MAD', 'ar'))).toBe('1,250.50 درهم');
    expect(strip(formatMoney(-5, 'MAD', 'en'))).toBe('-0.05 MAD');
    expect(strip(formatMoney(5000, 'EUR', 'en', { signed: true }))).toBe('+50.00 EUR');
    expect(strip(formatMoney(1500, 'JPY', 'en'))).toBe('1,500 JPY');
  });

  test('hidden amounts reveal nothing', () => {
    expect(formatMoney(123_456, 'MAD', 'en', { hidden: true })).not.toMatch(/\d/);
  });

  test('decimal strings round trip', () => {
    expect(toDecimalString(5, 'MAD')).toBe('0.05');
    expect(toDecimalString(-125_050, 'MAD')).toBe('-1250.50');
    expect(parseAmount(toDecimalString(987_654_321, 'MAD'), 'MAD')).toBe(987_654_321);
  });

  test('splitEvenly never loses a centime', () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(100_001, 7).reduce((a, b) => a + b, 0)).toBe(100_001);
  });

  test('addMinor refuses unsafe totals', () => {
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, 1)).toThrow();
  });
});

describe('dates', () => {
  afterEach(() => setClock(null));

  test('validation', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-1')).toBe(false);
    expect(isValidDateTime('2026-01-01T24:00')).toBe(false);
    expect(isValidDateTime('2026-01-01T23:59')).toBe(true);
  });

  test('month arithmetic clamps at month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });

  test('a late-night local time stays on its local day', () => {
    setClock(() => new Date(2026, 0, 31, 23, 59));
    expect(today()).toBe('2026-01-31');
    expect(nowLocal()).toBe('2026-01-31T23:59');
  });

  test('crossing DST changes in day arithmetic stays exact', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 3)).toBe('2026-10-27');
  });

  test('weeks start on Monday', () => {
    expect(startOfWeek('2026-06-14')).toBe('2026-06-08');
    expect(startOfWeek('2026-06-15')).toBe('2026-06-15');
    expect(periodRange('week', '2026-06-17')).toEqual({ from: '2026-06-15', to: '2026-06-21' });
  });

  test('previous period', () => {
    expect(previousRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousRange({ from: '2026-01-01', to: '2026-12-31' })).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(previousRange({ from: '2026-06-15', to: '2026-06-21' })).toEqual({ from: '2026-06-08', to: '2026-06-14' });
  });
});

describe('ledger legs', () => {
  test('transfers are balanced', () => {
    const legs = buildLegs({ type: 'transfer', amountMinor: 100, currency: 'MAD', accountId: 'a', toAccountId: 'b' });
    expect(legs.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(0);
    expect(legs).toHaveLength(2);
  });

  test('transfer without a target is refused', () => {
    expect(() => buildLegs({ type: 'transfer', amountMinor: 100, currency: 'MAD', accountId: 'a' })).toThrow();
  });
});

describe('recurrence', () => {
  const monthly = { frequency: 'monthly' as const, intervalCount: 1, startDate: '2026-01-31', endDate: null };

  test('month-end rules do not drift after a short month', () => {
    expect([0, 1, 2, 3].map((n) => occurrenceAt(monthly, n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  test('respects the end date', () => {
    expect(occurrencesBetween({ ...monthly, endDate: '2026-03-01' }, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-02-28']);
  });

  test('weekly with interval', () => {
    expect(occurrencesBetween({ frequency: 'weekly', intervalCount: 2, startDate: '2026-01-01', endDate: null }, '2026-01-10', '2026-02-01')).toEqual(['2026-01-15', '2026-01-29']);
  });

  test('yearly on 29 February', () => {
    expect(occurrenceAt({ frequency: 'yearly', intervalCount: 1, startDate: '2028-02-29', endDate: null }, 1)).toBe('2029-02-28');
  });
});

describe('installment allocation', () => {
  const items = [
    { id: 'b', debtId: 'd', dueDate: '2026-02-01', amountMinor: 100 },
    { id: 'a', debtId: 'd', dueDate: '2026-01-01', amountMinor: 100 },
    { id: 'c', debtId: 'd', dueDate: '2026-03-01', amountMinor: 100 },
  ];

  test('payments fill the oldest installment first', () => {
    const result = allocateInstallments(items, 150, '2026-01-15');
    expect(result.map((r) => [r.id, r.paidMinor, r.state])).toEqual([['a', 100, 'paid'], ['b', 50, 'partial'], ['c', 0, 'unpaid']]);
  });

  test('overdue only counts what is unpaid and past due', () => {
    const state = computeDebtState({ principalMinor: 300, feesMinor: 0, dueDate: null, closure: 'active' }, 150, items, '2026-02-15');
    expect(state.overdueMinor).toBe(50);
    expect(state.status).toBe('overdue');
    expect(state.nextDueDate).toBe('2026-02-01');
  });
});

describe('debt state', () => {
  const base = { principalMinor: 1000, feesMinor: 0, dueDate: null, closure: 'active' as const };

  test('status transitions', () => {
    expect(computeDebtState(base, 0, [], '2026-01-01').status).toBe('open');
    expect(computeDebtState(base, 400, [], '2026-01-01').status).toBe('partial');
    expect(computeDebtState(base, 1000, [], '2026-01-01').status).toBe('settled');
    expect(computeDebtState({ ...base, dueDate: '2025-12-31' }, 400, [], '2026-01-01')).toMatchObject({ status: 'overdue', overdueMinor: 600 });
    expect(computeDebtState({ ...base, dueDate: '2026-01-01' }, 0, [], '2026-01-01').status).toBe('open');
  });

  test('fees are part of what is due', () => {
    expect(computeDebtState({ ...base, feesMinor: 200 }, 1000, [], '2026-01-01')).toMatchObject({ remainingMinor: 200, totalDueMinor: 1200 });
  });

  test('closing stops the balance but keeps what was paid', () => {
    expect(computeDebtState({ ...base, closure: 'written_off' }, 300, [], '2026-01-01')).toMatchObject({ remainingMinor: 0, paidMinor: 300, status: 'written_off' });
  });

  test('overpayment is reported, never a negative balance', () => {
    expect(computeDebtState(base, 1200, [], '2026-01-01')).toMatchObject({ remainingMinor: 0, overpaidMinor: 200, status: 'settled' });
  });
});

describe('repayment simulation', () => {
  const debts: PlanDebt[] = [
    { id: 'small', remainingMinor: 100_000, monthlyRateBps: 0, minimumMinor: 10_000, dueDate: '2027-01-01', priority: 0 },
    { id: 'costly', remainingMinor: 500_000, monthlyRateBps: 200, minimumMinor: 20_000, dueDate: '2026-09-01', priority: 5 },
  ];

  test('avalanche pays less interest than snowball on a mixed book', () => {
    const avalanche = simulateRepayment(debts, 100_000, 'avalanche');
    const snowball = simulateRepayment(debts, 100_000, 'snowball');
    expect(avalanche.completes && snowball.completes).toBe(true);
    expect(avalanche.interestMinor).toBeLessThan(snowball.interestMinor);
    expect(snowball.order[0]).toBe('small');
  });

  test('zero-interest repayment has an exact answer', () => {
    const result = simulateRepayment([{ ...debts[0], remainingMinor: 300_000 }], 100_000, 'due_date');
    expect(result).toMatchObject({ months: 3, interestMinor: 0, completes: true });
  });

  test('a budget that cannot beat interest is reported, not looped forever', () => {
    const result = simulateRepayment([{ ...debts[1], remainingMinor: 10_000_000, minimumMinor: 1000 }], 1000, 'priority');
    expect(result.completes).toBe(false);
  });
});

describe('budget status', () => {
  const range = { from: '2026-06-01', to: '2026-06-30' };
  const budget = { amountMinor: 30_000, thresholds: [70, 85, 100] };

  test('expected pace is proportional to elapsed days', () => {
    expect(computeBudgetStatus(budget, range, 10_000, '2026-06-15')).toMatchObject({ expectedMinor: 15_000, pace: 'under', remainingMinor: 20_000 });
    expect(computeBudgetStatus(budget, range, 15_000, '2026-06-15').pace).toBe('on_track');
    expect(computeBudgetStatus(budget, range, 20_000, '2026-06-15').pace).toBe('ahead');
    expect(computeBudgetStatus(budget, range, 31_000, '2026-06-15')).toMatchObject({ pace: 'over', remainingMinor: -1_000 });
  });

  test('crossed threshold', () => {
    expect(computeBudgetStatus(budget, range, 20_000, '2026-06-15').crossedThreshold).toBeNull();
    expect(computeBudgetStatus(budget, range, 21_000, '2026-06-15').crossedThreshold).toBe(70);
    expect(computeBudgetStatus(budget, range, 30_000, '2026-06-15').crossedThreshold).toBe(100);
  });
});

describe('goal status', () => {
  test('suggested contribution and realism', () => {
    const goal = { targetMinor: 120_000, targetDate: '2026-12-01' };
    expect(computeGoalStatus(goal, 0, '2026-06-01', 30_000)).toMatchObject({ suggestedMonthlyMinor: 20_000, monthsLeft: 6, realism: 'realistic' });
    expect(computeGoalStatus(goal, 0, '2026-06-01', 10_000).realism).toBe('stretch');
    expect(computeGoalStatus(goal, 0, '2026-06-01', null).realism).toBe('unknown');
    expect(computeGoalStatus(goal, 120_000, '2026-06-01', null).realism).toBe('reached');
    expect(computeGoalStatus(goal, 0, '2027-01-01', 30_000).realism).toBe('past_due');
  });

  test('no target date means no invented estimate', () => {
    expect(computeGoalStatus({ targetMinor: 100, targetDate: null }, 50, '2026-06-01', 10)).toMatchObject({ suggestedMonthlyMinor: null, percent: 50 });
  });

  test('an overdrawn linked account shows zero, not negative progress', () => {
    expect(computeGoalStatus({ targetMinor: 100, targetDate: null }, -50, '2026-06-01', 10)).toMatchObject({ currentMinor: 0, percent: 0 });
  });
});

describe('available to spend', () => {
  const obligation = (over: Partial<Obligation>): Obligation => ({ key: 'k', source: 'recurring', label: 'x', dueDate: '2026-06-20', amountMinor: 1000, currency: 'MAD', direction: 'out', overdue: false, reminderDaysBefore: 1, ...over });

  test('reminders honour each rule: its own notice, or none at all', () => {
    const planned = planReminders([
      obligation({ key: 'three', dueDate: '2026-06-20', reminderDaysBefore: 3 }),
      obligation({ key: 'none', reminderDaysBefore: null }),
      obligation({ key: 'late', overdue: true, dueDate: '2026-06-01' }),
      obligation({ key: 'missed', dueDate: '2026-06-15', reminderDaysBefore: 1 }),
      obligation({ key: 'today', dueDate: '2026-06-16', reminderDaysBefore: 1 }),
    ], '2026-06-15');
    expect(planned.map((p) => [p.obligation.key, p.on])).toEqual([['today', '2026-06-15'], ['three', '2026-06-17']]);
  });

  test('reminders stay within the platform limit, soonest first', () => {
    const many = Array.from({ length: 80 }, (_, i) => obligation({ key: String(i), dueDate: `2026-07-${String((i % 28) + 1).padStart(2, '0')}` }));
    const planned = planReminders(many, '2026-06-15', 50);
    expect(planned).toHaveLength(50);
    expect(planned[0].on <= planned[49].on).toBe(true);
  });

  test('subtracts obligations and earmarks, ignores other currencies and expected income', () => {
    const result = computeAvailable({
      currency: 'MAD',
      liquidMinor: 10_000,
      goalAllocationsMinor: 2_000,
      horizonDays: 30,
      obligations: [obligation({}), obligation({ key: 'e', currency: 'EUR' }), obligation({ key: 'i', direction: 'in', amountMinor: 50_000 })],
    });
    expect(result.availableMinor).toBe(7_000);
  });
});

describe('insights', () => {
  const base: InsightInput = {
    currency: 'MAD', incomeMinor: 0, expenseMinor: 0, spending: [], previousSpending: [], hasPreviousData: false,
    monthlyRecurringOutMinor: 0, debtIOweMinor: 0, debtOwedToMeMinor: 0, upcomingCount: 0, upcomingMinor: 0, overBudget: [], unusual: [], monthEndBalances: [],
  };
  const cat = (id: string, minor: number, discretionary = false) => ({ categoryId: id, name: id, minor, discretionary });

  test('an empty book yields no claims at all', () => {
    expect(buildInsights(base)).toEqual([]);
  });

  test('no comparison without previous data', () => {
    const result = buildInsights({ ...base, expenseMinor: 45_000, spending: [cat('food', 45_000)] });
    expect(result.some((i) => i.kind === 'category_increase')).toBe(false);
  });

  test('compares only when the numbers exist', () => {
    const result = buildInsights({ ...base, expenseMinor: 45_000, spending: [cat('rest', 45_000)], previousSpending: [cat('rest', 30_000)], hasPreviousData: true });
    expect(result.find((i) => i.kind === 'category_increase')).toMatchObject({ basis: 'fact', amounts: { now: 45_000, before: 30_000 } });
  });

  test('a new category is not reported as an increase', () => {
    const result = buildInsights({ ...base, expenseMinor: 45_000, spending: [cat('new', 45_000)], previousSpending: [cat('other', 1)], hasPreviousData: true });
    expect(result.some((i) => i.kind === 'category_increase')).toBe(false);
  });

  test('suggestions are labelled as estimates', () => {
    const result = buildInsights({ ...base, expenseMinor: 10_000, spending: [cat('fun', 10_000, true)] });
    expect(result.find((i) => i.kind === 'savings_opportunity')).toMatchObject({ basis: 'estimate', amounts: { amount: 1_000 } });
  });

  test('unusual needs enough history', () => {
    expect(findUnusual({ amountMinor: 1000 }, [10, 10, 10, 10])).toBeNull();
    expect(findUnusual({ amountMinor: 1000 }, [10, 10, 10, 10, 10])).toEqual({ typicalMinor: 10 });
    expect(findUnusual({ amountMinor: 20 }, [10, 10, 10, 10, 10])).toBeNull();
  });
});

describe('csv', () => {
  test('quotes separators, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  test('neutralises spreadsheet formulas in text but not in numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe(`'@cmd`);
    expect(csvCell('-12.50', true)).toBe('-12.50');
  });

  test('starts with a BOM so Arabic opens correctly', () => {
    expect(toCsv(['الاسم'], [['قهوة']]).startsWith('﻿')).toBe(true);
  });
});
