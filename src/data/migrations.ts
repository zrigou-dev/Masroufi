import type { Db } from './sql';

export type Migration = { version: number; name: string; up: string };

const initialSchema = `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  type TEXT NOT NULL CHECK (type IN ('bank','cash','savings','other')),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  description TEXT,
  is_liquid INTEGER NOT NULL DEFAULT 1 CHECK (is_liquid IN (0,1)),
  created_on TEXT NOT NULL,
  archived_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  nature TEXT CHECK (nature IN ('essential','discretionary')),
  archived_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE debts (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('i_owe','owed_to_me')),
  counterparty TEXT NOT NULL CHECK (length(trim(counterparty)) > 0),
  principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
  fees_minor INTEGER NOT NULL DEFAULT 0 CHECK (fees_minor >= 0),
  interest_rate_bps INTEGER CHECK (interest_rate_bps IS NULL OR interest_rate_bps >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  start_date TEXT NOT NULL,
  due_date TEXT,
  description TEXT,
  reference_notes TEXT,
  closure TEXT NOT NULL DEFAULT 'active' CHECK (closure IN ('active','cancelled','written_off')),
  priority INTEGER NOT NULL DEFAULT 0,
  opening_transaction_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('opening_balance','income','expense','transfer','debt_borrowed',
    'debt_lent','debt_repayment','debt_collection','refund','adjustment','reversal')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  occurred_at TEXT NOT NULL CHECK (length(occurred_at) = 16),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id TEXT REFERENCES accounts(id),
  to_amount_minor INTEGER CHECK (to_amount_minor IS NULL OR to_amount_minor > 0),
  to_currency TEXT,
  direction TEXT CHECK (direction IN ('in','out')),
  category_id TEXT REFERENCES categories(id),
  debt_id TEXT REFERENCES debts(id),
  description TEXT,
  notes TEXT,
  counterparty TEXT,
  reversal_of_id TEXT REFERENCES transactions(id),
  related_transaction_id TEXT REFERENCES transactions(id),
  is_overpayment INTEGER NOT NULL DEFAULT 0 CHECK (is_overpayment IN (0,1)),
  recurring_rule_id TEXT,
  recurring_due_date TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK ((type = 'transfer') = (to_account_id IS NOT NULL)),
  CHECK (to_account_id IS NULL OR to_account_id <> account_id),
  CHECK ((type IN ('opening_balance','adjustment')) = (direction IS NOT NULL)),
  CHECK ((type = 'reversal') = (reversal_of_id IS NOT NULL)),
  CHECK (type NOT IN ('debt_borrowed','debt_lent','debt_repayment','debt_collection') OR debt_id IS NOT NULL)
);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3)
);

CREATE TABLE transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  tag TEXT NOT NULL CHECK (length(trim(tag)) > 0),
  PRIMARY KEY (transaction_id, tag)
) WITHOUT ROWID;

CREATE TABLE installments (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id),
  due_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0)
);

CREATE TABLE debt_events (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id),
  kind TEXT NOT NULL CHECK (kind IN ('created','updated','cancelled','written_off','reopened','schedule_changed')),
  amount_minor INTEGER,
  note TEXT,
  at TEXT NOT NULL
);

CREATE TABLE recurring_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  account_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  start_date TEXT NOT NULL,
  end_date TEXT,
  reminder_days_before INTEGER CHECK (reminder_days_before IS NULL OR reminder_days_before >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE recurring_skips (
  rule_id TEXT NOT NULL REFERENCES recurring_rules(id),
  due_date TEXT NOT NULL,
  PRIMARY KEY (rule_id, due_date)
) WITHOUT ROWID;

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  period TEXT NOT NULL CHECK (period IN ('monthly','custom')),
  start_date TEXT,
  end_date TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  category_id TEXT REFERENCES categories(id),
  account_id TEXT REFERENCES accounts(id),
  thresholds TEXT NOT NULL DEFAULT '[70,85,100]',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (period <> 'custom' OR (start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= end_date))
);

CREATE TABLE budget_alerts (
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (budget_id, period_key, threshold)
) WITHOUT ROWID;

CREATE TABLE savings_goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  target_minor INTEGER NOT NULL CHECK (target_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  target_date TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('manual','account')),
  linked_account_id TEXT REFERENCES accounts(id),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((mode = 'account') = (linked_account_id IS NOT NULL))
);

CREATE TABLE goal_allocations (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  allocated_on TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_tx_occurred ON transactions(occurred_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_account ON transactions(account_id, occurred_at);
CREATE INDEX idx_tx_category ON transactions(category_id, occurred_at);
CREATE INDEX idx_tx_debt ON transactions(debt_id);
CREATE INDEX idx_tx_related ON transactions(related_transaction_id);
CREATE INDEX idx_ledger_tx ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_account ON ledger_entries(account_id);
CREATE INDEX idx_installments_debt ON installments(debt_id, due_date);
CREATE INDEX idx_events_debt ON debt_events(debt_id, at);
CREATE INDEX idx_alloc_goal ON goal_allocations(goal_id);

-- One live reversal per transaction, one live payment per recurring occurrence,
-- and one goal per linked account (so the same money cannot fill two goals).
CREATE UNIQUE INDEX uq_one_reversal ON transactions(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_recurring_occurrence ON transactions(recurring_rule_id, recurring_due_date)
  WHERE recurring_rule_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_goal_account ON savings_goals(linked_account_id)
  WHERE linked_account_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER ledger_currency_must_match_account
BEFORE INSERT ON ledger_entries
WHEN (SELECT currency FROM accounts WHERE id = NEW.account_id) IS NOT NEW.currency
BEGIN
  SELECT RAISE(ABORT, 'ledger entry currency differs from account currency');
END;

CREATE TRIGGER account_currency_locked
BEFORE UPDATE OF currency ON accounts
WHEN NEW.currency <> OLD.currency AND EXISTS (SELECT 1 FROM ledger_entries WHERE account_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'account currency cannot change once it has entries');
END;

-- The only definitions of balance, income, spending and debt paid. Dashboard, reports and
-- budgets all read these, so they cannot disagree.
CREATE VIEW v_account_balances AS
SELECT a.id AS account_id, a.currency AS currency,
       COALESCE(SUM(CASE WHEN t.deleted_at IS NULL THEN e.amount_minor END), 0) AS balance_minor
FROM accounts a
LEFT JOIN ledger_entries e ON e.account_id = a.id
LEFT JOIN transactions t ON t.id = e.transaction_id
GROUP BY a.id;

CREATE VIEW v_cash_flow AS
SELECT t.id AS transaction_id,
       substr(t.occurred_at, 1, 10) AS day,
       t.currency AS currency,
       t.account_id AS account_id,
       t.category_id AS category_id,
       CASE
         WHEN t.type = 'income' THEN t.amount_minor
         WHEN t.type = 'reversal' AND o.type = 'income' THEN -t.amount_minor
         ELSE 0
       END AS income_minor,
       CASE
         WHEN t.type = 'expense' THEN t.amount_minor
         WHEN t.type = 'refund' THEN -t.amount_minor
         WHEN t.type = 'reversal' AND o.type = 'expense' THEN -t.amount_minor
         WHEN t.type = 'reversal' AND o.type = 'refund' THEN t.amount_minor
         ELSE 0
       END AS expense_minor
FROM transactions t
LEFT JOIN transactions o ON o.id = t.reversal_of_id
WHERE t.deleted_at IS NULL
  AND (t.type IN ('income','expense','refund')
       OR (t.type = 'reversal' AND o.type IN ('income','expense','refund')));

CREATE VIEW v_debt_paid AS
SELECT d.id AS debt_id,
       COALESCE(SUM(CASE
         WHEN t.deleted_at IS NOT NULL THEN 0
         WHEN t.type IN ('debt_repayment','debt_collection') THEN t.amount_minor
         WHEN t.type = 'reversal' THEN -t.amount_minor
         ELSE 0
       END), 0) AS paid_minor
FROM debts d
LEFT JOIN transactions t ON t.debt_id = d.id
GROUP BY d.id;
`;

const habitsAndAutomation = `
ALTER TABLE transactions ADD COLUMN occasional INTEGER NOT NULL DEFAULT 0 CHECK (occasional IN (0,1));
ALTER TABLE categories ADD COLUMN parent_id TEXT REFERENCES categories(id);
ALTER TABLE categories ADD COLUMN expires_on TEXT;
ALTER TABLE recurring_rules ADD COLUMN auto_post INTEGER NOT NULL DEFAULT 0 CHECK (auto_post IN (0,1));
ALTER TABLE recurring_rules ADD COLUMN auto_from TEXT;

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor > 0),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_categories_parent ON categories(parent_id);

DROP VIEW v_cash_flow;

-- A reversal inherits how its original was classified, so it cancels it in the same bucket.
CREATE VIEW v_cash_flow AS
SELECT t.id AS transaction_id,
       substr(t.occurred_at, 1, 10) AS day,
       t.currency AS currency,
       t.account_id AS account_id,
       t.category_id AS category_id,
       COALESCE(o.occasional, t.occasional) AS occasional,
       COALESCE(o.recurring_rule_id, t.recurring_rule_id) AS rule_id,
       CASE
         WHEN t.type = 'income' THEN t.amount_minor
         WHEN t.type = 'reversal' AND o.type = 'income' THEN -t.amount_minor
         ELSE 0
       END AS income_minor,
       CASE
         WHEN t.type = 'expense' THEN t.amount_minor
         WHEN t.type = 'refund' THEN -t.amount_minor
         WHEN t.type = 'reversal' AND o.type = 'expense' THEN -t.amount_minor
         WHEN t.type = 'reversal' AND o.type = 'refund' THEN t.amount_minor
         ELSE 0
       END AS expense_minor
FROM transactions t
LEFT JOIN transactions o ON o.id = t.reversal_of_id
WHERE t.deleted_at IS NULL
  AND (t.type IN ('income','expense','refund')
       OR (t.type = 'reversal' AND o.type IN ('income','expense','refund')));
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial_schema', up: initialSchema },
  { version: 2, name: 'habits_and_automation', up: habitsAndAutomation },
];

export const SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

/** Applies pending migrations, each in its own transaction, so a crash leaves a clean version. */
export async function migrate(db: Db, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const rows = await db.all<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const newest = Math.max(0, ...migrations.map((m) => m.version));
  const current = Math.max(0, ...applied);
  if (current > newest) {
    throw new Error(`Database schema ${current} is newer than this app supports (${newest})`);
  }

  const ran: number[] = [];
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(migration.up);
      await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        new Date().toISOString(),
      ]);
    });
    ran.push(migration.version);
  }
  return ran;
}
