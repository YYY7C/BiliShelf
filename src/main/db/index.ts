import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import { ensureLibraryDirs, libraryPaths } from '../paths';
import { migrations } from './migrations';

/**
 * 使用 Node 内置的 node:sqlite（Electron 主进程自带），
 * 避免 better-sqlite3 之类的原生模块编译，安装包与 CI 都更简单。
 */
export type DB = DatabaseSync;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

let db: DB | null = null;
let activeRoot = '';

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

export function openDatabase(rootOverride?: string): DB {
  const paths = ensureLibraryDirs(libraryPaths(rootOverride));
  if (db && activeRoot === paths.root) return db;
  if (db) closeDatabase();

  const instance = new DatabaseSync(paths.db);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA synchronous = NORMAL;');
  instance.exec('PRAGMA foreign_keys = ON;');
  instance.exec('PRAGMA busy_timeout = 5000;');
  instance.exec('PRAGMA temp_store = MEMORY;');
  instance.exec('PRAGMA cache_size = -32000;');

  migrate(instance);
  db = instance;
  activeRoot = paths.root;
  log.info('[db] opened', paths.db);
  return instance;
}

export function getDb(): DB {
  if (!db) return openDatabase();
  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.close();
  } catch (error) {
    log.warn('[db] close failed', error);
  }
  db = null;
  activeRoot = '';
}

export function currentLibraryRoot(): string {
  return activeRoot || libraryPaths().root;
}

function migrate(instance: DB): void {
  instance.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);

  const appliedRows = instance.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: number }>;
  const applied = new Set(appliedRows.map((row) => Number(row.id)));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    try {
      instance.exec('BEGIN;');
      instance.exec(migration.sql);
      instance
        .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString());
      instance.exec('COMMIT;');
      log.info('[db] migration applied', migration.id, migration.name);
    } catch (error) {
      try {
        instance.exec('ROLLBACK;');
      } catch {
        // ignore rollback failure
      }
      throw error;
    }
  }
}

/** 整库备份到 backups/，用于迁移失败/用户手动备份。 */
export function backupDatabase(tag = 'manual'): string | null {
  const instance = getDb();
  const paths = libraryPaths();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(paths.backups, `library-${tag}-${stamp}.db`);
  try {
    fs.mkdirSync(paths.backups, { recursive: true });
    instance.exec(`VACUUM INTO '${target.replace(/'/g, "''")}';`);
    return target;
  } catch (error) {
    log.error('[db] backup failed', error);
    return null;
  }
}

export type Row = Record<string, unknown>;

export function all<T = Row>(sql: string, params: unknown[] = []): T[] {
  const statement = getDb().prepare(sql);
  return statement.all(...(params as never[])) as T[];
}

export function one<T = Row>(sql: string, params: unknown[] = []): T | undefined {
  const statement = getDb().prepare(sql);
  return statement.get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): RunResult {
  const statement = getDb().prepare(sql);
  const result = statement.run(...(params as never[])) as { changes: number | bigint; lastInsertRowid: number | bigint };
  return {
    changes: toNumber(result.changes ?? 0),
    lastInsertRowid: toNumber(result.lastInsertRowid ?? 0)
  };
}

/** 事务包装：node:sqlite 没有 better-sqlite3 的 transaction helper。 */
export function tx<T>(fn: () => T): T {
  const instance = getDb();
  instance.exec('BEGIN;');
  try {
    const result = fn();
    instance.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      instance.exec('ROLLBACK;');
    } catch {
      // ignore
    }
    throw error;
  }
}
