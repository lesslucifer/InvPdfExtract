import * as fs from 'fs';
import * as path from 'path';
import { openDatabase, closeDatabase } from './db/database';
import { VaultConfig, VaultHandle } from '../shared/types';
import {
  INVOICEVAULT_DIR, CONFIG_FILE, DB_FILE, VAULT_SUBDIRS,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from '../shared/constants';

export function isVault(folderPath: string): boolean {
  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);
  return fs.existsSync(dotPath) && fs.existsSync(path.join(dotPath, CONFIG_FILE));
}

export function initVault(folderPath: string): VaultHandle {
  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);

  if (isVault(folderPath)) {
    throw new Error(`Folder is already an InvoiceVault: ${folderPath}`);
  }

  // Create .invoicevault/ and subdirectories
  fs.mkdirSync(dotPath, { recursive: true });
  for (const sub of VAULT_SUBDIRS) {
    fs.mkdirSync(path.join(dotPath, sub), { recursive: true });
  }

  // Write config.json
  const config: VaultConfig = {
    version: 1,
    created_at: new Date().toISOString(),
    confidence_threshold: DEFAULT_CONFIDENCE_THRESHOLD,
  };
  fs.writeFileSync(path.join(dotPath, CONFIG_FILE), JSON.stringify(config, null, 2));

  // Initialize database
  const dbPath = path.join(dotPath, DB_FILE);
  openDatabase(dbPath);

  // Write default extraction prompt
  writeDefaultExtractionPrompt(dotPath);

  console.log(`[Vault] Initialized at ${folderPath}`);

  return { rootPath: folderPath, dotPath, dbPath, config };
}

export function openVault(folderPath: string): VaultHandle {
  if (!isVault(folderPath)) {
    throw new Error(`Not an InvoiceVault: ${folderPath}`);
  }

  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);
  const dbPath = path.join(dotPath, DB_FILE);
  const configRaw = fs.readFileSync(path.join(dotPath, CONFIG_FILE), 'utf-8');
  const config: VaultConfig = JSON.parse(configRaw);

  openDatabase(dbPath);

  // Ensure extraction prompt exists (may be missing in older vaults)
  writeDefaultExtractionPrompt(dotPath);

  console.log(`[Vault] Opened ${folderPath}`);

  return { rootPath: folderPath, dotPath, dbPath, config };
}

export function closeVault(): void {
  closeDatabase();
  console.log('[Vault] Closed');
}

export function clearVaultData(folderPath: string): void {
  const dotPath = path.join(folderPath, INVOICEVAULT_DIR);
  if (fs.existsSync(dotPath)) {
    fs.rmSync(dotPath, { recursive: true, force: true });
    console.log(`[Vault] Cleared data at ${folderPath}`);
  }
}

export function getVaultConfig(dotPath: string): VaultConfig {
  const raw = fs.readFileSync(path.join(dotPath, CONFIG_FILE), 'utf-8');
  return JSON.parse(raw);
}

export function updateVaultConfig(dotPath: string, updates: Partial<VaultConfig>): void {
  const config = getVaultConfig(dotPath);
  const merged = { ...config, ...updates };
  fs.writeFileSync(path.join(dotPath, CONFIG_FILE), JSON.stringify(merged, null, 2));
}

function writeDefaultExtractionPrompt(dotPath: string): void {
  const promptPath = path.join(dotPath, 'extraction-prompt.md');
  if (fs.existsSync(promptPath)) return;

  fs.writeFileSync(promptPath, EXTRACTION_PROMPT_TEMPLATE);
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
- \`ten_ngan_hang\`: Bank name (TEXT)
- \`stk\`: Account number (TEXT)
- \`ngay\`: Transaction date (DATE, format YYYY-MM-DD)
- \`mo_ta\`: Transaction description (TEXT)
- \`so_tien\`: Amount — positive for credit, negative for debit (REAL)
- \`ten_doi_tac\`: Beneficiary or sender name (TEXT)

**Fingerprint:** SHA-256 of: normalize(stk) + "|" + normalize(ngay) + "|" + normalize(so_tien)

### Invoice (hóa đơn) — both đầu ra and đầu vào
Invoice-level fields (bảng kê):
- \`so_hoa_don\`: Invoice number (TEXT)
- \`ngay\`: Invoice date (DATE, format YYYY-MM-DD)
- \`tong_tien\`: Total amount (REAL)
- \`mst\`: Tax identification number / MST (TEXT)
- \`ten_doi_tac\`: Customer name (đầu ra) or Supplier name (đầu vào) (TEXT)
- \`dia_chi_doi_tac\`: Customer/Supplier address (TEXT)

Line item fields (chi tiết):
- \`mo_ta\`: Item description (TEXT)
- \`don_gia\`: Unit price (REAL)
- \`so_luong\`: Quantity (REAL)
- \`thue_suat\`: Tax rate as percentage, e.g. 10 for 10% (REAL)
- \`thanh_tien\`: Line total (REAL)

**Fingerprint:** SHA-256 of: normalize(so_hoa_don) + "|" + normalize(mst) + "|" + normalize(ngay)

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
            "so_hoa_don": 0.99,
            "ngay": 0.95,
            "tong_tien": 0.90,
            "mst": 0.98,
            "ten_doi_tac": 0.85,
            "dia_chi_doi_tac": 0.80
          },
          "ngay": "2024-03-15",
          "data": {
            "so_hoa_don": "HD-001",
            "tong_tien": 11000000,
            "mst": "0101234567",
            "ten_doi_tac": "Công ty ABC",
            "dia_chi_doi_tac": "123 Đường XYZ, Quận 1, TP.HCM"
          },
          "line_items": [
            {
              "mo_ta": "Dịch vụ tư vấn",
              "don_gia": 10000000,
              "so_luong": 1,
              "thue_suat": 10,
              "thanh_tien": 10000000
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
`;
