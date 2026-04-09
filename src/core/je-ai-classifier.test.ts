import { describe, it, expect, vi } from 'vitest';

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
  { id: 'li-1', recordId: 'r1', docType: 'invoice_in', description: 'Van phong pham' },
  { id: 'li-2', recordId: 'r1', docType: 'invoice_in', description: 'Dich vu tu van' },
];

describe('JE AI Classifier - response parsing', () => {
  it('parses clean JSON array', async () => {
    _mockResponse = '[{"id":"li-1","account":"6422","cash_flow":"operating"},{"id":"li-2","account":"642","cash_flow":"operating"}]';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(2);
    expect(results.get('li-1')!.account).toBe('6422');
    expect(results.get('li-2')!.account).toBe('642');
  });

  it('parses JSON wrapped in markdown fences', async () => {
    _mockResponse = '```json\n[{"id":"li-1","account":"156","cash_flow":"operating"}]\n```';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.account).toBe('156');
  });

  it('parses JSON with surrounding prose', async () => {
    _mockResponse = 'Here are the classifications:\n\n[{"id":"li-1","account":"156","cash_flow":"operating"}]\n\nLet me know if you need changes.';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.account).toBe('156');
  });

  it('parses JSON object with results array', async () => {
    _mockResponse = '{"results":[{"id":"li-1","account":"642","cash_flow":"operating"}]}';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.account).toBe('642');
  });

  it('handles markdown fences with no language tag', async () => {
    _mockResponse = '```\n[{"id":"li-1","account":"156","cash_flow":"operating"}]\n```';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
  });

  it('skips entries missing required fields', async () => {
    _mockResponse = '[{"id":"li-1","account":"156","cash_flow":"operating"},{"id":"li-2"}]';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1); // li-2 missing account
  });

  it('throws on unparseable response', async () => {
    _mockResponse = 'I cannot classify these items because...';

    await expect(classifyWithAI(sampleItems, '/tmp/vault')).rejects.toThrow(SyntaxError);
  });

  it('returns empty map for empty items', async () => {
    const results = await classifyWithAI([], '/tmp/vault');
    expect(results.size).toBe(0);
  });
});
