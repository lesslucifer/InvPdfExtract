import _ from 'lodash';
import dice = require('fast-dice-coefficient');
import { ClaudeCodeRunner } from './claude-cli';
import { readInstructions } from './je-instructions';
import { JE_INTRA_BATCH_SIMILARITY_THRESHOLD } from '../shared/constants';
import { CashFlowType, JEClassificationResult } from '../shared/types';
import { log, LogModule } from './logger';

export interface UnclassifiedItem {
  id: string; // line_item_id or record_id
  recordId: string;
  docType: string;
  description: string;
  counterpartyName?: string;
  taxId?: string;
  taxRate?: number | string;
  totalWithTax?: number;
  subtotal?: number;
}

type ParsedJEResponse = Array<Record<string, unknown>> | { results?: Array<Record<string, unknown>>; entries?: Array<Record<string, unknown>> };

const VND_AMOUNT_RE = /\s*[-–—]\s*[\d,.]+\s*(?:VND|đ|dong)\s*/gi;
const TRAILING_SEPARATOR_RE = /\s*[-–—]\s*$/;

function stripAmountsFromDescription(desc: string): string {
  return desc.replace(VND_AMOUNT_RE, '').replace(TRAILING_SEPARATOR_RE, '').trim();
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function buildDedupKey(item: UnclassifiedItem): string {
  return normalize(stripAmountsFromDescription(item.description)) + '||' + item.docType;
}

function findMajorityCounterparty(items: UnclassifiedItem[]): string | null {
  const counts = _.countBy(items, i => normalize(i.counterpartyName ?? ''));
  const entries = Object.entries(counts).filter(([k]) => k);
  const sorted = _.orderBy(entries, ([, count]) => count, 'desc');
  if (sorted.length === 0) return null;
  const [topNorm, topCount] = sorted[0];
  if (topCount / items.length >= 0.6) {
    return items.find(i => normalize(i.counterpartyName ?? '') === topNorm)!.counterpartyName!;
  }
  return null;
}

function mergeSimilarGroups(
  groups: Map<string, UnclassifiedItem[]>,
  threshold: number,
): Map<string, UnclassifiedItem[]> {
  const keys = [...groups.keys()];
  const merged = new Map<string, UnclassifiedItem[]>();
  const consumed = new Set<string>();

  for (let i = 0; i < keys.length; i++) {
    if (consumed.has(keys[i])) continue;
    const descI = keys[i].split('||')[0];
    const items = [...groups.get(keys[i])!];

    for (let j = i + 1; j < keys.length; j++) {
      if (consumed.has(keys[j])) continue;
      if (keys[i].split('||')[1] !== keys[j].split('||')[1]) continue;
      const descJ = keys[j].split('||')[0];
      if (dice(descI, descJ) >= threshold) {
        items.push(...groups.get(keys[j])!);
        consumed.add(keys[j]);
      }
    }

    merged.set(keys[i], items);
  }

  return merged;
}

export async function classifyWithAI(
  items: UnclassifiedItem[],
  vaultRoot: string,
  cliPath?: string,
): Promise<Map<string, JEClassificationResult>> {
  const results = new Map<string, JEClassificationResult>();
  if (items.length === 0) return results;

  const exactGroups = new Map<string, UnclassifiedItem[]>();
  for (const item of items) {
    const key = buildDedupKey(item);
    const group = exactGroups.get(key);
    if (group) group.push(item);
    else exactGroups.set(key, [item]);
  }

  const dedupedGroups = mergeSimilarGroups(exactGroups, JE_INTRA_BATCH_SIMILARITY_THRESHOLD);
  const representatives = [...dedupedGroups.values()].map(group => group[0]);

  const uniqueCount = representatives.length;
  const reduction = items.length > 0 ? Math.round((1 - uniqueCount / items.length) * 100) : 0;
  log.info(LogModule.JEGenerator, `Dedup: ${items.length} items → ${uniqueCount} unique (${reduction}% reduction)`);

  const systemPrompt = await readInstructions(vaultRoot);

  const majorityCounterparty = findMajorityCounterparty(representatives);

  const groupList = [...dedupedGroups.values()];
  const itemLines = representatives.map((item, idx) => {
    const cleanDesc = stripAmountsFromDescription(item.description);
    const parts = [`${idx + 1}.`];
    parts.push(`"${cleanDesc}"`);
    parts.push(`- ${item.docType}`);
    if (item.counterpartyName && (!majorityCounterparty || normalize(item.counterpartyName) !== normalize(majorityCounterparty))) {
      parts.push(`counterparty: ${item.counterpartyName}`);
    }
    return parts.join(' ');
  });

  const contextParts: string[] = [];
  if (majorityCounterparty) contextParts.push(`Counterparty: ${majorityCounterparty}`);

  const userPrompt = `Classify these ${representatives.length} accounting items. For each, provide:
- account: the primary account code
- contra_account: the offsetting account code (the other side of the double entry)
- cash_flow: operating/investing/financing
${contextParts.length > 0 ? '\n' + contextParts.join('\n') + '\n' : ''}
Items:
${itemLines.join('\n')}

Return a JSON array where each entry has: id (1-based line number), account, contra_account, cash_flow.`;

  const runner = new ClaudeCodeRunner(cliPath, undefined, 'medium');

  try {
    const raw = await runner.invokeRaw(userPrompt, systemPrompt, vaultRoot);
    const parsed = parseJEResponse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.entries ?? [];

    for (const entry of arr) {
      if (entry.id == null || !entry.account) continue;
      const idx = Number(entry.id) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= groupList.length) continue;
      const classification = {
        account: String(entry.account),
        contraAccount: entry.contra_account ? String(entry.contra_account) : null,
        cashFlow: ((entry.cash_flow as string | undefined) || 'operating') as CashFlowType,
      };
      for (const item of groupList[idx]) {
        results.set(item.id, {
          ...classification,
          lineItemId: item.id,
        });
      }
    }
  } catch (err) {
    log.error(LogModule.JEGenerator, 'Classification failed:', err);
    throw err;
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
