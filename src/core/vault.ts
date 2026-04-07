import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { openDatabase, closeDatabase, setActiveDatabase } from './db/database';
import { VaultConfig, VaultHandle } from '../shared/types';
import {
  INVOICEVAULT_DIR, CONFIG_FILE, DB_FILE, VAULT_SUBDIRS,
  DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_FILTER_CONFIG, FILTER_CONFIG_FILE,
} from '../shared/constants';

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
  await writeDefaultExtractionPrompt(dotPath);

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
  try {
    await fs.promises.access(dotPath);
    await fs.promises.rm(dotPath, { recursive: true, force: true });
    console.log(`[Vault] Cleared data at ${folderPath}`);
  } catch { /* dotPath doesn't exist, nothing to clear */ }
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
  const promptPath = path.join(dotPath, 'extraction-prompt.md');
  const hashPath = path.join(dotPath, 'extraction-prompt.hash');

  const templateHash = createHash('sha256').update(EXTRACTION_PROMPT_TEMPLATE).digest('hex');
  let existingHash = '';
  try {
    existingHash = (await fs.promises.readFile(hashPath, 'utf-8')).trim();
  } catch { /* hash file doesn't exist yet */ }

  if (templateHash !== existingHash) {
    await fs.promises.writeFile(promptPath, EXTRACTION_PROMPT_TEMPLATE);
    await fs.promises.writeFile(hashPath, templateHash);
  }
}

const EXTRACTION_PROMPT_TEMPLATE = `# InvoiceVault Extraction System Prompt

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
- \`doc_date\`: Transaction date / Ngày giao dịch (DATE, format YYYY-MM-DD)
- \`description\`: Transaction description / Nội dung giao dịch (TEXT)
- \`amount\`: Amount — positive for credit, negative for debit / Số tiền (REAL)
- \`counterparty_name\`: Beneficiary or sender name / Tên đối tác (TEXT)

**Fingerprint:** SHA-256 of: normalize(account_number) + "|" + normalize(doc_date) + "|" + normalize(amount)

### Invoice (hóa đơn) — both đầu ra and đầu vào
Invoice-level fields (bảng kê):
- \`invoice_number\`: Invoice number / Số hóa đơn (TEXT)
- \`doc_date\`: Invoice date / Ngày lập (DATE, format YYYY-MM-DD)
- \`total_before_tax\`: Total BEFORE tax / Cộng tiền hàng / Tổng tiền trước thuế (REAL). Sum of line items before VAT.
- \`total_amount\`: Total AFTER tax / Tổng cộng thanh toán (REAL). Final payment amount including VAT.
- \`tax_id\`: Tax identification number / Mã số thuế (TEXT)
- \`counterparty_name\`: Customer name (đầu ra) or Supplier name (đầu vào) / Tên đơn vị (TEXT)
- \`counterparty_address\`: Customer/Supplier address / Địa chỉ (TEXT)

Line item fields (chi tiết):
- \`description\`: Item description / Tên hàng hóa, dịch vụ (TEXT)
- \`unit_price\`: Unit price before tax / Đơn giá (REAL)
- \`quantity\`: Quantity / Số lượng (REAL)
- \`tax_rate\`: Tax rate as a percentage INTEGER, e.g. 8 for 8%, 10 for 10% / Thuế suất (REAL). NEVER use decimals like 0.08 — if the source shows 0.08, convert to 8.
- \`subtotal\`: Line total BEFORE tax / Thành tiền (REAL). Usually = unit_price × quantity. This is "Thành tiền" on official Vietnamese invoices.
- \`total_with_tax\`: Line total AFTER tax / Thành tiền sau thuế (REAL). Usually = subtotal × (1 + tax_rate/100).

**Fingerprint:** SHA-256 of: normalize(invoice_number) + "|" + normalize(tax_id) + "|" + normalize(doc_date)

## Output Format

Return ONLY valid JSON with no markdown fences or extra text. Use this exact structure:

\`\`\`json
{
  "results": [
    {
      "relative_path": "path/to/file.pdf",
      "doc_type": "invoice_out",
      "records": [
        {
          "confidence": 0.92,
          "field_confidence": {
            "invoice_number": 0.99,
            "doc_date": 0.95,
            "total_before_tax": 0.90,
            "total_amount": 0.90,
            "tax_id": 0.98,
            "counterparty_name": 0.85,
            "counterparty_address": 0.80
          },
          "doc_date": "2024-03-15",
          "data": {
            "invoice_number": "HD-001",
            "total_before_tax": 10000000,
            "total_amount": 11000000,
            "tax_id": "0101234567",
            "counterparty_name": "Công ty ABC",
            "counterparty_address": "123 Đường XYZ, Quận 1, TP.HCM"
          },
          "line_items": [
            {
              "description": "Dịch vụ tư vấn",
              "unit_price": 10000000,
              "quantity": 1,
              "tax_rate": 10,
              "subtotal": 10000000,
              "total_with_tax": 11000000
            }
          ]
        }
      ]
    }
  ]
}
\`\`\`

## Rules

- Dates must be in YYYY-MM-DD format
- Amounts are numbers (not strings), no currency symbols or thousand separators
- For bank statements, positive amounts = credit (money in), negative = debit (money out)
- Extract ALL records found in the file (a PDF may have multiple pages with multiple invoices)
- If a field is unreadable, set it to null and give confidence 0.0 for that field
- Overall confidence = average of all field confidences
- Return empty \`line_items\` array [] for bank statements
- For invoices, always include line items even if only one item exists
- IMPORTANT: Tax rate (\`tax_rate\`) must ALWAYS be a percentage integer (5, 8, 10). If the source document shows a decimal like 0.08 or 0.1, multiply by 100.
- CRITICAL: For invoice amounts, follow these rules strictly:

  **Line item amounts — STRONGLY prefer BEFORE-tax:**
  - If both before-tax and after-tax amounts are visible, extract both (\`subtotal\` and \`total_with_tax\`)
  - If only ONE amount is available for line items, it is BEFORE-tax (\`subtotal\`) UNLESS explicitly labeled as after-tax (look for: "đã bao gồm thuế", "sau thuế", "bao gồm VAT", "tổng cộng thanh toán")
  - If tax is applied only to the invoice total (not itemized per line), the line item amounts are ALWAYS before-tax
  - Column headers like "Thành tiền", "Đơn giá × SL", "Cộng tiền hàng" → before-tax (\`subtotal\`)
  - When in doubt, set the amount as \`subtotal\` and leave \`total_with_tax\` as null

  **Invoice total — usually AFTER-tax:**
  - \`total_amount\` = the final payment amount (after VAT). This is the number labeled "Tổng cộng thanh toán", "Tổng tiền", "Total"
  - \`total_before_tax\` = subtotal before VAT. Labeled "Cộng tiền hàng", "Tiền trước thuế"
  - Extract both if visible

  **Cross-check signal:** If the document total (\`total_amount\`) approximately equals the sum of line item amounts, those amounts are AFTER-tax. If \`total_amount\` approximately equals SUM(line_amounts) × (1 + tax_rate/100), those amounts are BEFORE-tax. Use this to disambiguate.
`;
