import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { nowIso } from '../domain/dates';
import { fail, FinanceError } from '../domain/errors';
import { seedDefaultCategories } from './categories';
import { verifyLedger } from './integrity';
import { SCHEMA_VERSION } from './migrations';
import type { Db, SqlValue } from './sql';

export const BACKUP_FORMAT = 'masroufi-backup';
export const BACKUP_FORMAT_VERSION = 1;

/** In dependency order: parents first. Deletion runs in reverse. */
const TABLES = [
  'accounts', 'categories', 'debts', 'transactions', 'ledger_entries', 'transaction_tags', 'installments',
  'debt_events', 'recurring_rules', 'recurring_skips', 'budgets', 'budget_alerts', 'savings_goals',
  'goal_allocations', 'templates', 'settings',
] as const;

/** Tables newer than schema 1. An older backup legitimately lacks them, and they restore empty. */
const ADDED_IN: Partial<Record<(typeof TABLES)[number], number>> = { templates: 2 };

const tablesIn = (schemaVersion: number) => TABLES.filter((table) => (ADDED_IN[table] ?? 1) <= schemaVersion);

/** Bound to this device: restoring must not turn on a lock whose PIN is not here. */
const DEVICE_SETTINGS = ['lockEnabled', 'lastBackupAt', 'lastAutoBackupOn', 'remindersEnabled', 'dailyNudge', 'rtlAttempt'];

type Row = Record<string, SqlValue>;
type Tables = Record<string, Row[]>;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  createdAt: string;
  counts: Record<string, number>;
  checksum: string;
  tables: Tables;
};

const checksumOf = (tables: Tables) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(tables))));

export async function createBackup(db: Db): Promise<BackupFile> {
  return db.transaction(async (tx) => {
    const tables: Tables = {};
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      let rows = await tx.all<Row>(`SELECT * FROM ${table}`);
      if (table === 'settings') rows = rows.filter((r) => !DEVICE_SETTINGS.includes(String(r.key)));
      tables[table] = rows;
      counts[table] = rows.length;
    }
    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIso(),
      counts,
      checksum: checksumOf(tables),
      tables,
    };
  });
}

export const serializeBackup = (backup: BackupFile): string => JSON.stringify(backup);

export type BackupSummary = {
  createdAt: string;
  schemaVersion: number;
  accounts: number;
  transactions: number;
  debts: number;
};

/** Everything that can be checked without touching the database. Throws before any change. */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('backup_corrupt');
  }
  const file = parsed as Partial<BackupFile> | null;
  if (typeof file !== 'object' || file === null || file.format !== BACKUP_FORMAT) fail('backup_invalid');
  if (typeof file.formatVersion !== 'number' || file.formatVersion > BACKUP_FORMAT_VERSION) fail('backup_newer');
  if (typeof file.schemaVersion !== 'number' || !Number.isInteger(file.schemaVersion) || file.schemaVersion < 1) fail('backup_invalid');
  if (file.schemaVersion > SCHEMA_VERSION) fail('backup_newer');
  if (typeof file.tables !== 'object' || file.tables === null || typeof file.counts !== 'object' || file.counts === null) fail('backup_corrupt');
  if (typeof file.createdAt !== 'string' || typeof file.checksum !== 'string') fail('backup_corrupt');

  const tables = file.tables;
  for (const table of tablesIn(file.schemaVersion)) {
    if (!Array.isArray(tables[table])) fail('backup_corrupt');
    if (file.counts[table] !== tables[table].length) fail('backup_corrupt');
  }
  if (checksumOf(tables) !== file.checksum) fail('backup_corrupt');
  return file as BackupFile;
}

export function summarizeBackup(backup: BackupFile): BackupSummary {
  return {
    createdAt: backup.createdAt,
    schemaVersion: backup.schemaVersion,
    accounts: backup.counts.accounts,
    transactions: backup.counts.transactions,
    debts: backup.counts.debts,
  };
}

async function deleteAll(tx: Db, keepDeviceSettings: boolean): Promise<void> {
  for (const table of [...TABLES].reverse()) {
    if (table === 'settings' && keepDeviceSettings) {
      await tx.run(`DELETE FROM settings WHERE key NOT IN (${DEVICE_SETTINGS.map(() => '?').join(', ')})`, DEVICE_SETTINGS);
    } else {
      await tx.run(`DELETE FROM ${table}`);
    }
  }
}

/**
 * All-or-nothing: the swap is one SQLite transaction, checked for referential and ledger
 * integrity before commit. Any failure rolls back to the data as it was.
 */
export async function restoreBackup(db: Db, backup: BackupFile): Promise<void> {
  await db.transaction(async (tx) => {
    // transactions reference each other, so foreign keys are verified at the end, not per row.
    await tx.exec('PRAGMA defer_foreign_keys = ON');
    await deleteAll(tx, true);

    for (const table of TABLES) {
      const info = await tx.all<{ name: string }>(`PRAGMA table_info(${table})`);
      const allowed = new Set(info.map((c) => c.name));
      for (const row of backup.tables[table] ?? []) {
        if (typeof row !== 'object' || row === null) fail('backup_corrupt');
        const columns = Object.keys(row);
        if (columns.length === 0 || columns.some((c) => !allowed.has(c))) fail('backup_corrupt');
        const verb = table === 'settings' ? 'INSERT OR REPLACE' : 'INSERT';
        try {
          await tx.run(
            `${verb} INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            columns.map((c) => row[c]),
          );
        } catch {
          fail('backup_corrupt');
        }
      }
    }

    const brokenLinks = await tx.all('PRAGMA foreign_key_check');
    if (brokenLinks.length > 0) fail('backup_corrupt');
    const problems = await verifyLedger(tx);
    if (problems.length > 0) fail('backup_corrupt');
    await seedDefaultCategories(tx);
  }).catch((error: unknown) => {
    if (error instanceof FinanceError) throw error;
    fail('backup_corrupt');
  });
}

export async function resetAllData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec('PRAGMA defer_foreign_keys = ON');
    await deleteAll(tx, false);
    await seedDefaultCategories(tx);
  });
}
