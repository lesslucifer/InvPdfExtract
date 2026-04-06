import * as fs from 'fs';
import * as path from 'path';
import { INVOICEVAULT_DIR, JE_INSTRUCTIONS_FILE } from '../shared/constants';

export function getInstructionsPath(vaultRoot: string): string {
  return path.join(vaultRoot, INVOICEVAULT_DIR, JE_INSTRUCTIONS_FILE);
}

export function readInstructions(vaultRoot: string): string {
  const p = getInstructionsPath(vaultRoot);
  if (!fs.existsSync(p)) {
    writeDefaultInstructions(vaultRoot);
  }
  return fs.readFileSync(p, 'utf-8');
}

export function writeInstructions(vaultRoot: string, content: string): void {
  const p = getInstructionsPath(vaultRoot);
  fs.writeFileSync(p, content, 'utf-8');
}

export function writeDefaultInstructions(vaultRoot: string): void {
  const p = getInstructionsPath(vaultRoot);
  if (fs.existsSync(p)) return;
  fs.writeFileSync(p, DEFAULT_JE_INSTRUCTIONS, 'utf-8');
}

const DEFAULT_JE_INSTRUCTIONS = `HUONG DAN PHAN LOAI TAI KHOAN (Account Classification Instructions)
=====================================================================

Day la huong dan cho AI phan loai tai khoan cho cac dong hoa don
va sao ke ngan hang. Moi dong chi can 1 tai khoan duy nhat — tai
khoan chi phi/tai san (dau vao) hoac doanh thu (dau ra). Tai
khoan thue va doi ung (331, 131) duoc tu dong tao boi he thong.


PHAN LOAI TAI KHOAN DAU VAO (invoice_in)
-----------------------------------------
Moi dong hoa don dau vao can tai khoan NO (debit):
  - Hang hoa: TK 156
  - Nguyen vat lieu: TK 152
  - Chi phi dich vu tu van: TK 642
  - Van phong pham (VPP): TK 6422
  - Dien, nuoc: TK 6427 (dich vu mua ngoai)
  - Van chuyen, cuoc phi: TK 641 (chi phi ban hang)
  - Thue nha, mat bang: TK 6427
  - Tai san co dinh: TK 211

He thong se tu dong tao:
  - But toan thue: No TK 1331 (tong thue cac dong)
  - But toan doi ung: Co TK 331 (tong tien bao gom thue)


PHAN LOAI TAI KHOAN DAU RA (invoice_out)
-----------------------------------------
Moi dong hoa don dau ra can tai khoan CO (credit):
  - Doanh thu ban hang: TK 511
  - Doanh thu tai chinh: TK 515
  - Doanh thu khac: TK 711

He thong se tu dong tao:
  - But toan thue: Co TK 3331 (tong thue cac dong)
  - But toan doi ung: No TK 131 (tong tien bao gom thue)


PHAN LOAI SAO KE NGAN HANG
----------------------------
  - Thanh toan NCC: TK 331
  - Thu tien KH: TK 131
  - Tra luong: TK 334
  - Nop thue: TK 3331


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
- Neu khong chac chan, su dung TK 156 (dau vao) hoac TK 511 (dau ra)
- Phan loai dong tien mac dinh la "operating" neu khong ro
`;
