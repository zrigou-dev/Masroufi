import { createAccount, getAccount, getOpeningBalance, listAccounts, reconcileAccount, setAccountArchived, setOpeningBalance } from '../../src/data/accounts';
import { getCashFlow, getMovements, getMonthlyTrend, getPositions, spendingByAccount, spendingByCategory } from '../../src/data/finance';
import { verifyLedger } from '../../src/data/integrity';
import type { DbWithEvents } from '../../src/data/sql';
import { createTransaction, deleteTransaction, findPossibleDuplicates, getTransaction, listTransactions, restoreTransaction, reverseTransaction, updateTransaction } from '../../src/data/transactions';
import { setClock } from '../../src/domain/dates';
import { openTestDb } from '../helpers/testDb';

const JUNE = { from: '2026-06-01', to: '2026-06-30' };
const at = '2026-06-15T12:00';
let db: DbWithEvents;
let bank: string;
let cash: string;
let euro: string;

const balance = async (id: string) => (await getAccount(db, id))?.balanceMinor;
const expense = async () => (await getCashFlow(db, JUNE)).find((f) => f.currency === 'MAD')?.expenseMinor ?? 0;
const income = async () => (await getCashFlow(db, JUNE)).find((f) => f.currency === 'MAD')?.incomeMinor ?? 0;
const spend = (amountMinor: number, extra: object = {}) =>
  createTransaction(db, { type: 'expense', amountMinor, accountId: bank, categoryId: 'cat_food', occurredAt: at, ...extra });

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ code });
}

beforeEach(async () => {
  setClock(() => new Date(2026, 5, 20, 10, 0));
  db = await openTestDb();
  bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 100_000, createdOn: '2026-01-01' });
  cash = await createAccount(db, { name: 'Cash', type: 'cash', currency: 'MAD', createdOn: '2026-01-01' });
  euro = await createAccount(db, { name: 'Euro', type: 'bank', currency: 'EUR', openingBalanceMinor: 10_000, createdOn: '2026-01-01' });
});

afterEach(async () => {
  expect(await verifyLedger(db)).toEqual([]);
  setClock(null);
});

describe('accounts', () => {
  test('opening balance is a ledger event excluded from income', async () => {
    expect(await balance(bank)).toBe(100_000);
    expect(await income()).toBe(0);
    expect(await getOpeningBalance(db, bank)).toBe(100_000);
  });

  test('correcting the opening balance moves the balance by the difference only', async () => {
    await spend(1_000);
    await setOpeningBalance(db, bank, 150_000);
    expect(await balance(bank)).toBe(149_000);
    await setOpeningBalance(db, bank, 0);
    expect(await balance(bank)).toBe(-1_000);
  });

  test('negative opening balance for an overdrawn account', async () => {
    const id = await createAccount(db, { name: 'Over', type: 'bank', currency: 'MAD', openingBalanceMinor: -500 });
    expect(await balance(id)).toBe(-500);
  });

  test('reconciliation posts the exact difference and stays out of reports', async () => {
    await reconcileAccount(db, bank, 90_000, { occurredAt: at });
    expect(await balance(bank)).toBe(90_000);
    expect(await expense()).toBe(0);
    expect(await reconcileAccount(db, bank, 90_000)).toBeNull();
    await reconcileAccount(db, bank, 95_000, { occurredAt: at });
    expect(await balance(bank)).toBe(95_000);
    expect(await income()).toBe(0);
  });

  test('archiving keeps history and the money', async () => {
    await spend(1_000);
    const before = await getPositions(db);
    await setAccountArchived(db, bank, true);
    expect((await listAccounts(db)).some((a) => a.id === bank)).toBe(false);
    expect((await listAccounts(db, { includeArchived: true })).some((a) => a.id === bank)).toBe(true);
    expect(await listTransactions(db, { accountId: bank })).toHaveLength(2);
    expect(await getPositions(db)).toEqual(before);
    await expectCode(spend(100), 'account_archived');
  });

  test('currency cannot change once an account has entries, even by direct SQL', async () => {
    await expect(db.run(`UPDATE accounts SET currency = 'EUR' WHERE id = ?`, [bank])).rejects.toThrow(/currency/);
  });

  test('unsupported currency and blank name are refused', async () => {
    await expectCode(createAccount(db, { name: 'X', type: 'cash', currency: 'XXX' }), 'invalid_currency');
    await expectCode(createAccount(db, { name: '   ', type: 'cash', currency: 'MAD' }), 'invalid_name');
  });
});

describe('transfers', () => {
  test('never reach income, spending or category reports', async () => {
    await createTransaction(db, { type: 'transfer', amountMinor: 30_000, accountId: bank, toAccountId: cash, occurredAt: at });
    expect(await getCashFlow(db, JUNE)).toEqual([]);
    expect(await spendingByCategory(db, JUNE, 'MAD')).toEqual([]);
    expect(await spendingByAccount(db, JUNE, 'MAD')).toEqual([]);
    expect((await getMovements(db, JUNE, 'MAD')).transfersMinor).toBe(30_000);
    expect((await getPositions(db)).find((p) => p.currency === 'MAD')?.ownedMinor).toBe(100_000);
  });

  test('a failure on one side leaves neither side written', async () => {
    const before = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_entries');
    await expectCode(createTransaction(db, { type: 'transfer', amountMinor: 100, accountId: bank, toAccountId: 'missing', occurredAt: at }), 'not_found');
    expect(await db.get('SELECT COUNT(*) AS n FROM ledger_entries')).toEqual(before);
    expect(await balance(bank)).toBe(100_000);
  });

  test('between currencies keeps each side in its own currency', async () => {
    await createTransaction(db, { type: 'transfer', amountMinor: 11_000, accountId: bank, toAccountId: euro, toAmountMinor: 1_000, occurredAt: at });
    expect(await balance(bank)).toBe(89_000);
    expect(await balance(euro)).toBe(11_000);
    const positions = await getPositions(db);
    expect(positions.find((p) => p.currency === 'MAD')?.ownedMinor).toBe(89_000);
    expect(positions.find((p) => p.currency === 'EUR')?.ownedMinor).toBe(11_000);
  });

  test('between currencies requires the amount received', async () => {
    await expectCode(createTransaction(db, { type: 'transfer', amountMinor: 100, accountId: bank, toAccountId: euro, occurredAt: at }), 'currency_mismatch');
  });

  test('net effect never adds two currencies together', async () => {
    await createTransaction(db, { type: 'transfer', amountMinor: 11_000, accountId: bank, toAccountId: euro, toAmountMinor: 1_000, occurredAt: at });
    const [all] = await listTransactions(db, { types: ['transfer'] });
    expect([all.netMinor, all.netCurrency]).toEqual([-11_000, 'MAD']);
    const [euroSide] = await listTransactions(db, { accountId: euro, types: ['transfer'] });
    expect([euroSide.netMinor, euroSide.netCurrency]).toEqual([1_000, 'EUR']);
  });

  test('same currency cannot invent or lose money', async () => {
    await expectCode(createTransaction(db, { type: 'transfer', amountMinor: 100, accountId: bank, toAccountId: cash, toAmountMinor: 90, occurredAt: at }), 'currency_mismatch');
  });

  test('editing a transfer moves both legs', async () => {
    const id = await createTransaction(db, { type: 'transfer', amountMinor: 100, accountId: bank, toAccountId: cash, occurredAt: at });
    await updateTransaction(db, id, { type: 'transfer', amountMinor: 250, accountId: bank, toAccountId: cash, occurredAt: at });
    expect(await balance(bank)).toBe(99_750);
    expect(await balance(cash)).toBe(250);
  });

  test('amounts in different currencies are never summed', async () => {
    await createTransaction(db, { type: 'expense', amountMinor: 500, accountId: euro, categoryId: 'cat_food', occurredAt: at });
    await spend(700);
    const flows = await getCashFlow(db, JUNE);
    expect(flows.map((f) => [f.currency, f.expenseMinor])).toEqual([['EUR', 500], ['MAD', 700]]);
  });
});

describe('editing and deleting', () => {
  test('delete removes the effect everywhere; undo restores it exactly', async () => {
    const id = await spend(10_000);
    await deleteTransaction(db, id);
    expect(await balance(bank)).toBe(100_000);
    expect(await expense()).toBe(0);
    expect(await listTransactions(db, { types: ['expense'] })).toEqual([]);
    await restoreTransaction(db, id);
    expect(await balance(bank)).toBe(90_000);
    expect(await expense()).toBe(10_000);
  });

  test('editing the date moves an expense between report periods', async () => {
    const id = await spend(10_000);
    await updateTransaction(db, id, { type: 'expense', amountMinor: 10_000, accountId: bank, categoryId: 'cat_food', occurredAt: '2026-05-31T23:59' });
    expect(await expense()).toBe(0);
    const may = await getCashFlow(db, { from: '2026-05-01', to: '2026-05-31' });
    expect(may[0].expenseMinor).toBe(10_000);
  });

  test('a failed edit changes nothing', async () => {
    const id = await spend(10_000, { tags: ['a'] });
    await expectCode(updateTransaction(db, id, { type: 'expense', amountMinor: 20_000, accountId: 'missing', categoryId: 'cat_food', occurredAt: at }), 'not_found');
    expect(await balance(bank)).toBe(90_000);
    expect((await getTransaction(db, id))?.tags).toEqual(['a']);
  });

  test('type cannot be changed by editing', async () => {
    const id = await spend(100);
    await expectCode(updateTransaction(db, id, { type: 'income', amountMinor: 100, accountId: bank, categoryId: 'cat_salary', occurredAt: at }), 'immutable_type');
  });

  test('system-owned rows are protected', async () => {
    const [opening] = await listTransactions(db, { types: ['opening_balance'], accountId: bank });
    await expectCode(deleteTransaction(db, opening.id), 'managed_transaction');
    await expectCode(reverseTransaction(db, opening.id, at), 'not_reversible');
  });

  test('future-dated transactions are refused: planned is not paid', async () => {
    await expectCode(spend(100, { occurredAt: '2026-06-21T00:00' }), 'future_date');
    await expect(spend(100, { occurredAt: '2026-06-20T23:59' })).resolves.toBeTruthy();
    await expectCode(spend(100, { occurredAt: '2026-06-31T10:00' }), 'invalid_date');
  });
});

describe('refunds and reversals', () => {
  test('a refund lowers spending and raises the balance, without being income', async () => {
    await spend(10_000);
    await createTransaction(db, { type: 'refund', amountMinor: 3_000, accountId: bank, categoryId: 'cat_food', occurredAt: at });
    expect(await expense()).toBe(7_000);
    expect(await income()).toBe(0);
    expect(await balance(bank)).toBe(93_000);
    expect(await spendingByCategory(db, JUNE, 'MAD')).toEqual([expect.objectContaining({ minor: 7_000 })]);
  });

  test('linked refunds cannot exceed the original', async () => {
    const id = await spend(10_000);
    await createTransaction(db, { type: 'refund', amountMinor: 6_000, accountId: bank, categoryId: 'cat_food', occurredAt: at, relatedTransactionId: id });
    await expectCode(createTransaction(db, { type: 'refund', amountMinor: 5_000, accountId: bank, categoryId: 'cat_food', occurredAt: at, relatedTransactionId: id }), 'refund_exceeds_original');
    await expectCode(deleteTransaction(db, id), 'has_reversal');
    await expectCode(updateTransaction(db, id, { type: 'expense', amountMinor: 5_000, accountId: bank, categoryId: 'cat_food', occurredAt: at }), 'refund_exceeds_original');
    await updateTransaction(db, id, { type: 'expense', amountMinor: 8_000, accountId: bank, categoryId: 'cat_food', occurredAt: at });
    expect(await expense()).toBe(2_000);
  });

  test('reversal of an expense cancels money and spending, keeping both rows', async () => {
    const id = await spend(10_000);
    await reverseTransaction(db, id, at);
    expect(await balance(bank)).toBe(100_000);
    expect(await expense()).toBe(0);
    expect((await listTransactions(db, { types: ['expense', 'reversal'] }))).toHaveLength(2);
    expect((await getTransaction(db, id))?.isReversed).toBe(true);
  });

  test('reversal lands in the period it was made', async () => {
    const id = await spend(10_000, { occurredAt: '2026-05-10T10:00' });
    await reverseTransaction(db, id, at);
    expect((await getCashFlow(db, { from: '2026-05-01', to: '2026-05-31' }))[0].expenseMinor).toBe(10_000);
    expect(await expense()).toBe(-10_000);
  });

  test('reversal of income, of a refund, and of a transfer', async () => {
    const pay = await createTransaction(db, { type: 'income', amountMinor: 5_000, accountId: bank, categoryId: 'cat_salary', occurredAt: at });
    await reverseTransaction(db, pay, at);
    expect(await income()).toBe(0);

    const refund = await createTransaction(db, { type: 'refund', amountMinor: 2_000, accountId: bank, categoryId: 'cat_food', occurredAt: at });
    await reverseTransaction(db, refund, at);
    expect(await expense()).toBe(0);

    const move = await createTransaction(db, { type: 'transfer', amountMinor: 700, accountId: bank, toAccountId: euro, toAmountMinor: 70, occurredAt: at });
    await reverseTransaction(db, move, at);
    expect(await balance(bank)).toBe(100_000);
    expect(await balance(euro)).toBe(10_000);
    expect((await getMovements(db, JUNE, 'MAD')).transfersMinor).toBe(0);
  });

  test('cannot reverse twice, edit or delete a reversed transaction', async () => {
    const id = await spend(100);
    const reversal = await reverseTransaction(db, id, at);
    await expectCode(reverseTransaction(db, id, at), 'already_reversed');
    await expectCode(reverseTransaction(db, reversal, at), 'not_reversible');
    await expectCode(updateTransaction(db, id, { type: 'expense', amountMinor: 50, accountId: bank, categoryId: 'cat_food', occurredAt: at }), 'has_reversal');
    await expectCode(deleteTransaction(db, id), 'has_reversal');
  });

  test('deleting a reversal brings the original back into effect', async () => {
    const id = await spend(100);
    const reversal = await reverseTransaction(db, id, at);
    await deleteTransaction(db, reversal);
    expect(await balance(bank)).toBe(99_900);
    expect(await expense()).toBe(100);
  });

  test('the database itself refuses a second live reversal', async () => {
    const id = await spend(100);
    await reverseTransaction(db, id, at);
    const now = new Date().toISOString();
    await expect(db.run(
      `INSERT INTO transactions (id, type, amount_minor, currency, occurred_at, account_id, reversal_of_id, created_at, updated_at)
       VALUES ('x', 'reversal', 100, 'MAD', ?, ?, ?, ?, ?)`, [at, bank, id, now, now],
    )).rejects.toThrow(/UNIQUE/);
  });
});

describe('search and filters', () => {
  beforeEach(async () => {
    await spend(1_000, { description: 'قهوة الصباح', tags: ['عمل'], counterparty: 'Café Atlas' });
    await spend(2_000, { categoryId: 'cat_transport', occurredAt: '2026-06-01T00:00', notes: '100% taxi_ride' });
    await createTransaction(db, { type: 'expense', amountMinor: 3_000, accountId: cash, categoryId: 'cat_food', occurredAt: '2026-05-31T23:59' });
  });

  test('by text across fields, in Arabic', async () => {
    expect(await listTransactions(db, { search: 'قهوة' })).toHaveLength(1);
    expect(await listTransactions(db, { search: 'atlas' })).toHaveLength(1);
    expect(await listTransactions(db, { search: 'عمل' })).toHaveLength(1);
  });

  test('like wildcards are literal', async () => {
    expect(await listTransactions(db, { search: '100%' })).toHaveLength(1);
    expect(await listTransactions(db, { search: '%' })).toHaveLength(1);
    expect(await listTransactions(db, { search: 'taxi_ride' })).toHaveLength(1);
    expect(await listTransactions(db, { search: 'taxi-ride' })).toHaveLength(0);
  });

  test('date range includes both boundary days', async () => {
    const june = await listTransactions(db, { from: '2026-06-01', to: '2026-06-30', types: ['expense'] });
    expect(june.map((t) => t.amountMinor).sort()).toEqual([1_000, 2_000]);
    const lastOfMay = await listTransactions(db, { from: '2026-05-31', to: '2026-05-31' });
    expect(lastOfMay.map((t) => t.amountMinor)).toEqual([3_000]);
  });

  test('net effect is per account', async () => {
    await createTransaction(db, { type: 'transfer', amountMinor: 400, accountId: bank, toAccountId: cash, occurredAt: at });
    const [bankSide] = await listTransactions(db, { accountId: bank, types: ['transfer'] });
    const [cashSide] = await listTransactions(db, { accountId: cash, types: ['transfer'] });
    expect([bankSide.netMinor, cashSide.netMinor]).toEqual([-400, 400]);
  });

  test('duplicate detection', async () => {
    const match = { type: 'expense' as const, amountMinor: 1_000, accountId: bank, categoryId: 'cat_food', occurredAt: at };
    expect(await findPossibleDuplicates(db, match)).toHaveLength(1);
    expect(await findPossibleDuplicates(db, { ...match, amountMinor: 999 })).toHaveLength(0);
    expect(await findPossibleDuplicates(db, { ...match, occurredAt: '2026-06-14T12:00' })).toHaveLength(0);
  });
});

describe('monthly trend', () => {
  test('closing balances reconcile with current balances', async () => {
    await spend(10_000, { occurredAt: '2026-04-10T10:00' });
    await createTransaction(db, { type: 'income', amountMinor: 50_000, accountId: cash, categoryId: 'cat_salary', occurredAt: '2026-05-10T10:00' });
    await createTransaction(db, { type: 'transfer', amountMinor: 1_000, accountId: bank, toAccountId: cash, occurredAt: at });
    const trend = await getMonthlyTrend(db, 'MAD', 3);
    expect(trend.map((p) => p.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(trend.map((p) => p.closingMinor)).toEqual([90_000, 140_000, 140_000]);
    const owned = (await getPositions(db)).find((p) => p.currency === 'MAD')?.ownedMinor;
    expect(trend[2].closingMinor).toBe(owned);
  });
});

describe('concurrency', () => {
  test('simultaneous writes interleave without losing or mixing any', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => spend(100 + i)));
    const expected = Array.from({ length: 50 }, (_, i) => 100 + i).reduce((a, b) => a + b, 0);
    expect(await balance(bank)).toBe(100_000 - expected);
  });

  test('a double tap with one key records exactly one transaction', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => spend(5_000, { idempotencyKey: 'same' })));
    expect(new Set(results).size).toBe(1);
    expect(await balance(bank)).toBe(95_000);
  });

  test('a failing transaction does not disturb one queued behind it', async () => {
    const results = await Promise.allSettled([spend(0), spend(100), spend(-1), spend(200)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'rejected', 'fulfilled']);
    expect(await balance(bank)).toBe(99_700);
  });

  test('a read during a write sees it fully applied or not at all', async () => {
    await createTransaction(db, { type: 'transfer', amountMinor: 1_000, accountId: bank, toAccountId: cash, occurredAt: at });
    const seen: number[] = [];
    const writes = Array.from({ length: 20 }, () => createTransaction(db, { type: 'transfer', amountMinor: 1, accountId: bank, toAccountId: cash, occurredAt: at }));
    const reads = Array.from({ length: 20 }, async () => {
      const position = (await getPositions(db)).find((p) => p.currency === 'MAD');
      seen.push(position?.ownedMinor ?? 0);
    });
    await Promise.all([...writes, ...reads]);
    expect(new Set(seen)).toEqual(new Set([100_000]));
  });
});
