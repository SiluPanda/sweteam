import { mkdirSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const SWETEAM_DIR = join(homedir(), '.sweteam');
const DB_PATH = join(SWETEAM_DIR, 'sweteam.db');

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function getMigrationsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), '../../drizzle/migrations');
}

function runMigrations(sqlite: Database.Database): void {
  const migrationsDir = getMigrationsDir();

  let sqlFiles: string[];
  try {
    sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    throw new Error(`Migrations directory not found at ${migrationsDir}. Cannot initialize database.`);
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    sqlite
      .prepare('SELECT hash FROM __drizzle_migrations')
      .all()
      .map((r) => (r as { hash: string }).hash),
  );

  // Use EXCLUSIVE transaction to prevent concurrent migration runs
  sqlite.exec('BEGIN EXCLUSIVE TRANSACTION');
  try {
    for (const file of sqlFiles) {
      let sql: string;
      try {
        sql = readFileSync(join(migrationsDir, file), 'utf-8');
      } catch (readErr) {
        sqlite.exec('ROLLBACK');
        throw new Error(`Failed to read migration file ${file}: ${readErr}`, { cause: readErr });
      }

      const hash = createHash('sha256').update(sql).digest('hex');

      // Skip if already applied (check both content hash and legacy filename hash)
      if (applied.has(hash) || applied.has(file)) continue;

      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      if (statements.length === 0) {
        console.warn(`Warning: migration file ${file} contains no SQL statements.`);
      }

      for (const stmt of statements) {
        sqlite.exec(stmt);
      }
      sqlite
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(hash, Date.now());
    }
    sqlite.exec('COMMIT');
  } catch (err) {
    try {
      sqlite.exec('ROLLBACK');
    } catch {
      // Rollback may fail if already rolled back
    }
    throw err;
  }
}

function createConnection(dbPath: string = DB_PATH): Database.Database {
  ensureDir(dirname(dbPath));
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 15000');
  runMigrations(sqlite);
  return sqlite;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb(dbPath?: string) {
  if (!_db) {
    _sqlite = createConnection(dbPath);
    _db = drizzle(_sqlite, { schema });
  }
  return _db;
}

export function closeDb(): void {
  if (_sqlite) {
    try {
      _sqlite.pragma('wal_checkpoint(TRUNCATE)');
    } catch (walErr) {
      console.error('Failed to checkpoint WAL on close:', walErr);
    }
    try {
      _sqlite.close();
    } catch (closeErr) {
      console.error('Failed to close SQLite database:', closeErr);
    }
    _sqlite = null;
    _db = null;
  }
}

export { SWETEAM_DIR, DB_PATH };
