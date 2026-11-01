import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import { seedDefaultCategories } from '../data/categories';
import { configureIdGenerator } from '../data/ids';
import { migrate } from '../data/migrations';
import { createDb, type DbWithEvents, type SqlBackend } from '../data/sql';

const FILE = 'masroufi.db';

function expoBackend(sqlite: SQLite.SQLiteDatabase): SqlBackend {
  return {
    exec: (sql) => sqlite.execAsync(sql),
    run: async (sql, params) => {
      const { changes } = await sqlite.runAsync(sql, params);
      return { changes };
    },
    all: <T,>(sql: string, params: (string | number | null)[]) => sqlite.getAllAsync<T>(sql, params),
  };
}

let opening: Promise<DbWithEvents> | null = null;

export function openDatabase(): Promise<DbWithEvents> {
  opening ??= (async () => {
    configureIdGenerator(Crypto.randomUUID);
    const sqlite = await SQLite.openDatabaseAsync(FILE);
    await sqlite.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const db = createDb(expoBackend(sqlite));
    await migrate(db);
    await seedDefaultCategories(db);
    return db;
  })();
  return opening;
}
