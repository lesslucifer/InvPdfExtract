# Quick Filter Irrelevant Files

## Summary

Add a multi-layer pre-filter pipeline that runs BEFORE the extraction queue to skip irrelevant files (marketing PDFs, personal photos, HR spreadsheets, etc.) when a vault contains thousands of files. The filter uses three layers ordered from cheapest to most expensive: filename/path heuristics (free), content sniffing with weighted keyword matching (fast, no AI), and lightweight AI triage via Claude Haiku (cheap, for uncertain files only). This prevents wasted AI calls (Sonnet for PDFs, Opus for script generation) and reduces processing time significantly.

---

## 1. Database Changes

### 1.1 Add `Skipped` to FileStatus enum

**File:** `src/shared/types/index.ts`

```typescript
// Current:
export enum FileStatus {
  Pending = 'pending',
  Processing = 'processing',
  Done = 'done',
  Review = 'review',
  Error = 'error',
}

// Change to:
export enum FileStatus {
  Pending = 'pending',
  Processing = 'processing',
  Done = 'done',
  Review = 'review',
  Error = 'error',
  Skipped = 'skipped',
}
```

### 1.2 Schema migration (Migration 009)

**File:** `src/core/db/schema.ts`

Append a new migration to the `MIGRATIONS` array:

```typescript
// Migration 009: Relevance filter metadata on files
`
ALTER TABLE files ADD COLUMN filter_score REAL;
ALTER TABLE files ADD COLUMN filter_reason TEXT;
ALTER TABLE files ADD COLUMN filter_layer INTEGER;
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
`,
```

Column definitions:
- `filter_score` (REAL, nullable) -- The computed relevance score from 0.0 to 1.0. NULL means filter has not run on this file.
- `filter_reason` (TEXT, nullable) -- Human-readable explanation of why the file was skipped or passed. Example: `"No relevant keywords found in content (score: 0.18)"`, `"Filename matches invoice pattern: hoa_don_GTGT"`, `"AI triage: classified as irrelevant"`.
- `filter_layer` (INTEGER, nullable) -- Which layer made the final decision: `1` (filename/path), `2` (content sniffing), `3` (AI triage). NULL if filter hasn't run.

### 1.3 Update VaultFile type

**File:** `src/shared/types/index.ts`

```typescript
// Add to VaultFile interface:
export interface VaultFile {
  // ... existing fields ...
  filter_score: number | null;
  filter_reason: string | null;
  filter_layer: number | null;
}
```

### 1.4 Update files DB functions

**File:** `src/core/db/files.ts`

Add new function:

```typescript
export function updateFileFilterResult(
  id: string,
  status: FileStatus,
  filterScore: number,
  filterReason: string,
  filterLayer: number
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE files
    SET status = ?, filter_score = ?, filter_reason = ?, filter_layer = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, filterScore, filterReason, filterLayer, id);
}

export function getSkippedFiles(): VaultFile[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM files WHERE status = ? AND deleted_at IS NULL ORDER BY updated_at DESC'
  ).all(FileStatus.Skipped) as VaultFile[];
}
```

Update `STATUS_PRIORITY` in `files.ts`:

```typescript
const STATUS_PRIORITY: Record<string, number> = {
  [FileStatus.Processing]: 0,
  [FileStatus.Error]: 1,
  [FileStatus.Review]: 2,
  [FileStatus.Pending]: 3,
  [FileStatus.Done]: 4,
  [FileStatus.Skipped]: 5,  // lowest priority for folder status aggregation
};
```

---

## 2. New Dependencies

**File:** `package.json`

Add to `dependencies`:
- `fuse.js` -- Fuzzy text matching for keyword bank scoring
- `pdf-parse` -- Lightweight PDF text extraction (no native deps, pure JS)

```bash
pnpm add fuse.js pdf-parse
pnpm add -D @types/pdf-parse
```

Note: `pdf-parse` has no native binary dependencies, making it safe for Electron packaging without rebuild complexity. It uses Mozilla's pdf.js internally.

---

## 3. Filter Configuration

### 3.1 Config types

**File:** `src/shared/types/index.ts`

Add these new types:

```typescript
// === Relevance Filter Types ===

export interface FilterKeyword {
  term: string;
  weight: number;
  category: 'invoice' | 'bank_statement' | 'general_accounting';
}

export interface RelevanceFilterConfig {
  skipThreshold: number;       // Score below this -> Skipped (default: 0.4)
  processThreshold: number;    // Score above this -> Pending (default: 0.6)
  customKeywords: FilterKeyword[];
  customPathPatterns: string[];  // Additional path patterns to match as relevant
  sizeMinBytes: number;         // Penalty below this (default: 1024 = 1KB)
  sizeMaxBytes: number;         // Penalty above this (default: 52428800 = 50MB)
  sizePenalty: number;          // Score penalty for suspicious size (default: 0.15)
  aiTriageEnabled: boolean;     // Whether to use Layer 3 AI triage (default: true)
  aiTriageBatchSize: number;    // Max files per AI triage call (default: 10)
}

export interface FilterResult {
  score: number;
  reason: string;
  layer: 1 | 2 | 3;
  decision: 'skip' | 'process' | 'uncertain';
  category?: 'invoice' | 'bank_statement' | 'irrelevant';
}
```

### 3.2 Default config constants

**File:** `src/shared/constants.ts`

Add:

```typescript
import { RelevanceFilterConfig } from './types';

export const DEFAULT_FILTER_CONFIG: RelevanceFilterConfig = {
  skipThreshold: 0.4,
  processThreshold: 0.6,
  customKeywords: [],
  customPathPatterns: [],
  sizeMinBytes: 1024,
  sizeMaxBytes: 52_428_800,
  sizePenalty: 0.15,
  aiTriageEnabled: true,
  aiTriageBatchSize: 10,
};
```

### 3.3 Config file in vault

The filter config is stored at `.invoicevault/filter-config.json`. On vault init, write the default config. On vault open, load it (falling back to defaults for missing fields).

**File:** `src/core/vault.ts`

In `initVault()`, after writing `config.json`, add:

```typescript
import { DEFAULT_FILTER_CONFIG } from '../shared/constants';

// Write default filter config
const filterConfigPath = path.join(dotPath, 'filter-config.json');
fs.writeFileSync(filterConfigPath, JSON.stringify(DEFAULT_FILTER_CONFIG, null, 2));
```

Add a new constant:

**File:** `src/shared/constants.ts`

```typescript
export const FILTER_CONFIG_FILE = 'filter-config.json';
```

Add a helper to load filter config:

**File:** `src/core/filters/config.ts` (new file)

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { RelevanceFilterConfig } from '../../shared/types';
import { DEFAULT_FILTER_CONFIG, FILTER_CONFIG_FILE } from '../../shared/constants';

export function loadFilterConfig(dotPath: string): RelevanceFilterConfig {
  const configPath = path.join(dotPath, FILTER_CONFIG_FILE);
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return { ...DEFAULT_FILTER_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    console.warn('[FilterConfig] Failed to load filter config, using defaults');
  }
  return { ...DEFAULT_FILTER_CONFIG };
}

export function saveFilterConfig(dotPath: string, config: RelevanceFilterConfig): void {
  const configPath = path.join(dotPath, FILTER_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
```

---

## 4. Keyword Bank

**File:** `src/core/filters/keyword-bank.ts` (new file)

This module defines the built-in keyword bank and provides fuzzy matching via Fuse.js.

### 4.1 Built-in keywords

```typescript
import Fuse from 'fuse.js';
import { FilterKeyword, RelevanceFilterConfig } from '../../shared/types';

/**
 * Built-in keyword bank for Vietnamese accounting document relevance scoring.
 * Weights range from 0.0 to 1.0 — higher weight means stronger signal of relevance.
 */
export const BUILTIN_KEYWORDS: FilterKeyword[] = [
  // Vietnamese invoice terms (high confidence)
  { term: 'hoa don', weight: 0.8, category: 'invoice' },
  { term: 'hoa don GTGT', weight: 0.95, category: 'invoice' },
  { term: 'GTGT', weight: 0.9, category: 'invoice' },
  { term: 'hoa don dau ra', weight: 0.9, category: 'invoice' },
  { term: 'hoa don dau vao', weight: 0.9, category: 'invoice' },
  { term: 'MST', weight: 0.7, category: 'invoice' },
  { term: 'ma so thue', weight: 0.85, category: 'invoice' },
  { term: 'so hoa don', weight: 0.85, category: 'invoice' },
  { term: 'tong tien', weight: 0.6, category: 'general_accounting' },
  { term: 'tong tien truoc thue', weight: 0.75, category: 'invoice' },
  { term: 'thue suat', weight: 0.8, category: 'invoice' },
  { term: 'NCC', weight: 0.6, category: 'invoice' },
  { term: 'nha cung cap', weight: 0.7, category: 'invoice' },
  { term: 'KH', weight: 0.4, category: 'invoice' },
  { term: 'khach hang', weight: 0.6, category: 'invoice' },
  { term: 'cong no', weight: 0.7, category: 'general_accounting' },
  { term: 'phieu thu', weight: 0.75, category: 'general_accounting' },
  { term: 'phieu chi', weight: 0.75, category: 'general_accounting' },
  { term: 'uy nhiem chi', weight: 0.8, category: 'bank_statement' },
  { term: 'giay bao no', weight: 0.8, category: 'bank_statement' },
  { term: 'giay bao co', weight: 0.8, category: 'bank_statement' },

  // Vietnamese bank statement terms
  { term: 'sao ke', weight: 0.85, category: 'bank_statement' },
  { term: 'sao ke ngan hang', weight: 0.95, category: 'bank_statement' },
  { term: 'ngan hang', weight: 0.6, category: 'bank_statement' },
  { term: 'so du', weight: 0.5, category: 'bank_statement' },
  { term: 'giao dich', weight: 0.5, category: 'bank_statement' },
  { term: 'chuyen khoan', weight: 0.65, category: 'bank_statement' },
  { term: 'tai khoan', weight: 0.5, category: 'bank_statement' },

  // General Vietnamese accounting
  { term: 'ke toan', weight: 0.7, category: 'general_accounting' },
  { term: 'chung tu', weight: 0.75, category: 'general_accounting' },
  { term: 'so cai', weight: 0.7, category: 'general_accounting' },
  { term: 'bang ke', weight: 0.7, category: 'general_accounting' },
  { term: 'chi tiet', weight: 0.4, category: 'general_accounting' },
  { term: 'don gia', weight: 0.65, category: 'invoice' },
  { term: 'so luong', weight: 0.4, category: 'invoice' },
  { term: 'thanh tien', weight: 0.65, category: 'invoice' },
  { term: 'dia chi', weight: 0.3, category: 'general_accounting' },

  // English/common terms
  { term: 'invoice', weight: 0.8, category: 'invoice' },
  { term: 'inv', weight: 0.5, category: 'invoice' },
  { term: 'bank statement', weight: 0.85, category: 'bank_statement' },
  { term: 'bank', weight: 0.4, category: 'bank_statement' },
  { term: 'statement', weight: 0.5, category: 'bank_statement' },
  { term: 'receipt', weight: 0.6, category: 'general_accounting' },
  { term: 'payment', weight: 0.5, category: 'general_accounting' },
  { term: 'billing', weight: 0.6, category: 'invoice' },
  { term: 'tax', weight: 0.5, category: 'general_accounting' },
  { term: 'VAT', weight: 0.7, category: 'invoice' },
  { term: 'debit', weight: 0.5, category: 'bank_statement' },
  { term: 'credit', weight: 0.5, category: 'bank_statement' },
  { term: 'total', weight: 0.3, category: 'general_accounting' },
  { term: 'amount', weight: 0.3, category: 'general_accounting' },
  { term: 'subtotal', weight: 0.4, category: 'invoice' },
];

/**
 * Path/folder name patterns that signal relevance.
 * Used in Layer 1 filename heuristics.
 */
export const RELEVANT_PATH_PATTERNS: string[] = [
  'ke_toan', 'ketoan', 'accounting',
  'invoices', 'invoice', 'hoa_don', 'hoadon',
  'bank', 'ngan_hang', 'nganh hang', 'sao_ke', 'saoke',
  'bang_ke', 'bangke',
  'chung_tu', 'chungtu',
  'thue', 'tax', 'vat', 'GTGT',
  'dau_ra', 'daura', 'dau_vao', 'dauvao',
  'NCC', 'KH',
  'phieu_thu', 'phieu_chi',
  'cong_no', 'congno',
];

/**
 * Filename patterns (regex) that strongly suggest accounting relevance.
 */
export const RELEVANT_FILENAME_PATTERNS: RegExp[] = [
  // Vietnamese invoice numbering: "HD001234", "0001234", "AA/12E-0001234"
  /\bHD\d{4,}/i,
  /\b\d{7,}\b/,             // long number sequences (invoice/transaction IDs)
  /\b[A-Z]{1,3}\/\d{2}[A-Z]-\d+/i, // Vietnamese e-invoice serial: AA/22E-0001234
  // Date patterns in filenames: 2024-01-15, 20240115, 01-2024
  /\b20\d{2}[-_]?\d{2}[-_]?\d{2}\b/,
  /\b\d{2}[-_]20\d{2}\b/,
  // Common invoice file naming
  /\binv[_-]?\d+/i,
  /\breceipt[_-]?\d+/i,
  /\bpayment[_-]?\d+/i,
];

/**
 * Merge built-in keywords with user-defined custom keywords.
 * Custom keywords override built-in ones if the term matches exactly.
 */
export function getMergedKeywords(config: RelevanceFilterConfig): FilterKeyword[] {
  const merged = [...BUILTIN_KEYWORDS];
  for (const custom of config.customKeywords) {
    const existingIdx = merged.findIndex(k => k.term.toLowerCase() === custom.term.toLowerCase());
    if (existingIdx >= 0) {
      merged[existingIdx] = custom;
    } else {
      merged.push(custom);
    }
  }
  return merged;
}

/**
 * Create a Fuse.js instance for fuzzy matching against the keyword bank.
 * Returns a function that scores a text sample against all keywords.
 */
export function createKeywordMatcher(keywords: FilterKeyword[]): (text: string) => { score: number; matchedTerms: Array<{ term: string; weight: number; fuseScore: number }> } {
  // Fuse.js configuration: threshold 0.4 allows moderate fuzziness (handles OCR typos)
  const fuse = new Fuse(keywords, {
    keys: ['term'],
    threshold: 0.4,
    includeScore: true,
    ignoreLocation: true,
    findAllMatches: true,
  });

  return (text: string) => {
    // Normalize the text: lowercase, collapse whitespace
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

    // Search the entire text against each keyword
    // Split text into overlapping n-gram windows for better matching
    const words = normalized.split(/\s+/);
    const matchedTerms: Array<{ term: string; weight: number; fuseScore: number }> = [];
    const seenTerms = new Set<string>();

    // Check each keyword against the full text and windowed substrings
    for (const keyword of keywords) {
      const termWords = keyword.term.toLowerCase().split(/\s+/);
      const windowSize = termWords.length;

      for (let i = 0; i <= words.length - windowSize; i++) {
        const window = words.slice(i, i + windowSize).join(' ');
        const results = fuse.search(window);

        for (const result of results) {
          if (result.item.term.toLowerCase() === keyword.term.toLowerCase() && !seenTerms.has(keyword.term)) {
            seenTerms.add(keyword.term);
            matchedTerms.push({
              term: keyword.term,
              weight: keyword.weight,
              fuseScore: result.score ?? 0,
            });
          }
        }
      }
    }

    // Also check for exact substring matches (bypasses Fuse for short/exact terms)
    for (const keyword of keywords) {
      const lower = keyword.term.toLowerCase();
      if (!seenTerms.has(keyword.term) && normalized.includes(lower)) {
        seenTerms.add(keyword.term);
        matchedTerms.push({
          term: keyword.term,
          weight: keyword.weight,
          fuseScore: 0, // exact match
        });
      }
    }

    // Compute aggregate score:
    // - Each matched term contributes: weight * (1 - fuseScore)
    //   (fuseScore 0 = perfect match, fuseScore 0.4 = fuzzy threshold)
    // - Final score = 1 - product(1 - contribution) -- diminishing returns for multiple matches
    if (matchedTerms.length === 0) return { score: 0, matchedTerms: [] };

    let complementProduct = 1;
    for (const match of matchedTerms) {
      const contribution = match.weight * (1 - match.fuseScore);
      complementProduct *= (1 - contribution);
    }
    const score = Math.min(1, 1 - complementProduct);

    return { score, matchedTerms };
  };
}
```

---

## 5. Filter Layer Implementations

### 5.1 Layer 1: Filename & Path Heuristics

**File:** `src/core/filters/filename-filter.ts` (new file)

```typescript
import * as path from 'path';
import { FilterResult, RelevanceFilterConfig } from '../../shared/types';
import { RELEVANT_PATH_PATTERNS, RELEVANT_FILENAME_PATTERNS } from './keyword-bank';

/**
 * Layer 1: Filename, path, and file size heuristics.
 *
 * This is a positive-matching approach: we look for signals that the file
 * IS relevant (invoice/bank statement), not that it's irrelevant.
 *
 * Returns a FilterResult with a preliminary score.
 * Score > processThreshold -> early accept (skip Layer 2/3)
 * Score > 0 but < processThreshold -> pass to Layer 2 with score boost
 * Score == 0 -> pass to Layer 2 with no boost (but no early reject either)
 */
export function filenameFilter(
  relativePath: string,
  fileSize: number,
  config: RelevanceFilterConfig
): FilterResult {
  const filename = path.basename(relativePath).toLowerCase();
  const filenameNoExt = path.basename(relativePath, path.extname(relativePath)).toLowerCase();
  const dirParts = path.dirname(relativePath).toLowerCase().split(path.sep);
  const fullLower = relativePath.toLowerCase();

  let score = 0;
  const reasons: string[] = [];

  // Check folder/path patterns
  const allPathPatterns = [...RELEVANT_PATH_PATTERNS, ...config.customPathPatterns];
  for (const pattern of allPathPatterns) {
    const lower = pattern.toLowerCase();
    if (dirParts.some(d => d.includes(lower)) || fullLower.includes(lower)) {
      score += 0.3;
      reasons.push(`Path matches: "${pattern}"`);
      break; // Only count path once
    }
  }

  // Check filename patterns (regex)
  for (const regex of RELEVANT_FILENAME_PATTERNS) {
    if (regex.test(filenameNoExt)) {
      score += 0.35;
      reasons.push(`Filename matches pattern: ${regex.source}`);
      break; // Only count best filename pattern
    }
  }

  // Check filename for keyword fragments (quick substring check)
  const filenameKeywords = [
    'hoadon', 'hoa_don', 'hodon', 'invoice', 'inv',
    'saoke', 'sao_ke', 'statement', 'bank',
    'bangke', 'bang_ke', 'receipt', 'payment',
    'GTGT', 'gtgt', 'thue', 'tax', 'vat',
    'MST', 'mst', 'chungtu', 'chung_tu',
    'phieuthu', 'phieu_thu', 'phieuchi', 'phieu_chi',
  ];
  for (const kw of filenameKeywords) {
    if (filenameNoExt.includes(kw.toLowerCase())) {
      score += 0.4;
      reasons.push(`Filename contains keyword: "${kw}"`);
      break;
    }
  }

  // Size penalty (not auto-skip, just a score reduction)
  if (fileSize > 0) {
    if (fileSize < config.sizeMinBytes) {
      score -= config.sizePenalty;
      reasons.push(`File too small (${fileSize} bytes < ${config.sizeMinBytes})`);
    } else if (fileSize > config.sizeMaxBytes) {
      score -= config.sizePenalty;
      reasons.push(`File too large (${fileSize} bytes > ${config.sizeMaxBytes})`);
    }
  }

  // Clamp score
  score = Math.max(0, Math.min(1, score));

  const decision = score > config.processThreshold
    ? 'process' as const
    : 'uncertain' as const;

  return {
    score,
    reason: reasons.length > 0 ? reasons.join('; ') : 'No filename/path signals detected',
    layer: 1,
    decision,
  };
}
```

### 5.2 Layer 2: Content Sniffing

**File:** `src/core/filters/content-sniffer.ts` (new file)

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { FilterResult, RelevanceFilterConfig } from '../../shared/types';
import { getMergedKeywords, createKeywordMatcher } from './keyword-bank';

/**
 * Layer 2: Content-based relevance scoring via keyword bank + fuzzy matching.
 *
 * Extracts text from the first page/portion of the file, then scores it
 * against the weighted keyword bank using fuzzy matching.
 *
 * @param fullPath - Absolute path to the file
 * @param layer1Score - Score carried forward from Layer 1 (used as a boost)
 * @param config - Filter configuration
 * @returns FilterResult with combined score from Layer 1 + Layer 2
 */
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
        textSample = extractSpreadsheetText(fullPath);
        break;
      case '.xml':
        textSample = extractXmlText(fullPath);
        break;
      case '.jpg':
      case '.jpeg':
      case '.png':
        // Images: cannot extract text cheaply, rely on Layer 1 + Layer 3
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
    console.warn(`[ContentSniffer] Failed to extract text from ${fullPath}: ${(err as Error).message}`);
    // On extraction failure, pass through with Layer 1 score (uncertain)
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

  // Score against keyword bank
  const keywords = getMergedKeywords(config);
  const matcher = createKeywordMatcher(keywords);
  const { score: contentScore, matchedTerms } = matcher(textSample);

  // Combine Layer 1 and Layer 2 scores:
  // Use 1 - (1-L1)*(1-L2) formula (like probability union)
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

  // Determine category from top matched terms
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

/**
 * Extract text from first 1-2 pages of a PDF using pdf-parse.
 * Limits to first 2 pages to keep it fast and cheap.
 */
async function extractPdfText(fullPath: string): Promise<string> {
  // Dynamic import to avoid loading pdf-parse when not needed
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(fullPath);

  // pdf-parse options: limit to first 2 pages
  const data = await pdfParse(buffer, {
    max: 2,  // Only parse first 2 pages
  });

  return data.text || '';
}

/**
 * Extract text from spreadsheet files for keyword matching.
 * Uses xlsx library (already a dependency) to read sheet names, headers, and sample values.
 */
function extractSpreadsheetText(fullPath: string): string {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(fullPath, { sheetRows: 10 }); // Only read first 10 rows

  const parts: string[] = [];

  // Sheet names are often descriptive
  parts.push(wb.SheetNames.join(' '));

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // Convert to JSON and extract all cell values as text
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    if (rows.length > 0) {
      // Add headers
      parts.push(Object.keys(rows[0]).join(' '));
      // Add first 5 rows of values
      for (const row of rows.slice(0, 5)) {
        parts.push(Object.values(row).map(v => String(v)).join(' '));
      }
    }
  }

  return parts.join('\n');
}

/**
 * Extract text from XML files for keyword matching.
 * Reads first 8KB and extracts element names, attribute names, and text content.
 */
function extractXmlText(fullPath: string): string {
  // Read just the first 8KB for sniffing
  const fd = fs.openSync(fullPath, 'r');
  const buffer = Buffer.alloc(8192);
  const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
  fs.closeSync(fd);

  const xmlSnippet = buffer.toString('utf-8', 0, bytesRead);

  // Extract element names, attributes, and text content via regex
  // (Intentionally simple -- not a full XML parse, just sniffing)
  const elementNames = xmlSnippet.match(/<([a-zA-Z_][a-zA-Z0-9_:.-]*)/g)?.map(m => m.slice(1)) || [];
  const attrValues = xmlSnippet.match(/="([^"]+)"/g)?.map(m => m.slice(2, -1)) || [];
  const textContent = xmlSnippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return [...elementNames, ...attrValues, textContent].join(' ');
}

// Export extractors for testing
export { extractPdfText, extractSpreadsheetText, extractXmlText };
```

### 5.3 Layer 3: AI Triage

**File:** `src/core/filters/ai-triage.ts` (new file)

```typescript
import { ClaudeCodeRunner } from '../claude-cli';
import { FilterResult, RelevanceFilterConfig } from '../../shared/types';

/**
 * Layer 3: Lightweight AI triage for uncertain files.
 *
 * Uses Claude Haiku (cheapest model) to classify a text sample
 * as 'invoice', 'bank_statement', or 'irrelevant'.
 *
 * Can batch multiple files into a single triage call for efficiency.
 */

interface TriageInput {
  relativePath: string;
  textSample: string;
  layer2Score: number;
}

interface TriageOutput {
  relativePath: string;
  classification: 'invoice' | 'bank_statement' | 'irrelevant';
  confidence: number;
  reason: string;
}

const TRIAGE_SYSTEM_PROMPT = `You are a document classifier for Vietnamese accounting files.
Your job is to classify each document snippet as one of:
- "invoice" (hoa don GTGT, VAT invoice, sales/purchase invoice)
- "bank_statement" (sao ke ngan hang, bank statement, payment records)
- "irrelevant" (marketing material, personal document, HR document, etc.)

Respond with ONLY a JSON array. Each element must have:
- "index": the 0-based index of the file
- "classification": "invoice" | "bank_statement" | "irrelevant"
- "confidence": 0.0 to 1.0
- "reason": brief explanation (max 20 words)

Example response:
[{"index": 0, "classification": "invoice", "confidence": 0.9, "reason": "Contains MST, invoice number, and VAT fields"}]`;

/**
 * Run AI triage on a batch of uncertain files.
 * Returns FilterResult for each input, in the same order.
 */
export async function aiTriageBatch(
  inputs: TriageInput[],
  config: RelevanceFilterConfig,
  cliPath?: string,
): Promise<FilterResult[]> {
  if (inputs.length === 0) return [];

  const runner = new ClaudeCodeRunner(cliPath, 30_000, 'fast'); // Haiku, 30s timeout

  // Build the user prompt with text samples
  const fileSections = inputs.map((input, idx) => {
    // Truncate text sample to ~500 chars to keep prompt small
    const truncated = input.textSample.slice(0, 500);
    return `--- File ${idx}: ${input.relativePath} ---\n${truncated}\n`;
  }).join('\n');

  const userPrompt = `Classify these ${inputs.length} document snippet(s):\n\n${fileSections}\n\nReturn ONLY the JSON array.`;

  try {
    const raw = await runner.invokeRaw(userPrompt, TRIAGE_SYSTEM_PROMPT);
    const parsed = parseTriageResponse(raw, inputs.length);

    return inputs.map((input, idx) => {
      const triageResult = parsed[idx];
      if (!triageResult) {
        // AI didn't return a result for this file -- default to process (conservative)
        return {
          score: input.layer2Score,
          reason: 'AI triage returned no result for this file, defaulting to process',
          layer: 3 as const,
          decision: 'process' as const,
        };
      }

      const isRelevant = triageResult.classification !== 'irrelevant';
      const score = isRelevant
        ? Math.max(input.layer2Score, config.processThreshold + 0.05)
        : Math.min(input.layer2Score, config.skipThreshold - 0.05);

      return {
        score,
        reason: `AI triage: ${triageResult.classification} (confidence: ${triageResult.confidence.toFixed(2)}) - ${triageResult.reason}`,
        layer: 3 as const,
        decision: isRelevant ? 'process' as const : 'skip' as const,
        category: triageResult.classification === 'irrelevant'
          ? undefined
          : triageResult.classification,
      };
    });
  } catch (err) {
    console.error('[AITriage] Batch triage failed:', (err as Error).message);
    // On AI failure, default all to 'process' (conservative -- never silently skip)
    return inputs.map(input => ({
      score: input.layer2Score,
      reason: `AI triage failed: ${(err as Error).message}. Defaulting to process.`,
      layer: 3 as const,
      decision: 'process' as const,
    }));
  }
}

function parseTriageResponse(raw: string, expectedCount: number): (TriageOutput | null)[] {
  // Try to extract JSON array from response
  const trimmed = raw.trim();
  let jsonStr = trimmed;

  // Strip markdown code fences if present
  if (jsonStr.startsWith('```')) {
    const firstNewline = jsonStr.indexOf('\n');
    jsonStr = jsonStr.slice(firstNewline + 1);
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, jsonStr.lastIndexOf('```'));
    }
    jsonStr = jsonStr.trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return new Array(expectedCount).fill(null);

    const results: (TriageOutput | null)[] = new Array(expectedCount).fill(null);
    for (const item of parsed) {
      const idx = item.index;
      if (typeof idx === 'number' && idx >= 0 && idx < expectedCount) {
        results[idx] = {
          relativePath: '',
          classification: item.classification || 'irrelevant',
          confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
          reason: item.reason || '',
        };
      }
    }
    return results;
  } catch {
    return new Array(expectedCount).fill(null);
  }
}

// Export for testing
export { parseTriageResponse, TRIAGE_SYSTEM_PROMPT };
export type { TriageInput, TriageOutput };
```

### 5.4 Main Orchestrator

**File:** `src/core/filters/relevance-filter.ts` (new file)

```typescript
import { VaultFile, FileStatus, RelevanceFilterConfig, FilterResult, VaultHandle } from '../../shared/types';
import { updateFileFilterResult } from '../db/files';
import { eventBus } from '../event-bus';
import { loadFilterConfig } from './config';
import { filenameFilter } from './filename-filter';
import { contentSniffer } from './content-sniffer';
import { aiTriageBatch, TriageInput } from './ai-triage';
import * as path from 'path';

/**
 * RelevanceFilter -- Multi-layer pre-filter pipeline.
 *
 * Runs BEFORE the extraction queue to skip irrelevant files.
 * Pipeline: Layer 1 (filename/path) -> Layer 2 (content sniffing) -> Layer 3 (AI triage)
 *
 * Usage:
 *   const filter = new RelevanceFilter(vault);
 *   const filesToProcess = await filter.filterFiles(newFiles);
 */
export class RelevanceFilter {
  private vault: VaultHandle;
  private config: RelevanceFilterConfig;
  private cliPath: string | undefined;

  constructor(vault: VaultHandle, cliPath?: string) {
    this.vault = vault;
    this.config = loadFilterConfig(vault.dotPath);
    this.cliPath = cliPath;
  }

  /**
   * Reload config from disk. Call this if the user changes filter settings.
   */
  reloadConfig(): void {
    this.config = loadFilterConfig(this.vault.dotPath);
  }

  /**
   * Filter a batch of newly-registered files.
   * Returns only the files that should proceed to the extraction queue.
   * Skipped files are updated in the database with status 'Skipped' and reason.
   */
  async filterFiles(files: VaultFile[]): Promise<VaultFile[]> {
    const toProcess: VaultFile[] = [];
    const uncertainFiles: Array<{ file: VaultFile; layer2Result: FilterResult; textSample: string }> = [];

    for (const file of files) {
      const fullPath = path.join(this.vault.rootPath, file.relative_path);

      // === Layer 1: Filename & Path Heuristics ===
      const layer1Result = filenameFilter(file.relative_path, file.file_size, this.config);

      if (layer1Result.decision === 'process') {
        // Strong filename signal -- skip content sniffing, go straight to queue
        updateFileFilterResult(
          file.id, FileStatus.Pending,
          layer1Result.score, layer1Result.reason, 1
        );
        toProcess.push(file);
        continue;
      }

      // === Layer 2: Content Sniffing ===
      const layer2Result = await contentSniffer(fullPath, layer1Result.score, this.config);

      if (layer2Result.decision === 'process') {
        updateFileFilterResult(
          file.id, FileStatus.Pending,
          layer2Result.score, layer2Result.reason, 2
        );
        toProcess.push(file);
        continue;
      }

      if (layer2Result.decision === 'skip') {
        updateFileFilterResult(
          file.id, FileStatus.Skipped,
          layer2Result.score, layer2Result.reason, 2
        );
        eventBus.emit('file:filtered', {
          fileId: file.id,
          relativePath: file.relative_path,
          score: layer2Result.score,
          reason: layer2Result.reason,
        });
        continue;
      }

      // === Uncertain: queue for Layer 3 ===
      // Store text sample for AI triage (already extracted in Layer 2)
      uncertainFiles.push({
        file,
        layer2Result,
        textSample: '', // Will be re-extracted below if needed
      });
    }

    // === Layer 3: AI Triage (batched) ===
    if (uncertainFiles.length > 0 && this.config.aiTriageEnabled) {
      // Re-extract text samples for uncertain files
      // (We could cache from Layer 2, but keeping it simple for now)
      const triageInputs: TriageInput[] = [];
      for (const item of uncertainFiles) {
        const fullPath = path.join(this.vault.rootPath, item.file.relative_path);
        let textSample = '';
        try {
          // Quick text extraction (same as Layer 2 but we need the text for AI)
          const { extractPdfText, extractSpreadsheetText, extractXmlText } = require('./content-sniffer');
          const ext = path.extname(fullPath).toLowerCase();
          if (ext === '.pdf') textSample = await extractPdfText(fullPath);
          else if (ext === '.xlsx' || ext === '.csv') textSample = extractSpreadsheetText(fullPath);
          else if (ext === '.xml') textSample = extractXmlText(fullPath);
        } catch { /* empty text */ }

        triageInputs.push({
          relativePath: item.file.relative_path,
          textSample,
          layer2Score: item.layer2Result.score,
        });
      }

      // Process in batches
      for (let i = 0; i < triageInputs.length; i += this.config.aiTriageBatchSize) {
        const batch = triageInputs.slice(i, i + this.config.aiTriageBatchSize);
        const batchFiles = uncertainFiles.slice(i, i + this.config.aiTriageBatchSize);

        const triageResults = await aiTriageBatch(batch, this.config, this.cliPath);

        for (let j = 0; j < batchFiles.length; j++) {
          const { file } = batchFiles[j];
          const result = triageResults[j];

          if (result.decision === 'skip') {
            updateFileFilterResult(
              file.id, FileStatus.Skipped,
              result.score, result.reason, 3
            );
            eventBus.emit('file:filtered', {
              fileId: file.id,
              relativePath: file.relative_path,
              score: result.score,
              reason: result.reason,
            });
          } else {
            updateFileFilterResult(
              file.id, FileStatus.Pending,
              result.score, result.reason, 3
            );
            toProcess.push(file);
          }
        }
      }
    } else if (uncertainFiles.length > 0) {
      // AI triage disabled -- default uncertain files to process (conservative)
      for (const { file, layer2Result } of uncertainFiles) {
        updateFileFilterResult(
          file.id, FileStatus.Pending,
          layer2Result.score, `${layer2Result.reason} (AI triage disabled, defaulting to process)`, 2
        );
        toProcess.push(file);
      }
    }

    console.log(`[RelevanceFilter] Filtered ${files.length} files: ${toProcess.length} to process, ${files.length - toProcess.length} skipped`);
    return toProcess;
  }
}
```

---

## 6. Event Bus Extension

**File:** `src/shared/types/index.ts`

Add to the `AppEvents` interface:

```typescript
export interface AppEvents {
  // ... existing events ...
  'file:filtered': { fileId: string; relativePath: string; score: number; reason: string };
}
```

---

## 7. Integration Points

### 7.1 Wire filter into the extraction pipeline

The filter must run AFTER files are registered in the database (via SyncEngine) but BEFORE they enter the extraction queue.

**File:** `src/main.ts`

Add a `RelevanceFilter` instance alongside the extraction queue:

```typescript
import { RelevanceFilter } from './core/filters/relevance-filter';

let relevanceFilter: RelevanceFilter | null = null;
```

In `startVault()`, after creating `extractionQueue`:

```typescript
// Start relevance filter
relevanceFilter = new RelevanceFilter(currentVault, appConfig.claudeCliPath || undefined);
```

In `stopVault()`:

```typescript
relevanceFilter = null;
```

### 7.2 Modify the file event -> extraction flow

Currently in `main.ts`, `file:added` and `file:changed` events directly schedule extraction. The filter should intercept here.

Replace the current event wiring:

```typescript
// BEFORE (current):
eventBus.on('file:added', () => { scheduleExtraction(); });
eventBus.on('file:changed', () => { scheduleExtraction(); });

// AFTER (with filter):
// Accumulate newly registered files and filter them in batches
let pendingFilterFiles: VaultFile[] = [];
let filterTimer: NodeJS.Timeout | null = null;

eventBus.on('file:added', (data) => {
  const { getFileByPath } = require('./core/db/files');
  const file = getFileByPath(data.relativePath);
  if (file) pendingFilterFiles.push(file);
  scheduleFilter();
});

eventBus.on('file:changed', (data) => {
  const { getFileByPath } = require('./core/db/files');
  const file = getFileByPath(data.relativePath);
  if (file) pendingFilterFiles.push(file);
  scheduleFilter();
});

function scheduleFilter(): void {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(async () => {
    filterTimer = null;
    if (pendingFilterFiles.length === 0 || !relevanceFilter) return;

    const filesToFilter = [...pendingFilterFiles];
    pendingFilterFiles = [];

    try {
      const accepted = await relevanceFilter.filterFiles(filesToFilter);
      if (accepted.length > 0) {
        scheduleExtraction();
      }
    } catch (err) {
      console.error('[RelevanceFilter] Error during filtering:', err);
      // On filter error, let all files through (fail-open)
      scheduleExtraction();
    }
  }, 2000); // Same debounce as extraction
}
```

### 7.3 Initial scan integration

In the initial scan block of `startVault()`, files are added via `syncEngine.handleEvent('file:added', ...)` which emits `file:added` events. These will now be caught by the filter wiring above. No additional changes needed for initial scan -- the filter is naturally in the path.

### 7.4 Reprocess skipped files

The existing `onReprocessFile` and `onReprocessAll` callbacks in `main.ts` update file status to `Pending` and trigger extraction. For skipped files, this should bypass the filter and go straight to extraction.

Update `onReprocessAll` to include skipped files:

```typescript
onReprocessAll: () => {
  if (!currentVault) return 0;
  const { getFilesByStatus, updateFileStatus } = require('./core/db/files');
  const doneFiles = getFilesByStatus('done');
  const errorFiles = getFilesByStatus('error');
  const reviewFiles = getFilesByStatus('review');
  const skippedFiles = getFilesByStatus('skipped');  // NEW
  for (const file of [...doneFiles, ...errorFiles, ...reviewFiles, ...skippedFiles]) {
    updateFileStatus(file.id, 'pending');
  }
  const count = doneFiles.length + errorFiles.length + reviewFiles.length + skippedFiles.length;
  extractionQueue?.trigger();
  return count;
},
```

When reprocessing a single file (`onReprocessFile`), the existing logic already sets status to `Pending` which bypasses the filter since the filter only runs on newly-added files via the `file:added` event path. Triggering `extractionQueue.trigger()` directly picks up pending files without re-filtering. This is correct behavior.

### 7.5 ExtractionQueue -- skip filtered files

The `ExtractionQueue.processQueue()` method calls `getFilesByStatus(FileStatus.Pending)`. Since skipped files have status `Skipped` (not `Pending`), they are already excluded from the queue. No changes needed in `extraction-queue.ts`.

---

## 8. UI Visibility

### 8.1 Skipped files in ProcessingStatusPanel

**File:** `src/components/ProcessingStatusPanel.tsx`

Add a new section or tab for skipped files. The component already calls `api.getFilesByStatuses(statuses)` -- add `FileStatus.Skipped` to the list.

Show for each skipped file:
- `relative_path`
- `filter_score` (formatted as percentage)
- `filter_reason` (the human-readable explanation)
- `filter_layer` (which layer decided)
- A "Reprocess" button that calls `api.reprocessFile(relativePath)`

### 8.2 FilterPills update

**File:** `src/components/FilterPills.tsx`

Add `Skipped` as a status filter option so users can search for skipped files.

### 8.3 StatusDot update

**File:** `src/components/StatusDot.tsx`

Add a color for the `Skipped` status (gray or light-yellow to indicate it was intentionally filtered out).

### 8.4 IPC handlers for skipped files

**File:** `src/main/overlay-window.ts` (in `registerIpcHandlers`)

The existing `get-files-by-statuses` handler already supports arbitrary status arrays, so no new IPC handler is needed. The renderer just needs to pass `['skipped']` to see skipped files.

Add a new handler for getting filter stats:

```typescript
ipcMain.handle('get-filter-stats', () => {
  const { getDatabase } = require('../core/db/database');
  const db = getDatabase();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
      AVG(CASE WHEN filter_score IS NOT NULL THEN filter_score END) as avg_score
    FROM files WHERE deleted_at IS NULL
  `).get();
  return stats;
});
```

Add to preload API and types:

```typescript
// In InvoiceVaultAPI:
getFilterStats: () => Promise<{ total: number; skipped: number; avg_score: number | null }>;

// In preload.ts:
getFilterStats: () => ipcRenderer.invoke('get-filter-stats'),
```

---

## 9. Testing Specifications

### 9.1 Keyword Bank Tests

**File:** `src/core/filters/keyword-bank.test.ts`

```
Test: "getMergedKeywords returns builtin keywords when no custom keywords"
  Input: config with empty customKeywords
  Assert: result length equals BUILTIN_KEYWORDS length

Test: "getMergedKeywords merges custom keywords, overriding duplicates"
  Input: config with customKeywords = [{ term: 'GTGT', weight: 0.5, category: 'invoice' }]
  Assert: merged 'GTGT' has weight 0.5 (overridden), total count unchanged

Test: "getMergedKeywords adds new custom keywords"
  Input: config with customKeywords = [{ term: 'custom_term', weight: 0.7, category: 'invoice' }]
  Assert: merged includes 'custom_term', total count = BUILTIN + 1

Test: "createKeywordMatcher scores Vietnamese invoice text highly"
  Input: "Hoa don GTGT so 0012345 - MST 0312345678"
  Assert: score > 0.8

Test: "createKeywordMatcher scores English invoice text reasonably"
  Input: "Invoice #12345 - VAT tax receipt for payment"
  Assert: score > 0.5

Test: "createKeywordMatcher scores irrelevant text very low"
  Input: "Team building photos from company retreat 2024"
  Assert: score < 0.2

Test: "createKeywordMatcher handles fuzzy matching (OCR typos)"
  Input: "hoa doan GTGT" (typo: "doan" instead of "don")
  Assert: score > 0.5 (fuzzy match still catches it)

Test: "createKeywordMatcher scores bank statement text highly"
  Input: "Sao ke ngan hang Vietcombank thang 01/2024"
  Assert: score > 0.7
```

### 9.2 Filename Filter Tests

**File:** `src/core/filters/filename-filter.test.ts`

```
Test: "filenameFilter scores path with accounting folder highly"
  Input: relativePath = "ke_toan/2024/file.pdf", fileSize = 50000
  Assert: score > 0.3, decision is 'uncertain' or 'process'

Test: "filenameFilter scores Vietnamese invoice filename highly"
  Input: relativePath = "docs/hoadon_GTGT_001.pdf", fileSize = 50000
  Assert: score > 0.6, decision is 'process'

Test: "filenameFilter scores generic filename low"
  Input: relativePath = "random/document.pdf", fileSize = 50000
  Assert: score == 0

Test: "filenameFilter applies size penalty for tiny files"
  Input: relativePath = "ke_toan/file.pdf", fileSize = 100
  Assert: score is lower than same path with fileSize = 50000

Test: "filenameFilter applies size penalty for huge files"
  Input: relativePath = "ke_toan/file.pdf", fileSize = 100_000_000
  Assert: score is lower than same path with fileSize = 50000

Test: "filenameFilter detects invoice number patterns in filename"
  Input: relativePath = "invoices/AA_22E-0001234.pdf", fileSize = 50000
  Assert: score > 0.3

Test: "filenameFilter uses custom path patterns from config"
  Input: relativePath = "my_custom_folder/file.pdf", config.customPathPatterns = ['my_custom_folder']
  Assert: score > 0 (custom pattern matched)
```

### 9.3 Content Sniffer Tests

**File:** `src/core/filters/content-sniffer.test.ts`

```
Test: "contentSniffer returns image fallback for .jpg files"
  Input: .jpg file
  Assert: result.reason contains 'Image file', layer is 2

Test: "contentSniffer handles extraction failure gracefully"
  Input: non-existent path
  Assert: result.decision is 'uncertain', does not throw

Test: "extractSpreadsheetText extracts sheet names and headers"
  Input: xlsx file with sheet "Hoa Don" and headers ["MST", "So HD"]
  Assert: returned text contains "Hoa Don", "MST", "So HD"

Test: "extractXmlText extracts element names and text content"
  Input: XML with <HoaDon><SoHD>001</SoHD></HoaDon>
  Assert: returned text contains "HoaDon", "SoHD", "001"

Test: "contentSniffer combines Layer 1 and Layer 2 scores correctly"
  Input: layer1Score = 0.3, content matches keywords at 0.5
  Assert: combined score > max(0.3, 0.5) due to union formula
```

### 9.4 AI Triage Tests

**File:** `src/core/filters/ai-triage.test.ts`

```
Test: "parseTriageResponse parses valid JSON array"
  Input: '[{"index": 0, "classification": "invoice", "confidence": 0.9, "reason": "Has MST"}]'
  Assert: result[0].classification === 'invoice'

Test: "parseTriageResponse handles markdown-wrapped JSON"
  Input: '```json\n[{"index": 0, "classification": "irrelevant", "confidence": 0.8, "reason": "HR doc"}]\n```'
  Assert: result[0].classification === 'irrelevant'

Test: "parseTriageResponse returns nulls for invalid JSON"
  Input: 'not valid json'
  Assert: all results are null

Test: "parseTriageResponse handles missing indices"
  Input: '[{"index": 1, "classification": "invoice", "confidence": 0.9, "reason": "test"}]', expectedCount = 3
  Assert: result[0] is null, result[1] is not null, result[2] is null
```

### 9.5 Relevance Filter Integration Tests

**File:** `src/core/filters/relevance-filter.test.ts`

```
Test: "RelevanceFilter skips files with very low content relevance"
  Setup: mock file with irrelevant content, filter_score < 0.4
  Assert: file status updated to Skipped, not in returned array

Test: "RelevanceFilter passes files with strong filename signals without content check"
  Setup: file at path "ke_toan/hoadon_GTGT_001.pdf"
  Assert: file in returned array, filter_layer = 1

Test: "RelevanceFilter sends uncertain files to AI triage when enabled"
  Setup: file with score between 0.4-0.6, mock AI returning 'invoice'
  Assert: file in returned array, filter_layer = 3

Test: "RelevanceFilter defaults uncertain files to process when AI triage disabled"
  Setup: config.aiTriageEnabled = false, file with score 0.5
  Assert: file in returned array, status is Pending

Test: "RelevanceFilter is fail-open -- filter errors do not skip files"
  Setup: mock content sniffer to throw
  Assert: extraction is still scheduled (not silently lost)
```

---

## 10. File Structure

New files to create:

```
src/core/filters/
  config.ts               -- Load/save filter config from .invoicevault/filter-config.json
  keyword-bank.ts          -- Built-in keywords, path patterns, fuzzy matcher factory
  filename-filter.ts       -- Layer 1: filename/path/size heuristics
  content-sniffer.ts       -- Layer 2: content extraction + keyword scoring
  ai-triage.ts             -- Layer 3: Claude Haiku batch triage
  relevance-filter.ts      -- Main orchestrator combining all layers

  keyword-bank.test.ts     -- Unit tests for keyword bank
  filename-filter.test.ts  -- Unit tests for Layer 1
  content-sniffer.test.ts  -- Unit tests for Layer 2
  ai-triage.test.ts        -- Unit tests for Layer 3
  relevance-filter.test.ts -- Integration tests for full pipeline
```

Files to modify:

```
src/shared/types/index.ts       -- FileStatus.Skipped, VaultFile fields, FilterResult types, AppEvents
src/shared/constants.ts          -- DEFAULT_FILTER_CONFIG, FILTER_CONFIG_FILE
src/core/db/schema.ts            -- Migration 009
src/core/db/files.ts             -- updateFileFilterResult(), getSkippedFiles(), STATUS_PRIORITY
src/core/vault.ts                -- Write default filter-config.json on init
src/main.ts                      -- Wire RelevanceFilter, modify event flow, update reprocess callbacks
src/components/ProcessingStatusPanel.tsx  -- Show skipped files section
src/components/FilterPills.tsx            -- Add Skipped status option
src/components/StatusDot.tsx              -- Add Skipped color
src/preload.ts                            -- Add getFilterStats
package.json                              -- Add fuse.js, pdf-parse dependencies
```

---

## 11. Pipeline Flow (Reference Diagram)

```
file detected by watcher (chokidar)
  |
  v
SyncEngine.handleEvent('file:added')
  - inserts file into DB with status='pending'
  - emits eventBus 'file:added'
  |
  v
main.ts event handler accumulates files, debounces 2s
  |
  v
RelevanceFilter.filterFiles(files[])
  |
  +-- for each file:
  |     |
  |     +-- Layer 1: filenameFilter(relativePath, fileSize, config)
  |     |     score > processThreshold? --> ACCEPT (status=Pending, layer=1)
  |     |     else -->
  |     |
  |     +-- Layer 2: contentSniffer(fullPath, layer1Score, config)
  |     |     score > processThreshold? --> ACCEPT (status=Pending, layer=2)
  |     |     score < skipThreshold?    --> REJECT (status=Skipped, layer=2)
  |     |     else --> uncertain, queue for Layer 3
  |     |
  |     +-- Layer 3 (batched): aiTriageBatch(uncertainFiles, config)
  |           classification != 'irrelevant'? --> ACCEPT (status=Pending, layer=3)
  |           classification == 'irrelevant'? --> REJECT (status=Skipped, layer=3)
  |           AI fails?                       --> ACCEPT (fail-open)
  |
  v
Returns accepted files[] --> scheduleExtraction()
  |
  v
ExtractionQueue picks up status='pending' files (skipped files excluded)
```

---

## 12. Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| pdf-parse fails on a corrupted PDF | Layer 2 returns `uncertain` with layer1 score, passes to Layer 3 or processes |
| xlsx file is password-protected | xlsx library throws, Layer 2 catches and returns `uncertain` |
| Claude Haiku is unavailable / CLI not installed | `aiTriageBatch` catches error, returns `process` for all (fail-open) |
| AI returns invalid JSON | `parseTriageResponse` returns nulls, files default to `process` |
| File size is 0 bytes | Gets size penalty but is not auto-skipped |
| Filter config file is corrupted | `loadFilterConfig` falls back to defaults |
| User adds a custom keyword with weight > 1.0 | Score is clamped to [0, 1] in all calculations |
| Reprocessing a skipped file | `onReprocessFile` sets status to Pending, bypassing filter |
| File detected during initial scan (startup) | Same path as watcher events -- goes through filter |

---

## 13. Design Decisions & Rationale

1. **Positive matching (not blacklisting)**: We match files that LOOK LIKE invoices/bank statements rather than trying to enumerate all irrelevant patterns. This is more robust because the set of relevant patterns is smaller and more predictable than the set of all possible irrelevant content.

2. **Fail-open at every layer**: If any layer encounters an error (PDF parsing failure, AI unavailable, config corruption), the file proceeds to extraction rather than being silently skipped. This ensures no legitimate files are lost.

3. **Score combination via probability union**: `1 - (1-L1)(1-L2)` ensures multiple weak signals combine into a stronger signal without exceeding 1.0, and a single strong signal is sufficient.

4. **No option to disable the filter**: The filter is always ON. Users can effectively disable it by setting `skipThreshold: 0` (nothing gets skipped) or `processThreshold: 0` (everything gets processed). There is no boolean toggle because the filter is designed to always be beneficial.

5. **Layer 3 uses Haiku, not Sonnet**: The triage prompt is minimal (first 500 chars of text) and the classification is simple (3 classes). Haiku is sufficient and much cheaper than Sonnet.

6. **Text samples are re-extracted for Layer 3**: Rather than caching the text from Layer 2, we re-extract it for simplicity. The performance cost is negligible since we only re-extract for uncertain files (typically a small subset), and the extraction is fast (reading from disk, not AI).

7. **Filter runs after DB insert**: Files are inserted into the database FIRST (by SyncEngine), then filtered. This ensures all files are tracked in the database regardless of filter outcome, which is important for the "skipped files" UI and for reprocessing.

---

## 14. Validation Criteria

The implementation is considered complete when:

- [ ] `FileStatus.Skipped` is added to the enum and database migration runs without error
- [ ] `filter_score`, `filter_reason`, `filter_layer` columns exist on the `files` table
- [ ] `fuse.js` and `pdf-parse` are installed as dependencies
- [ ] Filter config is written on vault init and loaded on vault open
- [ ] Layer 1 correctly scores files based on filename, path, and size
- [ ] Layer 2 extracts text from PDF, XLSX, CSV, and XML files and scores against keyword bank
- [ ] Layer 3 calls Claude Haiku for uncertain files and classifies correctly
- [ ] Skipped files have status `Skipped` in the database with score and reason populated
- [ ] `pnpm test` passes with all new tests (keyword-bank, filename-filter, content-sniffer, ai-triage, relevance-filter)
- [ ] Skipped files are visible in the ProcessingStatusPanel
- [ ] Users can reprocess a skipped file via the existing reprocess feature
- [ ] The filter is fail-open: errors in any layer result in the file being processed, not skipped
- [ ] The filter does not break existing tests (no regression in existing test suite)
