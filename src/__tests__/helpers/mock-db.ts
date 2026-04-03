import Database from 'better-sqlite3';
import { MIGRATIONS } from '../../core/db/schema';

/**
 * Creates an in-memory SQLite database with the full InvoiceVault schema.
 * Used by tests that need a real database without touching the filesystem.
 */
export function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create _migrations table first
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Run all migrations
  for (let i = 0; i < MIGRATIONS.length; i++) {
    db.exec(MIGRATIONS[i]);
    db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(i);
  }

  return db;
}
