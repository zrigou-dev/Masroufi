import { isValidDate, nowIso, nowLocal, today, type LocalDate, type LocalDateTime } from '../domain/dates';
import { fail } from '../domain/errors';
import { assertValidAmount, isSupportedCurrency } from '../domain/money';
import { occurrencesBetween } from '../domain/recurrence';
import type { Frequency, Id, RecurringKind, RecurringRule } from '../domain/types';
import { newId } from './ids';
import type { Db } from './sql';
import { createTransaction } from './transactions';

type Row = {
  id: string;
  name: string;
  kind: RecurringKind;
  amount_minor: number;
  currency: string;
  account_id: string | null;
  category_id: string | null;
  frequency: Frequency;
  interval_count: number;
  start_date: string;
  end_date: string | null;
  reminder_days_before: number | null;
  active: number;
  auto_post: number;
  auto_from: string | null;
};

const toRule = (r: Row): RecurringRule => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  amountMinor: r.amount_minor,
  currency: r.currency,
  accountId: r.account_id,
  categoryId: r.category_id,
  frequency: r.frequency,
  intervalCount: r.interval_count,
  startDate: r.start_date,
  endDate: r.end_date,
  reminderDaysBefore: r.reminder_days_before,
  active: r.active === 1,
  autoPost: r.auto_post === 1,
  autoFrom: r.auto_from,
});

export async function listRules(db: Db, options: { activeOnly?: boolean } = {}): Promise<RecurringRule[]> {
  const rows = await db.all<Row>(
    `SELECT * FROM recurring_rules WHERE deleted_at IS NULL ${options.activeOnly ? 'AND active = 1' : ''} ORDER BY active DESC, name`,
  );
  return rows.map(toRule);
}

export async function getRule(db: Db, id: Id): Promise<RecurringRule | null> {
  const row = await db.get<Row>('SELECT * FROM recurring_rules WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? toRule(row) : null;
}

export type RuleInput = Omit<RecurringRule, 'id' | 'autoFrom'>;

async function validateRule(tx: Db, input: RuleInput): Promise<void> {
  if (!input.name.trim()) fail('invalid_name');
  assertValidAmount(input.amountMinor);
  if (!isSupportedCurrency(input.currency)) fail('invalid_currency');
  if (!isValidDate(input.startDate)) fail('invalid_date');
  if (input.endDate && (!isValidDate(input.endDate) || input.endDate < input.startDate)) fail('invalid_date');
  if (!Number.isInteger(input.intervalCount) || input.intervalCount < 1) fail('invalid_input');
  if (input.accountId) {
    const account = await tx.get<{ currency: string }>('SELECT currency FROM accounts WHERE id = ?', [input.accountId]);
    if (!account) fail('not_found');
    if (account.currency !== input.currency) fail('currency_mismatch');
  }
  if (input.categoryId) {
    const category = await tx.get<{ kind: string }>('SELECT kind FROM categories WHERE id = ?', [input.categoryId]);
    if (!category) fail('not_found');
    if (category.kind !== input.kind) fail('category_kind_mismatch');
  }
  if (input.autoPost && (!input.accountId || !input.categoryId)) fail('rule_needs_details');
}

export async function saveRule(db: Db, id: Id | null, input: RuleInput): Promise<Id> {
  return db.transaction(async (tx) => {
    await validateRule(tx, input);
    const time = nowIso();
    const previous = id ? await getRule(tx, id) : null;
    // Automation only ever looks forward: switching it on never backfills past months.
    const autoFrom = input.autoPost ? (previous?.autoPost && previous.autoFrom ? previous.autoFrom : today()) : null;
    const values = [input.name.trim(), input.kind, input.amountMinor, input.currency, input.accountId, input.categoryId, input.frequency,
      input.intervalCount, input.startDate, input.endDate, input.reminderDaysBefore, input.active ? 1 : 0, input.autoPost ? 1 : 0, autoFrom];
    if (id) {
      const { changes } = await tx.run(
        `UPDATE recurring_rules SET name = ?, kind = ?, amount_minor = ?, currency = ?, account_id = ?, category_id = ?, frequency = ?,
          interval_count = ?, start_date = ?, end_date = ?, reminder_days_before = ?, active = ?, auto_post = ?, auto_from = ?, updated_at = ? WHERE id = ?`,
        [...values, time, id],
      );
      if (changes === 0) fail('not_found');
      return id;
    }
    const created = newId();
    await tx.run(
      `INSERT INTO recurring_rules (id, name, kind, amount_minor, currency, account_id, category_id, frequency, interval_count,
        start_date, end_date, reminder_days_before, active, auto_post, auto_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [created, ...values, time, time],
    );
    return created;
  });
}

export async function deleteRule(db: Db, id: Id): Promise<void> {
  await db.run('UPDATE recurring_rules SET deleted_at = ?, active = 0, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id]);
}

export async function setRuleActive(db: Db, id: Id, active: boolean): Promise<void> {
  await db.run('UPDATE recurring_rules SET active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, nowIso(), id]);
}

export type Occurrence = { rule: RecurringRule; dueDate: LocalDate; overdue: boolean };

/** Occurrences still awaiting a decision. Being listed here never means money has moved. */
export async function pendingOccurrences(db: Db, until: LocalDate): Promise<Occurrence[]> {
  const rules = await listRules(db, { activeOnly: true });
  const paid = await db.all<{ recurring_rule_id: string; recurring_due_date: string }>(
    `SELECT recurring_rule_id, recurring_due_date FROM transactions
     WHERE recurring_rule_id IS NOT NULL AND deleted_at IS NULL`,
  );
  const skips = await db.all<{ rule_id: string; due_date: string }>('SELECT rule_id, due_date FROM recurring_skips');
  const resolved = new Set([
    ...paid.map((p) => `${p.recurring_rule_id}|${p.recurring_due_date}`),
    ...skips.map((s) => `${s.rule_id}|${s.due_date}`),
  ]);
  const date = today();
  const result: Occurrence[] = [];
  for (const rule of rules) {
    // Occurrences from before automation was switched on are history, not a backlog.
    const from = rule.autoPost && rule.autoFrom ? rule.autoFrom : rule.startDate;
    for (const dueDate of occurrencesBetween(rule, from, until)) {
      if (!resolved.has(`${rule.id}|${dueDate}`)) result.push({ rule, dueDate, overdue: dueDate < date });
    }
  }
  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type ConfirmOptions = { accountId?: Id; amountMinor?: number; occurredAt?: LocalDateTime };

/**
 * Records that a planned occurrence really happened. Safe to call repeatedly: the idempotency
 * key is derived from the occurrence, and the uq_recurring_occurrence index is the backstop.
 */
export async function confirmOccurrence(db: Db, ruleId: Id, dueDate: LocalDate, options: ConfirmOptions = {}): Promise<Id> {
  return db.transaction(async (tx) => {
    const rule = await getRule(tx, ruleId);
    if (!rule) fail('not_found');
    const accountId = options.accountId ?? rule.accountId;
    if (!accountId) fail('invalid_input');
    if (!occurrencesBetween(rule, dueDate, dueDate).includes(dueDate)) fail('invalid_date');
    const live = await tx.get<{ id: string }>(
      'SELECT id FROM transactions WHERE recurring_rule_id = ? AND recurring_due_date = ? AND deleted_at IS NULL',
      [ruleId, dueDate],
    );
    if (live) return live.id;
    await tx.run('DELETE FROM recurring_skips WHERE rule_id = ? AND due_date = ?', [ruleId, dueDate]);
    return createTransaction(tx, {
      type: rule.kind,
      amountMinor: options.amountMinor ?? rule.amountMinor,
      accountId,
      categoryId: rule.categoryId,
      occurredAt: options.occurredAt ?? nowLocal(),
      description: rule.name,
      recurringRuleId: ruleId,
      recurringDueDate: dueDate,
    });
  });
}

export type AutoPosted = { rule: RecurringRule; dueDate: LocalDate; transactionId: Id };

const autoKey = (ruleId: Id, dueDate: LocalDate) => `auto:${ruleId}:${dueDate}`;

/**
 * Records every automatic occurrence that has come due, dated on its due date, so several missed
 * months catch up correctly. Safe to run on every app open and from several tabs.
 *
 * The key survives a soft delete, which is how this respects the person's decision: an automatic
 * payment they deleted stays deleted and waits in the review queue instead of coming back.
 * A rule that cannot post (say, its account was archived) stays pending and blocks nothing else.
 */
export async function postDueOccurrences(db: Db, date: LocalDate = today()): Promise<AutoPosted[]> {
  const posted: AutoPosted[] = [];
  const rules = (await listRules(db, { activeOnly: true })).filter((r) => r.autoPost && r.autoFrom && r.accountId);
  for (const rule of rules) {
    for (const dueDate of occurrencesBetween(rule, rule.autoFrom as LocalDate, date)) {
      const key = autoKey(rule.id, dueDate);
      const handled = await db.get(
        `SELECT 1 FROM transactions WHERE idempotency_key = ?
           OR (recurring_rule_id = ? AND recurring_due_date = ? AND deleted_at IS NULL)
         UNION ALL SELECT 1 FROM recurring_skips WHERE rule_id = ? AND due_date = ?`,
        [key, rule.id, dueDate, rule.id, dueDate],
      );
      if (handled) continue;
      try {
        const transactionId = await createTransaction(db, {
          type: rule.kind,
          amountMinor: rule.amountMinor,
          accountId: rule.accountId as Id,
          categoryId: rule.categoryId,
          occurredAt: `${dueDate}T09:00`,
          description: rule.name,
          recurringRuleId: rule.id,
          recurringDueDate: dueDate,
          idempotencyKey: key,
        });
        posted.push({ rule, dueDate, transactionId });
      } catch {
        break;
      }
    }
  }
  return posted;
}

export async function skipOccurrence(db: Db, ruleId: Id, dueDate: LocalDate): Promise<void> {
  await db.run('INSERT OR IGNORE INTO recurring_skips (rule_id, due_date) VALUES (?, ?)', [ruleId, dueDate]);
}
