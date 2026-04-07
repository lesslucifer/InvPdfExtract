import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadFilterConfig, saveFilterConfig } from './config';
import { DEFAULT_FILTER_CONFIG } from '../../shared/constants';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-filter-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadFilterConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const config = await loadFilterConfig(tmpDir);
    expect(config).toEqual(DEFAULT_FILTER_CONFIG);
  });

  it('merges partial overrides with defaults', async () => {
    const partial = { skipThreshold: 0.3, processThreshold: 0.7 };
    fs.writeFileSync(path.join(tmpDir, 'filter-config.json'), JSON.stringify(partial));

    const config = await loadFilterConfig(tmpDir);
    expect(config.skipThreshold).toBe(0.3);
    expect(config.processThreshold).toBe(0.7);
    expect(config.aiTriageEnabled).toBe(DEFAULT_FILTER_CONFIG.aiTriageEnabled);
    expect(config.sizeMinBytes).toBe(DEFAULT_FILTER_CONFIG.sizeMinBytes);
  });

  it('returns defaults when config file is corrupted JSON', async () => {
    fs.writeFileSync(path.join(tmpDir, 'filter-config.json'), 'not valid json {{{');

    const config = await loadFilterConfig(tmpDir);
    expect(config).toEqual(DEFAULT_FILTER_CONFIG);
  });

  it('preserves all default fields for a full config', async () => {
    const full = { ...DEFAULT_FILTER_CONFIG, skipThreshold: 0.35 };
    fs.writeFileSync(path.join(tmpDir, 'filter-config.json'), JSON.stringify(full));

    const config = await loadFilterConfig(tmpDir);
    expect(config.skipThreshold).toBe(0.35);
    expect(config.customKeywords).toEqual([]);
  });
});

describe('saveFilterConfig', () => {
  it('writes config to disk and round-trips correctly', async () => {
    const custom = { ...DEFAULT_FILTER_CONFIG, skipThreshold: 0.3, aiTriageEnabled: false };

    await saveFilterConfig(tmpDir, custom);

    const loaded = await loadFilterConfig(tmpDir);
    expect(loaded.skipThreshold).toBe(0.3);
    expect(loaded.aiTriageEnabled).toBe(false);
  });

  it('writes valid JSON', async () => {
    await saveFilterConfig(tmpDir, DEFAULT_FILTER_CONFIG);

    const raw = fs.readFileSync(path.join(tmpDir, 'filter-config.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
