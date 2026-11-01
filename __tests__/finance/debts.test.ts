import { createAccount, getAccount } from '../../src/data/accounts';
import { clearSchedule, closeDebt, createDebt, deleteDebt, equalSchedule, getDebt, listDebtEvents, listDebts, reopenDebt, replaceSchedule, updateDebt } from '../../src/data/debts';
import { getAvailableToSpend, getCashFlow, getObligations, getPositions } from '../../src/data/finance';
import { addAllocation, listGoals, saveGoal } from '../../src/data/goals';
import { verifyLedger } from '../../src/data/integrity';
import { confirmOccurrence, listRules, pendingOccurrences, saveRule, skipOccurrence, deleteRule, type RuleInput } from '../../src/data/recurring';
import type { DbWithEvents } from '../../src/data/sql';
import { createTransaction, deleteTransaction, listTransactions, restoreTransaction, reverseTransaction, updateTransaction } from '../../src/data/transactions';
import { setClock } from '../../src/domain/dates';
import { openTestDb } from '../helpers/testDb';

const at = '2026-06-15T12:00';
let db: DbWithEvents;
let bank: string;
let cash: string;

const balance = async (id: string) => (await getAccount(db, id))?.balanceMinor;
const mad = async () => (await getPositions(db)).find((p) => p.currency === 'MAD');
const iOwe = (extra: object = {}) =>
  createDebt(db, { direction: 'i_owe', counterparty: 'Ali', principalMinor: 200_000, currency: 'MAD', startDate: '2026-06-01', accountId: bank, ...extra });
const repay = (debtId: string, amountMinor: number, extra: object = {}) =>
  createTransaction(db, { type: 'debt_repayment', debtId, amountMinor, accountId: bank, occurredAt: at, ...extra });

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ code });
}

beforeEach(async () => {
  setClock(() => new Date(2026, 5, 20, 10, 0));
  db = await openTestDb();
  bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 1_000_000, createdOn: '2026-01-01' });
  cash = await createAccount(db, { name: 'Cash', type: 'cash', currency: 'MAD', openingBalanceMinor: 100_000, createdOn: '2026-01-01' });
});

afterEach(async () => {
  expect(await verifyLedger(db)).toEqual([]);
  setClock(null);
});

describe('debt lifecycle', () => {
  test('a debt predating the app moves no money but counts as a liability', async () => {
    await iOwe({ accountId: null });
    expect(await balance(bank)).toBe(1_000_000);
    expect((await mad())?.liabilityMinor).toBe(200_000);
    expect((await mad())?.netMinor).toBe(900_000);
  });

  test('partial then full repayment, from different accounts', async () => {
    const id = await iOwe();
    await repay(id, 50_000);
    await repay(id, 50_000, { accountId: cash });
    expect((await getDebt(db, id))?.state).toMatchObject({ paidMinor: 100_000, remainingMinor: 100_000, status: 'partial' });
    await repay(id, 100_000);
    expect((await getDebt(db, id))?.state).toMatchObject({ remainingMinor: 0, status: 'settled', progress: 1 });
    expect(await balance(cash)).toBe(50_000);
    expect(await balance(bank)).toBe(1_050_000);
  });

  test('two debts with one person stay separate', async () => {
    const first = await iOwe();
    const second = await iOwe();
    await repay(first, 200_000);
    expect((await getDebt(db, first))?.state.status).toBe('settled');
    expect((await getDebt(db, second))?.state.remainingMinor).toBe(200_000);
    expect(await listDebts(db)).toHaveLength(2);
  });

  test('repaying more than the balance needs explicit consent', async () => {
    const id = await iOwe();
    await expectCode(repay(id, 200_001), 'payment_exceeds_debt');
    await repay(id, 250_000, { allowOverpayment: true });
    expect((await getDebt(db, id))?.state).toMatchObject({ remainingMinor: 0, overpaidMinor: 50_000, status: 'settled' });
  });

  test('overpayment becomes a receivable, keeping net position conserved', async () => {
    const id = await iOwe();
    const before = (await mad())?.netMinor;
    await repay(id, 250_000, { allowOverpayment: true });
    expect(await mad()).toMatchObject({ receivableMinor: 50_000, liabilityMinor: 0, netMinor: before });
  });

  test('the wrong payment direction is refused', async () => {
    const id = await iOwe();
    await expectCode(createTransaction(db, { type: 'debt_collection', debtId: id, amountMinor: 100, accountId: bank, occurredAt: at }), 'invalid_input');
  });

  test('debt payments must match the debt currency', async () => {
    const euro = await createAccount(db, { name: 'Euro', type: 'bank', currency: 'EUR', openingBalanceMinor: 100_000 });
    const id = await iOwe();
    await expectCode(repay(id, 100, { accountId: euro }), 'currency_mismatch');
    await expectCode(iOwe({ accountId: euro }), 'currency_mismatch');
  });

  test('the debt creation itself is atomic', async () => {
    await expectCode(iOwe({ schedule: [{ dueDate: '2026-07-01', amountMinor: 1 }] }), 'schedule_mismatch');
    expect(await listDebts(db)).toEqual([]);
    expect(await balance(bank)).toBe(1_000_000);
  });

  test('double tap on create makes one debt and one movement', async () => {
    const [a, b] = await Promise.all([iOwe({ idempotencyKey: 'k' }), iOwe({ idempotencyKey: 'k' })]);
    expect(a).toBe(b);
    expect(await listDebts(db)).toHaveLength(1);
    expect(await balance(bank)).toBe(1_200_000);
  });

  test('deleting a payment restores the balance and the debt; undo re-applies it', async () => {
    const id = await iOwe();
    const payment = await repay(id, 50_000);
    await deleteTransaction(db, payment);
    expect((await getDebt(db, id))?.state.remainingMinor).toBe(200_000);
    expect(await balance(bank)).toBe(1_200_000);
    await restoreTransaction(db, payment);
    expect((await getDebt(db, id))?.state.remainingMinor).toBe(150_000);
  });

  test('undo cannot overpay a debt that was paid another way meanwhile', async () => {
    const id = await iOwe();
    const payment = await repay(id, 200_000);
    await deleteTransaction(db, payment);
    await repay(id, 200_000);
    await expectCode(restoreTransaction(db, payment), 'payment_exceeds_debt');
    expect((await getDebt(db, id))?.state.overpaidMinor).toBe(0);
  });

  test('editing a payment is checked against the balance excluding itself', async () => {
    const id = await iOwe();
    const payment = await repay(id, 150_000);
    await updateTransaction(db, payment, { type: 'debt_repayment', debtId: id, amountMinor: 200_000, accountId: bank, occurredAt: at });
    expect((await getDebt(db, id))?.state.remainingMinor).toBe(0);
    await expectCode(updateTransaction(db, payment, { type: 'debt_repayment', debtId: id, amountMinor: 200_001, accountId: bank, occurredAt: at }), 'payment_exceeds_debt');
  });

  test('reversing a payment puts the debt back', async () => {
    const id = await iOwe();
    const payment = await repay(id, 50_000);
    await reverseTransaction(db, payment, at);
    expect((await getDebt(db, id))?.state).toMatchObject({ paidMinor: 0, remainingMinor: 200_000, status: 'open' });
    expect(await balance(bank)).toBe(1_200_000);
    expect(await getCashFlow(db, { from: '2026-06-01', to: '2026-06-30' })).toEqual([]);
  });

  test('borrowing and repaying leave only the cost of nothing: net is unchanged', async () => {
    const start = (await mad())?.netMinor;
    const id = await iOwe();
    await repay(id, 120_000);
    expect((await mad())?.netMinor).toBe(start);
  });

  test('fees raise what is owed and lower net position', async () => {
    const id = await iOwe({ feesMinor: 10_000 });
    expect((await getDebt(db, id))?.state.remainingMinor).toBe(210_000);
    expect((await mad())?.netMinor).toBe(1_090_000);
  });

  test('principal edits follow through to the account, but not below what is paid', async () => {
    const id = await iOwe();
    await repay(id, 100_000);
    const patch = { counterparty: 'Ali', principalMinor: 250_000, feesMinor: 0, interestRateBps: null, startDate: '2026-06-01', dueDate: null, description: null, referenceNotes: null, priority: 0 };
    await updateDebt(db, id, patch);
    expect(await balance(bank)).toBe(1_150_000);
    expect((await getDebt(db, id))?.state.remainingMinor).toBe(150_000);
    await expectCode(updateDebt(db, id, { ...patch, principalMinor: 99_999 }), 'principal_below_paid');
  });

  test('write-off clears the balance, keeps history, blocks payments, can be reopened', async () => {
    const id = await iOwe();
    await repay(id, 50_000);
    await closeDebt(db, id, 'written_off', 'forgiven');
    expect((await getDebt(db, id))?.state).toMatchObject({ remainingMinor: 0, status: 'written_off', paidMinor: 50_000 });
    expect((await mad())?.liabilityMinor).toBe(0);
    await expectCode(repay(id, 100), 'debt_closed');
    expect((await listDebtEvents(db, id)).map((e) => e.kind)).toContain('written_off');
    expect(await listTransactions(db, { debtId: id })).toHaveLength(2);
    await reopenDebt(db, id);
    expect((await getDebt(db, id))?.state.remainingMinor).toBe(150_000);
  });

  test('a debt with payments cannot be deleted; a mistaken one can', async () => {
    const paid = await iOwe();
    await repay(paid, 100);
    await expectCode(deleteDebt(db, paid), 'debt_has_payments');
    const mistake = await iOwe();
    const before = await balance(bank);
    await deleteDebt(db, mistake);
    expect(await getDebt(db, mistake)).toBeNull();
    expect(await balance(bank)).toBe((before as number) - 200_000);
  });

  test('the opening transaction cannot be removed on its own', async () => {
    await iOwe();
    const [opening] = await listTransactions(db, { types: ['debt_borrowed'] });
    await expectCode(deleteTransaction(db, opening.id), 'managed_transaction');
  });
});

describe('installment schedules', () => {
  const schedule = equalSchedule(200_000, 4, '2026-05-15');

  test('equal schedule sums exactly and walks months', () => {
    expect(equalSchedule(100_001, 3, '2026-01-31')).toEqual([
      { amountMinor: 33_334, dueDate: '2026-01-31' },
      { amountMinor: 33_334, dueDate: '2026-02-28' },
      { amountMinor: 33_333, dueDate: '2026-03-31' },
    ]);
  });

  test('a schedule must cover the debt exactly', async () => {
    const id = await iOwe();
    await expectCode(replaceSchedule(db, id, [{ dueDate: '2026-07-01', amountMinor: 100 }]), 'schedule_mismatch');
    await expectCode(replaceSchedule(db, id, []), 'schedule_empty');
  });

  test('overdue amount and next payment from the schedule', async () => {
    const id = await iOwe({ schedule });
    await repay(id, 30_000);
    // Today is 06-20: the 05-15 installment has 20,000 unpaid and the 06-15 one all 50,000.
    expect((await getDebt(db, id))?.state).toMatchObject({ status: 'overdue', overdueMinor: 70_000, nextDueDate: '2026-05-15', nextDueMinor: 20_000 });
  });

  test('rescheduling keeps paid history and the remaining total', async () => {
    const id = await iOwe({ schedule });
    await repay(id, 70_000);
    const before = (await listTransactions(db, { debtId: id })).length;
    await replaceSchedule(db, id, equalSchedule(130_000, 2, '2026-09-01'));

    const state = (await getDebt(db, id))?.state;
    expect(state).toMatchObject({ paidMinor: 70_000, remainingMinor: 130_000, overdueMinor: 0, nextDueDate: '2026-09-01' });
    expect(state?.installments.reduce((sum, i) => sum + i.amountMinor, 0)).toBe(200_000);
    expect(state?.installments.filter((i) => i.state === 'paid').reduce((sum, i) => sum + i.amountMinor, 0)).toBe(70_000);
    expect(await listTransactions(db, { debtId: id })).toHaveLength(before);
    expect((await listDebtEvents(db, id))[0].kind).toBe('schedule_changed');
  });

  test('adding a plan to a debt with earlier payments keeps those payments', async () => {
    const id = await iOwe();
    await repay(id, 50_000);
    await replaceSchedule(db, id, equalSchedule(150_000, 3, '2026-07-01'));
    expect((await getDebt(db, id))?.state).toMatchObject({ paidMinor: 50_000, remainingMinor: 150_000, overdueMinor: 0, nextDueMinor: 50_000 });
  });

  test('clearing a schedule leaves payments untouched', async () => {
    const id = await iOwe({ schedule });
    await repay(id, 30_000);
    await clearSchedule(db, id);
    expect((await getDebt(db, id))?.state).toMatchObject({ paidMinor: 30_000, remainingMinor: 170_000, overdueMinor: 0 });
  });

  test('a scheduled debt appears in obligations once per installment, never again by due date', async () => {
    await iOwe({ schedule, dueDate: '2026-08-01' });
    const obligations = await getObligations(db, 365);
    expect(obligations).toHaveLength(4);
    expect(obligations.every((o) => o.source === 'installment')).toBe(true);
  });
});

describe('recurring rules', () => {
  const rent: RuleInput = {
    name: 'Rent', kind: 'expense', amountMinor: 280_000, currency: 'MAD', accountId: null, categoryId: 'cat_housing',
    frequency: 'monthly', intervalCount: 1, startDate: '2026-05-01', endDate: null, reminderDaysBefore: 2, active: true, autoPost: false,
  };
  const pendingDates = async (until = '2026-07-31') => (await pendingOccurrences(db, until)).map((o) => o.dueDate);

  test('planned occurrences move no money', async () => {
    await saveRule(db, null, { ...rent, accountId: bank });
    expect(await pendingDates()).toEqual(['2026-05-01', '2026-06-01', '2026-07-01']);
    expect(await balance(bank)).toBe(1_000_000);
    expect(await listTransactions(db, { types: ['expense'] })).toEqual([]);
  });

  test('confirming twice records one payment', async () => {
    const id = await saveRule(db, null, { ...rent, accountId: bank });
    const [a, b] = await Promise.all([confirmOccurrence(db, id, '2026-06-01'), confirmOccurrence(db, id, '2026-06-01')]);
    const c = await confirmOccurrence(db, id, '2026-06-01');
    expect(new Set([a, b, c]).size).toBe(1);
    expect(await balance(bank)).toBe(720_000);
    expect(await pendingDates()).toEqual(['2026-05-01', '2026-07-01']);
  });

  test('the database refuses a second payment for an occurrence', async () => {
    const id = await saveRule(db, null, { ...rent, accountId: bank });
    await confirmOccurrence(db, id, '2026-06-01');
    await expect(createTransaction(db, {
      type: 'expense', amountMinor: 1, accountId: bank, categoryId: 'cat_housing', occurredAt: at, recurringRuleId: id, recurringDueDate: '2026-06-01',
    })).rejects.toThrow(/UNIQUE/);
  });

  test('confirmation can use a different amount and account', async () => {
    const id = await saveRule(db, null, { ...rent, accountId: bank });
    await confirmOccurrence(db, id, '2026-06-01', { amountMinor: 290_000, accountId: cash });
    expect(await balance(cash)).toBe(-190_000);
  });

  test('deleting the payment returns the occurrence to pending; undo after re-paying is refused', async () => {
    const id = await saveRule(db, null, { ...rent, accountId: bank });
    const tx = await confirmOccurrence(db, id, '2026-06-01');
    await deleteTransaction(db, tx);
    expect(await pendingDates()).toContain('2026-06-01');
    await confirmOccurrence(db, id, '2026-06-01');
    await expectCode(restoreTransaction(db, tx), 'occurrence_resolved');
    expect(await balance(bank)).toBe(720_000);
  });

  test('skip is explicit and moves no money', async () => {
    const id = await saveRule(db, null, { ...rent, accountId: bank });
    await skipOccurrence(db, id, '2026-05-01');
    await skipOccurrence(db, id, '2026-05-01');
    expect(await pendingDates()).toEqual(['2026-06-01', '2026-07-01']);
    expect(await balance(bank)).toBe(1_000_000);
  });

  test('a date the rule does not produce is refused', async () => {
    const id = await saveRule(db, null, { ...rent, accountId: bank });
    await expectCode(confirmOccurrence(db, id, '2026-06-02'), 'invalid_date');
  });

  test('paused and deleted rules stop producing', async () => {
    const id = await saveRule(db, null, { ...rent, accountId: bank, active: false });
    expect(await pendingDates()).toEqual([]);
    await saveRule(db, id, { ...rent, accountId: bank, active: true });
    expect((await pendingDates()).length).toBe(3);
    await deleteRule(db, id);
    expect(await pendingDates()).toEqual([]);
    expect(await listRules(db)).toEqual([]);
  });

  test('rule currency must match its account, kind must match its category', async () => {
    await expectCode(saveRule(db, null, { ...rent, accountId: bank, currency: 'EUR' }), 'currency_mismatch');
    await expectCode(saveRule(db, null, { ...rent, kind: 'income' }), 'category_kind_mismatch');
  });
});

describe('available to spend', () => {
  test('never double-counts an installment, a due date and a budget', async () => {
    await iOwe({ accountId: null, dueDate: '2026-12-31', schedule: equalSchedule(200_000, 2, '2026-06-25') });
    await saveRule(db, null, {
      name: 'Rent', kind: 'expense', amountMinor: 30_000, currency: 'MAD', accountId: bank, categoryId: 'cat_housing',
      frequency: 'monthly', intervalCount: 1, startDate: '2026-07-01', endDate: null, reminderDaysBefore: null, active: true, autoPost: false,
    });
    const goal = await saveGoal(db, null, { name: 'Laptop', targetMinor: 500_000, currency: 'MAD', targetDate: null, priority: 0, notes: null, mode: 'manual', linkedAccountId: null });
    await addAllocation(db, goal, 50_000);

    const result = await getAvailableToSpend(db, 'MAD', 30);
    expect(result.liquidMinor).toBe(1_100_000);
    expect(result.obligationsMinor).toBe(100_000 + 100_000 + 30_000 - 100_000);
    expect(result.goalAllocationsMinor).toBe(50_000);
    expect(result.availableMinor).toBe(1_100_000 - 130_000 - 50_000);
  });

  test('savings accounts are not liquid; a goal-linked account is excluded once', async () => {
    const savings = await createAccount(db, { name: 'Savings', type: 'savings', currency: 'MAD', openingBalanceMinor: 400_000 });
    expect((await getAvailableToSpend(db, 'MAD', 30)).liquidMinor).toBe(1_100_000);
    await saveGoal(db, null, { name: 'Fund', targetMinor: 800_000, currency: 'MAD', targetDate: null, priority: 0, notes: null, mode: 'account', linkedAccountId: savings });
    expect((await getAvailableToSpend(db, 'MAD', 30)).availableMinor).toBe(1_100_000);
  });

  test('overdue obligations stay included', async () => {
    await iOwe({ accountId: null, dueDate: '2026-06-10' });
    const result = await getAvailableToSpend(db, 'MAD', 30);
    expect(result.obligationsMinor).toBe(200_000);
    expect(result.obligations[0].overdue).toBe(true);
  });

  test('money owed to me is never counted as available', async () => {
    await createDebt(db, { direction: 'owed_to_me', counterparty: 'Sara', principalMinor: 500_000, currency: 'MAD', startDate: '2026-06-01', accountId: null, dueDate: '2026-06-22' });
    expect((await getAvailableToSpend(db, 'MAD', 30)).availableMinor).toBe(1_100_000);
  });
});

describe('savings goals', () => {
  const input = { name: 'Fund', targetMinor: 100_000, currency: 'MAD', targetDate: null, priority: 0, notes: null };

  test('moving money to savings is a transfer, and linked progress follows the balance', async () => {
    const savings = await createAccount(db, { name: 'Savings', type: 'savings', currency: 'MAD' });
    await saveGoal(db, null, { ...input, mode: 'account', linkedAccountId: savings });
    await createTransaction(db, { type: 'transfer', amountMinor: 40_000, accountId: bank, toAccountId: savings, occurredAt: at });
    expect((await listGoals(db))[0].status.percent).toBe(40);
    expect(await getCashFlow(db, { from: '2026-06-01', to: '2026-06-30' })).toEqual([]);
  });

  test('one account cannot fund two goals', async () => {
    const savings = await createAccount(db, { name: 'Savings', type: 'savings', currency: 'MAD' });
    await saveGoal(db, null, { ...input, mode: 'account', linkedAccountId: savings });
    await expectCode(saveGoal(db, null, { ...input, mode: 'account', linkedAccountId: savings }), 'goal_account_taken');
  });

  test('allocations earmark without moving money and cannot go below zero', async () => {
    const goal = await saveGoal(db, null, { ...input, mode: 'manual', linkedAccountId: null });
    await addAllocation(db, goal, 30_000);
    expect(await balance(bank)).toBe(1_000_000);
    await expectCode(addAllocation(db, goal, -30_001), 'allocation_negative');
    await addAllocation(db, goal, -10_000);
    expect((await listGoals(db))[0].status.currentMinor).toBe(20_000);
  });

  test('a suggestion uses real history only', async () => {
    await saveGoal(db, null, { ...input, targetDate: '2026-12-20', mode: 'manual', linkedAccountId: null });
    expect((await listGoals(db))[0].status.realism).toBe('unknown');
    await createTransaction(db, { type: 'income', amountMinor: 900_000, accountId: bank, categoryId: 'cat_salary', occurredAt: '2026-05-10T10:00' });
    expect((await listGoals(db))[0].status.realism).toBe('realistic');
  });
});
