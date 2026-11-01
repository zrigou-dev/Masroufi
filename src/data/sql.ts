export type SqlValue = string | number | null;
export type SqlParams = SqlValue[];

/** The minimum a SQLite binding must provide. expo-sqlite in the app, node:sqlite in tests. */
export interface SqlBackend {
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlParams): Promise<{ changes: number }>;
  all<T>(sql: string, params: SqlParams): Promise<T[]>;
}

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParams): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  get<T>(sql: string, params?: SqlParams): Promise<T | null>;
  /**
   * Runs fn atomically. A nested call joins the outer transaction.
   * Inside fn, use only the tx handle: the outer handle queues behind this transaction.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export type DbWithEvents = Db & { onChange(listener: () => void): () => void };

function handle(backend: SqlBackend): Db {
  const self: Db = {
    exec: (sql) => backend.exec(sql),
    run: (sql, params = []) => backend.run(sql, params),
    all: <T,>(sql: string, params: SqlParams = []) => backend.all<T>(sql, params),
    get: async <T,>(sql: string, params: SqlParams = []) => (await backend.all<T>(sql, params))[0] ?? null,
    transaction: (fn) => fn(self),
  };
  return self;
}

/**
 * All access to the single connection goes through one queue. SQLite transactions belong to the
 * connection, so without the queue an unrelated await could slip a statement into, or read
 * half-finished state from, someone else's transaction.
 */
export function createDb(backend: SqlBackend): DbWithEvents {
  const inner = handle(backend);
  const listeners = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task);
    queue = result.catch(() => undefined);
    return result;
  };
  const emit = () => listeners.forEach((listener) => listener());

  return {
    exec: async (sql) => {
      await enqueue(() => inner.exec(sql));
      emit();
    },
    run: async (sql, params) => {
      const result = await enqueue(() => inner.run(sql, params));
      // Listeners may write in response; a no-op write must not wake them or they would never settle.
      if (result.changes > 0) emit();
      return result;
    },
    all: (sql, params) => enqueue(() => inner.all(sql, params)),
    get: (sql, params) => enqueue(() => inner.get(sql, params)),
    transaction: async (fn) => {
      const result = await enqueue(async () => {
        await backend.exec('BEGIN IMMEDIATE');
        try {
          const value = await fn(inner);
          await backend.exec('COMMIT');
          return value;
        } catch (error) {
          await backend.exec('ROLLBACK').catch(() => undefined);
          throw error;
        }
      });
      emit();
      return result;
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
