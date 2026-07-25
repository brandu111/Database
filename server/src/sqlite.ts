import type { StatementSync } from 'node:sqlite';

/**
 * A thin wrapper over Node's built-in `node:sqlite` that presents the small
 * subset of the better-sqlite3 API this app relies on (`prepare().run/get/all`
 * with positional or `@named` binding, `exec`, `pragma`, and a `transaction`
 * helper). Using the engine bundled into Node means there is **no native
 * module to compile or install** — the app runs on any Node 22.13+/24 host,
 * including cPanel shared hosting, with an empty dependency list.
 *
 * `node:sqlite` is fetched at runtime via `process.getBuiltinModule` (Node
 * 22.3+) rather than a static import, so bundlers / test runners with an older
 * builtins list (e.g. Vite) don't try to resolve it from disk, and the CJS
 * deploy bundle needs no `import.meta`. Node resolves the builtin normally.
 */
const getBuiltinModule = (process as unknown as { getBuiltinModule: (id: string) => typeof import('node:sqlite') }).getBuiltinModule;
const { DatabaseSync } = getBuiltinModule('node:sqlite');

export class Statement {
  constructor(private stmt: StatementSync) {
    // Allow binding named parameters by bare key (e.g. { id } for `@id`).
    try {
      this.stmt.setAllowBareNamedParameters(true);
    } catch {
      /* older runtimes: bare keys are the default */
    }
  }
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.stmt.run(...(params as never[]));
  }
  get<T = unknown>(...params: unknown[]): T | undefined {
    return this.stmt.get(...(params as never[])) as T | undefined;
  }
  all<T = unknown>(...params: unknown[]): T[] {
    return this.stmt.all(...(params as never[])) as T[];
  }
}

export class Database {
  private db: InstanceType<typeof DatabaseSync>;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }
  /** Run one or more SQL statements. */
  exec(sql: string): this {
    this.db.exec(sql);
    return this;
  }
  /** better-sqlite3-style `pragma('foreign_keys = ON')`. */
  pragma(directive: string): this {
    this.db.exec(`PRAGMA ${directive}`);
    return this;
  }
  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }
  /**
   * Wrap a function in a transaction, matching better-sqlite3's
   * `const tx = db.transaction(fn); tx(...)` usage.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      this.db.exec('BEGIN');
      try {
        const result = fn(...args);
        this.db.exec('COMMIT');
        return result;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    };
  }
  close(): void {
    this.db.close();
  }
}
