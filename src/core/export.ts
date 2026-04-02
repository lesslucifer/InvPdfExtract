import { getDatabase } from './db/database';
import { DocType } from '../shared/types';

export interface ExportOptions {
  filter?: string;
  includeDeleted?: boolean;
}

interface ExportData {
  bankStatements: any[];
  invoiceHeaders: any[];
  invoiceLineItems: any[];
}

/**
 * Gathers export data from the database, optionally filtered.
 * Returns structured data grouped by doc_type for Excel/CSV export.
 */
export function gatherExportData(options: ExportOptions = {}): ExportData {
  const db = getDatabase();
  const deletedClause = options.includeDeleted ? '' : 'AND r.deleted_at IS NULL';

  // Bank statements
  const bankStatements = db.prepare(`
    SELECT r.ngay, f.relative_path,
      bsd.ten_ngan_hang, bsd.stk, bsd.mo_ta, bsd.so_tien, bsd.ten_doi_tac,
      r.confidence
    FROM records r
    JOIN files f ON r.file_id = f.id
    JOIN bank_statement_data bsd ON r.id = bsd.record_id
    WHERE r.doc_type = ? ${deletedClause}
    ORDER BY r.ngay, bsd.stk
  `).all(DocType.BankStatement);

  // Invoice headers (both in and out)
  const invoiceHeaders = db.prepare(`
    SELECT r.id as record_id, r.doc_type, r.ngay, f.relative_path,
      id2.so_hoa_don, id2.tong_tien, id2.mst, id2.ten_doi_tac, id2.dia_chi_doi_tac,
      r.confidence
    FROM records r
    JOIN files f ON r.file_id = f.id
    JOIN invoice_data id2 ON r.id = id2.record_id
    WHERE r.doc_type IN (?, ?) ${deletedClause}
    ORDER BY r.doc_type, r.ngay, id2.so_hoa_don
  `).all(DocType.InvoiceIn, DocType.InvoiceOut);

  // Invoice line items
  const invoiceLineItems = db.prepare(`
    SELECT li.*, id2.so_hoa_don, r.doc_type, r.ngay
    FROM invoice_line_items li
    JOIN records r ON li.record_id = r.id
    JOIN invoice_data id2 ON r.id = id2.record_id
    WHERE r.doc_type IN (?, ?) ${deletedClause}
      AND li.deleted_at IS NULL
    ORDER BY r.doc_type, id2.so_hoa_don, li.line_number
  `).all(DocType.InvoiceIn, DocType.InvoiceOut);

  return { bankStatements, invoiceHeaders, invoiceLineItems };
}

/**
 * Converts export data to CSV format.
 * Returns a map of filename -> CSV content.
 */
export function exportToCsv(data: ExportData): Map<string, string> {
  const files = new Map<string, string>();

  // Bank statements CSV
  if (data.bankStatements.length > 0) {
    const headers = ['Ngày', 'Ngân hàng', 'STK', 'Mô tả', 'Số tiền', 'Đối tác', 'Confidence', 'File'];
    const rows = data.bankStatements.map(r => [
      r.ngay, r.ten_ngan_hang, r.stk, r.mo_ta, r.so_tien, r.ten_doi_tac, r.confidence, r.relative_path,
    ]);
    files.set('bank_statements.csv', toCsv(headers, rows));
  }

  // Invoice headers CSV
  if (data.invoiceHeaders.length > 0) {
    const headers = ['Loại', 'Ngày', 'Số HĐ', 'Tổng tiền', 'MST', 'Đối tác', 'Địa chỉ', 'Confidence', 'File'];
    const rows = data.invoiceHeaders.map(r => [
      r.doc_type, r.ngay, r.so_hoa_don, r.tong_tien, r.mst, r.ten_doi_tac, r.dia_chi_doi_tac, r.confidence, r.relative_path,
    ]);
    files.set('invoices.csv', toCsv(headers, rows));
  }

  // Line items CSV
  if (data.invoiceLineItems.length > 0) {
    const headers = ['Loại', 'Ngày', 'Số HĐ', '#', 'Mô tả', 'Đơn giá', 'Số lượng', 'Thuế suất', 'Thành tiền'];
    const rows = data.invoiceLineItems.map(r => [
      r.doc_type, r.ngay, r.so_hoa_don, r.line_number, r.mo_ta, r.don_gia, r.so_luong, r.thue_suat, r.thanh_tien,
    ]);
    files.set('line_items.csv', toCsv(headers, rows));
  }

  return files;
}

function toCsv(headers: string[], rows: any[][]): string {
  const escape = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  return lines.join('\n');
}
