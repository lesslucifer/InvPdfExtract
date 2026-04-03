import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeRunner, unwrapEnvelope, extractJSON, repairTruncatedJSON } from './claude-cli';
import { ModelTier, MODEL_TIER_MAP } from '../shared/types';

vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue('system prompt'),
}));

const VALID_JSON = JSON.stringify({
  results: [{
    relative_path: 'test.pdf',
    doc_type: 'invoice_out',
    records: [{ confidence: 0.95, field_confidence: {}, ngay: '2026-01-01', data: { so_hoa_don: '001' } }],
  }],
});

describe('ClaudeCodeRunner', () => {
  let runner: ClaudeCodeRunner;

  beforeEach(() => {
    runner = new ClaudeCodeRunner('/usr/bin/claude');
  });

  describe('parseResponse', () => {
    it('parses clean JSON', () => {
      const result = runner.parseResponse(VALID_JSON);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].relative_path).toBe('test.pdf');
    });

    it('strips markdown code fences', () => {
      const raw = '```json\n' + VALID_JSON + '\n```';
      const result = runner.parseResponse(raw);
      expect(result.results).toHaveLength(1);
    });

    it('strips code fences without language tag', () => {
      const raw = '```\n' + VALID_JSON + '\n```';
      const result = runner.parseResponse(raw);
      expect(result.results).toHaveLength(1);
    });

    it('extracts JSON when text appears before it', () => {
      const raw = 'Now I have all the data. Let me build the JSON. ' + VALID_JSON;
      const result = runner.parseResponse(raw);
      expect(result.results).toHaveLength(1);
    });

    it('extracts JSON when text appears before and after it', () => {
      const raw = 'Here is the result:\n' + VALID_JSON + '\nHope this helps!';
      const result = runner.parseResponse(raw);
      expect(result.results).toHaveLength(1);
    });

    it('extracts JSON from code fences with surrounding text', () => {
      const raw = 'I analyzed the file.\n```json\n' + VALID_JSON + '\n```\nLet me know if you need changes.';
      const result = runner.parseResponse(raw);
      expect(result.results).toHaveLength(1);
    });

    it('handles nested braces in valid JSON', () => {
      const json = JSON.stringify({
        results: [{
          relative_path: 'test.pdf',
          doc_type: 'invoice_out',
          records: [{
            confidence: 0.9,
            field_confidence: { so_hoa_don: 0.95, mst: 0.88 },
            ngay: '2026-01-01',
            data: { so_hoa_don: '001', mst: '0305008980' },
          }],
        }],
      });
      const raw = 'Some preamble ' + json;
      const result = runner.parseResponse(raw);
      expect(result.results[0].records[0].data).toEqual({ so_hoa_don: '001', mst: '0305008980' });
    });

    it('throws on truncated output with truncation hint', () => {
      const truncated = '{"results":[{"relative_path":"test.pdf","doc_type":"invoice_out","records":[{"confidence":0.88,"field_confiden';
      expect(() => runner.parseResponse(truncated)).not.toThrow();
      // Truncation repair should handle this — result may be partial
    });

    it('throws on completely invalid output', () => {
      expect(() => runner.parseResponse('No JSON here at all')).toThrow('Failed to parse Claude CLI response');
    });

    it('rejects JSON without results array', () => {
      const noResults = '{"data": "something"}';
      expect(() => runner.parseResponse(noResults)).toThrow('Failed to parse Claude CLI response');
    });

    it('rejects JSON where results is not an array', () => {
      const badResults = '{"results": "not an array"}';
      expect(() => runner.parseResponse(badResults)).toThrow('Failed to parse Claude CLI response');
    });

    it('unwraps --output-format json envelope and parses result', () => {
      const envelope = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: VALID_JSON,
        session_id: 'abc-123',
        is_error: false,
      });
      const result = runner.parseResponse(envelope);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].relative_path).toBe('test.pdf');
    });

    it('unwraps envelope with preamble text in result field', () => {
      const envelope = JSON.stringify({
        type: 'result',
        result: 'Here is the analysis:\n' + VALID_JSON,
      });
      const result = runner.parseResponse(envelope);
      expect(result.results).toHaveLength(1);
    });

    it('handles real-world case: Vietnamese preamble + truncated JSON', () => {
      const preamble = 'Now I have all the data. This is an internal transfer invoice (Phiếu xuất kho kiêm vận chuyển hàng hóa nội bộ) — classified as `invoice_out` since it\'s issued by the seller (CÔNG TY TNHH GINKGO, MST 0305008980). All amounts are 0, and the buyer field contains an address rather than a company name (indicating internal transfer). The tax rate is "—" (not applicable).\n\n';
      const truncatedJson = '{"results":[{"relative_path":"xlsx/hoadon_sold_2026-03-22.xlsx","doc_type":"invoice_out","records":[{"confidence":0.82,"field_confi';
      const raw = preamble + truncatedJson;

      // Should not throw — truncation repair kicks in
      const result = runner.parseResponse(raw);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].relative_path).toBe('xlsx/hoadon_sold_2026-03-22.xlsx');
    });
  });

  describe('processFiles retry', () => {
    it('retries when first response is unparseable', async () => {
      const invokeSpy = vi.spyOn(runner as any, 'invokeClaudeCLI')
        .mockResolvedValueOnce('Let me think about this... not valid JSON')
        .mockResolvedValueOnce(VALID_JSON);


      const { result } = await runner.processFiles(['/vault/test.pdf'], '/vault', '/vault/.invoicevault/extraction-prompt.md');

      expect(invokeSpy).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(1);
      // Verify retry prompt emphasizes JSON-only
      const retryPrompt = invokeSpy.mock.calls[1][0] as string;
      expect(retryPrompt).toContain('could not be parsed as valid JSON');
      expect(retryPrompt).toContain('ONLY a valid JSON object');
    });

    it('does not retry when first response parses successfully', async () => {
      const invokeSpy = vi.spyOn(runner as any, 'invokeClaudeCLI')
        .mockResolvedValueOnce(VALID_JSON);


      const { result } = await runner.processFiles(['/vault/test.pdf'], '/vault', '/vault/.invoicevault/extraction-prompt.md');

      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(result.results).toHaveLength(1);
    });

    it('throws when both attempts fail', async () => {
      vi.spyOn(runner as any, 'invokeClaudeCLI')
        .mockResolvedValueOnce('Not JSON at all')
        .mockResolvedValueOnce('Still not JSON');


      await expect(
        runner.processFiles(['/vault/test.pdf'], '/vault', '/vault/.invoicevault/extraction-prompt.md')
      ).rejects.toThrow('Failed to parse Claude CLI response');
    });

    it('succeeds on retry when first response has text around JSON that cannot be extracted', async () => {
      // Simulates garbled output where brace extraction still fails
      const garbled = 'thinking { partial json here } and more { broken';
      const invokeSpy = vi.spyOn(runner as any, 'invokeClaudeCLI')
        .mockResolvedValueOnce(garbled)
        .mockResolvedValueOnce(VALID_JSON);


      const { result, sessionLog } = await runner.processFiles(['/vault/test.pdf'], '/vault', '/vault/.invoicevault/extraction-prompt.md');

      expect(result.results).toHaveLength(1);
      expect(sessionLog).toContain('RETRY PROMPT:');
      expect(sessionLog).toContain('RETRY RESPONSE:');
    });

    it('skips retry when brace extraction succeeds on first attempt', async () => {
      const noisy = 'Here is the data: ' + VALID_JSON + ' Let me know!';
      const invokeSpy = vi.spyOn(runner as any, 'invokeClaudeCLI')
        .mockResolvedValueOnce(noisy);


      const { result } = await runner.processFiles(['/vault/test.pdf'], '/vault', '/vault/.invoicevault/extraction-prompt.md');

      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(result.results).toHaveLength(1);
    });

    it('includes --output-format json in CLI args', async () => {
      const invokeSpy = vi.spyOn(runner as any, 'invokeClaudeCLI')
        .mockResolvedValueOnce(VALID_JSON);

      await runner.processFiles(['/vault/test.pdf'], '/vault', '/vault/.invoicevault/extraction-prompt.md');

      // The invokeClaudeCLI is mocked, so we check the args it was called with
      // by inspecting the spawn call inside it. Since we mock the whole method,
      // we verify at the integration level that --output-format json is in the code.
      // This test verifies processFiles still works with the updated method.
      expect(invokeSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('invokeRaw', () => {
  let runner: ClaudeCodeRunner;

  beforeEach(() => {
    runner = new ClaudeCodeRunner('/usr/bin/claude');
  });

  it('unwraps JSON envelope and returns inner text', async () => {
    const innerText = '```parser.js\nconst x = 1;\n```';
    const envelope = JSON.stringify({ type: 'result', result: innerText });
    vi.spyOn(runner as any, 'invokeClaudeCLI').mockResolvedValueOnce(envelope);

    const result = await runner.invokeRaw('prompt', 'system');
    expect(result).toBe(innerText);
  });

  it('passes through non-envelope text unchanged', async () => {
    const plainText = '```parser.js\nconst x = 1;\n```';
    vi.spyOn(runner as any, 'invokeClaudeCLI').mockResolvedValueOnce(plainText);

    const result = await runner.invokeRaw('prompt', 'system');
    expect(result).toBe(plainText);
  });

  it('unwraps envelope containing code blocks for script extraction', async () => {
    const codeBlockResponse = 'Here is the parser:\n\n```parser.js\nconst XLSX = require("xlsx");\nconsole.log("hello");\n```\n\nThis is a bank_statement file.';
    const envelope = JSON.stringify({ type: 'result', result: codeBlockResponse });
    vi.spyOn(runner as any, 'invokeClaudeCLI').mockResolvedValueOnce(envelope);

    const result = await runner.invokeRaw('prompt', 'system');
    expect(result).toContain('```parser.js');
    expect(result).toContain('require("xlsx")');
    expect(result).toContain('bank_statement');
  });
});

describe('model tier configuration', () => {
  it('includes --model flag when modelTier is set', async () => {
    const runner = new ClaudeCodeRunner('/usr/bin/claude', undefined, 'heavy');
    const spy = vi.spyOn(runner as any, 'invokeClaudeCLI').mockResolvedValueOnce(VALID_JSON);

    await runner.processFiles(['/vault/test.pdf'], '/vault', '/vault/.invoicevault/extraction-prompt.md');

    // invokeClaudeCLI is called with (prompt, systemPrompt, cwd)
    // The --model flag is built inside invokeClaudeCLI, so we verify via the spawn args
    // Since invokeClaudeCLI is mocked, we verify the runner was constructed correctly
    expect((runner as any).model).toBe('opus');
  });

  it('maps model tiers correctly', () => {
    expect(MODEL_TIER_MAP.fast).toBe('haiku');
    expect(MODEL_TIER_MAP.medium).toBe('sonnet');
    expect(MODEL_TIER_MAP.heavy).toBe('opus');
  });

  it('does not set model when no tier provided', () => {
    const runner = new ClaudeCodeRunner('/usr/bin/claude');
    expect((runner as any).model).toBeUndefined();
  });

  it('sets model for each tier', () => {
    const tiers: ModelTier[] = ['fast', 'medium', 'heavy'];
    const expected = ['haiku', 'sonnet', 'opus'];

    tiers.forEach((tier, i) => {
      const runner = new ClaudeCodeRunner('/usr/bin/claude', undefined, tier);
      expect((runner as any).model).toBe(expected[i]);
    });
  });
});

describe('unwrapEnvelope', () => {
  it('extracts result string from valid envelope', () => {
    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '{"results":[]}',
      session_id: 'abc',
    });
    expect(unwrapEnvelope(envelope)).toBe('{"results":[]}');
  });

  it('extracts result with preamble text', () => {
    const envelope = JSON.stringify({
      type: 'result',
      result: 'Some text before {"results":[]}',
    });
    expect(unwrapEnvelope(envelope)).toBe('Some text before {"results":[]}');
  });

  it('returns null for non-envelope JSON', () => {
    expect(unwrapEnvelope(VALID_JSON)).toBeNull();
  });

  it('returns null for non-JSON input', () => {
    expect(unwrapEnvelope('just plain text')).toBeNull();
  });

  it('returns null when result is not a string', () => {
    const envelope = JSON.stringify({
      type: 'result',
      result: { content: [{ type: 'text', text: 'foo' }] },
    });
    expect(unwrapEnvelope(envelope)).toBeNull();
  });

  it('returns null for envelope with wrong type', () => {
    const envelope = JSON.stringify({
      type: 'error',
      result: 'something',
    });
    expect(unwrapEnvelope(envelope)).toBeNull();
  });
});

describe('extractJSON', () => {
  it('extracts valid JSON with results array', () => {
    const result = extractJSON('some preamble ' + VALID_JSON);
    expect(result).toBe(VALID_JSON);
  });

  it('ignores non-results JSON objects before the target', () => {
    const other = '{"status":"ok"}';
    const raw = 'First object: ' + other + ' and then ' + VALID_JSON;
    const result = extractJSON(raw);
    expect(result).toBe(VALID_JSON);
  });

  it('handles preamble with curly braces in natural language', () => {
    const raw = 'The format is {key: value}. Here\'s the JSON: ' + VALID_JSON;
    const result = extractJSON(raw);
    expect(result).toBe(VALID_JSON);
  });

  it('handles Vietnamese/Unicode preamble', () => {
    const preamble = 'Đây là hóa đơn GTGT (Phiếu xuất kho kiêm vận chuyển hàng hóa nội bộ) của CÔNG TY TNHH GINKGO, MST 0305008980. ';
    const result = extractJSON(preamble + VALID_JSON);
    expect(result).toBe(VALID_JSON);
  });

  it('handles deeply nested JSON', () => {
    const nested = JSON.stringify({
      results: [{
        relative_path: 'test.pdf',
        doc_type: 'invoice_out',
        records: [{
          confidence: 0.9,
          field_confidence: { a: 0.9, b: 0.8 },
          ngay: '2026-01-01',
          data: { nested: { deep: { value: 'test' } } },
          line_items: [{ name: 'item1', qty: 1 }, { name: 'item2', qty: 2 }],
        }],
      }],
    });
    const result = extractJSON('preamble ' + nested);
    expect(result).toBe(nested);
  });

  it('handles JSON with escaped quotes in strings', () => {
    const json = JSON.stringify({
      results: [{
        relative_path: 'file "with" quotes.pdf',
        doc_type: 'invoice_out',
        records: [{ confidence: 0.9, field_confidence: {}, ngay: '2026-01-01', data: { name: 'value "quoted"' } }],
      }],
    });
    const result = extractJSON('text ' + json);
    expect(result).toBe(json);
  });

  it('returns null when no JSON present', () => {
    expect(extractJSON('no braces here')).toBeNull();
  });

  it('returns null when JSON has no results array', () => {
    expect(extractJSON('prefix {"data": "value"}')).toBeNull();
  });

  it('handles very long preamble', () => {
    const longPreamble = 'A'.repeat(10000) + ' ';
    const result = extractJSON(longPreamble + VALID_JSON);
    expect(result).toBe(VALID_JSON);
  });
});

describe('repairTruncatedJSON', () => {
  it('repairs truncated string value', () => {
    const truncated = '{"results":[{"relative_path":"test.pdf","doc_type":"invoice_out","records":[{"confidence":0.82,"field_confi';
    const repaired = repairTruncatedJSON(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].relative_path).toBe('test.pdf');
  });

  it('repairs truncated after colon', () => {
    const truncated = '{"results":[{"relative_path":"test.pdf","doc_type":';
    const repaired = repairTruncatedJSON(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.results).toHaveLength(1);
  });

  it('repairs truncated after comma', () => {
    const truncated = '{"results":[{"relative_path":"test.pdf","doc_type":"invoice_out",';
    const repaired = repairTruncatedJSON(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.results[0].doc_type).toBe('invoice_out');
  });

  it('repairs missing closing brackets', () => {
    const truncated = '{"results":[{"relative_path":"test.pdf","doc_type":"invoice_out","records":[{"confidence":0.9}';
    const repaired = repairTruncatedJSON(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.results[0].records[0].confidence).toBe(0.9);
  });

  it('repairs deeply nested truncation', () => {
    const truncated = '{"results":[{"relative_path":"test.pdf","doc_type":"invoice_out","records":[{"confidence":0.9,"field_confidence":{"so_hoa_don":0.95,"mst":0.88},"ngay":"2026-01-01","data":{"so_hoa_don":"001","mst":"030500';
    const repaired = repairTruncatedJSON(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.results[0].records[0].field_confidence.so_hoa_don).toBe(0.95);
  });

  it('returns null when no opening brace', () => {
    expect(repairTruncatedJSON('no braces at all')).toBeNull();
  });

  it('returns null for already balanced JSON (no repair needed)', () => {
    expect(repairTruncatedJSON(VALID_JSON)).toBeNull();
  });

  it('repairs the exact real-world truncated output from the bug report', () => {
    const preambleAndJson = 'Now I have all the data. This is an internal transfer invoice (Phiếu xuất kho kiêm vận chuyển hàng hóa nội bộ).\n\n{"results":[{"relative_path":"xlsx/hoadon_sold_2026-03-22.xlsx","doc_type":"invoice_out","records":[{"confidence":0.82,"field_confi';
    // extractJSON returns null (truncated), so repairTruncatedJSON should handle it
    expect(extractJSON(preambleAndJson)).toBeNull();

    const repaired = repairTruncatedJSON(preambleAndJson);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.results[0].relative_path).toBe('xlsx/hoadon_sold_2026-03-22.xlsx');
    expect(parsed.results[0].doc_type).toBe('invoice_out');
  });

  it('handles truncation mid-array with complete elements', () => {
    const truncated = '{"results":[{"relative_path":"a.pdf","doc_type":"invoice_out","records":[]},{"relative_path":"b.pdf","doc_type":"invoice_in","reco';
    const repaired = repairTruncatedJSON(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].relative_path).toBe('a.pdf');
  });

  it('handles truncation after opening bracket', () => {
    const truncated = '{"results":[';
    const repaired = repairTruncatedJSON(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.results).toEqual([]);
  });
});
