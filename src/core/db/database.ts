import Database from 'better-sqlite3';
import { openSqlite } from './sqlite-binding';
import { MIGRATIONS } from './schema';
import { normalizeQuery } from '../../shared/normalize-query';
import { log, LogModule } from '../logger';

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
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate from legacy integer-keyed _migrations to named keys
  const columns = database.pragma('table_info(_migrations)') as { name: string; type: string }[];
  const idCol = columns.find(c => c.name === 'id');
  if (idCol && idCol.type === 'INTEGER') {
    database.exec(`
      DROP TABLE _migrations;
      CREATE TABLE _migrations (
        id TEXT PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );
    `);
    log.info(LogModule.DB, 'Rebuilt _migrations table with TEXT keys');
  }

  const applied = new Set(
    (database.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map(r => r.id)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.key)) continue;

    database.exec(migration.sql);
    database.prepare('INSERT INTO _migrations (id) VALUES (?)').run(migration.key);
    log.info(LogModule.DB, `Applied migration ${migration.key}`);
  }
}
