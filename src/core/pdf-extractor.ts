import * as fs from 'fs';
import * as path from 'path';
import { ExtractionResult } from '../shared/types';
import { ClaudeCodeRunner, unwrapEnvelope, extractJSON, repairTruncatedJSON } from './claude-cli';
import { extractPdfWithLiteParse } from './liteparse-extractor';
import { log, LogModule } from './logger';

export async function processFiles(
  runner: ClaudeCodeRunner,
  filePaths: string[],
  vaultRoot: string,
  systemPromptPath: string,
): Promise<{ result: ExtractionResult; sessionLog: string }> {
  const systemPrompt = await fs.promises.readFile(systemPromptPath, 'utf-8');

  const textResults = await Promise.all(
    filePaths.map(async fp => {
      try {
        const lpResult = await extractPdfWithLiteParse(fp);
        return { filePath: fp, text: lpResult.text, ocrUsed: lpResult.ocrUsed };
      } catch (err) {
        log.warn(LogModule.ClaudeCLI, `LiteParse failed for ${fp}: ${(err as Error).message}`);
        return { filePath: fp, text: '', ocrUsed: false };
      }
    })
  );

  const ocrCount = textResults.filter(r => r.ocrUsed).length;
  log.info(LogModule.ClaudeCLI, `Extracted ${textResults.length} files (${ocrCount} via OCR)`);

  const filesSection = textResults.map(r => {
    const rel = path.relative(vaultRoot, r.filePath);
    const ocrTag = r.ocrUsed ? ' [OCR — may contain errors, please correct during extraction]' : '';
    return `### File: ${rel}${ocrTag}\n${r.text.trim()}`;
  }).join('\n\n');

  const userPrompt = `Process these accounting files and return structured JSON.

## Files (classify and extract from the text below)

${filesSection}

For each file, return a result with relative_path matching exactly as shown above.`;

  const toolArgs = ['--tools', ''];

  const stdout = await runner.invoke(userPrompt, systemPrompt, vaultRoot, toolArgs);
  const allRelative = filePaths.map(fp => path.relative(vaultRoot, fp));
  let sessionLog = `PROMPT:\n${userPrompt}\n\nRESPONSE:\n${stdout}`;

  try {
    const result = parseExtractionResponse(stdout);
    return { result, sessionLog };
  } catch (firstErr) {
    log.warn(LogModule.ClaudeCLI, `Parse failed, retrying with JSON emphasis: ${(firstErr as Error).message}`);

    const retryPrompt = `Your previous response could not be parsed as valid JSON.
Please try again for the same files. Return ONLY a valid JSON object matching the ExtractionResult schema.
Do NOT include any explanation, thinking, commentary, or markdown — output raw JSON only, starting with { and ending with }.
If your previous output was truncated, produce a shorter response.

Files:
${allRelative.map(p => `- ${p}`).join('\n')}

Located relative to: ${vaultRoot}`;

    const retryStdout = await runner.invoke(retryPrompt, systemPrompt, vaultRoot, toolArgs);
    sessionLog += `\n\nRETRY PROMPT:\n${retryPrompt}\n\nRETRY RESPONSE:\n${retryStdout}`;

    const result = parseExtractionResponse(retryStdout);
    return { result, sessionLog };
  }
}

export function parseExtractionResponse(raw: string): ExtractionResult {
  const unwrapped = unwrapEnvelope(raw);
  const text = unwrapped ?? raw;

  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    cleaned = cleaned.slice(firstNewline + 1);
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, cleaned.lastIndexOf('```'));
    }
  }
  cleaned = cleaned.trim();

  const directResult = tryParseExtractionResult(cleaned);
  if (directResult) return directResult;

  const extracted = extractJSON(text);
  if (extracted) {
    const extractedResult = tryParseExtractionResult(extracted);
    if (extractedResult) return extractedResult;
  }

  const repaired = repairTruncatedJSON(text);
  if (repaired) {
    const repairedResult = tryParseExtractionResult(repaired);
    if (repairedResult) {
      log.warn(LogModule.ClaudeCLI, 'Parsed truncated JSON — extraction data may be incomplete');
      return repairedResult;
    }
  }

  const hasOpenBrace = text.indexOf('{') !== -1;
  const endsWithBrace = text.trimEnd().endsWith('}');
  const hint = hasOpenBrace && !endsWithBrace ? ' (output appears truncated)' : '';
  throw new Error(`Failed to parse Claude CLI response as JSON${hint}\nRaw output:\n${text.slice(0, 500)}`);
}

function tryParseExtractionResult(text: string): ExtractionResult | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed.results || !Array.isArray(parsed.results)) return null;
    return parsed as ExtractionResult;
  } catch {
    return null;
  }
}
