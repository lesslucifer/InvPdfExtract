import { describe, it, expect, vi } from 'vitest';

let _mockResponse = '';
let _capturedPrompt = '';

vi.mock('./claude-cli', () => ({
  ClaudeCodeRunner: class {
    async invokeRaw(prompt: string) {
      _capturedPrompt = prompt;
      return _mockResponse;
    }
  },
}));

vi.mock('./je-instructions', () => ({
  readInstructions: vi.fn().mockReturnValue('test instructions'),
}));

import { classifyWithAI } from './je-ai-classifier';

const sampleItems = [
  { id: 'li-1', recordId: 'r1', docType: 'invoice_in', description: 'Van phong pham' },
  { id: 'li-2', recordId: 'r1', docType: 'invoice_in', description: 'Dich vu tu van' },
];

describe('JE AI Classifier - response parsing', () => {
  it('parses clean JSON array', async () => {
    _mockResponse = '[{"id":1,"account":"6422","cash_flow":"operating"},{"id":2,"account":"642","cash_flow":"operating"}]';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(2);
    expect(results.get('li-1')!.account).toBe('6422');
    expect(results.get('li-2')!.account).toBe('642');
  });

  it('parses JSON wrapped in markdown fences', async () => {
    _mockResponse = '```json\n[{"id":1,"account":"156","cash_flow":"operating"}]\n```';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.account).toBe('156');
  });

  it('parses JSON with surrounding prose', async () => {
    _mockResponse = 'Here are the classifications:\n\n[{"id":1,"account":"156","cash_flow":"operating"}]\n\nLet me know if you need changes.';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.account).toBe('156');
  });

  it('parses JSON object with results array', async () => {
    _mockResponse = '{"results":[{"id":1,"account":"642","cash_flow":"operating"}]}';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
    expect(results.get('li-1')!.account).toBe('642');
  });

  it('handles markdown fences with no language tag', async () => {
    _mockResponse = '```\n[{"id":1,"account":"156","cash_flow":"operating"}]\n```';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
  });

  it('skips entries missing required fields', async () => {
    _mockResponse = '[{"id":1,"account":"156","cash_flow":"operating"},{"id":2}]';

    const results = await classifyWithAI(sampleItems, '/tmp/vault');
    expect(results.size).toBe(1);
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

describe('JE AI Classifier - dedup', () => {
  it('deduplicates items with same description and docType', async () => {
    const items = [
      { id: 'a1', recordId: 'r1', docType: 'invoice_in', description: 'Ao thun nam' },
      { id: 'a2', recordId: 'r2', docType: 'invoice_in', description: 'Ao thun nam' },
      { id: 'a3', recordId: 'r3', docType: 'invoice_in', description: 'Ao thun nam' },
      { id: 'b1', recordId: 'r1', docType: 'invoice_in', description: 'Van phong pham' },
      { id: 'c1', recordId: 'r1', docType: 'invoice_in', description: 'Dich vu tu van' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '156', cash_flow: 'operating' },
      { id: 2, account: '6422', cash_flow: 'operating' },
      { id: 3, account: '642', cash_flow: 'operating' },
    ]);

    const results = await classifyWithAI(items, '/tmp/vault');

    expect(results.size).toBe(5);
    expect(results.get('a1')!.account).toBe('156');
    expect(results.get('a2')!.account).toBe('156');
    expect(results.get('a3')!.account).toBe('156');
    expect(results.get('b1')!.account).toBe('6422');
    expect(results.get('c1')!.account).toBe('642');

    expect(_capturedPrompt).toContain('3 accounting items');
  });

  it('groups near-duplicate descriptions via Dice similarity', async () => {
    const items = [
      { id: 'x1', recordId: 'r1', docType: 'invoice_in', description: 'Van phong pham thang 3' },
      { id: 'x2', recordId: 'r2', docType: 'invoice_in', description: 'Van phong pham thang 4' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '6422', cash_flow: 'operating' },
    ]);

    const results = await classifyWithAI(items, '/tmp/vault');

    expect(results.size).toBe(2);
    expect(results.get('x1')!.account).toBe('6422');
    expect(results.get('x2')!.account).toBe('6422');
  });

  it('does NOT group items with different docTypes', async () => {
    const items = [
      { id: 'd1', recordId: 'r1', docType: 'invoice_in', description: 'Ao thun nam' },
      { id: 'd2', recordId: 'r2', docType: 'invoice_out', description: 'Ao thun nam' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '156', cash_flow: 'operating' },
      { id: 2, account: '511', cash_flow: 'operating' },
    ]);

    const results = await classifyWithAI(items, '/tmp/vault');

    expect(results.size).toBe(2);
    expect(results.get('d1')!.account).toBe('156');
    expect(results.get('d2')!.account).toBe('511');

    expect(_capturedPrompt).toContain('2 accounting items');
  });

  it('strips monetary fields from prompt', async () => {
    const items = [
      {
        id: 'e1', recordId: 'r1', docType: 'invoice_in', description: 'Test item',
        totalWithTax: 7723861, subtotal: 7000000, taxRate: 8,
      },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '156', cash_flow: 'operating' },
    ]);

    await classifyWithAI(items, '/tmp/vault');

    expect(_capturedPrompt).not.toContain('VND');
    expect(_capturedPrompt).not.toContain('tax 8%');
    expect(_capturedPrompt).not.toContain('7723861');
  });

  it('strips VND amounts embedded in descriptions', async () => {
    const items = [
      { id: 'v1', recordId: 'r1', docType: 'invoice_out', description: 'Cong Ty TNHH Ginkgo - invoice_out - 20,000 VND' },
      { id: 'v2', recordId: 'r2', docType: 'invoice_out', description: 'Cong Ty TNHH Ginkgo - invoice_out - 32,449 VND' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '511', cash_flow: 'operating' },
    ]);

    const results = await classifyWithAI(items, '/tmp/vault');

    expect(results.size).toBe(2);
    expect(results.get('v1')!.account).toBe('511');
    expect(results.get('v2')!.account).toBe('511');
    expect(_capturedPrompt).not.toContain('20,000 VND');
    expect(_capturedPrompt).not.toContain('32,449 VND');
  });

  it('single item passes through unchanged', async () => {
    const items = [
      { id: 'f1', recordId: 'r1', docType: 'invoice_in', description: 'Solo item' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '331', cash_flow: 'operating' },
    ]);

    const results = await classifyWithAI(items, '/tmp/vault');

    expect(results.size).toBe(1);
    expect(results.get('f1')!.account).toBe('331');
    expect(results.get('f1')!.lineItemId).toBe('f1');
  });

  it('fans out lineItemId correctly per group member', async () => {
    const items = [
      { id: 'g1', recordId: 'r1', docType: 'invoice_in', description: 'Same thing' },
      { id: 'g2', recordId: 'r2', docType: 'invoice_in', description: 'Same thing' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '642', contra_account: '111', cash_flow: 'operating' },
    ]);

    const results = await classifyWithAI(items, '/tmp/vault');

    expect(results.get('g1')!.lineItemId).toBe('g1');
    expect(results.get('g2')!.lineItemId).toBe('g2');
    expect(results.get('g2')!.account).toBe('642');
    expect(results.get('g2')!.contraAccount).toBe('111');
  });

  it('uses 1-based numeric IDs instead of UUIDs in prompt', async () => {
    const items = [
      { id: 'abc-def-123-456', recordId: 'r1', docType: 'invoice_in', description: 'Item A' },
      { id: 'xyz-789-ghi-012', recordId: 'r2', docType: 'invoice_in', description: 'Item B' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '156', cash_flow: 'operating' },
      { id: 2, account: '642', cash_flow: 'operating' },
    ]);

    const results = await classifyWithAI(items, '/tmp/vault');

    expect(_capturedPrompt).not.toContain('abc-def-123-456');
    expect(_capturedPrompt).not.toContain('xyz-789-ghi-012');
    expect(_capturedPrompt).toContain('1.');
    expect(_capturedPrompt).toContain('2.');
    expect(results.get('abc-def-123-456')!.account).toBe('156');
    expect(results.get('xyz-789-ghi-012')!.account).toBe('642');
  });

  it('does not include TaxID in prompt', async () => {
    const items = [
      { id: 't1', recordId: 'r1', docType: 'invoice_in', description: 'Test', taxId: '0305008980' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '156', cash_flow: 'operating' },
    ]);

    await classifyWithAI(items, '/tmp/vault');

    expect(_capturedPrompt).not.toContain('TaxID');
    expect(_capturedPrompt).not.toContain('0305008980');
  });

  it('factors out common counterparty to header', async () => {
    const items = [
      { id: 'h1', recordId: 'r1', docType: 'invoice_out', description: 'Phi dich vu', counterpartyName: 'CONG TY TNHH GINKGO' },
      { id: 'h2', recordId: 'r2', docType: 'invoice_out', description: 'Cuoc van chuyen', counterpartyName: 'CONG TY TNHH GINKGO' },
      { id: 'h3', recordId: 'r3', docType: 'invoice_out', description: 'Quang cao', counterpartyName: 'Cong ty ABC' },
    ];

    _mockResponse = JSON.stringify([
      { id: 1, account: '511', cash_flow: 'operating' },
      { id: 2, account: '511', cash_flow: 'operating' },
      { id: 3, account: '511', cash_flow: 'operating' },
    ]);

    await classifyWithAI(items, '/tmp/vault');

    expect(_capturedPrompt).toContain('Counterparty: CONG TY TNHH GINKGO');
    const counterpartyMatches = _capturedPrompt.match(/counterparty:/gi) ?? [];
    expect(counterpartyMatches.length).toBe(2);
  });
});
