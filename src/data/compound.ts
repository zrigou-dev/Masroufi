import { dateOf } from '../domain/dates';
import { fail } from '../domain/errors';
import type { Id } from '../domain/types';
import { createDebt } from './debts';
import type { Db } from './sql';
import { createTransaction, type TransactionInput } from './transactions';

/**
 * Everyday events that are really two entries. Each is one atomic operation, so the person sees
 * one action and the books still say exactly what happened.
 */

/** A withdrawal charged a fee: the transfer is not spending, the fee is. */
export async function createTransferWithFee(db: Db, transfer: TransactionInput, feeMinor: number, feeCategoryId: Id): Promise<Id> {
  return db.transaction(async (tx) => {
    const id = await createTransaction(tx, transfer);
    await createTransaction(tx, {
      type: 'expense',
      amountMinor: feeMinor,
      accountId: transfer.accountId,
      categoryId: feeCategoryId,
      occurredAt: transfer.occurredAt,
      description: transfer.description,
      idempotencyKey: transfer.idempotencyKey ? `${transfer.idempotencyKey}:fee` : null,
    });
    return id;
  });
}

export type SplitShare = { person: string; shareMinor: number };

/**
 * I paid the whole bill and someone owes me part of it. Only my part is spending; the rest left
 * the account as a loan, so the account falls by the full amount and my reports stay truthful.
 */
export async function createSplitExpense(db: Db, expense: TransactionInput, share: SplitShare): Promise<Id> {
  if (!Number.isSafeInteger(share.shareMinor) || share.shareMinor <= 0 || share.shareMinor >= expense.amountMinor) fail('split_invalid');
  if (!share.person.trim()) fail('invalid_name');
  return db.transaction(async (tx) => {
    const account = await tx.get<{ currency: string }>('SELECT currency FROM accounts WHERE id = ?', [expense.accountId]);
    if (!account) fail('not_found');
    const id = await createTransaction(tx, { ...expense, amountMinor: expense.amountMinor - share.shareMinor });
    await createDebt(tx, {
      direction: 'owed_to_me',
      counterparty: share.person,
      principalMinor: share.shareMinor,
      currency: account.currency,
      startDate: dateOf(expense.occurredAt),
      accountId: expense.accountId,
      description: expense.description,
      idempotencyKey: expense.idempotencyKey ? `${expense.idempotencyKey}:split` : null,
    });
    return id;
  });
}
