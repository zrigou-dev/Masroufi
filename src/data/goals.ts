import { computeGoalStatus, type GoalStatus } from '../domain/goals';
import { isValidDate, nowIso, today, type LocalDate } from '../domain/dates';
import { fail } from '../domain/errors';
import { assertValidAmount, isSupportedCurrency } from '../domain/money';
import type { GoalMode, Id, SavingsGoal } from '../domain/types';
import { getAccount } from './accounts';
import { averageMonthlyNet } from './finance';
import { newId } from './ids';
import type { Db } from './sql';

type Row = {
  id: string;
  name: string;
  target_minor: number;
  currency: string;
  target_date: string | null;
  priority: number;
  notes: string | null;
  mode: GoalMode;
  linked_account_id: string | null;
  archived_at: string | null;
};

const toGoal = (r: Row): SavingsGoal => ({
  id: r.id,
  name: r.name,
  targetMinor: r.target_minor,
  currency: r.currency,
  targetDate: r.target_date,
  priority: r.priority,
  notes: r.notes,
  mode: r.mode,
  linkedAccountId: r.linked_account_id,
  archivedAt: r.archived_at,
});

export type GoalInput = Omit<SavingsGoal, 'id' | 'archivedAt'>;

async function validate(tx: Db, id: Id | null, input: GoalInput): Promise<void> {
  if (!input.name.trim()) fail('invalid_name');
  assertValidAmount(input.targetMinor);
  if (!isSupportedCurrency(input.currency)) fail('invalid_currency');
  if (input.targetDate && !isValidDate(input.targetDate)) fail('invalid_date');
  if (input.mode === 'account') {
    if (!input.linkedAccountId) fail('invalid_input');
    const account = await getAccount(tx, input.linkedAccountId);
    if (!account) fail('not_found');
    if (account.currency !== input.currency) fail('currency_mismatch');
    const taken = await tx.get(
      'SELECT 1 FROM savings_goals WHERE linked_account_id = ? AND archived_at IS NULL AND id <> ?',
      [input.linkedAccountId, id ?? ''],
    );
    if (taken) fail('goal_account_taken');
  }
}

export async function saveGoal(db: Db, id: Id | null, input: GoalInput): Promise<Id> {
  return db.transaction(async (tx) => {
    await validate(tx, id, input);
    const time = nowIso();
    const linked = input.mode === 'account' ? input.linkedAccountId : null;
    if (id) {
      const { changes } = await tx.run(
        `UPDATE savings_goals SET name = ?, target_minor = ?, currency = ?, target_date = ?, priority = ?, notes = ?, mode = ?,
          linked_account_id = ?, updated_at = ? WHERE id = ?`,
        [input.name.trim(), input.targetMinor, input.currency, input.targetDate, input.priority, input.notes?.trim() || null, input.mode, linked, time, id],
      );
      if (changes === 0) fail('not_found');
      return id;
    }
    const created = newId();
    await tx.run(
      `INSERT INTO savings_goals (id, name, target_minor, currency, target_date, priority, notes, mode, linked_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [created, input.name.trim(), input.targetMinor, input.currency, input.targetDate, input.priority, input.notes?.trim() || null, input.mode, linked, time, time],
    );
    return created;
  });
}

export async function setGoalArchived(db: Db, id: Id, archived: boolean): Promise<void> {
  await db.run('UPDATE savings_goals SET archived_at = ?, updated_at = ? WHERE id = ?', [archived ? nowIso() : null, nowIso(), id]);
}

export async function deleteGoal(db: Db, id: Id): Promise<void> {
  await db.run('DELETE FROM savings_goals WHERE id = ?', [id]);
}

async function goalProgress(db: Db, goal: SavingsGoal): Promise<number> {
  if (goal.mode === 'account' && goal.linkedAccountId) {
    return (await getAccount(db, goal.linkedAccountId))?.balanceMinor ?? 0;
  }
  const row = await db.get<{ total: number }>('SELECT COALESCE(SUM(amount_minor), 0) AS total FROM goal_allocations WHERE goal_id = ?', [goal.id]);
  return row?.total ?? 0;
}

export type GoalWithStatus = { goal: SavingsGoal; status: GoalStatus };

export async function listGoals(db: Db, date: LocalDate = today()): Promise<GoalWithStatus[]> {
  const rows = await db.all<Row>('SELECT * FROM savings_goals WHERE archived_at IS NULL ORDER BY priority DESC, target_date IS NULL, target_date, name');
  const result: GoalWithStatus[] = [];
  for (const row of rows) {
    const goal = toGoal(row);
    const average = await averageMonthlyNet(db, goal.currency, 3, date);
    result.push({ goal, status: computeGoalStatus(goal, await goalProgress(db, goal), date, average) });
  }
  return result;
}

export async function getGoal(db: Db, id: Id): Promise<GoalWithStatus | null> {
  const row = await db.get<Row>('SELECT * FROM savings_goals WHERE id = ?', [id]);
  if (!row) return null;
  const goal = toGoal(row);
  const date = today();
  return { goal, status: computeGoalStatus(goal, await goalProgress(db, goal), date, await averageMonthlyNet(db, goal.currency, 3, date)) };
}

export type Allocation = { id: Id; amountMinor: number; allocatedOn: LocalDate; note: string | null };

export async function listAllocations(db: Db, goalId: Id): Promise<Allocation[]> {
  const rows = await db.all<{ id: string; amount_minor: number; allocated_on: string; note: string | null }>(
    'SELECT id, amount_minor, allocated_on, note FROM goal_allocations WHERE goal_id = ? ORDER BY allocated_on DESC, created_at DESC',
    [goalId],
  );
  return rows.map((r) => ({ id: r.id, amountMinor: r.amount_minor, allocatedOn: r.allocated_on, note: r.note }));
}

/** An earmark inside the books, not a movement of money: no account balance changes. */
export async function addAllocation(db: Db, goalId: Id, amountMinor: number, note?: string | null, date: LocalDate = today()): Promise<void> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) fail('invalid_amount');
  await db.transaction(async (tx) => {
    const goal = await tx.get<Row>('SELECT * FROM savings_goals WHERE id = ?', [goalId]);
    if (!goal) fail('not_found');
    if (goal.mode !== 'manual') fail('invalid_input');
    const current = await tx.get<{ total: number }>('SELECT COALESCE(SUM(amount_minor), 0) AS total FROM goal_allocations WHERE goal_id = ?', [goalId]);
    if ((current?.total ?? 0) + amountMinor < 0) fail('allocation_negative');
    await tx.run('INSERT INTO goal_allocations (id, goal_id, amount_minor, allocated_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      newId(), goalId, amountMinor, date, note?.trim() || null, nowIso(),
    ]);
  });
}
