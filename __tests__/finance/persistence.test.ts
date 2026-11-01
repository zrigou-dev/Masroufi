import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAccount, getAccount, listAccounts } from '../../src/data/accounts';
import { createBackup, parseBackup, restoreBackup, serializeBackup, summarizeBackup, resetAllData, type BackupFile } from '../../src/data/backup';
import { decryptBackup, encryptBackup, fromBase64, isEncryptedBackup, toBase64 } from '../../src/data/backupCrypto';
import { saveBudget, listBudgets } from '../../src/data/budgets';
import { seedDefaultCategories, listCategories, saveCategory, setCategoryArchived } from '../../src/data/categories';
import { createDebt, getDebt, equalSchedule } from '../../src/data/debts';
import { loadDemoData } from '../../src/data/demo';
import { exportAccountsCsv, exportDebtsCsv, exportTransactionsCsv } from '../../src/data/exports';
import { getCashFlow, getPositions, getSpendingSplit } from '../../src/data/finance';
import { addAllocation, listGoals, saveGoal } from '../../src/data/goals';
import { getInsights } from '../../src/data/insights';
import { verifyLedger } from '../../src/data/integrity';
import { migrate, MIGRATIONS, SCHEMA_VERSION } from '../../src/data/migrations';
import { saveRule, pendingOccurrences } from '../../src/data/recurring';
import { loadSettings, saveSetting } from '../../src/data/settings';
import { createDb, type DbWithEvents } from '../../src/data/sql';
import { createTransaction, listTransactions } from '../../src/data/transactions';
import { setClock } from '../../src/domain/dates';
import { randomBytes } from 'node:crypto';
import { nodeBackend, openTestDb } from '../helpers/testDb';

const at = '2026-06-15T12:00';
let db: DbWithEvents;

beforeEach(async () => {
  setClock(() => new Date(2026, 5, 20, 10, 0));
  db = await openTestDb();
});

afterEach(() => setClock(null));

async function populate(target: DbWithEvents) {
  const bank = await createAccount(target, { name: 'البنك الشعبي', type: 'bank', currency: 'MAD', openingBalanceMinor: 1_000_000, createdOn: '2026-01-01' });
  const euro = await createAccount(target, { name: 'Compte €', type: 'bank', currency: 'EUR', openingBalanceMinor: 50_000, createdOn: '2026-01-01' });
  const debt = await createDebt(target, {
    direction: 'i_owe', counterparty: 'أحمد', principalMinor: 300_000, currency: 'MAD', startDate: '2026-02-01', accountId: bank,
    schedule: equalSchedule(300_000, 3, '2026-07-01'),
  });
  await createTransaction(target, { type: 'debt_repayment', debtId: debt, amountMinor: 100_000, accountId: bank, occurredAt: at });
  await createTransaction(target, { type: 'transfer', amountMinor: 11_000, accountId: bank, toAccountId: euro, toAmountMinor: 1_000, occurredAt: at });
  await createTransaction(target, { type: 'expense', amountMinor: 4_500, accountId: bank, categoryId: 'cat_restaurants', occurredAt: at, tags: ['عائلة', 'سفر'], notes: 'سطر\nثانٍ, "مقتبس"' });
  const custom = await saveCategory(target, null, { name: 'حيوانات', kind: 'expense', icon: 'paw-outline', color: '#123456', nature: null });
  await createTransaction(target, { type: 'expense', amountMinor: 900, accountId: bank, categoryId: custom, occurredAt: at });
  await saveRule(target, null, { name: 'الإيجار', kind: 'expense', amountMinor: 280_000, currency: 'MAD', accountId: bank, categoryId: 'cat_housing', frequency: 'monthly', intervalCount: 1, startDate: '2026-07-01', endDate: null, reminderDaysBefore: 1, active: true, autoPost: false });
  await saveBudget(target, null, { name: 'الكل', period: 'monthly', startDate: null, endDate: null, amountMinor: 100_000, currency: 'MAD', categoryId: null, accountId: null, thresholds: [50, 100], active: true });
  const goal = await saveGoal(target, null, { name: 'الطوارئ', targetMinor: 500_000, currency: 'MAD', targetDate: '2027-01-01', priority: 1, notes: null, mode: 'manual', linkedAccountId: null });
  await addAllocation(target, goal, 20_000);
  await saveSetting(target, 'language', 'fr');
  return { bank, debt };
}

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ code });
}

const mangle = (backup: BackupFile, change: (b: BackupFile) => void, recompute = false): string => {
  const copy = JSON.parse(serializeBackup(backup)) as BackupFile;
  change(copy);
  if (recompute) {
    const { sha256 } = jest.requireActual('@noble/hashes/sha2.js') as typeof import('@noble/hashes/sha2.js');
    const { bytesToHex, utf8ToBytes } = jest.requireActual('@noble/hashes/utils.js') as typeof import('@noble/hashes/utils.js');
    copy.checksum = bytesToHex(sha256(utf8ToBytes(JSON.stringify(copy.tables))));
  }
  return JSON.stringify(copy);
};

describe('backup and restore', () => {
  test('a realistic book round trips exactly, relationships and Arabic included', async () => {
    const { debt } = await populate(db);
    const before = await createBackup(db);
    const positions = await getPositions(db);
    const debtState = (await getDebt(db, debt))?.state;

    const fresh = await openTestDb();
    await restoreBackup(fresh, parseBackup(serializeBackup(before)));

    expect(await getPositions(fresh)).toEqual(positions);
    expect((await getDebt(fresh, debt))?.state).toEqual(debtState);
    expect(await verifyLedger(fresh)).toEqual([]);
    expect((await listTransactions(fresh, { search: 'مقتبس' }))[0].tags.sort()).toEqual(['سفر', 'عائلة'].sort());
    expect((await createBackup(fresh)).checksum).toBe(before.checksum);
    expect((await loadSettings(fresh)).language).toBe('fr');
  });

  test('summary describes the file before anything is replaced', async () => {
    await populate(db);
    const summary = summarizeBackup(parseBackup(serializeBackup(await createBackup(db))));
    expect(summary).toMatchObject({ accounts: 2, debts: 1, schemaVersion: SCHEMA_VERSION });
    expect(summary.transactions).toBeGreaterThan(5);
  });

  test('device-only settings neither leave nor get overwritten', async () => {
    await saveSetting(db, 'lockEnabled', true);
    const backup = await createBackup(db);
    expect(JSON.stringify(backup.tables.settings)).not.toContain('lockEnabled');
    await saveSetting(db, 'lockEnabled', false);
    await saveSetting(db, 'lockEnabled', true);
    await restoreBackup(db, backup);
    expect((await loadSettings(db)).lockEnabled).toBe(true);
  });

  test.each([
    ['not json', '{oops', 'backup_corrupt'],
    ['another format', JSON.stringify({ format: 'other' }), 'backup_invalid'],
    ['null', 'null', 'backup_invalid'],
  ])('rejects %s', (_, text, code) => {
    expect(() => parseBackup(text)).toThrow(expect.objectContaining({ code }));
  });

  test('truncation is detected', async () => {
    await populate(db);
    const text = serializeBackup(await createBackup(db));
    expect(() => parseBackup(text.slice(0, text.length / 2))).toThrow(expect.objectContaining({ code: 'backup_corrupt' }));
  });

  test('a tampered amount fails the checksum', async () => {
    await populate(db);
    const backup = await createBackup(db);
    const text = mangle(backup, (b) => { (b.tables.transactions[0] as { amount_minor: number }).amount_minor += 1; });
    expect(() => parseBackup(text)).toThrow(expect.objectContaining({ code: 'backup_corrupt' }));
  });

  test('a missing table or wrong count is detected', async () => {
    await populate(db);
    const backup = await createBackup(db);
    expect(() => parseBackup(mangle(backup, (b) => { delete (b.tables as Record<string, unknown>).debts; }))).toThrow(expect.objectContaining({ code: 'backup_corrupt' }));
    expect(() => parseBackup(mangle(backup, (b) => { b.counts.accounts = 99; }))).toThrow(expect.objectContaining({ code: 'backup_corrupt' }));
  });

  test('a backup from a newer app is refused', async () => {
    const backup = await createBackup(db);
    expect(() => parseBackup(mangle(backup, (b) => { b.schemaVersion = SCHEMA_VERSION + 1; }))).toThrow(expect.objectContaining({ code: 'backup_newer' }));
    expect(() => parseBackup(mangle(backup, (b) => { b.formatVersion = 99; }))).toThrow(expect.objectContaining({ code: 'backup_newer' }));
  });

  describe('files that pass the checksum but break the books', () => {
    const scenarios: [string, (b: BackupFile) => void][] = [
      ['a ledger leg that disagrees with its transaction', (b) => { (b.tables.ledger_entries[0] as { amount_minor: number }).amount_minor += 1; }],
      ['a transaction pointing at a missing account', (b) => { (b.tables.transactions[1] as { account_id: string }).account_id = 'ghost'; }],
      ['a transaction whose legs were dropped', (b) => { b.tables.ledger_entries.pop(); b.counts.ledger_entries -= 1; }],
      ['a negative amount', (b) => { (b.tables.transactions[2] as { amount_minor: number }).amount_minor = -5; }],
      ['an unknown column', (b) => { (b.tables.accounts[0] as Record<string, unknown>).evil = 'x'; }],
    ];

    test.each(scenarios)('%s: refused, and existing data survives', async (_, change) => {
      await populate(db);
      const backup = await createBackup(db);
      const target = await openTestDb();
      const account = await createAccount(target, { name: 'Keep me', type: 'cash', currency: 'MAD', openingBalanceMinor: 12_345 });
      const text = mangle(backup, change, true);
      await expectCode(restoreBackup(target, parseBackup(text)), 'backup_corrupt');
      expect((await getAccount(target, account))?.balanceMinor).toBe(12_345);
      expect(await listAccounts(target)).toHaveLength(1);
      expect(await verifyLedger(target)).toEqual([]);
    });
  });

  test('a restored database accepts new work', async () => {
    const { bank } = await populate(db);
    const backup = await createBackup(db);
    await resetAllData(db);
    await restoreBackup(db, backup);
    await createTransaction(db, { type: 'expense', amountMinor: 100, accountId: bank, categoryId: 'cat_food', occurredAt: at });
    expect(await verifyLedger(db)).toEqual([]);
  });
});

describe('encrypted backup', () => {
  const random = (n: number) => new Uint8Array(randomBytes(n));

  test('round trips Arabic through AES-256-GCM', async () => {
    const plain = JSON.stringify({ note: 'سري جدًا 🔒' });
    const sealed = await encryptBackup(plain, 'كلمة السر', random);
    expect(isEncryptedBackup(sealed)).toBe(true);
    expect(sealed).not.toContain('سري');
    expect(await decryptBackup(sealed, 'كلمة السر')).toBe(plain);
  }, 30_000);

  test('wrong password and tampering are refused with the same answer', async () => {
    const sealed = await encryptBackup('{"a":1}', 'right', random);
    await expectCode(decryptBackup(sealed, 'wrong'), 'backup_password');
    const file = JSON.parse(sealed) as { ciphertext: string };
    const bytes = fromBase64(file.ciphertext);
    bytes[0] ^= 1;
    await expectCode(decryptBackup(JSON.stringify({ ...file, ciphertext: toBase64(bytes) }), 'right'), 'backup_password');
  }, 30_000);

  test('weakening the KDF parameters invalidates the file', async () => {
    const file = JSON.parse(await encryptBackup('{"a":1}', 'right', random)) as { kdf: { N: number } };
    file.kdf.N = 2 ** 14;
    await expectCode(decryptBackup(JSON.stringify(file), 'right'), 'backup_password');
  }, 30_000);

  test('hostile KDF parameters are refused before any work', async () => {
    const hostile = { format: 'masroufi-backup-encrypted', version: 1, cipher: 'aes-256-gcm', nonce: '', ciphertext: '', kdf: { name: 'scrypt', N: 2 ** 30, r: 8, p: 1, salt: '' } };
    await expectCode(decryptBackup(JSON.stringify(hostile), 'x'), 'backup_invalid');
    await expectCode(decryptBackup(JSON.stringify({ ...hostile, kdf: { ...hostile.kdf, N: 1000 } }), 'x'), 'backup_invalid');
  });

  test('the same input never encrypts the same way twice', async () => {
    const [a, b] = [await encryptBackup('x', 'p', random), await encryptBackup('x', 'p', random)];
    expect(a).not.toBe(b);
  }, 30_000);

  test('base64 matches a reference implementation', () => {
    for (const size of [0, 1, 2, 3, 4, 5, 255, 1024]) {
      const bytes = new Uint8Array(randomBytes(size));
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
    }
  });

  test('a full encrypted cycle restores the books', async () => {
    await populate(db);
    const positions = await getPositions(db);
    const sealed = await encryptBackup(serializeBackup(await createBackup(db)), 'secret', random);
    const fresh = await openTestDb();
    await restoreBackup(fresh, parseBackup(await decryptBackup(sealed, 'secret')));
    expect(await getPositions(fresh)).toEqual(positions);
  }, 30_000);
});

describe('migrations', () => {
  test('a fresh database reaches the latest version and records it', async () => {
    const rows = await db.all<{ version: number }>('SELECT version FROM schema_migrations');
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  test('running again changes nothing', async () => {
    expect(await migrate(db)).toEqual([]);
  });

  test('a later migration upgrades an existing database and keeps its data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'masroufi-'));
    const path = join(dir, 'app.db');
    try {
      const v1 = createDb(nodeBackend(path));
      await migrate(v1);
      await seedDefaultCategories(v1);
      const bank = await createAccount(v1, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 500 });

      const reopened = createDb(nodeBackend(path));
      const next = [...MIGRATIONS, { version: SCHEMA_VERSION + 1, name: 'add_nickname', up: `ALTER TABLE accounts ADD COLUMN nickname TEXT; UPDATE accounts SET nickname = 'b';` }];
      expect(await migrate(reopened, next)).toEqual([SCHEMA_VERSION + 1]);
      expect((await getAccount(reopened, bank))?.balanceMinor).toBe(500);
      expect(await reopened.get('SELECT nickname FROM accounts')).toEqual({ nickname: 'b' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a failing migration rolls back whole and stays pending', async () => {
    const broken = { version: SCHEMA_VERSION + 1, name: 'broken', up: `ALTER TABLE accounts ADD COLUMN half TEXT; SELECT * FROM no_such_table;` };
    await expect(migrate(db, [...MIGRATIONS, broken])).rejects.toThrow();
    const info = await db.all<{ name: string }>('PRAGMA table_info(accounts)');
    expect(info.some((c) => c.name === 'half')).toBe(false);
    expect(await db.get('SELECT 1 FROM schema_migrations WHERE version = ?', [SCHEMA_VERSION + 1])).toBeNull();
  });

  test('a database from a newer app is not touched', async () => {
    await expect(migrate(db, MIGRATIONS.filter((m) => m.version < SCHEMA_VERSION))).rejects.toThrow(/newer/);
  });

  test('data survives closing and reopening the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'masroufi-'));
    const path = join(dir, 'app.db');
    try {
      const first = createDb(nodeBackend(path));
      await migrate(first);
      await seedDefaultCategories(first);
      const bank = await createAccount(first, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 700 });
      const again = createDb(nodeBackend(path));
      await migrate(again);
      await seedDefaultCategories(again);
      expect((await getAccount(again, bank))?.balanceMinor).toBe(700);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an interrupted write rolls back when the transaction fails midway', async () => {
    const bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD' });
    await expect(db.transaction(async (tx) => {
      await createTransaction(tx, { type: 'income', amountMinor: 100, accountId: bank, categoryId: 'cat_salary', occurredAt: at });
      throw new Error('crash');
    })).rejects.toThrow('crash');
    expect((await getAccount(db, bank))?.balanceMinor).toBe(0);
  });
});

describe('settings and categories', () => {
  test('settings persist with defaults for what is unset', async () => {
    expect((await loadSettings(db)).language).toBe('ar');
    await saveSetting(db, 'hideAmounts', true);
    expect((await loadSettings(db)).hideAmounts).toBe(true);
  });

  test('seeding twice adds nothing, and custom categories can be archived, not lost', async () => {
    const count = (await listCategories(db)).length;
    await seedDefaultCategories(db);
    expect(await listCategories(db)).toHaveLength(count);
    const id = await saveCategory(db, null, { name: 'Pets', kind: 'expense', icon: 'paw-outline', color: '#000000', nature: null });
    await setCategoryArchived(db, id, true);
    expect((await listCategories(db)).some((c) => c.id === id)).toBe(false);
    expect((await listCategories(db, { includeArchived: true })).some((c) => c.id === id)).toBe(true);
  });

  test('a used category cannot switch between income and expense', async () => {
    const bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD' });
    await createTransaction(db, { type: 'expense', amountMinor: 100, accountId: bank, categoryId: 'cat_food', occurredAt: at });
    await expect(saveCategory(db, 'cat_food', { name: 'الطعام', kind: 'income', icon: 'x', color: '#000', nature: null })).rejects.toMatchObject({ code: 'category_kind_mismatch' });
  });
});

describe('exports', () => {
  const labels = { type: (t: string) => t, category: (t: { categoryName: string | null }) => t.categoryName ?? '' };

  test('transaction csv carries exact amounts, Arabic and quoting', async () => {
    await populate(db);
    const csv = await exportTransactionsCsv(db, labels);
    expect(csv.startsWith('﻿date,time,type,amount')).toBe(true);
    expect(csv).toContain('2026-06-15,12:00,expense,45.00,MAD,-45.00,البنك الشعبي');
    expect(csv).toContain('"سطر\nثانٍ, ""مقتبس"""');
    expect(csv).toContain('110.00,MAD,-110.00,البنك الشعبي,Compte €,10.00,EUR');
  });

  test('csv rows match the ledger total', async () => {
    await populate(db);
    const csv = await exportTransactionsCsv(db, labels, { from: '2026-06-15', to: '2026-06-15' });
    expect(csv.split('\r\n').filter((l) => l.includes('2026-06-15'))).toHaveLength(4);
  });

  test('debts and accounts csv', async () => {
    await populate(db);
    expect(await exportDebtsCsv(db)).toContain('i_owe,أحمد,MAD,3000.00,0.00,1000.00,2000.00');
    expect(await exportAccountsCsv(db)).toContain('Compte €,bank,EUR,510.00,active');
  });
});

describe('insights from real data', () => {
  const nameOf = (c: { key: string | null; name: string | null }) => c.key ?? c.name ?? '?';

  test('finds the restaurant comparison from the spec, and only because data supports it', async () => {
    const bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 1_000_000, createdOn: '2026-01-01' });
    await createTransaction(db, { type: 'expense', amountMinor: 30_000, accountId: bank, categoryId: 'cat_restaurants', occurredAt: '2026-05-10T10:00' });
    await createTransaction(db, { type: 'expense', amountMinor: 45_000, accountId: bank, categoryId: 'cat_restaurants', occurredAt: at });
    const insights = await getInsights(db, { from: '2026-06-01', to: '2026-06-30' }, 'MAD', nameOf);
    expect(insights.find((i) => i.kind === 'category_increase')).toMatchObject({ amounts: { now: 45_000, before: 30_000 }, labels: { name: 'restaurants' } });
  });

  test('flags a genuinely unusual expense', async () => {
    const bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 1_000_000, createdOn: '2026-01-01' });
    for (let i = 1; i <= 6; i += 1) {
      await createTransaction(db, { type: 'expense', amountMinor: 1_000, accountId: bank, categoryId: 'cat_food', occurredAt: `2026-04-0${i}T10:00` });
    }
    await createTransaction(db, { type: 'expense', amountMinor: 9_000, accountId: bank, categoryId: 'cat_food', occurredAt: at, description: 'وليمة' });
    const insights = await getInsights(db, { from: '2026-06-01', to: '2026-06-30' }, 'MAD', nameOf);
    expect(insights.find((i) => i.kind === 'unusual_transaction')).toMatchObject({ labels: { label: 'وليمة' }, amounts: { amount: 9_000, typical: 1_000 } });
  });

  test('essential and discretionary split adds up to total spending', async () => {
    const bank = await createAccount(db, { name: 'Bank', type: 'bank', currency: 'MAD', openingBalanceMinor: 100_000, createdOn: '2026-01-01' });
    await createTransaction(db, { type: 'expense', amountMinor: 700, accountId: bank, categoryId: 'cat_housing', occurredAt: at });
    await createTransaction(db, { type: 'expense', amountMinor: 200, accountId: bank, categoryId: 'cat_restaurants', occurredAt: at });
    await createTransaction(db, { type: 'expense', amountMinor: 100, accountId: bank, categoryId: 'cat_other_expense', occurredAt: at });
    expect(await getSpendingSplit(db, { from: '2026-06-01', to: '2026-06-30' }, 'MAD')).toEqual({ essentialMinor: 700, discretionaryMinor: 200, unclassifiedMinor: 100 });
  });
});

describe('demo data', () => {
  test('is valid, clearly optional, and balances', async () => {
    expect(await listAccounts(db)).toEqual([]);
    await loadDemoData(db);
    expect(await verifyLedger(db)).toEqual([]);
    expect((await listAccounts(db)).length).toBe(3);
    expect((await listBudgets(db)).length).toBe(1);
    expect((await listGoals(db)).length).toBe(2);
    expect((await pendingOccurrences(db, '2026-08-01')).length).toBeGreaterThan(0);
    expect((await getCashFlow(db, { from: '2026-01-01', to: '2026-12-31' }))[0].incomeMinor).toBe(5_400_000);
  });
});
