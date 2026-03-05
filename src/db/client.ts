import { mkdirSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const SWETEAM_DIR = join(homedir(), ".sweteam");
const DB_PATH = join(SWETEAM_DIR, "sweteam.db");

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function getMigrationsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), "../../drizzle/migrations");
}

function runMigrations(sqlite: Database.Database): void {
  const migrationsDir = getMigrationsDir();

  let sqlFiles: string[];
  try {
    sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return;
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    sqlite
      .prepare("SELECT hash FROM __drizzle_migrations")
      .all()
      .map((r) => (r as { hash: string }).hash),
  );

  for (const file of sqlFiles) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    const runAll = sqlite.transaction(() => {
      for (const stmt of statements) {
        sqlite.exec(stmt);
      }
      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(file, Date.now());
    });
    runAll();
  }
}

function createConnection(dbPath: string = DB_PATH): Database.Database {
  ensureDir(dirname(dbPath));
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
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
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

export { SWETEAM_DIR, DB_PATH };
