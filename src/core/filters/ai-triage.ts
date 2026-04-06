import { ClaudeCodeRunner } from '../claude-cli';
import { FilterResult, RelevanceFilterConfig } from '../../shared/types';

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

export async function aiTriageBatch(
  inputs: TriageInput[],
  config: RelevanceFilterConfig,
  cliPath?: string,
): Promise<FilterResult[]> {
  if (inputs.length === 0) return [];

  const runner = new ClaudeCodeRunner(cliPath, 30_000, 'fast'); // Haiku, 30s timeout

  const fileSections = inputs.map((input, idx) => {
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
    return inputs.map(input => ({
      score: input.layer2Score,
      reason: `AI triage failed: ${(err as Error).message}. Defaulting to process.`,
      layer: 3 as const,
      decision: 'process' as const,
    }));
  }
}

function parseTriageResponse(raw: string, expectedCount: number): (TriageOutput | null)[] {
  const trimmed = raw.trim();
  let jsonStr = trimmed;

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

export { parseTriageResponse, TRIAGE_SYSTEM_PROMPT };
export type { TriageInput, TriageOutput };
