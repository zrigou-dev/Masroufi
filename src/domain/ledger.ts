import { fail } from './errors';
import type { Direction, Id, TransactionType } from './types';

export type Leg = { accountId: Id; amountMinor: number; currency: string };

export type LegSource = {
  type: TransactionType;
  amountMinor: number;
  currency: string;
  accountId: Id;
  toAccountId?: Id | null;
  toAmountMinor?: number | null;
  toCurrency?: string | null;
  direction?: Direction | null;
};

/**
 * The one place that says how a financial event moves money. Every transaction row owns
 * exactly these legs; a balance is only ever the sum of an account's legs.
 *
 * Reversals are not handled here: their legs are the negation of the original's legs.
 */
export function buildLegs(tx: LegSource): Leg[] {
  const signed = (sign: 1 | -1): Leg[] => [
    { accountId: tx.accountId, amountMinor: sign * tx.amountMinor, currency: tx.currency },
  ];

  switch (tx.type) {
    case 'income':
    case 'refund':
    case 'debt_borrowed':
    case 'debt_collection':
      return signed(1);
    case 'expense':
    case 'debt_lent':
    case 'debt_repayment':
      return signed(-1);
    case 'opening_balance':
    case 'adjustment':
      if (tx.direction !== 'in' && tx.direction !== 'out') fail('invalid_input');
      return signed(tx.direction === 'in' ? 1 : -1);
    case 'transfer': {
      if (!tx.toAccountId) fail('invalid_input');
      const received = tx.toAmountMinor ?? tx.amountMinor;
      const receivedCurrency = tx.toCurrency ?? tx.currency;
      return [
        { accountId: tx.accountId, amountMinor: -tx.amountMinor, currency: tx.currency },
        { accountId: tx.toAccountId, amountMinor: received, currency: receivedCurrency },
      ];
    }
    case 'reversal':
      return fail('invalid_input');
  }
}

export function negateLegs(legs: Leg[]): Leg[] {
  return legs.map((leg) => ({ ...leg, amountMinor: -leg.amountMinor }));
}
