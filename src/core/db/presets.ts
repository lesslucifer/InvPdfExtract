import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';
import { FilterPreset } from '../../shared/types';

export function listPresets(): FilterPreset[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM filter_presets ORDER BY created_at DESC').all() as FilterPreset[];
}

export function savePreset(name: string, filters: string): FilterPreset {
  const db = getDatabase();
  const id = uuid();
  db.prepare(
    'INSERT INTO filter_presets (id, name, filters) VALUES (?, ?, ?)'
  ).run(id, name, filters);
  return db.prepare('SELECT * FROM filter_presets WHERE id = ?').get(id) as FilterPreset;
}

export function deletePreset(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM filter_presets WHERE id = ?').run(id);
}
