import { getDatabase } from './db/database';
import { gatherFilteredExportData } from './db/records';
import { DocType } from '../shared/types';
import * as XLSX from 'xlsx';
import { t } from '../lib/i18n';

export interface ExportOptions {
  filter?: string;
  includeDeleted?: boolean;
}

type ExportData = ReturnType<typeof gatherFilteredExportData>;

/**
 * Gathers export data from the database, optionally filtered.
 * Returns structured data grouped by doc_type for Excel/CSV export.
 */
export function gatherExportData(options: ExportOptions = {}): ExportData {
  const db = getDatabase();
  const deletedClause = options.includeDeleted ? '' : 'AND r.deleted_at IS NULL';

  // Bank statements
  const bankStatements = db.prepare(`
    SELECT r.doc_date, f.relative_path,
      bsd.bank_name, bsd.account_number, bsd.description, bsd.amount, bsd.counterparty_name,
      r.confidence
    FROM records r
    JOIN files f ON r.file_id = f.id
    JOIN bank_statement_data bsd ON r.id = bsd.record_id
    WHERE r.doc_type = ? ${deletedClause}
    ORDER BY r.doc_date, bsd.account_number
  `).all(DocType.BankStatement);

  // Invoice headers (both in and out)
  const invoiceHeaders = db.prepare(`
    SELECT r.id as record_id, r.doc_type, r.doc_date, f.relative_path,
      id2.invoice_number, id2.total_amount, id2.tax_id, id2.counterparty_name, id2.counterparty_address,
      r.confidence
    FROM records r
    JOIN files f ON r.file_id = f.id
    JOIN invoice_data id2 ON r.id = id2.record_id
    WHERE r.doc_type IN (?, ?) ${deletedClause}
    ORDER BY r.doc_type, r.doc_date, id2.invoice_number
  `).all(DocType.InvoiceIn, DocType.InvoiceOut);

  // Invoice line items
  const invoiceLineItems = db.prepare(`
    SELECT li.*, id2.invoice_number, r.doc_type, r.doc_date
    FROM invoice_line_items li
    JOIN records r ON li.record_id = r.id
    JOIN invoice_data id2 ON r.id = id2.record_id
    WHERE r.doc_type IN (?, ?) ${deletedClause}
      AND li.deleted_at IS NULL
    ORDER BY r.doc_type, id2.invoice_number, li.line_number
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
    const headers = [t('ngay', 'Ngày'), t('ngan_hang', 'Ngân hàng'), t('stk', 'STK'), t('mo_ta', 'Mô tả'), t('so_tien', 'Số tiền'), t('doi_tac', 'Đối tác'), t('confidence', 'Confidence'), t('file', 'File')];
    const rows = data.bankStatements.map(r => [
      r.doc_date, r.bank_name, r.account_number, r.description, r.amount, r.counterparty_name, r.confidence, r.relative_path,
    ]);
    files.set('bank_statements.csv', toCsv(headers, rows));
  }

  // Invoice headers CSV
  if (data.invoiceHeaders.length > 0) {
    const headers = [t('loai', 'Loại'), t('ngay', 'Ngày'), t('so_hd', 'Số HĐ'), t('tong_tien_truoc_thue', 'Tổng tiền trước thuế'), t('tong_tien', 'Tổng tiền'), t('taxId', 'TaxID'), t('doi_tac', 'Đối tác'), t('dia_chi', 'Địa chỉ'), t('confidence', 'Confidence'), t('file', 'File')];
    const rows = data.invoiceHeaders.map(r => [
      r.doc_type, r.doc_date, r.invoice_number, r.total_before_tax, r.total_amount, r.tax_id, r.counterparty_name, r.counterparty_address, r.confidence, r.relative_path,
    ]);
    files.set('invoices.csv', toCsv(headers, rows));
  }

  // Line items CSV
  if (data.invoiceLineItems.length > 0) {
    const headers = [t('loai', 'Loại'), t('ngay', 'Ngày'), t('so_hd', 'Số HĐ'), t('#', '#'), t('mo_ta', 'Mô tả'), t('don_gia', 'Đơn giá'), t('so_luong', 'Số lượng'), t('thue_suat', 'Thuế suất'), t('thanh_tien_truoc_thue', 'Thành tiền trước thuế'), t('thanh_tien', 'Thành tiền')];
    const rows = data.invoiceLineItems.map(r => [
      r.doc_type, r.doc_date, r.invoice_number, r.line_number, r.description, r.unit_price, r.quantity, r.tax_rate, r.subtotal, r.total_with_tax,
    ]);
    files.set('line_items.csv', toCsv(headers, rows));
  }

  return files;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const escape = (val: unknown): string => {
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

/**
 * Exports data to a single XLSX file with multiple sheets.
 * Returns the XLSX buffer ready to write to disk.
 */
export function exportToXlsx(data: ExportData): Buffer {
  const wb = XLSX.utils.book_new();

  if (data.bankStatements.length > 0) {
    const headers = ['Ngay', 'Ngan hang', 'STK', 'Mo ta', 'So tien', 'Doi tac', 'Confidence', 'File'];
    const rows = data.bankStatements.map(r => [
      r.doc_date, r.bank_name, r.account_number, r.description, r.amount, r.counterparty_name, r.confidence, r.relative_path,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sao ke');
  }

  if (data.invoiceHeaders.length > 0) {
    const headers = ['Loai', 'Ngay', 'So HD', 'Tong tien truoc thue', 'Tong tien', 'TaxID', 'Doi tac', 'Dia chi', 'Confidence', 'File'];
    const rows = data.invoiceHeaders.map(r => [
      r.doc_type, r.doc_date, r.invoice_number, r.total_before_tax, r.total_amount, r.tax_id, r.counterparty_name, r.counterparty_address, r.confidence, r.relative_path,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Hoa don');
  }

  if (data.invoiceLineItems.length > 0) {
    const headers = ['Loai', 'Ngay', 'So HD', '#', 'Mo ta', 'Don gia', 'So luong', 'Thue suat', 'Thanh tien truoc thue', 'Thanh tien'];
    const rows = data.invoiceLineItems.map(r => [
      r.doc_type, r.doc_date, r.invoice_number, r.line_number, r.description, r.unit_price, r.quantity, r.tax_rate, r.subtotal, r.total_with_tax,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, 'Chi tiet');
  }

  // If no data at all, add an empty sheet
  if (wb.SheetNames.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([['No data']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Empty');
  }

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
