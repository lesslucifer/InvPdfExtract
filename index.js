#!/usr/bin/env node
"use strict";

/**
 * PDF Invoice Extractor for Vietnamese VAT Invoices
 * =================================================
 * Extracts order data from a folder of PDF invoices → Excel (.xlsx)
 *
 * SETUP:
 *   npm install
 *
 * USAGE:
 *   node index.js "C:\path\to\pdf\folder"
 *   node index.js "C:\path\to\pdf\folder" "C:\output\result.xlsx"
 *   node index.js "C:\path\to\pdf\folder" "C:\output\result.xlsx" --format=original
 *   node index.js   (no args — opens Windows GUI dialogs)
 *
 * FORMAT OPTIONS:
 *   --format=misa      Full MISA/POS format, 26 columns (default)
 *   --format=original  Original format, 24 columns, raw Vietnamese numbers
 */

const fs = require("fs");
const path = require("path");

const { browseFolderDialog, savFileDialog, openFile } = require("./lib/ui");
const { extractTextLines } = require("./lib/pdfReader");
const { findPdfFiles } = require("./lib/fileFinder");
const { writeExcel } = require("./lib/excelWriter");

const EXTRACTORS = {
  misa: require("./extractors/misa"),
  original: require("./extractors/original"),
};

const DEFAULT_OUTPUT = "extracted_invoices.xlsx";

// ─── CLI ARGUMENT PARSING ─────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  let format = "misa";

  for (const arg of argv) {
    if (arg.startsWith("--format=")) {
      format = arg.slice("--format=".length);
    } else {
      positional.push(arg);
    }
  }

  return { positional, format };
}

// ─── MAIN ─────────────────────────────────────────────────

async function main() {
  const { positional, format } = parseArgs(process.argv.slice(2));

  if (!EXTRACTORS[format]) {
    console.error(`Unknown format: "${format}". Valid options: ${Object.keys(EXTRACTORS).join(", ")}`);
    process.exit(1);
  }

  const extractor = EXTRACTORS[format];

  let pdfFolder, outputPath;

  if (positional.length === 0) {
    console.log("No arguments given — opening folder browser dialogs...\n");

    pdfFolder = browseFolderDialog("Select folder containing PDF invoices");
    if (!pdfFolder) {
      console.log("No folder selected. Exiting.");
      process.exit(0);
    }

    const chosen = savFileDialog(pdfFolder, DEFAULT_OUTPUT);
    outputPath = chosen || path.join(pdfFolder, DEFAULT_OUTPUT);
  } else {
    pdfFolder = positional[0];
    outputPath = positional[1] || path.join(pdfFolder, DEFAULT_OUTPUT);
  }

  if (!fs.existsSync(pdfFolder)) {
    console.error(`Folder not found: ${pdfFolder}`);
    process.exit(1);
  }

  const pdfFiles = findPdfFiles(pdfFolder);

  if (pdfFiles.length === 0) {
    console.error(`No PDF files found in: ${pdfFolder}`);
    process.exit(1);
  }

  console.log(`Format: ${format}`);
  console.log(`Found ${pdfFiles.length} PDF file(s) in ${pdfFolder}\n`);

  const allResults = [];
  let totalItems = 0;

  for (let i = 0; i < pdfFiles.length; i++) {
    const { fileName, filePath } = pdfFiles[i];
    process.stdout.write(`[${i + 1}/${pdfFiles.length}] ${fileName} ... `);

    try {
      const lines = await extractTextLines(filePath);
      const { header, items } = extractor.parseInvoice(lines);

      if (items.length === 0) {
        console.log("WARNING: no line items found");
      } else {
        console.log(`${items.length} item(s) extracted`);
        totalItems += items.length;
      }

      allResults.push({ fileName, header, items });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      allResults.push({ fileName, header: {}, items: [] });
    }
  }

  console.log(`\nWriting Excel to: ${outputPath}`);
  await writeExcel(allResults, outputPath, extractor.getExcelConfig());

  console.log(`\nDone!`);
  console.log(`  Files processed : ${pdfFiles.length}`);
  console.log(`  Total line items: ${totalItems}`);
  console.log(`  Output          : ${outputPath}`);

  if (format === "misa") {
    openFile(outputPath);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
