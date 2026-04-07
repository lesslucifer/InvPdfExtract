import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createInMemoryDb } from '../../__tests__/helpers/mock-db';
import { FileStatus } from '../../shared/types';

vi.mock('../db/database', () => ({
  getDatabase: () => _testDb,
}));

vi.mock('./content-sniffer', () => ({
  contentSniffer: vi.fn(),
  extractPdfText: vi.fn().mockResolvedValue(''),
  extractSpreadsheetText: vi.fn().mockReturnValue(''),
  extractXmlText: vi.fn().mockResolvedValue(''),
}));

vi.mock('./ai-triage', () => ({
  aiTriageBatch: vi.fn(),
}));

const mockConfig = {
  skipThreshold: 0.4,
  processThreshold: 0.6,
  customKeywords: [],
  customPathPatterns: [],
  sizeMinBytes: 1024,
  sizeMaxBytes: 52_428_800,
  sizePenalty: 0.15,
  aiTriageEnabled: true,
  aiTriageBatchSize: 10,
};

vi.mock('./config', () => ({
  loadFilterConfig: vi.fn(() => Promise.resolve({ ...mockConfig })),
}));

let _testDb: Database.Database;

import { insertFile, getFileById } from '../db/files';
import { contentSniffer } from './content-sniffer';
import { aiTriageBatch } from './ai-triage';
import { loadFilterConfig } from './config';
import { RelevanceFilter } from './relevance-filter';

const mockVault = {
  rootPath: '/fake/vault',
  dotPath: '/fake/vault/.invoicevault',
  dbPath: '/fake/vault/.invoicevault/vault.db',
  config: { version: 1, created_at: '2026-01-01', confidence_threshold: 0.8 },
  db: null as unknown as Database.Database,
};

describe('RelevanceFilter.filterFiles', () => {
  beforeEach(() => {
    _testDb = createInMemoryDb();
    vi.clearAllMocks();
    vi.mocked(loadFilterConfig).mockResolvedValue({ ...mockConfig });
  });

  afterEach(() => {
    _testDb.close();
  });

  it('accepts file with strong filename signal (Layer 1 process)', async () => {
    const file = insertFile('accounting/invoice_2024_001.pdf', 'hash1', 'pdf', 5000);
    const filter = await RelevanceFilter.create(mockVault);

    const result = await filter.filterFiles([file]);

    expect(result).toHaveLength(1);
    const updated = getFileById(file.id)!;
    expect(updated.status).toBe(FileStatus.Pending);
    expect(updated.filter_layer).toBe(1);
  });

  it('skips file that Layer 2 marks as skip', async () => {
    const file = insertFile('random_photo.jpg', 'hash1', 'jpg', 5000);
    vi.mocked(contentSniffer).mockResolvedValue({
      score: 0.1,
      reason: 'No accounting keywords found',
      layer: 2,
      decision: 'skip',
    });

    const filter = await RelevanceFilter.create(mockVault);
    const result = await filter.filterFiles([file]);

    expect(result).toHaveLength(0);
    const updated = getFileById(file.id)!;
    expect(updated.status).toBe(FileStatus.Skipped);
    expect(updated.filter_layer).toBe(2);
  });

  it('accepts file that Layer 2 marks as process', async () => {
    const file = insertFile('random_photo.jpg', 'hash2', 'jpg', 5000);
    vi.mocked(contentSniffer).mockResolvedValue({
      score: 0.75,
      reason: 'Invoice keywords found',
      layer: 2,
      decision: 'process',
    });

    const filter = await RelevanceFilter.create(mockVault);
    const result = await filter.filterFiles([file]);

    expect(result).toHaveLength(1);
    const updated = getFileById(file.id)!;
    expect(updated.status).toBe(FileStatus.Pending);
    expect(updated.filter_layer).toBe(2);
  });

  it('sends uncertain files to Layer 3 AI triage', async () => {
    const file = insertFile('unknown_file_xyz.jpg', 'hash1', 'jpg', 5000);
    vi.mocked(contentSniffer).mockResolvedValue({
      score: 0.5,
      reason: 'Uncertain',
      layer: 2,
      decision: 'uncertain',
    });
    vi.mocked(aiTriageBatch).mockResolvedValue([{
      score: 0.8,
      reason: 'AI: invoice',
      layer: 3,
      decision: 'process',
    }]);

    const filter = await RelevanceFilter.create(mockVault);
    const result = await filter.filterFiles([file]);

    expect(result).toHaveLength(1);
    expect(aiTriageBatch).toHaveBeenCalledOnce();
    const updated = getFileById(file.id)!;
    expect(updated.filter_layer).toBe(3);
  });

  it('defaults uncertain files to process when AI triage is disabled', async () => {
    const file = insertFile('unknown_file_abc.jpg', 'hash1', 'jpg', 5000);
    vi.mocked(contentSniffer).mockResolvedValue({
      score: 0.5,
      reason: 'Uncertain',
      layer: 2,
      decision: 'uncertain',
    });
    vi.mocked(loadFilterConfig).mockResolvedValue({ ...mockConfig, aiTriageEnabled: false });

    const filter = await RelevanceFilter.create(mockVault);
    const result = await filter.filterFiles([file]);

    expect(result).toHaveLength(1);
    expect(aiTriageBatch).not.toHaveBeenCalled();
  });

  it('returns empty when given empty list', async () => {
    const filter = await RelevanceFilter.create(mockVault);
    const result = await filter.filterFiles([]);
    expect(result).toHaveLength(0);
  });
});
