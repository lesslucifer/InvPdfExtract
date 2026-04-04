import * as fs from 'fs';
import { DocType, ExtractionFileResult, ExtractionInvoiceData, ExtractionLineItem } from '../../shared/types';
import { computeMissingTaxField } from '../../shared/tax-utils';

/**
 * Parse a Vietnamese e-invoice XML file (hóa đơn điện tử) into structured data.
 * Supports two formats:
 *   - Direct: <HDon><DLHDon>...
 *   - Wrapped (TDiep): <TDiep><DLieu><HDon><DLHDon>...
 */
export function parseXmlInvoice(filePath: string, relativePath: string): ExtractionFileResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const hdonContent = extractHDonContent(content);
  const dlhdon = extractElement(hdonContent, 'DLHDon');
  if (!dlhdon) {
    throw new Error(`No DLHDon element found in ${relativePath}`);
  }

  const ttchung = extractElement(dlhdon, 'TTChung');
  const ndHdon = extractElement(dlhdon, 'NDHDon');
  if (!ttchung || !ndHdon) {
    throw new Error(`Missing TTChung or NDHDon in ${relativePath}`);
  }

  const nban = extractElement(ndHdon, 'NBan');
  const ttoan = extractElement(ndHdon, 'TToan');
  const dsHHDVu = extractElement(ndHdon, 'DSHHDVu');

  const soHoaDon = getTextContent(ttchung, 'SHDon');
  const ngayLap = getTextContent(ttchung, 'NLap');
  const mst = nban ? getTextContent(nban, 'MST') : null;
  const tenDoiTac = nban ? getTextContent(nban, 'Ten') : null;
  const diaChiDoiTac = nban ? getTextContent(nban, 'DChi') : null;

  // Total with tax (TgTTTBSo) — after-tax
  const tongTien = ttoan ? parseNumber(getTextContent(ttoan, 'TgTTTBSo')) : null;
  // Total before tax (TgTCThue) — before-tax
  const tongTienTruocThue = ttoan ? parseNumber(getTextContent(ttoan, 'TgTCThue')) : null;

  // Parse line items
  const lineItems = parseLineItems(dsHHDVu);

  const data: ExtractionInvoiceData = {
    so_hoa_don: soHoaDon ?? undefined,
    tong_tien_truoc_thue: tongTienTruocThue ?? undefined,
    tong_tien: tongTien ?? undefined,
    mst: mst ?? undefined,
    ten_doi_tac: tenDoiTac ?? undefined,
    dia_chi_doi_tac: diaChiDoiTac ?? undefined,
  };

  const fieldConfidence: Record<string, number> = {
    so_hoa_don: 1.0,
    tong_tien_truoc_thue: 1.0,
    tong_tien: 1.0,
    mst: 1.0,
    ten_doi_tac: 1.0,
    ngay: 1.0,
    dia_chi_doi_tac: 1.0,
  };

  return {
    relative_path: relativePath,
    doc_type: DocType.InvoiceIn,
    records: [{
      confidence: 1.0,
      field_confidence: fieldConfidence,
      ngay: ngayLap ?? null,
      data,
      line_items: lineItems,
    }],
  };
}

function extractHDonContent(xml: string): string {
  // Try wrapped format: <TDiep>...<DLieu><HDon>...</HDon></DLieu></TDiep>
  const dlieuMatch = xml.match(/<DLieu>([\s\S]*)<\/DLieu>/);
  if (dlieuMatch) {
    const innerHdon = extractElement(dlieuMatch[1], 'HDon');
    if (innerHdon) return innerHdon;
  }

  // Direct format: <HDon>...</HDon>
  const hdonMatch = xml.match(/<HDon[\s>]/);
  if (hdonMatch) return xml;

  throw new Error('No HDon element found in XML');
}

function extractElement(xml: string, tagName: string): string | null {
  // Match the outermost occurrence of <tagName ...>...</tagName>
  const openPattern = new RegExp(`<${tagName}(\\s[^>]*)?>`, 's');
  const openMatch = xml.match(openPattern);
  if (!openMatch) return null;

  const startIdx = openMatch.index!;
  const closeTag = `</${tagName}>`;
  const closeIdx = xml.indexOf(closeTag, startIdx);
  if (closeIdx === -1) return null;

  return xml.substring(startIdx, closeIdx + closeTag.length);
}

function getInnerContent(xml: string, tagName: string): string | null {
  const el = extractElement(xml, tagName);
  if (!el) return null;
  const openTag = el.match(new RegExp(`^<${tagName}(\\s[^>]*)?>`))?.[0];
  if (!openTag) return null;
  const closeTag = `</${tagName}>`;
  return el.substring(openTag.length, el.length - closeTag.length);
}

function getTextContent(xml: string, tagName: string): string | null {
  const inner = getInnerContent(xml, tagName);
  if (inner === null) return null;
  return inner.trim();
}

function parseNumber(value: string | null): number | null {
  if (value === null) return null;
  const cleaned = value.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseTaxRate(value: string | null): number | null {
  if (value === null) return null;
  const cleaned = value.replace('%', '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseLineItems(dsHHDVu: string | null): ExtractionLineItem[] {
  if (!dsHHDVu) return [];

  const items: ExtractionLineItem[] = [];
  // Find all <HHDVu>...</HHDVu> elements
  const regex = /<HHDVu>([\s\S]*?)<\/HHDVu>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(dsHHDVu)) !== null) {
    const itemXml = match[1];

    // Skip description-only rows (TChat=4)
    const tChat = getTextContent(itemXml, 'TChat');
    if (tChat === '4') continue;

    const mo_ta = getTextContent(itemXml, 'THHDVu') ?? undefined;
    const don_gia = parseNumber(getTextContent(itemXml, 'DGia')) ?? undefined;
    const so_luong = parseNumber(getTextContent(itemXml, 'SLuong')) ?? undefined;
    // ThTien in Vietnamese e-invoice XML is pre-tax amount
    const thanh_tien_truoc_thue = parseNumber(getTextContent(itemXml, 'ThTien')) ?? undefined;
    const thue_suat = parseTaxRate(getTextContent(itemXml, 'TSuat')) ?? undefined;

    // Compute after-tax from before-tax + rate
    const computed = computeMissingTaxField({
      beforeTax: thanh_tien_truoc_thue,
      taxRate: thue_suat,
    });

    items.push({ mo_ta, don_gia, so_luong, thue_suat, thanh_tien_truoc_thue, thanh_tien: computed.afterTax ?? undefined });
  }

  return items;
}
