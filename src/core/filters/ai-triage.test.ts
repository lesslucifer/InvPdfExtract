import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseTriageResponse, aiTriageBatch } from './ai-triage';
import { writeDefaultTriageInstructions } from './ai-triage-instructions';
import { DEFAULT_FILTER_CONFIG } from '../../shared/constants';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

describe('parseTriageResponse', () => {
  it('parses valid JSON array', () => {
    const raw = JSON.stringify([
      { index: 0, classification: 'invoice', confidence: 0.9, reason: 'Contains TaxID and invoice number' },
      { index: 1, classification: 'irrelevant', confidence: 0.8, reason: 'Marketing brochure' },
    ]);

    const results = parseTriageResponse(raw, 2);
    expect(results).toHaveLength(2);
    expect(results[0]?.classification).toBe('invoice');
    expect(results[1]?.classification).toBe('irrelevant');
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n[{"index":0,"classification":"bank_statement","confidence":0.7,"reason":"Bank headers found"}]\n```';

    const results = parseTriageResponse(raw, 1);
    expect(results[0]?.classification).toBe('bank_statement');
  });

  it('returns nulls for missing indices', () => {
    const raw = JSON.stringify([
      { index: 0, classification: 'invoice', confidence: 0.9, reason: 'Invoice found' },
    ]);

    const results = parseTriageResponse(raw, 3);
    expect(results).toHaveLength(3);
    expect(results[0]?.classification).toBe('invoice');
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();
  });

  it('returns all nulls for invalid JSON', () => {
    const results = parseTriageResponse('this is not json', 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
  });

  it('returns all nulls when response is not an array', () => {
    const results = parseTriageResponse('{"error": "bad response"}', 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
  });

  it('ignores out-of-bounds indices', () => {
    const raw = JSON.stringify([
      { index: 5, classification: 'invoice', confidence: 0.9, reason: 'test' },
    ]);
    const results = parseTriageResponse(raw, 2);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
  });
});

describe('aiTriageBatch — error handling', () => {
  let tmpVault: string;

  beforeEach(async () => {
    tmpVault = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ivtest-'));
    await writeDefaultTriageInstructions(tmpVault);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpVault, { recursive: true, force: true });
  });

  it('returns empty array for empty inputs', async () => {
    const results = await aiTriageBatch([], DEFAULT_FILTER_CONFIG, tmpVault);
    expect(results).toHaveLength(0);
  });

  it('defaults all to process on AI failure (fail-open)', async () => {
    const inputs = [
      { relativePath: 'a.pdf', textSample: 'some text', layer2Score: 0.5 },
      { relativePath: 'b.pdf', textSample: 'other text', layer2Score: 0.5 },
    ];

    // Use a non-existent CLI path to force failure
    const results = await aiTriageBatch(inputs, DEFAULT_FILTER_CONFIG, tmpVault, '/nonexistent/claude');
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.decision).toBe('process');
      expect(r.layer).toBe(3);
    }
  });
});

describe('ai-triage-instructions default', () => {
  it('includes the three classification categories', async () => {
    const tmpVault = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ivtest-'));
    try {
      await writeDefaultTriageInstructions(tmpVault);
      const { readTriageInstructions } = await import('./ai-triage-instructions');
      const content = await readTriageInstructions(tmpVault);
      expect(content).toContain('invoice');
      expect(content).toContain('bank_statement');
      expect(content).toContain('irrelevant');
    } finally {
      await fs.promises.rm(tmpVault, { recursive: true, force: true });
    }
  });
});
