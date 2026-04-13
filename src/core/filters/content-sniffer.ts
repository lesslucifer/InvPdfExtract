import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { FilterResult, RelevanceFilterConfig } from '../../shared/types';
import { getMergedKeywords, createKeywordMatcher } from './keyword-bank';
import { findNodeModules } from '../app-paths';
import { log, LogModule } from '../logger';

export async function contentSniffer(
  fullPath: string,
  layer1Score: number,
  config: RelevanceFilterConfig
): Promise<FilterResult> {
  const ext = path.extname(fullPath).toLowerCase();
  let textSample = '';

  try {
    switch (ext) {
      case '.pdf':
        textSample = await extractPdfText(fullPath);
        break;
      case '.xlsx':
      case '.csv':
        textSample = await extractSpreadsheetText(fullPath);
        break;
      case '.xml':
        textSample = await extractXmlText(fullPath);
        break;
      case '.jpg':
      case '.jpeg':
      case '.png':
        return {
          score: layer1Score,
          reason: 'Image file - content sniffing not available, relying on filename heuristics',
          layer: 2,
          decision: layer1Score > config.processThreshold
            ? 'process'
            : layer1Score < config.skipThreshold
              ? 'skip'
              : 'uncertain',
        };
      default:
        textSample = '';
    }
  } catch (err) {
    log.warn(LogModule.Filter, `Failed to extract text from ${fullPath}: ${(err as Error).message}`);
    return {
      score: layer1Score,
      reason: `Content extraction failed: ${(err as Error).message}`,
      layer: 2,
      decision: 'uncertain',
    };
  }

  if (!textSample || textSample.trim().length === 0) {
    return {
      score: layer1Score,
      reason: 'No text content extracted',
      layer: 2,
      decision: layer1Score > config.processThreshold
        ? 'process'
        : layer1Score < config.skipThreshold
          ? 'skip'
          : 'uncertain',
    };
  }

  const keywords = getMergedKeywords(config);
  const matcher = createKeywordMatcher(keywords);
  const { score: contentScore, matchedTerms } = matcher(textSample);

  const combinedScore = 1 - (1 - layer1Score) * (1 - contentScore);
  const finalScore = Math.max(0, Math.min(1, combinedScore));

  const matchedStr = matchedTerms.length > 0
    ? matchedTerms.map(m => `"${m.term}" (w=${m.weight})`).join(', ')
    : 'none';

  const decision = finalScore > config.processThreshold
    ? 'process' as const
    : finalScore < config.skipThreshold
      ? 'skip' as const
      : 'uncertain' as const;

  const categoryVotes: Record<string, number> = {};
  for (const match of matchedTerms) {
    const kw = keywords.find(k => k.term === match.term);
    if (kw) {
      categoryVotes[kw.category] = (categoryVotes[kw.category] || 0) + match.weight;
    }
  }
  const topCategory = Object.entries(categoryVotes).sort((a, b) => b[1] - a[1])[0]?.[0] as
    'invoice' | 'bank_statement' | 'general_accounting' | undefined;

  return {
    score: finalScore,
    reason: `Content score: ${contentScore.toFixed(2)}, combined: ${finalScore.toFixed(2)}. Matched: ${matchedStr}`,
    layer: 2,
    decision,
    category: topCategory === 'general_accounting' ? undefined : topCategory,
  };
}

const PDF_WORKER_CODE = `
const { workerData, parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');

async function run() {
  try {
    const pdfjsLib = await import(workerData.pdfjsPath);
    const workerSrc = workerData.pdfWorkerPath;
    if (workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'file://' + workerSrc;

    const buffer = fs.readFileSync(workerData.filePath);
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      ...(workerData.standardFontsDir && { standardFontDataUrl: 'file://' + workerData.standardFontsDir + '/' }),
    });
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(2, pdf.numPages);
    const texts = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      texts.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '));
    }
    loadingTask.destroy?.();
    parentPort.postMessage({ text: texts.join('\\n') });
  } catch (err) {
    parentPort.postMessage({ error: err.message });
  }
}
run();
`;

async function extractPdfText(fullPath: string): Promise<string> {
  const nodeModulesDirs = findNodeModules();
  const pdfjsPath = nodeModulesDirs
    .map(d => path.join(d, 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'))
    .find(p => fs.existsSync(p));
  const pdfWorkerPath = nodeModulesDirs
    .map(d => path.join(d, 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'))
    .find(p => fs.existsSync(p));
  const standardFontsDir = nodeModulesDirs
    .map(d => path.join(d, 'pdfjs-dist', 'standard_fonts'))
    .find(p => fs.existsSync(p));

  return new Promise((resolve, reject) => {
    const worker = new Worker(PDF_WORKER_CODE, {
      eval: true,
      workerData: { filePath: fullPath, pdfjsPath, pdfWorkerPath, standardFontsDir },
    });
    worker.on('message', (msg: { text?: string; error?: string }) => {
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.text ?? '');
    });
    worker.on('error', reject);
  });
}

const XLSX_WORKER_CODE = `
const { workerData, parentPort } = require('worker_threads');
const XLSX = require('xlsx');
try {
  const wb = XLSX.readFile(workerData.filePath, { sheetRows: 10 });
  const parts = [wb.SheetNames.join(' ')];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length > 0) {
      parts.push(Object.keys(rows[0]).join(' '));
      for (const row of rows.slice(0, 5)) {
        parts.push(Object.values(row).map(v => String(v)).join(' '));
      }
    }
  }
  parentPort.postMessage({ text: parts.join('\\n') });
} catch (err) {
  parentPort.postMessage({ error: err.message });
}
`;

async function extractSpreadsheetText(fullPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(XLSX_WORKER_CODE, { eval: true, workerData: { filePath: fullPath } });
    worker.on('message', (msg: { text?: string; error?: string }) => {
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.text ?? '');
    });
    worker.on('error', reject);
  });
}

async function extractXmlText(fullPath: string): Promise<string> {
  const fh = await fs.promises.open(fullPath, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buffer, 0, 8192, 0);
    const xmlSnippet = buffer.toString('utf-8', 0, bytesRead);
    const elementNames = xmlSnippet.match(/<([a-zA-Z_][a-zA-Z0-9_:.-]*)/g)?.map(m => m.slice(1)) || [];
    const attrValues = xmlSnippet.match(/="([^"]+)"/g)?.map(m => m.slice(2, -1)) || [];
    const textContent = xmlSnippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return [...elementNames, ...attrValues, textContent].join(' ');
  } finally {
    await fh.close();
  }
}

export { extractPdfText, extractSpreadsheetText, extractXmlText };
