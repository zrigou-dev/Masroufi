import { addDays, addMonths, startOfMonth, today } from '../domain/dates';
import { createAccount } from './accounts';
import { saveBudget } from './budgets';
import { createDebt, equalSchedule } from './debts';
import { saveGoal, addAllocation } from './goals';
import { saveRule } from './recurring';
import type { Db } from './sql';
import { createTransaction } from './transactions';

/** Sample books for trying the app. Only ever loaded by an explicit choice during onboarding. */
export async function loadDemoData(db: Db): Promise<void> {
  const date = today();
  await db.transaction(async (tx) => {
    const sixMonthsAgo = startOfMonth(addMonths(date, -5, 1));
    const bank = await createAccount(tx, { name: 'البنك', type: 'bank', currency: 'MAD', openingBalanceMinor: 1_200_000, createdOn: sixMonthsAgo });
    const cash = await createAccount(tx, { name: 'نقدًا', type: 'cash', currency: 'MAD', openingBalanceMinor: 80_000, createdOn: sixMonthsAgo });
    const savings = await createAccount(tx, { name: 'التوفير', type: 'savings', currency: 'MAD', openingBalanceMinor: 500_000, createdOn: sixMonthsAgo });

    for (let back = 5; back >= 0; back -= 1) {
      const month = startOfMonth(addMonths(date, -back, 1));
      const on = (day: number) => {
        const value = addDays(month, day - 1);
        return `${value > date ? date : value}T10:00`;
      };
      await createTransaction(tx, { type: 'income', amountMinor: 900_000, accountId: bank, categoryId: 'cat_salary', occurredAt: on(1), description: 'الراتب الشهري' });
      await createTransaction(tx, { type: 'expense', amountMinor: 280_000, accountId: bank, categoryId: 'cat_housing', occurredAt: on(2), description: 'الإيجار' });
      await createTransaction(tx, { type: 'expense', amountMinor: 35_000, accountId: bank, categoryId: 'cat_internet_phone', occurredAt: on(3) });
      await createTransaction(tx, { type: 'transfer', amountMinor: 230_000, accountId: bank, toAccountId: cash, occurredAt: on(4) });
      await createTransaction(tx, { type: 'expense', amountMinor: 120_000 + back * 4_000, accountId: cash, categoryId: 'cat_groceries', occurredAt: on(6) });
      await createTransaction(tx, { type: 'expense', amountMinor: 45_000 - back * 3_000, accountId: cash, categoryId: 'cat_restaurants', occurredAt: on(9) });
      await createTransaction(tx, { type: 'expense', amountMinor: 1_500, accountId: cash, categoryId: 'cat_food', occurredAt: on(7), description: 'قهوة' });
      await createTransaction(tx, { type: 'expense', amountMinor: 1_500, accountId: cash, categoryId: 'cat_food', occurredAt: on(10), description: 'قهوة' });
      await createTransaction(tx, { type: 'expense', amountMinor: 40_000, accountId: cash, categoryId: 'cat_transport', occurredAt: on(11) });
      await createTransaction(tx, { type: 'transfer', amountMinor: 50_000, accountId: bank, toAccountId: savings, occurredAt: on(5) });
    }

    await createDebt(tx, {
      direction: 'i_owe',
      counterparty: 'أحمد',
      principalMinor: 300_000,
      currency: 'MAD',
      startDate: addMonths(date, -2),
      accountId: bank,
      schedule: equalSchedule(300_000, 6, addMonths(date, 1)),
    });
    await createDebt(tx, {
      direction: 'owed_to_me',
      counterparty: 'سارة',
      principalMinor: 100_000,
      currency: 'MAD',
      startDate: addMonths(date, -1),
      dueDate: addMonths(date, 1),
      accountId: cash,
    });

    await saveRule(tx, null, {
      name: 'الإيجار', kind: 'expense', amountMinor: 280_000, currency: 'MAD', accountId: bank, categoryId: 'cat_housing',
      frequency: 'monthly', intervalCount: 1, startDate: startOfMonth(addMonths(date, 1, 1)), endDate: null, reminderDaysBefore: 2, active: true, autoPost: true,
    });
    await saveRule(tx, null, {
      name: 'الراتب', kind: 'income', amountMinor: 900_000, currency: 'MAD', accountId: bank, categoryId: 'cat_salary',
      frequency: 'monthly', intervalCount: 1, startDate: startOfMonth(addMonths(date, 1, 1)), endDate: null, reminderDaysBefore: null, active: true, autoPost: true,
    });
    await saveBudget(tx, null, {
      name: 'المطاعم', period: 'monthly', startDate: null, endDate: null, amountMinor: 50_000, currency: 'MAD',
      categoryId: 'cat_restaurants', accountId: null, thresholds: [70, 85, 100], active: true,
    });
    await saveGoal(tx, null, {
      name: 'صندوق الطوارئ', targetMinor: 2_000_000, currency: 'MAD', targetDate: addMonths(date, 12), priority: 2, notes: null, mode: 'account', linkedAccountId: savings,
    });
    const laptop = await saveGoal(tx, null, {
      name: 'حاسوب جديد', targetMinor: 800_000, currency: 'MAD', targetDate: addMonths(date, 8), priority: 1, notes: null, mode: 'manual', linkedAccountId: null,
    });
    await addAllocation(tx, laptop, 100_000, null, date);
  });
}
