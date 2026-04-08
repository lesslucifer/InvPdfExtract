import { SortDirection } from '../../shared/parse-query';

const NORMALIZED_INVOICE_CODE_SQL = "normalize_text(COALESCE(id2.invoice_code, bsd.invoice_code, ''))";
const RAW_INVOICE_NUMBER_SQL = "TRIM(COALESCE(id2.invoice_number, bsd.invoice_number, ''))";
const NORMALIZED_INVOICE_NUMBER_SQL = "normalize_text(COALESCE(id2.invoice_number, bsd.invoice_number, ''))";
const INVOICE_NUMBER_IS_TEXT_SQL = `CASE WHEN ${RAW_INVOICE_NUMBER_SQL} != '' AND ${RAW_INVOICE_NUMBER_SQL} NOT GLOB '*[^0-9]*' THEN 0 ELSE 1 END`;
const INVOICE_NUMBER_NUMERIC_SQL = `CASE WHEN ${INVOICE_NUMBER_IS_TEXT_SQL} = 0 THEN CAST(${RAW_INVOICE_NUMBER_SQL} AS INTEGER) END`;

export function buildInvoiceNumberOrderBy(direction: SortDirection): string {
  const dir = direction.toUpperCase();
  return `ORDER BY ${NORMALIZED_INVOICE_CODE_SQL} ${dir}, ${INVOICE_NUMBER_IS_TEXT_SQL} ASC, ${INVOICE_NUMBER_NUMERIC_SQL} ${dir}, ${NORMALIZED_INVOICE_NUMBER_SQL} ${dir}, r.updated_at DESC`;
}

export function isIntegerLikeInvoiceNumber(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && /^\d+$/.test(trimmed);
}
