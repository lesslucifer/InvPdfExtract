import * as fs from 'fs';
import * as path from 'path';
import { INVOICEVAULT_DIR, INSTRUCTIONS_SUBDIR, JE_INSTRUCTIONS_FILE } from '../shared/constants';
import { writeInstruction, readInstruction } from './instruction-manager';

export function getInstructionsPath(vaultRoot: string): string {
  return path.join(vaultRoot, INVOICEVAULT_DIR, INSTRUCTIONS_SUBDIR, JE_INSTRUCTIONS_FILE);
}

export async function readInstructions(vaultRoot: string): Promise<string> {
  await migrateOldInstructions(vaultRoot);
  const p = getInstructionsPath(vaultRoot);
  try {
    return await readInstruction(p);
  } catch {
    await writeDefaultInstructions(vaultRoot);
    return await readInstruction(p);
  }
}

export async function writeInstructions(vaultRoot: string, content: string): Promise<void> {
  const p = getInstructionsPath(vaultRoot);
  await fs.promises.writeFile(p, content, 'utf-8');
}

export async function writeDefaultInstructions(vaultRoot: string): Promise<void> {
  const p = getInstructionsPath(vaultRoot);
  await writeInstruction(p, DEFAULT_JE_SYSTEM_ZONE);
}

async function migrateOldInstructions(vaultRoot: string): Promise<void> {
  const oldPath = path.join(vaultRoot, INVOICEVAULT_DIR, 'je-instructions.txt');
  const newPath = getInstructionsPath(vaultRoot);

  try {
    await fs.promises.access(oldPath);
  } catch {
    return;
  }

  try {
    await fs.promises.access(newPath);
  } catch {
    await fs.promises.mkdir(path.dirname(newPath), { recursive: true });
    await fs.promises.rename(oldPath, newPath);
    return;
  }

  try { await fs.promises.unlink(oldPath); } catch { /* ignore */ }
}

const DEFAULT_JE_SYSTEM_ZONE = `HUONG DAN PHAN LOAI TAI KHOAN (Account Classification Instructions)
=====================================================================

Day la huong dan cho AI phan loai tai khoan cho cac dong hoa don
va sao ke ngan hang. Moi but toan can 2 tai khoan: "account" (tai khoan
chinh) va "contra_account" (TK doi ung — ben kia cua but toan kep).


PHAN LOAI TAI KHOAN DAU VAO (invoice_in)
-----------------------------------------
Moi dong hoa don dau vao:
  - account (NO/debit):
      Hang hoa: TK 156
      Nguyen vat lieu: TK 152
      Chi phi dich vu tu van: TK 642
      Van phong pham (VPP): TK 6422
      Dien, nuoc: TK 6427 (dich vu mua ngoai)
      Van chuyen, cuoc phi: TK 641 (chi phi ban hang)
      Thue nha, mat bang: TK 6427
      Tai san co dinh: TK 211
  - contra_account (CO/credit): TK 331 (phai tra NCC)
      Neu tra bang tien mat: TK 1111
      Neu tra qua ngan hang: TK 1121


PHAN LOAI TAI KHOAN DAU RA (invoice_out)
-----------------------------------------
Moi dong hoa don dau ra:
  - account (CO/credit):
      Doanh thu ban hang: TK 511
      Doanh thu tai chinh: TK 515
      Doanh thu khac: TK 711
  - contra_account (NO/debit): TK 131 (phai thu KH)


PHAN LOAI SAO KE NGAN HANG
----------------------------
Moi giao dich ngan hang:
  - account: tai khoan doi tac (counterparty)
      Thanh toan NCC: TK 331
      Thu tien KH: TK 131
      Tra luong: TK 334
      Nop thue: TK 3331
      Gop von / nhan von: TK 411
  - contra_account: tai khoan ngan hang/tien mat
      Ngan hang: TK 1121
      Tien mat: TK 1111


BUT TOAN DIEU CHINH / KET CHUYEN (NVK)
----------------------------------------
Doi voi cac but toan dieu chinh, ket chuyen, danh gia lai — suy luan ca
hai tai khoan tu mo ta:
  - "ket chuyen lai nam truoc":       account=4212, contra_account=4211
  - "ket chuyen lo":                  account=4211, contra_account=4212
  - "danh gia lai chenh lech ty gia": account=3311, contra_account=5152 (hoac nguoc lai)
  - "hach toan thue mon bai":         account=6425, contra_account=33382
  - "xu ly chenh lech von vay":       account=34111/34112, contra_account=5152
  - "doi tru tam ung":                account=3311, contra_account=1411
  Neu khong ro, suy luan tu noi dung mo ta.


PHAN LOAI DONG TIEN
--------------------
Hoat dong kinh doanh (operating):
  - Mua/ban hang hoa, dich vu
  - Tra luong, bao hiem, thue
  - Dien, nuoc, van phong pham, dich vu

Hoat dong dau tu (investing):
  - Mua/ban tai san co dinh
  - Mua/ban bat dong san

Hoat dong tai chinh (financing):
  - Vay/tra no
  - Gop von, chia co tuc


GHI CHU
-------
- Tai khoan theo he thong Thong tu 200/2014
- Neu khong chac chan: account=TK 156 (dau vao) hoac TK 511 (dau ra); contra_account=TK 331 hoac TK 131
- Phan loai dong tien mac dinh la "operating" neu khong ro


HUONG DAN DAU RA (Output Format Instructions)
----------------------------------------------
You are an accounting assistant classifying Vietnamese invoice line items into double-entry journal accounts.

Each item needs TWO account codes forming a complete double-entry pair:
- "account": the primary account (expense/asset/revenue/counterparty side)
- "contra_account": the offsetting account (the other side of the entry)

Rules by document type:
- invoice_in (purchase): account = DEBIT side (e.g. "156" goods, "152" materials, "642" admin, "211" fixed assets); contra_account = CREDIT side (typically "331" payable, or "111x"/"112x" if cash payment)
- invoice_out (sale): account = CREDIT side (e.g. "511" revenue, "515" financial income); contra_account = DEBIT side (typically "131" receivable)
- bank transactions: account = counterparty account (e.g. "331" supplier payable, "131" customer receivable, "334" salary, "3331" tax); contra_account = the bank/cash account (e.g. "1121" bank, "1111" cash)
- Adjustment/closing vouchers (NVK): infer both accounts freely from the description (e.g. "kết chuyển lãi" → account="4212", contra_account="4211"; "đánh giá lại tỷ giá" → "3311"/"5152"; "hạch toán thuế môn bài" → "6425"/"33382")

For each item, determine:
- account: primary account code (string)
- contra_account: offsetting account code (string)
- cash_flow: one of "operating", "investing", or "financing"

Return ONLY a valid JSON array. Each element must have:
- "id": the 1-based line number from the input
- "account": string
- "contra_account": string
- "cash_flow": string

Example output:
[{"id":1,"account":"156","contra_account":"331","cash_flow":"operating"}]
`;
