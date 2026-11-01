import { buildLegs } from '../domain/ledger';
import type { Direction, TransactionType } from '../domain/types';
import type { Db } from './sql';

type TxRow = {
  id: string;
  type: TransactionType;
  amount_minor: number;
  currency: string;
  account_id: string;
  to_account_id: string | null;
  to_amount_minor: number | null;
  to_currency: string | null;
  direction: Direction | null;
  reversal_of_id: string | null;
};

type EntryRow = { transaction_id: string; account_id: string; amount_minor: number; currency: string };

const signature = (legs: { accountId: string; amountMinor: number; currency: string }[]) =>
  legs.map((l) => `${l.accountId}|${l.amountMinor}|${l.currency}`).sort().join(';');

/**
 * Recomputes what every transaction's ledger legs must be and compares them with what is stored.
 * Run after a restore and by the tests; an empty result means books and history agree.
 */
export async function verifyLedger(db: Db): Promise<string[]> {
  const problems: string[] = [];
  const transactions = await db.all<TxRow>(
    `SELECT id, type, amount_minor, currency, account_id, to_account_id, to_amount_minor, to_currency, direction, reversal_of_id
     FROM transactions`,
  );
  const entries = await db.all<EntryRow>('SELECT transaction_id, account_id, amount_minor, currency FROM ledger_entries');
  const byTransaction = new Map<string, EntryRow[]>();
  for (const entry of entries) {
    byTransaction.set(entry.transaction_id, [...(byTransaction.get(entry.transaction_id) ?? []), entry]);
  }

  const known = new Set(transactions.map((t) => t.id));
  for (const id of byTransaction.keys()) {
    if (!known.has(id)) problems.push(`orphan entries for ${id}`);
  }

  const legsOf = (id: string) =>
    (byTransaction.get(id) ?? []).map((e) => ({ accountId: e.account_id, amountMinor: e.amount_minor, currency: e.currency }));

  for (const tx of transactions) {
    const stored = legsOf(tx.id);
    if (tx.type === 'reversal') {
      const original = legsOf(tx.reversal_of_id as string).map((l) => ({ ...l, amountMinor: -l.amountMinor }));
      if (signature(stored) !== signature(original)) problems.push(`reversal ${tx.id} does not mirror its original`);
      continue;
    }
    try {
      const expected = buildLegs({
        type: tx.type,
        amountMinor: tx.amount_minor,
        currency: tx.currency,
        accountId: tx.account_id,
        toAccountId: tx.to_account_id,
        toAmountMinor: tx.to_amount_minor,
        toCurrency: tx.to_currency,
        direction: tx.direction,
      });
      if (signature(stored) !== signature(expected)) problems.push(`transaction ${tx.id} has wrong legs`);
    } catch {
      problems.push(`transaction ${tx.id} is malformed`);
    }
  }
  return problems;
}
