import * as path from 'path';
import * as XLSX from 'xlsx';
import { SpreadsheetMetadata, SheetMetadata, ColumnTypeInfo } from '../../shared/types';
import { METADATA_SAMPLE_ROWS, METADATA_SAMPLE_VALUES } from '../../shared/constants';
import { log, LogModule } from '../logger';

export function extractMetadata(filePath: string): SpreadsheetMetadata {
  const fileName = path.basename(filePath);
  log.debug(LogModule.Parser, `Extracting metadata: ${fileName}`);
  const ext = path.extname(filePath).toLowerCase();
  const fileType = ext === '.csv' ? 'csv' : 'xlsx';

  // Read workbook — full read to get accurate row counts and sample data
  const wb = XLSX.readFile(filePath);

  const sheets: SheetMetadata[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) {
      sheets.push({
        name: sheetName,
        headers: [],
        rowCount: 0,
        colCount: 0,
        columnTypes: [],
        sampleRows: [],
      });
      continue;
    }

    const range = XLSX.utils.decode_range(ws['!ref']);
    // Convert to JSON with headers from first row, preserving empty cells
    const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    const headers = allRows.length > 0
      ? Object.keys(allRows[0])
      : getHeadersFromRange(ws, range);

    const dataRowCount = allRows.length;
    const sampleRows = allRows.slice(0, METADATA_SAMPLE_ROWS);

    // Infer column types from ALL rows (not just samples) for accuracy
    const columnTypes = inferColumnTypes(headers, allRows);

    sheets.push({
      name: sheetName,
      headers,
      rowCount: dataRowCount,
      colCount: headers.length,
      columnTypes,
      sampleRows,
    });
  }

  const totalRows = sheets.reduce((sum, s) => sum + s.rowCount, 0);

  log.debug(LogModule.Parser, `Metadata extracted: ${sheets.length} sheets, ${totalRows} total rows`, { fileName });

  return {
    fileName,
    fileType,
    sheets,
    totalRows,
  };
}

function getHeadersFromRange(ws: XLSX.WorkSheet, range: XLSX.Range): string[] {
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(cell ? String(cell.v) : XLSX.utils.encode_col(c));
  }
  return headers;
}

function inferColumnTypes(headers: string[], rows: Record<string, unknown>[]): ColumnTypeInfo[] {
  return headers.map(header => {
    let emptyCount = 0;
    const typeCounts: Record<string, number> = { string: 0, number: 0, date: 0, boolean: 0 };
    const uniqueValues = new Set<unknown>();

    for (const row of rows) {
      const val = row[header];
      if (val === null || val === undefined || val === '') {
        emptyCount++;
        continue;
      }

      if (typeof val === 'number') {
        typeCounts.number++;
      } else if (typeof val === 'boolean') {
        typeCounts.boolean++;
      } else if (val instanceof Date) {
        typeCounts.date++;
      } else if (typeof val === 'string') {
        // Check if it looks like a date
        if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(val) || /^\d{4}-\d{2}-\d{2}/.test(val)) {
          typeCounts.date++;
        } else {
          typeCounts.string++;
        }
      } else {
        typeCounts.string++;
      }

      if (uniqueValues.size < METADATA_SAMPLE_VALUES) {
        uniqueValues.add(val);
      }
    }

    const totalNonEmpty = rows.length - emptyCount;
    let inferredType: ColumnTypeInfo['inferredType'];

    if (totalNonEmpty === 0) {
      inferredType = 'empty';
    } else {
      // Find the dominant type
      const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
      const topType = sorted[0];
      // If dominant type covers > 50% of non-empty values, use it; otherwise 'mixed'
      if (topType[1] > totalNonEmpty * 0.5) {
        inferredType = topType[0] as ColumnTypeInfo['inferredType'];
      } else {
        inferredType = 'mixed';
      }
    }

    return {
      header,
      inferredType,
      sampleValues: Array.from(uniqueValues),
      emptyRate: rows.length > 0 ? emptyCount / rows.length : 0,
    };
  });
}
