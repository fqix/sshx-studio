import * as fs from 'fs';
import * as path from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import { migrate } from './migrations';
import { loadNativeSqlite } from './nativeBinding';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Params = SqlValue[] | Record<string, SqlValue>;
export type Row = Record<string, SqlValue>;

export interface RunResult {
  lastId: number;
  changes: number;
}

/** Statements available inside a write transaction. Synchronous, so a transaction can never span an await. */
export interface Tx {
  run(sql: string, params?: Params): RunResult;
  all<T = Row>(sql: string, params?: Params): T[];
  get<T = Row>(sql: string, params?: Params): T | undefined;
}

const BUSY_TIMEOUT_MS = 5000;
/** How often to check whether another VS Code window committed changes. */
const EXTERNAL_CHANGE_POLL_MS = 2000;

/**
 * Local SQLite database (better-sqlite3, prebuilt N-API binaries) in WAL mode.
 *
 * better-sqlite3 is synchronous and very fast for this workload. Reads keep a Promise-based API;
 * transaction bodies are synchronous so they are atomic and never hold the write lock across an await. Several VS Code windows may open the same file: SQLite's locking
 * keeps writes consistent, and `PRAGMA data_version` polling notices other windows' commits.
 */
export class AppDatabase {
  private readonly listeners = new Set<() => void>();
  private dataVersion = 0;
  private poller?: NodeJS.Timeout;

  private constructor(private readonly db: BetterSqlite3.Database) {}

  static async open(file: string): Promise<AppDatabase> {
    // Loaded lazily so a missing binary surfaces as an activation error, not a load-time crash.
    const Database = require('better-sqlite3') as typeof BetterSqlite3;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // Create the file ourselves so it is private (SQLite would use the umask, usually 0644).
    fs.closeSync(fs.openSync(file, 'a', 0o600));
    fs.chmodSync(file, 0o600);

    const db = new Database(file, { nativeBinding: loadNativeSqlite() as never, timeout: BUSY_TIMEOUT_MS });
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    const app = new AppDatabase(db);
    await app.transaction(migrate);
    app.dataVersion = app.readDataVersion();
    app.poller = setInterval(() => app.checkExternalChanges(), EXTERNAL_CHANGE_POLL_MS);
    app.poller.unref?.();
    return app;
  }

  /** Called after local writes and when another window changed the database. */
  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async all<T = Row>(sql: string, params: Params = []): Promise<T[]> {
    return this.allSync<T>(sql, params);
  }

  async get<T = Row>(sql: string, params: Params = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(params) as T | undefined;
  }

  /** Run `fn` atomically in a write transaction (BEGIN IMMEDIATE … COMMIT, rolled back on throw). */
  async transaction<T>(fn: (tx: Tx) => T): Promise<T> {
    const tx: Tx = {
      run: (s, p) => this.run(s, p),
      all: (s, p) => this.allSync(s, p),
      get: (s, p) => this.db.prepare(s).get(p ?? []) as never,
    };
    const result = this.db.transaction(() => fn(tx)).immediate();
    this.emit();
    return result;
  }

  async close(): Promise<void> {
    if (this.poller) clearInterval(this.poller);
    this.db.close();
  }

  private allSync<T>(sql: string, params: Params = []): T[] {
    return this.db.prepare(sql).all(params) as T[];
  }

  private run(sql: string, params: Params = []): RunResult {
    const r = this.db.prepare(sql).run(params);
    return { lastId: Number(r.lastInsertRowid), changes: r.changes };
  }

  private readDataVersion(): number {
    return Number(this.db.pragma('data_version', { simple: true }));
  }

  /** data_version only changes when *another* connection commits. */
  private checkExternalChanges() {
    try {
      const v = this.readDataVersion();
      if (v !== this.dataVersion) {
        this.dataVersion = v;
        this.emit();
      }
    } catch {
      /* closed */
    }
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}
