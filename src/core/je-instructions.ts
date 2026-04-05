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

const DEFAULT_JE_INSTRUCTIONS = `HUONG DAN PHAN LOAI BUT TOAN (Journal Entry Instructions)
==========================================================

Day la huong dan cho AI phan loai but toan No/Co cho cac dong
hoa don va sao ke ngan hang. Ban co the chinh sua file nay de
thay doi cach AI phan loai.


QUY TAC CHUNG
-------------
- Hoa don dau vao (mua hang): No TK 156 (hang hoa) / Co TK 331 (phai tra NCC)
- Hoa don dau ra (ban hang): No TK 131 (phai thu KH) / Co TK 511 (doanh thu)
- Thue GTGT dau vao: No TK 1331 / Co TK 331
- Thue GTGT dau ra: No TK 3331 / Co TK 33311
- Sao ke ngan hang thu: No TK 112 / Co TK 131
- Sao ke ngan hang chi: No TK 331 / Co TK 112


PHAN LOAI THEO MO TA
---------------------
Mo ta chua "dich vu tu van" hoac "tu van":
  No TK 642 (chi phi quan ly) / Co TK 331

Mo ta chua "van phong pham" hoac "VPP":
  No TK 6422 (chi phi quan ly - VPP) / Co TK 331

Mo ta chua "dien", "tien dien":
  No TK 6427 (chi phi dich vu mua ngoai) / Co TK 331

Mo ta chua "nuoc", "tien nuoc":
  No TK 6427 (chi phi dich vu mua ngoai) / Co TK 331

Mo ta chua "van chuyen", "cuoc phi":
  No TK 641 (chi phi ban hang) / Co TK 331

Mo ta chua "thue nha", "mat bang":
  No TK 6427 (chi phi dich vu mua ngoai) / Co TK 331


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
- Tai khoan theo he thong tai khoan Viet Nam (Thong tu 200/2014)
- Neu khong chac chan, su dung TK 331 cho Co va TK 156 cho No
- Cac dong co thue_suat > 0 can tach rieng but toan thue
- Phan loai dong tien mac dinh la "operating" neu khong ro
`;
