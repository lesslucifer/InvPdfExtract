import Database from 'better-sqlite3';
import { openSqlite } from '../../core/db/sqlite-binding';
import { MIGRATIONS } from '../../core/db/schema';

/**
 * Creates an in-memory SQLite database with the full InvoiceVault schema.
 * Used by tests that need a real database without touching the filesystem.
 */
export function createInMemoryDb(): Database.Database {
  const db = openSqlite(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(migration.key);
  }

  return db;
}
