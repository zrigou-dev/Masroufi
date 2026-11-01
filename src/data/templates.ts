import { nowIso, nowLocal } from '../domain/dates';
import { fail } from '../domain/errors';
import { assertValidAmount } from '../domain/money';
import { categoryScores, preferredAccounts, rankSuggestions, type HistoryItem, type Suggestion } from '../domain/suggestions';
import type { Id, Template } from '../domain/types';
import { newId } from './ids';
import type { Db } from './sql';
import { createTransaction } from './transactions';

type Row = {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  amount_minor: number | null;
  account_id: string;
  category_id: string;
  description: string | null;
};

const toTemplate = (r: Row): Template => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  amountMinor: r.amount_minor,
  accountId: r.account_id,
  categoryId: r.category_id,
  description: r.description,
});

export async function listTemplates(db: Db): Promise<Template[]> {
  const rows = await db.all<Row>(
    `SELECT t.* FROM templates t
     JOIN accounts a ON a.id = t.account_id AND a.archived_at IS NULL
     JOIN categories c ON c.id = t.category_id AND c.archived_at IS NULL
     ORDER BY t.sort_order, t.created_at`,
  );
  return rows.map(toTemplate);
}

export type TemplateInput = Omit<Template, 'id'>;

export async function saveTemplate(db: Db, id: Id | null, input: TemplateInput): Promise<Id> {
  if (!input.name.trim()) fail('invalid_name');
  if (input.amountMinor !== null) assertValidAmount(input.amountMinor);
  return db.transaction(async (tx) => {
    const time = nowIso();
    const values = [input.name.trim(), input.kind, input.amountMinor, input.accountId, input.categoryId, input.description?.trim() || null];
    if (id) {
      const { changes } = await tx.run(
        'UPDATE templates SET name = ?, kind = ?, amount_minor = ?, account_id = ?, category_id = ?, description = ?, updated_at = ? WHERE id = ?',
        [...values, time, id],
      );
      if (changes === 0) fail('not_found');
      return id;
    }
    const created = newId();
    const order = await tx.get<{ next: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM templates');
    await tx.run(
      `INSERT INTO templates (id, name, kind, amount_minor, account_id, category_id, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [created, ...values, order?.next ?? 1, time, time],
    );
    return created;
  });
}

export async function deleteTemplate(db: Db, id: Id): Promise<void> {
  await db.run('DELETE FROM templates WHERE id = ?', [id]);
}

const HISTORY_LIMIT = 800;

/**
 * Everyday habits only. Automatic payments already look after themselves, and occasional or
 * reversed entries are exactly what should not be suggested again.
 */
export async function loadHistory(db: Db): Promise<HistoryItem[]> {
  const rows = await db.all<{ type: 'income' | 'expense'; description: string | null; category_id: string; account_id: string; amount_minor: number; currency: string; occurred_at: string }>(
    `SELECT t.type, t.description, t.category_id, t.account_id, t.amount_minor, t.currency, t.occurred_at
     FROM transactions t
     JOIN categories c ON c.id = t.category_id AND c.archived_at IS NULL
     JOIN accounts a ON a.id = t.account_id AND a.archived_at IS NULL
     WHERE t.type IN ('income','expense') AND t.deleted_at IS NULL AND t.occasional = 0 AND t.recurring_rule_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.reversal_of_id = t.id AND r.deleted_at IS NULL)
     ORDER BY t.occurred_at DESC LIMIT ?`,
    [HISTORY_LIMIT],
  );
  return rows.map((r) => ({
    kind: r.type,
    description: r.description,
    categoryId: r.category_id,
    accountId: r.account_id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    occurredAt: r.occurred_at,
  }));
}

export type QuickItem = {
  key: string;
  label: string | null;
  kind: 'income' | 'expense';
  amountMinor: number | null;
  currency: string;
  accountId: Id;
  categoryId: Id;
  description: string | null;
  /** Enough is known to record it with a single tap. */
  oneTap: boolean;
  pinned: boolean;
};

const fromSuggestion = (s: Suggestion): QuickItem => ({
  key: s.key,
  label: s.description,
  kind: s.kind,
  amountMinor: s.amountMinor,
  currency: s.currency,
  accountId: s.accountId,
  categoryId: s.categoryId,
  description: s.description,
  oneTap: s.stableAmount,
  pinned: false,
});

/** Saved buttons first, then what the person's own history says they are likely to do now. */
export async function getQuickItems(db: Db, limit = 8, now = nowLocal()): Promise<QuickItem[]> {
  const templates = await listTemplates(db);
  const accounts = await db.all<{ id: string; currency: string }>('SELECT id, currency FROM accounts');
  const currencyOf = (id: Id) => accounts.find((a) => a.id === id)?.currency ?? 'MAD';
  const pinned: QuickItem[] = templates.map((t) => ({
    key: `template:${t.id}`,
    label: t.name,
    kind: t.kind,
    amountMinor: t.amountMinor,
    currency: currencyOf(t.accountId),
    accountId: t.accountId,
    categoryId: t.categoryId,
    description: t.description,
    oneTap: t.amountMinor !== null,
    pinned: true,
  }));
  const taken = new Set(templates.map((t) => `${t.categoryId}|${t.description ?? ''}`));
  // Learned buttons are spending only: a stray tap must never record a salary.
  const suggested = rankSuggestions(await loadHistory(db), now, { kind: 'expense', limit })
    .filter((s) => !taken.has(`${s.categoryId}|${s.description ?? ''}`))
    .map(fromSuggestion);
  return [...pinned, ...suggested].slice(0, limit);
}

/**
 * One tap, one transaction. Keyed to the item and the minute, so an accidental double tap counts
 * once, while the same coffee later on counts again.
 */
export async function recordQuickItem(db: Db, item: QuickItem, now = nowLocal()): Promise<Id> {
  if (item.amountMinor === null) fail('invalid_amount');
  return createTransaction(db, {
    type: item.kind,
    amountMinor: item.amountMinor,
    accountId: item.accountId,
    categoryId: item.categoryId,
    description: item.description ?? undefined,
    occurredAt: now,
    idempotencyKey: `quick:${item.key}:${now}`,
  });
}

export type EntryHints = {
  history: HistoryItem[];
  categoryScores: { income: Map<string, number>; expense: Map<string, number> };
  accountByCategory: Map<string, string>;
};

export async function getEntryHints(db: Db, now = nowLocal()): Promise<EntryHints> {
  const history = await loadHistory(db);
  return {
    history,
    categoryScores: { income: categoryScores(history, now, 'income'), expense: categoryScores(history, now, 'expense') },
    accountByCategory: preferredAccounts(history),
  };
}

export async function knownCounterparties(db: Db, limit = 6): Promise<string[]> {
  const rows = await db.all<{ counterparty: string }>(
    `SELECT counterparty FROM debts WHERE deleted_at IS NULL GROUP BY counterparty ORDER BY MAX(created_at) DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => r.counterparty);
}
