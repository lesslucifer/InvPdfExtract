import { v4 as uuid } from 'uuid';
import { getDatabase } from './database';

export interface FilterPresetRow {
  id: string;
  name: string;
  filters_json: string;
  created_at: string;
}

export function listPresets(): FilterPresetRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM filter_presets ORDER BY created_at DESC').all() as FilterPresetRow[];
}

export function savePreset(name: string, filtersJson: string): FilterPresetRow {
  const db = getDatabase();
  const id = uuid();
  db.prepare(
    'INSERT INTO filter_presets (id, name, filters_json) VALUES (?, ?, ?)'
  ).run(id, name, filtersJson);
  return db.prepare('SELECT * FROM filter_presets WHERE id = ?').get(id) as FilterPresetRow;
}

export function deletePreset(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM filter_presets WHERE id = ?').run(id);
}
