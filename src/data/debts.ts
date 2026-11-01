import { computeDebtState, type DebtState } from '../domain/debts';
import { addMonths, isValidDate, nowIso, nowLocal, today, type LocalDate, type LocalDateTime } from '../domain/dates';
import { fail } from '../domain/errors';
import { assertValidAmount, isSupportedCurrency, splitEvenly } from '../domain/money';
import type { Debt, DebtClosure, DebtDirection, DebtEvent, Id, Installment } from '../domain/types';
import { newId } from './ids';
import type { Db } from './sql';
import { insertSystemTransaction, rewriteSystemTransaction } from './transactions';

type Row = {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  principal_minor: number;
  fees_minor: number;
  interest_rate_bps: number | null;
  currency: string;
  start_date: string;
  due_date: string | null;
  description: string | null;
  reference_notes: string | null;
  closure: DebtClosure;
  priority: number;
  opening_transaction_id: string | null;
  created_at: string;
  updated_at: string;
  paid_minor: number;
};

const toDebt = (r: Row): Debt => ({
  id: r.id,
  direction: r.direction,
  counterparty: r.counterparty,
  principalMinor: r.principal_minor,
  feesMinor: r.fees_minor,
  interestRateBps: r.interest_rate_bps,
  currency: r.currency,
  startDate: r.start_date,
  dueDate: r.due_date,
  description: r.description,
  referenceNotes: r.reference_notes,
  closure: r.closure,
  priority: r.priority,
  openingTransactionId: r.opening_transaction_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SELECT = `SELECT d.*, p.paid_minor FROM debts d JOIN v_debt_paid p ON p.debt_id = d.id WHERE d.deleted_at IS NULL`;

export type DebtSummary = Debt & { state: DebtState };

type InstallmentRow = { id: string; debt_id: string; due_date: string; amount_minor: number };

const toInstallment = (r: InstallmentRow): Installment => ({
  id: r.id,
  debtId: r.debt_id,
  dueDate: r.due_date,
  amountMinor: r.amount_minor,
});

export async function listDebts(db: Db, options: { direction?: DebtDirection } = {}): Promise<DebtSummary[]> {
  const rows = await db.all<Row>(`${SELECT} AND (? IS NULL OR d.direction = ?) ORDER BY d.start_date DESC, d.created_at DESC`, [
    options.direction ?? null,
    options.direction ?? null,
  ]);
  const installments = await db.all<InstallmentRow>('SELECT * FROM installments');
  const grouped = new Map<string, Installment[]>();
  for (const row of installments) {
    grouped.set(row.debt_id, [...(grouped.get(row.debt_id) ?? []), toInstallment(row)]);
  }
  const date = today();
  return rows.map((row) => {
    const debt = toDebt(row);
    return { ...debt, state: computeDebtState(debt, row.paid_minor, grouped.get(row.id) ?? [], date) };
  });
}

export async function getDebt(db: Db, id: Id): Promise<DebtSummary | null> {
  const row = await db.get<Row>(`${SELECT} AND d.id = ?`, [id]);
  if (!row) return null;
  const items = await db.all<InstallmentRow>('SELECT * FROM installments WHERE debt_id = ?', [id]);
  const debt = toDebt(row);
  return { ...debt, state: computeDebtState(debt, row.paid_minor, items.map(toInstallment), today()) };
}

export async function listDebtEvents(db: Db, debtId: Id): Promise<DebtEvent[]> {
  const rows = await db.all<{ id: string; debt_id: string; kind: DebtEvent['kind']; amount_minor: number | null; note: string | null; at: string }>(
    'SELECT * FROM debt_events WHERE debt_id = ? ORDER BY at DESC, rowid DESC',
    [debtId],
  );
  return rows.map((r) => ({ id: r.id, debtId: r.debt_id, kind: r.kind, amountMinor: r.amount_minor, note: r.note, at: r.at }));
}

async function logEvent(tx: Db, debtId: Id, kind: DebtEvent['kind'], amountMinor: number | null, note: string | null): Promise<void> {
  await tx.run('INSERT INTO debt_events (id, debt_id, kind, amount_minor, note, at) VALUES (?, ?, ?, ?, ?, ?)', [
    newId(), debtId, kind, amountMinor, note, nowIso(),
  ]);
}

export type ScheduleItem = { dueDate: LocalDate; amountMinor: number };

export type DebtInput = {
  direction: DebtDirection;
  counterparty: string;
  principalMinor: number;
  currency: string;
  startDate: LocalDate;
  dueDate?: LocalDate | null;
  feesMinor?: number;
  interestRateBps?: number | null;
  description?: string | null;
  referenceNotes?: string | null;
  priority?: number;
  /** The account the money moved through. Null for a debt that predates the app. */
  accountId?: Id | null;
  schedule?: ScheduleItem[];
  idempotencyKey?: string | null;
};

function validateFields(input: DebtInput): void {
  if (!input.counterparty.trim()) fail('invalid_name');
  assertValidAmount(input.principalMinor);
  if (!isSupportedCurrency(input.currency)) fail('invalid_currency');
  if (!isValidDate(input.startDate)) fail('invalid_date');
  if (input.dueDate && !isValidDate(input.dueDate)) fail('invalid_date');
  if (input.dueDate && input.dueDate < input.startDate) fail('invalid_date');
  const fees = input.feesMinor ?? 0;
  if (!Number.isSafeInteger(fees) || fees < 0) fail('invalid_amount');
  if (input.interestRateBps != null && (!Number.isInteger(input.interestRateBps) || input.interestRateBps < 0)) fail('invalid_input');
}

function validateSchedule(items: ScheduleItem[], expectedTotal: number): void {
  if (items.length === 0) fail('schedule_empty');
  let total = 0;
  for (const item of items) {
    assertValidAmount(item.amountMinor);
    if (!isValidDate(item.dueDate)) fail('invalid_date');
    total += item.amountMinor;
  }
  if (total !== expectedTotal) fail('schedule_mismatch', { expectedMinor: expectedTotal, actualMinor: total });
}

async function assertAccountFits(tx: Db, accountId: Id, currency: string): Promise<void> {
  const account = await tx.get<{ currency: string; archived_at: string | null }>('SELECT currency, archived_at FROM accounts WHERE id = ?', [accountId]);
  if (!account) fail('not_found');
  if (account.archived_at) fail('account_archived');
  if (account.currency !== currency) fail('currency_mismatch');
}

/** A debt dated today sorts by when it was entered, so it stays ahead of same-day payments. */
const openingTime = (startDate: LocalDate): LocalDateTime => (startDate === today() ? nowLocal() : `${startDate}T12:00`);

export async function createDebt(db: Db, input: DebtInput): Promise<Id> {
  validateFields(input);
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.get<{ debt_id: string | null }>('SELECT debt_id FROM transactions WHERE idempotency_key = ?', [input.idempotencyKey]);
      if (existing?.debt_id) return existing.debt_id;
    }
    const id = newId();
    const time = nowIso();
    const fees = input.feesMinor ?? 0;
    await tx.run(
      `INSERT INTO debts (id, direction, counterparty, principal_minor, fees_minor, interest_rate_bps, currency, start_date,
        due_date, description, reference_notes, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.direction, input.counterparty.trim(), input.principalMinor, fees, input.interestRateBps ?? null, input.currency,
       input.startDate, input.dueDate ?? null, input.description?.trim() || null, input.referenceNotes?.trim() || null,
       input.priority ?? 0, time, time],
    );
    if (input.accountId) {
      if (input.startDate > today()) fail('future_date');
      await assertAccountFits(tx, input.accountId, input.currency);
      const openingId = await insertSystemTransaction(tx, {
        type: input.direction === 'i_owe' ? 'debt_borrowed' : 'debt_lent',
        amountMinor: input.principalMinor,
        currency: input.currency,
        occurredAt: openingTime(input.startDate),
        accountId: input.accountId,
        debtId: id,
        counterparty: input.counterparty.trim(),
        idempotencyKey: input.idempotencyKey ?? null,
      });
      await tx.run('UPDATE debts SET opening_transaction_id = ? WHERE id = ?', [openingId, id]);
    }
    if (input.schedule?.length) {
      validateSchedule(input.schedule, input.principalMinor + fees);
      for (const item of input.schedule) {
        await tx.run('INSERT INTO installments (id, debt_id, due_date, amount_minor) VALUES (?, ?, ?, ?)', [newId(), id, item.dueDate, item.amountMinor]);
      }
    }
    await logEvent(tx, id, 'created', input.principalMinor, null);
    return id;
  });
}

export type DebtPatch = {
  counterparty: string;
  principalMinor: number;
  feesMinor: number;
  interestRateBps: number | null;
  startDate: LocalDate;
  dueDate: LocalDate | null;
  description: string | null;
  referenceNotes: string | null;
  priority: number;
};

export async function updateDebt(db: Db, id: Id, patch: DebtPatch): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await getDebt(tx, id);
    if (!current) fail('not_found');
    validateFields({ ...patch, direction: current.direction, currency: current.currency });
    const total = patch.principalMinor + patch.feesMinor;
    if (total < current.state.paidMinor) fail('principal_below_paid');
    const scheduled = current.state.installments.reduce((sum, i) => sum + i.amountMinor, 0);
    if (scheduled > 0 && scheduled !== total) fail('schedule_mismatch', { expectedMinor: total, actualMinor: scheduled });

    await tx.run(
      `UPDATE debts SET counterparty = ?, principal_minor = ?, fees_minor = ?, interest_rate_bps = ?, start_date = ?,
        due_date = ?, description = ?, reference_notes = ?, priority = ?, updated_at = ? WHERE id = ?`,
      [patch.counterparty.trim(), patch.principalMinor, patch.feesMinor, patch.interestRateBps, patch.startDate, patch.dueDate,
       patch.description?.trim() || null, patch.referenceNotes?.trim() || null, patch.priority, nowIso(), id],
    );
    if (current.openingTransactionId) {
      const opening = await tx.get<{ account_id: string; type: 'debt_borrowed' | 'debt_lent'; occurred_at: string }>(
        'SELECT account_id, type, occurred_at FROM transactions WHERE id = ?',
        [current.openingTransactionId],
      );
      if (!opening) fail('not_found');
      await rewriteSystemTransaction(tx, current.openingTransactionId, {
        type: opening.type,
        amountMinor: patch.principalMinor,
        currency: current.currency,
        occurredAt: patch.startDate === current.startDate ? opening.occurred_at : openingTime(patch.startDate),
        accountId: opening.account_id,
      });
    }
    await logEvent(tx, id, 'updated', patch.principalMinor, null);
  });
}

/** Closes a debt without any money moving; the remaining balance stops counting and history stays. */
export async function closeDebt(db: Db, id: Id, closure: 'cancelled' | 'written_off', note?: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const debt = await getDebt(tx, id);
    if (!debt) fail('not_found');
    if (debt.closure !== 'active') fail('debt_closed');
    await tx.run('UPDATE debts SET closure = ?, updated_at = ? WHERE id = ?', [closure, nowIso(), id]);
    await logEvent(tx, id, closure, debt.state.remainingMinor, note?.trim() || null);
  });
}

export async function reopenDebt(db: Db, id: Id): Promise<void> {
  await db.transaction(async (tx) => {
    const debt = await getDebt(tx, id);
    if (!debt) fail('not_found');
    await tx.run(`UPDATE debts SET closure = 'active', updated_at = ? WHERE id = ?`, [nowIso(), id]);
    await logEvent(tx, id, 'reopened', null, null);
  });
}

/** Only a debt entered by mistake, with no payments, can be deleted. Otherwise it is closed instead. */
export async function deleteDebt(db: Db, id: Id): Promise<void> {
  await db.transaction(async (tx) => {
    const debt = await getDebt(tx, id);
    if (!debt) fail('not_found');
    const payment = await tx.get(
      `SELECT 1 FROM transactions WHERE debt_id = ? AND deleted_at IS NULL AND type IN ('debt_repayment','debt_collection','reversal')`,
      [id],
    );
    if (payment) fail('debt_has_payments');
    const time = nowIso();
    await tx.run('UPDATE debts SET deleted_at = ?, updated_at = ? WHERE id = ?', [time, time, id]);
    await tx.run('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE debt_id = ? AND deleted_at IS NULL', [time, time, id]);
  });
}

/**
 * Replaces the unpaid part of a schedule. Installments already covered by payments are frozen and
 * a partly paid one shrinks to what was paid, so the new items must add up to exactly the balance.
 */
export async function replaceSchedule(db: Db, debtId: Id, items: ScheduleItem[]): Promise<void> {
  await db.transaction(async (tx) => {
    const debt = await getDebt(tx, debtId);
    if (!debt) fail('not_found');
    if (debt.closure !== 'active') fail('debt_closed');
    validateSchedule(items, debt.state.remainingMinor);

    const previous = debt.state.installments.map((i) => `${i.dueDate}:${i.amountMinor}`).join(',');
    await tx.run('DELETE FROM installments WHERE debt_id = ?', [debtId]);

    // Payments made without a schedule, or beyond one, still need a frozen line to allocate against.
    let covered = 0;
    for (const item of debt.state.installments) {
      if (item.paidMinor === 0) continue;
      covered += item.paidMinor;
      await tx.run('INSERT INTO installments (id, debt_id, due_date, amount_minor) VALUES (?, ?, ?, ?)', [newId(), debtId, item.dueDate, item.paidMinor]);
    }
    const uncovered = debt.state.paidMinor - covered;
    if (uncovered > 0) {
      await tx.run('INSERT INTO installments (id, debt_id, due_date, amount_minor) VALUES (?, ?, ?, ?)', [newId(), debtId, debt.startDate, uncovered]);
    }
    for (const item of items) {
      await tx.run('INSERT INTO installments (id, debt_id, due_date, amount_minor) VALUES (?, ?, ?, ?)', [newId(), debtId, item.dueDate, item.amountMinor]);
    }
    await logEvent(tx, debtId, 'schedule_changed', null, previous || null);
  });
}

/** Removes the plan, leaving payments untouched. */
export async function clearSchedule(db: Db, debtId: Id): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM installments WHERE debt_id = ?', [debtId]);
    await logEvent(tx, debtId, 'schedule_changed', null, null);
  });
}

export function equalSchedule(totalMinor: number, count: number, firstDate: LocalDate, stepMonths = 1): ScheduleItem[] {
  return splitEvenly(totalMinor, count).map((amountMinor, index) => ({
    amountMinor,
    dueDate: addMonths(firstDate, index * stepMonths, Number(firstDate.slice(8, 10))),
  }));
}
