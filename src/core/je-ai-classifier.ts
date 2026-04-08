import { ClaudeCodeRunner } from './claude-cli';
import { readInstructions } from './je-instructions';
import { CashFlowType, JEClassificationResult } from '../shared/types';

export interface UnclassifiedItem {
  id: string; // line_item_id or record_id
  recordId: string;
  docType: string;
  description: string;
  counterpartyName?: string;
  taxId?: string;
  taxRate?: number;
  totalWithTax?: number;
  subtotal?: number;
}

type ParsedJEResponse = Array<Record<string, unknown>> | { results?: Array<Record<string, unknown>>; entries?: Array<Record<string, unknown>> };

export async function classifyWithAI(
  items: UnclassifiedItem[],
  vaultRoot: string,
  cliPath?: string,
): Promise<Map<string, JEClassificationResult>> {
  const results = new Map<string, JEClassificationResult>();
  if (items.length === 0) return results;

  const systemPrompt = await readInstructions(vaultRoot);

  const itemLines = items.map((item, idx) => {
    const parts = [`${idx + 1}. [id: ${item.id}]`];
    parts.push(`"${item.description}"`);
    parts.push(`- ${item.docType}`);
    if (item.totalWithTax != null) parts.push(`${item.totalWithTax.toLocaleString()} VND`);
    if (item.taxRate != null) parts.push(`tax ${item.taxRate}%`);
    if (item.counterpartyName) parts.push(`counterparty: ${item.counterpartyName}`);
    if (item.taxId) parts.push(`TaxID: ${item.taxId}`);
    return parts.join(' ');
  });

  const userPrompt = `Classify these ${items.length} accounting items. For each, provide:
- account: the primary account code
- contra_account: the offsetting account code (the other side of the double entry)
- cash_flow: operating/investing/financing

Items:
${itemLines.join('\n')}

Return a JSON array with one entry per item.`;

  const runner = new ClaudeCodeRunner(cliPath, undefined, 'medium');

  try {
    const raw = await runner.invokeRaw(userPrompt, systemPrompt, vaultRoot);
    const parsed = parseJEResponse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.entries ?? [];

    for (const entry of arr) {
      if (!entry.id || !entry.account) continue;
      const id = String(entry.id);
      results.set(id, {
        lineItemId: id,
        account: String(entry.account),
        contraAccount: entry.contra_account ? String(entry.contra_account) : null,
        cashFlow: ((entry.cash_flow as string | undefined) || 'operating') as CashFlowType,
      });
    }
  } catch (err) {
    console.error('[JEAIClassifier] Classification failed:', err);
  }

  return results;
}

/**
 * Extract and parse JSON from an AI response that may contain markdown fences,
 * prose, or other wrapping.
 */
function parseJEResponse(raw: string): ParsedJEResponse {
  const cleaned = raw.replace(/^```\w*\n?/gm, '').replace(/\n?```$/gm, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }

  const jsonStr = extractBalancedJSON(cleaned);
  if (jsonStr) {
    try {
      return JSON.parse(jsonStr);
    } catch { /* fall through */ }
  }

  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
    } catch { /* fall through */ }
  }

  throw new SyntaxError(`Could not extract valid JSON from AI response: ${raw.substring(0, 200)}...`);
}

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
