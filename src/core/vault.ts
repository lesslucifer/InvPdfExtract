import * as fs from 'fs';
import * as path from 'path';
import { openDatabase, closeDatabase, setActiveDatabase } from './db/database';
import { VaultConfig, VaultHandle } from '../shared/types';
import {
  INVOICEVAULT_DIR, CONFIG_FILE, DB_FILE, VAULT_SUBDIRS,
  DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_AMOUNT_TOLERANCE, DEFAULT_FILTER_CONFIG, FILTER_CONFIG_FILE,
  INSTRUCTIONS_SUBDIR, EXTRACTION_PROMPT_FILE,
} from '../shared/constants';
import { writeInstruction } from './instruction-manager';
import { writeDefaultTriageInstructions } from './filters/ai-triage-instructions';
import archiver from 'archiver';

const pathExists = (p: string) => fs.promises.access(p).then(() => true).catch(() => false);

export async function isVault(folderPath: string): Promise<boolean> {
  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);
  return (await pathExists(dotPath)) && (await pathExists(path.join(dotPath, CONFIG_FILE)));
}

export async function initVault(folderPath: string): Promise<VaultHandle> {
  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);

  if (await isVault(folderPath)) {
    throw new Error(`Folder is already an InvoiceVault: ${folderPath}`);
  }

  // Create .invoicevault/ and subdirectories
  await fs.promises.mkdir(dotPath, { recursive: true });
  for (const sub of VAULT_SUBDIRS) {
    await fs.promises.mkdir(path.join(dotPath, sub), { recursive: true });
  }

  // Write config.json
  const config: VaultConfig = {
    version: 1,
    created_at: new Date().toISOString(),
    confidence_threshold: DEFAULT_CONFIDENCE_THRESHOLD,
    amountTolerance: DEFAULT_AMOUNT_TOLERANCE,
  };
  await fs.promises.writeFile(path.join(dotPath, CONFIG_FILE), JSON.stringify(config, null, 2));

  // Write default filter config
  await fs.promises.writeFile(path.join(dotPath, FILTER_CONFIG_FILE), JSON.stringify(DEFAULT_FILTER_CONFIG, null, 2));

  // Initialize database
  const dbPath = path.join(dotPath, DB_FILE);
  const db = openDatabase(dbPath);
  setActiveDatabase(db);

  // Write default extraction prompt
  await writeDefaultExtractionPrompt(dotPath);
  await migrateOldExtractionPrompt(dotPath);
  await writeDefaultTriageInstructions(folderPath);

  console.log(`[Vault] Initialized at ${folderPath}`);

  return { rootPath: folderPath, dotPath, dbPath, config, db };
}

export async function openVault(folderPath: string): Promise<VaultHandle> {
  if (!await isVault(folderPath)) {
    throw new Error(`Not an InvoiceVault: ${folderPath}`);
  }

  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);
  const dbPath = path.join(dotPath, DB_FILE);
  const configRaw = await fs.promises.readFile(path.join(dotPath, CONFIG_FILE), 'utf-8');
  const config: VaultConfig = JSON.parse(configRaw);

  const db = openDatabase(dbPath);
  setActiveDatabase(db);

  // Ensure extraction prompt exists (may be missing in older vaults)
  await migrateOldExtractionPrompt(dotPath);
  await writeDefaultExtractionPrompt(dotPath);
  await writeDefaultTriageInstructions(folderPath);

  console.log(`[Vault] Opened ${folderPath}`);

  return { rootPath: folderPath, dotPath, dbPath, config, db };
}

export function closeVault(handle?: VaultHandle): void {
  if (handle) {
    closeDatabase(handle.db);
  } else {
    closeDatabase();
  }
  console.log('[Vault] Closed');
}

export async function clearVaultData(folderPath: string): Promise<void> {
  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);
  if (!await pathExists(dotPath)) return;
  await fs.promises.rm(dotPath, { recursive: true, force: true });
  console.log(`[Vault] Cleared data at ${folderPath}`);
}

export async function backupVault(folderPath: string, destPath: string): Promise<void> {
  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);
  if (!await pathExists(dotPath)) throw new Error(`No vault data at ${folderPath}`);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(dotPath, INVOICEVAULT_DIR);
    archive.finalize();
  });

  console.log(`[Vault] Backed up ${folderPath} → ${destPath}`);
}

export async function getVaultConfig(dotPath: string): Promise<VaultConfig> {
  const raw = await fs.promises.readFile(path.join(dotPath, CONFIG_FILE), 'utf-8');
  return JSON.parse(raw);
}

export async function updateVaultConfig(dotPath: string, updates: Partial<VaultConfig>): Promise<void> {
  const config = await getVaultConfig(dotPath);
  const merged = { ...config, ...updates };
  await fs.promises.writeFile(path.join(dotPath, CONFIG_FILE), JSON.stringify(merged, null, 2));
}

async function writeDefaultExtractionPrompt(dotPath: string): Promise<void> {
  const promptPath = path.join(dotPath, INSTRUCTIONS_SUBDIR, EXTRACTION_PROMPT_FILE);
  await writeInstruction(promptPath, EXTRACTION_PROMPT_SYSTEM_ZONE);
}

async function migrateOldExtractionPrompt(dotPath: string): Promise<void> {
  const oldPath = path.join(dotPath, 'extraction-prompt.md');
  const oldHashPath = path.join(dotPath, 'extraction-prompt.hash');
  const newPath = path.join(dotPath, INSTRUCTIONS_SUBDIR, EXTRACTION_PROMPT_FILE);

  try {
    await fs.promises.access(oldPath);
  } catch {
    return; // old file doesn't exist, nothing to migrate
  }

  try {
    await fs.promises.access(newPath);
  } catch {
    // new path doesn't exist yet — move old file there
    await fs.promises.mkdir(path.join(dotPath, INSTRUCTIONS_SUBDIR), { recursive: true });
    await fs.promises.rename(oldPath, newPath);
  }

  // Clean up old hash sidecar regardless
  try { await fs.promises.unlink(oldHashPath); } catch { /* ignore */ }
  // Remove old prompt file if it still exists (wasn't moved because new already existed)
  try { await fs.promises.unlink(oldPath); } catch { /* ignore */ }
}

const EXTRACTION_PROMPT_SYSTEM_ZONE = `# InvoiceVault Extraction System Prompt

You are an accounting document extraction agent for Vietnamese businesses. You process PDF files containing Vietnamese VAT invoices (hóa đơn GTGT) and bank statements (sao kê ngân hàng).

## Your Task

For each file provided:

1. **CLASSIFY** the document type:
   - \`bank_statement\` — sao kê ngân hàng
   - \`invoice_out\` — hóa đơn đầu ra (sales invoice)
   - \`invoice_in\` — hóa đơn đầu vào (purchase invoice)

2. **EXTRACT** structured data according to the schema below.

3. **SCORE** your confidence (0.0 to 1.0) for each field and overall.

4. **COMPUTE FINGERPRINT** using the formula for the document type.

## Extraction Schemas

### Bank Statement (sao kê ngân hàng)
- \`bank_name\`: Bank name / Tên ngân hàng (TEXT)
- \`account_number\`: Account number / Số tài khoản (TEXT)
- \`invoice_code\`: Invoice code / Ký hiệu hóa đơn (TEXT, when visible)
- \`invoice_number\`: Invoice number / Số hóa đơn (TEXT, when visible)
- \`doc_date\`: Transaction date / Ngày giao dịch (DATE, YYYY-MM-DD)
- \`description\`: Transaction description / Nội dung giao dịch (TEXT)
- \`amount\`: Amount, positive = credit, negative = debit / Số tiền (REAL)
- \`counterparty_name\`: Beneficiary or sender / Tên đối tác (TEXT)

**Fingerprint:** SHA-256 of: normalize(account_number) + "|" + normalize(doc_date) + "|" + normalize(amount)

### Invoice (hóa đơn) — invoice_out and invoice_in
Invoice-level fields:
- \`invoice_code\`: Ký hiệu hóa đơn / invoice code (TEXT)
- \`invoice_number\`: Số hóa đơn (TEXT)
- \`doc_date\`: Ngày lập (DATE, YYYY-MM-DD)
- \`total_before_tax\`: Cộng tiền hàng — total BEFORE tax (REAL)
- \`total_amount\`: Tổng cộng thanh toán — total AFTER tax (REAL)
- \`tax_id\`: Mã số thuế (TEXT)
- \`counterparty_name\`: Tên đơn vị (TEXT)
- \`counterparty_address\`: Địa chỉ (TEXT)
- \`fee_amount\`: Phí khác / Khoản thu hộ — additional fees/surcharges not in line items (REAL, null if none)
- \`fee_description\`: Mô tả phí — description of the fee (TEXT, null if none)

Line item fields (chi tiết):
- \`description\`: Tên hàng hóa, dịch vụ (TEXT)
- \`unit_price\`: Đơn giá before tax (REAL)
- \`quantity\`: Số lượng (REAL)
- \`tax_rate\`: Thuế suất — percentage INTEGER (8, 10, not 0.08) OR string label (KCT, KKKNT)
- \`subtotal\`: Thành tiền — line total BEFORE tax (REAL)
- \`total_with_tax\`: Thành tiền sau thuế — line total AFTER tax (REAL)

**Fingerprint:** SHA-256 of: normalize(invoice_number) + "|" + normalize(tax_id) + "|" + normalize(doc_date)

**Invoice reference split rule:** \`invoice_code\` and \`invoice_number\` are separate fields. Never merge them into one string. If only one is visible, return that field and set the other to null.

**Invoice reference detection rules for PDFs:**
- \`invoice_code\` usually comes from labels like: "Ký hiệu", "Ký hiệu hóa đơn", "Ký hiệu HĐ", "Serial", "KHHDon"
- \`invoice_number\` usually comes from labels like: "Số", "Số hóa đơn", "Số HĐ", "No.", "SHDon"
- Common valid \`invoice_code\` values look like alphanumeric series such as \`C24TAA\`, \`C26TTP\`, \`AA/23E\`
- Common valid \`invoice_number\` values are numeric strings, sometimes zero-padded such as \`00000056\`
- On many Vietnamese invoices, the code and number appear adjacent, for example: "Ký hiệu: C26TTP" and "Số: 00000056"
- DO NOT confuse \`invoice_code\` with "Ký hiệu mẫu số", "Mẫu số", or \`KHMSHDon\`; those are form/template identifiers, not the invoice code we store
- If OCR/text extraction is noisy, prefer the field nearest to "Ký hiệu hóa đơn"/"Ký hiệu HĐ"/"KHHDon" for \`invoice_code\`

## Irrelevant Documents

If a file is clearly NOT an accounting document (e.g. CV, report, image, code file, bug report), do NOT return an error string. Instead return:
{"relative_path":"...","doc_type":"unknown","records":[],"skipped":true,"skip_reason":"<one-line reason>"}

## Output Format

Return ONLY raw JSON, no markdown fences, no extra text:
{"results":[{"relative_path":"...","doc_type":"...","records":[{"confidence":0.9,"field_confidence":{},"doc_date":"YYYY-MM-DD","data":{},"line_items":[]}]}]}

## Rules

- Dates: YYYY-MM-DD format
- Amounts: numbers, no currency symbols or thousand separators
- Bank statements: positive = credit (money in), negative = debit (money out)
- Extract ALL records in the file (a PDF may contain multiple invoices)
- Unreadable field: set null, confidence 0.0
- Overall confidence = average of field confidences
- Bank statements: return empty \`line_items\` array []
- Invoices: always include line items
- IMPORTANT: \`tax_rate\` must be a percentage integer (5, 8, 10) OR a string label for non-numeric rates (KCT = không chịu thuế, KKKNT = không kê khai nộp thuế). If source shows 0.08, multiply by 100.
- CRITICAL: For invoice amounts:

  **Line item amounts — prefer BEFORE-tax (\`subtotal\`):**
  - If both before-tax and after-tax visible, extract both
  - If only ONE amount per line, it is BEFORE-tax UNLESS labeled "đã bao gồm thuế", "sau thuế", "bao gồm VAT"
  - "Thành tiền", "Đơn giá × SL", "Cộng tiền hàng" → before-tax (\`subtotal\`)
  - When in doubt, set as \`subtotal\`, leave \`total_with_tax\` null

  **Invoice totals:**
  - \`total_amount\` = after-tax final payment ("Tổng cộng thanh toán")
  - \`total_before_tax\` = before-tax subtotal ("Cộng tiền hàng")
  - \`fee_amount\` = additional fees/surcharges shown as a separate line on the invoice, NOT included in line items (e.g. "Các khoản thu hộ nhà chức trách", "Phí khác"). Set null if no separate fee exists.
  - \`fee_description\` = description text of the fee. Set null if no fee.
  - When fee exists: \`total_amount\` ≈ SUM(line item totals) + \`fee_amount\`
  - Cross-check: if \`total_amount\` ≈ SUM(line amounts), those amounts are after-tax; if ≈ SUM × (1 + rate/100), they are before-tax

## Task Instructions

When given files to process:

1. CLASSIFY: Determine document type (bank_statement, invoice_out, invoice_in)
2. EXTRACT: All fields per the schema above
3. SCORE: Confidence 0.0-1.0 per field and overall

IMPORTANT invoice reference rule:
- Extract invoice_code separately from invoice_number
- invoice_code = Ký hiệu hóa đơn / Ký hiệu HĐ / KHHDon
- invoice_number = Số hóa đơn / Số HĐ / SHDon
- Never merge them into one combined string
- Do not use Ký hiệu mẫu số / KHMSHDon as invoice_code

IMPORTANT: Return ONLY the JSON object, no markdown code fences, no extra text.
`;
