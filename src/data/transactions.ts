import { dateOf, isValidDateTime, nowIso, today, type LocalDate, type LocalDateTime } from '../domain/dates';
import { fail } from '../domain/errors';
import { buildLegs, negateLegs, type Leg, type LegSource } from '../domain/ledger';
import { assertValidAmount } from '../domain/money';
import type { Direction, Id, Transaction, TransactionType } from '../domain/types';
import { newId } from './ids';
import type { Db, SqlValue } from './sql';

export type UserTransactionType = 'income' | 'expense' | 'refund' | 'transfer' | 'debt_repayment' | 'debt_collection';

export type TransactionInput = {
  type: UserTransactionType;
  amountMinor: number;
  accountId: Id;
  occurredAt: LocalDateTime;
  toAccountId?: Id | null;
  /** Only for a transfer between currencies: what actually arrived. */
  toAmountMinor?: number | null;
  categoryId?: Id | null;
  debtId?: Id | null;
  description?: string | null;
  notes?: string | null;
  counterparty?: string | null;
  tags?: string[];
  relatedTransactionId?: Id | null;
  /** Explicit consent to pay more than the debt's remaining balance. */
  allowOverpayment?: boolean;
  occasional?: boolean;
  /** Fixed per form; a repeated submit returns the first result instead of a second transaction. */
  idempotencyKey?: string | null;
  recurringRuleId?: Id | null;
  recurringDueDate?: LocalDate | null;
};

export type TransactionView = Transaction & {
  accountName: string;
  toAccountName: string | null;
  categoryKey: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  debtCounterparty: string | null;
  /** Effect on the filtered account, in its currency; unfiltered, the effect in the transaction's currency. */
  netMinor: number;
  netCurrency: string;
  isReversed: boolean;
};

type TxRow = {
  id: string;
  type: TransactionType;
  amount_minor: number;
  currency: string;
  occurred_at: string;
  account_id: string;
  to_account_id: string | null;
  to_amount_minor: number | null;
  to_currency: string | null;
  direction: Direction | null;
  category_id: string | null;
  debt_id: string | null;
  description: string | null;
  notes: string | null;
  counterparty: string | null;
  reversal_of_id: string | null;
  related_transaction_id: string | null;
  is_overpayment: number;
  occasional: number;
  recurring_rule_id: string | null;
  recurring_due_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  tags_json: string;
};

type ViewRow = TxRow & {
  account_name: string;
  to_account_name: string | null;
  category_key: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  debt_counterparty: string | null;
  net_minor: number | null;
  net_currency: string | null;
  is_reversed: number;
};

const toTransaction = (r: TxRow): Transaction => ({
  id: r.id,
  type: r.type,
  amountMinor: r.amount_minor,
  currency: r.currency,
  occurredAt: r.occurred_at,
  accountId: r.account_id,
  toAccountId: r.to_account_id,
  toAmountMinor: r.to_amount_minor,
  toCurrency: r.to_currency,
  direction: r.direction,
  categoryId: r.category_id,
  debtId: r.debt_id,
  description: r.description,
  notes: r.notes,
  counterparty: r.counterparty,
  reversalOfId: r.reversal_of_id,
  relatedTransactionId: r.related_transaction_id,
  isOverpayment: r.is_overpayment === 1,
  occasional: r.occasional === 1,
  recurringRuleId: r.recurring_rule_id,
  tags: JSON.parse(r.tags_json) as string[],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

const toView = (r: ViewRow): TransactionView => ({
  ...toTransaction(r),
  accountName: r.account_name,
  toAccountName: r.to_account_name,
  categoryKey: r.category_key,
  categoryName: r.category_name,
  categoryIcon: r.category_icon,
  categoryColor: r.category_color,
  debtCounterparty: r.debt_counterparty,
  netMinor: r.net_minor ?? 0,
  netCurrency: r.net_currency ?? r.currency,
  isReversed: r.is_reversed === 1,
});

const TAGS_SQL = `(SELECT json_group_array(tag) FROM transaction_tags WHERE transaction_id = t.id) AS tags_json`;

async function loadRow(tx: Db, id: Id): Promise<TxRow> {
  const row = await tx.get<TxRow>(`SELECT t.*, ${TAGS_SQL} FROM transactions t WHERE t.id = ?`, [id]);
  if (!row) fail('not_found');
  return row;
}

async function writeLegs(tx: Db, transactionId: Id, legs: Leg[]): Promise<void> {
  for (const leg of legs) {
    await tx.run('INSERT INTO ledger_entries (id, transaction_id, account_id, amount_minor, currency) VALUES (?, ?, ?, ?, ?)', [
      newId(), transactionId, leg.accountId, leg.amountMinor, leg.currency,
    ]);
  }
}

async function writeTags(tx: Db, transactionId: Id, tags: string[] | undefined): Promise<void> {
  const clean = [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))];
  for (const tag of clean) {
    await tx.run('INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, ?)', [transactionId, tag]);
  }
}

const COLUMNS = `id, type, amount_minor, currency, occurred_at, account_id, to_account_id, to_amount_minor, to_currency,
  direction, category_id, debt_id, description, notes, counterparty, reversal_of_id, related_transaction_id,
  is_overpayment, occasional, recurring_rule_id, recurring_due_date, idempotency_key, created_at, updated_at`;

type NewRow = LegSource & {
  occurredAt: LocalDateTime;
  categoryId?: Id | null;
  debtId?: Id | null;
  description?: string | null;
  notes?: string | null;
  counterparty?: string | null;
  reversalOfId?: Id | null;
  relatedTransactionId?: Id | null;
  isOverpayment?: boolean;
  occasional?: boolean;
  recurringRuleId?: Id | null;
  recurringDueDate?: LocalDate | null;
  idempotencyKey?: string | null;
};

async function insertRow(tx: Db, row: NewRow, legs: Leg[]): Promise<Id> {
  const id = newId();
  const time = nowIso();
  const values: SqlValue[] = [
    id, row.type, row.amountMinor, row.currency, row.occurredAt, row.accountId, row.toAccountId ?? null,
    row.toAmountMinor ?? null, row.toCurrency ?? null, row.direction ?? null, row.categoryId ?? null, row.debtId ?? null,
    row.description ?? null, row.notes ?? null, row.counterparty ?? null, row.reversalOfId ?? null,
    row.relatedTransactionId ?? null, row.isOverpayment ? 1 : 0, row.occasional ? 1 : 0, row.recurringRuleId ?? null,
    row.recurringDueDate ?? null, row.idempotencyKey ?? null, time, time,
  ];
  await tx.run(`INSERT INTO transactions (${COLUMNS}) VALUES (${values.map(() => '?').join(', ')})`, values);
  await writeLegs(tx, id, legs);
  return id;
}

/** For events the services create themselves: opening balances, adjustments, debt principal. */
export async function insertSystemTransaction(tx: Db, row: NewRow): Promise<Id> {
  assertValidAmount(row.amountMinor);
  return insertRow(tx, row, buildLegs(row));
}

/** Rewrites a system transaction's money in place, e.g. when a debt's principal is corrected. */
export async function rewriteSystemTransaction(tx: Db, id: Id, row: NewRow): Promise<void> {
  assertValidAmount(row.amountMinor);
  await tx.run('DELETE FROM ledger_entries WHERE transaction_id = ?', [id]);
  await tx.run(
    `UPDATE transactions SET amount_minor = ?, currency = ?, occurred_at = ?, account_id = ?, updated_at = ? WHERE id = ?`,
    [row.amountMinor, row.currency, row.occurredAt, row.accountId, nowIso(), id],
  );
  await writeLegs(tx, id, buildLegs(row));
}

type AccountRef = { id: string; currency: string; archived_at: string | null };

async function loadAccount(tx: Db, id: Id): Promise<AccountRef> {
  const account = await tx.get<AccountRef>('SELECT id, currency, archived_at FROM accounts WHERE id = ?', [id]);
  if (!account) fail('not_found');
  return account;
}

type DebtRef = {
  id: string;
  direction: 'i_owe' | 'owed_to_me';
  currency: string;
  closure: string;
  total_due: number;
  paid_minor: number;
};

async function loadDebt(tx: Db, id: Id): Promise<DebtRef> {
  const debt = await tx.get<DebtRef>(
    `SELECT d.id, d.direction, d.currency, d.closure, d.principal_minor + d.fees_minor AS total_due, p.paid_minor
     FROM debts d JOIN v_debt_paid p ON p.debt_id = d.id WHERE d.id = ? AND d.deleted_at IS NULL`,
    [id],
  );
  if (!debt) fail('not_found');
  return debt;
}

/** Holds even across undo: bringing a payment back must not silently overpay the debt. */
async function assertWithinDebt(tx: Db, debtId: Id): Promise<void> {
  const debt = await loadDebt(tx, debtId);
  const allowed = await tx.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions WHERE debt_id = ? AND is_overpayment = 1 AND deleted_at IS NULL`,
    [debtId],
  );
  if ((allowed?.n ?? 0) === 0 && debt.paid_minor > debt.total_due) {
    fail('payment_exceeds_debt', { remainingMinor: 0 });
  }
}

function assertDateAllowed(occurredAt: LocalDateTime): void {
  if (!isValidDateTime(occurredAt)) fail('invalid_date');
  // Planned money lives in recurring rules and schedules; a dated transaction means it happened.
  if (dateOf(occurredAt) > today()) fail('future_date');
}

async function validateCategory(tx: Db, input: TransactionInput): Promise<void> {
  if (input.type === 'income' || input.type === 'expense' || input.type === 'refund') {
    if (!input.categoryId) fail('category_required');
    const category = await tx.get<{ kind: string }>('SELECT kind FROM categories WHERE id = ?', [input.categoryId]);
    if (!category) fail('not_found');
    const expected = input.type === 'income' ? 'income' : 'expense';
    if (category.kind !== expected) fail('category_kind_mismatch');
  } else if (input.categoryId) {
    fail('category_kind_mismatch');
  }
}

async function validateRefund(tx: Db, input: TransactionInput, currency: string, editingId: Id | null): Promise<void> {
  if (!input.relatedTransactionId) return;
  const original = await tx.get<{ type: string; amount_minor: number; currency: string }>(
    'SELECT type, amount_minor, currency FROM transactions WHERE id = ? AND deleted_at IS NULL',
    [input.relatedTransactionId],
  );
  if (!original || original.type !== 'expense') fail('not_found');
  if (original.currency !== currency) fail('currency_mismatch');
  const refunded = await tx.get<{ total: number }>(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM transactions
     WHERE related_transaction_id = ? AND type = 'refund' AND deleted_at IS NULL AND id <> ?`,
    [input.relatedTransactionId, editingId ?? ''],
  );
  if ((refunded?.total ?? 0) + input.amountMinor > original.amount_minor) fail('refund_exceeds_original');
}

/** Returns whether this payment goes beyond the balance, which only explicit consent allows. */
async function validateDebtPayment(tx: Db, input: TransactionInput, currency: string, editing: TxRow | null): Promise<boolean> {
  if (!input.debtId) fail('debt_required');
  const debt = await loadDebt(tx, input.debtId);
  if (debt.closure !== 'active') fail('debt_closed');
  if (debt.currency !== currency) fail('currency_mismatch');
  const expected = debt.direction === 'i_owe' ? 'debt_repayment' : 'debt_collection';
  if (input.type !== expected) fail('invalid_input');

  const alreadyCounted = editing && editing.deleted_at === null ? editing.amount_minor : 0;
  const remaining = debt.total_due - (debt.paid_minor - alreadyCounted);
  const exceeds = input.amountMinor > remaining;
  if (exceeds && !input.allowOverpayment) fail('payment_exceeds_debt', { remainingMinor: Math.max(0, remaining) });
  return exceeds;
}

async function resolveLegs(tx: Db, input: TransactionInput, editing: TxRow | null): Promise<NewRow> {
  assertValidAmount(input.amountMinor);
  assertDateAllowed(input.occurredAt);

  const account = await loadAccount(tx, input.accountId);
  if (account.archived_at && editing?.account_id !== input.accountId) fail('account_archived');
  const currency = account.currency;
  await validateCategory(tx, input);

  let toCurrency: string | null = null;
  let toAmountMinor: number | null = null;

  if (input.type === 'transfer') {
    if (!input.toAccountId) fail('invalid_input');
    if (input.toAccountId === input.accountId) fail('same_account');
    const target = await loadAccount(tx, input.toAccountId);
    if (target.archived_at && editing?.to_account_id !== input.toAccountId) fail('account_archived');
    toCurrency = target.currency;
    if (target.currency === currency) {
      if (input.toAmountMinor != null && input.toAmountMinor !== input.amountMinor) fail('currency_mismatch');
      toAmountMinor = input.amountMinor;
    } else {
      // No exchange rates exist in the app: the person states what actually arrived.
      if (input.toAmountMinor == null) fail('currency_mismatch');
      assertValidAmount(input.toAmountMinor);
      toAmountMinor = input.toAmountMinor;
    }
  } else if (input.toAccountId) {
    fail('invalid_input');
  }

  if (input.type === 'refund') await validateRefund(tx, input, currency, editing?.id ?? null);
  let overpaying = false;
  if (input.type === 'debt_repayment' || input.type === 'debt_collection') {
    overpaying = await validateDebtPayment(tx, input, currency, editing);
  } else if (input.debtId) {
    fail('invalid_input');
  }

  return {
    type: input.type,
    amountMinor: input.amountMinor,
    currency,
    occurredAt: input.occurredAt,
    accountId: input.accountId,
    toAccountId: input.toAccountId ?? null,
    toAmountMinor,
    toCurrency,
    categoryId: input.categoryId ?? null,
    debtId: input.debtId ?? null,
    description: input.description?.trim() || null,
    notes: input.notes?.trim() || null,
    counterparty: input.counterparty?.trim() || null,
    relatedTransactionId: input.relatedTransactionId ?? null,
    isOverpayment: overpaying,
    occasional: input.occasional === true,
    recurringRuleId: input.recurringRuleId ?? null,
    recurringDueDate: input.recurringDueDate ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  };
}

export async function createTransaction(db: Db, input: TransactionInput): Promise<Id> {
  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.get<{ id: string }>('SELECT id FROM transactions WHERE idempotency_key = ?', [input.idempotencyKey]);
      if (existing) return existing.id;
    }
    const row = await resolveLegs(tx, input, null);
    const id = await insertRow(tx, row, buildLegs(row));
    await writeTags(tx, id, input.tags);
    return id;
  });
}

const SYSTEM_MANAGED: TransactionType[] = ['opening_balance', 'debt_borrowed', 'debt_lent'];

function assertUserEditable(row: TxRow): void {
  if (SYSTEM_MANAGED.includes(row.type) || row.type === 'adjustment' || row.type === 'reversal') {
    fail('managed_transaction');
  }
}

async function assertNoDependents(tx: Db, row: TxRow): Promise<void> {
  const reversal = await tx.get(`SELECT 1 FROM transactions WHERE reversal_of_id = ? AND deleted_at IS NULL`, [row.id]);
  if (reversal) fail('has_reversal');
  const refund = await tx.get(`SELECT 1 FROM transactions WHERE related_transaction_id = ? AND deleted_at IS NULL`, [row.id]);
  if (refund) fail('has_reversal');
}

/** Rewrites the event and its legs in one step, so every balance, report and budget follows. */
export async function updateTransaction(db: Db, id: Id, input: TransactionInput): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await loadRow(tx, id);
    if (existing.deleted_at) fail('not_found');
    assertUserEditable(existing);
    if (existing.type !== input.type) fail('immutable_type');
    const reversal = await tx.get(`SELECT 1 FROM transactions WHERE reversal_of_id = ? AND deleted_at IS NULL`, [id]);
    if (reversal) fail('has_reversal');
    // An expense with refunds stays editable as long as it still covers them.
    const refunds = await tx.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM transactions
       WHERE related_transaction_id = ? AND type = 'refund' AND deleted_at IS NULL`,
      [id],
    );
    if (input.amountMinor < (refunds?.total ?? 0)) fail('refund_exceeds_original');

    const row = await resolveLegs(tx, { ...input, idempotencyKey: null, recurringRuleId: existing.recurring_rule_id, recurringDueDate: existing.recurring_due_date }, existing);
    await tx.run('DELETE FROM ledger_entries WHERE transaction_id = ?', [id]);
    await tx.run('DELETE FROM transaction_tags WHERE transaction_id = ?', [id]);
    await tx.run(
      `UPDATE transactions SET amount_minor = ?, currency = ?, occurred_at = ?, account_id = ?, to_account_id = ?,
        to_amount_minor = ?, to_currency = ?, category_id = ?, debt_id = ?, description = ?, notes = ?, counterparty = ?,
        related_transaction_id = ?, is_overpayment = ?, occasional = ?, updated_at = ? WHERE id = ?`,
      [row.amountMinor, row.currency, row.occurredAt, row.accountId, row.toAccountId ?? null, row.toAmountMinor ?? null,
       row.toCurrency ?? null, row.categoryId ?? null, row.debtId ?? null, row.description ?? null, row.notes ?? null,
       row.counterparty ?? null, row.relatedTransactionId ?? null, row.isOverpayment ? 1 : 0, row.occasional ? 1 : 0, nowIso(), id],
    );
    await writeLegs(tx, id, buildLegs(row));
    await writeTags(tx, id, input.tags);
    if (row.debtId) await assertWithinDebt(tx, row.debtId);
  });
}

/**
 * Soft delete: the row and its legs stay, but every view ignores them, so undo is exact.
 * Opening balances and debt principal are removed through the account or debt that owns them.
 */
export async function deleteTransaction(db: Db, id: Id): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadRow(tx, id);
    if (row.deleted_at) fail('not_found');
    if (SYSTEM_MANAGED.includes(row.type)) fail('managed_transaction');
    await assertNoDependents(tx, row);
    await tx.run('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id]);
    // Removing a reversal puts the original payment back into effect.
    if (row.type === 'reversal' && row.debt_id) await assertWithinDebt(tx, row.debt_id);
  });
}

export async function restoreTransaction(db: Db, id: Id): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadRow(tx, id);
    if (!row.deleted_at) return;
    try {
      await tx.run('UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?', [nowIso(), id]);
    } catch {
      // The live-occurrence and live-reversal unique indexes refuse to resurrect a duplicate.
      fail('occurrence_resolved');
    }
    if (row.debt_id) await assertWithinDebt(tx, row.debt_id);
  });
}

const NOT_REVERSIBLE: TransactionType[] = [...SYSTEM_MANAGED, 'reversal'];

/**
 * Keeps the original on record and books its exact opposite, dated when the correction was made.
 * Reports then show both the event and its cancellation in their own periods.
 */
export async function reverseTransaction(db: Db, id: Id, occurredAt: LocalDateTime): Promise<Id> {
  assertDateAllowed(occurredAt);
  return db.transaction(async (tx) => {
    const row = await loadRow(tx, id);
    if (row.deleted_at) fail('not_found');
    if (NOT_REVERSIBLE.includes(row.type)) fail('not_reversible');
    const existing = await tx.get(`SELECT 1 FROM transactions WHERE reversal_of_id = ? AND deleted_at IS NULL`, [id]);
    if (existing) fail('already_reversed');
    const refund = await tx.get(`SELECT 1 FROM transactions WHERE related_transaction_id = ? AND deleted_at IS NULL`, [id]);
    if (refund) fail('has_reversal');

    const legs = await tx.all<{ account_id: string; amount_minor: number; currency: string }>(
      'SELECT account_id, amount_minor, currency FROM ledger_entries WHERE transaction_id = ?',
      [id],
    );
    const reversal: NewRow = {
      type: 'reversal',
      amountMinor: row.amount_minor,
      currency: row.currency,
      occurredAt,
      accountId: row.account_id,
      categoryId: row.category_id,
      debtId: row.debt_id,
      description: row.description,
      reversalOfId: id,
    };
    return insertRow(tx, reversal, negateLegs(legs.map((l) => ({ accountId: l.account_id, amountMinor: l.amount_minor, currency: l.currency }))));
  });
}

export type TransactionFilter = {
  accountId?: Id;
  categoryId?: Id;
  debtId?: Id;
  types?: TransactionType[];
  from?: LocalDate;
  to?: LocalDate;
  search?: string;
  tag?: string;
  /** Only what a recurring rule recorded. */
  recurring?: boolean;
  limit?: number;
  offset?: number;
};

/** Legs in different currencies are never summed, so net is always taken over one currency. */
const VIEW_SELECT = (netFilter: string) => `
  SELECT t.*, ${TAGS_SQL},
    a.name AS account_name, ta.name AS to_account_name,
    c.key AS category_key, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
    d.counterparty AS debt_counterparty,
    (SELECT SUM(e.amount_minor) FROM ledger_entries e WHERE e.transaction_id = t.id ${netFilter}) AS net_minor,
    (SELECT MIN(e.currency) FROM ledger_entries e WHERE e.transaction_id = t.id ${netFilter}) AS net_currency,
    EXISTS (SELECT 1 FROM transactions r WHERE r.reversal_of_id = t.id AND r.deleted_at IS NULL) AS is_reversed
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN debts d ON d.id = t.debt_id`;

const TX_CURRENCY = 'AND e.currency = t.currency';

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listTransactions(db: Db, filter: TransactionFilter = {}): Promise<TransactionView[]> {
  const where = ['t.deleted_at IS NULL'];
  const params: SqlValue[] = [];
  const netParams: SqlValue[] = [];

  if (filter.accountId) {
    where.push('EXISTS (SELECT 1 FROM ledger_entries e WHERE e.transaction_id = t.id AND e.account_id = ?)');
    params.push(filter.accountId);
    netParams.push(filter.accountId, filter.accountId);
  }
  if (filter.categoryId) {
    // A parent category includes everything filed under it.
    where.push('(t.category_id = ? OR t.category_id IN (SELECT id FROM categories WHERE parent_id = ?))');
    params.push(filter.categoryId, filter.categoryId);
  }
  if (filter.debtId) {
    where.push('t.debt_id = ?');
    params.push(filter.debtId);
  }
  if (filter.types?.length) {
    where.push(`t.type IN (${filter.types.map(() => '?').join(', ')})`);
    params.push(...filter.types);
  }
  if (filter.from) {
    where.push('t.occurred_at >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    // 'U' sorts just after the 'T' in every timestamp of that day.
    where.push('t.occurred_at < ?');
    params.push(`${filter.to}U`);
  }
  if (filter.recurring) where.push('t.recurring_rule_id IS NOT NULL');
  if (filter.tag) {
    where.push('EXISTS (SELECT 1 FROM transaction_tags g WHERE g.transaction_id = t.id AND g.tag = ?)');
    params.push(filter.tag);
  }
  const search = filter.search?.trim();
  if (search) {
    const like = `%${escapeLike(search)}%`;
    where.push(`(t.description LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR t.counterparty LIKE ? ESCAPE '\\'
      OR c.name LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR d.counterparty LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM transaction_tags g WHERE g.transaction_id = t.id AND g.tag LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like, like, like, like, like);
  }

  const sql = `${VIEW_SELECT(filter.accountId ? 'AND e.account_id = ?' : TX_CURRENCY)}
    WHERE ${where.join(' AND ')}
    ORDER BY t.occurred_at DESC, t.created_at DESC
    LIMIT ? OFFSET ?`;
  const rows = await db.all<ViewRow>(sql, [...netParams, ...params, filter.limit ?? 200, filter.offset ?? 0]);
  return rows.map(toView);
}

export async function getTransaction(db: Db, id: Id): Promise<TransactionView | null> {
  const row = await db.get<ViewRow>(`${VIEW_SELECT(TX_CURRENCY)} WHERE t.id = ?`, [id]);
  return row ? toView(row) : null;
}

/** Near-identical entries on the same day, so the form can ask before saving a likely repeat. */
export async function findPossibleDuplicates(
  db: Db,
  input: Pick<TransactionInput, 'type' | 'amountMinor' | 'accountId' | 'toAccountId' | 'categoryId' | 'occurredAt'>,
  excludeId?: Id,
): Promise<TransactionView[]> {
  const day = dateOf(input.occurredAt);
  const rows = await db.all<ViewRow>(
    `${VIEW_SELECT(TX_CURRENCY)}
     WHERE t.deleted_at IS NULL AND t.type = ? AND t.amount_minor = ? AND t.account_id = ?
       AND COALESCE(t.to_account_id, '') = ? AND COALESCE(t.category_id, '') = ?
       AND substr(t.occurred_at, 1, 10) = ? AND t.id <> ?
     ORDER BY t.occurred_at DESC LIMIT 3`,
    [input.type, input.amountMinor, input.accountId, input.toAccountId ?? '', input.categoryId ?? '', day, excludeId ?? ''],
  );
  return rows.map(toView);
}
