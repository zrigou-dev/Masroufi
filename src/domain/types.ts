import type { LocalDate, LocalDateTime } from './dates';

export type Id = string;

export type AccountType = 'bank' | 'cash' | 'savings' | 'other';

export type Account = {
  id: Id;
  name: string;
  type: AccountType;
  currency: string;
  description: string | null;
  isLiquid: boolean;
  createdOn: LocalDate;
  archivedAt: string | null;
  balanceMinor: number;
};

export type CategoryKind = 'income' | 'expense';
export type CategoryNature = 'essential' | 'discretionary';

export type Category = {
  id: Id;
  key: string | null;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  nature: CategoryNature | null;
  archivedAt: string | null;
  parentId: Id | null;
  /** A temporary category leaves the pickers after this date. Its history stays. */
  expiresOn: LocalDate | null;
};

export type TransactionType =
  | 'opening_balance'
  | 'income'
  | 'expense'
  | 'transfer'
  | 'debt_borrowed'
  | 'debt_lent'
  | 'debt_repayment'
  | 'debt_collection'
  | 'refund'
  | 'adjustment'
  | 'reversal';

export type Direction = 'in' | 'out';

export type Transaction = {
  id: Id;
  type: TransactionType;
  amountMinor: number;
  currency: string;
  occurredAt: LocalDateTime;
  accountId: Id;
  toAccountId: Id | null;
  toAmountMinor: number | null;
  toCurrency: string | null;
  direction: Direction | null;
  categoryId: Id | null;
  debtId: Id | null;
  description: string | null;
  notes: string | null;
  counterparty: string | null;
  reversalOfId: Id | null;
  relatedTransactionId: Id | null;
  isOverpayment: boolean;
  /** A one-off the person marked as out of the ordinary. */
  occasional: boolean;
  recurringRuleId: Id | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type DebtDirection = 'i_owe' | 'owed_to_me';
export type DebtClosure = 'active' | 'cancelled' | 'written_off';
export type DebtStatus = 'open' | 'partial' | 'settled' | 'overdue' | 'cancelled' | 'written_off';

export type Debt = {
  id: Id;
  direction: DebtDirection;
  counterparty: string;
  principalMinor: number;
  feesMinor: number;
  interestRateBps: number | null;
  currency: string;
  startDate: LocalDate;
  dueDate: LocalDate | null;
  description: string | null;
  referenceNotes: string | null;
  closure: DebtClosure;
  priority: number;
  openingTransactionId: Id | null;
  createdAt: string;
  updatedAt: string;
};

export type Installment = {
  id: Id;
  debtId: Id;
  dueDate: LocalDate;
  amountMinor: number;
};

export type DebtEvent = {
  id: Id;
  debtId: Id;
  kind: 'created' | 'updated' | 'cancelled' | 'written_off' | 'reopened' | 'schedule_changed';
  amountMinor: number | null;
  note: string | null;
  at: string;
};

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurringKind = 'income' | 'expense';

export type RecurringRule = {
  id: Id;
  name: string;
  kind: RecurringKind;
  amountMinor: number;
  currency: string;
  accountId: Id | null;
  categoryId: Id | null;
  frequency: Frequency;
  intervalCount: number;
  startDate: LocalDate;
  endDate: LocalDate | null;
  reminderDaysBefore: number | null;
  active: boolean;
  /** Record each occurrence by itself on its date, instead of waiting for confirmation. */
  autoPost: boolean;
  autoFrom: LocalDate | null;
};

export type BudgetPeriod = 'monthly' | 'custom';

export type Budget = {
  id: Id;
  name: string;
  period: BudgetPeriod;
  startDate: LocalDate | null;
  endDate: LocalDate | null;
  amountMinor: number;
  currency: string;
  categoryId: Id | null;
  accountId: Id | null;
  thresholds: number[];
  active: boolean;
};

export type Template = {
  id: Id;
  name: string;
  kind: RecurringKind;
  /** Null asks for the amount each time; otherwise the template records in one tap. */
  amountMinor: number | null;
  accountId: Id;
  categoryId: Id;
  description: string | null;
};

export type GoalMode = 'manual' | 'account';

export type SavingsGoal = {
  id: Id;
  name: string;
  targetMinor: number;
  currency: string;
  targetDate: LocalDate | null;
  priority: number;
  notes: string | null;
  mode: GoalMode;
  linkedAccountId: Id | null;
  archivedAt: string | null;
};
