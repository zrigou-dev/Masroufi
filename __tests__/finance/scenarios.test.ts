import { createAccount, getAccount } from '../../src/data/accounts';
import { collectBudgetAlerts, listBudgetStatuses, saveBudget } from '../../src/data/budgets';
import { createDebt, getDebt } from '../../src/data/debts';
import { getCashFlow, getPositions, spendingByCategory } from '../../src/data/finance';
import { verifyLedger } from '../../src/data/integrity';
import type { DbWithEvents } from '../../src/data/sql';
import { createTransaction, deleteTransaction, updateTransaction } from '../../src/data/transactions';
import { createBackup, parseBackup, resetAllData, restoreBackup, serializeBackup } from '../../src/data/backup';
import { setClock } from '../../src/domain/dates';
import { FinanceError } from '../../src/domain/errors';
import { openTestDb } from '../helpers/testDb';

const MAD = (dirhams: number) => dirhams * 100;
const JUNE = { from: '2026-06-01', to: '2026-06-30' };
const at = '2026-06-15T12:00';

let db: DbWithEvents;
let bank: string;
let cash: string;

const balance = async (id: string) => (await getAccount(db, id))?.balanceMinor;
const position = async () => (await getPositions(db)).find((p) => p.currency === 'MAD');
const flow = async () => (await getCashFlow(db, JUNE)).find((f) => f.currency === 'MAD');

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toBeInstanceOf(FinanceError);
  await expect(action).rejects.toMatchObject({ code });
}

beforeEach(async () => {
  setClock(() => new Date(2026, 5, 20, 10, 0));
  db = await openTestDb();
  bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: MAD(5000), createdOn: '2026-01-01' });
  cash = await createAccount(db, { name: 'Cash', type: 'cash', currency: 'MAD', createdOn: '2026-01-01' });
});

afterEach(async () => {
  expect(await verifyLedger(db)).toEqual([]);
  setClock(null);
});

describe('spec scenarios', () => {
  test('A: transfer then spend from cash', async () => {
    await createTransaction(db, { type: 'transfer', amountMinor: MAD(1000), accountId: bank, toAccountId: cash, occurredAt: at });
    await createTransaction(db, { type: 'expense', amountMinor: MAD(40), accountId: cash, categoryId: 'cat_food', occurredAt: at });

    expect(await balance(bank)).toBe(400_000);
    expect(await balance(cash)).toBe(96_000);
    expect((await position())?.ownedMinor).toBe(496_000);
    expect((await flow())?.expenseMinor).toBe(4_000);
    expect((await flow())?.incomeMinor).toBe(0);
  });

  test('B: borrowing raises cash and liability, not income', async () => {
    await createDebt(db, { direction: 'i_owe', counterparty: 'Ali', principalMinor: MAD(2000), currency: 'MAD', startDate: '2026-06-10', accountId: bank });

    expect(await balance(bank)).toBe(700_000);
    expect((await position())?.liabilityMinor).toBe(200_000);
    expect((await position())?.netMinor).toBe(500_000);
    expect(await flow()).toBeUndefined();
  });

  test('C: repayment lowers bank and liability without counting as spending', async () => {
    const debt = await createDebt(db, { direction: 'i_owe', counterparty: 'Ali', principalMinor: MAD(2000), currency: 'MAD', startDate: '2026-06-10', accountId: bank });
    await createTransaction(db, { type: 'debt_repayment', debtId: debt, amountMinor: MAD(500), accountId: bank, occurredAt: at });

    expect(await balance(bank)).toBe(650_000);
    expect((await position())?.liabilityMinor).toBe(150_000);
    expect((await getDebt(db, debt))?.state).toMatchObject({ remainingMinor: 150_000, paidMinor: 50_000, status: 'partial' });
    expect(await flow()).toBeUndefined();
    expect((await position())?.netMinor).toBe(500_000);
  });

  test('D: lending lowers cash and raises a receivable, not spending', async () => {
    await createTransaction(db, { type: 'transfer', amountMinor: MAD(2500), accountId: bank, toAccountId: cash, occurredAt: at });
    await createDebt(db, { direction: 'owed_to_me', counterparty: 'Sara', principalMinor: MAD(2000), currency: 'MAD', startDate: '2026-06-16', accountId: cash });

    expect(await balance(cash)).toBe(50_000);
    expect((await position())?.receivableMinor).toBe(200_000);
    expect((await position())?.ownedMinor).toBe(300_000);
    expect((await position())?.netMinor).toBe(500_000);
    expect(await flow()).toBeUndefined();
  });

  test('E: collecting a loan is not income', async () => {
    const debt = await createDebt(db, { direction: 'owed_to_me', counterparty: 'Sara', principalMinor: MAD(2000), currency: 'MAD', startDate: '2026-06-10', accountId: bank });
    await createTransaction(db, { type: 'debt_collection', debtId: debt, amountMinor: MAD(500), accountId: cash, occurredAt: at });

    expect(await balance(cash)).toBe(50_000);
    expect((await position())?.receivableMinor).toBe(150_000);
    expect(await flow()).toBeUndefined();
  });

  test('F: editing an expense updates balances, reports and budgets', async () => {
    const budget = await saveBudget(db, null, { name: 'Food', period: 'monthly', startDate: null, endDate: null, amountMinor: MAD(1000), currency: 'MAD', categoryId: 'cat_food', accountId: null, thresholds: [70, 85, 100], active: true });
    const id = await createTransaction(db, { type: 'expense', amountMinor: MAD(100), accountId: bank, categoryId: 'cat_food', occurredAt: at });

    await updateTransaction(db, id, { type: 'expense', amountMinor: MAD(250), accountId: cash, categoryId: 'cat_groceries', occurredAt: at });

    expect(await balance(bank)).toBe(500_000);
    expect(await balance(cash)).toBe(-25_000);
    expect((await flow())?.expenseMinor).toBe(25_000);
    expect(await spendingByCategory(db, JUNE, 'MAD')).toEqual([expect.objectContaining({ categoryId: 'cat_groceries', minor: 25_000 })]);
    const status = (await listBudgetStatuses(db)).find((b) => b.budget.id === budget)?.status;
    expect(status?.spentMinor).toBe(0);
  });

  test('G: backup, reset, restore reproduces all data', async () => {
    const debt = await createDebt(db, { direction: 'i_owe', counterparty: 'علي', principalMinor: MAD(2000), currency: 'MAD', startDate: '2026-06-10', accountId: bank });
    await createTransaction(db, { type: 'debt_repayment', debtId: debt, amountMinor: MAD(500), accountId: bank, occurredAt: at, tags: ['قرض'] });
    await createTransaction(db, { type: 'expense', amountMinor: MAD(40), accountId: cash, categoryId: 'cat_food', occurredAt: at, notes: 'قهوة "صباحًا", مع سطر\nجديد' });
    const removed = await createTransaction(db, { type: 'expense', amountMinor: MAD(7), accountId: cash, categoryId: 'cat_food', occurredAt: at });
    await deleteTransaction(db, removed);
    const before = { bank: await balance(bank), cash: await balance(cash), position: await position(), snapshot: await createBackup(db) };

    const file = serializeBackup(before.snapshot);
    await resetAllData(db);
    expect(await getPositions(db)).toEqual([]);

    await restoreBackup(db, parseBackup(file));

    expect(await balance(bank)).toBe(before.bank);
    expect(await balance(cash)).toBe(before.cash);
    expect(await position()).toEqual(before.position);
    expect((await createBackup(db)).checksum).toBe(before.snapshot.checksum);
  });

  test('H: invalid operations are refused and leave balances untouched', async () => {
    const debt = await createDebt(db, { direction: 'i_owe', counterparty: 'Ali', principalMinor: MAD(1000), currency: 'MAD', startDate: '2026-06-10', accountId: bank });
    const before = await balance(bank);

    await expectCode(createTransaction(db, { type: 'debt_repayment', debtId: debt, amountMinor: MAD(1001), accountId: bank, occurredAt: at }), 'payment_exceeds_debt');
    await expectCode(createTransaction(db, { type: 'expense', amountMinor: 0, accountId: bank, categoryId: 'cat_food', occurredAt: at }), 'invalid_amount');
    await expectCode(createTransaction(db, { type: 'expense', amountMinor: -500, accountId: bank, categoryId: 'cat_food', occurredAt: at }), 'invalid_amount');
    await expectCode(createTransaction(db, { type: 'expense', amountMinor: 10.5, accountId: bank, categoryId: 'cat_food', occurredAt: at }), 'invalid_amount');
    await expectCode(createTransaction(db, { type: 'expense', amountMinor: 100, accountId: bank, categoryId: 'cat_salary', occurredAt: at }), 'category_kind_mismatch');
    await expectCode(createTransaction(db, { type: 'transfer', amountMinor: 100, accountId: bank, toAccountId: bank, occurredAt: at }), 'same_account');

    const key = 'form-1';
    const first = await createTransaction(db, { type: 'transfer', amountMinor: 100, accountId: bank, toAccountId: cash, occurredAt: at, idempotencyKey: key });
    const second = await createTransaction(db, { type: 'transfer', amountMinor: 100, accountId: bank, toAccountId: cash, occurredAt: at, idempotencyKey: key });
    expect(second).toBe(first);
    expect(await balance(bank)).toBe((before as number) - 100);
    expect(await balance(cash)).toBe(100);
  });
});

describe('budget alerts', () => {
  test('fire once per threshold per period', async () => {
    await saveBudget(db, null, { name: 'All', period: 'monthly', startDate: null, endDate: null, amountMinor: MAD(100), currency: 'MAD', categoryId: null, accountId: null, thresholds: [70, 85, 100], active: true });
    await createTransaction(db, { type: 'expense', amountMinor: MAD(71), accountId: bank, categoryId: 'cat_food', occurredAt: at });
    expect((await collectBudgetAlerts(db)).map((a) => a.threshold)).toEqual([70]);
    expect(await collectBudgetAlerts(db)).toEqual([]);
    await createTransaction(db, { type: 'expense', amountMinor: MAD(30), accountId: bank, categoryId: 'cat_food', occurredAt: at });
    expect((await collectBudgetAlerts(db)).map((a) => a.threshold)).toEqual([100]);
  });
});
