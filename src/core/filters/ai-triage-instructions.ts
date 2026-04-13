import * as path from 'path';
import { INSTRUCTIONS_SUBDIR, AI_TRIAGE_FILE } from '../../shared/constants';
import { writeInstruction, readInstruction } from '../instruction-manager';

export function getTriageInstructionsPath(dotPath: string): string {
  return path.join(dotPath, INSTRUCTIONS_SUBDIR, AI_TRIAGE_FILE);
}

export async function readTriageInstructions(dotPath: string): Promise<string> {
  const p = getTriageInstructionsPath(dotPath);
  try {
    return await readInstruction(p);
  } catch {
    await writeDefaultTriageInstructions(dotPath);
    return await readInstruction(p);
  }
}

export async function writeDefaultTriageInstructions(dotPath: string): Promise<void> {
  const p = getTriageInstructionsPath(dotPath);
  await writeInstruction(p, DEFAULT_AI_TRIAGE_SYSTEM_ZONE);
}

const DEFAULT_AI_TRIAGE_SYSTEM_ZONE = `You are a document classifier for Vietnamese accounting files.
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
[{"index": 0, "classification": "invoice", "confidence": 0.9, "reason": "Contains TaxID, invoice number, and VAT fields"}]`;
