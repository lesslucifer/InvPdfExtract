import Database from 'better-sqlite3';
import { openSqlite } from './sqlite-binding';
import { MIGRATIONS } from './schema';
import { normalizeQuery } from '../../shared/normalize-query';

let activeDb: Database.Database | null = null;

/**
 * Opens a SQLite database at the given path, runs migrations, and returns the instance.
 * Does NOT set the active database — call setActiveDatabase() separately if needed.
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = openSqlite(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.function('normalize_text', { deterministic: true }, (s: unknown) =>
    normalizeQuery(typeof s === 'string' ? s : String(s ?? ''))
  );
  runMigrations(db);
  return db;
}

/**
 * Sets the database instance that getDatabase() returns.
 * Used when switching vaults to make the active vault's DB globally accessible.
 */
export function setActiveDatabase(db: Database.Database): void {
  activeDb = db;
}

/**
 * Returns the currently active database instance.
 * Throws if no database has been set via setActiveDatabase().
 */
export function getDatabase(): Database.Database {
  if (!activeDb) throw new Error('Database not opened');
  return activeDb;
}

/**
 * Clears the active database reference and closes the given database.
 * If no db is passed, closes the currently active database.
 */
export function closeDatabase(db?: Database.Database): void {
  const target = db ?? activeDb;
  if (target) {
    if (target === activeDb) activeDb = null;
    target.close();
  }
}

function runMigrations(database: Database.Database): void {
  interface MigrationRow {
    id: number;
  }

  // Ensure _migrations table exists (it's part of migration 0 but we need it first)
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (database.prepare('SELECT id FROM _migrations').all() as MigrationRow[]).map(r => r.id)
  );

  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (applied.has(i)) continue;

    database.exec(MIGRATIONS[i]);
    database.prepare('INSERT INTO _migrations (id) VALUES (?)').run(i);
    console.log(`[DB] Applied migration ${i}`);
  }
}
