import { dateOf, nowIso, nowLocal, today, type LocalDate, type LocalDateTime, isValidDate, isValidDateTime } from '../domain/dates';
import { fail } from '../domain/errors';
import { isSupportedCurrency, MAX_AMOUNT_MINOR } from '../domain/money';
import type { Account, AccountType, Direction, Transaction } from '../domain/types';
import { newId } from './ids';
import type { Db } from './sql';
import { createTransaction, insertSystemTransaction } from './transactions';

type Row = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  description: string | null;
  is_liquid: number;
  created_on: string;
  archived_at: string | null;
  balance_minor: number;
};

const SELECT = `SELECT a.id, a.name, a.type, a.currency, a.description, a.is_liquid, a.created_on, a.archived_at,
  b.balance_minor FROM accounts a JOIN v_account_balances b ON b.account_id = a.id`;

const toAccount = (r: Row): Account => ({
  id: r.id,
  name: r.name,
  type: r.type,
  currency: r.currency,
  description: r.description,
  isLiquid: r.is_liquid === 1,
  createdOn: r.created_on,
  archivedAt: r.archived_at,
  balanceMinor: r.balance_minor,
});

export async function listAccounts(db: Db, options: { includeArchived?: boolean } = {}): Promise<Account[]> {
  const where = options.includeArchived ? '' : 'WHERE a.archived_at IS NULL';
  const rows = await db.all<Row>(`${SELECT} ${where} ORDER BY a.archived_at IS NOT NULL, a.sort_order, a.created_at`);
  return rows.map(toAccount);
}

export async function getAccount(db: Db, id: string): Promise<Account | null> {
  const row = await db.get<Row>(`${SELECT} WHERE a.id = ?`, [id]);
  return row ? toAccount(row) : null;
}

export type AccountInput = {
  name: string;
  type: AccountType;
  currency: string;
  description?: string | null;
  isLiquid?: boolean;
  createdOn?: LocalDate;
  /** May be negative, for an overdrawn account. */
  openingBalanceMinor?: number;
};

function assertOpening(minor: number): void {
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_AMOUNT_MINOR) fail('invalid_amount');
}

export async function createAccount(db: Db, input: AccountInput): Promise<string> {
  const name = input.name.trim();
  if (!name) fail('invalid_name');
  if (!isSupportedCurrency(input.currency)) fail('invalid_currency');
  const createdOn = input.createdOn ?? today();
  if (!isValidDate(createdOn)) fail('invalid_date');
  const opening = input.openingBalanceMinor ?? 0;
  assertOpening(opening);

  return db.transaction(async (tx) => {
    const id = newId();
    const time = nowIso();
    const order = await tx.get<{ next: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM accounts');
    await tx.run(
      `INSERT INTO accounts (id, name, type, currency, description, is_liquid, created_on, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, input.type, input.currency, input.description?.trim() || null,
       (input.isLiquid ?? input.type !== 'savings') ? 1 : 0, createdOn, order?.next ?? 1, time, time],
    );
    if (opening !== 0) await writeOpening(tx, id, input.currency, opening, createdOn);
    return id;
  });
}

async function writeOpening(tx: Db, accountId: string, currency: string, minor: number, date: LocalDate): Promise<void> {
  await insertSystemTransaction(tx, {
    type: 'opening_balance',
    amountMinor: Math.abs(minor),
    currency,
    occurredAt: `${date}T00:00`,
    accountId,
    direction: minor > 0 ? 'in' : 'out',
  });
}

export type AccountPatch = { name: string; type: AccountType; description: string | null; isLiquid: boolean };

export async function updateAccount(db: Db, id: string, patch: AccountPatch): Promise<void> {
  const name = patch.name.trim();
  if (!name) fail('invalid_name');
  const { changes } = await db.run(
    'UPDATE accounts SET name = ?, type = ?, description = ?, is_liquid = ?, updated_at = ? WHERE id = ?',
    [name, patch.type, patch.description?.trim() || null, patch.isLiquid ? 1 : 0, nowIso(), id],
  );
  if (changes === 0) fail('not_found');
}

/** Corrects the opening balance by rewriting its one ledger event; every balance follows from that. */
export async function setOpeningBalance(db: Db, id: string, minor: number): Promise<void> {
  assertOpening(minor);
  await db.transaction(async (tx) => {
    const account = await getAccount(tx, id);
    if (!account) fail('not_found');
    const existing = await tx.get<{ id: string }>(
      `SELECT id FROM transactions WHERE account_id = ? AND type = 'opening_balance' AND deleted_at IS NULL`,
      [id],
    );
    if (existing) {
      await tx.run('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), existing.id]);
    }
    if (minor !== 0) await writeOpening(tx, id, account.currency, minor, account.createdOn);
  });
}

export async function getOpeningBalance(db: Db, id: string): Promise<number> {
  const row = await db.get<{ amount_minor: number; direction: Direction }>(
    `SELECT amount_minor, direction FROM transactions WHERE account_id = ? AND type = 'opening_balance' AND deleted_at IS NULL`,
    [id],
  );
  if (!row) return 0;
  return row.direction === 'in' ? row.amount_minor : -row.amount_minor;
}

/** Archiving hides an account from pickers. Its history and its money stay counted. */
export async function setAccountArchived(db: Db, id: string, archived: boolean): Promise<void> {
  const { changes } = await db.run('UPDATE accounts SET archived_at = ?, updated_at = ? WHERE id = ?', [
    archived ? nowIso() : null,
    nowIso(),
    id,
  ]);
  if (changes === 0) fail('not_found');
}

/**
 * Brings the calculated balance to what the bank or wallet actually shows, by posting the
 * difference as an explicit adjustment. Returns null when they already agree.
 */
export async function reconcileAccount(
  db: Db,
  id: string,
  actualMinor: number,
  /** With expenseCategoryId, a shortfall is booked as real spending: money that left without being recorded. */
  options: { occurredAt?: LocalDateTime; note?: string | null; expenseCategoryId?: string | null } = {},
): Promise<Pick<Transaction, 'id'> | null> {
  assertOpening(actualMinor);
  const occurredAt = options.occurredAt ?? nowLocal();
  if (!isValidDateTime(occurredAt)) fail('invalid_date');
  if (dateOf(occurredAt) > today()) fail('future_date');
  return db.transaction(async (tx) => {
    const account = await getAccount(tx, id);
    if (!account) fail('not_found');
    if (account.archivedAt) fail('account_archived');
    const difference = actualMinor - account.balanceMinor;
    if (difference === 0) return null;
    if (difference < 0 && options.expenseCategoryId) {
      const expense = await createTransaction(tx, {
        type: 'expense',
        amountMinor: -difference,
        accountId: id,
        categoryId: options.expenseCategoryId,
        occurredAt,
        description: options.note,
      });
      return { id: expense };
    }
    const created = await insertSystemTransaction(tx, {
      type: 'adjustment',
      amountMinor: Math.abs(difference),
      currency: account.currency,
      occurredAt,
      accountId: id,
      direction: difference > 0 ? 'in' : 'out',
      notes: options.note?.trim() || null,
    });
    return { id: created };
  });
}
