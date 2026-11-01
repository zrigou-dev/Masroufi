import { createAccount, getAccount, reconcileAccount, setAccountArchived } from '../../src/data/accounts';
import { createBackup, parseBackup, restoreBackup, serializeBackup, type BackupFile } from '../../src/data/backup';
import { summarizeBudgets, listBudgetStatuses, saveBudget } from '../../src/data/budgets';
import { deleteCategory, listCategories, moveCategory, saveCategory } from '../../src/data/categories';
import { createSplitExpense, createTransferWithFee } from '../../src/data/compound';
import { getDebt, listDebts } from '../../src/data/debts';
import { getCashFlow, getComparison, getDailySpending, getMoneyFlow, getPositions, getSaved, spendingByCategory } from '../../src/data/finance';
import { saveGoal, addAllocation } from '../../src/data/goals';
import { getInsights } from '../../src/data/insights';
import { verifyLedger } from '../../src/data/integrity';
import { migrate, MIGRATIONS } from '../../src/data/migrations';
import { deleteRule, pendingOccurrences, postDueOccurrences, saveRule, setRuleActive, skipOccurrence, type RuleInput } from '../../src/data/recurring';
import { createDb, type DbWithEvents } from '../../src/data/sql';
import { deleteTemplate, getEntryHints, getQuickItems, knownCounterparties, listTemplates, loadHistory, recordQuickItem, saveTemplate } from '../../src/data/templates';
import { createTransaction, deleteTransaction, listTransactions, restoreTransaction, reverseTransaction } from '../../src/data/transactions';
import { comparableRanges, periodRange, setClock } from '../../src/domain/dates';
import { buildInsights, type InsightInput } from '../../src/domain/insights';
import { categoryScores, normalizeText, preferredAccounts, rankSuggestions, type HistoryItem } from '../../src/domain/suggestions';
import { nodeBackend, openTestDb } from '../helpers/testDb';

const JUNE = { from: '2026-06-01', to: '2026-06-30' };
const at = '2026-06-15T12:00';
const pad = (n: number) => String(n).padStart(2, '0');
let db: DbWithEvents;
let bank: string;
let cash: string;

const balance = async (id: string) => (await getAccount(db, id))?.balanceMinor;
const spend = (amountMinor: number, extra: object = {}) =>
  createTransaction(db, { type: 'expense', amountMinor, accountId: cash, categoryId: 'cat_food', occurredAt: at, ...extra });

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

describe('suggestion ranking', () => {
  const item = (over: Partial<HistoryItem>): HistoryItem => ({ kind: 'expense', description: 'قهوة', categoryId: 'food', accountId: 'cash', amountMinor: 1500, currency: 'MAD', occurredAt: '2026-06-19T09:00', ...over });
  const now = '2026-06-20T09:00';

  test('needs a repeat: one purchase is not a habit', () => {
    expect(rankSuggestions([item({})], now)).toEqual([]);
    expect(rankSuggestions([item({}), item({})], now)).toHaveLength(1);
  });

  test('the usual amount and account win, and a steady amount allows one tap', () => {
    const [top] = rankSuggestions([item({}), item({}), item({}), item({ amountMinor: 1800, accountId: 'bank' })], now);
    expect(top).toMatchObject({ amountMinor: 1500, accountId: 'cash', stableAmount: true, count: 4 });
  });

  test('a varying amount is not one-tap', () => {
    const [top] = rankSuggestions([item({ amountMinor: 100 }), item({ amountMinor: 200 }), item({ amountMinor: 300 })], now);
    expect(top.stableAmount).toBe(false);
  });

  test('a recent habit outranks an old one with the same count', () => {
    const history = [
      item({ description: 'old', occurredAt: '2025-06-01T09:00' }), item({ description: 'old', occurredAt: '2025-06-02T09:00' }),
      item({ description: 'new', occurredAt: '2026-06-18T15:00' }), item({ description: 'new', occurredAt: '2026-06-19T15:00' }),
    ];
    expect(rankSuggestions(history, now)[0].description).toBe('new');
  });

  test('the hour of day matters: the morning coffee leads in the morning', () => {
    const history = [
      item({ description: 'coffee', occurredAt: '2026-06-18T08:30' }), item({ description: 'coffee', occurredAt: '2026-06-19T08:30' }),
      item({ description: 'dinner', occurredAt: '2026-06-18T20:30' }), item({ description: 'dinner', occurredAt: '2026-06-19T20:30' }),
    ];
    expect(rankSuggestions(history, '2026-06-20T08:00')[0].description).toBe('coffee');
    expect(rankSuggestions(history, '2026-06-20T20:00')[0].description).toBe('dinner');
  });

  test('narrows to a category', () => {
    const history = [item({}), item({}), item({ description: 'taxi', categoryId: 'transport' }), item({ description: 'taxi', categoryId: 'transport' })];
    expect(rankSuggestions(history, now, { categoryId: 'transport' }).map((s) => s.description)).toEqual(['taxi']);
  });

  test('typing finds even a one-off, through Arabic spelling variation', () => {
    expect(rankSuggestions([item({ description: 'قهوة' })], now, { text: 'قهوه' })).toHaveLength(1);
    expect(rankSuggestions([item({ description: 'أحمد' })], now, { text: 'احمد' })).toHaveLength(1);
    expect(rankSuggestions([item({ description: 'Café' })], now, { text: 'CAF' })).toHaveLength(1);
    expect(rankSuggestions([item({})], now, { text: 'شاي' })).toEqual([]);
  });

  test('normalisation', () => {
    expect(normalizeText('  قَهْوَة   الصباح ')).toBe('قهوه الصباح');
    expect(normalizeText('مقهى')).toBe('مقهي');
  });

  test('category order and preferred account follow habits', () => {
    const history = [item({}), item({}), item({ categoryId: 'rent', accountId: 'bank' })];
    const scores = categoryScores(history, now, 'expense');
    expect((scores.get('food') as number) > (scores.get('rent') as number)).toBe(true);
    expect(preferredAccounts(history).get('rent')).toBe('bank');
    expect(preferredAccounts(history).get('food')).toBe('cash');
  });
});

describe('quick items from real history', () => {
  const coffee = (day: number) => spend(1_500, { description: 'قهوة', occurredAt: `2026-06-${pad(day)}T09:00` });

  test('a repeated purchase becomes a one-tap button that records correctly', async () => {
    await coffee(10);
    await coffee(11);
    const [item] = await getQuickItems(db);
    expect(item).toMatchObject({ label: 'قهوة', amountMinor: 1_500, oneTap: true, accountId: cash, categoryId: 'cat_food' });
    await recordQuickItem(db, item);
    expect(await balance(cash)).toBe(95_500);
  });

  test('two taps in one minute count once; later the same button counts again', async () => {
    await coffee(10);
    await coffee(11);
    const [item] = await getQuickItems(db);
    await Promise.all([recordQuickItem(db, item, '2026-06-20T10:00'), recordQuickItem(db, item, '2026-06-20T10:00')]);
    expect(await balance(cash)).toBe(95_500);
    await recordQuickItem(db, item, '2026-06-20T14:00');
    expect(await balance(cash)).toBe(94_000);
  });

  test('automatic, occasional and reversed entries teach nothing', async () => {
    await spend(9_000, { description: 'wedding', occasional: true });
    await spend(9_000, { description: 'wedding', occasional: true });
    const a = await spend(100, { description: 'mistake' });
    const b = await spend(100, { description: 'mistake' });
    await reverseTransaction(db, a, at);
    await reverseTransaction(db, b, at);
    expect(await loadHistory(db)).toEqual([]);
  });

  test('correcting a transaction corrects what was learned', async () => {
    const a = await coffee(10);
    await coffee(11);
    await deleteTransaction(db, a);
    expect(await getQuickItems(db)).toEqual([]);
  });

  test('income is never offered as a one-tap button by itself', async () => {
    const pay = { type: 'income' as const, amountMinor: 900_000, accountId: bank, categoryId: 'cat_salary', description: 'Salary' };
    await createTransaction(db, { ...pay, occurredAt: '2026-05-01T10:00' });
    await createTransaction(db, { ...pay, occurredAt: '2026-06-01T10:00' });
    expect(await getQuickItems(db)).toEqual([]);
  });

  test('saved templates come first and replace the matching suggestion', async () => {
    await coffee(10);
    await coffee(11);
    await saveTemplate(db, null, { name: 'قهوتي', kind: 'expense', amountMinor: 1_500, accountId: cash, categoryId: 'cat_food', description: 'قهوة' });
    const items = await getQuickItems(db);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: 'قهوتي', pinned: true, oneTap: true });
  });

  test('a template with no amount asks for it instead of guessing', async () => {
    const id = await saveTemplate(db, null, { name: 'Groceries', kind: 'expense', amountMinor: null, accountId: cash, categoryId: 'cat_groceries', description: null });
    const [item] = await getQuickItems(db);
    expect(item.oneTap).toBe(false);
    await expectCode(recordQuickItem(db, item), 'invalid_amount');
    await deleteTemplate(db, id);
    expect(await listTemplates(db)).toEqual([]);
  });

  test('a template on an archived account disappears rather than failing', async () => {
    await saveTemplate(db, null, { name: 'x', kind: 'expense', amountMinor: 100, accountId: cash, categoryId: 'cat_food', description: null });
    await setAccountArchived(db, cash, true);
    expect(await listTemplates(db)).toEqual([]);
  });

  test('entry hints remember the account per category', async () => {
    await coffee(10);
    await createTransaction(db, { type: 'expense', amountMinor: 100, accountId: bank, categoryId: 'cat_housing', occurredAt: at });
    const hints = await getEntryHints(db);
    expect(hints.accountByCategory.get('cat_housing')).toBe(bank);
    expect(hints.accountByCategory.get('cat_food')).toBe(cash);
  });
});

describe('automatic recurring', () => {
  const salary: RuleInput = {
    name: 'Salary', kind: 'income', amountMinor: 900_000, currency: 'MAD', accountId: '', categoryId: 'cat_salary',
    frequency: 'monthly', intervalCount: 1, startDate: '2026-07-01', endDate: null, reminderDaysBefore: null, active: true, autoPost: true,
  };
  const rule = (over: Partial<RuleInput> = {}) => saveRule(db, null, { ...salary, accountId: bank, ...over });
  const at2 = (y: number, m: number, d: number) => setClock(() => new Date(y, m - 1, d, 10, 0));

  test('nothing happens before the date', async () => {
    await rule();
    expect(await postDueOccurrences(db)).toEqual([]);
    expect(await balance(bank)).toBe(1_000_000);
  });

  test('posts on the date, dated on that date, without being asked', async () => {
    await rule();
    at2(2026, 7, 1);
    const [posted, ...rest] = await postDueOccurrences(db);
    expect(rest).toEqual([]);
    expect(posted.dueDate).toBe('2026-07-01');
    expect(await balance(bank)).toBe(1_900_000);
    const [tx] = await listTransactions(db, { types: ['income'] });
    expect(tx).toMatchObject({ description: 'Salary', categoryId: 'cat_salary', occurredAt: '2026-07-01T09:00' });
  });

  test('opening the app repeatedly, or in two tabs at once, never duplicates', async () => {
    await rule();
    at2(2026, 7, 1);
    await Promise.all([postDueOccurrences(db), postDueOccurrences(db), postDueOccurrences(db)]);
    await postDueOccurrences(db);
    expect(await listTransactions(db, { types: ['income'] })).toHaveLength(1);
    expect(await balance(bank)).toBe(1_900_000);
  });

  test('months away from the app catch up, each on its own date', async () => {
    await rule();
    at2(2026, 9, 15);
    expect((await postDueOccurrences(db)).map((p) => p.dueDate)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect((await getCashFlow(db, { from: '2026-08-01', to: '2026-08-31' }))[0].incomeMinor).toBe(900_000);
    expect(await pendingOccurrences(db, '2026-09-15')).toEqual([]);
  });

  test('switching automation on never backfills the past', async () => {
    await rule({ startDate: '2026-01-01' });
    expect(await postDueOccurrences(db)).toEqual([]);
    expect(await pendingOccurrences(db, '2026-06-20')).toEqual([]);
    at2(2026, 7, 1);
    expect((await postDueOccurrences(db)).map((p) => p.dueDate)).toEqual(['2026-07-01']);
  });

  test('a deleted automatic payment stays deleted and waits for review', async () => {
    await rule();
    at2(2026, 7, 1);
    const [posted] = await postDueOccurrences(db);
    await deleteTransaction(db, posted.transactionId);
    expect(await postDueOccurrences(db)).toEqual([]);
    expect(await balance(bank)).toBe(1_000_000);
    expect((await pendingOccurrences(db, '2026-07-01')).map((o) => o.dueDate)).toEqual(['2026-07-01']);
    await restoreTransaction(db, posted.transactionId);
    expect(await balance(bank)).toBe(1_900_000);
  });

  test('an edited amount is kept, not reset', async () => {
    const id = await rule();
    at2(2026, 7, 1);
    await postDueOccurrences(db);
    await saveRule(db, id, { ...salary, accountId: bank, amountMinor: 950_000 });
    at2(2026, 8, 1);
    await postDueOccurrences(db);
    const rows = await listTransactions(db, { types: ['income'] });
    expect(rows.map((r) => r.amountMinor).sort()).toEqual([900_000, 950_000]);
  });

  test('pause, skip and delete all stop it', async () => {
    const id = await rule();
    await setRuleActive(db, id, false);
    at2(2026, 7, 1);
    expect(await postDueOccurrences(db)).toEqual([]);
    await setRuleActive(db, id, true);
    await skipOccurrence(db, id, '2026-07-01');
    expect(await postDueOccurrences(db)).toEqual([]);
    await deleteRule(db, id);
    at2(2026, 8, 1);
    expect(await postDueOccurrences(db)).toEqual([]);
  });

  test('a broken rule waits and does not stop the others', async () => {
    const other = await createAccount(db, { name: 'Old', type: 'bank', currency: 'MAD' });
    await rule({ accountId: other });
    await rule({ name: 'Rent', kind: 'expense', categoryId: 'cat_housing', amountMinor: 100 });
    await setAccountArchived(db, other, true);
    at2(2026, 7, 1);
    expect((await postDueOccurrences(db)).map((p) => p.rule.name)).toEqual(['Rent']);
  });

  test('automatic needs an account and a category', async () => {
    await expectCode(saveRule(db, null, { ...salary, accountId: null }), 'rule_needs_details');
    await expectCode(rule({ categoryId: null }), 'rule_needs_details');
  });

  test('manual rules still wait for confirmation', async () => {
    await rule({ autoPost: false, startDate: '2026-06-01' });
    expect(await postDueOccurrences(db)).toEqual([]);
    expect((await pendingOccurrences(db, '2026-06-20')).map((o) => o.dueDate)).toEqual(['2026-06-01']);
  });
});

describe('categories', () => {
  const sub = (name: string, parentId: string | null = 'cat_food', extra: object = {}) =>
    saveCategory(db, null, { name, kind: 'expense', icon: 'cafe-outline', color: '#000000', nature: null, parentId, ...extra });

  test('spending rolls up to the parent; each filter sees the children', async () => {
    const coffee = await sub('Coffee');
    await spend(300, { categoryId: coffee });
    await spend(700);
    expect(await spendingByCategory(db, JUNE, 'MAD')).toEqual([expect.objectContaining({ categoryId: 'cat_food', minor: 1_000 })]);
    expect(await listTransactions(db, { categoryId: 'cat_food', types: ['expense'] })).toHaveLength(2);
    expect(await listTransactions(db, { categoryId: coffee })).toHaveLength(1);
  });

  test('a budget on the parent includes its subcategories', async () => {
    const coffee = await sub('Coffee');
    await saveBudget(db, null, { name: 'Food', period: 'monthly', startDate: null, endDate: null, amountMinor: 10_000, currency: 'MAD', categoryId: 'cat_food', accountId: null, thresholds: [100], active: true });
    await spend(300, { categoryId: coffee });
    expect((await listBudgetStatuses(db))[0].status.spentMinor).toBe(300);
  });

  test('nesting stays one level deep and within its kind', async () => {
    const coffee = await sub('Coffee');
    await expectCode(sub('Espresso', coffee), 'category_parent_invalid');
    await expectCode(sub('Bonus', 'cat_salary'), 'category_parent_invalid');
    await expectCode(saveCategory(db, 'cat_food', { name: 'الطعام', kind: 'expense', icon: 'x', color: '#000', nature: null, parentId: 'cat_food' }), 'category_parent_invalid');
    await expectCode(saveCategory(db, 'cat_food', { name: 'الطعام', kind: 'expense', icon: 'x', color: '#000', nature: null, parentId: 'cat_housing' }), 'category_parent_invalid');
  });

  test('a temporary category leaves the pickers after its date and keeps its history', async () => {
    const trip = await sub('Trip', null, { expiresOn: '2026-06-25' });
    await spend(500, { categoryId: trip });
    expect((await listCategories(db, { pickable: true })).some((c) => c.id === trip)).toBe(true);
    setClock(() => new Date(2026, 5, 26, 10, 0));
    expect((await listCategories(db, { pickable: true })).some((c) => c.id === trip)).toBe(false);
    expect((await listCategories(db)).some((c) => c.id === trip)).toBe(true);
    expect(await spendingByCategory(db, JUNE, 'MAD')).toEqual([expect.objectContaining({ name: 'Trip', minor: 500 })]);
  });

  test('an unused category really deletes; a used one is protected', async () => {
    const unused = await sub('Unused', null);
    await deleteCategory(db, unused);
    expect((await listCategories(db, { includeArchived: true })).some((c) => c.id === unused)).toBe(false);
    await spend(100);
    await expectCode(deleteCategory(db, 'cat_food'), 'category_in_use');
    const parent = await sub('Parent', null);
    await sub('Child', parent);
    await expectCode(deleteCategory(db, parent), 'category_in_use');
  });

  test('categories can be reordered', async () => {
    const order = async () => (await listCategories(db, { kind: 'expense' })).map((c) => c.id).slice(0, 2);
    expect(await order()).toEqual(['cat_housing', 'cat_food']);
    await moveCategory(db, 'cat_food', 'up');
    expect(await order()).toEqual(['cat_food', 'cat_housing']);
    await moveCategory(db, 'cat_food', 'up');
    expect(await order()).toEqual(['cat_food', 'cat_housing']);
  });
});

describe('real-life compound events', () => {
  test('a withdrawal with a fee: only the fee is spending', async () => {
    await createTransferWithFee(db, { type: 'transfer', amountMinor: 50_000, accountId: bank, toAccountId: cash, occurredAt: at }, 500, 'cat_fees');
    expect(await balance(bank)).toBe(949_500);
    expect(await balance(cash)).toBe(150_000);
    expect((await getCashFlow(db, JUNE))[0].expenseMinor).toBe(500);
  });

  test('a split bill: the account pays all of it, only my share is spending, the rest is owed to me', async () => {
    const id = await createSplitExpense(db, { type: 'expense', amountMinor: 30_000, accountId: cash, categoryId: 'cat_restaurants', occurredAt: at, description: 'عشاء' }, { person: 'سارة', shareMinor: 10_000 });
    expect(id).toBeTruthy();
    expect(await balance(cash)).toBe(70_000);
    expect((await getCashFlow(db, JUNE))[0].expenseMinor).toBe(20_000);
    const [debt] = await listDebts(db);
    expect(debt).toMatchObject({ direction: 'owed_to_me', counterparty: 'سارة', principalMinor: 10_000 });
    expect((await getPositions(db)).find((p) => p.currency === 'MAD')?.receivableMinor).toBe(10_000);
    expect((await getPositions(db)).find((p) => p.currency === 'MAD')?.netMinor).toBe(1_080_000);
  });

  test('a split cannot be all or nothing, and fails as one', async () => {
    const bill = { type: 'expense' as const, amountMinor: 1_000, accountId: cash, categoryId: 'cat_food', occurredAt: at };
    await expectCode(createSplitExpense(db, bill, { person: 'x', shareMinor: 1_000 }), 'split_invalid');
    await expectCode(createSplitExpense(db, bill, { person: 'x', shareMinor: 0 }), 'split_invalid');
    await expectCode(createSplitExpense(db, bill, { person: ' ', shareMinor: 10 }), 'invalid_name');
    expect(await balance(cash)).toBe(100_000);
  });

  test('a repeated split records once', async () => {
    const bill = { type: 'expense' as const, amountMinor: 1_000, accountId: cash, categoryId: 'cat_food', occurredAt: at, idempotencyKey: 'k' };
    await createSplitExpense(db, bill, { person: 'x', shareMinor: 400 });
    await createSplitExpense(db, bill, { person: 'x', shareMinor: 400 });
    expect(await balance(cash)).toBe(99_000);
    expect(await listDebts(db)).toHaveLength(1);
  });

  test('forgotten cash spending can be booked as spending when counting the wallet', async () => {
    await reconcileAccount(db, cash, 90_000, { occurredAt: at, expenseCategoryId: 'cat_other_expense' });
    expect(await balance(cash)).toBe(90_000);
    expect((await getCashFlow(db, JUNE))[0].expenseMinor).toBe(10_000);
  });

  test('found money stays a neutral adjustment even with that option', async () => {
    await reconcileAccount(db, cash, 110_000, { occurredAt: at, expenseCategoryId: 'cat_other_expense' });
    expect(await getCashFlow(db, JUNE)).toEqual([]);
  });

  test('people are remembered for the next debt', async () => {
    await createSplitExpense(db, { type: 'expense', amountMinor: 1_000, accountId: cash, categoryId: 'cat_food', occurredAt: at }, { person: 'سارة', shareMinor: 400 });
    expect(await knownCounterparties(db)).toEqual(['سارة']);
  });
});

describe('where money comes from and goes', () => {
  const rule: RuleInput = { name: 'Rent', kind: 'expense', amountMinor: 200_000, currency: 'MAD', accountId: '', categoryId: 'cat_housing', frequency: 'monthly', intervalCount: 1, startDate: '2026-06-20', endDate: null, reminderDaysBefore: null, active: true, autoPost: true };

  test('every dirham lands in exactly one bucket', async () => {
    await saveRule(db, null, { ...rule, accountId: bank });
    await postDueOccurrences(db);
    await createTransaction(db, { type: 'income', amountMinor: 900_000, accountId: bank, categoryId: 'cat_salary', occurredAt: at });
    await createTransaction(db, { type: 'income', amountMinor: 50_000, accountId: bank, categoryId: 'cat_freelance', occurredAt: at });
    await spend(3_000);
    await spend(70_000, { occasional: true, categoryId: 'cat_shopping' });

    const flow = await getMoneyFlow(db, JUNE, 'MAD');
    expect(flow).toMatchObject({ regularIncomeMinor: 900_000, extraIncomeMinor: 50_000, recurringMinor: 200_000, everydayMinor: 3_000, occasionalMinor: 70_000 });
    const total = (await getCashFlow(db, JUNE))[0];
    expect(flow.recurringMinor + flow.everydayMinor + flow.occasionalMinor).toBe(total.expenseMinor);
    expect(flow.regularIncomeMinor + flow.extraIncomeMinor).toBe(total.incomeMinor);
  });

  test('reversing an occasional expense cancels it in the same bucket', async () => {
    const id = await spend(5_000, { occasional: true });
    await reverseTransaction(db, id, at);
    expect((await getMoneyFlow(db, JUNE, 'MAD')).occasionalMinor).toBe(0);
    expect((await getMoneyFlow(db, JUNE, 'MAD')).everydayMinor).toBe(0);
  });

  test('daily spending adds up to the period total', async () => {
    await spend(100, { occurredAt: '2026-06-01T10:00' });
    await spend(200, { occurredAt: '2026-06-01T20:00' });
    await spend(400, { occurredAt: '2026-06-03T10:00' });
    expect(await getDailySpending(db, JUNE, 'MAD')).toEqual([{ day: '2026-06-01', minor: 300 }, { day: '2026-06-03', minor: 400 }]);
  });

  test('saved combines savings accounts and earmarks without double counting a linked goal', async () => {
    const savings = await createAccount(db, { name: 'Savings', type: 'savings', currency: 'MAD', openingBalanceMinor: 400_000 });
    await saveGoal(db, null, { name: 'Fund', targetMinor: 800_000, currency: 'MAD', targetDate: null, priority: 0, notes: null, mode: 'account', linkedAccountId: savings });
    const goal = await saveGoal(db, null, { name: 'Laptop', targetMinor: 800_000, currency: 'MAD', targetDate: null, priority: 0, notes: null, mode: 'manual', linkedAccountId: null });
    await addAllocation(db, goal, 50_000);
    expect(await getSaved(db, 'MAD')).toEqual({ savingsAccountsMinor: 400_000, setAsideMinor: 50_000, totalMinor: 450_000 });
  });

  test('budget summary: an overall budget already contains the category ones', async () => {
    const base = { period: 'monthly' as const, startDate: null, endDate: null, currency: 'MAD', accountId: null, thresholds: [100], active: true };
    await saveBudget(db, null, { ...base, name: 'Food', amountMinor: 150_000, categoryId: 'cat_food' });
    await saveBudget(db, null, { ...base, name: 'Transport', amountMinor: 40_000, categoryId: 'cat_transport' });
    await spend(10_000);
    expect(summarizeBudgets(await listBudgetStatuses(db), 'MAD')).toEqual({ limitMinor: 190_000, spentMinor: 10_000, remainingMinor: 180_000, count: 2 });
    await saveBudget(db, null, { ...base, name: 'All', amountMinor: 500_000, categoryId: null });
    expect(summarizeBudgets(await listBudgetStatuses(db), 'MAD')).toMatchObject({ limitMinor: 500_000, count: 1 });
  });
});

describe('fair comparisons', () => {
  test('a month in progress is compared with the same days of last month', () => {
    expect(comparableRanges(periodRange('month', '2026-06-10'), '2026-06-10')).toEqual({
      current: { from: '2026-06-01', to: '2026-06-10' },
      previous: { from: '2026-05-01', to: '2026-05-10' },
    });
  });

  test('a finished period compares whole, and day counts clamp to the shorter month', () => {
    expect(comparableRanges(JUNE, '2026-07-05').previous).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(comparableRanges(periodRange('month', '2026-03-30'), '2026-03-30').previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  test('early in the month you are not told you spent far less than last month', async () => {
    await spend(1_000, { occurredAt: '2026-05-05T10:00' });
    await spend(50_000, { occurredAt: '2026-05-25T10:00' });
    await spend(1_100, { occurredAt: '2026-06-05T10:00' });
    const result = await getComparison(db, JUNE, 'MAD');
    expect([result.spentNowMinor, result.spentBeforeMinor]).toEqual([1_100, 1_000]);
  });

  test('comparison lists the biggest moves, including categories that stopped', async () => {
    await spend(5_000, { occurredAt: '2026-05-05T10:00', categoryId: 'cat_shopping' });
    await spend(1_000, { occurredAt: '2026-05-05T10:00' });
    await spend(1_500, { occurredAt: '2026-06-05T10:00' });
    const { changes } = await getComparison(db, JUNE, 'MAD');
    expect(changes.map((c) => [c.categoryId, c.nowMinor, c.beforeMinor])).toEqual([['cat_shopping', 0, 5_000], ['cat_food', 1_500, 1_000]]);
  });
});

describe('deeper insights', () => {
  const nameOf = (c: { key: string | null; name: string | null }) => c.key ?? c.name ?? '?';
  const base: InsightInput = { currency: 'MAD', incomeMinor: 0, expenseMinor: 0, spending: [], previousSpending: [], hasPreviousData: false, monthlyRecurringOutMinor: 0, debtIOweMinor: 0, debtOwedToMeMinor: 0, upcomingCount: 0, upcomingMinor: 0, overBudget: [], unusual: [], monthEndBalances: [] };

  test('warns when commitments outrun spendable money', async () => {
    const low = await openTestDb();
    const account = await createAccount(low, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 100_000 });
    await saveRule(low, null, { name: 'Rent', kind: 'expense', amountMinor: 250_000, currency: 'MAD', accountId: account, categoryId: 'cat_housing', frequency: 'monthly', intervalCount: 1, startDate: '2026-06-28', endDate: null, reminderDaysBefore: null, active: true, autoPost: true });
    const insights = await getInsights(low, JUNE, 'MAD', nameOf);
    expect(insights[0]).toMatchObject({ kind: 'commitments_shortfall', basis: 'estimate', amounts: { amount: 150_000 } });
  });

  test('says nothing about a shortfall when commitments are covered', async () => {
    expect((await getInsights(db, JUNE, 'MAD', nameOf)).some((i) => i.kind === 'commitments_shortfall')).toBe(false);
  });

  test('total spending change, only with a real previous period', () => {
    const now = { ...base, expenseMinor: 150_000 };
    expect(buildInsights(now).some((i) => i.kind === 'spending_up')).toBe(false);
    expect(buildInsights({ ...now, hasPreviousData: true, previousExpenseMinor: 100_000 }).find((i) => i.kind === 'spending_up')?.amounts.percent).toBe(50);
    expect(buildInsights({ ...now, hasPreviousData: true, previousExpenseMinor: 140_000 }).some((i) => i.kind === 'spending_up')).toBe(false);
  });

  test('income-to-expense ratio shifts are reported as they are', () => {
    const result = buildInsights({ ...base, incomeMinor: 100_000, expenseMinor: 80_000, hasPreviousData: true, previousIncomeMinor: 100_000, previousExpenseMinor: 50_000 });
    expect(result.find((i) => i.kind === 'saving_rate_down')?.amounts).toEqual({ percent: 20, percentBefore: 50 });
  });

  test('spending above a category’s own usual, from complete past months', async () => {
    for (const month of ['03', '04', '05']) await spend(10_000, { occurredAt: `2026-${month}-10T10:00` });
    await spend(20_000, { occurredAt: '2026-06-10T10:00' });
    const insight = (await getInsights(db, JUNE, 'MAD', nameOf)).find((i) => i.kind === 'above_usual');
    expect(insight).toMatchObject({ labels: { name: 'food' }, amounts: { now: 20_000, usual: 10_000 } });
  });

  test('no pattern is claimed from one month alone', async () => {
    await spend(10_000, { occurredAt: '2026-05-10T10:00' });
    await spend(20_000, { occurredAt: '2026-06-10T10:00' });
    expect((await getInsights(db, JUNE, 'MAD', nameOf)).some((i) => i.kind === 'above_usual')).toBe(false);
  });

  test('a month forecast appears only with enough days behind it', async () => {
    await spend(2_000, { occurredAt: '2026-06-01T10:00' });
    expect((await getInsights(db, JUNE, 'MAD', nameOf)).find((i) => i.kind === 'month_forecast')).toMatchObject({ basis: 'estimate', amounts: { amount: 3_000 } });
    setClock(() => new Date(2026, 5, 3, 10, 0));
    expect((await getInsights(db, JUNE, 'MAD', nameOf)).some((i) => i.kind === 'month_forecast')).toBe(false);
  });
});

describe('upgrading from schema 1', () => {
  const v1 = MIGRATIONS.filter((m) => m.version === 1);

  test('a populated version 1 database keeps every balance and gains the new features', async () => {
    const old = createDb(nodeBackend());
    await migrate(old, v1);
    const now = new Date().toISOString();
    await old.run(`INSERT INTO accounts (id, name, type, currency, created_on, created_at, updated_at) VALUES ('a', 'Bank', 'bank', 'MAD', '2026-01-01', ?, ?)`, [now, now]);
    await old.run(`INSERT INTO categories (id, key, name, kind, icon, color, created_at, updated_at) VALUES ('cat_food', 'food', 'Food', 'expense', 'x', '#000', ?, ?)`, [now, now]);
    await old.run(`INSERT INTO transactions (id, type, amount_minor, currency, occurred_at, account_id, category_id, created_at, updated_at) VALUES ('t', 'expense', 500, 'MAD', ?, 'a', 'cat_food', ?, ?)`, [at, now, now]);
    await old.run(`INSERT INTO ledger_entries (id, transaction_id, account_id, amount_minor, currency) VALUES ('e', 't', 'a', -500, 'MAD')`);

    expect(await migrate(old)).toEqual([2]);
    expect((await getAccount(old, 'a'))?.balanceMinor).toBe(-500);
    expect((await getCashFlow(old, JUNE))[0].expenseMinor).toBe(500);
    expect((await getMoneyFlow(old, JUNE, 'MAD')).everydayMinor).toBe(500);
    expect(await verifyLedger(old)).toEqual([]);
  });

  test('a backup made by version 1 still restores', async () => {
    await spend(1_000);
    const current = await createBackup(db);
    const legacy = JSON.parse(serializeBackup(current)) as BackupFile;
    legacy.schemaVersion = 1;
    delete (legacy.tables as Record<string, unknown>).templates;
    delete legacy.counts.templates;
    for (const row of legacy.tables.transactions) delete row.occasional;
    for (const row of legacy.tables.categories) {
      delete row.parent_id;
      delete row.expires_on;
    }
    const { sha256 } = jest.requireActual('@noble/hashes/sha2.js') as typeof import('@noble/hashes/sha2.js');
    const { bytesToHex, utf8ToBytes } = jest.requireActual('@noble/hashes/utils.js') as typeof import('@noble/hashes/utils.js');
    legacy.checksum = bytesToHex(sha256(utf8ToBytes(JSON.stringify(legacy.tables))));

    const fresh = await openTestDb();
    await restoreBackup(fresh, parseBackup(JSON.stringify(legacy)));
    expect(await getPositions(fresh)).toEqual(await getPositions(db));
    expect(await verifyLedger(fresh)).toEqual([]);
  });

  test('a current backup missing a table is still treated as damaged', async () => {
    const current = await createBackup(db);
    const broken = JSON.parse(serializeBackup(current)) as BackupFile;
    delete (broken.tables as Record<string, unknown>).templates;
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(expect.objectContaining({ code: 'backup_corrupt' }));
  });
});
