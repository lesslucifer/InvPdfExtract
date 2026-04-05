import { describe, it, expect, vi } from 'vitest';

// We need to test the internal parseJEResponse. Export it for testing via a re-export trick.
// Since it's private, we test it indirectly through classifyWithAI, or we can extract and test the logic.
// For now, let's test the parsing logic directly by importing the module and testing classifyWithAI
// with mocked ClaudeCodeRunner.

vi.mock('./claude-cli', () => ({
  ClaudeCodeRunner: class {
    async invokeRaw() { return _mockResponse; }
  },
}));

vi.mock('./je-instructions', () => ({
  readInstructions: vi.fn().mockReturnValue('test instructions'),
}));

let _mockResponse = '';

import { classifyWithAI } from './je-ai-classifier';

const sampleItems = [
  { id: 'li-1', recordId: 'r1', docType: 'invoice_in', moTa: 'Van phong pham' },
  { id: 'li-2', recordId: 'r1', docType: 'invoice_in', moTa: 'Dich vu tu van' },
];

describe('JE AI Classifier - response parsing', () => {
  it('parses clean JSON array', async () => {
    _mockResponse = '[{"id":"li-1","tk_no":"6422","tk_co":"331","cash_flow":"operating"},{"id":"li-2","tk_no":"642","tk_co":"331","cash_flow":"operating"}]';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(2);
    expect(results.get('li-1')!.tkNo).toBe('6422');
    expect(results.get('li-2')!.tkNo).toBe('642');
  });

  it('parses JSON wrapped in markdown fences', async () => {
    _mockResponse = '```json\n[{"id":"li-1","tk_no":"156","tk_co":"331","cash_flow":"operating"}]\n```';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.tkNo).toBe('156');
  });

  it('parses JSON with surrounding prose', async () => {
    _mockResponse = 'Here are the classifications:\n\n[{"id":"li-1","tk_no":"156","tk_co":"331","cash_flow":"operating"}]\n\nLet me know if you need changes.';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.tkNo).toBe('156');
  });

  it('parses JSON object with results array', async () => {
    _mockResponse = '{"results":[{"id":"li-1","tk_no":"642","tk_co":"331","cash_flow":"operating"}]}';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.tkNo).toBe('642');
  });

  it('handles markdown fences with no language tag', async () => {
    _mockResponse = '```\n[{"id":"li-1","tk_no":"156","tk_co":"331","cash_flow":"operating"}]\n```';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
  });

  it('skips entries missing required fields', async () => {
    _mockResponse = '[{"id":"li-1","tk_no":"156","tk_co":"331","cash_flow":"operating"},{"id":"li-2","tk_no":"642"}]';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1); // li-2 missing tk_co
  });

  it('returns empty map on unparseable response', async () => {
    _mockResponse = 'I cannot classify these items because...';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(0);
  });

  it('returns empty map for empty items', async () => {
    const results = await classifyWithAI([], '/tmp/vault');
    expect(results.size).toBe(0);
  });
});
