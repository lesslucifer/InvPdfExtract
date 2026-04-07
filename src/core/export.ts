import { getDatabase } from './db/database';
import { gatherFilteredExportData, JEExportRow } from './db/records';
import { DocType, JEEntryType } from '../shared/types';
import { getJeSide } from '../shared/je-utils';
import * as XLSX from 'xlsx-js-style';
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
  `).all(DocType.BankStatement) as ExportData['bankStatements'];

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

  return { bankStatements: bankStatements, invoiceHeaders: invoiceHeaders as ExportData['invoiceHeaders'], invoiceLineItems: invoiceLineItems as ExportData['invoiceLineItems'] };
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

// Column indices (0-based) for Phát sinh Nợ and Phát sinh Có
const COL_NO = 9;
const COL_CO = 10;
const NUM_COLS = 17;

type StyledCell = XLSX.CellObject & { s?: XLSX.CellStyle };

function styledCell(value: unknown, style: XLSX.CellStyle): StyledCell {
  const cell = { t: 'z', s: style } as StyledCell;
  if (value === null || value === undefined) {
    cell.t = 'z';
  } else if (typeof value === 'number') {
    cell.t = 'n';
    cell.v = value;
  } else {
    cell.t = 's';
    cell.v = String(value);
  }
  return cell;
}

function applyRowStyle(ws: XLSX.WorkSheet, rowIdx: number, style: XLSX.CellStyle, numCols: number): void {
  for (let c = 0; c < numCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
    if (ws[addr]) {
      (ws[addr] as StyledCell).s = style;
    } else {
      ws[addr] = { t: 'z', s: style } as StyledCell;
    }
  }
}

/**
 * Exports JE (journal entry) data to a single-sheet XLSX file in NKC (Nhat Ky Chung) format.
 * One row per journal entry. Imbalanced invoices are highlighted in red; a sum row is appended.
 */
export function exportJEToXlsx(rows: JEExportRow[]): Buffer {
  const wb = XLSX.utils.book_new();

  const headers = [
    'Ngày hạch toán', 'Ngày chứng từ', 'Số chứng từ', 'Ngày hóa đơn', 'Số hóa đơn',
    'Diễn giải chung', 'Diễn giải',
    'Tài khoản', 'TK Đối ứng',
    'Phát sinh Nợ', 'Phát sinh Có',
    'Mã đối tượng', 'Tên đối tượng',
    'Mã KMCP', 'Tên KMCP',
    'Mục thu/chi', 'Tên mục thu/chi',
  ];

  // Build raw data rows and track per-record_id balance
  const recordBalance: Record<string, { no: number; co: number }> = {};

  const dataRows = rows.map(row => {
    const entryType = row.entry_type as JEEntryType;
    const docType = row.doc_type as DocType;
    const side = getJeSide(docType, entryType);

    let soTien: number | null;
    switch (entryType) {
      case 'line':       soTien = row.li_total_with_tax;  break;
      case 'invoice':    soTien = row.total_before_tax;   break;
      case 'tax':        soTien = row.li_tax_amount;      break;
      case 'settlement': soTien = row.total_amount;       break;
      case 'bank':       soTien = row.bank_amount;        break;
      default:           soTien = null;
    }

    const phatSinhNo  = side === 'debit'  ? soTien : null;
    const phatSinhCo  = side === 'credit' ? soTien : null;

    if (soTien !== null) {
      const bal = recordBalance[row.record_id] ?? { no: 0, co: 0 };
      bal.no += phatSinhNo ?? 0;
      bal.co += phatSinhCo ?? 0;
      recordBalance[row.record_id] = bal;
    }

    let dienGiai: string | null;
    switch (entryType) {
      case 'line':       dienGiai = row.li_description;   break;
      case 'tax':        dienGiai = 'Thuế GTGT';           break;
      case 'settlement': dienGiai = 'Thanh toán';          break;
      case 'bank':       dienGiai = row.bank_description;  break;
      default:           dienGiai = null;
    }

    let dienGiaiChung: string | null;
    if (docType === DocType.BankStatement) {
      dienGiaiChung = row.bank_description;
    } else if (docType === DocType.InvoiceIn) {
      dienGiaiChung = row.counterparty_name && row.invoice_number
        ? `Mua hàng của ${row.counterparty_name} theo hóa đơn số ${row.invoice_number}`
        : row.counterparty_name ?? row.invoice_number ?? null;
    } else {
      dienGiaiChung = row.counterparty_name && row.invoice_number
        ? `Bán hàng cho ${row.counterparty_name} theo hóa đơn số ${row.invoice_number}`
        : row.counterparty_name ?? row.invoice_number ?? null;
    }

    const soChungTu = docType !== DocType.BankStatement ? row.invoice_number : null;

    return {
      record_id: row.record_id,
      values: [
        row.doc_date, row.doc_date, soChungTu, row.doc_date, soChungTu,
        dienGiaiChung, dienGiai,
        row.account,
        row.contra_account,
        phatSinhNo,
        phatSinhCo,
        null, row.counterparty_name,
        null, null,
        null, null,
      ],
    };
  });

  // Determine imbalanced record_ids (Nợ ≠ Có, rounded to 2 decimals to avoid float drift)
  const imbalanced = new Set(
    Object.entries(recordBalance)
      .filter(([, b]) => Math.round((b.no - b.co) * 100) !== 0)
      .map(([id]) => id),
  );

  if (dataRows.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([['No data']]);
    XLSX.utils.book_append_sheet(wb, ws, 'But toan');
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  const STYLE_HEADER: XLSX.CellStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: '1F4E79' }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  };
  const STYLE_IMBALANCED: XLSX.CellStyle = {
    fill: { fgColor: { rgb: 'FFDCE0' }, patternType: 'solid' },
  };
  const STYLE_SUM: XLSX.CellStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'FFF2CC' }, patternType: 'solid' },
  };
  const STYLE_SUM_NUM: XLSX.CellStyle = {
    font: { bold: true },
    fill: { fgColor: { rgb: 'FFF2CC' }, patternType: 'solid' },
    numFmt: '#,##0.00',
  };

  // Build worksheet from scratch using aoa, then apply styles
  const aoaData = [headers, ...dataRows.map(r => r.values)];
  const ws = XLSX.utils.aoa_to_sheet(aoaData);

  // Style header row (row 0)
  for (let c = 0; c < NUM_COLS; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) (ws[addr] as StyledCell).s = { ...STYLE_HEADER, font: { bold: true, color: { rgb: 'FFFFFF' } } };
  }

  // Style imbalanced rows
  dataRows.forEach((row, i) => {
    if (imbalanced.has(row.record_id)) {
      applyRowStyle(ws, i + 1, STYLE_IMBALANCED, NUM_COLS);
    }
  });

  // Compute totals and append sum row
  let totalNo = 0;
  let totalCo = 0;
  for (const row of dataRows) {
    totalNo += (row.values[COL_NO] as number | null) ?? 0;
    totalCo += (row.values[COL_CO] as number | null) ?? 0;
  }

  const sumRowIdx = dataRows.length + 1; // 0=header, 1..n=data, n+1=sum
  const sumRef = XLSX.utils.encode_cell({ r: sumRowIdx, c: 0 });
  for (let c = 0; c < NUM_COLS; c++) {
    const addr = XLSX.utils.encode_cell({ r: sumRowIdx, c });
    if (c === 0) {
      ws[addr] = styledCell('TỔNG CỘNG', { ...STYLE_SUM });
    } else if (c === COL_NO) {
      ws[addr] = styledCell(totalNo, STYLE_SUM_NUM);
    } else if (c === COL_CO) {
      ws[addr] = styledCell(totalCo, STYLE_SUM_NUM);
    } else {
      ws[addr] = { t: 'z', s: STYLE_SUM } as StyledCell;
    }
  }

  // Extend sheet range to include the sum row
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  range.e.r = sumRowIdx;
  ws['!ref'] = XLSX.utils.encode_range(range);
  // suppress unused variable warning
  void sumRef;

  XLSX.utils.book_append_sheet(wb, ws, 'But toan');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
