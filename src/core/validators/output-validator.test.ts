import { describe, it, expect } from 'vitest';
import { validateScriptOutput } from './output-validator';
import { DocType, ExtractionFileResult } from '../../shared/types';

function makeValidResult(overrides?: Partial<ExtractionFileResult>): ExtractionFileResult {
  return {
    relative_path: 'test.xlsx',
    doc_type: DocType.InvoiceIn,
    records: [{
      confidence: 1.0,
      field_confidence: { total_amount: 1.0 },
      doc_date: '2026-01-15',
      data: {
        invoice_code: 'C26TAA',
        invoice_number: '00000123',
        total_before_tax: 100000,
        total_amount: 108000,
        tax_id: '0305008980',
        counterparty_name: 'Test Corp',
      },
      line_items: [{
        description: 'Service A',
        unit_price: 100000,
        quantity: 1,
        tax_rate: 8,
        subtotal: 100000,
        total_with_tax: 108000,
      }],
    }],
    ...overrides,
  };
}

describe('Output Validator', () => {
  describe('valid output', () => {
    it('passes for well-formed invoice result', () => {
      const result = validateScriptOutput(makeValidResult());
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('passes for bank statement result', () => {
      const result = validateScriptOutput(makeValidResult({
        doc_type: DocType.BankStatement,
        records: [{
          confidence: 1.0,
          field_confidence: { amount: 1.0 },
          doc_date: '2026-01-15',
          data: {
            bank_name: 'Vietcombank',
            account_number: '1234567890',
            amount: 500000,
            description: 'Payment',
            counterparty_name: 'Test',
          },
        }],
      }));
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid doc_type', () => {
    it('rejects unknown doc_type', () => {
      const result = validateScriptOutput(makeValidResult({
        doc_type: 'foobar' as DocType,
      }));
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('Invalid doc_type');
    });

    it('rejects DocType.Unknown', () => {
      const result = validateScriptOutput(makeValidResult({
        doc_type: DocType.Unknown,
      }));
      expect(result.valid).toBe(false);
    });
  });

  describe('empty records', () => {
    it('rejects empty records array', () => {
      const result = validateScriptOutput(makeValidResult({ records: [] }));
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('No records');
    });
  });

  describe('NaN detection', () => {
    it('rejects NaN in total_amount', () => {
      const input = makeValidResult();
      (input.records[0].data as Record<string, unknown>).total_amount = NaN;
      const result = validateScriptOutput(input);
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('NaN');
    });

    it('rejects NaN in line item tax_rate', () => {
      const input = makeValidResult();
      input.records[0].line_items![0].tax_rate = NaN;
      const result = validateScriptOutput(input);
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('NaN');
    });

    it('rejects NaN in line item subtotal', () => {
      const input = makeValidResult();
      input.records[0].line_items![0].subtotal = NaN;
      const result = validateScriptOutput(input);
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('NaN');
    });
  });

  describe('decimal tax_rate warning', () => {
    it('warns about decimal tax rates (< 1)', () => {
      const input = makeValidResult();
      input.records[0].line_items![0].tax_rate = 0.08;
      const result = validateScriptOutput(input);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('decimal tax_rate');
    });
  });

  describe('all null amounts', () => {
    it('rejects when all records have null amount fields', () => {
      const result = validateScriptOutput(makeValidResult({
        records: [
          {
            confidence: 1.0,
            field_confidence: {},
            doc_date: '2026-01-15',
            data: {
              invoice_code: 'C26TAA',
              invoice_number: '00000123',
              counterparty_name: 'Test',
            },
          },
          {
            confidence: 1.0,
            field_confidence: {},
            doc_date: '2026-01-16',
            data: {
              invoice_code: 'C26TAB',
              invoice_number: '00000124',
              counterparty_name: 'Test 2',
            },
          },
        ],
      }));
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('null/undefined amount');
    });
  });

  describe('parser-reported errors', () => {
    it('passes with few non-critical parsing errors', () => {
      const input = makeValidResult();
      input._parsing_errors = [
        { row: 0, field: 'description', rawValue: null, error: 'Empty value' },
      ];
      const result = validateScriptOutput(input);
      expect(result.valid).toBe(true);
    });

    it('rejects when critical field errors exceed threshold', () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        confidence: 1.0,
        field_confidence: { total_amount: 1.0 },
        doc_date: '2026-01-15',
        data: {
          invoice_code: 'C26TAA',
          invoice_number: `0000${i}`,
          total_before_tax: 100000,
          total_amount: 108000,
          tax_id: '0305008980',
          counterparty_name: 'Test',
        },
      }));

      const input = makeValidResult({ records });
      input._parsing_errors = Array.from({ length: 8 }, (_, i) => ({
        row: i,
        field: 'tax_rate',
        rawValue: '8%',
        error: 'Not a number',
      }));

      const result = validateScriptOutput(input);
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('critical field errors');
    });

    it('passes when critical field errors are below threshold', () => {
      const records = Array.from({ length: 100 }, (_, i) => ({
        confidence: 1.0,
        field_confidence: { total_amount: 1.0 },
        doc_date: '2026-01-15',
        data: {
          invoice_code: 'C26TAA',
          invoice_number: `0000${i}`,
          total_before_tax: 100000,
          total_amount: 108000,
          tax_id: `03050089${String(i).padStart(2, '0')}`,
          counterparty_name: 'Test',
        },
      }));

      const input = makeValidResult({ records });
      input._parsing_errors = [
        { row: 0, field: 'tax_rate', rawValue: 'N/A', error: 'Not a number' },
      ];

      const result = validateScriptOutput(input);
      expect(result.valid).toBe(true);
    });
  });

  describe('uniform tax_id detection', () => {
    it('rejects when all invoice records have the same tax_id', () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        confidence: 1.0,
        field_confidence: { total_amount: 1.0 },
        doc_date: '2026-01-15',
        data: {
          invoice_code: 'C26TAA',
          invoice_number: `0000${i}`,
          total_before_tax: 100000,
          total_amount: 108000,
          tax_id: '0305008980',
          counterparty_name: `Supplier ${i}`,
        },
      }));

      const result = validateScriptOutput(makeValidResult({ records }));
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('same tax_id');
      expect(result.warnings[0]).toContain('0305008980');
    });

    it('passes when records have different tax_ids', () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        confidence: 1.0,
        field_confidence: { total_amount: 1.0 },
        doc_date: '2026-01-15',
        data: {
          invoice_code: 'C26TAA',
          invoice_number: `0000${i}`,
          total_before_tax: 100000,
          total_amount: 108000,
          tax_id: `030500898${i}`,
          counterparty_name: `Supplier ${i}`,
        },
      }));

      const result = validateScriptOutput(makeValidResult({ records }));
      expect(result.valid).toBe(true);
    });

    it('skips uniform tax_id check for bank statements', () => {
      const records = Array.from({ length: 10 }, (_, i) => ({
        confidence: 1.0,
        field_confidence: { amount: 1.0 },
        doc_date: '2026-01-15',
        data: {
          bank_name: 'Vietcombank',
          account_number: '1234567890',
          amount: 100000 * (i + 1),
          description: `Payment ${i}`,
          counterparty_name: `Company ${i}`,
        },
      }));

      const result = validateScriptOutput(makeValidResult({
        doc_type: DocType.BankStatement,
        records,
      }));
      expect(result.valid).toBe(true);
    });

    it('skips uniform tax_id check when fewer than 5 records', () => {
      const records = Array.from({ length: 3 }, (_, i) => ({
        confidence: 1.0,
        field_confidence: { total_amount: 1.0 },
        doc_date: '2026-01-15',
        data: {
          invoice_code: 'C26TAA',
          invoice_number: `0000${i}`,
          total_before_tax: 100000,
          total_amount: 108000,
          tax_id: '0305008980',
          counterparty_name: `Supplier ${i}`,
        },
      }));

      const result = validateScriptOutput(makeValidResult({ records }));
      expect(result.valid).toBe(true);
    });
  });

  describe('doc_type mismatch with script', () => {
    it('rejects when script is invoice_out but result is invoice_in', () => {
      const result = validateScriptOutput(
        makeValidResult({ doc_type: DocType.InvoiceIn }),
        { scriptDocType: DocType.InvoiceOut },
      );
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('input/output invoice mismatch');
    });

    it('rejects when script is invoice_in but result is invoice_out', () => {
      const result = validateScriptOutput(
        makeValidResult({ doc_type: DocType.InvoiceOut }),
        { scriptDocType: DocType.InvoiceIn },
      );
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain('input/output invoice mismatch');
    });

    it('passes when script and result doc_type match', () => {
      const result = validateScriptOutput(
        makeValidResult({ doc_type: DocType.InvoiceIn }),
        { scriptDocType: DocType.InvoiceIn },
      );
      expect(result.valid).toBe(true);
    });

    it('passes when no scriptDocType is provided', () => {
      const result = validateScriptOutput(makeValidResult());
      expect(result.valid).toBe(true);
    });
  });
});
