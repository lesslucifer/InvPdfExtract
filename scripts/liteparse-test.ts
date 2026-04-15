/**
 * LiteParse vs pdf-parse comparison test script.
 *
 * Usage:
 *   npx tsx scripts/liteparse-test.ts path/to/invoice.pdf
 *   npx tsx scripts/liteparse-test.ts path/to/folder/    # all PDFs in folder
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as path from 'path';
// pdf-parse has CJS/ESM issues with tsx
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;

const SEPARATOR = '='.repeat(80);
const HALF_SEP = '-'.repeat(40);

async function parsePdfParse(filePath: string): Promise<{ text: string; ms: number }> {
  const start = performance.now();
  const buffer = await fs.promises.readFile(filePath);
  const result = await pdfParse(buffer);
  return { text: result.text, ms: performance.now() - start };
}

async function parseLiteParse(
  parser: any,
  filePath: string,
): Promise<{ text: string; ms: number; pages: number; hasOCR: boolean }> {
  const start = performance.now();
  const result = await parser.parse(filePath);
  const hasOCR = result.pages.some((p: any) =>
    p.textItems.some((item: any) => item.fontName === 'OCR' || (item.confidence !== undefined && item.confidence < 1)),
  );
  return {
    text: result.text,
    ms: performance.now() - start,
    pages: result.pages.length,
    hasOCR,
  };
}

function truncate(text: string, maxLines = 60): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
}

async function comparePdf(parserOCR: any, parserNoOCR: any, filePath: string) {
  const name = path.basename(filePath);
  console.log(`\n${SEPARATOR}`);
  console.log(`FILE: ${name}`);
  console.log(SEPARATOR);

  const fileSize = (await fs.promises.stat(filePath)).size;
  console.log(`Size: ${(fileSize / 1024).toFixed(1)} KB\n`);

  // pdf-parse
  let pdfParseResult: { text: string; ms: number } | null = null;
  try {
    pdfParseResult = await parsePdfParse(filePath);
  } catch (err) {
    console.log(`[pdf-parse] ERROR: ${(err as Error).message}`);
  }

  // LiteParse with OCR
  let liteOCR: { text: string; ms: number; pages: number; hasOCR: boolean } | null = null;
  try {
    liteOCR = await parseLiteParse(parserOCR, filePath);
  } catch (err) {
    console.log(`[LiteParse+OCR] ERROR: ${(err as Error).message}`);
  }

  // LiteParse without OCR
  let liteNoOCR: { text: string; ms: number; pages: number; hasOCR: boolean } | null = null;
  try {
    liteNoOCR = await parseLiteParse(parserNoOCR, filePath);
  } catch (err) {
    console.log(`[LiteParse-noOCR] ERROR: ${(err as Error).message}`);
  }

  // Summary
  console.log(`${HALF_SEP} SUMMARY ${HALF_SEP}`);
  if (pdfParseResult) {
    console.log(`  pdf-parse:       ${pdfParseResult.text.length} chars, ${pdfParseResult.ms.toFixed(0)}ms`);
  }
  if (liteOCR) {
    console.log(
      `  LiteParse+OCR:   ${liteOCR.text.length} chars, ${liteOCR.ms.toFixed(0)}ms, ${liteOCR.pages} pages, OCR used: ${liteOCR.hasOCR}`,
    );
  }
  if (liteNoOCR) {
    console.log(
      `  LiteParse-noOCR: ${liteNoOCR.text.length} chars, ${liteNoOCR.ms.toFixed(0)}ms, ${liteNoOCR.pages} pages`,
    );
  }

  // Output comparison
  if (pdfParseResult) {
    console.log(`\n${HALF_SEP} pdf-parse output ${HALF_SEP}`);
    console.log(truncate(pdfParseResult.text));
  }
  if (liteOCR) {
    console.log(`\n${HALF_SEP} LiteParse+OCR output ${HALF_SEP}`);
    console.log(truncate(liteOCR.text));
  }
  if (liteNoOCR && liteNoOCR.text !== liteOCR?.text) {
    console.log(`\n${HALF_SEP} LiteParse-noOCR output (differs from OCR) ${HALF_SEP}`);
    console.log(truncate(liteNoOCR.text));
  }
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/liteparse-test.ts <pdf-file-or-folder>');
    process.exit(1);
  }

  const resolved = path.resolve(target);
  const stat = await fs.promises.stat(resolved);

  let pdfFiles: string[];
  if (stat.isDirectory()) {
    const entries = await fs.promises.readdir(resolved);
    pdfFiles = entries.filter(e => e.toLowerCase().endsWith('.pdf')).map(e => path.join(resolved, e));
    console.log(`Found ${pdfFiles.length} PDF(s) in ${resolved}`);
  } else {
    pdfFiles = [resolved];
  }

  if (pdfFiles.length === 0) {
    console.error('No PDF files found');
    process.exit(1);
  }

  // Dynamic import — LiteParse is ESM-only
  const { LiteParse } = await import('@llamaindex/liteparse');

  console.log('Initializing LiteParse with OCR (vie+eng)...');
  const parserOCR = new LiteParse({
    ocrEnabled: true,
    ocrLanguage: ['vie', 'eng'],
    outputFormat: 'text',
    preciseBoundingBox: false,
  });

  console.log('Initializing LiteParse without OCR...');
  const parserNoOCR = new LiteParse({
    ocrEnabled: false,
    outputFormat: 'text',
    preciseBoundingBox: false,
  });

  for (const file of pdfFiles) {
    await comparePdf(parserOCR, parserNoOCR, file);
  }

  console.log(`\n${SEPARATOR}`);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
