import { ClaudeCodeRunner } from './claude-cli';
import { readInstructions } from './je-instructions';
import { JEClassificationResult } from '../shared/types';

export interface UnclassifiedItem {
  id: string; // line_item_id or record_id
  recordId: string;
  docType: string;
  moTa: string;
  tenDoiTac?: string;
  mst?: string;
  thueSuat?: number;
  thanhTien?: number;
  thanhTienTruocThue?: number;
}

const SYSTEM_PROMPT_SUFFIX = `

You are an accounting assistant classifying Vietnamese invoice line items into journal entries (but toan No/Co).

For each item, determine:
- tk_no: Debit account code (e.g. "156", "642", "1331")
- tk_co: Credit account code (e.g. "331", "511", "33311")
- cash_flow: One of "operating", "investing", or "financing"

Return ONLY a valid JSON array. Each element must have:
- "id": the item ID (provided in the input)
- "tk_no": string
- "tk_co": string
- "cash_flow": string

Example output:
[{"id":"abc-123","tk_no":"156","tk_co":"331","cash_flow":"operating"}]
`;

export async function classifyWithAI(
  items: UnclassifiedItem[],
  vaultRoot: string,
  cliPath?: string,
): Promise<Map<string, JEClassificationResult>> {
  const results = new Map<string, JEClassificationResult>();
  if (items.length === 0) return results;

  const instructions = readInstructions(vaultRoot);
  const systemPrompt = instructions + SYSTEM_PROMPT_SUFFIX;

  const itemLines = items.map((item, idx) => {
    const parts = [`${idx + 1}. [id: ${item.id}]`];
    parts.push(`"${item.moTa}"`);
    parts.push(`- ${item.docType}`);
    if (item.thanhTien != null) parts.push(`${item.thanhTien.toLocaleString()} VND`);
    if (item.thueSuat != null) parts.push(`tax ${item.thueSuat}%`);
    if (item.tenDoiTac) parts.push(`counterparty: ${item.tenDoiTac}`);
    if (item.mst) parts.push(`MST: ${item.mst}`);
    return parts.join(' ');
  });

  const userPrompt = `Classify these ${items.length} accounting items into journal entries (but toan No/Co).
For each item, provide tk_no (debit account), tk_co (credit account), and cash_flow classification.

Items:
${itemLines.join('\n')}

Return a JSON array with one entry per item.`;

  const runner = new ClaudeCodeRunner(cliPath, undefined, 'medium');

  try {
    const raw = await runner.invokeRaw(userPrompt, systemPrompt, vaultRoot);
    const parsed = parseJEResponse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.entries ?? [];

    for (const entry of arr) {
      if (!entry.id || !entry.tk_no || !entry.tk_co) continue;
      results.set(entry.id, {
        lineItemId: entry.id,
        entryType: 'line',
        tkNo: String(entry.tk_no),
        tkCo: String(entry.tk_co),
        cashFlow: entry.cash_flow || 'operating',
      });
    }
  } catch (err) {
    console.error('[JEAIClassifier] Classification failed:', err);
    // Return empty results — caller will leave items unclassified
  }

  return results;
}

/**
 * Extract and parse JSON from an AI response that may contain markdown fences,
 * prose, or other wrapping. Handles both `[...]` arrays and `{...}` objects.
 */
function parseJEResponse(raw: string): any {
  // Step 1: Strip markdown code fences (```json ... ``` or ``` ... ```)
  let cleaned = raw.replace(/^```\w*\n?/gm, '').replace(/\n?```$/gm, '').trim();

  // Step 2: Try direct parse first (works if response is clean JSON)
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }

  // Step 3: Find the first balanced [...] or {...} using bracket counting
  const jsonStr = extractBalancedJSON(cleaned);
  if (jsonStr) {
    try {
      return JSON.parse(jsonStr);
    } catch { /* fall through */ }
  }

  // Step 4: Last resort — aggressive extraction between first [ and last ]
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
    } catch { /* fall through */ }
  }

  throw new SyntaxError(`Could not extract valid JSON from AI response: ${raw.substring(0, 200)}...`);
}

/**
 * Bracket-counting JSON extractor that handles both arrays and objects.
 * Finds the first balanced [...] or {...} in the string.
 */
function extractBalancedJSON(raw: string): string | null {
  for (let start = 0; start < raw.length; start++) {
    const ch = raw[start];
    if (ch !== '{' && ch !== '[') continue;

    const closeChar = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i++) {
      const c = raw[i];

      if (escaped) { escaped = false; continue; }
      if (c === '\\' && inString) { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;

      if (depth === 0 && c === closeChar) {
        return raw.substring(start, i + 1);
      }
    }
  }
  return null;
}
