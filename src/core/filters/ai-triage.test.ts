import { describe, it, expect } from 'vitest';
import { parseTriageResponse, aiTriageBatch, TRIAGE_SYSTEM_PROMPT } from './ai-triage';
import { DEFAULT_FILTER_CONFIG } from '../../shared/constants';

describe('parseTriageResponse', () => {
  it('parses valid JSON array', () => {
    const raw = JSON.stringify([
      { index: 0, classification: 'invoice', confidence: 0.9, reason: 'Contains MST and invoice number' },
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
  it('returns empty array for empty inputs', async () => {
    const results = await aiTriageBatch([], DEFAULT_FILTER_CONFIG);
    expect(results).toHaveLength(0);
  });

  it('defaults all to process on AI failure (fail-open)', async () => {
    const inputs = [
      { relativePath: 'a.pdf', textSample: 'some text', layer2Score: 0.5 },
      { relativePath: 'b.pdf', textSample: 'other text', layer2Score: 0.5 },
    ];

    // Use a non-existent CLI path to force failure
    const results = await aiTriageBatch(inputs, DEFAULT_FILTER_CONFIG, '/nonexistent/claude');
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.decision).toBe('process');
      expect(r.layer).toBe(3);
    }
  });
});

describe('TRIAGE_SYSTEM_PROMPT', () => {
  it('includes the three classification categories', () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain('invoice');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('bank_statement');
    expect(TRIAGE_SYSTEM_PROMPT).toContain('irrelevant');
  });
});
