# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

CLI tool that batch-extracts line-item data from Vietnamese VAT invoice PDFs and outputs a formatted Excel (.xlsx) file. Uses `pdfjs-dist` for PDF text extraction and `exceljs` for writing output.

## Commands

```bash
npm install        # Install dependencies
node index.js "path/to/pdf/folder"
node index.js "path/to/pdf/folder" "output.xlsx"
node index.js "path/to/pdf/folder" "output.xlsx" --format=original
node index.js      # No args: opens Windows PowerShell GUI dialogs
```

**Format options:**
- `--format=misa` (default): 26-column output, international number formatting, handles MISA meInvoice + POS cash-register layout
- `--format=original`: 24-column output, raw Vietnamese number strings, simpler parsing

## Architecture

### Data Flow
```
PDF files → pdfReader.extractTextLines() → string[][]
         → extractor.parseInvoice(lines) → { header, items[] }
         → excelWriter.writeExcel(results, path, extractor.getExcelConfig())
```

### PDF Line Representation
`pdfReader.js` groups text items by Y-coordinate (±2px tolerance) into rows. Each row is `string[]` ordered left-to-right by X position. All extractor logic operates on `string[][]` (array of rows, each row is array of text parts).

### Extractor Interface
Each file in `extractors/` must export:
- `parseInvoice(lines: string[][]): { header: object, items: object[] }`
- `getExcelConfig(): { headers, widths, autoFilterTo, mapRow }`

### Key Parsing Logic (`extractors/base.js`)
`claimNameLines()` is the core algorithm. It:
1. Identifies STT (serial number) rows — rows where `parts[0]` is a digit and the row contains a `\d{1,2}%` tax rate token
2. Claims surrounding text lines as product name continuations by scanning above/below each STT row
3. Merges claimed lines into `item.tenHH` (product name)
4. For POS format: recovers `donGia` (unit price) from floating numeric lines using `qty × price ≈ total` arithmetic

### Number Formats
Vietnamese invoices use: `.` = thousands separator, `,` = decimal. Functions in `lib/textHelpers.js`:
- `parseVietnameseNumber`: converts to JS float
- `formatVietnameseNumber`: formats using `vi-VN` locale
- `toIntlNumber`: converts to international format (`,` thousands, `.` decimal) — used in `misa` extractor output

### pdfjs-dist Version Pin
**Must use `pdfjs-dist@3.11.174`**. v4+ is ESM-only and incompatible with `require()`. The package loads from `pdfjs-dist/legacy/build/pdf.js`.

### Windows GUI
`lib/ui.js` uses PowerShell (via `execSync`) for folder picker and Save As dialogs. Output is written to a UTF-8 temp file to avoid console pipe encoding issues. Non-Windows environments will fail silently when no-arg mode is used.

## Adding a New Extractor Format

1. Create `extractors/yourformat.js` exporting `parseInvoice` and `getExcelConfig`
2. Register it in `index.js` `EXTRACTORS` map
3. `parseLineItem` should return an object with at minimum: `stt`, `tenHH`, `dvt`, `soLuong`, `donGia`, `thueSuat`, `tienThue`, `thanhTienThue`
4. Call `claimNameLines(lines, sttIndices, parseLineItem, isPOSFormat?, extraKeywords?)` from `base.js` for product name merging
