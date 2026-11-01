/** Stable error codes. The UI maps each one to a translated message (errors.<code>). */
export type ErrorCode =
  | 'invalid_amount'
  | 'invalid_date'
  | 'future_date'
  | 'invalid_name'
  | 'invalid_currency'
  | 'invalid_input'
  | 'not_found'
  | 'account_archived'
  | 'currency_mismatch'
  | 'same_account'
  | 'category_kind_mismatch'
  | 'category_required'
  | 'debt_required'
  | 'debt_closed'
  | 'payment_exceeds_debt'
  | 'principal_below_paid'
  | 'debt_has_payments'
  | 'managed_transaction'
  | 'immutable_type'
  | 'already_reversed'
  | 'has_reversal'
  | 'not_reversible'
  | 'refund_exceeds_original'
  | 'schedule_mismatch'
  | 'schedule_empty'
  | 'occurrence_resolved'
  | 'goal_account_taken'
  | 'allocation_negative'
  | 'threshold_invalid'
  | 'rule_needs_details'
  | 'category_in_use'
  | 'category_parent_invalid'
  | 'split_invalid'
  | 'backup_invalid'
  | 'backup_corrupt'
  | 'backup_newer'
  | 'backup_password';

export class FinanceError extends Error {
  readonly code: ErrorCode;
  readonly params?: Record<string, string | number>;

  constructor(code: ErrorCode, params?: Record<string, string | number>) {
    super(code);
    this.name = 'FinanceError';
    this.code = code;
    this.params = params;
  }
}

export function fail(code: ErrorCode, params?: Record<string, string | number>): never {
  throw new FinanceError(code, params);
}
