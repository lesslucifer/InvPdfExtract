import { DocType, ExtractionFileResult, ExtractionInvoiceData, ExtractionLineItem, ParsingError } from '../../shared/types';

export interface OutputValidationResult {
  valid: boolean;
  warnings: string[];
}

export interface OutputValidationOptions {
  scriptDocType?: string;
}

const VALID_DOC_TYPES: Set<string> = new Set([DocType.BankStatement, DocType.InvoiceOut, DocType.InvoiceIn]);

const NUMERIC_DATA_FIELDS = ['amount', 'total_amount', 'total_before_tax', 'unit_price'] as const;
const NUMERIC_LINE_ITEM_FIELDS = ['unit_price', 'quantity', 'tax_rate', 'subtotal', 'total_with_tax'] as const;
const CRITICAL_FIELDS = new Set(['total_amount', 'total_before_tax', 'amount', 'subtotal', 'tax_rate']);

const PARSING_ERROR_RATE_THRESHOLD = 0.05;

function hasNaN(obj: Record<string, unknown>, fields: readonly string[]): string[] {
  const nanFields: string[] = [];
  for (const field of fields) {
    const val = obj[field];
    if (typeof val === 'number' && isNaN(val)) {
      nanFields.push(field);
    }
  }
  return nanFields;
}

function checkLineItemsForNaN(lineItems: ExtractionLineItem[]): string[] {
  const nanFields: string[] = [];
  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i] as Record<string, unknown>;
    for (const field of NUMERIC_LINE_ITEM_FIELDS) {
      const val = item[field];
      if (typeof val === 'number' && isNaN(val)) {
        nanFields.push(`line_items[${i}].${field}`);
      }
    }
  }
  return nanFields;
}

function evaluateParsingErrors(errors: ParsingError[], totalRecords: number): { valid: boolean; warnings: string[] } {
  if (errors.length === 0) return { valid: true, warnings: [] };

  const warnings: string[] = [];
  const criticalErrors = errors.filter(e => CRITICAL_FIELDS.has(e.field));

  if (criticalErrors.length > 0) {
    const affectedRate = totalRecords > 0 ? criticalErrors.length / totalRecords : 1;
    if (affectedRate > PARSING_ERROR_RATE_THRESHOLD) {
      warnings.push(
        `${criticalErrors.length} critical field errors in ${totalRecords} records (${(affectedRate * 100).toFixed(0)}% affected): ${[...new Set(criticalErrors.map(e => e.field))].join(', ')}`,
      );
      return { valid: false, warnings };
    }
  }

  if (errors.length > 0) {
    warnings.push(`${errors.length} non-critical parsing errors`);
  }
  return { valid: true, warnings };
}

const UNIFORM_TAX_ID_MIN_RECORDS = 5;

export function validateScriptOutput(result: ExtractionFileResult, options: OutputValidationOptions = {}): OutputValidationResult {
  const warnings: string[] = [];

  if (!VALID_DOC_TYPES.has(result.doc_type)) {
    return { valid: false, warnings: [`Invalid doc_type: ${result.doc_type}`] };
  }

  if (!result.records || result.records.length === 0) {
    return { valid: false, warnings: ['No records extracted'] };
  }

  // Check parser-reported errors
  if (result._parsing_errors && result._parsing_errors.length > 0) {
    const parsingResult = evaluateParsingErrors(result._parsing_errors, result.records.length);
    warnings.push(...parsingResult.warnings);
    if (!parsingResult.valid) return { valid: false, warnings };
  }

  // Check for NaN in numeric fields
  const allNanFields: string[] = [];
  for (let i = 0; i < result.records.length; i++) {
    const record = result.records[i];
    const data = record.data as Record<string, unknown>;
    const dataNan = hasNaN(data, NUMERIC_DATA_FIELDS);
    allNanFields.push(...dataNan.map(f => `records[${i}].data.${f}`));

    if (record.line_items && record.line_items.length > 0) {
      const liNan = checkLineItemsForNaN(record.line_items);
      allNanFields.push(...liNan.map(f => `records[${i}].${f}`));
    }
  }

  if (allNanFields.length > 0) {
    return {
      valid: false,
      warnings: [`NaN values in numeric fields: ${allNanFields.slice(0, 10).join(', ')}${allNanFields.length > 10 ? ` (+${allNanFields.length - 10} more)` : ''}`],
    };
  }

  // Check for decimal tax rates (likely not multiplied by 100)
  for (const record of result.records) {
    if (record.line_items) {
      const decimalRates = record.line_items.filter(
        li => typeof li.tax_rate === 'number' && li.tax_rate > 0 && li.tax_rate < 1,
      );
      if (decimalRates.length > 0) {
        warnings.push(`${decimalRates.length} line items have decimal tax_rate (< 1), likely needs ×100`);
      }
    }
  }

  // Check if all critical amount fields are null/undefined across all records
  const hasAnyAmount = result.records.some(r => {
    const data = r.data as Record<string, unknown>;
    return data.total_amount != null || data.total_before_tax != null || data.amount != null;
  });
  if (!hasAnyAmount) {
    return { valid: false, warnings: ['All records have null/undefined amount fields'] };
  }

  // Check for uniform tax_id across all invoice records — likely wrong MST column
  // (parser reads own company MST instead of counterparty MST)
  const isInvoice = result.doc_type === DocType.InvoiceIn || result.doc_type === DocType.InvoiceOut;
  if (isInvoice && result.records.length >= UNIFORM_TAX_ID_MIN_RECORDS) {
    const taxIds = new Set<string>();
    for (const record of result.records) {
      const inv = record.data as ExtractionInvoiceData;
      if (inv.tax_id != null && inv.tax_id !== '') taxIds.add(inv.tax_id);
    }
    if (taxIds.size === 1) {
      const singleTaxId = [...taxIds][0];
      return {
        valid: false,
        warnings: [`All ${result.records.length} records have the same tax_id "${singleTaxId}" — parser likely reads own company MST instead of counterparty`],
      };
    }
  }

  // Check if script's registered doc_type contradicts the result doc_type
  if (options.scriptDocType && options.scriptDocType !== result.doc_type) {
    const scriptIsOut = options.scriptDocType === DocType.InvoiceOut;
    const resultIsIn = result.doc_type === DocType.InvoiceIn;
    const scriptIsIn = options.scriptDocType === DocType.InvoiceIn;
    const resultIsOut = result.doc_type === DocType.InvoiceOut;
    if ((scriptIsOut && resultIsIn) || (scriptIsIn && resultIsOut)) {
      return {
        valid: false,
        warnings: [`Script doc_type "${options.scriptDocType}" contradicts result doc_type "${result.doc_type}" — input/output invoice mismatch`],
      };
    }
  }

  return { valid: true, warnings };
}
