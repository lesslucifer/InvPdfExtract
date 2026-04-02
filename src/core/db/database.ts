import Database from 'better-sqlite3';
import { MIGRATIONS } from './schema';

let db: Database.Database | null = null;

export function openDatabase(dbPath: string): Database.Database {
  if (db) return db;

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not opened');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(database: Database.Database): void {
  // Ensure _migrations table exists (it's part of migration 0 but we need it first)
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    database.prepare('SELECT id FROM _migrations').all().map((r: any) => r.id as number)
  );

  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (applied.has(i)) continue;

    database.exec(MIGRATIONS[i]);
    database.prepare('INSERT INTO _migrations (id) VALUES (?)').run(i);
    console.log(`[DB] Applied migration ${i}`);
  }
}
