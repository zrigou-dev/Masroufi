# Architecture

Read this before changing how money is stored or calculated.

## Layers

```
src/domain/    Pure rules: money, dates, ledger legs, debt state, recurrence, budgets, goals, insights.
               No I/O. Every decision about money that can be pure lives here.
src/data/      SQLite: schema, migrations, repositories, backup, exports, the calculation layer.
src/platform/  Device APIs: database file, files, notifications, PIN and biometrics, printing.
src/state/     App context, useQuery, background sync.
src/ui/        Design tokens and shared components.
src/i18n/      Arabic, English, French. A missing key is a compile error.
src/app/       Expo Router screens. These display; they never add up money.
```

State management is deliberately small. SQLite is the source of truth, and `useQuery` re-reads whenever the
database reports a change, so every open screen stays correct after any write without a client-side store.

## Accounting model

A **transaction** is a business event. Each one owns **ledger entries**: signed amounts on specific accounts.

| Type | Legs | Income | Spending | Debt |
|---|---|---|---|---|
| `opening_balance`, `adjustment` | one, either sign | | | |
| `income` | + | adds | | |
| `expense` | − | | adds | |
| `refund` | + | | reduces | |
| `transfer` | − source, + target | | | |
| `debt_borrowed` | + | | | liability rises |
| `debt_lent` | − | | | receivable rises |
| `debt_repayment` | − | | | liability falls |
| `debt_collection` | + | | | receivable falls |
| `reversal` | negation of the original's legs | undoes it | undoes it | undoes it |

`buildLegs` in `src/domain/ledger.ts` is the single definition of how an event moves money.

This is a typed single-entry ledger, not full double entry. Only a same-currency transfer sums to zero: an expense
leaves the tracked accounts, so it has no balancing leg. Integrity comes from `verifyLedger`, which recomputes what
every transaction's legs must be and compares them with what is stored. It runs before every restore commits, and
after each test.

### The rules that keep the books right

- **No balance is stored anywhere.** A balance is the sum of an account's live legs, so it cannot drift from history.
- **One set of formulas.** `v_account_balances`, `v_cash_flow` and `v_debt_paid` in `src/data/migrations.ts` are the
  only definitions. `src/data/finance.ts` reads them for the dashboard, reports, budgets and insights alike.
- **Money is integer minor units.** Amounts are parsed by string arithmetic. Input that cannot be read exactly is
  refused rather than rounded, including the ambiguous `1.250`.
- **Currencies are never summed.** Every total is per currency.
- **Dates are local wall-clock strings** compared lexically, never converted through UTC, so an expense at 23:30
  on the 31st stays in that month. Only audit timestamps are UTC.
- **Writes are atomic.** All database access goes through one queue, so unrelated async work cannot enter another
  operation's transaction. A consequence: inside `db.transaction(fn)`, use only the `tx` handle. Using the outer `db`
  there deadlocks.

### Definitions

- **Owned money:** the sum of account balances. Archived accounts count, because archiving hides an account; it does
  not make money disappear.
- **Net position:** owned money + receivables − liabilities. An overpaid debt moves to the opposite side, because the
  excess is now owed back, which keeps net position conserved.
- **Available to spend:** liquid accounts − outgoing obligations in the horizon (overdue ones included) − money
  earmarked for manual goals. Expected income is not added. Budgets are not subtracted, since a budget is a limit and
  not a commitment; subtracting one would count the same money twice. Accounts linked to a goal are left out.

### Corrections

| Action | Effect | Use for |
|---|---|---|
| Edit | Rewrites the event and its legs | Fixing a mistake |
| Delete | Soft delete, so undo is exact | Removing a mistake |
| Reverse | Keeps the original, books its opposite on today's date | A correction that should stay visible |
| Reconcile | Posts the difference as an `adjustment` | Matching a real statement |

Opening balances and debt principal are managed by their account or debt, and cannot be deleted on their own. Anything
a reversal or refund depends on is protected until that dependency is removed.

### Debts

Payments are ordinary transactions linked to the debt, not rows attached to installments. Installment coverage is
derived by allocating payments oldest-first each time state is computed, so rewriting a schedule cannot alter a
recorded payment. A schedule must add up exactly to the debt: rewriting freezes what is already paid, and the new
lines must equal the remaining balance. Closing (cancel or write-off) stops the balance counting and keeps all history
in `debt_events`.

### Recurring payments

Rules generate planned occurrences on demand, always computed from the start date so month-end clamping cannot drift.
Nothing moves until a person confirms. A partial unique index on `(recurring_rule_id, recurring_due_date)` for live
transactions makes a duplicate payment impossible at the database level, however often the app opens.

Rules with `auto_post` record themselves: `postDueOccurrences` runs when the app opens and after writes, dating each
payment on its due date, so months away catch up correctly. `auto_from` means switching automation on never backfills
the past. Each automatic payment has a derived idempotency key that survives soft delete, which is how a payment the
person deleted stays deleted: it does not come back, and it waits in the review queue.

### Learning from habits

There is no separate store for this. `src/domain/suggestions.ts` derives everything on demand from transactions already
in SQLite, weighting recent entries (45-day half-life) and those near the current hour. That means it cannot drift from
the data, it travels in every backup, and correcting a transaction corrects what was learned. Automatic, one-off and
reversed entries are excluded. Only expenses become learned one-tap buttons, because a stray tap must not record income.

Saved `templates` are the explicit counterpart. A one-tap entry is keyed to the item and the minute, so a double tap
counts once while the same coffee later counts again.

### Double taps

Each opened form holds one idempotency key, and `transactions.idempotency_key` is unique, so repeated submits return
the first result. The save button also locks while busy, and same-day identical entries prompt a warning.

### Regular and occasional

`getMoneyFlow` puts every dirham in exactly one bucket. Spending is recurring (has a rule), occasional (flagged by the
person) or everyday. Income is regular (has a rule, or is filed under Salary) or additional. Subcategories are one level
deep and roll up to their parent in reports, filters and budgets.

### Compound events

`src/data/compound.ts` turns one action into two entries atomically. A split bill is an expense for my share plus a loan
for theirs, and a withdrawal fee is a transfer plus an expense.

### Comparisons

`comparableRanges` compares a running period with the same number of days of the one before, so the 10th of a month
is never measured against all of last month.

## Backups

The file carries a format version, schema version, per-table counts and a SHA-256 checksum. `parseBackup` validates all
of that before touching the database. `restoreBackup` then swaps everything inside one SQLite transaction and checks
foreign keys and the ledger before commit, so any failure rolls back to the data as it was.

The checksum detects damage, not tampering. Encrypted backups use AES-256-GCM (`@noble/ciphers`) with a scrypt-derived
key (`@noble/hashes`, N=2^15, r=8, p=1). The KDF parameters are authenticated with the data, and limits are checked
before any work, because a backup file is untrusted input. The scrypt cost has not been timed on a real phone: if
export feels too slow, the parameters travel in each file, so they can be changed without breaking old backups.

A table added after schema 1 is listed in `ADDED_IN`, so an older backup that lacks it restores with that table empty.
Daily copies (`src/platform/autoBackup.ts`, last 7 days) use files on native and IndexedDB on web.

Device settings (the lock, reminders, last backup date) are excluded, because restoring must not enable a lock whose
PIN is on another phone.

## Changing the schema

1. Append a migration to `MIGRATIONS` in `src/data/migrations.ts`. Never edit an existing one.
2. A new table goes in `TABLES` and `ADDED_IN` in `src/data/backup.ts`. A new column needs a default, so older backups
   still restore. A backup from a newer schema is refused.
3. Add a test that upgrades a populated database.

## Decisions worth revisiting

- **`INTERNET` stays in the Android manifest.** Expo includes it and it is needed for development builds. The app
  makes no network calls (`__tests__/finance/privacy.test.ts` enforces this), but the OS does not. Blocking it in
  production builds would make that guarantee OS-level, once it can be tested on a device.
- **Android Auto Backup is off** (`allowBackup: false`), so financial data does not go to a cloud account. The cost is
  that a new phone starts empty without a manual backup.

## Verification status

**Verified on this codebase:** type check, lint, Jest, the Hermes Android release bundle (`expo export`), `expo-doctor`,
Android native config generation (`expo prebuild`), and the full UI journeys in Chrome against the real app with
SQLite running in WebAssembly.

**Not yet run on a device or emulator:** no native Android or iOS build has been executed. These code paths are written
against the installed SDK's type definitions but have never executed:

- `expo-sqlite`'s native driver. The SQL itself is verified, since web and tests use real SQLite.
- Forcing RTL, and the reload that applies it (`applyDirection` in `src/state/app.tsx`).
- The native header's back arrow direction. Web shows it unmirrored; native stacks handle this themselves.
- File export and the share sheet, the file picker, and PDF output.
- App lock: SecureStore, the PIN flow, biometrics.
- Local notifications, and the daily evening reminder.
- Daily safety copies on the file system. The web version is what has been exercised.
- Keyboard avoidance: `Screen` keeps the Save button above the keyboard, but the offsets need checking on a phone.

Check these first on the first device build. A backup and restore cycle is a useful test of the books too, because
`verifyLedger` refuses to commit a restore if they disagree.
