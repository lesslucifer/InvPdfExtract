import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeRunner } from './claude-cli';

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
      expect(() => runner.parseResponse(truncated)).toThrow('output appears truncated');
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
  });
});
