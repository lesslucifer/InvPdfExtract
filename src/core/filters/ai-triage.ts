import { ClaudeCodeRunner } from '../claude-cli';
import { FilterResult, RelevanceFilterConfig } from '../../shared/types';
import { readTriageInstructions } from './ai-triage-instructions';
import { log, LogModule } from '../logger';

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

export async function aiTriageBatch(
  inputs: TriageInput[],
  config: RelevanceFilterConfig,
  dotPath: string,
  cliPath?: string,
): Promise<FilterResult[]> {
  if (inputs.length === 0) return [];

  log.info(LogModule.Filter, `AI triage batch: ${inputs.length} files`);
  const systemPrompt = await readTriageInstructions(dotPath);
  const runner = new ClaudeCodeRunner(cliPath, 30_000, 'fast', 'low');

  const fileSections = inputs.map((input, idx) => {
    const truncated = input.textSample.slice(0, 500);
    return `--- File ${idx}: ${input.relativePath} ---\n${truncated}\n`;
  }).join('\n');

  const userPrompt = `Classify these ${inputs.length} document snippet(s):\n\n${fileSections}\n\nReturn ONLY the JSON array.`;

  try {
    const raw = await runner.invokeRaw(userPrompt, systemPrompt);
    const parsed = parseTriageResponse(raw, inputs.length);

    log.info(LogModule.Filter, `AI triage completed: ${inputs.length} files classified`);
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
    log.error(LogModule.Filter, `Batch triage failed: ${(err as Error).message}`);
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

export { parseTriageResponse };
export type { TriageInput, TriageOutput };
