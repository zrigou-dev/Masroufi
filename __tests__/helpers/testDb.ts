// jest's resolver does not know this builtin, so it is fetched from the runtime directly.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

import { seedDefaultCategories } from '../../src/data/categories';
import { migrate, type Migration } from '../../src/data/migrations';
import { createDb, type DbWithEvents, type SqlBackend, type SqlParams } from '../../src/data/sql';

/** A real SQLite engine behind the same interface expo-sqlite implements in the app. */
export function nodeBackend(path = ':memory:'): SqlBackend {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  return {
    exec: async (sql) => {
      sqlite.exec(sql);
    },
    run: async (sql, params: SqlParams) => {
      const { changes } = sqlite.prepare(sql).run(...params);
      return { changes: Number(changes) };
    },
    all: async <T,>(sql: string, params: SqlParams) => sqlite.prepare(sql).all(...params) as T[],
  };
}

export async function openTestDb(migrations?: Migration[]): Promise<DbWithEvents> {
  const db = createDb(nodeBackend());
  await migrate(db, migrations);
  await seedDefaultCategories(db);
  return db;
}
